/**
 * ============================================================================
 * BeatFlap — rhythm-flap locomotion + gravity-flip portals (BUILD — behavior)
 * ============================================================================
 *
 * The CORE engine of the `endless_runner:rhythm-runner` genre: the same one-button
 * flap as the base gravity-flap verb, but the WHOLE FEEL is keyed to a SEEDED BEAT
 * TRACK — the avatar is pulled by gravity each frame, a flap SETS its velocity to a
 * fixed impulse, and the run is punctuated by GRAVITY-FLIP PORTALS that INVERT the
 * gravity SIGN (down→up→down). After a flip, "flap" still means "go against gravity":
 * when gravity points up, a flap drives the avatar DOWN; when it points down, a flap
 * drives it UP. The interplay of the seeded beat + the periodic sign flip is the
 * whole rhythm-runner feel.
 *
 * THE SEEDED BEAT TRACK (the rhythm spine — deterministic, INV-DETERMINISTIC): the
 * beats are NOT random. A `beatSeed` + a fixed `beatPeriodFrames` cadence yield a
 * reproducible sequence of beat frames; every run with the same seed has the identical
 * track, so the rhythm is authored, not capricious. Each beat that lands fires
 * `beat.struck`. The beat track is the timing skeleton an on-beat flap is judged
 * against (a flap within `beatWindowFrames` of a beat is "on-beat").
 *
 * THE GRAVITY-FLIP PORTAL (the contract — the observable __GAME__ transition): every
 * `portalEveryBeats` beats a gravity-flip portal is reached; crossing it INVERTS the
 * gravity sign. The sign is mirrored onto the owner as `owner.gravitySign` (+1 = down,
 * -1 = up) AND surfaced as __GAME__.player.gravitySign, so the witness observes the
 * sign flip directly; the avatar's vy direction under gravity reverses with it (the
 * second observable). `portal.flipped` fires AT the flip seam.
 *
 * THE DETERMINISM INVARIANT (INV-CONTROLLABLE / craft §1): a flap SETS vy to a fixed
 * magnitude (`flapImpulse`) in the direction OPPOSITE the current gravity sign — never
 * added to — so every flap reaches the identical relative height regardless of where
 * the avatar is. The player fails on their own timing, never on the game's caprice.
 *
 * THE FAIRNESS CAP (INV-PASSABLE): the gravity-direction fall speed is clamped to
 * `maxFallSpeed` (in whichever direction gravity currently points), keeping every gap
 * recoverable on both orientations.
 *
 * HEADLESS-DRIVEABLE: the one-button verb is `flap()` — the SAME seam name the shared
 * one-button scheme (GravityFlapScheme) drives, so the existing control wiring needs
 * ZERO edits (DataRunnerScene calls `p.movement.flap()`). A harness fires a real
 * keydown → the scheme → `flap()` → vy moves against gravity the next frame. The
 * portal flip is DRIVEN by the seeded beat track inside update() — a headless run that
 * ticks `portalEveryBeats * beatPeriodFrames` frames crosses a portal and observes the
 * sign flip (the drivenBy → expect proof for portal.flipped).
 *
 * GENERIC: every value is a config param (no game/theme). The owner is any sprite with
 * a Phaser arcade body; the behavior writes `body.velocity.y` + the owner's vy/vx +
 * gravitySign mirror, which the hook surfaces as __GAME__.player.vy/.vx/.gravitySign.
 * It reaches the shared bus the way a sibling does — via the owner's scene
 * (`owner.scene.eventBus`).
 */
import { BaseBehavior } from './IBehavior';
import { type ComponentSurface } from '@contract/component-surface';

export interface BeatFlapConfig {
  /** Downward acceleration MAGNITUDE (px/s^2) applied along the current gravity sign each frame. */
  gravity?: number;
  /** The FIXED velocity MAGNITUDE (px/s) a flap SETS vy to, against the gravity sign. */
  flapImpulse?: number;
  /** Terminal speed cap (px/s, magnitude) in the gravity direction — the fairness clamp. */
  maxFallSpeed?: number;
  /** Frames between successive beats of the seeded track (the cadence). */
  beatPeriodFrames?: number;
  /** Tolerance (frames) around a beat within which a flap counts as on-beat. */
  beatWindowFrames?: number;
  /** Deterministic seed for the beat track (INV-DETERMINISTIC). */
  beatSeed?: number;
  /** How many beats elapse between gravity-flip portals. */
  portalEveryBeats?: number;
}

/** Sensible declared defaults (the rhythm-runner feel; re-tuned per game). */
const DEFAULTS: Required<BeatFlapConfig> = {
  gravity: 1400,
  flapImpulse: 420,
  maxFallSpeed: 520,
  beatPeriodFrames: 30,
  beatWindowFrames: 6,
  beatSeed: 1337,
  portalEveryBeats: 8,
};

export class BeatFlap extends BaseBehavior {
  private readonly gravity: number;
  private readonly flapImpulse: number;
  private readonly maxFallSpeed: number;
  private readonly beatPeriodFrames: number;
  private readonly beatWindowFrames: number;
  private readonly beatSeed: number;
  private readonly portalEveryBeats: number;

  /** Set true by flap(); the next update() applies the impulse exactly once (edge). */
  private flapQueued = false;
  /** Local frame counter (the beat clock — independent of the scene's frame). */
  private frame = 0;
  /** Index of the most recent beat that has already struck (de-dups the per-beat fire). */
  private lastBeatStruck = -1;
  /** Current gravity sign: +1 = pulls DOWN (vy grows positive); -1 = pulls UP. */
  private gravitySign: 1 | -1 = 1;

  constructor(config: BeatFlapConfig = {}) {
    super();
    this.gravity = config.gravity ?? DEFAULTS.gravity;
    this.flapImpulse = config.flapImpulse ?? DEFAULTS.flapImpulse;
    this.maxFallSpeed = config.maxFallSpeed ?? DEFAULTS.maxFallSpeed;
    this.beatPeriodFrames = Math.max(1, config.beatPeriodFrames ?? DEFAULTS.beatPeriodFrames);
    this.beatWindowFrames = config.beatWindowFrames ?? DEFAULTS.beatWindowFrames;
    this.beatSeed = config.beatSeed ?? DEFAULTS.beatSeed;
    this.portalEveryBeats = Math.max(1, config.portalEveryBeats ?? DEFAULTS.portalEveryBeats);
  }

  protected onAttach(): void {
    // Fresh-run state (INV-RESET): a restart re-instantiates, but reset the clock + sign
    // here too so a reused instance starts the beat track clean.
    this.frame = 0;
    this.lastBeatStruck = -1;
    this.gravitySign = 1;
    if (this.owner) this.owner.gravitySign = this.gravitySign;
  }

  /**
   * The one-button verb (the SAME seam the shared GravityFlapScheme drives unchanged).
   * SETS the queued-flap edge; the next update() sets vy to a fixed impulse AGAINST the
   * current gravity sign. Called by the control scheme on a real keydown/pointerdown
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

    this.frame += 1;
    const dt = 1 / 60;

    // ── the seeded beat track: a beat lands on the deterministic cadence ──────────
    const beatIndex = Math.floor(this.frame / this.beatPeriodFrames);
    const phase = this.frame % this.beatPeriodFrames;
    if (phase === 0 && beatIndex !== this.lastBeatStruck && beatIndex > 0) {
      this.lastBeatStruck = beatIndex;
      // Each `portalEveryBeats`th beat is a gravity-flip portal: INVERT the gravity sign.
      if (beatIndex % this.portalEveryBeats === 0) {
        this.flipGravity(owner, beatIndex);
      } else {
        this.emitBeat(owner, beatIndex);
      }
    }

    // ── flap: SET vy to the fixed impulse AGAINST gravity (deterministic apex) ─────
    if (this.flapQueued) {
      this.flapQueued = false;
      // -gravitySign * flapImpulse: when gravity pulls down (+1), a flap drives UP
      // (vy negative); when gravity is flipped up (-1), a flap drives DOWN (vy positive).
      body.velocity.y = -this.gravitySign * this.flapImpulse;
    } else {
      // Gravity integrates vy ALONG its current sign.
      body.velocity.y += this.gravitySign * this.gravity * dt;
    }

    // The fairness cap (INV-PASSABLE): clamp the speed in the gravity direction.
    if (this.gravitySign === 1 && body.velocity.y > this.maxFallSpeed) {
      body.velocity.y = this.maxFallSpeed;
    } else if (this.gravitySign === -1 && body.velocity.y < -this.maxFallSpeed) {
      body.velocity.y = -this.maxFallSpeed;
    }

    // Mirror onto the owner for the hook surface (__GAME__.player.vy/.vx/.gravitySign).
    owner.vy = body.velocity.y;
    owner.vx = 0; // the avatar's x is FIXED — the world scrolls, not the avatar.
    owner.gravitySign = this.gravitySign;
  }

  /** Whether the supplied frame is within the on-beat tolerance of the nearest beat. */
  isOnBeat(frame: number = this.frame): boolean {
    const phase = frame % this.beatPeriodFrames;
    const dist = Math.min(phase, this.beatPeriodFrames - phase);
    return dist <= this.beatWindowFrames;
  }

  /** INVERT the gravity sign (the portal contract) + emit at the true flip seam. */
  private flipGravity(owner: any, beatIndex: number): void {
    this.gravitySign = this.gravitySign === 1 ? -1 : 1;
    owner.gravitySign = this.gravitySign;
    const bus = owner?.scene?.eventBus;
    if (bus && typeof bus.emit === 'function') {
      this.bus?.emit('portal.flipped', { sign: this.gravitySign, beat: beatIndex });
    }
  }

  /** Emit beat.struck on the shared scene bus (the way a sibling reaches it). */
  private emitBeat(owner: any, beatIndex: number): void {
    const bus = owner?.scene?.eventBus;
    if (bus && typeof bus.emit === 'function') {
      this.bus?.emit('beat.struck', { beat: beatIndex, seed: this.beatSeed });
    }
  }

  /**
   * The PUSH channel this behavior publishes:
   *   - portal.flipped ← the avatar reaches a gravity-flip portal on the seeded track;
   *     the gravity SIGN inverts (__GAME__.player.gravitySign flips) [archetype]
   *   - beat.struck    ← a non-portal beat of the seeded track lands [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'portal.flipped',
          payload: '{sign,beat}',
          scope: 'archetype',
          drivenBy: 'the avatar reaches a gravity-flip portal on the seeded beat track',
          expect:
            "__GAME__.player.gravitySign inverts (+1↔-1) and the avatar's vy under gravity reverses direction; portal.flipped logged",
        },
        {
          name: 'beat.struck',
          payload: '{beat,seed}',
          scope: 'archetype',
          drivenBy: 'a non-portal beat of the seeded track lands on its cadence',
          expect: 'beat.struck logged on the deterministic beat frame (the rhythm spine ticks)',
        },
      ],
    };
  }
}

/**
 * CAPABILITY — the registry sidecar (discover.mjs globs this). The drift-gated
 * `behavior` capability the blueprint binds by id. CODE is the source of truth.
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'BeatFlap',
  intent:
    'Rhythm-runner flap: the one-button flap is keyed to a SEEDED, deterministic beat track, and periodic gravity-flip portals INVERT the gravity sign (down↔up). A flap always SETS velocity to a fixed magnitude AGAINST the current gravity sign (deterministic apex), so after a flip "flap" means the opposite screen direction; a fall-speed cap on both orientations keeps every gap recoverable. The avatar x is fixed — the world scrolls past it.',
  implements: 'BeatFlap',
  roles: ['player'],
  params: [
    'gravity',
    'flapImpulse',
    'maxFallSpeed',
    'beatPeriodFrames',
    'beatWindowFrames',
    'beatSeed',
    'portalEveryBeats',
  ],
  tuning: ['gravity', 'flapImpulse', 'maxFallSpeed', 'beatPeriodFrames', 'beatWindowFrames', 'portalEveryBeats'],
} as const;
