/**
 * ============================================================================
 * AirTrick — the launch-into-a-trick, land-clean-for-a-reward verb (BUILD — behavior)
 * ============================================================================
 *
 * The companion reward verb of the `endless_runner:slope-glider` (Tiny Wings / Alto's
 * Adventure / Ski Safari) genre. SlopeGlide is the locomotion (dive to gain momentum,
 * release on an up-slope to LAUNCH off the lip into the air); AirTrick is what makes that
 * launch MATTER: while airborne off a BIG launch the avatar spins a trick, and the player
 * is rewarded for STICKING the landing — a clean landing grants a speed boost + a score
 * bonus, while a crash landing CANCELS the trick (no reward). It is the genre's risk/skill
 * layer (Alto's backflip): a higher, longer launch banks more air, but only if you land
 * it clean.
 *
 * THE STATE MACHINE (the whole trick loop), read entirely off the avatar's own vy — the
 * launch burst SlopeGlide writes (a strong negative vy) is the trigger, so this behavior
 * NEVER reaches into another component; it just senses the shared body the genre already
 * drives:
 *   - GROUNDED  → idle. A frame where vy crosses below −launchThreshold (a BIG upward
 *     burst off a slope lip) TRANSITIONS to AIRBORNE and starts the air-time clock.
 *   - AIRBORNE  → accumulate airTime each frame. While in the air vy climbs back through
 *     0 (the apex) and goes positive (the descent). A LANDING is the moment vy crosses
 *     back down past landThreshold while we still believe we are airborne, OR the avatar's
 *     downward speed is small enough to have "settled" — we read the descent edge.
 *   - LANDING   → judge the trick:
 *       • CLEAN  iff airTime ≥ minCleanAir AND the landing descent speed ≤ maxCleanFall
 *         (a controlled touchdown, not a slam). Apply the reward: bump the carried
 *         momentum (the speed boost the next dive/launch chain rolls forward) AND add a
 *         scoreBonus to the single score channel. EMIT `trick.landed`.
 *       • CRASH  otherwise (too little air or slammed down too hard) → the trick is
 *         canceled, NO reward, NO emit. The risk side of the risk/reward.
 *     Either way return to GROUNDED and reset the clock.
 *
 * THE OBSERVABLE EFFECT (the contract — a real __GAME__ transition): a clean landing
 * writes the engine's single score source (scene.setScore, surfaced as __GAME__.score) —
 * so __GAME__.score JUMPS by scoreBonus on a stuck landing — and bumps owner.momentum (the
 * carried-speed scalar SlopeGlide reads + exposes), so the reward is visible both as score
 * AND as carried speed. A crash landing moves neither.
 *
 * HEADLESS-DRIVEABLE (the controllable proof, mirroring SlopeGlide / HoldThrust): the
 * trigger is the avatar's vy, which a harness can drive directly — set owner.vy /
 * body.velocity.y strongly negative (a launch) then let it climb past landThreshold (a
 * clean descent) over enough frames and the next update() lands the trick: __GAME__.score
 * rises and trick.landed logs. No DOM input of its own — the verb is "what the body does
 * after a launch", so the launch (SlopeGlide's release, or a driven vy) IS the stimulus.
 *
 * THE EVENT SEAM (the PUSH channel): `trick.landed` fires ONCE per clean landing, at the
 * true touchdown seam — never per air frame, never on a crash. Its payload carries the
 * air time + the boost + the new score the verify witness reads.
 *
 * GENERIC: every number is a config param (no game/theme). The owner is any sprite with a
 * Phaser arcade body and a vy mirror; it reaches the shared bus + the score channel the way
 * a sibling does — via the owner's scene (`owner.scene`).
 */
import { BaseBehavior } from './IBehavior';
import { type ComponentSurface } from '@contract/component-surface';

export interface AirTrickConfig {
  /** Upward speed (px/s, magnitude) the launch burst must EXCEED to start a trick (a BIG launch). */
  launchThreshold?: number;
  /** Downward speed (px/s) crossing this on the descent counts as the landing touchdown. */
  landThreshold?: number;
  /** Minimum air time (seconds) for a landing to count as CLEAN (too little air = a crash). */
  minCleanAir?: number;
  /** Max downward speed (px/s) at touchdown for a CLEAN landing (faster = slammed = a crash). */
  maxCleanFall?: number;
  /** Momentum (speed units) added to owner.momentum on a clean landing (the speed boost). */
  boost?: number;
  /** Score added on a clean landing (the score reward — written to the single score channel). */
  scoreBonus?: number;
}

/** Sensible declared defaults (the slope-glide trick feel; re-tuned per game via params). */
const DEFAULTS: Required<AirTrickConfig> = {
  launchThreshold: 420, // a launch this strong (negative vy) is "big" enough to trick.
  landThreshold: 120, // descending faster than this counts as a touchdown.
  minCleanAir: 0.45, // ~0.45s aloft to have actually spun a trick.
  maxCleanFall: 520, // a controlled descent; above this the avatar slams (a crash).
  boost: 220, // carried-momentum bump on a stuck landing (rolls into the next launch).
  scoreBonus: 5, // score awarded per clean trick (the visible reward).
};

export class AirTrick extends BaseBehavior {
  private readonly launchThreshold: number;
  private readonly landThreshold: number;
  private readonly minCleanAir: number;
  private readonly maxCleanFall: number;
  private readonly boost: number;
  private readonly scoreBonus: number;

  /** True between a big launch and the next touchdown — the airborne / trick-in-progress window. */
  private airborne = false;
  /** Seconds accumulated since this trick's launch (the air-time clock — gates a clean landing). */
  private airTime = 0;
  /** The avatar's vy last frame — the rising→falling edge detects the descent past the threshold. */
  private prevVy = 0;

  constructor(config: AirTrickConfig = {}) {
    super();
    this.launchThreshold = config.launchThreshold ?? DEFAULTS.launchThreshold;
    this.landThreshold = config.landThreshold ?? DEFAULTS.landThreshold;
    this.minCleanAir = config.minCleanAir ?? DEFAULTS.minCleanAir;
    this.maxCleanFall = config.maxCleanFall ?? DEFAULTS.maxCleanFall;
    this.boost = config.boost ?? DEFAULTS.boost;
    this.scoreBonus = config.scoreBonus ?? DEFAULTS.scoreBonus;
  }

  /** Fresh start (the trick clock + edge state) — INV-RESET on attach/restart. */
  protected onAttach(): void {
    this.resetState();
  }

  /** Clear state on teardown / restart so a new run tricks from a clean slate. */
  protected onDetach(): void {
    this.resetState();
  }

  private resetState(): void {
    this.airborne = false;
    this.airTime = 0;
    this.prevVy = 0;
  }

  /** The avatar's current vertical velocity (the body is the source of truth; vy mirror is the fallback). */
  private readVy(owner: any): number {
    const body = owner.body as { velocity?: { y?: number } } | undefined;
    if (body?.velocity && typeof body.velocity.y === 'number') return body.velocity.y;
    return typeof owner.vy === 'number' ? owner.vy : 0;
  }

  update(): void {
    if (!this.enabled) return;
    const owner = this.owner;
    if (!owner || owner.isDead) return;

    const dt = 1 / 60;
    const vy = this.readVy(owner);

    if (!this.airborne) {
      // GROUNDED: a big upward launch burst (vy strongly negative) starts a trick.
      if (vy < -this.launchThreshold) {
        this.airborne = true;
        this.airTime = 0;
      }
      this.prevVy = vy;
      return;
    }

    // AIRBORNE: clock the air time; watch for the descent crossing the touchdown threshold.
    this.airTime += dt;

    // The touchdown edge: vy crossed from at/above the land threshold to below it this frame
    // (the avatar is now descending past the landing speed — it has come back down).
    const landed = this.prevVy < this.landThreshold && vy >= this.landThreshold;
    if (landed) {
      const clean = this.airTime >= this.minCleanAir && vy <= this.maxCleanFall;
      this.airborne = false;
      const bankedAir = this.airTime;
      this.airTime = 0;

      if (clean) {
        // Reward — the OBSERVABLE effect: bump carried momentum (the speed boost) AND add the
        // score bonus to the single score channel (__GAME__.score jumps).
        if (typeof owner.momentum === 'number') owner.momentum += this.boost;
        else owner.momentum = this.boost;

        const scene = owner.scene as
          | {
              getScore?: () => number;
              setScore?: (v: number) => void;
              eventBus?: { emit: (n: string, p: unknown) => void };
            }
          | undefined;

        let newScore = this.scoreBonus;
        if (scene && typeof scene.getScore === 'function' && typeof scene.setScore === 'function') {
          newScore = scene.getScore() + this.scoreBonus;
          scene.setScore(newScore);
        }

        // The PUSH seam: the trick was LANDED clean — fire once, at the true touchdown moment.
        this.bus?.emit('trick.landed', {
          airTime: Math.round(bankedAir * 100) / 100,
          boost: this.boost,
          score: newScore,
        });
      }
      // CRASH (not clean): the trick is canceled — no reward, no emit. The risk side.
    }

    this.prevVy = vy;
  }
}

/**
 * CAPABILITY — the registry sidecar (discover.mjs globs this). The drift-gated `behavior`
 * capability the blueprint binds by id. CODE is the source of truth.
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'AirTrick',
  intent:
    'Launch-into-a-trick, land-clean-for-a-reward (Alto\'s Adventure backflip / Ski Safari): when the slope-glide avatar LAUNCHES big off a slope lip (a strong upward burst) it spins an air trick; STICKING the landing — enough air time AND a controlled (not slammed) descent — grants a carried-momentum speed boost AND a score bonus, while a crash landing CANCELS the trick with no reward. The genre\'s risk/skill layer riding on the launch SlopeGlide produces; reads only the avatar\'s own vy, writes the single score channel + the carried momentum.',
  implements: 'AirTrick',
  roles: ['player'],
  params: ['launchThreshold', 'landThreshold', 'minCleanAir', 'maxCleanFall', 'boost', 'scoreBonus'],
  tuning: ['launchThreshold', 'landThreshold', 'minCleanAir', 'maxCleanFall', 'boost', 'scoreBonus'],
} as const;

/**
 * The PUSH channel this behavior publishes (the CLAIM the catalog/gates read). One true
 * statement per real emit site:
 *   - trick.landed ← update() at the touchdown seam when the landing is judged CLEAN (enough
 *     air time + a controlled descent): the score bonus is written to __GAME__.score and the
 *     carried momentum is boosted. Never fires on a crash landing. [archetype]
 */
export function surface(): ComponentSurface {
  return {
    observables: {},
    anchors: [],
    events: [
      {
        name: 'trick.landed',
        payload: '{airTime, boost, score}',
        scope: 'archetype',
        drivenBy: 'landing cleanly after a big slope launch (enough air time + a controlled, non-slammed descent)',
        expect:
          '__GAME__.score jumps by the trick scoreBonus and the carried momentum is boosted on a clean landing (a crash landing applies neither); trick.landed logged',
      },
    ],
  };
}
