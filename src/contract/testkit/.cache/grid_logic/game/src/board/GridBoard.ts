/**
 * ============================================================================
 * GridBoard — the LOGICAL board state (KEEP — engine, the single source of truth)
 * ============================================================================
 *
 * The research brief's load-bearing decision (the "two worlds" rule): the board
 * is LOGICAL STATE — a `cell[row][col]` integer array — entirely separate from the
 * rendered sprites. Every engine invariant is asserted on THIS array (no renderer
 * needed), which is exactly what makes the archetype headlessly testable and what
 * the verify harness reads.
 *
 * A cell holds a non-negative integer VALUE: 0 = empty; >0 = a tile of that value
 * (for merge-slide, the powers of two). The board is genre-agnostic — match-3
 * stores gem ids, falling-block stores piece ids; the move RESOLVER interprets the
 * values, the board just stores + clones them.
 *
 * IMMUTABLE-FRIENDLY: the resolver never mutates a board in place (the StackOverflow
 * 2048 answer's #1 fix). It reads the current board, computes a NEW grid, and the
 * scene swaps it in. `clone()` + `setGrid()` give the pure-function discipline.
 *
 * GENERIC: no game/theme, no win-target, no spawn rule lives here — those are the
 * resolver's / the level data's concern. The board owns ONLY grid storage, bounds,
 * occupancy, and equality.
 */

/** A logical grid: rows of cell values (0 = empty). */
export type Grid = number[][];

export class GridBoard {
  readonly rows: number;
  readonly cols: number;
  /** rows x cols of cell values; 0 = empty. The single source of truth. */
  private grid: Grid;

  constructor(rows: number, cols: number, initial?: Grid) {
    this.rows = Math.max(1, Math.floor(rows));
    this.cols = Math.max(1, Math.floor(cols));
    this.grid = initial
      ? GridBoard.cloneGrid(initial)
      : GridBoard.emptyGrid(this.rows, this.cols);
  }

  /** A fresh rows x cols grid of zeros. */
  static emptyGrid(rows: number, cols: number): Grid {
    return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  }

  /** A deep copy of a grid (no shared row references — pure-function safe). */
  static cloneGrid(g: Grid): Grid {
    return g.map((row) => row.slice());
  }

  /** True iff two grids are cell-for-cell equal (the resolver's `changed` test). */
  static gridsEqual(a: Grid, b: Grid): boolean {
    if (a.length !== b.length) return false;
    for (let r = 0; r < a.length; r += 1) {
      const ra = a[r];
      const rb = b[r];
      if (ra.length !== rb.length) return false;
      for (let c = 0; c < ra.length; c += 1) if (ra[c] !== rb[c]) return false;
    }
    return true;
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /** True iff (row,col) is a real cell. INV-6 bounds guard. */
  inBounds(row: number, col: number): boolean {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  /** The value at (row,col); 0 (empty) when out of bounds (defensive). */
  get(row: number, col: number): number {
    return this.inBounds(row, col) ? this.grid[row][col] : 0;
  }

  /** True iff the cell is empty (value 0). */
  isEmpty(row: number, col: number): boolean {
    return this.get(row, col) === 0;
  }

  /** Every empty cell coordinate (used by spawn — only-on-empty, INV-3). */
  emptyCells(): { row: number; col: number }[] {
    const out: { row: number; col: number }[] = [];
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        if (this.grid[r][c] === 0) out.push({ row: r, col: c });
      }
    }
    return out;
  }

  /** The single highest tile value on the board (drives the win check, INV-4). */
  maxValue(): number {
    let m = 0;
    for (const row of this.grid) for (const v of row) if (v > m) m = v;
    return m;
  }

  /** A deep copy of the raw grid (read-only view for the renderer / the hook). */
  snapshot(): Grid {
    return GridBoard.cloneGrid(this.grid);
  }

  /** A clone of this board (pure-function discipline — never mutate in place). */
  clone(): GridBoard {
    return new GridBoard(this.rows, this.cols, this.grid);
  }

  // ── writes (the scene swaps a resolved grid in; spawn places a tile) ─────────

  /** Set a single cell (spawn / setup). Out-of-bounds is a no-op. */
  set(row: number, col: number, value: number): void {
    if (this.inBounds(row, col)) this.grid[row][col] = value;
  }

  /** Replace the whole grid (the scene applies a resolved move's new grid). */
  setGrid(g: Grid): void {
    this.grid = GridBoard.cloneGrid(g);
  }

  /** Clear to all-empty (a fresh level / restart). */
  reset(): void {
    this.grid = GridBoard.emptyGrid(this.rows, this.cols);
  }
}
