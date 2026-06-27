/**
 * ElroySpeedup — Cruise Elroy: as the board's remaining-dot count crosses declared
 * thresholds, RAISE a bound ghost's walk speed (and force it to keep chasing) so the
 * hunt tightens precisely as the player nears the dot-clear win (system,
 * top_down:maze-chase; the Pac-Man Dossier "Cruise Elroy", DR §12 H4 coupled-fates).
 *
 * The maze's defining late-game pressure, as ONE scene-level system. It watches the
 * dots DEPLETE (the player eating dots is what drives it): each pickup funnels through
 * the scene's standardized `reward.collected` event, so this system polls the LIVE
 * remaining-dot count every tick and, when that count crosses a declared threshold,
 * bumps the bound ghost into the next Elroy TIER — multiplying its GhostTarget speed
 * and latching "force chase" so it ignores scatter for the rest of the level. Tiers
 * are MONOTONIC: the speed only ratchets UP as dots vanish and never relaxes (the
 * count crossing back up is impossible — dots are only removed), so once raised it
 * STAYS raised, exactly the contract's observable.
 *
 * Observable transitions (__GAME__):
 *   remaining dots cross a threshold → the bound ghost's GhostTarget.speed rises, so
 *     its measured speed in __GAME__.entities (Δposition/frame) increases and stays
 *     raised; elroy.engaged logged with {ghostId, tier, speed}.
 *
 * It re-implements NOTHING the engine owns: the bound ghost is the SAME maze hunter
 * GhostTarget already drives (we only mutate that behavior's public `speed`); the dot
 * count comes from the shared `scene.rewardsById` set (the CollectGoal source); the
 * "force chase" is a public flag GhostTarget honors where it is read (a clean no-op on
 * a build that doesn't, so this never hard-depends on it). The bound ghost is selected
 * by its GhostTarget `selector` (default 'blinky' — the canonical Elroy ghost).
 *
 * Params (all OPTIONAL — sensible declared defaults, never a baked game constant):
 *   ghostSelector  which ghost to accelerate, by its GhostTarget selector
 *                  (blinky|pinky|inky|clyde; default 'blinky' — the Dossier's Elroy ghost).
 *   thresholds     remaining-dot counts that trigger each tier, e.g. [20, 10]: at <=20
 *                  dots tier 1, at <=10 dots tier 2. DESCENDING; default [20, 10].
 *   speedMultipliers per-tier multiplier applied to the ghost's BASE speed, index-aligned
 *                  to `thresholds` (default [1.1, 1.2]). Padded/truncated to thresholds.
 *   forceChase     once any tier engages, latch the ghost to chase even in scatter
 *                  (default true — the Elroy "never relents").
 *
 * GENERIC: no game/theme, no coordinate, no dot total is baked — the thresholds are a
 * PARAM, the dot count is DERIVED from the live reward set, and a board with no maze
 * ghost (no matching GhostTarget) is a clean no-op (nothing to accelerate).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ElroySpeedup',
  intent:
    "Cruise Elroy: as the remaining-dot count crosses declared thresholds, raise a bound ghost's GhostTarget speed (and latch it to chase even in scatter) so the hunt tightens as the player nears the dot-clear win. Tiers are monotonic — once raised the speed stays raised; emits elroy.engaged at each tier.",
  attachesTo: 'scene',
  params: ['ghostSelector', 'thresholds', 'speedMultipliers', 'forceChase'],
  roles: ['enemy', 'collectible'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface ElroySpeedupConfig {
  /** GhostTarget selector of the ghost to accelerate (default 'blinky'). */
  ghostSelector?: string;
  /** Remaining-dot counts (DESCENDING) that trigger each Elroy tier (default [20, 10]). */
  thresholds?: number[];
  /** Per-tier speed multiplier on the ghost's BASE speed (default [1.1, 1.2]). */
  speedMultipliers?: number[];
  /** Latch the ghost to chase even in scatter once engaged (default true). */
  forceChase?: boolean;
}

export class ElroySpeedup implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly ghostSelector: string;
  /** Thresholds sorted DESCENDING (tier 1 first) so a deeper tier always wins. */
  private readonly thresholds: number[];
  /** Multipliers index-aligned to `thresholds` (padded to its length). */
  private readonly multipliers: number[];
  private readonly forceChase: boolean;

  /** The bound ghost's GhostTarget behavior (resolved at attach; null = no Elroy ghost). */
  private ghostBehavior: any = null;
  /** The bound ghost owner sprite (for its __id in the payload). */
  private ghostSprite: any = null;
  /** The ghost's BASE speed captured at attach (every multiplier is relative to it). */
  private baseSpeed = 0;
  /** The highest tier ENGAGED so far (0 = none); monotonic — only ever increases. */
  private engagedTier = 0;

  constructor(params: ElroySpeedupConfig = {}) {
    this.ghostSelector = params.ghostSelector ?? 'blinky';
    // Sort DESCENDING so index 0 is the FIRST (shallowest) tier and the last index
    // is the deepest — we walk it to find the deepest threshold the count has crossed.
    const t = (params.thresholds && params.thresholds.length > 0
      ? params.thresholds
      : [20, 10]
    )
      .map((n) => Math.max(0, Math.floor(n)))
      .sort((a, b) => b - a);
    this.thresholds = t;
    const m = params.speedMultipliers && params.speedMultipliers.length > 0
      ? params.speedMultipliers
      : [1.1, 1.2];
    // Index-align multipliers to thresholds: pad with the last (or 1.1) if short.
    this.multipliers = t.map((_v, i) => {
      const mult = m[i] ?? m[m.length - 1] ?? 1.1;
      return Math.max(1, mult);
    });
    this.forceChase = params.forceChase ?? true;
  }

  /** Re-arm cleanly on a level restart: drop the latch + restore the base speed. */
  reset(): void {
    if (this.ghostBehavior && this.baseSpeed > 0) {
      this.ghostBehavior.speed = this.baseSpeed;
      this.ghostBehavior.forceChase = false;
    }
    this.ghostBehavior = null;
    this.ghostSprite = null;
    this.baseSpeed = 0;
    this.engagedTier = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    this.resolveGhost();
  }

  /** No overlaps to wire — depletion is read from the live reward set each tick. */
  setupCollisions(): void {}

  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    // Late-bind the ghost if it spawned after attach (e.g. a WaveSpawner ghost).
    if (!this.ghostBehavior) this.resolveGhost();
    if (!this.ghostBehavior) return; // no Elroy ghost on this board → clean no-op

    const remaining = this.remainingDotCount();
    const tier = this.tierFor(remaining);
    // Monotonic: only ENGAGE a deeper tier; never relax (depleting dots can't reverse).
    if (tier > this.engagedTier) this.engage(tier);
  }

  // ── tier engagement ─────────────────────────────────────────────────────────

  /**
   * The deepest tier the remaining-dot count has crossed: thresholds are DESCENDING,
   * so tier N = the count of thresholds the remaining count is at-or-below. e.g.
   * thresholds [20,10], remaining 9 → tier 2; remaining 15 → tier 1; remaining 30 → 0.
   */
  private tierFor(remaining: number): number {
    let tier = 0;
    for (const th of this.thresholds) {
      if (remaining <= th) tier += 1;
      else break;
    }
    return tier;
  }

  /**
   * Engage Elroy `tier`: ratchet the bound ghost's GhostTarget speed up to the tier's
   * multiple of its base speed, latch force-chase, and emit the moment. The seam where
   * eating a dot (which dropped the count past the threshold) tightens the hunt.
   */
  private engage(tier: number): void {
    this.engagedTier = tier;
    const mult = this.multipliers[tier - 1] ?? this.multipliers[this.multipliers.length - 1] ?? 1.1;
    const speed = Math.round(this.baseSpeed * mult);
    // Raise the REAL behavior speed — its measured Δposition/frame in __GAME__.entities
    // rises and stays raised (monotonic; reset() restores the base on a restart).
    this.ghostBehavior.speed = speed;
    // Force the ghost to keep chasing even in scatter for the rest of the level (a
    // public flag GhostTarget honors where read; a no-op on a build that doesn't).
    if (this.forceChase) this.ghostBehavior.forceChase = true;

    const ghostId = this.ghostSprite?.__id ?? this.ghostSelector;
    // elroy.engaged — a dot pickup dropped the remaining count past a threshold; the
    // bound ghost just got faster + more aggressive (carries the new speed + tier).
    this.bus?.emit('elroy.engaged', { ghostId, tier, speed });
    this.scene.fireEffect?.('elroy.engaged', this.ghostSprite?.x, this.ghostSprite?.y);
  }

  // ── resolution + counting (read the live world, generic) ─────────────────────

  /**
   * Find the bound ghost: scan scene.enemies for a sprite whose GhostTarget behavior
   * has the configured selector, and capture that behavior + its base speed. Idempotent
   * — once resolved it short-circuits. A board with no matching ghost leaves it null.
   */
  private resolveGhost(): void {
    const group = this.scene?.enemies;
    if (!group || typeof group.getChildren !== 'function') return;
    for (const e of group.getChildren() as any[]) {
      if (!e || !e.behaviors || typeof e.behaviors.getAll !== 'function') continue;
      for (const beh of e.behaviors.getAll() as any[]) {
        if (beh && beh.constructor?.name === 'GhostTarget' && beh.selector === this.ghostSelector) {
          this.ghostBehavior = beh;
          this.ghostSprite = e;
          this.baseSpeed = Number(beh.speed) || 0;
          return;
        }
      }
    }
  }

  /** Count dots still on the board (active, un-consumed collectibles) — CollectGoal's source. */
  private remainingDotCount(): number {
    const map = this.scene?.rewardsById ?? {};
    let n = 0;
    for (const id of Object.keys(map)) {
      const r = map[id];
      if (r && r.active !== false && !r.__consumed) n += 1;
    }
    return n;
  }

  // ── component surface (the declared PUSH-channel events this system emits) ────

  /**
   * The uniform component surface. Declares the ONE Elroy moment this system emits on
   * the shared bus — a TRUE statement about the real emit site in `engage()`:
   *   - elroy.engaged ← engage (a dot pickup dropped the remaining count past a
   *                     declared threshold; the bound ghost's speed rises + latches).
   * Observables stay on the existing __GAME__ entities adapter (the ghost's faster
   * Δposition/frame is visible there), so this surface declares only the PUSH channel.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'elroy.engaged',
          payload: '{ghostId,tier,speed}',
          scope: 'archetype',
          drivenBy: 'collect — eating a dot drops the remaining-dot count past a declared threshold',
          expect:
            "the bound ghost's GhostTarget speed rises (its measured speed in __GAME__.entities increases) and stays raised for the rest of the level; elroy.engaged logged",
        },
      ],
    };
  }
}
