import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import type { ComponentSurface } from '@contract/component-surface';
import type { MazeGrid, Cell } from '../scenes/maze-grid';

/**
 * CAPABILITY — self-describing registry sidecar (capability-registry-harness).
 * Globbed by registry/build-registry.mjs; bound by the blueprint via `id`.
 * EDIT THIS, not capabilities.json.
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'PushBlock',
  intent:
    'The pushable block (Sokoban / ALttP "shove this block"): a block entity carrying this behavior is shoved EXACTLY one cell in the player\'s facing direction when the player walks into its cell — UNLESS the target cell is solid (a maze wall or another block), in which case both stay put. The block\'s own response to being walked into, per-entity.',
  roles: ['obstacle'],
  params: ['cellSize'],
} as const;

export const BEHAVIOR_CAPABILITIES = [CAPABILITY] as const;

/**
 * PushBlock configuration.
 */
export interface PushBlockConfig {
  /**
   * Cell size in pixels — the size of ONE push step (default 64 = one tile).
   * If the scene publishes a maze (`scene.__maze.tileSize`), THAT wins so a maze
   * level and this behavior never drift; otherwise this default is used.
   */
  cellSize?: number;
}

/** The four cardinal push directions (a block is shoved one cardinal cell). */
export type PushDir = 'up' | 'down' | 'left' | 'right';

const DIR_VEC: Record<PushDir, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
};

/**
 * PushBlock — the PUSHABLE BLOCK behavior (KEEP — per-entity obstacle response).
 *
 * Attaches to a BLOCK entity (a crate in `scene.obstacles`, role 'obstacle'). It is
 * the block's OWN response to being walked into: each frame it checks whether the
 * player has stepped onto the block's grid cell, and if so SHOVES the block one cell
 * in the player's facing direction — the GMTK "push this block" / metazelda-crate
 * mechanic. The push is BLOCKED (no movement) when the target cell is solid: a maze
 * wall (`scene.__maze.isWall`) OR another block in `scene.obstacles`. A wall-blocked
 * push leaves the block (and the player behind it) exactly where they were.
 *
 * OBSERVABLE (the contract): on a successful push, the block entity's position
 * translates by one cell — `owner.x`/`owner.y` (and `owner.gridX`/`owner.gridY`, which
 * the __GAME__ hook mirrors into the entity's `entities[]` row) advance one cell in the
 * push direction, and `block.pushed` fires. When the target cell is solid NOTHING moves
 * and NO event fires.
 *
 * INPUT (the real seam — drivable headlessly): `update()` reads `scene.player` and the
 * player's facing the BasePlayer way (`movement?.movementDirection ?? facingDirection`)
 * and, when the player occupies the block's cell, calls `tryPush(dir)`. A test/FSM can
 * call `tryPush(dir)` directly to drive ONE push without a running game loop.
 *
 * Usage (composed on a crate/block entity, bound from the blueprint):
 *   const push = this.behaviors.add('push', new PushBlock({ cellSize: 64 }));
 *   // per frame: this.behaviors.update();  // detects a walk-in + shoves at most one cell
 */
export class PushBlock extends BaseBehavior {
  /** Cell size in px (one push step). Overridden by `scene.__maze.tileSize` if present. */
  public cellSize: number;

  /** Grid origin in world px (adopted from `scene.__maze` when present, else 0). */
  public originX = 0;
  public originY = 0;

  /** The block's current cell (col,row). Derived from its spawn world position on attach. */
  public gridX = 0;
  public gridY = 0;

  /** Diagnostics: the last direction this block was shoved (read by verify/animation). */
  public lastPushDir: PushDir | null = null;

  constructor(config: PushBlockConfig = {}) {
    super();
    this.cellSize = config.cellSize ?? 64;
  }

  /** On attach: adopt the maze geometry if present, then derive the block's start cell. */
  protected onAttach(): void {
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    const scene = owner.scene as any;
    // One source of truth for cell geometry: a maze level's tileSize/origin wins so the
    // push step and the maze never drift (generic, by name — inert when there is no maze).
    const maze: MazeGrid | undefined = scene?.__maze;
    if (maze) {
      this.cellSize = maze.tileSize ?? this.cellSize;
      this.originX = maze.originX ?? this.originX;
      this.originY = maze.originY ?? this.originY;
    }
    this.gridX = Math.floor((owner.x - this.originX) / this.cellSize);
    this.gridY = Math.floor((owner.y - this.originY) / this.cellSize);
  }

  /**
   * Per-frame: if the player has walked ONTO this block's cell, shove the block one cell
   * in the player's facing direction. The walk-in IS the `move` verb's effect on this
   * block — the moment the player and block share a cell, the block must yield or block.
   */
  update(): void {
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    const scene = owner.scene as any;
    const player = scene?.player;
    if (!player || player.active === false) return;

    // The player's current cell (maze geometry if present, else our own cell math).
    const pCell = this.cellOf(scene, player.x, player.y);
    // Only react when the player has stepped INTO the block's cell (walked into it).
    if (pCell.col !== this.gridX || pCell.row !== this.gridY) return;

    const dir = this.facingDir(player);
    this.tryPush(dir);
  }

  /**
   * Attempt to shove the block ONE cell in `dir`. Returns true iff it moved.
   *
   * This is the single commit point + the drivable seam: it translates the block's
   * position by one cell and emits `block.pushed` at the real gameplay seam — UNLESS the
   * target cell is solid (a wall or another block), in which case it is a no-op (no move,
   * no event), realizing the wall-blocked-leaves-both-in-place contract.
   */
  tryPush(dir: PushDir): boolean {
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    const scene = owner.scene as any;
    const { dc, dr } = DIR_VEC[dir];
    const toCol = this.gridX + dc;
    const toRow = this.gridY + dr;

    // BLOCKED: the target cell is a maze wall OR already holds another block. No push.
    if (this.isSolidCell(scene, owner, toCol, toRow)) return false;

    // Commit the one-cell translation — write BOTH the world position and the grid coords
    // so __GAME__.entities (which reads x/y and mirrors gridX/gridY) reflects the new cell.
    this.gridX = toCol;
    this.gridY = toRow;
    this.lastPushDir = dir;
    (owner as any).gridX = this.gridX;
    (owner as any).gridY = this.gridY;
    owner.x = this.originX + this.gridX * this.cellSize + this.cellSize / 2;
    owner.y = this.originY + this.gridY * this.cellSize + this.cellSize / 2;
    // Keep the physics body in lock-step with the teleport (setPosition desyncs the body).
    const body = owner.body as Phaser.Physics.Arcade.Body | undefined;
    if (body && typeof body.reset === 'function') body.reset(owner.x, owner.y);

    // block.pushed — the push moment on the scene's shared bus, at the real commit seam
    // (the block just translated one cell). Payload is lean: the block's own id + its new
    // cell. Defensive: a scene without a bus is a no-op. Declared in this component's surface().
    this.bus?.emit('block.pushed', {
      blockId: this.blockId(owner),
      toGridX: this.gridX,
      toGridY: this.gridY,
    });
    return true;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** The cell a world coord falls in (maze geometry if present, else our own math). */
  private cellOf(scene: any, x: number, y: number): Cell {
    const maze: MazeGrid | undefined = scene?.__maze;
    if (maze) return maze.worldToCell(x, y);
    return {
      col: Math.floor((x - this.originX) / this.cellSize),
      row: Math.floor((y - this.originY) / this.cellSize),
    };
  }

  /**
   * Is (col,row) solid for a push — a maze wall, or already occupied by ANOTHER block?
   * Out-of-bounds counts as solid (the maze treats OOB as a wall). When there is no maze,
   * only the other-block check applies (an open arena has no walls).
   */
  private isSolidCell(
    scene: any,
    self: Phaser.GameObjects.GameObject,
    col: number,
    row: number,
  ): boolean {
    const maze: MazeGrid | undefined = scene?.__maze;
    if (maze && maze.isWall(col, row)) return true;

    // Another block in the obstacles group occupying the target cell blocks the push.
    const obstacles: Phaser.GameObjects.Group | undefined = scene?.obstacles;
    if (obstacles && typeof obstacles.getChildren === 'function') {
      const children = obstacles.getChildren() as any[];
      for (const child of children) {
        if (!child || child === self || child.active === false) continue;
        const c = this.cellOf(scene, child.x, child.y);
        if (c.col === col && c.row === row) return true;
      }
    }
    return false;
  }

  /** The player's facing as a cardinal push direction (the BasePlayer-exposed seam). */
  private facingDir(player: any): PushDir {
    const f: string =
      player.movement?.movementDirection ??
      player.faceTarget?.facingDirection ??
      player.facingDirection ??
      'down';
    return f === 'up' || f === 'down' || f === 'left' || f === 'right'
      ? (f as PushDir)
      : 'down';
  }

  /** This block's stable id for the lean payload (the entity id __GAME__ also reports). */
  private blockId(owner: any): string {
    return owner.__id ?? owner.entityId ?? owner.name ?? 'block';
  }

  // ============================================================================
  // COMPONENT SURFACE (the events THIS behavior owns + emits)
  // ============================================================================

  /**
   * The uniform component surface for the pushable-block behavior. Declares the ONE
   * block-owned PUSH-channel moment — `block.pushed` — emitted from the real commit seam
   * in tryPush() on the scene's shared bus. Observables stay on the scene's existing
   * __GAME__ adapter (which reads the block's x/y + mirrored gridX/gridY from
   * entities[]), so this surface declares only the PUSH channel + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'block.pushed',
          payload: '{blockId,toGridX,toGridY}',
          scope: 'archetype',
          drivenBy: 'move — the player walks into the block and the target cell is free',
          expect:
            "the block entity's position translates by one cell in __GAME__.entities in the push direction; block.pushed logged (no emit when the target cell is solid)",
        },
      ],
    };
  }
}
