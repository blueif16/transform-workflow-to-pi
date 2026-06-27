/**
 * WeaponPickup — the power economy: overlap a weapon pickup → swap/upgrade the
 * player's active RangedAttack for a bounded window, then revert (system, top_down).
 *
 * Twin Stick Diaries' "new ways to kill" + the shmup "powerful secondary, limited
 * in use": a strong gun is a RATIONED reward, the counterweight to the §3 verb
 * downside. As ONE scene-level system over the shared reward set: on the COLLECT
 * verb (the player overlaps a reward tagged as a weapon pickup) it SNAPSHOTS the
 * player's current RangedAttack profile, applies the variant's profile to the LIVE
 * `player.ranged` (faster cooldown / faster+bigger projectile / more damage), and
 * arms a revert timer. While the window is live the player's effective fire cadence
 * is genuinely faster (RangedAttack.cooldown is lower → shots come quicker). When
 * the window lapses (timer) — OR the next pickup is collected (which reverts first,
 * then re-applies) — the snapshot is restored: cadence returns to the base profile.
 *
 * It re-implements NOTHING the engine owns. The active gun is the scene's real
 * RangedAttack instance (`player.ranged`, built by DataTopDownScene.applyControlScheme),
 * whose public `cooldown`/`projectileSpeed`/`projectileSize`/`damage` ARE the fire
 * params the scene's auto-fire reads each tick — so mutating them is the cadence
 * change, not a parallel model. Collection consumes the reward through the standard
 * seam (scene.consumeReward → also fires the base `reward.collected`), exactly like
 * CollectGoal. A board with no `player.ranged` (no ranged scheme) is a clean no-op.
 *
 * Observable transitions (__GAME__):
 *   collect (overlap a weapon pickup) → player.ranged.cooldown drops (faster shot
 *        cadence) for `durationMs`; the pickup leaves the board; weapon.swapped logged.
 *   the bounded window lapses (timer)  → player.ranged.cooldown returns to the base
 *        value (default cadence); weapon.reverted logged.
 *
 * Params (all OPTIONAL — sensible declared defaults, never a baked game constant):
 *   pickupKind    the reward __kind that marks a weapon pickup (default 'weapon_pickup').
 *   weaponId      DEFAULT variant id when a pickup entity declares none (default 'rapid').
 *                 A pickup entity may override per-entity via reward.__weaponId / __profile.
 *   durationMs    the bounded window the swapped profile lasts (default 6000).
 *   cooldownScale multiply RangedAttack.cooldown by this while swapped (default 0.4 →
 *                 ~2.5x faster fire cadence — the visible "faster player.shot" effect).
 *   speedScale    multiply projectileSpeed while swapped (default 1.25).
 *   sizeScale     multiply projectileSize while swapped (default 1.25).
 *   damageScale   multiply damage while swapped (default 1.5).
 *
 * GENERIC: no game/theme, no coordinate, no count is baked — WHICH rewards are weapon
 * pickups comes from the DATA (the reward __kind), the variant id is config-or-entity
 * derived, and the swap is a bounded multiply over the LIVE gun the scene already owns.
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'WeaponPickup',
  intent:
    'The power economy: on the collect verb (overlap a weapon pickup) swap/upgrade the active RangedAttack — faster fire cadence / faster+bigger+stronger projectile — for a bounded window, then revert to the base profile; a rationed reward (the strong gun is limited in use).',
  attachesTo: 'scene',
  params: [
    'pickupKind',
    'weaponId',
    'durationMs',
    'cooldownScale',
    'speedScale',
    'sizeScale',
    'damageScale',
  ],
  roles: ['player', 'collectible'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface WeaponPickupConfig {
  pickupKind?: string;
  weaponId?: string;
  durationMs?: number;
  cooldownScale?: number;
  speedScale?: number;
  sizeScale?: number;
  damageScale?: number;
}

/** The base RangedAttack params we snapshot so the swap is exactly reversible. */
interface BaseProfile {
  cooldown: number;
  projectileSpeed: number;
  projectileSize: number;
  damage: number;
}

export class WeaponPickup implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly pickupKind: string;
  private readonly defaultWeaponId: string;
  private readonly durationMs: number;
  private readonly cooldownScale: number;
  private readonly speedScale: number;
  private readonly sizeScale: number;
  private readonly damageScale: number;

  /** The base gun params captured at the swap (restored on revert). null when not swapped. */
  private baseProfile: BaseProfile | null = null;
  /** The id of the variant currently active (for the revert payload). */
  private activeWeaponId: string | null = null;
  /** The pending revert timer (cancelled if a newer pickup re-arms the window). */
  private revertTimer: any = null;

  constructor(params: WeaponPickupConfig = {}) {
    this.pickupKind = params.pickupKind ?? 'weapon_pickup';
    this.defaultWeaponId = params.weaponId ?? 'rapid';
    this.durationMs = Math.max(1, params.durationMs ?? 6000);
    this.cooldownScale = clampScale(params.cooldownScale, 0.4);
    this.speedScale = clampScale(params.speedScale, 1.25);
    this.sizeScale = clampScale(params.sizeScale, 1.25);
    this.damageScale = clampScale(params.damageScale, 1.5);
  }

  /** Re-arm cleanly on a level restart: revert any live swap + drop every latch. */
  reset(): void {
    this.cancelTimer();
    // If a swap was live when the level restarted, restore the gun before dropping
    // state (idempotent — no-op when nothing is swapped or the gun is gone).
    this.restoreBase();
    this.baseProfile = null;
    this.activeWeaponId = null;
  }

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

  /** No per-frame work — the swap is event-driven (collect) and timer-driven (revert). */
  update(): void {}

  // ── the drive seam (the collect verb) ──────────────────────────────────────

  /**
   * The COLLECT verb. Drivable WITHOUT a full game: call collect(reward) with a
   * reward sprite tagged as a weapon pickup (__kind === pickupKind) and the active
   * RangedAttack is swapped to the variant profile for the bounded window. A reward
   * that is not a weapon pickup (or already consumed) is ignored. This is the public
   * seam the overlap (setupCollisions) routes to, and the seam Integrate/Test fires.
   */
  collect(reward: any): void {
    if (!reward || reward.__consumed) return;
    if (reward.__kind !== this.pickupKind) return; // only weapon pickups; dots etc. pass through

    const weaponId = this.resolveWeaponId(reward);
    this.consume(reward); // standard collection seam (also fires base reward.collected)
    this.applySwap(weaponId);
  }

  /**
   * Apply the variant profile to the LIVE player gun for `durationMs`. If a swap is
   * already live, revert it FIRST (restore the true base) so back-to-back pickups
   * never compound and the next revert restores the original cadence, not a doubled one.
   */
  private applySwap(weaponId: string): void {
    const gun = this.activeGun();
    if (!gun) return; // no ranged scheme on this board → clean no-op

    // Revert any in-flight swap to the true base before re-applying (no compounding).
    if (this.baseProfile) {
      this.cancelTimer();
      this.restoreBase();
    }

    // Snapshot the genuine base profile so the revert is exactly reversible.
    this.baseProfile = {
      cooldown: numOr(gun.cooldown, 220),
      projectileSpeed: numOr(gun.projectileSpeed, 600),
      projectileSize: numOr(gun.projectileSize, 16),
      damage: numOr(gun.damage, 20),
    };
    this.activeWeaponId = weaponId;

    // Apply the swapped profile — the lower cooldown is the VISIBLE faster cadence.
    gun.cooldown = Math.max(1, this.baseProfile.cooldown * this.cooldownScale);
    gun.projectileSpeed = this.baseProfile.projectileSpeed * this.speedScale;
    gun.projectileSize = this.baseProfile.projectileSize * this.sizeScale;
    gun.damage = this.baseProfile.damage * this.damageScale;

    // weapon.swapped — the player's active RangedAttack profile is now the variant's
    // (faster cadence) for the bounded window.
    this.bus?.emit('weapon.swapped', {
      weaponId,
      durationMs: this.durationMs,
    });
    this.scene.fireEffect?.('weapon.swapped', this.scene.player?.x, this.scene.player?.y);

    // Arm the bounded window: when it lapses, revert to the base profile.
    this.revertTimer = this.scene.time?.delayedCall?.(this.durationMs, () => {
      this.revert();
    });
  }

  /**
   * The bounded window lapsed (timer): restore the base RangedAttack profile so the
   * fire cadence returns to default, and announce the revert. Idempotent.
   */
  private revert(): void {
    if (!this.baseProfile) return;
    const weaponId = this.activeWeaponId ?? this.defaultWeaponId;
    this.cancelTimer();
    this.restoreBase();
    this.baseProfile = null;
    this.activeWeaponId = null;

    // weapon.reverted — the active RangedAttack is back to the base profile (default cadence).
    this.bus?.emit('weapon.reverted', { weaponId });
    this.scene.fireEffect?.('weapon.reverted', this.scene.player?.x, this.scene.player?.y);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Restore the snapshot onto the live gun (no-op if nothing is swapped / gun gone). */
  private restoreBase(): void {
    const base = this.baseProfile;
    const gun = this.activeGun();
    if (!base || !gun) return;
    gun.cooldown = base.cooldown;
    gun.projectileSpeed = base.projectileSpeed;
    gun.projectileSize = base.projectileSize;
    gun.damage = base.damage;
  }

  /** The player's LIVE RangedAttack instance the scene auto-fire reads (or null). */
  private activeGun(): any {
    return this.scene?.player?.ranged ?? null;
  }

  /**
   * The variant id for this pickup. ID-SOURCE: a config param by default
   * (this.defaultWeaponId), overridable PER-ENTITY by the pickup's own tag
   * (reward.__weaponId / reward.__profile — the entity's CAPABILITY.params surfaced
   * onto the sprite by the loader). Never fabricated — falls back to the declared default.
   */
  private resolveWeaponId(reward: any): string {
    const fromEntity = reward?.__weaponId ?? reward?.__profile;
    if (typeof fromEntity === 'string' && fromEntity.length > 0) return fromEntity;
    return this.defaultWeaponId;
  }

  /** Consume the reward via the standard scene seam (removes + fires base reward.collected). */
  private consume(reward: any): void {
    if (typeof this.scene?.consumeReward === 'function') {
      this.scene.consumeReward(reward);
    } else {
      reward.__consumed = true;
      reward.destroy?.();
    }
  }

  /** Cancel the pending revert timer, if any. */
  private cancelTimer(): void {
    if (this.revertTimer) {
      this.revertTimer.remove?.(false);
      this.revertTimer = null;
    }
  }

  // ── component surface (the declared PUSH-channel events this system emits) ──

  /**
   * The uniform component surface. Declares the two power-economy moments this system
   * emits on the shared bus — each a TRUE statement about a real emit site in this file:
   *   - weapon.swapped   ← applySwap (collect verb: the active gun becomes the variant,
   *                                   faster fire cadence, for the bounded window)
   *   - weapon.reverted  ← revert    (the window lapses: the gun returns to base cadence)
   * The cadence change is observable through the LIVE player.ranged the scene auto-fire
   * reads, so this surface declares only the PUSH channel + no observables/anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'weapon.swapped',
          payload: '{weaponId,durationMs}',
          scope: 'archetype',
          drivenBy: 'collect — the player overlaps a weapon pickup',
          expect:
            "the active RangedAttack profile changes (player.ranged.cooldown drops → measured fire cadence is faster than the base gun) for the bounded window; weapon.swapped logged",
        },
        {
          name: 'weapon.reverted',
          payload: '{weaponId}',
          scope: 'archetype',
          drivenBy: "the pickup's bounded window lapses (timer-driven)",
          expect:
            'the active RangedAttack returns to the base profile (player.ranged.cooldown back to default → fire cadence back to default); weapon.reverted logged',
        },
      ],
    };
  }
}

/** Clamp a scale param to a positive number, falling back to a sensible default. */
function clampScale(v: number | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Coerce to a finite number or fall back (defensive over a possibly-undefined gun field). */
function numOr(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
