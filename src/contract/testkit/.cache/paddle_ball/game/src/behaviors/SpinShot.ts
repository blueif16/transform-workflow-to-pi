import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import type { ComponentSurface } from '@contract/component-surface';

/**
 * CAPABILITY sidecar (kept consistent with PaddleController / PinballFlippers' sidecar
 * shape; the paddle_ball BEHAVIOR registry discovers behaviors via the authored taxonomy
 * in `registry/discover.mjs`, not via this const — so this is inert-but-documenting
 * metadata, never read by the drift gate, but ships on every behavior file).
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'SpinShot',
  intent:
    "The skill-shot spin seam: a paddle that is MOVING at the moment the ball contacts it imparts SPIN — extra lateral (curve) velocity in the paddle's direction of travel — to the returned ball, beyond the contact-point steering the engine already does. A stationary paddle adds nothing; a fast-swiping paddle 'carries' the ball sideways (table-tennis English). This is the player's second axis of control over the ball: place the paddle AND swing it.",
  roles: ['paddle', 'ball'],
  params: ['spinFactor', 'maxSpinSpeed', 'preserveSpeed'],
  tuning: ['ballSpeed'],
} as const;

/** SpinShot config — every number a DECLARED default, none baked from a game. */
export interface SpinShotConfig {
  /**
   * How strongly paddle motion converts to ball lateral velocity (px/s of ball spin per
   * px/s of paddle motion at contact). Default 0.45 — a brisk swipe noticeably curves the
   * return without overpowering the engine's contact-point steering.
   */
  spinFactor?: number;
  /** Absolute cap on the spin velocity added on one contact, px/s (default 360). */
  maxSpinSpeed?: number;
  /**
   * When true (default), rescale the post-spin velocity back to the incoming speed so spin
   * changes only the ANGLE — honoring the engine's speed-preserved invariant [RB §1]. When
   * false, spin adds raw lateral speed (a faster, harder return).
   */
  preserveSpeed?: boolean;
  /**
   * Minimum paddle speed (px/s) at contact below which NO spin is applied — a near-still
   * paddle should not jitter the ball (default 24).
   */
  spinDeadzone?: number;
}

/**
 * SpinShot — paddle motion at contact imparts spin (the skill-shot behavior seam).
 *
 * Mirrors PaddleController / PinballFlippers' plumbing: a BaseBehavior attached to the
 * paddle (the player entity), reaching the live `scene` off its owner sprite and ticking
 * each frame from the scene's behaviors.update() drive. It does NOT move the paddle and it
 * does NOT own the ball bounce — the BasePaddleScene already reflects the ball off the
 * paddle BY CONTACT POINT (paddleBounce → sets scene.ballVel, then emits
 * `ball.bounced {off:'paddle', vx, vy}`). SpinShot layers the MOTION axis on top:
 *
 *   - every frame it measures the paddle's own velocity (Δposition / dt) — the swing speed;
 *   - it LISTENS for the scene's paddle bounce (`ball.bounced` with off:'paddle'); the
 *     instant the engine has set the fresh post-bounce ballVel, SpinShot ADDS lateral
 *     velocity to that live `scene.ballVel` in the paddle's direction of travel, scaled by
 *     the paddle's measured speed at contact (capped at maxSpinSpeed). With preserveSpeed
 *     (default) the result is rescaled to the incoming speed so spin changes the ANGLE only.
 *
 * Because scene.ballVel IS the velocity the engine's sub-step integrator reads, the curve
 * is the REAL, observable return path — and a swiping paddle's return lands differently
 * from a still paddle's. Emits `spin.applied {dir, spin, vx, vy}` at that real seam.
 *
 * Generic — no game/theme, no baked coordinate: every number is a declared default; a
 * scene without a paddle/ball/bus is a clean no-op.
 */
export class SpinShot extends BaseBehavior {
  public readonly cfg: Required<SpinShotConfig>;

  private scene: any = null;
  /** Unsubscribe handle for the bus listener (set in onAttach, called in onDetach). */
  private unsub: (() => void) | null = null;
  /** The paddle's bound-axis position last frame, to derive its swing velocity. */
  private lastPaddleX = 0;
  private lastPaddleY = 0;
  private havePrev = false;
  /** The paddle's measured velocity (px/s) this frame — the swing speed at contact. */
  private paddleVel: { x: number; y: number } = { x: 0, y: 0 };

  constructor(config: SpinShotConfig = {}) {
    super();
    this.cfg = {
      spinFactor: config.spinFactor ?? 0.45,
      maxSpinSpeed: config.maxSpinSpeed ?? 360,
      preserveSpeed: config.preserveSpeed ?? true,
      spinDeadzone: config.spinDeadzone ?? 24,
    };
  }

  /** Cache the scene + subscribe to the paddle bounce so we can add spin at contact. */
  protected onAttach(): void {
    const owner = this.getOwner<Phaser.GameObjects.Sprite & { scene: any }>();
    const scene = owner?.scene as any;
    this.scene = scene;
    if (!scene) return;
    this.lastPaddleX = owner.x;
    this.lastPaddleY = owner.y;
    this.havePrev = true;
    // Listen for the scene's paddle reflect; on it, impart spin onto the live ballVel.
    this.unsub =
      scene.eventBus?.on?.('ball.bounced', (payload: any) => this.onBallBounced(payload)) ?? null;
  }

  protected onDetach(): void {
    this.unsub?.();
    this.unsub = null;
    this.scene = null;
    this.havePrev = false;
  }

  /** Per-frame: measure the paddle's swing velocity (Δposition / dt) for the next contact. */
  update(): void {
    const owner = this.getOwner<Phaser.GameObjects.Sprite & { scene: any }>();
    const scene = this.scene ?? owner?.scene;
    if (!owner || !scene) return;
    const dt = Math.min(0.05, (scene.game?.loop?.delta ?? 1000 / 60) / 1000) || 1 / 60;
    if (this.havePrev) {
      this.paddleVel = {
        x: (owner.x - this.lastPaddleX) / dt,
        y: (owner.y - this.lastPaddleY) / dt,
      };
    }
    this.lastPaddleX = owner.x;
    this.lastPaddleY = owner.y;
    this.havePrev = true;
  }

  /**
   * The engine just reflected the ball off the paddle (it has already set scene.ballVel
   * and emitted ball.bounced). If the paddle was swinging, ADD lateral velocity to that
   * live ballVel in the swing direction, scaled by the paddle's speed at contact.
   */
  private onBallBounced(payload: any): void {
    if (payload?.off !== 'paddle') return; // only the paddle contact imparts spin
    const scene = this.scene;
    const vel = scene?.ballVel as { x: number; y: number } | undefined;
    if (!vel) return;

    // The paddle's swing speed along its primary travel axis (a bottom bat swings on x).
    const swing = Math.abs(this.paddleVel.x) >= Math.abs(this.paddleVel.y)
      ? this.paddleVel.x
      : this.paddleVel.y;
    if (Math.abs(swing) < this.cfg.spinDeadzone) return; // a near-still paddle adds nothing

    const dir = Math.sign(swing); // +1 = swinging right, -1 = swinging left
    // Lateral velocity to add, proportional to swing speed, capped.
    const spin = Math.max(
      -this.cfg.maxSpinSpeed,
      Math.min(this.cfg.maxSpinSpeed, swing * this.cfg.spinFactor),
    );

    const incomingSpeed = Math.hypot(vel.x, vel.y) || scene.ballSpeed || 1;
    // Carry the ball sideways in the swing direction (the English).
    vel.x += spin;

    if (this.cfg.preserveSpeed) {
      // Rescale to the incoming speed so spin changes the ANGLE, never the total speed.
      const len = Math.hypot(vel.x, vel.y) || 1;
      vel.x = (vel.x / len) * incomingSpeed;
      vel.y = (vel.y / len) * incomingSpeed;
    }

    // spin.applied — fired at the real seam (the moving paddle just curved the return). The
    // payload carries the swing direction + the spin magnitude + the resulting ball
    // velocity so a cue/verify can read that the ball's LATERAL velocity reflects the spin.
    this.bus?.emit('spin.applied', {
      dir,
      spin: Math.round(spin),
      vx: Math.round(vel.x),
      vy: Math.round(vel.y),
    });
  }

  /**
   * The uniform component surface — the PUSH channel this behavior owns. Declares
   * `spin.applied` (emitted from the real seam in onBallBounced when a MOVING paddle
   * contacted the ball). The ball velocity flows via the existing engine state
   * (scene.ballVel, which the integrator reads), so the surface declares the event + no
   * extra observables/anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'spin.applied',
          payload: '{dir,spin,vx,vy}',
          scope: 'archetype',
          drivenBy: 'hit the ball while the paddle is moving',
          expect:
            "the ball's lateral velocity reflects the spin (its horizontal velocity gains in the paddle's swing direction); spin.applied logged",
        },
      ],
    };
  }
}
