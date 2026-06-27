/**
 * ============================================================================
 * NearMissStreak — a near-miss streak bonus that breaks on a wide pass or a hit
 * ============================================================================
 *
 * The endless-runner risk-reward layer: every time the fixed-x avatar threads an obstacle
 * pair's gap, this system measures HOW CLOSE the pass was — the vertical distance from the
 * avatar to the pair's gap CENTER at the moment it clears the trailing edge. A TIGHT pass
 * (within `nearMissBand`) is a NEAR MISS: the streak grows by one and a streak-scaled bonus
 * is added to the engine score, rewarding the player for living dangerously. A LOOSE pass
 * (cleared, but wider than the band) is a WIDE PASS: the streak BREAKS back to zero. And if
 * the avatar dies (an obstacle / floor / ceiling hit), the streak BREAKS too.
 *
 * It rides the SAME single source of truth ScoreOnPassSystem reads — the live obstacle
 * pairs ObstacleScrollSystem publishes on `scene.obstaclePairs` — and uses its OWN per-pair
 * latch so each pair is judged EXACTLY ONCE. It never spawns or moves anything; it only
 * observes the thread and writes the streak + a score bonus.
 *
 * THE INVARIANTS IT ENFORCES:
 *   - INV-JUDGE-ONCE: a private `judged` Set keyed by pair id judges each pair exactly once
 *     when the avatar's x crosses its trailing edge — no double-count, no re-judge.
 *   - break-on-hit: if the avatar is dead when update() runs, the streak breaks once (the
 *     run-end break), then stays at zero. The system invents NO new death path — it only
 *     observes the engine's `isDead` flag the lose seam sets.
 *   - INV-RESET: reset() zeroes the streak, the best, and the judged set so a restarted run
 *     starts a fresh streak from zero (no leaked count).
 *
 * IDENTITY (id source): the streak.changed payload's `pairId` is the OBSTACLE PAIR's own
 * auto-derived id (minted by ObstacleScrollSystem as `obstacle_<n>`) on a pass, or a literal
 * `'hit'`/`'reset'` reason on a break — NOT a config param; the pair is an entity this system
 * observes, so the id is auto-derived per the standard's ID-SOURCE convention.
 *
 * OBSERVABLE (the contract): a near-miss / break writes the live streak on `scene.streak`
 * (surfaced as the `streak` observable thunk) and the best streak on `scene.streakBest`; a
 * near-miss also writes the engine's ONE score channel (scene.setScore / registry 'score' →
 * __GAME__.score) with the streak-scaled bonus. The streak counter changing IS the contract.
 *
 * EVENT (the PUSH channel, on the shared scene.eventBus):
 *   - streak.changed ← a near-miss pass (streak up) OR a break (streak → 0), payload
 *     {pairId, streak, best, reason}. The __GAME__ streak counter changes.
 *
 * GENERIC: no game/theme, no baked coordinate. Every number is a DECLARED default,
 * re-tunable via params; a level that binds no obstacle stream is a clean no-op (no pairs to
 * judge ⇒ the streak simply stays at zero).
 */
import type { ISceneSystem } from '../scenes/runner-data';
import { type EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'NearMissStreak',
  intent:
    'A near-miss streak bonus for the endless runner: when the fixed-x avatar threads an obstacle pair, measure how close the pass was. A tight pass (within a near-miss band of the gap center) grows the streak and adds a streak-scaled score bonus; a loose (wide) pass or a hit breaks the streak back to zero. Reads the live obstacle pairs the scroller publishes; writes the streak observable and a score bonus.',
  attachesTo: 'scene',
  params: ['nearMissBand', 'bonusPerStreak', 'maxBonus'],
  tuning: ['nearMissBand', 'bonusPerStreak'],
  roles: ['player', 'obstacle'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** Per-game tuning for the streak (every field DECLARED with a sensible default). */
export interface NearMissStreakConfig {
  /**
   * The vertical distance (px) from the gap CENTER within which a cleared pass counts as a
   * NEAR MISS (grows the streak). A pass wider than this is a WIDE pass (breaks the streak).
   * Default 60.
   */
  nearMissBand?: number;
  /**
   * Score bonus added per current streak step on a near-miss (the reward scales with the
   * streak: a near-miss at streak n awards n * bonusPerStreak, capped at maxBonus). Default 1.
   */
  bonusPerStreak?: number;
  /** The maximum single near-miss bonus, so a long streak can't run away with the score. Default 10. */
  maxBonus?: number;
}

/** Declared defaults (the near-miss risk-reward feel). Re-tuned per game via params. */
const DEF = {
  nearMissBand: 60,
  bonusPerStreak: 1,
  maxBonus: 10,
};

export class NearMissStreak implements ISceneSystem {
  private scene: any;
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly nearMissBand: number;
  private readonly bonusPerStreak: number;
  private readonly maxBonus: number;

  /** The current near-miss streak (its own latch — INV-RESET). */
  private streak = 0;
  /** The best streak reached this run (monotonic until reset). */
  private best = 0;
  /** Pair ids already judged (pass/wide) this run — judge each EXACTLY ONCE. */
  private judged = new Set<string>();
  /** Whether the run-end (death) break has already fired (fire it once). */
  private brokeOnDeath = false;

  constructor(params: NearMissStreakConfig = {}) {
    this.nearMissBand = params.nearMissBand ?? DEF.nearMissBand;
    this.bonusPerStreak = params.bonusPerStreak ?? DEF.bonusPerStreak;
    this.maxBonus = params.maxBonus ?? DEF.maxBonus;
  }

  reset(): void {
    this.streak = 0;
    this.best = 0;
    this.judged.clear();
    this.brokeOnDeath = false;
    if (this.scene) {
      this.scene.streak = 0;
      this.scene.streakBest = 0;
    }
  }

  attach(scene: any): void {
    this.scene = scene;
    this.streak = 0;
    this.best = 0;
    this.judged.clear();
    this.brokeOnDeath = false;
    // Publish the live streak (single source of truth — the hook/observable reads it).
    scene.streak = 0;
    scene.streakBest = 0;
  }

  update(): void {
    const scene = this.scene;
    const avatar = scene?.player;
    if (!avatar) return;

    // break-on-hit: the avatar died this run — break the streak once and stop judging.
    if (avatar.isDead) {
      if (!this.brokeOnDeath && this.streak > 0) {
        this.brokeOnDeath = true;
        this.breakStreak('hit');
      }
      return;
    }

    const pairs: Array<{ top: any; gapCenterY: number; id: string }> = scene.obstaclePairs ?? [];
    const avatarX = avatar.x ?? 0;
    const avatarY = avatar.y ?? 0;
    for (const p of pairs) {
      if (this.judged.has(p.id)) continue;
      // The trailing edge of the obstacle pair (its right side once the avatar is past) —
      // the same pass moment ScoreOnPassSystem uses.
      const trailingEdge = (p.top?.x ?? Infinity) + (p.top?.displayWidth ?? 0) / 2;
      if (trailingEdge < avatarX) {
        // INV-JUDGE-ONCE: this pair is now resolved (pass or wide) — never re-judge it.
        this.judged.add(p.id);
        const offset = Math.abs(avatarY - (p.gapCenterY ?? avatarY));
        if (offset <= this.nearMissBand) this.nearMiss(p.id, offset);
        else this.widePass(p.id);
      }
    }
  }

  /** A NEAR MISS: grow the streak, award a streak-scaled bonus, publish + emit. */
  private nearMiss(pairId: string, _offset: number): void {
    this.streak += 1;
    if (this.streak > this.best) this.best = this.streak;
    this.publishStreak();

    // The streak-scaled score bonus (capped) — the near-miss reward lands on the score channel.
    const bonus = Math.min(this.streak * this.bonusPerStreak, this.maxBonus);
    if (bonus > 0) this.writeScore(this.currentScore() + bonus);

    // The PUSH seam: a near-miss pass grew the streak.
    this.bus?.emit('streak.changed', {
      pairId,
      streak: this.streak,
      best: this.best,
      reason: 'near-miss',
    });
  }

  /** A WIDE pass: the avatar cleared, but loosely — the streak breaks back to zero. */
  private widePass(pairId: string): void {
    if (this.streak === 0) return; // already broken — nothing to publish.
    this.breakStreak('wide', pairId);
  }

  /** Break the streak to zero and publish + emit the break (reason: 'wide' | 'hit'). */
  private breakStreak(reason: 'wide' | 'hit', pairId?: string): void {
    this.streak = 0;
    this.publishStreak();
    // The PUSH seam: the streak broke (a wide pass or a hit) — the counter dropped to zero.
    this.bus?.emit('streak.changed', {
      pairId: pairId ?? reason,
      streak: 0,
      best: this.best,
      reason,
    });
  }

  /** Publish the live streak + best (single source of truth — the observable reads it). */
  private publishStreak(): void {
    if (!this.scene) return;
    this.scene.streak = this.streak;
    this.scene.streakBest = this.best;
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

  /**
   * The PUSH + PULL channels this system publishes (one true statement per real seam):
   *   - streak.changed ← nearMiss (a tight pass grew the streak) AND breakStreak (a wide
   *     pass or a hit dropped it to zero) [archetype]
   *   - observable streak ← the live near-miss streak this system computes
   */
  surface(): ComponentSurface {
    return {
      observables: {
        streak: () => this.streak,
      },
      anchors: [],
      events: [
        {
          name: 'streak.changed',
          payload: '{pairId,streak,best,reason}',
          scope: 'archetype',
          drivenBy: 'the avatar threading an obstacle gap (a tight near-miss pass) or breaking the streak on a wide pass / a hit',
          expect:
            'the __GAME__ streak counter changes — it increases by one on a near-miss pass (and adds a streak-scaled score bonus) and drops to zero on a wide pass or a hit; streak.changed logged',
        },
      ],
    };
  }
}
