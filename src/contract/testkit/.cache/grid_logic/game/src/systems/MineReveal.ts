/**
 * MineReveal — the Minesweeper-family deduction-grid system (kind=system).
 *
 * The deduction-grid heart: a hidden mine field laid over the board, revealed one
 * cell at a time with a first-click-safe guarantee and an iterative BFS flood-fill,
 * plus a flag toggle. It is the grid_logic analogue of MergeSlideGoal — a scene-level
 * IGridSystem the blueprint binds BY ID and tunes with PARAMS — but for the DEDUCTION
 * genre (Minesweeper) rather than merge-slide (2048).
 *
 * THE MECHANIC (real logic, re-derived from the system's OWN cell state):
 *   - first-click-safe placement: mines are laid LAZILY on the first reveal, never
 *     on the clicked cell NOR its 8 neighbors, so the opening click always opens a
 *     pocket (INV — first click is never a mine);
 *   - neighbor-count: each safe cell stores its count of adjacent mines (0..8);
 *   - iterative BFS flood-fill: revealing a 0-count cell expands a queue over its
 *     unrevealed, unflagged orthogonal+diagonal neighbours, stopping at numbered
 *     cells (the classic auto-open). Iterative (a queue), never recursive, so a large
 *     empty region cannot blow the stack;
 *   - flag toggle: a flag marks/unmarks a hidden cell and BLOCKS reveal of it;
 *   - lose: revealing a mine ends the run (scene.lose()).
 *
 * THE SEAM: the player acts on a CELL — revealAt(row,col) / toggleFlagAt(row,col) —
 * which the scene's input layer calls at the board cursor (PUBLIC so a headless
 * harness can drive a reveal/flag directly, exactly as applyMove is the driveable
 * move seam). This system owns its mine/reveal/flag grids; it does not touch the
 * merge-slide rule. The board cursor's gridX/gridY (the observed "player") still
 * tracks the engine cursor, so the controllable observable is unaffected.
 *
 * Observables (its OWN real counters, published on the pull channel):
 *   __GAME__.revealedCount — safe cells revealed so far (INCREASES on a reveal/flood);
 *   __GAME__.flagCount     — flags currently placed (TOGGLES on flag/unflag).
 *
 * Params (all OPTIONAL — sensible declared defaults, never a fabricated game number):
 *   mineCount  number of mines to lay (default 10, the classic beginner field).
 *   rows/cols  field dimensions (default: the scene's board geometry).
 *
 * GENERIC: no game/theme is encoded — a TYPE bound by id. The mine count is a
 * declared default a blueprint overrides via params, never a hard-coded per-game value.
 */
import type { IGridSystem } from '../scenes/grid-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (globbed by registry/discover.mjs — mirrors MergeSlideGoal). */
export const CAPABILITY = {
  kind: 'system',
  id: 'MineReveal',
  intent:
    'Deduction-grid (Minesweeper) system: first-click-safe lazy mine placement, neighbor-count, iterative BFS flood-fill reveal, and a flag toggle; lose on revealing a mine. Reveal/flag act on a board cell; counts published as __GAME__.revealedCount / __GAME__.flagCount.',
  attachesTo: 'scene',
  params: ['mineCount', 'rows', 'cols'],
  roles: ['board'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** Default field knobs (DECLARED defaults — the classic beginner field, never per-game). */
const DEFAULT_MINE_COUNT = 10;

export interface MineRevealConfig {
  /** Number of mines to lay (default 10). */
  mineCount?: number;
  /** Field rows (default: the scene board's row count). */
  rows?: number;
  /** Field cols (default: the scene board's col count). */
  cols?: number;
}

export class MineReveal implements IGridSystem {
  private scene: any;
  private readonly cfgMineCount: number;
  private readonly cfgRows?: number;
  private readonly cfgCols?: number;

  private rows = 0;
  private cols = 0;
  /** True once mines are laid (lazy, on the first reveal — first-click-safe). */
  private placed = false;
  /** mine[r][c] — a mine occupies this cell. */
  private mine: boolean[][] = [];
  /** adj[r][c] — count of adjacent mines (0..8), valid after placement. */
  private adj: number[][] = [];
  /** revealed[r][c] — this safe cell is open. */
  private revealed: boolean[][] = [];
  /** flagged[r][c] — this hidden cell is flagged (blocks reveal). */
  private flagged: boolean[][] = [];

  /** OWN observable counters (read by surface().observables thunks). */
  public revealedCount = 0;
  public flagCount = 0;

  /** The shared event bus, resolved from the attached scene. Publish via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  constructor(params: MineRevealConfig = {}) {
    this.cfgMineCount =
      typeof params.mineCount === 'number' && params.mineCount > 0
        ? Math.floor(params.mineCount)
        : DEFAULT_MINE_COUNT;
    this.cfgRows = typeof params.rows === 'number' ? Math.floor(params.rows) : undefined;
    this.cfgCols = typeof params.cols === 'number' ? Math.floor(params.cols) : undefined;
  }

  /** Re-arm to a fresh-field state (the scene calls reset() before attach on a RESTART). */
  reset(): void {
    this.placed = false;
    this.mine = [];
    this.adj = [];
    this.revealed = [];
    this.flagged = [];
    this.revealedCount = 0;
    this.flagCount = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    // Field geometry: params override, else the live board's dimensions, else 4x4.
    this.rows = this.cfgRows ?? scene.board?.rows ?? 0;
    this.cols = this.cfgCols ?? scene.board?.cols ?? 0;
    if (this.rows <= 0) this.rows = 4;
    if (this.cols <= 0) this.cols = 4;
    this.allocGrids();

    // Own the deduction input loop (MineReveal does NOT use the merge-slide keydown
    // move loop — you CLICK a cell). A primary click reveals; a right-click (or a
    // modifier-click) flags. Mirrors TurnDuel's pointerdown ownership; the
    // headless-driveable seams are revealAt() / toggleFlagAt() which this calls.
    scene.input?.on?.('pointerdown', (pointer: any) => {
      const cell = this.worldToCell(
        pointer?.worldX ?? pointer?.x ?? 0,
        pointer?.worldY ?? pointer?.y ?? 0,
      );
      if (!cell) return;
      const flag = pointer?.rightButtonDown?.() === true || pointer?.event?.shiftKey === true;
      if (flag) this.toggleFlagAt(cell.row, cell.col);
      else this.revealAt(cell.row, cell.col);
    });
  }

  // ── the player seam (PUBLIC — a headless harness drives these directly) ──────

  /**
   * Reveal a cell (the core moment). Lays mines first-click-safe on the very first
   * reveal, then: a flagged/already-open cell is a no-op; a mine loses; a safe cell
   * is opened and — when its adjacent count is 0 — flood-fills its neighbours.
   * Emits 'cell.revealed' with the count of cells opened (>=1) at the true seam.
   */
  public revealAt(row: number, col: number): void {
    if (!this.inBounds(row, col) || this.scene?.gameCompleted) return;
    if (this.revealed[row][col] || this.flagged[row][col]) return;

    // First-click-safe: lay the field now, excluding the clicked cell + its neighbours.
    if (!this.placed) this.placeMines(row, col);

    if (this.mine[row][col]) {
      // Revealing a mine ends the run.
      this.revealed[row][col] = true;
      this.bus?.emit('cell.revealed', {
        row,
        col,
        opened: 1,
        revealed: this.revealedCount,
        mine: true,
      });
      this.scene?.lose?.();
      return;
    }

    const opened = this.floodReveal(row, col);
    this.revealedCount += opened;
    this.bus?.emit('cell.revealed', {
      row,
      col,
      opened,
      revealed: this.revealedCount,
      mine: false,
    });
  }

  /**
   * Toggle a flag on a hidden cell (already-revealed cells cannot be flagged).
   * Emits 'mine.flagged' with the new flag state + the live flag count.
   */
  public toggleFlagAt(row: number, col: number): void {
    if (!this.inBounds(row, col) || this.scene?.gameCompleted) return;
    if (this.revealed[row][col]) return;
    const next = !this.flagged[row][col];
    this.flagged[row][col] = next;
    this.flagCount += next ? 1 : -1;
    if (this.flagCount < 0) this.flagCount = 0;
    this.bus?.emit('mine.flagged', {
      row,
      col,
      flagged: next,
      flags: this.flagCount,
    });
  }

  // ── core mechanic internals ──────────────────────────────────────────────────

  /** Iterative BFS flood-fill: open `start`, and auto-open the region of 0-count
   *  cells (stopping at numbered cells). Returns the number of cells newly opened. */
  private floodReveal(startRow: number, startCol: number): number {
    let opened = 0;
    const queue: Array<[number, number]> = [[startRow, startCol]];
    while (queue.length > 0) {
      const [r, c] = queue.shift()!;
      if (!this.inBounds(r, c)) continue;
      if (this.revealed[r][c] || this.flagged[r][c] || this.mine[r][c]) continue;
      this.revealed[r][c] = true;
      opened += 1;
      // A 0-count cell auto-opens its 8 neighbours (the classic flood).
      if (this.adj[r][c] === 0) {
        for (const [nr, nc] of this.neighbours(r, c)) {
          if (this.inBounds(nr, nc) && !this.revealed[nr][nc] && !this.flagged[nr][nc]) {
            queue.push([nr, nc]);
          }
        }
      }
    }
    return opened;
  }

  /** Lay `mineCount` mines, NEVER on the safe cell nor its 8 neighbours (first-click-safe),
   *  then compute every cell's adjacent-mine count. */
  private placeMines(safeRow: number, safeCol: number): void {
    this.placed = true;
    const forbidden = new Set<number>();
    forbidden.add(safeRow * this.cols + safeCol);
    for (const [nr, nc] of this.neighbours(safeRow, safeCol)) {
      if (this.inBounds(nr, nc)) forbidden.add(nr * this.cols + nc);
    }

    // Candidate cells (every cell not forbidden), Fisher-Yates shuffled, then the
    // first `mineCount` become mines (uniform random placement over the safe field).
    const candidates: number[] = [];
    for (let i = 0; i < this.rows * this.cols; i += 1) {
      if (!forbidden.has(i)) candidates.push(i);
    }
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const want = Math.min(this.cfgMineCount, candidates.length);
    for (let i = 0; i < want; i += 1) {
      const idx = candidates[i];
      this.mine[Math.floor(idx / this.cols)][idx % this.cols] = true;
    }

    // Neighbour counts.
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        if (this.mine[r][c]) continue;
        let n = 0;
        for (const [nr, nc] of this.neighbours(r, c)) {
          if (this.inBounds(nr, nc) && this.mine[nr][nc]) n += 1;
        }
        this.adj[r][c] = n;
      }
    }
  }

  private allocGrids(): void {
    const blank = <T,>(fill: T): T[][] =>
      Array.from({ length: this.rows }, () => new Array(this.cols).fill(fill));
    this.mine = blank(false);
    this.adj = blank(0);
    this.revealed = blank(false);
    this.flagged = blank(false);
  }

  private inBounds(r: number, c: number): boolean {
    return r >= 0 && c >= 0 && r < this.rows && c < this.cols;
  }

  /** The 8 surrounding cells (orthogonal + diagonal). */
  private neighbours(r: number, c: number): Array<[number, number]> {
    return [
      [r - 1, c - 1], [r - 1, c], [r - 1, c + 1],
      [r, c - 1], [r, c + 1],
      [r + 1, c - 1], [r + 1, c], [r + 1, c + 1],
    ];
  }

  /**
   * Map a world point to a board cell via the scene's ONE gridMap adapter (INV-6;
   * `toGrid(x,y)` returns null for a pixel outside the board). Mirrors TurnDuel.
   */
  private worldToCell(worldX: number, worldY: number): { row: number; col: number } | null {
    const map = this.scene?.gridMap;
    if (!map?.toGrid) return null;
    const cell = map.toGrid(worldX, worldY);
    if (!cell) return null;
    return { row: cell.row, col: cell.col };
  }

  // ── component surface (the declared event + observable set) ────────────────────

  surface(): ComponentSurface {
    return {
      observables: {
        revealedCount: () => this.revealedCount,
        flagCount: () => this.flagCount,
      },
      anchors: [],
      events: [
        {
          name: 'cell.revealed',
          payload: '{row,col,opened,revealed,mine}',
          scope: 'archetype',
          drivenBy: 'player reveals a safe cell',
          expect: '__GAME__ revealed count increases (flood-fill expands); cell.revealed logged',
        },
        {
          name: 'mine.flagged',
          payload: '{row,col,flagged,flags}',
          scope: 'archetype',
          drivenBy: 'player flags a cell',
          expect: '__GAME__ flag count toggles; mine.flagged logged',
        },
      ],
    };
  }
}
