/**
 * ============================================================================
 * GravityFlapMovement — the gravity-flap locomotion verb (BUILD — behavior)
 * ============================================================================
 *
 * The CORE engine of the `endless_runner:gravity-flap` (Flappy Bird) base genre: the
 * avatar is pulled DOWN by a constant gravity every frame, and a one-button FLAP sets
 * its vertical velocity to a FIXED upward impulse. Its horizontal position never moves
 * — the WORLD scrolls past it (ObstacleScrollSystem). The interplay of constant
 * gravity + a fixed flap impulse is the whole flight feel.
 *
 * THE DETERMINISM INVARIANT (INV-CONTROLLABLE / craft §1, RB §1): the flap is a FIXED
 * constant — `vy` is SET to `flapImpulse` (not added to), so every flap reaches the
 * identical height regardless of where the avatar is or how fast it was falling. The
 * player fails on their own timing, never on the game's caprice. This is exactly the
 * Flappy Bird design ("250 px/s, never changes — all jumps reach the identical
 * height", RB §1).
 *
 * THE FAIRNESS CAP (INV-PASSABLE / RB §4): vertical velocity is clamped to
 * `maxFallSpeed`. Without the cap the avatar drops so fast that lower obstacles become
 * UNAVOIDABLE (the classic "no velocity cap" bug). The cap keeps every gap recoverable.
 *
 * HEADLESS-DRIVEABLE: the verb is `flap()` — a public one-shot the control scheme calls
 * on a real `keydown`/pointerdown, and the data-driven scene also calls on the level's
 * first start. A harness fires a real key event → the scheme → `flap()` → vy jumps
 * negative (the controllable proof). The behavior reads NO raw DOM itself (the scheme
 * owns input), so it is engine- and input-agnostic.
 *
 * GENERIC: every value is a config param (no game/theme). The owner is any sprite with
 * a Phaser arcade body; the behavior writes `body.velocity.y` + the owner's `vy`/`y`
 * mirror, which the hook surfaces as __GAME__.player.vy / .y.
 */
import { BaseBehavior } from './IBehavior';

export interface GravityFlapMovementConfig {
  /** Downward acceleration (px/s²) applied to vy each frame. */
  gravity?: number;
  /** The FIXED upward velocity (px/s, positive magnitude) a flap SETS vy to. */
  flapImpulse?: number;
  /** Terminal fall-speed cap (px/s, positive magnitude) — the fairness clamp. */
  maxFallSpeed?: number;
}

/** Sensible declared defaults (the gravity-flap feel — RB §5; re-tuned per game). */
const DEFAULTS: Required<GravityFlapMovementConfig> = {
  gravity: 1400,
  flapImpulse: 420,
  maxFallSpeed: 520,
};

export class GravityFlapMovement extends BaseBehavior {
  private readonly gravity: number;
  private readonly flapImpulse: number;
  private readonly maxFallSpeed: number;

  /** Set true by flap(); the next update() applies the impulse exactly once (edge). */
  private flapQueued = false;

  constructor(config: GravityFlapMovementConfig = {}) {
    super();
    this.gravity = config.gravity ?? DEFAULTS.gravity;
    this.flapImpulse = config.flapImpulse ?? DEFAULTS.flapImpulse;
    this.maxFallSpeed = config.maxFallSpeed ?? DEFAULTS.maxFallSpeed;
  }

  /**
   * The one-button verb. SETS the queued-flap edge; the next update() sets vy to the
   * fixed `-flapImpulse`. Called by the control scheme on a real keydown/pointerdown
   * (headless-driveable) — never reads DOM itself. Idempotent within a frame.
   */
  flap(): void {
    this.flapQueued = true;
  }

  update(): void {
    if (!this.enabled) return;
    const owner = this.owner;
    if (!owner) return;
    const body = owner.body as { velocity: { y: number } } | undefined;
    if (!body) return;

    // A queued flap SETS the fixed upward impulse (deterministic — INV-CONTROLLABLE).
    if (this.flapQueued) {
      body.velocity.y = -this.flapImpulse;
      this.flapQueued = false;
    } else {
      // Gravity integrates vy. Phaser also applies its own gravity if the body has
      // it; we own the value explicitly so the constant + cap hold regardless of the
      // engine's per-body gravity setting (the scene sets the body's gravity to 0 and
      // lets THIS behavior own the integration — one source of truth for the feel).
      const dt = 1 / 60;
      body.velocity.y += this.gravity * dt;
    }

    // The fairness cap (INV-PASSABLE): clamp terminal fall speed.
    if (body.velocity.y > this.maxFallSpeed) body.velocity.y = this.maxFallSpeed;

    // Mirror onto the owner for the hook surface (__GAME__.player.vy/.y).
    owner.vy = body.velocity.y;
    owner.vx = 0; // the avatar's x is FIXED — the world scrolls, not the avatar.
  }
}

/**
 * CAPABILITY — the registry sidecar (discover.mjs globs this). The drift-gated
 * `behavior` capability the blueprint binds by id. CODE is the source of truth.
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'GravityFlapMovement',
  intent:
    'Gravity-flap locomotion (Flappy Bird): constant gravity pulls the avatar down each frame; a one-button flap SETS vertical velocity to a FIXED upward impulse (deterministic — every flap reaches the same height); a terminal fall-speed cap keeps every gap recoverable. The avatar x is fixed — the world scrolls past it.',
  implements: 'GravityFlapMovement',
  roles: ['player'],
  params: ['gravity', 'flapImpulse', 'maxFallSpeed'],
  tuning: ['gravity', 'flapImpulse', 'maxFallSpeed'],
} as const;
