import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import { DIRS, OPPOSITE, type MazeGrid, type Cell } from '../scenes/maze-grid';

/**
 * GhostTarget — the ONE param-driven maze-ghost brain (BUILD — behavior, M5;
 * RB §2.3 / the Pac-Man Dossier). A SINGLE class whose `params.selector`
 * (blinky | pinky | inky | clyde) picks the per-ghost TARGET-TILE rule — NOT four
 * hard-coded classes. Composed ON a maze hunter the same way ChaseAI is; it OWNS
 * that ghost's movement (grid-snapped, 4-direction) by driving the owner's
 * velocity cell-to-cell.
 *
 * Per-ghost target tile (the personality — the targets DIFFER, the movement rule
 * is shared):
 *   blinky : the player's EXACT tile.
 *   pinky  : 4 tiles AHEAD of the player's facing.
 *   inky   : take the tile 2 ahead of the player, draw the vector from blinky to
 *            it and DOUBLE its length (needs the blinky ghost's tile).
 *   clyde  : chase like blinky when >8 tiles away; flee to its own scatter corner
 *            when <=8 tiles away.
 * SCATTER mode: every ghost targets its scatter corner (the four maze corners).
 * FRIGHTENED mode: NO targeting — a PRNG picks the legal non-reverse turn.
 *
 * The MOVEMENT rule is GREEDY-LOCAL (RB §2.3 — NOT A*): when the ghost reaches a
 * cell center it picks, among the legal NON-reverse directions, the one MINIMIZING
 * straight-line distance from the NEXT cell to the target tile, then drives at
 * `speed` along it until the next center. On the GhostModeController's reverse
 * epoch it flips direction at the next opportunity (the genre signature).
 *
 * Reads (generic, by name — no per-game wiring): scene.__maze (the MazeGrid),
 * scene.__ghostMode, scene.__ghostReverseEpoch, scene.player (the prey),
 * scene.__blinky (the blinky owner — inky's reference; set by the loader for slot
 * 0). Every number is a PARAM. No game/theme, no baked coordinate.
 *
 * Usage (bound from the maze data — one entry, selector picks the ghost):
 *   threats[].behaviors = [{ ref: 'GhostTarget', params: { selector: 'pinky', speed: 80 } }]
 */
export type GhostSelector = 'blinky' | 'pinky' | 'inky' | 'clyde';

export interface GhostTargetConfig {
  /** Which ghost's target rule this instance uses (blinky|pinky|inky|clyde). */
  selector?: GhostSelector;
  /** Move speed in px/s along a corridor (default 80). */
  speed?: number;
  /** Pinky's look-ahead distance in tiles (default 4 — the canonical value). */
  pinkyAhead?: number;
  /** Inky's player-ahead distance in tiles (default 2). */
  inkyAhead?: number;
  /** Clyde's flip threshold in tiles (>thresh chase, <=thresh flee; default 8). */
  clydeThreshold?: number;
  /**
   * This ghost's SCATTER corner cell {col,row}. OPTIONAL — absent → derived from
   * the maze's default corners by the slot (set by the loader). Generic: a cell.
   */
  scatterCorner?: Cell;
}

export class GhostTarget extends BaseBehavior {
  public selector: GhostSelector;
  public speed: number;
  private readonly pinkyAhead: number;
  private readonly inkyAhead: number;
  private readonly clydeThreshold: number;
  public scatterCorner?: Cell;

  /** The current travel direction name ('up'|'down'|'left'|'right') or null at spawn. */
  private dir: string | null = null;
  /** The cell the ghost is heading INTO (its center is the next decision point). */
  private targetCell: Cell | null = null;
  /** The reverse epoch this ghost last honored (so it reverses exactly once each). */
  private lastReverseEpoch = 0;
  /** Diagnostics: the last computed target tile (read by the verify harness). */
  public lastTargetTile: Cell | null = null;

  constructor(config: GhostTargetConfig = {}) {
    super();
    this.selector = config.selector ?? 'blinky';
    this.speed = config.speed ?? 80;
    this.pinkyAhead = config.pinkyAhead ?? 4;
    this.inkyAhead = config.inkyAhead ?? 2;
    this.clydeThreshold = config.clydeThreshold ?? 8;
    this.scatterCorner = config.scatterCorner;
  }

  update(): void {
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    const body = owner.body as Phaser.Physics.Arcade.Body | undefined;
    const scene = owner.scene as any;
    if (!body || !scene) return;
    const maze: MazeGrid | undefined = scene.__maze;
    if (!maze) return; // not a maze level — inert (generic safety)

    // Honor a pending direction REVERSE from the mode controller (once per epoch).
    const epoch = Number(scene.__ghostReverseEpoch ?? 0);
    if (epoch > this.lastReverseEpoch) {
      this.lastReverseEpoch = epoch;
      if (this.dir) {
        this.dir = OPPOSITE[this.dir];
        this.targetCell = null; // re-decide from the new heading at the next center
      }
    }

    // Snap-on-arrival: when we reach (or pass) the target cell's center, re-decide.
    const here = maze.worldToCell(owner.x, owner.y);
    const reachedCenter =
      !this.targetCell || this.atCellCenter(maze, here, owner.x, owner.y);

    if (reachedCenter) {
      // Re-anchor to the cell center we arrived at (kills lane drift).
      const c = maze.cellCenter(here.col, here.row);
      owner.x = c.x;
      owner.y = c.y;
      this.chooseDirection(maze, here, scene);
    }

    // Drive at `speed` along the current direction.
    this.applyVelocity(body);
  }

  /** Choose the next direction at the cell center (greedy-local or frightened PRNG). */
  private chooseDirection(maze: MazeGrid, here: Cell, scene: any): void {
    const legal = maze.legalDirs(here.col, here.row, this.dir ?? undefined);
    if (legal.length === 0) {
      // Dead end (only the reverse is open) — allow the reverse so it can leave.
      const back = this.dir
        ? DIRS.filter((d) => maze.isWalkable(here.col + d.dc, here.row + d.dr))
        : [];
      this.setHeading(maze, here, back[0]?.name ?? null);
      return;
    }

    const mode: string = scene.__ghostMode ?? 'scatter';
    if (mode === 'frightened') {
      // No targeting — a PRNG picks the legal non-reverse turn.
      const pick = legal[Math.floor(Math.random() * legal.length)];
      this.setHeading(maze, here, pick.name);
      return;
    }

    // Greedy-local: minimize straight-line distance from the NEXT cell to target.
    const target = this.computeTargetTile(maze, here, scene, mode);
    this.lastTargetTile = target;
    let best = legal[0];
    let bestD = Infinity;
    for (const d of legal) {
      const nc = here.col + d.dc;
      const nr = here.row + d.dr;
      const dist = (nc - target.col) ** 2 + (nr - target.row) ** 2;
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    this.setHeading(maze, here, best.name);
  }

  /**
   * The per-ghost target TILE (the personality). PUBLIC + pure so the verify
   * harness can compute all four at the same player state and prove they differ.
   */
  public computeTargetTile(
    maze: MazeGrid,
    here: Cell,
    scene: any,
    mode: string,
  ): Cell {
    if (mode === 'scatter') return this.scatterTarget(maze);

    const player = scene.player;
    if (!player) return this.scatterTarget(maze);
    const pCell = maze.worldToCell(player.x, player.y);
    const facing = this.facingVec(player);

    switch (this.selector) {
      case 'blinky':
        return pCell;
      case 'pinky':
        return {
          col: pCell.col + facing.dc * this.pinkyAhead,
          row: pCell.row + facing.dr * this.pinkyAhead,
        };
      case 'inky': {
        // The tile inkyAhead in front of the player, vector from blinky doubled.
        const ahead = {
          col: pCell.col + facing.dc * this.inkyAhead,
          row: pCell.row + facing.dr * this.inkyAhead,
        };
        const blinky = scene.__blinky;
        const bCell = blinky
          ? maze.worldToCell(blinky.x, blinky.y)
          : pCell; // no blinky yet → degrade to the ahead tile
        return {
          col: ahead.col + (ahead.col - bCell.col),
          row: ahead.row + (ahead.row - bCell.row),
        };
      }
      case 'clyde': {
        const dCol = here.col - pCell.col;
        const dRow = here.row - pCell.row;
        const distTiles = Math.sqrt(dCol * dCol + dRow * dRow);
        return distTiles > this.clydeThreshold ? pCell : this.scatterTarget(maze);
      }
      default:
        return pCell;
    }
  }

  /** This ghost's scatter-corner cell (param, else the maze default by selector). */
  private scatterTarget(maze: MazeGrid): Cell {
    if (this.scatterCorner) return this.scatterCorner;
    const corners = maze.defaultCorners();
    const idx = { blinky: 1, pinky: 0, inky: 3, clyde: 2 }[this.selector] ?? 0;
    return corners[idx] ?? corners[0];
  }

  /** The player's facing as a cardinal cell vector (from the move/facing dir). */
  private facingVec(player: any): { dc: number; dr: number } {
    const f =
      player.movement?.movementDirection ??
      player.faceTarget?.facingDirection ??
      player.facingDirection ??
      'left';
    switch (f) {
      case 'up':
        return { dc: 0, dr: -1 };
      case 'down':
        return { dc: 0, dr: 1 };
      case 'right':
        return { dc: 1, dr: 0 };
      case 'left':
      default:
        return { dc: -1, dr: 0 };
    }
  }

  /** Commit a heading + the cell it moves into (null = stay put). */
  private setHeading(maze: MazeGrid, here: Cell, name: string | null): void {
    this.dir = name;
    if (!name) {
      this.targetCell = null;
      return;
    }
    const d = DIRS.find((x) => x.name === name)!;
    this.targetCell = { col: here.col + d.dc, row: here.row + d.dr };
    // expose facing for diagnostics / animation
    (this.getOwner() as any).facingDirection = name;
  }

  /** Apply velocity along the current direction at `speed` (0 when idle). */
  private applyVelocity(body: Phaser.Physics.Arcade.Body): void {
    let vx = 0;
    let vy = 0;
    switch (this.dir) {
      case 'up':
        vy = -this.speed;
        break;
      case 'down':
        vy = this.speed;
        break;
      case 'left':
        vx = -this.speed;
        break;
      case 'right':
        vx = this.speed;
        break;
    }
    body.velocity.x = vx;
    body.velocity.y = vy;
  }

  /** True once the owner has reached/passed the center of `cell`. */
  private atCellCenter(
    maze: MazeGrid,
    here: Cell,
    x: number,
    y: number,
  ): boolean {
    if (!this.targetCell) return true;
    // Decide at the center of the cell we are now IN, once we've entered the
    // target cell (here == targetCell) and crossed close to its center.
    if (here.col !== this.targetCell.col || here.row !== this.targetCell.row) {
      return false;
    }
    const c = maze.cellCenter(here.col, here.row);
    const tol = Math.max(2, this.speed * (1 / 60)); // one frame's travel
    return Math.abs(x - c.x) <= tol && Math.abs(y - c.y) <= tol;
  }
}
