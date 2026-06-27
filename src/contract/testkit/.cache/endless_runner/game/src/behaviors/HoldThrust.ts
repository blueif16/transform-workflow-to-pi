/**
 * ============================================================================
 * HoldThrust — the hold-to-rise thrust verb (BUILD — behavior)
 * ============================================================================
 *
 * The CORE engine of the `endless_runner:hold-to-rise` (Jetpack Joyride / Helicopter)
 * genre: while the button is HELD, an upward thrust acceleration fights gravity and the
 * avatar RISES; the moment it is RELEASED, gravity wins and the avatar falls. Unlike the
 * edge-triggered gravity-FLAP (one fixed impulse per tap), thrust is a SUSTAINED, analog
 * verb — the player feathers altitude by how long they hold, and weaves the vertical
 * hazards the scroller streams in. The avatar x is fixed; the world scrolls past it.
 *
 * THE TWO-FORCE MODEL (the whole flight feel):
 *   - HELD   → vy += (−thrustAccel + gravity)·dt  ⇒ net UP (thrustAccel > gravity).
 *   - RELEASED → vy += gravity·dt                 ⇒ net DOWN (free fall).
 *   Both directions are clamped: vy ∈ [−maxRiseSpeed, +maxFallSpeed] — the fairness cap
 *   (INV-PASSABLE) so neither shooting up off the ceiling nor plummeting makes a gap
 *   UNAVOIDABLE; every vertical lane stays recoverable.
 *
 * HEADLESS-DRIVEABLE (the controllable proof): the held-state is owned by THIS behavior.
 * Like the runner's GravityFlapScheme — an endless runner introduces a new engine with no
 * scene-owned analog input to reuse — the behavior SENSES raw DOM (keydown/keyup +
 * pointerdown/up + touchstart/end) into one boolean `thrusting`. A harness fires a real
 * `keydown` → thrusting=true → the next update() pushes vy negative (rises); a `keyup` →
 * thrusting=false → vy goes positive (falls). It also exposes `flap()` (a one-frame thrust
 * pulse) so the data scene's existing one-button drain (scheme.sample().flap → movement.flap())
 * still drives a rise without any scene re-wiring — the scene owns WHEN, this owns WHAT.
 *
 * THE EVENT SEAM (the PUSH channel): `thrust.changed` fires ONLY on a real state TOGGLE
 * (press: off→on, release: on→off), never every frame — so __GAME__.events records the
 * player's intent transitions, and the payload carries the toggled state + the live vy the
 * verify witness reads.
 *
 * GENERIC: every number is a config param (no game/theme). The owner is any sprite with a
 * Phaser arcade body; the behavior writes body.velocity.y + the owner's vy/vx mirror, which
 * the hook surfaces as __GAME__.player.vy / .y. It reaches the scene the way the platformer
 * behaviors do — `owner.scene` — for the shared eventBus.
 */
import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import { type ComponentSurface } from '@contract/component-surface';

export interface HoldThrustConfig {
  /** Upward acceleration (px/s², positive magnitude) applied to vy while HELD. Must exceed gravity to rise. */
  thrustAccel?: number;
  /** Downward acceleration (px/s²) always applied (the constant pull the thrust fights). */
  gravity?: number;
  /** Terminal RISE-speed cap (px/s, positive magnitude) — the upward fairness clamp. */
  maxRiseSpeed?: number;
  /** Terminal FALL-speed cap (px/s, positive magnitude) — the downward fairness clamp. */
  maxFallSpeed?: number;
}

/** Sensible declared defaults (the hold-to-rise feel; re-tuned per game via params). */
const DEFAULTS: Required<HoldThrustConfig> = {
  thrustAccel: 2200,
  gravity: 1200,
  maxRiseSpeed: 420,
  maxFallSpeed: 520,
};

/** Keys that engage thrust (Space + the up keys — the one-button binding, mirrors the flap scheme). */
const THRUST_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W']);

export class HoldThrust extends BaseBehavior {
  private readonly thrustAccel: number;
  private readonly gravity: number;
  private readonly maxRiseSpeed: number;
  private readonly maxFallSpeed: number;

  /** True while the button is held (the sustained, analog intent — the genre's heart). */
  private thrusting = false;
  /** The thrust state at the last emit — `thrust.changed` fires only when this flips. */
  private lastEmitted = false;
  /** A one-frame pulse the scene's edge-drain (movement.flap()) sets — a tap = a brief rise. */
  private pulseFrames = 0;

  constructor(config: HoldThrustConfig = {}) {
    super();
    this.thrustAccel = config.thrustAccel ?? DEFAULTS.thrustAccel;
    this.gravity = config.gravity ?? DEFAULTS.gravity;
    this.maxRiseSpeed = config.maxRiseSpeed ?? DEFAULTS.maxRiseSpeed;
    this.maxFallSpeed = config.maxFallSpeed ?? DEFAULTS.maxFallSpeed;
  }

  /** Attach the held-button DOM listeners (the behavior owns its own input — headless-driveable). */
  protected onAttach(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('pointerdown', this.pointerDown);
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('touchstart', this.touchStart, { passive: false } as AddEventListenerOptions);
    window.addEventListener('touchend', this.touchEnd);
  }

  /** Detach the DOM listeners + clear state (teardown / restart — INV-RESET). */
  protected onDetach(): void {
    this.thrusting = false;
    this.lastEmitted = false;
    this.pulseFrames = 0;
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('pointerdown', this.pointerDown);
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('touchstart', this.touchStart);
    window.removeEventListener('touchend', this.touchEnd);
  }

  private keyDown = (e: KeyboardEvent) => {
    if (THRUST_KEYS.has(e.key) || e.code === 'Space' || e.code === 'ArrowUp') {
      this.thrusting = true;
      if (e.code === 'Space') e.preventDefault(); // Space scrolls the page by default — suppress it.
    }
  };
  private keyUp = (e: KeyboardEvent) => {
    if (THRUST_KEYS.has(e.key) || e.code === 'Space' || e.code === 'ArrowUp') this.thrusting = false;
  };
  private pointerDown = () => {
    this.thrusting = true;
  };
  private pointerUp = () => {
    this.thrusting = false;
  };
  private touchStart = (e: TouchEvent) => {
    this.thrusting = true;
    if (e.cancelable) e.preventDefault(); // one touch = one held thrust (no synthetic mouse).
  };
  private touchEnd = () => {
    this.thrusting = false;
  };

  /**
   * The one-button compatibility seam: the data scene drains its edge scheme and calls
   * movement.flap() on a press. We translate that one-shot into a brief held pulse so a TAP
   * still produces a rise under the existing scene wiring — the sustained hold is the real verb.
   */
  flap(): void {
    this.pulseFrames = 6; // ~0.1s of thrust per discrete tap.
  }

  update(): void {
    if (!this.enabled) return;
    const owner = this.owner;
    if (!owner) return;
    const body = owner.body as { velocity: { y: number } } | undefined;
    if (!body) return;

    // The held intent OR a brief tap-pulse engages thrust this frame.
    const pulsing = this.pulseFrames > 0;
    if (pulsing) this.pulseFrames -= 1;
    const thrustingNow = this.thrusting || pulsing;

    const dt = 1 / 60;
    // Gravity always pulls down; thrust (when engaged) fights it. Net up iff thrustAccel > gravity.
    body.velocity.y += this.gravity * dt;
    if (thrustingNow) body.velocity.y -= this.thrustAccel * dt;

    // The fairness caps (INV-PASSABLE): clamp both rise and fall so every gap stays recoverable.
    if (body.velocity.y < -this.maxRiseSpeed) body.velocity.y = -this.maxRiseSpeed;
    if (body.velocity.y > this.maxFallSpeed) body.velocity.y = this.maxFallSpeed;

    // Mirror onto the owner for the hook surface (__GAME__.player.vy/.y); x is fixed (world scrolls).
    owner.vy = body.velocity.y;
    owner.vx = 0;

    // The PUSH seam: emit thrust.changed ONLY on a real state toggle (press/release), never per frame.
    if (thrustingNow !== this.lastEmitted) {
      this.lastEmitted = thrustingNow;
      this.bus?.emit('thrust.changed', { thrusting: thrustingNow, vy: owner.vy });
    }
  }
}

/**
 * CAPABILITY — the registry sidecar (discover.mjs globs this). The drift-gated `behavior`
 * capability the blueprint binds by id. CODE is the source of truth.
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'HoldThrust',
  intent:
    'Hold-to-rise thrust locomotion (Jetpack Joyride / Helicopter): while the button is HELD an upward thrust acceleration fights constant gravity and the avatar rises; on RELEASE gravity wins and it falls. A sustained, analog verb (feathered by hold duration) — not an edge-tap impulse. Rise and fall speeds are both clamped so every vertical gap stays recoverable. The avatar x is fixed; the world scrolls past it.',
  implements: 'HoldThrust',
  roles: ['player'],
  params: ['thrustAccel', 'gravity', 'maxRiseSpeed', 'maxFallSpeed'],
  tuning: ['thrustAccel', 'gravity', 'maxRiseSpeed', 'maxFallSpeed'],
} as const;

/**
 * The PUSH channel this behavior publishes (the CLAIM the catalog/gates read). One true
 * statement per real emit site:
 *   - thrust.changed ← update() on a state TOGGLE (button pressed→thrusting, or released→falling) [archetype]
 */
export function surface(): ComponentSurface {
  return {
    observables: {},
    anchors: [],
    events: [
      {
        name: 'thrust.changed',
        payload: '{thrusting, vy}',
        scope: 'archetype',
        drivenBy: 'holding or releasing the thrust button',
        expect:
          "the player's thrust state toggles and __GAME__.player.vy responds (negative/rising while held, positive/falling on release); thrust.changed logged",
      },
    ],
  };
}
