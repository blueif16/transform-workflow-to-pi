/**
 * ============================================================================
 * BaseRunnerScene — the endless_runner base level scene (KEEP — engine seam)
 * ============================================================================
 *
 * The abstract base every runner level extends. It owns the engine plumbing the hook
 * (templates/core/src/hook.ts) reads — `player`, `eventBus`, the registry score/status/
 * ready flags, the lose seam — and a small set of abstract create-phase hooks the
 * data-driven subclass (DataRunnerScene) fills from DATA. Mirrors platformer's
 * BaseLevelScene / top_down's BaseGameScene one engine over (Phaser 2D, side view, with
 * gravity), but with the runner-specific shape: the avatar x is FIXED and the world
 * scrolls; there is no goal/exit (gravity-flap = survival + score); the lose seam is an
 * obstacle/floor/ceiling contact.
 *
 * HOOK CONTRACT (what the shared core hook reads — KEEP):
 *   - `this.player`          → __GAME__.player (a sprite with x/y/body.velocity/health/isDead)
 *   - `this.eventBus`        → __GAME__.events (the shared EventBus the systems emit on)
 *   - registry 'score'       → __GAME__.score   (written via this.setScore)
 *   - registry 'status'      → __GAME__.status  ('playing' on ready, 'lost' on death)
 *   - registry 'ready'       → __GAME__.ready   (latched on the first interactive frame)
 *   - this.obstacles group   → __GAME__.entities (the scroller adds obstacle sprites here)
 *
 * GENERIC: no game/theme. The subclass supplies the avatar + obstacle stream from data.
 */
import Phaser from 'phaser';
import { EventBus, type ComponentSurface } from '@contract/component-surface';
import * as utils from '../utils';

export abstract class BaseRunnerScene extends Phaser.Scene {
  /** The avatar (the one player entity — the hook reads this as __GAME__.player). */
  public player!: Phaser.Physics.Arcade.Sprite & {
    vx?: number;
    vy?: number;
    health?: number;
    maxHealth?: number;
    isDead?: boolean;
    isInvulnerable?: boolean;
    takeDamage?: (n: number) => void;
    movement?: { flap?: () => void };
    __type?: string;
    __id?: string;
    behaviors?: any;
  };

  /** The shared event bus the systems emit on (folded onto __GAME__.events). */
  public eventBus = new EventBus();

  /** The obstacle group the scroller fills (surfaced into __GAME__.entities). */
  public obstacles?: Phaser.Physics.Arcade.Group;

  /** World size (the fixed portrait canvas; set in setupMapSize from data). */
  public mapWidth = 432;
  public mapHeight = 768;

  /** A monotonic frame counter the bus stamps each tick (replay ordering). */
  private _frame = 0;

  // ── abstract create-phase hooks the data-driven subclass fills (KEEP) ────────
  /** Set this.mapWidth / this.mapHeight (the world size). */
  protected abstract setupMapSize(): void;
  /** Create the background (color and/or a parallax TileSprite). */
  protected abstract createBackground(): void;
  /** Create the avatar; MUST set this.player. */
  protected abstract createAvatar(): void;
  /** Construct + attach the scene systems (the scroller + the scorer). */
  protected abstract setupSystems(): void;

  // ── boot ─────────────────────────────────────────────────────────────────────

  preload(): void {
    utils.ensurePlaceholderTexture(this, '__px', 8, 8);
  }

  create(): void {
    // Fresh-run state (INV-RESET): a scene RESTART re-runs create(), so re-init the
    // registry + bus so nothing leaks from the prior run.
    this.game.registry.set('status', 'playing');
    this.game.registry.set('score', 0);
    this.game.registry.set('ready', false);
    this.eventBus = new EventBus();
    this._frame = 0;

    this.setupMapSize();
    this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
    this.createBackground();
    this.createAvatar();
    this.setupSystems();

    // Latch ready on the first interactive frame (the hook reads registry 'ready').
    this.game.registry.set('ready', true);
  }

  update(): void {
    this._frame += 1;
    this.eventBus.setFrame(this._frame);
    // Drive the avatar's bound movement behavior(s) from the ONE scene loop.
    const p = this.player as any;
    if (p && p.active !== false && p.behaviors) p.behaviors.update();
    this.onUpdate();
  }

  /** Per-frame hook the subclass overrides (drive input + systems). */
  protected onUpdate(): void {
    // Override in DataRunnerScene.
  }

  // ── the engine seams the hook + the systems use (KEEP) ───────────────────────

  /** Write the single score source (the hook reads registry 'score'). */
  public setScore(value: number): void {
    this.game.registry.set('score', value);
  }

  /** Read the current score. */
  public getScore(): number {
    return Number(this.game.registry.get('score') ?? 0);
  }

  /**
   * The LOSE SEAM (KEEP): mark the avatar dead and set status 'lost' ONCE. Fired by
   * the avatar's takeDamage (the scroller drains health to fire it) or directly. The
   * standardized terminal-status path the hook surfaces — never a new death path.
   */
  public onPlayerDeath(): void {
    if (this.player?.isDead) return;
    if (this.player) {
      this.player.isDead = true;
      const body = this.player.body as Phaser.Physics.Arcade.Body | undefined;
      if (body) body.setVelocity(0, 0);
    }
    this.game.registry.set('status', 'lost');
    this.eventBus.emit('level.statusChanged', { status: 'lost' });
  }

  /**
   * The PUSH channel the BASE scene publishes (the standardized core seam, mirroring
   * platformer's BaseLevelScene / top_down's BaseGameScene):
   *   - level.statusChanged ← onPlayerDeath (the run ended; status → 'lost') [core]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'level.statusChanged',
          payload: "{status}",
          scope: 'core',
          drivenBy: 'the avatar dying (an obstacle/floor/ceiling hit)',
          expect: "__GAME__.status becomes 'lost'; level.statusChanged logged",
        },
      ],
    };
  }
}
