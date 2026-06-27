/**
 * ChainBomb — the chain-clear BOMB-tile board move RULE behavior (BUILD — engine seam;
 * the chain-clear genre's payoff layer, a peer of ChainClear).
 *
 * ChainClear is the base chain-clear (SameGame) rule: click a cell, flood-fill its
 * 4-connected same-colour region, clear it when it has >= minGroup cells. ChainBomb is
 * the SAME IGridBehavior shape (the scene routes a clicked-cell intent through
 * resolve(grid, intent) exactly as it does ChainClear / MergeSlide), with ONE added
 * rule the genre's reward loop lives on: a popped group that TOUCHES a BOMB tile makes
 * that bomb DETONATE — clearing an extra CROSS (the bomb's row+column within a radius)
 * BEYOND the connected colour region. So a player who routes a pop through a bomb is paid
 * a much bigger clear, the classic "match into the special for a chain reaction" payoff.
 *
 * A bomb is a SPECIAL MARKER value on the board (the SpecialTileFactory convention): a
 * cell whose value === bombValue (a declared sentinel, default 99, distinct from any
 * colour id 1..N) is a bomb, not a colour. Bombs are placed in the level DATA (the
 * board) — ChainBomb does not mint them; it only DETONATES the ones a pop touches.
 *
 * THE RULE (chain-clear craft = correctness over graphics):
 *   1. The intent names a clicked cell 'row,col'. Read its colour VALUE. A click ON a
 *      bomb cell, or on an empty cell, is a NO-OP (a bomb is detonated by an adjacent
 *      colour pop, not clicked directly — clicking it alone clears nothing).
 *   2. FLOOD-FILL the 4-connected region of cells sharing that colour (BFS over up/
 *      down/left/right neighbours of equal value; a bomb cell is never equal to a colour
 *      so it is never swept INTO the region by the flood-fill).
 *   3. The pop fires ONLY when the colour region has >= minGroup (default 2) cells — a
 *      lone / sub-threshold click is a no-op (changed:false; the move counter never ticks).
 *   4. DETONATE: every BOMB cell 4-adjacent to the popped region detonates. A detonation
 *      clears a CROSS centred on the bomb — every cell within `blastRadius` (default 2)
 *      along the bomb's row AND its column — plus the bomb cell itself. A bomb caught in
 *      another bomb's blast CHAINS (it detonates in turn), so a cluster of bombs goes off
 *      in a single pop. The colour region + every blasted cell go to 0.
 *   5. GRAVITY then COLUMN-SHIFT, identical to ChainClear: surviving tiles fall to the
 *      bottom of their column; any fully-empty column collapses leftward.
 *   scoreDelta = the colour group's SameGame score (n*(n-1)) PLUS a flat bombBonus
 *   (default 50) per detonated bomb — the incentive to route pops through bombs.
 *
 * THE EMIT SEAM (the event PUSH channel — design/event-protocol-design.md §8).
 * resolve() is pure, but the scene/owner hands this rule the shared EventBus via
 * attach(owner) (the same {ref,params}/lifecycle seam ChainClear / BoxPush use);
 * resolve() then fires a REAL .emit() at the true gameplay seam:
 *   - bomb.triggered  <- the instant a pop touches >= 1 bomb and the extra cross/area
 *                        of cells clears beyond the connected colour region.
 * GUARDED on the optional bus so resolve() stays a PURE rule in a headless unit test
 * without a scene (no bus -> still returns the resolved grid + scoreDelta).
 *
 * idSource: a detonation's identity is DERIVED from the popped group — the clicked
 * origin cell plus the detonated bombs' cells. No per-game id param is needed; the pop
 * + the bomb cells name it.
 *
 * Params (all OPTIONAL — the bomb DELTA, with declared defaults, never a game number):
 *   minGroup     min connected same-colour cells a click must touch to pop. DEFAULT 2.
 *   bombValue    the sentinel board value that marks a BOMB tile. DEFAULT 99 (distinct
 *                from any colour id; a blueprint may override).
 *   blastRadius  cells cleared along the bomb's row+column each side of it. DEFAULT 2.
 *   bombBonus    flat score added per detonated bomb. DEFAULT 50.
 *
 * GENERIC: no board size / colours / theme / score target is encoded — those are level
 * DATA / params. ChainBomb is the pure rule; intent -> resolved grid.
 */
import type { Grid } from '../board/GridBoard';
import type { IGridBehavior, GridMoveResult } from './IGridBehavior';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (self-describing; the registry behavior-taxonomy entry mirrors it). */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'ChainBomb',
  intent:
    'The chain-clear BOMB rule: a click flood-fills its 4-connected same-colour region and pops it (>= minGroup, default 2); any BOMB tile (board value === bombValue, default 99) 4-adjacent to the popped region DETONATES, clearing an extra CROSS (its row+column within blastRadius, default 2) beyond the connected region, with bombs chaining. Scores n*(n-1) + bombBonus per bomb. The chain-clear genre\'s special-tile payoff; the scene routes click intents through resolve().',
  roles: ['board'],
  params: ['minGroup', 'bombValue', 'blastRadius', 'bombBonus'],
} as const;

/** Declared defaults — the chain-clear bomb delta (NEVER fabricated per-game). */
const DEFAULT_MIN_GROUP = 2;
const DEFAULT_BOMB_VALUE = 99;
const DEFAULT_BLAST_RADIUS = 2;
const DEFAULT_BOMB_BONUS = 50;

export interface ChainBombConfig {
  /** Min connected same-colour cells a click must touch to pop. Default 2. */
  minGroup?: number;
  /** The sentinel board value that marks a BOMB tile. Default 99. */
  bombValue?: number;
  /** Cells cleared along a bomb's row+column on each side of it. Default 2. */
  blastRadius?: number;
  /** Flat score added per detonated bomb. Default 50. */
  bombBonus?: number;
}

/** A minimal view of the owning scene this rule emits through (the bus seam). */
interface BusOwner {
  eventBus?: { emit(type: string, payload?: unknown): void };
}

type Cell = { row: number; col: number };

export class ChainBomb implements IGridBehavior {
  /** The owning scene (set by attach) — the route to the shared EventBus. */
  private owner: BusOwner | null = null;

  private readonly minGroup: number;
  private readonly bombValue: number;
  private readonly blastRadius: number;
  private readonly bombBonus: number;

  constructor(config: ChainBombConfig = {}) {
    const m = typeof config.minGroup === 'number' ? Math.floor(config.minGroup) : DEFAULT_MIN_GROUP;
    this.minGroup = Math.max(2, m); // a "group" is at least a pair, by definition
    this.bombValue =
      typeof config.bombValue === 'number' && config.bombValue > 0
        ? Math.floor(config.bombValue)
        : DEFAULT_BOMB_VALUE;
    this.blastRadius =
      typeof config.blastRadius === 'number' && config.blastRadius >= 1
        ? Math.floor(config.blastRadius)
        : DEFAULT_BLAST_RADIUS;
    this.bombBonus =
      typeof config.bombBonus === 'number' && config.bombBonus >= 0
        ? Math.floor(config.bombBonus)
        : DEFAULT_BOMB_BONUS;
  }

  /**
   * Optional lifecycle the scene calls to hand this rule the shared bus (the same
   * owner seam ChainClear / BoxPush use). Pure resolve() stays callable without it.
   */
  attach(owner: BusOwner): void {
    this.owner = owner;
  }

  /**
   * Resolve ONE CLICK. `intent` is the clicked cell 'row,col'. An unparseable /
   * out-of-bounds / empty / bomb / sub-threshold click is a NO-OP (changed:false) so a
   * stray input never corrupts the board. On a real pop it returns the
   * gravity+collapse-resolved grid, the score (colour group + bomb bonus), changed:true
   * — AND, when the pop touches >= 1 bomb, fires bomb.triggered on the wired bus at the
   * true detonation seam (the extra cross/area cleared beyond the connected region).
   */
  resolve(grid: Grid, intent: string): GridMoveResult {
    const noop: GridMoveResult = { grid: grid.map((r) => r.slice()), changed: false, scoreDelta: 0 };

    const cell = parseClick(intent);
    if (!cell) return noop;
    const { row, col } = cell;
    if (row < 0 || row >= grid.length || col < 0 || col >= (grid[row]?.length ?? 0)) return noop;

    const value = grid[row][col];
    if (value === 0) return noop; // an empty cell is never a group
    if (value === this.bombValue) return noop; // a bomb is detonated by an adjacent pop, not a direct click

    const region = floodFillRegion(grid, row, col, value, this.bombValue);
    if (region.length < this.minGroup) return noop; // a lone / sub-threshold click pops nothing

    const work: Grid = grid.map((r) => r.slice());
    const popped = new Set<string>();

    // 1) Clear the connected colour region.
    for (const c of region) {
      work[c.row][c.col] = 0;
      popped.add(`${c.row},${c.col}`);
    }

    // 2) DETONATE every bomb 4-adjacent to the popped region; bombs chain through blasts.
    const seedBombs = bombsAdjacentTo(work, grid, region, this.bombValue);
    const detonatedBombs = this.detonateChain(work, seedBombs, popped);

    // bomb.triggered — fired ONLY when a real bomb detonated (the extra cross/area cleared).
    if (detonatedBombs.length > 0) {
      this.bus?.emit('bomb.triggered', {
        origin: { row, col },
        groupSize: region.length,
        bombs: detonatedBombs.length,
        extraCleared: popped.size - region.length, // cells cleared BEYOND the colour region
      });
    }

    // 3) Score: the SameGame colour curve + a flat bonus per detonated bomb.
    const scoreDelta = scoreGroup(region.length) + detonatedBombs.length * this.bombBonus;

    // 4) Gravity (tiles fall) then 5) column-shift (fully-empty columns collapse left).
    const gravityGrid = applyGravity(work);
    const { grid: collapsed } = collapseEmptyColumns(gravityGrid);

    return { grid: collapsed, changed: true, scoreDelta };
  }

  /**
   * Detonate the seed bombs and any bombs their blasts reach (the chain). Clears each
   * bomb's cross (row+column within blastRadius) into `work`, recording every cleared
   * cell in `popped`. Returns the cells of the bombs that actually detonated.
   */
  private detonateChain(work: Grid, seeds: Cell[], popped: Set<string>): Cell[] {
    const detonated: Cell[] = [];
    const queued = new Set<string>(seeds.map((b) => `${b.row},${b.col}`));
    const queue: Cell[] = [...seeds];

    while (queue.length > 0) {
      const bomb = queue.shift()!;
      detonated.push(bomb);
      // the bomb tile itself clears
      work[bomb.row][bomb.col] = 0;
      popped.add(`${bomb.row},${bomb.col}`);

      for (const target of crossCells(work, bomb.row, bomb.col, this.blastRadius)) {
        const v = work[target.row][target.col];
        // a bomb caught in the blast chains (detonates in turn) — enqueue once.
        if (v === this.bombValue) {
          const k = `${target.row},${target.col}`;
          if (!queued.has(k)) {
            queued.add(k);
            queue.push(target);
          }
          continue; // its own pass will clear it + its cross
        }
        if (v !== 0) {
          work[target.row][target.col] = 0;
          popped.add(`${target.row},${target.col}`);
        }
      }
    }
    return detonated;
  }

  /** The shared event bus, resolved from the owning scene/board. Publish moments via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  private get bus(): EventBus | undefined {
    return (this.owner as any)?.eventBus;
  }

  // ── component surface (the declared event set this rule publishes) ──────────────

  /**
   * The component surface for the chain-clear bomb rule. The single EventDecl is a TRUE
   * statement about a real .emit() site in resolve()/detonateChain():
   *   - bomb.triggered  <- a pop touches >= 1 bomb; an extra cross/area clears beyond
   *                        the connected colour region  [archetype]
   * (The standard board moments — board.moved / score.changed / level.statusChanged —
   * are owned by DataGridScene.surface(); this rule adds the bomb detonation moment.)
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'bomb.triggered',
          payload: '{origin:{row,col},groupSize,bombs,extraCleared}',
          scope: 'archetype',
          drivenBy: 'player pops a colour group that touches a bomb tile',
          expect:
            '__GAME__ an extra cross/area of cells clears beyond the connected region; score jumps; bomb.triggered logged',
        },
      ],
    };
  }
}

// ── pure helpers (the chain-bomb rule, testable on the array with no renderer) ──

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
 * BFS the 4-connected region of cells equal to `value`, starting at (r0,c0). A bomb cell
 * (=== bombValue) is never equal to a colour, so it is never swept into the region —
 * bombs are detonated by adjacency, not absorbed into the flood-fill.
 */
function floodFillRegion(
  grid: Grid,
  r0: number,
  c0: number,
  value: number,
  bombValue: number,
): Cell[] {
  const rows = grid.length;
  const region: Cell[] = [];
  const seen = new Set<string>();
  const stack: Cell[] = [{ row: r0, col: c0 }];
  while (stack.length > 0) {
    const { row, col } = stack.pop()!;
    if (row < 0 || row >= rows) continue;
    const cols = grid[row].length;
    if (col < 0 || col >= cols) continue;
    const key = `${row},${col}`;
    if (seen.has(key)) continue;
    if (grid[row][col] === bombValue) continue; // never absorb a bomb into the colour region
    if (grid[row][col] !== value) continue;
    seen.add(key);
    region.push({ row, col });
    stack.push({ row: row - 1, col }, { row: row + 1, col }, { row, col: col - 1 }, { row, col: col + 1 });
  }
  return region;
}

/**
 * Every BOMB cell 4-adjacent to the popped colour region. Reads bomb membership from the
 * ORIGINAL grid (the region cells are already cleared in `work`), so an adjacency to a
 * just-popped cell still counts. De-duped.
 */
function bombsAdjacentTo(work: Grid, original: Grid, region: Cell[], bombValue: number): Cell[] {
  const rows = work.length;
  const out: Cell[] = [];
  const seen = new Set<string>();
  for (const c of region) {
    const neighbours: Cell[] = [
      { row: c.row - 1, col: c.col },
      { row: c.row + 1, col: c.col },
      { row: c.row, col: c.col - 1 },
      { row: c.row, col: c.col + 1 },
    ];
    for (const n of neighbours) {
      if (n.row < 0 || n.row >= rows) continue;
      const cols = work[n.row].length;
      if (n.col < 0 || n.col >= cols) continue;
      if (original[n.row][n.col] !== bombValue) continue;
      const key = `${n.row},${n.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}

/** The cells of the CROSS centred on (r,c): up to `radius` cells each way along the row + column. */
function crossCells(grid: Grid, r: number, c: number, radius: number): Cell[] {
  const rows = grid.length;
  const out: Cell[] = [];
  for (let d = 1; d <= radius; d += 1) {
    const up = r - d, down = r + d, left = c - d, right = c + d;
    if (up >= 0) out.push({ row: up, col: c });
    if (down < rows) out.push({ row: down, col: c });
    const colsAtR = grid[r]?.length ?? 0;
    if (left >= 0) out.push({ row: r, col: left });
    if (right < colsAtR) out.push({ row: r, col: right });
  }
  return out;
}

/**
 * The SameGame score curve for a cleared group of `n` cells: n*(n-1) (a declared default
 * — bigger groups pay disproportionately more, the genre's core incentive).
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
 * Column-shift: drop any column that is now fully EMPTY, the remaining columns shifting
 * LEFT to fill it. Returns the compacted grid + whether anything moved.
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
