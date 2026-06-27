import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';

/**
 * AxisConstrainedMovement configuration.
 */
export interface AxisConstrainedMovementConfig {
  /** Movement speed in pixels per second along the FREE axis. */
  moveSpeed: number;
  /**
   * The FREE axis the player may move along ('x' = a horizontal bottom track,
   * the Space Invaders laser cannon; 'y' = a vertical side track). The OTHER axis
   * is HARD-LOCKED to the spawn coordinate every frame — the player physically
   * cannot leave its track (RB §2 invariant 5: "the player CANNOT leave its axis").
   */
  axis?: 'x' | 'y';
  /**
   * Inclusive travel bounds on the FREE axis in world px [min,max]. The player is
   * clamped to this band each frame so it never wanders off the arena. Absent →
   * the body's world-bounds collision is relied on. (RB §2: clamped to arena width.)
   */
  min?: number;
  max?: number;
}

/**
 * AxisConstrainedMovement — the gallery-shooter player mover (BUILD — the new
 * engine piece). The player slides along ONE axis and is HARD-LOCKED on the other,
 * the signature gallery-shooter constraint (the laser cannon on its bottom track).
 *
 * This is the OPPOSITE of top_down's free EightWayMovement: input on the locked
 * axis is ignored, the locked-axis velocity is zeroed AND the locked-axis position
 * is pinned to the spawn coordinate every frame, and the free-axis position is
 * clamped to [min,max]. A "move up" press on a bottom-track cannon does nothing —
 * `__GAME__.player.y` never changes (the §6 invariant the controllable proof asserts).
 *
 * Input is scene-owned (BaseGameScene.setupInputs); the scene/scheme calls
 * setInput(dir) with -1|0|+1 along the free axis. No DOM listeners here.
 *
 * Usage:
 *   const mover = new AxisConstrainedMovement({ moveSpeed: 260, axis: 'x', min: 24, max: 408 });
 *   this.behaviors.add('movement', mover);
 *   mover.setInput(1);  // slide toward the free-axis max
 *   mover.setInput(0);  // stop
 */
export class AxisConstrainedMovement extends BaseBehavior {
  public moveSpeed: number;
  public readonly axis: 'x' | 'y';
  private readonly min?: number;
  private readonly max?: number;

  /** Input along the FREE axis (-1, 0, or +1). */
  private input = 0;
  /** The pinned LOCKED-axis coordinate (captured on first update from the owner). */
  private lockedCoord: number | null = null;

  /** Last move direction along the free axis (for facing/diagnostics). */
  public movementDirection: 'left' | 'right' | 'up' | 'down' = 'left';

  constructor(config: AxisConstrainedMovementConfig) {
    super();
    this.moveSpeed = config.moveSpeed;
    this.axis = config.axis ?? 'x';
    this.min = config.min;
    this.max = config.max;
  }

  /** Capture the locked-axis pin coordinate once the owner exists. */
  protected override onAttach(): void {
    this.captureLock();
  }

  private captureLock(): void {
    const owner = this.owner as Phaser.Physics.Arcade.Sprite | null;
    if (!owner) return;
    this.lockedCoord = this.axis === 'x' ? owner.y : owner.x;
  }

  /**
   * Set the movement input along the FREE axis. Values clamp to -1|0|+1.
   * Input on the locked axis is structurally impossible (one scalar).
   */
  setInput(dir: number): void {
    this.input = Math.sign(dir);
    if (this.input !== 0) {
      if (this.axis === 'x') this.movementDirection = this.input < 0 ? 'left' : 'right';
      else this.movementDirection = this.input < 0 ? 'up' : 'down';
    }
  }

  /** Stop free-axis movement. */
  stop(): void {
    this.input = 0;
  }

  isMoving(): boolean {
    return this.input !== 0;
  }

  /** Get the raw free-axis input. */
  getInput(): number {
    return this.input;
  }

  update(): void {
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    const body = owner.body as Phaser.Physics.Arcade.Body;
    if (!body) return;
    if (this.lockedCoord === null) this.captureLock();

    const v = this.input * this.moveSpeed;
    if (this.axis === 'x') {
      // FREE x, LOCKED y: zero the y velocity AND pin y to the spawn row.
      owner.setVelocity(v, 0);
      if (this.lockedCoord !== null) owner.y = this.lockedCoord;
      if (this.min !== undefined && owner.x < this.min) {
        owner.x = this.min;
        if (owner.body.velocity.x < 0) owner.setVelocityX(0);
      }
      if (this.max !== undefined && owner.x > this.max) {
        owner.x = this.max;
        if (owner.body.velocity.x > 0) owner.setVelocityX(0);
      }
    } else {
      // FREE y, LOCKED x.
      owner.setVelocity(0, v);
      if (this.lockedCoord !== null) owner.x = this.lockedCoord;
      if (this.min !== undefined && owner.y < this.min) {
        owner.y = this.min;
        if (owner.body.velocity.y < 0) owner.setVelocityY(0);
      }
      if (this.max !== undefined && owner.y > this.max) {
        owner.y = this.max;
        if (owner.body.velocity.y > 0) owner.setVelocityY(0);
      }
    }
  }
}
