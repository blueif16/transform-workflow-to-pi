/**
 * ============================================================================
 * grid-map.ts — the ONE cell<->pixel mapping adapter (KEEP — engine seam)
 * ============================================================================
 *
 * THE single home for the grid-cell <-> world-pixel transform (research brief
 * INV-6: "grid-cell <-> pixel mapping consistent in ONE place, no off-by-one at
 * the bounds"). EVERY cell coordinate the engine turns into a sprite position,
 * and every pointer pixel it turns back into a cell, goes through this adapter —
 * never a scattered `row * cellSize` literal that drifts between render and input.
 *
 * Parameterised by ORIGIN (the board's top-left world pixel) + a uniform CELL
 * SIZE. The classic bug it forecloses: a click near the right/bottom edge
 * resolving to the wrong cell, or sprites half a cell off at the boundary
 * (off-by-one from origin / inclusive-bound confusion). The round-trip invariant
 * `toGrid(toWorld(r,c)) === {r,c}` holds for every in-bounds cell.
 *
 * GENERIC: no game/theme is encoded — pure geometry over (origin, cellSize, rows,
 * cols). The same adapter serves merge-slide, match-3, falling-block, etc.
 */

/** A logical board cell coordinate (row, col). */
export interface GridCoord {
  row: number;
  col: number;
}

/** A world-pixel point. */
export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * The cell<->pixel transform for ONE board. Construct once from the level's
 * grid geometry; pass it to the renderer AND the input layer so they can never
 * disagree on where a cell is.
 */
export class GridMap {
  /** Number of rows (vertical cell count). */
  readonly rows: number;
  /** Number of columns (horizontal cell count). */
  readonly cols: number;
  /** Uniform cell edge length in world px (square cells). */
  readonly cellSize: number;
  /** World x of the board's TOP-LEFT corner. */
  readonly originX: number;
  /** World y of the board's TOP-LEFT corner. */
  readonly originY: number;

  constructor(opts: {
    rows: number;
    cols: number;
    cellSize: number;
    originX?: number;
    originY?: number;
  }) {
    this.rows = Math.max(1, Math.floor(opts.rows));
    this.cols = Math.max(1, Math.floor(opts.cols));
    this.cellSize = opts.cellSize;
    this.originX = opts.originX ?? 0;
    this.originY = opts.originY ?? 0;
  }

  /** Total board width / height in world px (the rendered board's footprint). */
  get widthPx(): number {
    return this.cols * this.cellSize;
  }
  get heightPx(): number {
    return this.rows * this.cellSize;
  }

  /** True iff (row,col) is a real cell on this board. */
  inBounds(row: number, col: number): boolean {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  /**
   * Cell (row,col) -> the world-pixel CENTER of that cell. The single mapping
   * the renderer uses to place a tile sprite. Adding +cellSize/2 centers within
   * the cell (so a tile sprite sits in the middle of its square, not its corner).
   */
  toWorld(row: number, col: number): WorldPoint {
    return {
      x: this.originX + col * this.cellSize + this.cellSize / 2,
      y: this.originY + row * this.cellSize + this.cellSize / 2,
    };
  }

  /**
   * World pixel (x,y) -> the cell (row,col) it falls in, or null when the pixel
   * is OUTSIDE the board (the off-by-one guard: a pixel just past the right/
   * bottom edge maps to out-of-bounds, never to the edge cell). The exact inverse
   * of toWorld for every in-bounds cell.
   */
  toGrid(x: number, y: number): GridCoord | null {
    const col = Math.floor((x - this.originX) / this.cellSize);
    const row = Math.floor((y - this.originY) / this.cellSize);
    return this.inBounds(row, col) ? { row, col } : null;
  }
}
