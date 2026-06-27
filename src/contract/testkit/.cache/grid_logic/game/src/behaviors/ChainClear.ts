/**
 * ChainClear — the chain-clear (SameGame / "click a colour group") board move RULE
 * behavior (BUILD — engine seam; the chain-clear genre's bindable heart).
 *
 * The merge-slide genre slides the whole board in a DIRECTION; chain-clear instead
 * CLICKS a cell and clears the connected same-colour region under it. This is the
 * IGridBehavior the chain-clear genre binds: the scene resolves it by id and routes
 * every move INTENT through resolve(grid, intent) exactly as it does MergeSlide /
 * BoxPush — only the intent is a clicked CELL ('row,col') rather than a direction,
 * and the rule is flood-fill-clear rather than compress-merge or box-push. It
 * re-implements NOTHING the engine owns: the scene still applies the new grid, adds
 * the scoreDelta, re-paints, and runs the win/lose systems. Its sole job is intent
 * -> resolved grid.
 *
 * THE RULE (the chain-clear craft = correctness, not graphics):
 *   1. The intent names a clicked cell 'row,col'. Read its cell VALUE (the "colour" —
 *      a tile is its integer value, exactly like merge-slide / box-push store values).
 *   2. FLOOD-FILL the 4-connected region of cells sharing that value (BFS over up/
 *      down/left/right neighbours of equal value). An empty cell (0) is never a group.
 *   3. CLEAR the region ONLY when it has >= minGroup (default 2) cells — a lone tile
 *      is not a group, so a stray click is a NO-OP (changed:false; the scene spawns
 *      nothing, the move counter does not tick). The cleared cells go to 0; scoreDelta
 *      = the group's score (default n*(n-1), the classic SameGame "bigger groups pay
 *      disproportionately more" curve, the genre's core incentive).
 *   4. GRAVITY: within each column, surviving tiles fall to the bottom (the gaps the
 *      clear left close downward).
 *   5. COLUMN-SHIFT: any column left fully EMPTY collapses, the non-empty columns
 *      shifting LEFT to fill it (the SameGame board compacts horizontally too).
 *   GAME OVER (the INV-5 analogue — "no region of >= minGroup remains") is re-derived
 *   from the live board by the win/lose system, NOT by this pure rule.
 *
 * THE EMIT SEAM (the event PUSH channel — design/event-protocol-design.md §8).
 * resolve() is pure, but the scene/owner hands this rule the shared EventBus via
 * attach(owner) (the same {ref,params}/lifecycle seam BoxPush uses); resolve() then
 * fires a REAL .emit() at the true gameplay seam:
 *   - group.cleared      <- the instant a clicked region of >= minGroup cells clears
 *   - columns.collapsed  <- the instant the post-clear collapse moves a column LEFT
 * Both are GUARDED on the optional bus so resolve() stays a PURE rule in a headless
 * unit test without a scene (no bus -> still returns the resolved grid + scoreDelta).
 *
 * Params (all OPTIONAL — the chain-clear DELTA, with declared defaults):
 *   minGroup   minimum connected same-colour cells a click must touch to clear.
 *              DEFAULT 2 (a pair) — a lone-tile click is a no-op.
 *
 * GENERIC: no board size / colours / theme / score target is encoded — those are
 * level DATA / params. ChainClear is the pure rule; intent -> resolved grid.
 */
import type { Grid } from '../board/GridBoard';
import type { IGridBehavior, GridMoveResult } from './IGridBehavior';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (self-describing; the registry behavior-taxonomy entry mirrors it). */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'ChainClear',
  intent:
    'The chain-clear (SameGame) board move RULE: a click names a cell; flood-fill its 4-connected same-colour region; clear it when it has >= minGroup cells (default 2), score the group (n*(n-1)), then apply gravity (tiles fall down their column) and collapse fully-empty columns leftward. The bindable heart of the chain-clear genre; the scene routes click intents through resolve().',
  roles: ['board'],
  params: ['minGroup'],
} as const;

/** Default minimum group size: a pair (a lone tile is not a clearable group). */
const DEFAULT_MIN_GROUP = 2;

export interface ChainClearConfig {
  /** Min connected same-colour cells a click must touch to clear. Default 2. */
  minGroup?: number;
}

/** A minimal view of the owning scene this rule emits through (the bus seam). */
interface BusOwner {
  eventBus?: { emit(type: string, payload?: unknown): void };
}

export class ChainClear implements IGridBehavior {
  /** The owning scene (set by attach) — the route to the shared EventBus. */
  private owner: BusOwner | null = null;
  private readonly minGroup: number;

  constructor(config: ChainClearConfig = {}) {
    const m = typeof config.minGroup === 'number' ? Math.floor(config.minGroup) : DEFAULT_MIN_GROUP;
    this.minGroup = Math.max(2, m); // a "group" is at least a pair, by definition
  }

  /**
   * Optional lifecycle the scene calls to hand this rule the shared bus (the same
   * owner seam BoxPush uses). Pure resolve() stays callable without it.
   */
  attach(owner: BusOwner): void {
    this.owner = owner;
  }

  /**
   * Resolve ONE CLICK. `intent` is the clicked cell 'row,col' (e.g. '2,3'); an
   * unparseable / out-of-bounds / empty / sub-threshold click is a NO-OP
   * (changed:false) so a stray input never corrupts the board. On a real clear it
   * returns the gravity+collapse-resolved grid, the group's score, changed:true —
   * AND fires group.cleared (+ columns.collapsed when a column actually shifted) on
   * the wired bus at this true seam.
   */
  resolve(grid: Grid, intent: string): GridMoveResult {
    const noop: GridMoveResult = { grid: grid.map((r) => r.slice()), changed: false, scoreDelta: 0 };

    const cell = parseClick(intent);
    if (!cell) return noop;
    const { row, col } = cell;
    if (row < 0 || row >= grid.length || col < 0 || col >= (grid[row]?.length ?? 0)) return noop;

    const value = grid[row][col];
    if (value === 0) return noop; // an empty cell is never a group

    const region = floodFillRegion(grid, row, col, value);
    if (region.length < this.minGroup) return noop; // a lone / sub-threshold click clears nothing

    // 1) Clear the region.
    const cleared: Grid = grid.map((r) => r.slice());
    for (const c of region) cleared[c.row][c.col] = 0;

    // group.cleared — the real clear moment (score increases, the region empties).
    const scoreDelta = scoreGroup(region.length);
    this.bus?.emit('group.cleared', {
      value,
      size: region.length,
      gained: scoreDelta,
      origin: { row, col },
    });

    // 2) Gravity (tiles fall down their column) then 3) column-shift (empties collapse left).
    const gravityGrid = applyGravity(cleared);
    const { grid: collapsed, shifted } = collapseEmptyColumns(gravityGrid);

    // columns.collapsed — only when the collapse actually moved a column leftward.
    if (shifted) {
      this.bus?.emit('columns.collapsed', { size: region.length });
    }

    return { grid: collapsed, changed: true, scoreDelta };
  }

  /** The shared event bus, resolved from the owning scene/board. Publish moments via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  private get bus(): EventBus | undefined {
    return (this.owner as any)?.eventBus;
  }

  // ── component surface (the declared event set this rule publishes) ──────────────

  /**
   * The component surface for the chain-clear rule. Each EventDecl is a TRUE statement
   * about a real .emit() site in resolve():
   *   - group.cleared      <- resolve() when a clicked region of >= minGroup clears  [archetype]
   *   - columns.collapsed  <- resolve() when the post-clear collapse shifts a column [archetype]
   * (The standard board moments — board.moved / score.changed / level.statusChanged —
   * are owned by DataGridScene.surface(); this rule adds the two chain-clear moments.)
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'group.cleared',
          payload: '{value,size,gained,origin:{row,col}}',
          scope: 'archetype',
          drivenBy: 'player clicks a same-colour group of >= minGroup cells',
          expect: '__GAME__.score increases; the group cells empty; group.cleared logged',
        },
        {
          name: 'columns.collapsed',
          payload: '{size}',
          scope: 'archetype',
          drivenBy: 'a clear leaves a fully-empty column',
          expect: '__GAME__ columns shift left to fill the gap; columns.collapsed logged',
        },
      ],
    };
  }
}

// ── pure helpers (the chain-clear rule, testable on the array with no renderer) ──

/** Parse a 'row,col' click intent -> {row,col}; null when malformed. */
function parseClick(intent: string): { row: number; col: number } | null {
  if (typeof intent !== 'string') return null;
  const parts = intent.split(',');
  if (parts.length !== 2) return null;
  const row = Number.parseInt(parts[0], 10);
  const col = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { row, col };
}

/**
 * BFS the 4-connected region of cells equal to `value`, starting at (r0,c0).
 * Returns every cell in the connected same-colour blob (incl. the origin).
 */
function floodFillRegion(grid: Grid, r0: number, c0: number, value: number): { row: number; col: number }[] {
  const rows = grid.length;
  const region: { row: number; col: number }[] = [];
  const seen = new Set<string>();
  const stack: { row: number; col: number }[] = [{ row: r0, col: c0 }];
  while (stack.length > 0) {
    const { row, col } = stack.pop()!;
    if (row < 0 || row >= rows) continue;
    const cols = grid[row].length;
    if (col < 0 || col >= cols) continue;
    const key = `${row},${col}`;
    if (seen.has(key)) continue;
    if (grid[row][col] !== value) continue;
    seen.add(key);
    region.push({ row, col });
    stack.push({ row: row - 1, col }, { row: row + 1, col }, { row, col: col - 1 }, { row, col: col + 1 });
  }
  return region;
}

/**
 * The SameGame score curve for a cleared group of `n` cells: n*(n-1) (a declared
 * default — bigger groups pay disproportionately more, the genre's core incentive).
 */
function scoreGroup(n: number): number {
  return n * (n - 1);
}

/** Gravity: within each column, surviving (non-zero) tiles fall to the bottom. */
function applyGravity(grid: Grid): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let c = 0; c < cols; c += 1) {
    const stack: number[] = [];
    for (let r = rows - 1; r >= 0; r -= 1) {
      if (grid[r][c] !== 0) stack.push(grid[r][c]); // collect bottom-up
    }
    for (let i = 0; i < stack.length; i += 1) {
      out[rows - 1 - i][c] = stack[i]; // re-seat at the bottom of the column
    }
  }
  return out;
}

/**
 * Column-shift: drop any column that is now fully EMPTY, the remaining columns
 * shifting LEFT to fill it. Returns the compacted grid + whether anything moved.
 */
function collapseEmptyColumns(grid: Grid): { grid: Grid; shifted: boolean } {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const keptCols: number[] = [];
  for (let c = 0; c < cols; c += 1) {
    let nonEmpty = false;
    for (let r = 0; r < rows; r += 1) {
      if (grid[r][c] !== 0) {
        nonEmpty = true;
        break;
      }
    }
    if (nonEmpty) keptCols.push(c);
  }
  const shifted = keptCols.some((srcCol, destCol) => srcCol !== destCol);
  if (!shifted) return { grid: grid.map((r) => r.slice()), shifted: false };

  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let destCol = 0; destCol < keptCols.length; destCol += 1) {
    const srcCol = keptCols[destCol];
    for (let r = 0; r < rows; r += 1) out[r][destCol] = grid[r][srcCol];
  }
  return { grid: out, shifted: true };
}
