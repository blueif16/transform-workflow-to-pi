import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import type { ComponentSurface } from '@contract/component-surface';

/**
 * CAPABILITY — self-describing registry sidecar (capability-registry-harness).
 * Globbed by registry/build-registry.mjs; bound by the blueprint via `id`.
 * EDIT THIS, not capabilities.json.
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'HopGridMovement',
  intent:
    'Discrete one-cell grid hops on a directional press (commit-and-live-with-it): each press moves the player EXACTLY one cell and snaps to the grid — the lane-dodge / Frogger model, the opposite of continuous EightWayMovement. No sub-cell drift between hops.',
  roles: ['player'],
  params: ['cellSize', 'originX', 'originY', 'snap'],
  tuning: ['walkSpeed'],
} as const;

export const BEHAVIOR_CAPABILITIES = [CAPABILITY] as const;

/**
 * HopGridMovement configuration
 */
export interface HopGridMovementConfig {
  /**
   * Cell size in pixels — the size of ONE hop (default 64 = one tile).
   * If the scene publishes a maze (`scene.__maze.tileSize`), that wins so a maze
   * level and this behavior never drift; otherwise this default is used.
   */
  cellSize?: number;
  /** Grid origin X in world px (the world coord of cell col 0's left edge, default 0). */
  originX?: number;
  /** Grid origin Y in world px (the world coord of cell row 0's top edge, default 0). */
  originY?: number;
  /**
   * Hard-snap to the cell center on every hop (default true). When true the sprite
   * teleports to the exact cell center — guaranteeing zero sub-cell drift between
   * hops (the discrete-hop contract). false would tween, which this behavior does NOT
   * do (continuous translation is EightWayMovement's job).
   */
  snap?: boolean;
}

/**
 * HopGridMovement — DISCRETE one-cell grid hops on input (KEEP — behavior).
 *
 * The lane-dodge / Frogger movement model: each directional PRESS (key JustDown)
 * commits to exactly ONE cell in that direction and snaps the sprite to the grid —
 * "discrete hops … snapping to a grid" (dev.to Frogger). This is the OPPOSITE of
 * the continuous, velocity-driven EightWayMovement: there is NO held-key acceleration,
 * NO sub-cell position between hops, and a press is committed the instant it lands
 * (commit-and-live-with-it). Diagonal presses do nothing — a hop is one cardinal cell.
 *
 * OBSERVABLE (the contract): after a press, `owner.gridX`/`owner.gridY` advance by
 * exactly 1 in the pressed axis and the sprite sits at the new cell's center — so
 * `__GAME__.player` reads a clean grid position that never sits mid-cell. The cell
 * coords are written onto the owner (gridX/gridY) so the scene's __GAME__ adapter and
 * the verify harness can read the snapped position directly.
 *
 * INPUT (the real seam — drivable headlessly): reads the owner's exposed keys the same
 * way BasePlayer does (`owner.cursors` arrows + `owner.wasdKeys`), pressing once per
 * JustDown. This means a real ArrowLeft/ArrowRight/W/A/S/D press from a human OR the
 * verify driver triggers exactly one hop. An FSM may instead call `hop(dir)` directly.
 *
 * Usage (composed on a lane-dodge player, bound from the blueprint):
 *   const hop = this.behaviors.add('movement', new HopGridMovement({ cellSize: 64 }));
 *   // per frame: this.behaviors.update();  // reads input + commits at most one hop
 */
export type HopDir = 'up' | 'down' | 'left' | 'right';

export class HopGridMovement extends BaseBehavior {
  /** Cell size in px (the length of one hop). */
  public cellSize: number;
  /** Grid origin in world px. */
  public originX: number;
  public originY: number;
  /** Hard-snap to cell center on each hop (default true — guarantees no sub-cell drift). */
  public snap: boolean;

  /** The owner's current cell (col,row). Initialized from its spawn world position on attach. */
  public gridX = 0;
  public gridY = 0;

  /** Diagnostics: the last hop direction (read by the verify harness / animation). */
  public lastHopDir: HopDir | null = null;

  constructor(config: HopGridMovementConfig = {}) {
    super();
    this.cellSize = config.cellSize ?? 64;
    this.originX = config.originX ?? 0;
    this.originY = config.originY ?? 0;
    this.snap = config.snap ?? true;
  }

  /** On attach: adopt the maze tile size if present, then snap the owner ONTO the grid. */
  protected onAttach(): void {
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    const scene = owner.scene as any;
    // One source of truth for cell geometry: a maze level's tileSize/origin wins so the
    // hop step and the maze never drift (generic, by name — inert when there is no maze).
    const maze = scene?.__maze;
    if (maze) {
      this.cellSize = maze.tileSize ?? this.cellSize;
      this.originX = maze.originX ?? this.originX;
      this.originY = maze.originY ?? this.originY;
    }
    // Derive the starting cell from the spawn world position and snap exactly onto it.
    this.gridX = Math.floor((owner.x - this.originX) / this.cellSize);
    this.gridY = Math.floor((owner.y - this.originY) / this.cellSize);
    this.snapOwnerToCell();
  }

  /**
   * Per-frame: read a directional PRESS (JustDown) and commit AT MOST one hop.
   *
   * A discrete hop has NO velocity carry — the body is held still between hops so the
   * sprite never drifts off a cell. Exactly one press = exactly one cell.
   */
  update(): void {
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    const body = owner.body as Phaser.Physics.Arcade.Body | undefined;
    // Kill any residual velocity — discrete hops are position writes, never momentum.
    if (body) body.velocity.set(0, 0);

    const dir = this.readPressedDir(owner);
    if (dir) this.hop(dir);
  }

  /**
   * Commit one hop in `dir`: advance the cell by 1, snap the sprite to the new cell
   * center, and emit `player.hopped` at the true gameplay seam. This is the single
   * commit point — call it from an FSM to hop programmatically.
   */
  hop(dir: HopDir): void {
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();

    switch (dir) {
      case 'up':
        this.gridY -= 1;
        break;
      case 'down':
        this.gridY += 1;
        break;
      case 'left':
        this.gridX -= 1;
        break;
      case 'right':
        this.gridX += 1;
        break;
    }
    this.lastHopDir = dir;

    // Expose facing for animation/diagnostics (mirrors the other top-down behaviors).
    (owner as any).facingDirection = dir;

    // SNAP — the sprite lands exactly on the new cell center (no sub-cell drift).
    this.snapOwnerToCell();

    // player.hopped — the discrete-hop moment on the scene's shared bus, at the real
    // commit seam (the cell just changed). Payload is the player's OWN snapped cell +
    // the hop dir (auto-derived from this bound player entity — no id field). Defensive:
    // a scene without a bus is a no-op. Declared in this component's surface().
    this.bus?.emit('player.hopped', {
      gridX: this.gridX,
      gridY: this.gridY,
      dir,
    });
  }

  /**
   * Read a single directional press this frame (JustDown), or null. Diagonal /
   * multi-axis presses resolve to ONE cardinal (the first axis pressed) — a hop is
   * always one cardinal cell. Reads the owner's exposed keys the BasePlayer way, so a
   * real key press (human or the verify driver) drives it; falls back to a queued
   * programmatic direction set via setNextHop().
   */
  private readPressedDir(owner: any): HopDir | null {
    // 1) A programmatically queued hop (FSM / scripted) takes priority and is consumed.
    if (this._queued) {
      const d = this._queued;
      this._queued = null;
      return d;
    }

    const cursors: Phaser.Types.Input.Keyboard.CursorKeys | undefined = owner.cursors;
    const wasd:
      | {
          W: Phaser.Input.Keyboard.Key;
          A: Phaser.Input.Keyboard.Key;
          S: Phaser.Input.Keyboard.Key;
          D: Phaser.Input.Keyboard.Key;
        }
      | undefined = owner.wasdKeys;

    const justDown = (k?: Phaser.Input.Keyboard.Key): boolean =>
      !!k && Phaser.Input.Keyboard.JustDown(k);

    // Vertical takes precedence over horizontal when both land the same frame (a single
    // commit either way — never two cells in one frame).
    if (justDown(cursors?.up) || justDown(wasd?.W)) return 'up';
    if (justDown(cursors?.down) || justDown(wasd?.S)) return 'down';
    if (justDown(cursors?.left) || justDown(wasd?.A)) return 'left';
    if (justDown(cursors?.right) || justDown(wasd?.D)) return 'right';
    return null;
  }

  /** A programmatic hop queued for the next update (the FSM/scripted seam). */
  private _queued: HopDir | null = null;

  /** Queue ONE hop to commit on the next update (mirrors EightWayMovement.setInput intent). */
  setNextHop(dir: HopDir): void {
    this._queued = dir;
  }

  /** Snap the owner sprite to the exact center of its current cell (no sub-cell drift). */
  private snapOwnerToCell(): void {
    if (!this.snap) return;
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    owner.x = this.originX + this.gridX * this.cellSize + this.cellSize / 2;
    owner.y = this.originY + this.gridY * this.cellSize + this.cellSize / 2;
  }

  // ============================================================================
  // COMPONENT SURFACE (the events THIS behavior owns + emits)
  // ============================================================================

  /**
   * The uniform component surface for the hop-grid movement behavior. Declares the
   * ONE player-owned PUSH-channel moment — `player.hopped` — emitted from the real
   * commit seam in hop() on the scene's shared bus. Observables stay on the scene's
   * existing __GAME__ adapter (which can read owner.gridX/gridY), so this surface
   * declares only the PUSH channel + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'player.hopped',
          payload: '{gridX,gridY,dir}',
          scope: 'archetype',
          drivenBy: 'a directional press (the hop verb)',
          expect:
            '__GAME__.player snaps exactly one cell in the pressed direction; player.hopped logged',
        },
      ],
    };
  }
}
