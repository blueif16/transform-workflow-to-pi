/**
 * ============================================================================
 * GroundRunJump — the auto-run + variable-height jump locomotion verb (BUILD — behavior)
 * ============================================================================
 *
 * The CORE engine of the `endless_runner:auto-run-jump` (endless-platform-runner) genre:
 * the avatar runs FORWARD automatically and the player's one input is a JUMP that clears
 * gaps/obstacles in the shared scroller, landing back on the ground. Like every runner
 * verb, the avatar's horizontal SCREEN position is FIXED — the world scrolls past it
 * (ObstacleScrollSystem); "auto-run forward" is the constant world scroll the avatar
 * keeps pace with, so this behavior owns only the VERTICAL motion (gravity + jump + land)
 * and asserts vx = 0 (the avatar's x never moves — the scroller is the forward motion).
 *
 * THE VARIABLE-HEIGHT JUMP (hold = higher — the whole feel): a jump from the ground SETS
 * vy to a fixed upward impulse (`jumpImpulse`), then while the avatar is still RISING and
 * the jump has not been cut, gravity is REDUCED (scaled by `holdGravityScale`) for a
 * bounded window (`maxHoldFrames`). Holding the button keeps the reduced-gravity rise →
 * a higher arc; cutting it early (`cutJump()`) or letting the window lapse restores FULL
 * gravity → a shorter hop. This is the canonical Mario/Sonic-runner variable jump: the
 * SAME impulse, a player-controlled apex. Deterministic — the held outcome is a function
 * of how many frames the rise was sustained, never of where the avatar happened to be.
 *
 * GROUNDED GATE (the contract — "landing back on the ground"): a jump only initiates when
 * the avatar is grounded (its feet are at/under the ground band `groundY`). Each frame
 * gravity integrates vy; once the avatar's feet reach `groundY` while falling, it SNAPS
 * to the ground (vy = 0, grounded again) — so the avatar always lands and can jump again.
 * An air-borne press is ignored (no double-jump) — the run is a rhythm of grounded jumps.
 *
 * HEADLESS-DRIVEABLE: the one-button verb is `flap()` (aliased to `jump()`) — the SAME
 * seam name the shared one-button scheme (GravityFlapScheme) already drives, so the
 * existing control wiring needs ZERO edits: a real keydown/tap → the scheme → `flap()` →
 * vy goes negative (rising) the very next frame (the controllable proof). A hold-aware
 * scheme can additionally call `cutJump()` on release for a precise short hop; absent
 * that signal the bounded hold window gives the variable arc on its own.
 *
 * EVENT (the PUSH channel): `jump.performed` fires on the shared scene.eventBus at the
 * real jump-initiation seam — a grounded press that sets vy negative (payload {y}).
 *
 * GENERIC: every value is a config param (no game/theme). The owner is any sprite with a
 * Phaser arcade body; the behavior writes `body.velocity.y` + the owner's vy/vx mirror,
 * which the hook surfaces as __GAME__.player.vy / .vx. It reaches the shared bus the way
 * a sibling does — via the owner's scene (`owner.scene.eventBus`).
 */
import { BaseBehavior } from './IBehavior';
import { type ComponentSurface } from '@contract/component-surface';

export interface GroundRunJumpConfig {
  /** Downward acceleration (px/s^2) applied to vy each frame (full gravity). */
  gravity?: number;
  /** The FIXED upward velocity (px/s, positive magnitude) a ground jump SETS vy to. */
  jumpImpulse?: number;
  /**
   * Gravity multiplier (< 1) applied while the jump is HELD and the avatar is still
   * rising — the "hold = higher" knob. Lower => a taller sustained jump.
   */
  holdGravityScale?: number;
  /** Max frames the reduced-gravity hold window lasts before full gravity resumes. */
  maxHoldFrames?: number;
  /** Terminal fall-speed cap (px/s, positive magnitude) — the fairness clamp. */
  maxFallSpeed?: number;
  /**
   * The ground band the avatar runs on / lands back onto (world y of the feet line).
   * When absent it is derived once from the scene's map height (a band near the bottom).
   */
  groundY?: number;
}

/** Sensible declared defaults (the auto-run-jump feel; re-tuned per game). */
const DEFAULTS: Required<Omit<GroundRunJumpConfig, 'groundY'>> = {
  gravity: 2000,
  jumpImpulse: 620,
  holdGravityScale: 0.45,
  maxHoldFrames: 16,
  maxFallSpeed: 900,
};

export class GroundRunJump extends BaseBehavior {
  private readonly gravity: number;
  private readonly jumpImpulse: number;
  private readonly holdGravityScale: number;
  private readonly maxHoldFrames: number;
  private readonly maxFallSpeed: number;
  private readonly configGroundY?: number;

  /** Set true by flap()/jump(); the next update() initiates the jump exactly once (edge). */
  private jumpQueued = false;
  /** True while the avatar's feet are at/under the ground band (a grounded press jumps). */
  private grounded = true;
  /** True while a jump is rising AND not yet cut — gates the reduced-gravity hold. */
  private holding = false;
  /** Frames elapsed in the current hold window (caps the sustained rise). */
  private holdFrames = 0;
  /** Resolved ground-band y (from config or derived from the scene once). */
  private groundY = 0;

  constructor(config: GroundRunJumpConfig = {}) {
    super();
    this.gravity = config.gravity ?? DEFAULTS.gravity;
    this.jumpImpulse = config.jumpImpulse ?? DEFAULTS.jumpImpulse;
    this.holdGravityScale = config.holdGravityScale ?? DEFAULTS.holdGravityScale;
    this.maxHoldFrames = config.maxHoldFrames ?? DEFAULTS.maxHoldFrames;
    this.maxFallSpeed = config.maxFallSpeed ?? DEFAULTS.maxFallSpeed;
    this.configGroundY = config.groundY;
  }

  protected onAttach(): void {
    // Resolve the ground band once: explicit config, else a band near the canvas bottom.
    const owner = this.owner;
    const sceneH = owner?.scene?.mapHeight ?? owner?.scene?.scale?.height ?? 768;
    this.groundY = this.configGroundY ?? sceneH - 96;
    this.grounded = true;
    this.holding = false;
    this.holdFrames = 0;
  }

  /**
   * The one-button verb (aliased so the shared GravityFlapScheme drives it unchanged).
   * SETS the queued-jump edge; the next update() initiates a GROUNDED jump exactly once.
   * Called by the control scheme on a real keydown/pointerdown (headless-driveable) —
   * never reads DOM itself. Idempotent within a frame.
   */
  flap(): void {
    this.jumpQueued = true;
  }

  /** Explicit alias for a jump-named scheme/binding (same seam as flap()). */
  jump(): void {
    this.jumpQueued = true;
  }

  /**
   * Cut the current jump short (the hold-release seam): ends the reduced-gravity window
   * so full gravity resumes immediately → a shorter hop. A hold-aware scheme calls this
   * on button release; harmless when no jump is in progress.
   */
  cutJump(): void {
    this.holding = false;
  }

  update(): void {
    if (!this.enabled) return;
    const owner = this.owner;
    if (!owner) return;
    const body = owner.body as { velocity: { y: number } } | undefined;
    if (!body) return;

    const dt = 1 / 60;

    // ── jump initiation (a GROUNDED press only — no air double-jump) ─────────────
    if (this.jumpQueued) {
      this.jumpQueued = false;
      if (this.grounded) {
        body.velocity.y = -this.jumpImpulse; // SET (deterministic apex), not added.
        this.grounded = false;
        this.holding = true; // open the hold window for the variable-height rise.
        this.holdFrames = 0;
        owner.vy = body.velocity.y;
        owner.vx = 0;
        // The PUSH seam: a real grounded jump fired (vy is now negative — rising).
        this.emitJump(owner);
        // Integrate the rest of this frame below with the impulse already applied.
      }
    }

    if (!this.grounded) {
      // ── gravity integration: reduced while HELD + rising (hold = higher) ────────
      const rising = body.velocity.y < 0;
      if (this.holding && rising && this.holdFrames < this.maxHoldFrames) {
        body.velocity.y += this.gravity * this.holdGravityScale * dt;
        this.holdFrames += 1;
      } else {
        // Window lapsed, jump cut, or already falling → full gravity (the apex/descent).
        this.holding = false;
        body.velocity.y += this.gravity * dt;
      }

      // The fairness cap (INV-PASSABLE): clamp terminal fall speed.
      if (body.velocity.y > this.maxFallSpeed) body.velocity.y = this.maxFallSpeed;

      // ── land back on the ground (the contract): snap to the band when feet reach it ─
      const feet = (owner.y ?? 0) + (this.ownerHalfHeight(owner));
      if (body.velocity.y >= 0 && feet >= this.groundY) {
        owner.y = this.groundY - this.ownerHalfHeight(owner);
        body.velocity.y = 0;
        this.grounded = true;
        this.holding = false;
        this.holdFrames = 0;
      }
    } else {
      // On the ground between jumps: pinned to the band, no vertical drift.
      body.velocity.y = 0;
    }

    // Mirror onto the owner for the hook surface (__GAME__.player.vy/.vx).
    owner.vy = body.velocity.y;
    owner.vx = 0; // the avatar's x is FIXED — the world scrolls (auto-run), not the avatar.
  }

  /** Half the owner's display height (for the feet line); a safe fallback when absent. */
  private ownerHalfHeight(owner: any): number {
    const h = owner?.displayHeight ?? owner?.height ?? 34;
    return h / 2;
  }

  /** Emit jump.performed on the shared scene bus (the way a sibling reaches it). */
  private emitJump(owner: any): void {
    const bus = owner?.scene?.eventBus;
    if (bus && typeof bus.emit === 'function') {
      this.bus?.emit('jump.performed', { y: Math.round(owner.y ?? 0) });
    }
  }

  /**
   * The PUSH channel this behavior publishes:
   *   - jump.performed ← a grounded tap that sets vy negative (the avatar leaves the
   *     ground rising) [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'jump.performed',
          payload: '{y}',
          scope: 'archetype',
          drivenBy: 'a tap while grounded',
          expect:
            "__GAME__.player.vy goes negative (the avatar starts rising); jump.performed logged",
        },
      ],
    };
  }
}

/**
 * CAPABILITY — the registry sidecar (discover.mjs globs this). The drift-gated `behavior`
 * capability the blueprint binds by id. CODE is the source of truth.
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'GroundRunJump',
  intent:
    'Auto-run + variable-height jump (endless platform runner): the avatar auto-runs forward (the world scrolls past its fixed x) and a one-button jump from the ground clears obstacles — holding the button sustains reduced gravity while rising for a higher arc (hold = higher), then the avatar falls under full gravity and SNAPS back onto the ground band to run + jump again. No air double-jump; a fall-speed cap keeps every gap recoverable.',
  implements: 'GroundRunJump',
  roles: ['player'],
  params: ['gravity', 'jumpImpulse', 'holdGravityScale', 'maxHoldFrames', 'maxFallSpeed', 'groundY'],
  tuning: ['gravity', 'jumpImpulse', 'holdGravityScale', 'maxHoldFrames', 'maxFallSpeed'],
} as const;
