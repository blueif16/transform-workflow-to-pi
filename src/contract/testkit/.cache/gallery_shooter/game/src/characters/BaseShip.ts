import Phaser from 'phaser';
import * as utils from '../utils';
import { BehaviorManager, AxisConstrainedMovement } from '../behaviors';
import type { ComponentSurface, EventBus } from '@contract/component-surface';

/**
 * BaseShip configuration.
 */
export interface ShipConfig {
  /** Texture key for the initial frame (an index.json slot; falls back to a placeholder). */
  textureKey: string;
  /** Display width in px (the cannon is wider than tall). */
  displayWidth?: number;
  /** Display height in px. */
  displayHeight?: number;
  /** Player stats. */
  stats: {
    maxHealth: number;
    invulnerableTime?: number;
  };
}

/**
 * BaseShip — the gallery-shooter player cannon (KEEP — engine). The top_down
 * analogue of BasePlayer, but DRAMATICALLY simpler: the cannon has no FSM, no melee,
 * no dash, no mouse aim — it slides along ONE axis (the AxisConstrainedMovement
 * behavior the data loader attaches) and fires straight up (the ProjectilePool system
 * owns the shot). It carries the health + i-frame + takeDamage/kill seam the engine
 * collision + lose path drive, and self-ticks its bound behaviors.
 *
 * UPDATE: the scene calls update() each frame; the ship ticks its behaviors (the
 * mover applies the axis-locked velocity). The scene/scheme sets the mover input + the
 * fire intent each frame — the ship owns no input itself (input is scene-owned).
 *
 * EVENT: the ship OWNS the player.damaged moment (a non-lethal hit); lethal damage
 * flows to the scene's player.died seam. (player.shot is owned by ProjectilePool, the
 * component that actually launches the bullet.)
 */
export abstract class BaseShip extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;

  /** Behavior manager for this ship (holds the AxisConstrainedMovement mover). */
  public behaviors: BehaviorManager;

  /** The axis-constrained mover (the data loader sets this when it attaches the binding). */
  public movement?: AxisConstrainedMovement;

  /** Max + current health. */
  public maxHealth: number;
  public health: number;

  /** State flags read by the engine collision + lose path. */
  public isDead = false;
  public isHurting = false;

  private _invulnerableUntil = 0;
  public invulnerableTime: number;

  public get isInvulnerable(): boolean {
    if (!this.scene?.time) return false;
    return this.scene.time.now < this._invulnerableUntil;
  }

  protected get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  constructor(scene: Phaser.Scene, x: number, y: number, config: ShipConfig) {
    super(scene, x, y, config.textureKey);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.maxHealth = config.stats.maxHealth;
    this.health = this.maxHealth;
    this.invulnerableTime = config.stats.invulnerableTime ?? 800;

    this.body.setAllowGravity(false);
    utils.fitDisplayContain(this, config.displayWidth ?? 44, config.displayHeight ?? 28);

    this.behaviors = new BehaviorManager(this);
  }

  /** Per-frame tick (the scene calls this). Ticks bound behaviors (the axis mover). */
  update(): void {
    if (!this.body || !this.active) return;
    this.behaviors.update();
  }

  /** Grant invulnerability for a duration (the longest remaining always wins). */
  public grantInvulnerability(durationMs: number): void {
    const endTime = this.scene.time.now + durationMs;
    this._invulnerableUntil = Math.max(this._invulnerableUntil, endTime);
  }

  /** Take damage. Non-lethal → i-frames + the player.damaged event; lethal → kill(). */
  takeDamage(damage: number): void {
    if (this.isInvulnerable || this.isDead) return;
    this.health -= damage;
    this.grantInvulnerability(this.invulnerableTime);
    if (this.health <= 0) {
      this.health = 0;
      this.kill();
      return;
    }
    this.isHurting = true;
    // player.damaged — the standardized non-lethal hit event on the shared bus, at the
    // real hit moment. Declared in this component's surface(). Defensive: no bus = no-op.
    this.bus?.emit('player.damaged', {
      x: this.x,
      y: this.y,
      health: this.health,
      damage,
    });
    // brief blink (cosmetic; invulnerability is time-based)
    this.scene.tweens.add({
      targets: this,
      alpha: 0.3,
      duration: 90,
      yoyo: true,
      repeat: Math.max(0, Math.floor(this.invulnerableTime / 200)),
      onComplete: () => {
        this.alpha = 1;
        this.isHurting = false;
      },
    });
  }

  /** Kill the ship immediately (the scene's player.died/status:'lost' path runs from here). */
  kill(): void {
    if (this.isDead) return;
    this.health = 0;
    this.isDead = true;
    this.setVelocity(0, 0);
    (this.scene as any).onPlayerDeath?.();
  }

  /**
   * The uniform component surface for the ship. Declares the SHIP-OWNED event:
   *   - player.damaged ← takeDamage() (a non-lethal hit; lethal → scene player.died) [base:2d]
   * (player.shot is owned by ProjectilePool — the component that launches the bullet.)
   * Observables stay on the existing __GAME__ adapter, so this surface declares only the
   * PUSH channel + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'player.damaged',
          payload: '{x,y,health,damage}',
          scope: 'base:2d',
          drivenBy: 'a hit lands on the cannon (non-lethal)',
          expect: '__GAME__.player.health decreases; player.damaged logged',
        },
      ],
    };
  }
}
