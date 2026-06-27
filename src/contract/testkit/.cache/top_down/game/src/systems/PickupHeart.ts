/**
 * PickupHeart — the recovery pickup: overlap a heart/health pickup → restore the
 * player's bound health (clamped at player.maxHealth), exactly once per pickup, then
 * remove the heart from the board (system, top_down).
 *
 * The Zelda heart / Twin Stick Diaries' "save health for the boss": the single
 * attrition lever that turns a multi-room dungeon into a real decision (push on hurt
 * vs detour for a heart). As ONE scene-level system over the shared reward set: on
 * the COLLECT verb (the player overlaps a reward tagged as a heart pickup) it heals
 * the LIVE player by `healAmount` and consumes the heart through the standard seam.
 *
 * It re-implements NOTHING the engine owns. The clamp-at-maxHealth is BasePlayer.heal()
 * (`this.health = Math.min(this.health + amount, this.maxHealth)`) — so the heal can
 * never overshoot maxHealth, and __GAME__.player.health (the hook reads player.health)
 * rises by exactly the clamped delta. Removal + the base `reward.collected` go through
 * scene.consumeReward(), exactly like CollectGoal / WeaponPickup, which also deletes the
 * heart from rewardsById and destroys the sprite (so it leaves __GAME__.entities[]).
 *
 * Exactly-once: a heart is consumed through scene.consumeReward (which latches
 * sprite.__consumed) and we guard on that latch, so a second overlap in the same frame
 * (or a re-fire) is a clean no-op — the heal happens once per pickup.
 *
 * Full-health case (per `consumeOnFull`):
 *   - consumeOnFull=true  (DEFAULT) → a full-health player STILL consumes the heart
 *       (heal is a 0-delta no-op, the heart is removed) — idempotent; the heart is spent.
 *   - consumeOnFull=false           → a full-health player LEAVES the heart on the board
 *       (no consume, no event) so it can be saved for later.
 *
 * Observable transitions (__GAME__):
 *   collect (overlap a heart pickup) → __GAME__.player.health increases by the clamped
 *        heal amount (never above player.maxHealth); the heart leaves __GAME__.entities[];
 *        health.restored logged.
 *
 * Params (all OPTIONAL — sensible declared defaults, never a baked game constant):
 *   pickupKind    the reward __kind that marks a heart pickup (default 'heart').
 *   healAmount    bound health restored per heart (default 1 — a partial-heart top-up).
 *                 A pickup entity may override per-entity via reward.__healAmount.
 *   consumeOnFull whether a full-health player still consumes the heart (default true).
 *
 * GENERIC: no game/theme, no coordinate, no count is baked — WHICH rewards are hearts
 * comes from the DATA (the reward __kind), the heal amount is config-or-entity derived,
 * and the restore is a clamped heal on the LIVE player the scene already owns. A board
 * with no `scene.player` (or no heart reward) is a clean no-op.
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'PickupHeart',
  intent:
    'The recovery pickup: on the collect verb (overlap a heart/health pickup) restore the player\'s bound health up to player.maxHealth (clamped, exactly once per pickup) and remove the heart; the single attrition lever (push on hurt vs detour for a heart) of a multi-room dungeon.',
  attachesTo: 'scene',
  params: ['pickupKind', 'healAmount', 'consumeOnFull'],
  roles: ['player', 'collectible'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface PickupHeartConfig {
  pickupKind?: string;
  healAmount?: number;
  consumeOnFull?: boolean;
}

export class PickupHeart implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly pickupKind: string;
  private readonly defaultHealAmount: number;
  private readonly consumeOnFull: boolean;

  constructor(params: PickupHeartConfig = {}) {
    this.pickupKind = params.pickupKind ?? 'heart';
    this.defaultHealAmount = positiveOr(params.healAmount, 1);
    this.consumeOnFull = params.consumeOnFull ?? true;
  }

  /** No run state to clear — collection is event-driven and consumed hearts stay gone. */
  reset(): void {}

  attach(scene: any): void {
    this.scene = scene;
  }

  /** Wire the player<->reward overlap (player exists by setupCollisions — like CollectGoal). */
  setupCollisions(): void {
    const scene = this.scene;
    const player = scene?.player;
    const group = scene?.decorations;
    if (!player || !group) return;
    scene.physics.add.overlap(player, group, (_p: any, reward: any) => {
      this.collect(reward);
    });
  }

  /** No per-frame work — the heal is event-driven (the collect overlap). */
  update(): void {}

  // ── the drive seam (the collect verb) ──────────────────────────────────────

  /**
   * The COLLECT verb. Drivable WITHOUT a full game: call collect(reward) with a reward
   * sprite tagged as a heart pickup (__kind === pickupKind) and the live player is healed
   * by the clamped heal amount, then the heart is removed. A reward that is not a heart
   * (or already consumed) is ignored. A full-health player still consumes the heart unless
   * consumeOnFull is false (then the heart is left for later). This is the public seam the
   * overlap (setupCollisions) routes to, and the seam Integrate/Test fires.
   */
  collect(reward: any): void {
    if (!reward || reward.__consumed) return;
    if (reward.__kind !== this.pickupKind) return; // only heart pickups; dots etc. pass through

    const player = this.scene?.player;
    if (!player || typeof player.heal !== 'function') return; // no healable player → clean no-op

    const before = numOr(player.health, 0);
    const max = numOr(player.maxHealth, before);

    // consumeOnFull=false: a full-health player leaves the heart on the board for later.
    if (!this.consumeOnFull && before >= max) return;

    const healAmount = this.resolveHealAmount(reward);

    // Restore via the engine's OWN clamp (BasePlayer.heal → Math.min(health+amount, maxHealth)),
    // so the heal can never overshoot maxHealth. This is the exactly-once heal moment.
    player.heal(healAmount);

    // Remove the heart through the standard collection seam (deletes it from rewardsById +
    // destroys the sprite → it leaves __GAME__.entities[]; also fires the base reward.collected).
    // Latches sprite.__consumed, so a re-fire on the same heart is a clean no-op.
    this.consume(reward);

    // health.restored — the player's bound health was restored (clamped at maxHealth) at the
    // real collect moment. Payload is the actual clamped new health (the observable __GAME__
    // transition) + the nominal heal amount. Defensive: a scene without a bus is a no-op.
    this.bus?.emit('health.restored', {
      healAmount,
      health: numOr(player.health, before),
    });
    this.scene.fireEffect?.('health.restored', reward.x, reward.y);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * The heal amount for this heart. ID-SOURCE: a config param by default
   * (this.defaultHealAmount, from CAPABILITY.params.healAmount), overridable PER-ENTITY
   * by the pickup's own tag (reward.__healAmount — the entity's surfaced value). Never
   * fabricated — falls back to the declared default.
   */
  private resolveHealAmount(reward: any): number {
    const fromEntity = reward?.__healAmount;
    if (typeof fromEntity === 'number' && Number.isFinite(fromEntity) && fromEntity > 0) {
      return fromEntity;
    }
    return this.defaultHealAmount;
  }

  /** Consume the heart via the standard scene seam (removes + fires base reward.collected). */
  private consume(reward: any): void {
    if (typeof this.scene?.consumeReward === 'function') {
      this.scene.consumeReward(reward);
    } else {
      reward.__consumed = true;
      reward.destroy?.();
    }
  }

  // ── component surface (the declared PUSH-channel event this system emits) ───

  /**
   * The uniform component surface. Declares the one recovery moment this system emits on
   * the shared bus — a TRUE statement about the real emit site in this file:
   *   - health.restored ← collect (the player overlaps a heart: the bound health rises,
   *                                 clamped at maxHealth, and the heart leaves the board)
   * The health change is observable through __GAME__.player.health (the hook reads
   * player.health), so this surface declares only the PUSH channel + no observables/anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'health.restored',
          payload: '{healAmount,health}',
          scope: 'archetype',
          drivenBy: 'collect — the player overlaps a heart pickup',
          expect:
            '__GAME__.player.health increases by the heal amount, clamped at player.maxHealth; the heart leaves __GAME__.entities; health.restored logged',
        },
      ],
    };
  }
}

/** Coerce to a positive finite number or fall back to a sensible default. */
function positiveOr(v: number | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Coerce to a finite number or fall back (defensive over a possibly-undefined player field). */
function numOr(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
