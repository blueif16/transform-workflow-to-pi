/**
 * ============================================================================
 * ScoreOnPassSystem — score exactly once per threaded obstacle (BUILD — system)
 * ============================================================================
 *
 * The endless-runner scoring rule: when the fixed-x avatar PASSES an obstacle pair's
 * trailing edge, the score increments by ONE — guarded by a per-pair `scored` flag so
 * it counts EXACTLY ONCE (INV-SCORE-ONCE / RB §3 PF-4, the canonical double-count bug).
 * It reads the live obstacle pairs ObstacleScrollSystem publishes on scene.obstaclePairs
 * (the single source of truth) — it does NOT spawn or move anything; it only observes
 * the pass and writes the score observable.
 *
 * OBSERVABLE (the contract): it writes the ONE score source (scene.registry 'score' /
 * scene.setScore), which the hook surfaces as __GAME__.score. It never reads/writes any
 * other observed field.
 *
 * EVENT (the PUSH channel): score.changed fires on the shared scene.eventBus at the real
 * pass moment — once per obstacle (payload {score}).
 *
 * INV-RESET: reset() clears its internal pass bookkeeping so a restarted run scores from
 * 0 with no leaked count.
 *
 * GENERIC: no game/theme. The pass is a pure x-comparison against the avatar; the score
 * is the engine's score channel.
 */
import type { ISceneSystem } from '../scenes/runner-data';
import { type EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ScoreOnPassSystem',
  intent:
    'Score exactly once per threaded obstacle: when the fixed-x avatar passes an obstacle pair\'s trailing edge, increment the score by one, guarded by a per-pair scored flag (no double-count). Reads the live obstacle pairs the scroller publishes; writes the single score observable.',
  attachesTo: 'scene',
  params: ['valuePerPass'],
  roles: ['player', 'obstacle'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface ScoreOnPassConfig {
  /** Points awarded per passed obstacle (default 1). */
  valuePerPass?: number;
}

export class ScoreOnPassSystem implements ISceneSystem {
  private scene: any;
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly valuePerPass: number;
  /** The score this system has awarded this run (its own latch — INV-RESET). */
  private score = 0;

  constructor(params: ScoreOnPassConfig = {}) {
    this.valuePerPass = params.valuePerPass ?? 1;
  }

  reset(): void {
    this.score = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    this.score = 0;
  }

  update(): void {
    const scene = this.scene;
    const avatar = scene?.player;
    if (!avatar || avatar.isDead) return;
    const pairs: Array<{ top: any; scored: boolean; id: string }> = scene.obstaclePairs ?? [];
    const avatarX = avatar.x ?? 0;
    for (const p of pairs) {
      // The trailing edge of the obstacle pair (its right side once the avatar is past).
      const trailingEdge = (p.top?.x ?? Infinity) + (p.top?.displayWidth ?? 0) / 2;
      // INV-SCORE-ONCE: a per-pair flag — increments exactly once when the avatar's x
      // crosses the trailing edge.
      if (!p.scored && trailingEdge < avatarX) {
        p.scored = true;
        this.score += this.valuePerPass;
        this.writeScore(this.score);
        // The PUSH seam: the score changed at the real pass moment.
        this.bus?.emit('score.changed', { score: this.score });
      }
    }
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
   * The PUSH channel this system publishes:
   *   - score.changed ← update (the avatar passed an obstacle's trailing edge) [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'score.changed',
          payload: '{score}',
          scope: 'archetype',
          drivenBy: 'the avatar passing an obstacle pair trailing edge',
          expect:
            '__GAME__.score increases by exactly one per passed obstacle (never double-counts); score.changed logged',
        },
      ],
    };
  }
}
