/**
 * ============================================================================
 * ChaserSystem — a pursuer that closes the gap on every slowdown (BUILD — system)
 * ============================================================================
 *
 * The lane-runner pressure mechanic: a pursuer trails the fixed-x avatar at a GAP
 * (px behind it). Clean, forward play (the avatar actively flapping / climbing) the
 * gap RECOVERS — the avatar pulls away. But every MISTAKE / SLOWDOWN — a frame the
 * avatar coasts and sinks instead of driving forward — lets the pursuer GAIN, closing
 * the gap. When the gap reaches ZERO the pursuer CATCHES the avatar: the engine lose
 * seam fires and __GAME__.status becomes 'lost'. The pursuer is the reason a runner
 * can't just survive passively — hesitation is punished.
 *
 * IDENTITY (id source): the catch payload's `id` is the pursuer's own id — a config
 * param `CAPABILITY.params.pursuerId` (default 'chaser'), the $custom-system convention
 * (not auto-derived from an entity — the pursuer is its OWN logical entity here).
 *
 * THE MECHANIC (no baked coordinate — every number is a DECLARED default, re-tunable):
 *   - The gap starts at `startGap` px and is clamped to [0, maxGap].
 *   - "Slowdown" = the avatar's vertical velocity (its forward drive proxy) is below
 *     `slowVy` AND it is sinking (vy ≥ 0). On such a frame the pursuer GAINS `closeRate`
 *     px (it closes faster the deeper the slowdown, scaled by how far below slowVy).
 *   - A clean frame (the avatar climbing / actively flapping) the gap RECOVERS
 *     `recoverRate` px (capped at maxGap) — the avatar pulls away.
 *   - hazard.activated (an obstacle/floor/ceiling near-graze that fired the lose seam,
 *     OR a logged collision) is itself the hardest slowdown — a big one-shot gain.
 *   - gap ≤ 0 ⇒ CATCH: fire chaser.caught + the engine lose seam (avatar.takeDamage /
 *     scene.onPlayerDeath). The pursuer invents NO new death path.
 *
 * OBSERVABLE (the contract): on catch it drives the avatar through the engine's own
 * lose seam, so __GAME__.status becomes 'lost' (the hook surfaces registry 'status').
 * It also publishes the live gap on scene.chaserGap for diagnostics / a HUD effect.
 *
 * INV-RESET: reset() restores the gap to startGap and clears the caught latch so a
 * restarted run re-arms byte-identically (the pursuer starts the configured distance
 * back, no leaked closing).
 *
 * GENERIC: no game/theme, no baked coordinate. The slowdown signal is a pure velocity
 * comparison on the bound avatar; the catch is the engine's standardized lose seam.
 */
import type { ISceneSystem } from '../scenes/runner-data';
import { type EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ChaserSystem',
  intent:
    "A pursuer trailing the fixed-x avatar by a gap (px) that closes on every slowdown/mistake — a frame the avatar coasts and sinks instead of driving forward — and recovers on clean forward play. When the gap reaches zero the pursuer catches the avatar and fires the engine lose seam (__GAME__.status becomes 'lost'). The pressure mechanic that punishes hesitation.",
  attachesTo: 'scene',
  params: ['startGap', 'maxGap', 'slowVy', 'closeRate', 'recoverRate', 'hazardGain', 'pursuerId'],
  tuning: ['startGap', 'maxGap', 'slowVy', 'closeRate', 'recoverRate', 'hazardGain'],
  roles: ['player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** Per-game tuning for the pursuer (every field DECLARED with a sensible default). */
export interface ChaserConfig {
  /** Gap (px) the pursuer starts behind the avatar (and resets to). Default 360. */
  startGap?: number;
  /** Max gap (px) the avatar can pull away to — recovery is capped here. Default 480. */
  maxGap?: number;
  /**
   * Vertical-velocity threshold (px/s): vy below this WHILE sinking (vy ≥ 0) is a
   * "slowdown" the pursuer gains on. Above it (climbing / actively flapping) is clean
   * forward play. Default 120.
   */
  slowVy?: number;
  /** Px the gap closes per slowdown frame (scaled by slowdown depth). Default 2.4. */
  closeRate?: number;
  /** Px the gap recovers per clean frame (the avatar pulling away). Default 0.9. */
  recoverRate?: number;
  /** One-shot px the gap closes on a logged hazard near-graze. Default 140. */
  hazardGain?: number;
  /** The pursuer's id (the chaser.caught payload). Default 'chaser'. */
  pursuerId?: string;
}

/** Declared defaults (the lane-runner pursuit feel). Re-tuned per game via params. */
const DEF = {
  startGap: 360,
  maxGap: 480,
  slowVy: 120,
  closeRate: 2.4,
  recoverRate: 0.9,
  hazardGain: 140,
  pursuerId: 'chaser',
};

export class ChaserSystem implements ISceneSystem {
  private scene: any;
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly cfg: Required<ChaserConfig>;

  /** The live gap (px) the pursuer is behind the avatar. 0 ⇒ caught. */
  private gap = 0;
  /** Latch: the catch fires exactly once per run (INV-RESET clears it). */
  private caught = false;
  /** Unsubscribe handle for the hazard listener (cleared on reset). */
  private offHazard: (() => void) | null = null;

  constructor(params: ChaserConfig = {}) {
    this.cfg = {
      startGap: params.startGap ?? DEF.startGap,
      maxGap: params.maxGap ?? DEF.maxGap,
      slowVy: params.slowVy ?? DEF.slowVy,
      closeRate: params.closeRate ?? DEF.closeRate,
      recoverRate: params.recoverRate ?? DEF.recoverRate,
      hazardGain: params.hazardGain ?? DEF.hazardGain,
      pursuerId: params.pursuerId ?? DEF.pursuerId,
    };
  }

  reset(): void {
    this.gap = this.cfg.startGap;
    this.caught = false;
    this.offHazard?.();
    this.offHazard = null;
    if (this.scene) this.scene.chaserGap = this.gap;
  }

  attach(scene: any): void {
    this.scene = scene;
    this.gap = this.cfg.startGap;
    this.caught = false;
    // Publish the live gap for diagnostics / a HUD effect (single source of truth).
    scene.chaserGap = this.gap;
    // A logged hazard near-graze is the hardest slowdown — a big one-shot gain. We
    // POLL the bus too (in update) but also listen so a graze that did NOT end the run
    // still pulls the pursuer in.
    this.offHazard?.();
    this.offHazard = scene.eventBus?.on?.('hazard.activated', () => {
      if (this.caught) return;
      this.gap = Math.max(0, this.gap - this.cfg.hazardGain);
      scene.chaserGap = this.gap;
    }) ?? null;
  }

  update(): void {
    const scene = this.scene;
    if (!scene || this.caught) return;
    const avatar = scene.player;
    if (!avatar || avatar.isDead) return;

    // The forward-drive proxy: the avatar's vertical velocity. In a gravity-flap
    // runner, actively flapping drives vy NEGATIVE (climbing); coasting lets it sink
    // POSITIVE — that sink is the "slowdown / mistake" the pursuer feeds on.
    const body = avatar.body as { velocity?: { y?: number } } | undefined;
    const vy = body?.velocity?.y ?? avatar.vy ?? 0;

    if (vy >= 0 && vy < this.cfg.slowVy) {
      // SLOWDOWN: gain ground, deeper near-stall ⇒ faster close (scaled to slowVy).
      const depth = (this.cfg.slowVy - vy) / this.cfg.slowVy; // (0, 1]
      this.gap = Math.max(0, this.gap - this.cfg.closeRate * (0.5 + 0.5 * depth));
    } else {
      // CLEAN forward play (climbing / driving): the avatar pulls away, capped.
      this.gap = Math.min(this.cfg.maxGap, this.gap + this.cfg.recoverRate);
    }

    scene.chaserGap = this.gap;

    if (this.gap <= 0) this.fireCatch();
  }

  /** The pursuer reached the avatar: chaser.caught + the engine lose seam (ONCE). */
  private fireCatch(): void {
    const scene = this.scene;
    const avatar = scene?.player;
    if (this.caught || !avatar || avatar.isDead) return;
    this.caught = true;
    this.gap = 0;
    scene.chaserGap = 0;
    // The PUSH seam: the pursuer closed the gap to zero and caught the avatar.
    this.bus?.emit('chaser.caught', { id: this.cfg.pursuerId });
    // The LOSE SEAM via the engine's own death path (status → 'lost'); no new path.
    if (typeof avatar.takeDamage === 'function') avatar.takeDamage(9999);
    else if (typeof scene.onPlayerDeath === 'function') scene.onPlayerDeath();
  }

  /**
   * The PUSH channel this system publishes (one true statement per real emit site):
   *   - chaser.caught ← fireCatch (the pursuer closed the gap to zero) [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'chaser.caught',
          payload: '{id}',
          scope: 'archetype',
          drivenBy: 'the pursuer closing the gap to zero (sustained slowdowns/mistakes)',
          expect:
            "the avatar takes the engine lose seam and __GAME__.status becomes 'lost'; chaser.caught logged",
        },
      ],
    };
  }
}
