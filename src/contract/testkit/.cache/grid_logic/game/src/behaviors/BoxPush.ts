/**
 * BoxPush — the sokoban (box-push) board move RULE behavior (BUILD — engine).
 *
 * The bindable per-genre move rule for the `box-push` grid genre, the sokoban
 * analogue of MergeSlide: the blueprint binds `BoxPush` as the board's behavior,
 * the scene resolves it by id and routes every direction intent through resolve().
 * Where MergeSlide compresses + merges tile VALUES, BoxPush moves a single PLAYER
 * pawn one cell in the intent direction over a tagged-cell board, PUSHING at most
 * one box ahead of it — never pulling, never into a wall, never into a second box
 * (the three sokoban rules that make the puzzle PLAY RIGHT). It re-implements the
 * board storage NOTHING — it interprets the integer cell tags the same `Grid`
 * already stores (the genre-agnostic board: merge-slide reads them as powers of
 * two, sokoban reads them as sokoban tags).
 *
 * THE RULE (pure resolve(grid, intent) -> { grid', changed, scoreDelta }):
 *   1. find the player cell; compute the target cell in the intent direction.
 *   2. if the target is floor/goal: the player STEPS (changed).
 *   3. if the target holds a BOX and the cell BEYOND it is floor/goal: the box is
 *      PUSHED one cell, the player follows (changed) -> a `box.pushed` moment.
 *   4. otherwise (wall, board edge, box backed by a wall/another box): NO-OP
 *      (changed:false) — the scene spawns nothing and the move counter does not tick.
 *   Goals are preserved UNDER boxes/the player (a box-on-goal stays a goal cell when
 *   the box leaves), so the win condition is "every goal has a box on it".
 *
 * DEADLOCK-AWARE: after a push it RE-DERIVES whether any not-yet-on-goal box is in a
 * dead corner (two perpendicular walls and not on a goal) — an unwinnable state. It
 * exposes that read so a system/the scene can surface "stuck"; it never silently
 * mutates state on a deadlock (the player can still undo). UNDO/RESET: the rule keeps
 * a bounded history of prior grids; undo() pops the last (the scene swaps it back in)
 * and reset() clears history (a fresh level re-arms cleanly) — the pure-function
 * discipline means a snapshot IS the full undo record.
 *
 * THE EMIT SEAM (the event PUSH channel). resolve() is pure, but the scene/owner
 * hands this rule the shared EventBus via attach(scene) (the same {ref,params}
 * lifecycle a system uses); resolve() then fires a REAL .emit() at the true gameplay
 * seam — box.pushed the instant a box advances a cell, puzzle.solved the instant the
 * last box lands on the last goal. Guarded by the optional bus so the pure rule is
 * still callable in a headless unit test without a scene.
 *
 * Params (all OPTIONAL, the DELTA): none tuned today — the board geometry, the wall/
 * box/goal placement, and the win are board DATA (the materialized level), not the
 * rule. `historyLimit` caps the undo stack (default 64).
 *
 * GENERIC: no board size / theme / specific puzzle is encoded — those are level DATA.
 */
import type { Grid } from '../board/GridBoard';
import type { IGridBehavior, GridMoveResult } from './IGridBehavior';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry reads this — globbed by registry/discover.mjs). */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'BoxPush',
  intent:
    'The sokoban (box-push) board move RULE: move the player one cell per intent, pushing AT MOST one box ahead (never pull, never into a wall or a second box). Deadlock-aware (a box cornered off a goal is flagged unwinnable), with bounded undo/reset. Win when every goal cell carries a box.',
  roles: ['board'],
  params: ['historyLimit'],
} as const;

/**
 * The sokoban cell tags packed into the integer `Grid` (genre-specific reading of
 * the same board storage). 0 stays FLOOR so a bare/empty board is walkable. The
 * goal-bearing variants let a goal survive UNDER a box or the player.
 */
export const CELL = {
  FLOOR: 0,
  WALL: 1,
  BOX: 2,
  PLAYER: 3,
  GOAL: 4,
  BOX_ON_GOAL: 5,
  PLAYER_ON_GOAL: 6,
} as const;

const DIRS: Record<string, { dr: number; dc: number }> = {
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
};

const isBox = (v: number): boolean => v === CELL.BOX || v === CELL.BOX_ON_GOAL;
const isPlayer = (v: number): boolean => v === CELL.PLAYER || v === CELL.PLAYER_ON_GOAL;
const isGoal = (v: number): boolean =>
  v === CELL.GOAL || v === CELL.BOX_ON_GOAL || v === CELL.PLAYER_ON_GOAL;
/** A cell a player or box may move INTO (floor or an empty goal — never a wall/box). */
const isOpen = (v: number): boolean => v === CELL.FLOOR || v === CELL.GOAL;

export interface BoxPushConfig {
  /** Max undo snapshots kept (the bounded history). Default 64. */
  historyLimit?: number;
}

/** A minimal view of the owning scene this rule emits through (the bus seam). */
interface BusOwner {
  eventBus?: { emit(type: string, payload?: unknown): void };
}

export class BoxPush implements IGridBehavior {
  /** The owning scene (set by attach) — the route to the shared EventBus. */
  private owner: BusOwner | null = null;
  /** Bounded undo history of prior grids (a snapshot IS the full record). */
  private history: Grid[] = [];
  private readonly historyLimit: number;
  /** Latched once the puzzle is solved so puzzle.solved fires exactly once. */
  private solved = false;

  constructor(config: BoxPushConfig = {}) {
    const lim = Math.floor(config.historyLimit ?? 64);
    this.historyLimit = lim > 0 ? lim : 64;
  }

  /**
   * Optional lifecycle the scene calls to hand this rule the shared bus (the same
   * {ref,params} owner seam a system uses). Pure resolve() stays callable without it.
   */
  attach(owner: BusOwner): void {
    this.owner = owner;
  }

  /** Re-arm for a fresh level / restart: clear the undo history and the solved latch. */
  reset(): void {
    this.history = [];
    this.solved = false;
  }

  /**
   * Resolve ONE sokoban move. Pure with respect to the input `grid` (never mutated);
   * a no-op intent / blocked push returns changed:false so the scene spawns nothing.
   * On a real move it records the prior grid for undo, fires box.pushed on a push and
   * puzzle.solved when the last goal is covered, and returns the new grid.
   */
  resolve(grid: Grid, intent: string): GridMoveResult {
    const noop: GridMoveResult = { grid: grid.map((r) => r.slice()), changed: false, scoreDelta: 0 };
    const dir = DIRS[intent];
    if (!dir) return noop;

    const pos = this.findPlayer(grid);
    if (!pos) return noop;
    const { r, c } = pos;
    const tr = r + dir.dr;
    const tc = c + dir.dc;
    if (!this.inBounds(grid, tr, tc)) return noop;

    const next = grid.map((row) => row.slice());
    const targetVal = grid[tr][tc];
    let pushed = false;

    if (isOpen(targetVal)) {
      // STEP: the player moves into open floor/goal.
      this.movePlayer(next, r, c, tr, tc);
    } else if (isBox(targetVal)) {
      // PUSH: only if the cell BEYOND the box is open (never into a wall/box).
      const br = tr + dir.dr;
      const bc = tc + dir.dc;
      if (!this.inBounds(grid, br, bc) || !isOpen(grid[br][bc])) return noop;
      // advance the box, then the player follows into the vacated cell.
      next[br][bc] = isGoal(grid[br][bc]) ? CELL.BOX_ON_GOAL : CELL.BOX;
      next[tr][tc] = isGoal(targetVal) ? CELL.GOAL : CELL.FLOOR; // box leaves; goal survives
      this.movePlayer(next, r, c, tr, tc);
      pushed = true;
    } else {
      // a WALL (or any non-open, non-box tag): blocked — no move.
      return noop;
    }

    // Record the prior grid for undo (bounded), then publish the moments.
    this.pushHistory(grid);

    if (pushed) {
      // box.pushed — a box advanced exactly one cell (the true push seam).
      const onGoal = next[tr + dir.dr][tc + dir.dc] === CELL.BOX_ON_GOAL;
      this.bus?.emit('box.pushed', {
        from: { row: tr, col: tc },
        to: { row: tr + dir.dr, col: tc + dir.dc },
        onGoal,
      });
    }

    // puzzle.solved — the last box reached a goal (every goal now covered). Latched.
    if (!this.solved && this.allGoalsCovered(next)) {
      this.solved = true;
      this.bus?.emit('puzzle.solved', { boxes: this.countBoxesOnGoal(next) });
    }

    return { grid: next, changed: true, scoreDelta: 0 };
  }

  // ── undo / reset ──────────────────────────────────────────────────────────────

  /**
   * Pop the most recent prior grid (the scene swaps it back in via setGrid). Returns
   * undefined when there is nothing to undo. Clears the solved latch so a solved state
   * undone is genuinely replayable.
   */
  undo(): Grid | undefined {
    const prev = this.history.pop();
    if (prev) this.solved = false;
    return prev;
  }

  // ── deadlock awareness (a read; never a silent mutation) ───────────────────────

  /**
   * True iff some not-on-goal box is wedged in a dead corner (two perpendicular
   * orthogonal walls/edges) — a state from which the puzzle can never be solved. The
   * scene/a system reads this to surface "stuck"; the player can still undo out of it.
   */
  isDeadlocked(grid: Grid): boolean {
    for (let r = 0; r < grid.length; r += 1) {
      for (let c = 0; c < grid[r].length; c += 1) {
        if (grid[r][c] !== CELL.BOX) continue; // a box already on a goal is fine
        const up = this.isWallOrEdge(grid, r - 1, c);
        const down = this.isWallOrEdge(grid, r + 1, c);
        const left = this.isWallOrEdge(grid, r, c - 1);
        const right = this.isWallOrEdge(grid, r, c + 1);
        if ((up || down) && (left || right)) return true; // a corner-locked box
      }
    }
    return false;
  }

  /** True iff every goal cell carries a box (the win condition, INV: solved). */
  allGoalsCovered(grid: Grid): boolean {
    let goals = 0;
    for (const row of grid) {
      for (const v of row) {
        if (v === CELL.GOAL || v === CELL.PLAYER_ON_GOAL) return false; // an uncovered goal
        if (v === CELL.BOX_ON_GOAL) goals += 1;
      }
    }
    return goals > 0; // at least one goal, all covered
  }

  // ── internals ──────────────────────────────────────────────────────────────────

  /** The shared event bus, resolved from the owning scene/board. Publish moments via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  private get bus(): EventBus | undefined {
    return (this.owner as any)?.eventBus;
  }

  private inBounds(grid: Grid, r: number, c: number): boolean {
    return r >= 0 && r < grid.length && c >= 0 && c < (grid[r]?.length ?? 0);
  }

  private isWallOrEdge(grid: Grid, r: number, c: number): boolean {
    if (!this.inBounds(grid, r, c)) return true; // the board edge bounds like a wall
    return grid[r][c] === CELL.WALL;
  }

  private findPlayer(grid: Grid): { r: number; c: number } | null {
    for (let r = 0; r < grid.length; r += 1) {
      for (let c = 0; c < grid[r].length; c += 1) {
        if (isPlayer(grid[r][c])) return { r, c };
      }
    }
    return null;
  }

  /** Move the player from (fr,fc) to (tr,tc), preserving goals under both cells. */
  private movePlayer(grid: Grid, fr: number, fc: number, tr: number, tc: number): void {
    grid[fr][fc] = isGoal(grid[fr][fc]) ? CELL.GOAL : CELL.FLOOR; // vacate (goal survives)
    grid[tr][tc] = isGoal(grid[tr][tc]) ? CELL.PLAYER_ON_GOAL : CELL.PLAYER;
  }

  private pushHistory(grid: Grid): void {
    this.history.push(grid.map((r) => r.slice()));
    while (this.history.length > this.historyLimit) this.history.shift();
  }

  private countBoxesOnGoal(grid: Grid): number {
    let n = 0;
    for (const row of grid) for (const v of row) if (v === CELL.BOX_ON_GOAL) n += 1;
    return n;
  }

  // ── component surface (the declared event set this rule publishes) ──────────────

  /**
   * The component surface for the box-push rule. Each EventDecl is a TRUE statement
   * about a real .emit() site in resolve():
   *   - box.pushed     <- resolve() when a box advances one cell  [archetype]
   *   - puzzle.solved  <- resolve() when the last goal is covered [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'box.pushed',
          payload: '{from:{row,col},to:{row,col},onGoal}',
          scope: 'archetype',
          drivenBy: 'the player moves into a box on free floor',
          expect: 'the box cell advances one tile; box.pushed logged',
        },
        {
          name: 'puzzle.solved',
          payload: '{boxes}',
          scope: 'archetype',
          drivenBy: 'the last box reaches a goal',
          expect: "__GAME__.status becomes 'won'; puzzle.solved logged",
        },
      ],
    };
  }
}
