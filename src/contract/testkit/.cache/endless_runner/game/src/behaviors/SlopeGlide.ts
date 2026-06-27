/**
 * ============================================================================
 * SlopeGlide — the dive-to-accumulate / release-to-launch momentum verb (BUILD — behavior)
 * ============================================================================
 *
 * The CORE engine of the `endless_runner:slope-glider` (Tiny Wings / Alto's Adventure /
 * Ski Safari) genre: the avatar glides over a rolling terrain of alternating DOWN- and
 * UP-slopes. The one input is HOLD-to-DIVE — while held, the avatar tucks into the slope:
 *   - on a DOWN-slope a dive STEEPENS the descent, so gravity-along-the-slope ACCUMULATES
 *     momentum (the speed builds — the "tuck and gain speed" of Tiny Wings); and
 *   - on an UP-slope, RELEASING the dive LAUNCHES — the carried momentum is spent as an
 *     upward burst (negative vy) off the lip, so the avatar arcs into the air.
 * The momentum SCALAR is the heart of the feel: it is never reset between slopes — it
 * CARRIES (only bled by a small drag), so a perfectly-timed dive→release chain rolls
 * speed forward slope after slope (the genre's flow-state combo).
 *
 * THE THREE-PART MODEL (the whole glide feel):
 *   - terrain phase: a self-owned slope oscillation advances with the world scroll; its
 *     SIGN is the current slope (down vs up). The world scrolls past the fixed-x avatar
 *     (ObstacleScrollSystem), so the behavior tracks the slope phase itself — like the
 *     other runner verbs that own their own state rather than reading scene geometry.
 *   - momentum: a carried speed scalar. DIVING on a down-slope adds `diveAccel·dt`;
 *     gliding always bleeds `drag·dt` (so it asymptotes, never runs away). It carries
 *     across slopes (the combo) and is clamped to `maxMomentum` (the fairness cap, so a
 *     launch is never unrecoverable — INV-PASSABLE).
 *   - launch: RELEASING the dive on an UP-slope converts the carried momentum into an
 *     upward velocity burst (`vy = -momentum·launchScale`), spending a `launchCost` of it.
 *     The bigger the carried momentum, the higher the launch — the reward for the chain.
 *
 * HEADLESS-DRIVEABLE (the controllable proof): the held-state is owned by THIS behavior,
 * mirroring HoldThrust — an endless runner has no scene-owned analog input to reuse, so
 * the behavior SENSES raw DOM (keydown/keyup + pointerdown/up + touchstart/end) into one
 * boolean `diving`. A harness fires a real `keydown` on a down-slope → diving=true → the
 * next update() accumulates momentum (owner.vy grows); a `keyup` on an up-slope → a launch
 * (owner.vy goes negative). It also exposes `flap()` (a one-frame dive pulse) so the data
 * scene's existing one-button edge-drain (scheme.sample().flap → movement.flap()) still
 * drives momentum without any scene re-wiring — the scene owns WHEN, this owns WHAT.
 *
 * THE EVENT SEAM (the PUSH channel): `momentum.changed` fires at the two true gameplay
 * seams — (a) a dive on a DOWN-slope that adds a discrete STEP of momentum, and (b) a
 * RELEASE on an UP-slope that LAUNCHES — never every frame. Its payload carries the live
 * momentum + vy + phase the verify witness reads, so __GAME__ records the speed building
 * then carrying.
 *
 * GENERIC: every number is a config param (no game/theme). The owner is any sprite with a
 * Phaser arcade body; the behavior writes body.velocity.y + the owner's vy/vx mirror,
 * which the hook surfaces as __GAME__.player.vy / .y (vx stays 0 — the world scrolls). It
 * reaches the shared bus the way a sibling does — via the owner's scene (`owner.scene`).
 */
import { BaseBehavior } from './IBehavior';
import { type ComponentSurface } from '@contract/component-surface';

export interface SlopeGlideConfig {
  /** Momentum (speed units) gained per second while DIVING down a slope. */
  diveAccel?: number;
  /** Momentum bled per second always (the asymptotic drag — momentum never runs away). */
  drag?: number;
  /** Terminal momentum cap (the fairness clamp — a launch is never unrecoverable). */
  maxMomentum?: number;
  /** Fraction of carried momentum converted to upward launch velocity on an up-slope release. */
  launchScale?: number;
  /** Momentum spent per launch (so a launch costs speed — the dive/release rhythm). */
  launchCost?: number;
  /** Constant downward gravity (px/s²) integrated into vy between launches (the descent). */
  gravity?: number;
  /** Terminal fall-speed cap (px/s) — keeps lower hazards recoverable (INV-PASSABLE). */
  maxFallSpeed?: number;
  /** Angular speed (rad/s) the self-owned terrain-slope phase advances at (slope cadence). */
  slopeRate?: number;
  /** Momentum increment between two `momentum.changed` emits while diving (avoids per-frame spam). */
  emitStep?: number;
}

/** Sensible declared defaults (the slope-glide feel; re-tuned per game via params). */
const DEFAULTS: Required<SlopeGlideConfig> = {
  diveAccel: 420,
  drag: 90,
  maxMomentum: 900,
  launchScale: 0.7,
  launchCost: 280,
  gravity: 1400,
  maxFallSpeed: 600,
  slopeRate: 1.6,
  emitStep: 80,
};

/** Keys that engage the dive (Space + the down/up one-button bindings; mirrors HoldThrust). */
const DIVE_KEYS = new Set([' ', 'Spacebar', 'ArrowDown', 'ArrowUp', 's', 'S', 'w', 'W']);

export class SlopeGlide extends BaseBehavior {
  private readonly diveAccel: number;
  private readonly drag: number;
  private readonly maxMomentum: number;
  private readonly launchScale: number;
  private readonly launchCost: number;
  private readonly gravity: number;
  private readonly maxFallSpeed: number;
  private readonly slopeRate: number;
  private readonly emitStep: number;

  /** True while the dive button is held (the analog intent — the genre's heart). */
  private diving = false;
  /** The dive state last seen by update() — a release edge (true→false) can launch. */
  private wasDiving = false;
  /** A one-frame pulse the scene's edge-drain (movement.flap()) sets — a tap = a brief dive. */
  private pulseFrames = 0;
  /** The carried momentum scalar — accumulates on dives, CARRIES across slopes (the combo). */
  private momentum = 0;
  /** The momentum at the last `momentum.changed` emit — re-emits only after an emitStep delta. */
  private lastEmitMomentum = 0;
  /** The self-owned terrain-slope phase (rad). Its sign = the current slope (down vs up). */
  private slopePhase = 0;

  constructor(config: SlopeGlideConfig = {}) {
    super();
    this.diveAccel = config.diveAccel ?? DEFAULTS.diveAccel;
    this.drag = config.drag ?? DEFAULTS.drag;
    this.maxMomentum = config.maxMomentum ?? DEFAULTS.maxMomentum;
    this.launchScale = config.launchScale ?? DEFAULTS.launchScale;
    this.launchCost = config.launchCost ?? DEFAULTS.launchCost;
    this.gravity = config.gravity ?? DEFAULTS.gravity;
    this.maxFallSpeed = config.maxFallSpeed ?? DEFAULTS.maxFallSpeed;
    this.slopeRate = config.slopeRate ?? DEFAULTS.slopeRate;
    this.emitStep = config.emitStep ?? DEFAULTS.emitStep;
  }

  /** Attach the held-button DOM listeners (the behavior owns its own input — headless-driveable). */
  protected onAttach(): void {
    this.resetState();
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
    this.resetState();
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('pointerdown', this.pointerDown);
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('touchstart', this.touchStart);
    window.removeEventListener('touchend', this.touchEnd);
  }

  private resetState(): void {
    this.diving = false;
    this.wasDiving = false;
    this.pulseFrames = 0;
    this.momentum = 0;
    this.lastEmitMomentum = 0;
    this.slopePhase = 0;
  }

  private keyDown = (e: KeyboardEvent) => {
    if (DIVE_KEYS.has(e.key) || e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      this.diving = true;
      if (e.code === 'Space') e.preventDefault(); // Space scrolls the page by default — suppress it.
    }
  };
  private keyUp = (e: KeyboardEvent) => {
    if (DIVE_KEYS.has(e.key) || e.code === 'Space' || e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      this.diving = false;
    }
  };
  private pointerDown = () => {
    this.diving = true;
  };
  private pointerUp = () => {
    this.diving = false;
  };
  private touchStart = (e: TouchEvent) => {
    this.diving = true;
    if (e.cancelable) e.preventDefault(); // one touch = one held dive (no synthetic mouse).
  };
  private touchEnd = () => {
    this.diving = false;
  };

  /**
   * The one-button compatibility seam: the data scene drains its edge scheme and calls
   * movement.flap() on a press. We translate that one-shot into a brief held dive so a TAP
   * still builds momentum under the existing scene wiring — the sustained hold is the real verb.
   */
  flap(): void {
    this.pulseFrames = 6; // ~0.1s of dive per discrete tap.
  }

  /** True iff the current terrain phase is a DOWN-slope (the diving accumulation window). */
  private onDownSlope(): boolean {
    // sin(phase) > 0 over the descending quarter — the surface tilts downhill.
    return Math.sin(this.slopePhase) > 0;
  }

  update(): void {
    if (!this.enabled) return;
    const owner = this.owner;
    if (!owner) return;
    const body = owner.body as { velocity: { y: number } } | undefined;
    if (!body) return;

    const dt = 1 / 60;

    // Advance the self-owned terrain-slope phase (its sign is the current slope).
    this.slopePhase += this.slopeRate * dt;

    // The held intent OR a brief tap-pulse engages the dive this frame.
    const pulsing = this.pulseFrames > 0;
    if (pulsing) this.pulseFrames -= 1;
    const divingNow = this.diving || pulsing;
    const downSlope = this.onDownSlope();

    // ── momentum integration: diving DOWN a slope accumulates; drag always bleeds ──────
    let accumulatedStep = false;
    if (divingNow && downSlope) {
      this.momentum += this.diveAccel * dt; // tuck-and-gain (the speed builds).
    }
    this.momentum -= this.drag * dt; // asymptotic bleed — momentum never runs away.
    if (this.momentum > this.maxMomentum) this.momentum = this.maxMomentum; // fairness cap.
    if (this.momentum < 0) this.momentum = 0;

    // ── launch: RELEASING the dive on an UP-slope spends momentum as an upward burst ───
    let launched = false;
    const releaseEdge = this.wasDiving && !divingNow; // the release edge this frame.
    if (releaseEdge && !downSlope && this.momentum > 0) {
      // Convert carried momentum to upward velocity; spend a launchCost of it (it CARRIES).
      body.velocity.y = -this.momentum * this.launchScale;
      this.momentum = Math.max(0, this.momentum - this.launchCost);
      launched = true;
    } else {
      // Between launches, gravity integrates the descent (the glide back to the slope).
      body.velocity.y += this.gravity * dt;
    }

    // The fairness cap (INV-PASSABLE): clamp terminal fall speed so lower hazards stay recoverable.
    if (body.velocity.y > this.maxFallSpeed) body.velocity.y = this.maxFallSpeed;

    // Detect a discrete momentum STEP while diving (so we emit on accumulation, not per frame).
    if (divingNow && downSlope && this.momentum - this.lastEmitMomentum >= this.emitStep) {
      accumulatedStep = true;
    }

    // Mirror onto the owner for the hook surface (__GAME__.player.vy/.y); x is fixed (world scrolls).
    owner.vy = body.velocity.y;
    owner.vx = 0;
    owner.momentum = this.momentum; // expose the carried-speed scalar for debugging/UI.

    // The PUSH seam: emit momentum.changed at the two TRUE seams — a dive-accumulation step
    // or an up-slope launch — never every frame.
    if (accumulatedStep || launched) {
      this.lastEmitMomentum = this.momentum;
      this.wasDiving = divingNow;
      this.bus?.emit('momentum.changed', {
        momentum: Math.round(this.momentum),
        vy: Math.round(owner.vy),
        phase: launched ? 'launch' : 'dive',
      });
      return;
    }

    this.wasDiving = divingNow;
  }
}

/**
 * CAPABILITY — the registry sidecar (discover.mjs globs this). The drift-gated `behavior`
 * capability the blueprint binds by id. CODE is the source of truth.
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'SlopeGlide',
  intent:
    'Dive-to-accumulate / release-to-launch momentum glide (Tiny Wings / Alto / Ski Safari): the avatar glides over rolling down/up slopes; HOLDING dive on a DOWN-slope accumulates a carried momentum scalar (tuck and gain speed), and RELEASING the dive on an UP-slope spends that momentum as an upward launch burst off the lip. Momentum CARRIES between slopes (only bled by drag, clamped by a fairness cap) so a timed dive→release chain rolls speed forward slope after slope. The avatar x is fixed; the world scrolls past it.',
  implements: 'SlopeGlide',
  roles: ['player'],
  params: ['diveAccel', 'drag', 'maxMomentum', 'launchScale', 'launchCost', 'gravity', 'maxFallSpeed', 'slopeRate', 'emitStep'],
  tuning: ['diveAccel', 'drag', 'maxMomentum', 'launchScale', 'launchCost', 'gravity', 'maxFallSpeed', 'slopeRate'],
} as const;

/**
 * The PUSH channel this behavior publishes (the CLAIM the catalog/gates read). One true
 * statement per real emit site:
 *   - momentum.changed ← update() at the two true seams: a dive-accumulation STEP on a
 *     down-slope (the carried momentum crossed an emitStep), or a RELEASE launch on an
 *     up-slope (momentum spent as an upward burst). [archetype]
 */
export function surface(): ComponentSurface {
  return {
    observables: {},
    anchors: [],
    events: [
      {
        name: 'momentum.changed',
        payload: '{momentum, vy, phase}',
        scope: 'archetype',
        drivenBy: 'diving down a slope (momentum accumulates) or releasing the dive on an up-slope (launch)',
        expect:
          "the carried momentum scalar accumulates as the player dives a down-slope and CARRIES forward; on an up-slope release __GAME__.player.vy goes negative (the avatar launches); momentum.changed logged",
      },
    ],
  };
}
