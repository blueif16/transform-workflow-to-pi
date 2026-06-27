/**
 * ============================================================================
 * BeatGate — beat-synced timing gates scored by tap accuracy (BUILD — system)
 * ============================================================================
 *
 * The scoring heart of the `endless_runner:rhythm-runner` genre's timing layer: the run
 * is paced by a SEEDED BEAT TRACK (the same deterministic rhythm spine BeatFlap rides),
 * and on every beat a GATE is "open" for a brief window. A TAP landing inside that window
 * is GRADED by how close it was to the beat — PERFECT (dead-on), GOOD (inside the window
 * but loose), or MISS (outside the window / no beat nearby). A graded hit adds an
 * accuracy-scaled bonus to the engine score, so playing tightly on-beat pays more than
 * mashing — the rhythm-runner risk-reward, in one system.
 *
 * THE SEEDED BEAT TRACK (the rhythm spine — INV-DETERMINISTIC): the gates are NOT random.
 * A `beatSeed` + a fixed `beatPeriodFrames` cadence yield a reproducible sequence of beat
 * frames (mirrors BeatFlap's track), so every run with the same seed has the identical
 * gate timing — the rhythm is authored, never capricious. Each beat is identified by its
 * monotonic INDEX in the seeded track (the id source: the config-seeded beat track), so a
 * `beat.hit` payload names exactly which gate was struck.
 *
 * THE TIMING WINDOW + GRADE (the contract — the observable __GAME__ transition): a tap's
 * frame-distance to the NEAREST beat is measured against two nested windows:
 *   - within `perfectWindowFrames`  → PERFECT (full `perfectScore` points)
 *   - within `beatWindowFrames`     → GOOD    (`goodScore` points)
 *   - otherwise                     → MISS    (zero points; the gate was missed)
 * The last grade is published on `scene.beatAccuracy` AND the engine score advances by the
 * grade's points (scene.setScore → __GAME__.score), so the witness observes the timing
 * grade reflected directly in accuracy + score. ONE gate is scored at most once (a per-beat
 * latch), so holding/mashing inside one window cannot farm a single gate.
 *
 * HEADLESS-DRIVEABLE (load-bearing for the controllable proof + the verify harness): like
 * GravityFlapScheme (the runner has no scene-owned input to reuse, so a component senses
 * raw DOM itself), BeatGate listens for real `keydown` (Space / ArrowUp / W), `pointerdown`,
 * and `touchstart` and registers each as a TAP — the SAME inputs the player flaps with also
 * register a beat tap. It ALSO exposes a public `tap()` verb so a harness can drive the
 * grade directly without the DOM. A harness that ticks the beat clock to a beat frame then
 * fires a real keydown (or calls tap()) inside the window observes accuracy + score move
 * (the drivenBy → expect proof for beat.hit).
 *
 * THE INVARIANTS IT ENFORCES:
 *   - INV-DETERMINISTIC: the beat frames come from a SEEDED cadence (beatSeed + the fixed
 *     period), NEVER Math.random() — same seed ⇒ the identical gate timing (replayable).
 *   - INV-SCORE-ONCE: a per-beat `scored` latch grades each gate at most once, so one beat
 *     cannot be farmed by repeated taps inside its window.
 *   - INV-RESET: reset() zeroes the beat clock, the score latches, and the published
 *     accuracy so a restarted run grades from a clean track (no leaked grade/score).
 *
 * GENERIC: no game/theme, no baked coordinate. Every number is a DECLARED default,
 * re-tunable via params. It reads the shared bus the way a sibling does — via the live
 * scene (scene.eventBus) — and writes the engine's ONE score channel (scene.setScore).
 */
import type { ISceneSystem } from '../scenes/runner-data';
import { type EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'BeatGate',
  intent:
    'Beat-synced timing gates on the seeded rhythm track: every beat opens a brief gate, and a tap landing inside the window is graded by closeness to the beat — perfect / good / miss. A graded hit adds accuracy-scaled points to the score and publishes the grade, so playing tightly on-beat pays more than mashing. The gates come from a seeded, deterministic cadence (replayable), and each gate is scored at most once. The rhythm-runner timing-accuracy layer.',
  attachesTo: 'scene',
  params: [
    'beatPeriodFrames',
    'beatWindowFrames',
    'perfectWindowFrames',
    'beatSeed',
    'perfectScore',
    'goodScore',
  ],
  tuning: ['beatPeriodFrames', 'beatWindowFrames', 'perfectWindowFrames', 'perfectScore', 'goodScore'],
  roles: ['player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** The timing grade a tap earns against the nearest beat gate. */
export type BeatGrade = 'perfect' | 'good' | 'miss';

/** Per-game tuning for the beat gates (every field DECLARED with a sensible default). */
export interface BeatGateConfig {
  /** Frames between successive beats of the seeded track (the cadence — matches BeatFlap). Default 30. */
  beatPeriodFrames?: number;
  /** Tolerance (frames) around a beat within which a tap counts as a GOOD hit. Default 6. */
  beatWindowFrames?: number;
  /** The tighter inner window (frames) within which a tap counts as PERFECT. Default 2. */
  perfectWindowFrames?: number;
  /** Deterministic seed for the beat track (INV-DETERMINISTIC) — pairs with BeatFlap's. Default 1337. */
  beatSeed?: number;
  /** Score awarded for a PERFECT hit. Default 3. */
  perfectScore?: number;
  /** Score awarded for a GOOD hit. Default 1. */
  goodScore?: number;
}

/** Declared defaults (the rhythm-runner timing-accuracy feel). Re-tuned per game via params. */
const DEF = {
  beatPeriodFrames: 30,
  beatWindowFrames: 6,
  perfectWindowFrames: 2,
  beatSeed: 1337,
  perfectScore: 3,
  goodScore: 1,
};

export class BeatGate implements ISceneSystem {
  private scene: any;
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly beatPeriodFrames: number;
  private readonly beatWindowFrames: number;
  private readonly perfectWindowFrames: number;
  private readonly beatSeed: number;
  private readonly perfectScore: number;
  private readonly goodScore: number;

  /** Local frame counter (the beat clock — independent of the scene's frame). */
  private frame = 0;
  /** Set true by a DOM input / tap(); the next update() judges it once (edge). */
  private tapQueued = false;
  /** Beat indices already scored this run — INV-SCORE-ONCE (one grade per gate). */
  private readonly scoredBeats = new Set<number>();
  /** The last grade published (the observable contract). */
  private lastGrade: BeatGrade | 'none' = 'none';
  /** Running counts (diagnostics / observable). */
  private hits = 0;
  private perfects = 0;

  constructor(params: BeatGateConfig = {}) {
    this.beatPeriodFrames = Math.max(1, params.beatPeriodFrames ?? DEF.beatPeriodFrames);
    this.beatWindowFrames = params.beatWindowFrames ?? DEF.beatWindowFrames;
    this.perfectWindowFrames = params.perfectWindowFrames ?? DEF.perfectWindowFrames;
    this.beatSeed = params.beatSeed ?? DEF.beatSeed;
    this.perfectScore = params.perfectScore ?? DEF.perfectScore;
    this.goodScore = params.goodScore ?? DEF.goodScore;
  }

  reset(): void {
    this.frame = 0;
    this.tapQueued = false;
    this.scoredBeats.clear();
    this.lastGrade = 'none';
    this.hits = 0;
    this.perfects = 0;
    if (this.scene) {
      this.scene.beatAccuracy = 'none';
      this.scene.beatHits = 0;
    }
    this.detachInput();
  }

  attach(scene: any): void {
    this.scene = scene;
    this.frame = 0;
    this.tapQueued = false;
    this.scoredBeats.clear();
    this.lastGrade = 'none';
    this.hits = 0;
    this.perfects = 0;
    // Publish the live grade + hit count (single source of truth — the hook/observable reads it).
    scene.beatAccuracy = 'none';
    scene.beatHits = 0;
    // Sense raw DOM input ourselves (the runner pattern — GravityFlapScheme does the same):
    // the same tap that flaps also registers a beat tap. Headless-driveable via a real keydown.
    this.attachInput();
  }

  /**
   * The TAP verb (headless-driveable). SETS the queued-tap edge; the next update() judges
   * it against the nearest beat exactly once. A real keydown/pointerdown drives it, OR a
   * harness calls it directly. Idempotent within a frame.
   */
  tap(): void {
    this.tapQueued = true;
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    const avatar = scene.player;
    // Stop grading once the run is over (no posthumous scoring).
    if (avatar?.isDead) {
      this.tapQueued = false;
      return;
    }

    this.frame += 1;

    // Judge a queued tap against the nearest beat of the seeded track (edge — once per tap).
    if (this.tapQueued) {
      this.tapQueued = false;
      this.judgeTap();
    }
  }

  /**
   * Grade the current-frame tap against the NEAREST beat gate of the seeded track.
   * The nearest beat index + the frame-distance to it decide perfect / good / miss; a
   * graded hit scores once and publishes the grade + score. INV-SCORE-ONCE via the latch.
   */
  private judgeTap(): void {
    const phase = this.frame % this.beatPeriodFrames;
    // Distance (frames) to the nearest beat (a beat lands at phase 0 of each period).
    const dist = Math.min(phase, this.beatPeriodFrames - phase);
    // The nearest beat's index in the seeded track (rounds to the closer of the two).
    const beat =
      phase <= this.beatPeriodFrames - phase
        ? Math.floor(this.frame / this.beatPeriodFrames)
        : Math.floor(this.frame / this.beatPeriodFrames) + 1;

    let grade: BeatGrade;
    let points = 0;
    if (dist > this.beatWindowFrames || this.scoredBeats.has(beat)) {
      // Outside the window, or this gate was already scored — a MISS (no points).
      grade = 'miss';
    } else {
      // Inside the window: lock this gate (INV-SCORE-ONCE) and grade by closeness.
      this.scoredBeats.add(beat);
      if (dist <= this.perfectWindowFrames) {
        grade = 'perfect';
        points = this.perfectScore;
        this.perfects += 1;
      } else {
        grade = 'good';
        points = this.goodScore;
      }
      this.hits += 1;
    }

    // The OBSERVABLE transitions: publish the grade and advance the engine score by it.
    this.lastGrade = grade;
    this.scene.beatAccuracy = grade;
    this.scene.beatHits = this.hits;
    if (points > 0) this.writeScore(this.currentScore() + points);

    // The PUSH seam: a tap was judged at a beat gate — accuracy + score reflect the grade.
    this.bus?.emit('beat.hit', {
      beat,
      grade,
      offset: dist,
      score: this.currentScore(),
    });
  }

  /** Read the current engine score (the single source — registry/getScore). */
  private currentScore(): number {
    const scene = this.scene;
    if (typeof scene.getScore === 'function') return Number(scene.getScore() ?? 0);
    if (scene.registry && typeof scene.registry.get === 'function') {
      return Number(scene.registry.get('score') ?? 0);
    }
    return 0;
  }

  /** Write the single score source (the engine's score channel; the hook reads it). */
  private writeScore(value: number): void {
    const scene = this.scene;
    if (typeof scene.setScore === 'function') scene.setScore(value);
    else if (scene.registry && typeof scene.registry.set === 'function') {
      scene.registry.set('score', value);
    }
  }

  // ── raw DOM input (the runner self-senses; mirrors GravityFlapScheme) ──────────

  /** The key names that register a tap (Space + the up keys — the one-button binding). */
  private static readonly TAP_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W']);

  private onKeyDown = (e: KeyboardEvent) => {
    if (BeatGate.TAP_KEYS.has(e.key) || e.code === 'Space' || e.code === 'ArrowUp') {
      this.tap();
    }
  };
  private onPointerDown = () => {
    this.tap();
  };
  private onTouchStart = () => {
    this.tap();
  };

  /** Attach the DOM listeners (idempotent — detach first so a restart never double-binds). */
  private attachInput(): void {
    if (typeof window === 'undefined') return;
    this.detachInput();
    window.addEventListener('keydown', this.onKeyDown);
    const target: EventTarget = (this.scene?.game?.canvas as HTMLCanvasElement) ?? window;
    target.addEventListener('pointerdown', this.onPointerDown as EventListener);
    target.addEventListener('touchstart', this.onTouchStart as EventListener);
  }

  /** Detach the DOM listeners (teardown / restart). */
  private detachInput(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.onKeyDown);
    const target: EventTarget = (this.scene?.game?.canvas as HTMLCanvasElement) ?? window;
    target.removeEventListener('pointerdown', this.onPointerDown as EventListener);
    target.removeEventListener('touchstart', this.onTouchStart as EventListener);
  }

  /**
   * The PUSH + PULL channels this system publishes (one true statement per real seam):
   *   - beat.hit ← judgeTap (a tap was judged at a beat gate of the seeded track) [archetype]
   *   - observable beatAccuracy ← the last timing grade this system computed
   */
  surface(): ComponentSurface {
    return {
      observables: {
        beatAccuracy: () => this.lastGrade,
      },
      anchors: [],
      events: [
        {
          name: 'beat.hit',
          payload: '{beat,grade,offset,score}',
          scope: 'archetype',
          drivenBy: 'a tap landing inside a beat gate window on the seeded track',
          expect:
            "__GAME__ accuracy/score reflects the timing grade — a tap near a beat grades perfect/good (scene.beatAccuracy + __GAME__.score advance by the grade's points), a tap outside the window grades miss (no score change); beat.hit logged",
        },
      ],
    };
  }
}
