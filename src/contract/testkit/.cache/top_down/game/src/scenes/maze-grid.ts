/**
 * maze-grid.ts — the shared TILE-MAZE geometry helper (KEEP — engine seam, M5).
 *
 * ONE source of truth for cell<->world conversion + wall occupancy, imported by
 * BOTH the scene (DataTopDownScene maze expansion) and the maze ghosts
 * (GhostTarget's grid pathing). It is built once from MazeGridData and published
 * on the scene as `scene.__maze` so every maze entity reads the SAME geometry —
 * no two copies to drift (capability-registry-harness "one module per shared
 * fact"). It carries NO game/theme — it is pure geometry over a string grid.
 *
 * Cell (col,row) center in world px:
 *   x = originX + col*tileSize + tileSize/2
 *   y = originY + row*tileSize + tileSize/2
 * A cell is WALKABLE iff it is in-bounds and its legend char is not '#'.
 */
import type { MazeGridData } from './topdown-data';

/** A grid cell coordinate. */
export interface Cell {
  col: number;
  row: number;
}

/** The four cardinal directions (no diagonals in a maze). */
export const DIRS: { name: string; dc: number; dr: number }[] = [
  { name: 'up', dc: 0, dr: -1 },
  { name: 'down', dc: 0, dr: 1 },
  { name: 'left', dc: -1, dr: 0 },
  { name: 'right', dc: 1, dr: 0 },
];

/** The opposite of a cardinal direction (for the no-reverse turn rule). */
export const OPPOSITE: Record<string, string> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export class MazeGrid {
  readonly tileSize: number;
  readonly originX: number;
  readonly originY: number;
  readonly rows: number;
  readonly cols: number;
  /** rows of cells; true = WALL (blocked), false = walkable corridor. */
  private readonly wall: boolean[][];
  /** The raw legend grid (padded to a rectangle). */
  readonly raw: string[];

  constructor(data: MazeGridData) {
    this.tileSize = data.tileSize;
    this.originX = data.originX ?? 0;
    this.originY = data.originY ?? 0;
    this.rows = data.grid.length;
    this.cols = data.grid.reduce((m, r) => Math.max(m, r.length), 0);
    this.raw = data.grid.map((r) => r.padEnd(this.cols, ' '));
    this.wall = this.raw.map((line) =>
      Array.from({ length: this.cols }, (_, c) => line[c] === '#'),
    );
  }

  /** Center world coord of a cell. */
  cellCenter(col: number, row: number): { x: number; y: number } {
    return {
      x: this.originX + col * this.tileSize + this.tileSize / 2,
      y: this.originY + row * this.tileSize + this.tileSize / 2,
    };
  }

  /** The cell a world coord falls in. */
  worldToCell(x: number, y: number): Cell {
    return {
      col: Math.floor((x - this.originX) / this.tileSize),
      row: Math.floor((y - this.originY) / this.tileSize),
    };
  }

  /** In-bounds check. */
  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  /** A cell is walkable iff in-bounds and not a wall. */
  isWalkable(col: number, row: number): boolean {
    return this.inBounds(col, row) && !this.wall[row][col];
  }

  /** True iff the cell is a wall (out-of-bounds counts as a wall). */
  isWall(col: number, row: number): boolean {
    return !this.inBounds(col, row) || this.wall[row][col];
  }

  /**
   * The legal NON-reverse directions out of (col,row), given the direction the
   * mover ARRIVED from (so it never doubles back) — the greedy-local turn set.
   * `from` may be undefined (start) → every walkable neighbour is legal.
   */
  legalDirs(col: number, row: number, from?: string): typeof DIRS {
    return DIRS.filter((d) => {
      if (from && d.name === OPPOSITE[from]) return false; // no reverse
      return this.isWalkable(col + d.dc, row + d.dr);
    });
  }

  /** The four grid CORNERS as scatter fallbacks (TL, TR, BL, BR cells). */
  defaultCorners(): Cell[] {
    return [
      { col: 0, row: 0 },
      { col: this.cols - 1, row: 0 },
      { col: 0, row: this.rows - 1 },
      { col: this.cols - 1, row: this.rows - 1 },
    ];
  }
}
