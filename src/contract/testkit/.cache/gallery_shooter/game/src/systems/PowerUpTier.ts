/**
 * PowerUpTier — the WEAPON-TIER POWER-UP system (BUILD — gallery-shooter engine
 * piece, genre=scrolling-shmup). The classic shmup escalation loop: killed enemies
 * occasionally drop a tier power-up; the player flying through one RAISES the weapon
 * tier, and each tier upgrades the player's FIRE PATTERN — more shots per volley,
 * faster cooldown, harder-hitting bullets — applied to the live ProjectilePool.
 *
 * It is the SLICED, standalone tier ladder (ScrollShmup folds the same idea into its
 * fat genre layer; this is the composable kind=system a blueprint can bind on its OWN,
 * on top of the base formation + ProjectilePool, without the bullet-pattern emitters or
 * the boss). It owns NO firing (ProjectilePool does) and NO enemy movement — it READS
 * the pool off the scene (scene.__projectilePool) and ESCALATES it, and wraps the
 * scene's onEnemyKilled to roll a drop.
 *
 * THE TIER LADDER (the fire-pattern escalation, all DATA via a config table with a
 * declared default). Each tier entry escalates the cannon:
 *   - shots   : bullets launched per fire (a wider spread fan at higher tiers);
 *   - cooldownMul : multiplier on the pool's base cooldown (<1 ⇒ faster fire);
 *   - damage  : the per-bullet damage the pool deals.
 * tier 1 is the baseline the level ships with; a pickup advances to the next entry,
 * capped at the table's last tier.
 *
 * OBSERVABLE (the contract — what a verify run polls): the live weapon tier is mirrored
 * onto scene.weaponTier (and scene.player.weaponTier) and RISES on each pickup; the
 * bound ProjectilePool's cooldown shrinks + damage + per-volley shot count grow — the
 * player's fire pattern visibly escalates. A level with no pool still tracks the tier.
 *
 * EVENT (the PUSH channel): weapon.upgraded ← the player collects a tier power-up (the
 * weapon tier increases).
 *
 * GENERIC: no game/theme, no baked coordinate — drops spawn at the killed enemy; every
 * cadence/tier number is DATA via params with a declared default. A level that never
 * kills an enemy / never picks up a drop is a clean no-op at tier 1.
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible defaults):
 *   dropChance   0..1 chance a killed enemy drops a tier power-up (default 0.22).
 *   maxTier      the highest tier a pickup can reach (default = the tier table length).
 *   dropSpeed    |px/s| downward drift of a dropped power-up toward the track (default 90).
 *   powerupSize  power-up display px (default 16).
 *   powerupSlot  power-up texture key (default the '__px' placeholder, tinted).
 *   tiers        the fire-pattern ladder; each entry { shots, cooldownMul, damage }.
 *                Default: t1 {1,1.0,1} → t2 {2,0.8,1} → t3 {3,0.62,2} → t4 {4,0.5,3}.
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** One rung of the fire-pattern ladder (what a tier upgrades the cannon to). */
export interface WeaponTierSpec {
  /** Bullets launched per fire at this tier (a wider spread fan as it grows). */
  shots: number;
  /** Multiplier on the pool's BASE cooldown at this tier (<1 ⇒ faster fire). */
  cooldownMul: number;
  /** Per-bullet damage the pool deals at this tier. */
  damage: number;
}

/** The default fire-pattern ladder (tier 1 = baseline; each pickup steps up). */
const DEFAULT_TIERS: WeaponTierSpec[] = [
  { shots: 1, cooldownMul: 1.0, damage: 1 },
  { shots: 2, cooldownMul: 0.8, damage: 1 },
  { shots: 3, cooldownMul: 0.62, damage: 2 },
  { shots: 4, cooldownMul: 0.5, damage: 3 },
];

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'PowerUpTier',
  intent:
    "Weapon-tier power-ups: killed enemies occasionally drop a tier pickup; flying through it raises the player's weapon tier, escalating the live ProjectilePool's fire pattern (more shots per volley, faster cooldown, harder-hitting bullets) up to a cap. The composable shmup escalation ladder.",
  attachesTo: 'scene',
  params: ['dropChance', 'maxTier', 'dropSpeed', 'powerupSize', 'powerupSlot', 'tiers'],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface PowerUpTierConfig {
  dropChance?: number;
  maxTier?: number;
  dropSpeed?: number;
  powerupSize?: number;
  powerupSlot?: string;
  tiers?: WeaponTierSpec[];
}

export class PowerUpTier implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly dropChance: number;
  private readonly dropSpeed: number;
  private readonly powerupSize: number;
  private readonly powerupSlot?: string;
  private readonly tiers: WeaponTierSpec[];
  private readonly maxTier: number;

  /** The live weapon tier (1-based; 1 = baseline, raised by pickups, capped at maxTier). */
  private tier = 1;
  /** The ProjectilePool's BASE cooldown, captured on attach so multipliers compound off it. */
  private baseCooldownMs: number | undefined;
  /** Monotonic id for spawned power-ups (the payload id source — auto-derived, never config). */
  private _powerupSeq = 0;

  constructor(params: PowerUpTierConfig = {}) {
    this.dropChance = Math.min(1, Math.max(0, params.dropChance ?? 0.22));
    this.dropSpeed = params.dropSpeed ?? 90;
    this.powerupSize = Math.max(1, params.powerupSize ?? 16);
    this.powerupSlot = params.powerupSlot;
    const ladder =
      Array.isArray(params.tiers) && params.tiers.length > 0 ? params.tiers : DEFAULT_TIERS;
    // Normalize every rung so a permuted/partial table still escalates safely.
    this.tiers = ladder.map((t) => ({
      shots: Math.max(1, Math.floor(t?.shots ?? 1)),
      cooldownMul: Math.min(1, Math.max(0.1, t?.cooldownMul ?? 1)),
      damage: Math.max(1, Math.floor(t?.damage ?? 1)),
    }));
    // maxTier is bounded by the ladder length (you cannot reach a rung that does not exist).
    const cap = Math.max(1, Math.floor(params.maxTier ?? this.tiers.length));
    this.maxTier = Math.min(cap, this.tiers.length);
  }

  reset(): void {
    this.tier = 1;
    this.baseCooldownMs = undefined;
    this._powerupSeq = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    // The drops group (a plain physics group, the powerups convention this module uses).
    if (!scene.powerups || typeof scene.powerups.getChildren !== 'function') {
      scene.powerups = scene.physics.add.group();
    }
    // Capture the cannon's base cooldown ONCE so tier multipliers compound off the baseline.
    const pool = scene.__projectilePool;
    if (pool && typeof pool.cooldownMs === 'number') this.baseCooldownMs = pool.cooldownMs;
    // Mirror the live tier so it is observable from the first frame.
    scene.weaponTier = this.tier;
    if (scene.player) scene.player.weaponTier = this.tier;
    // Apply the starting tier (idempotent at tier 1) + expose self for diagnostics / the driver.
    this.applyTierToCannon(scene);
    scene.__powerUpTier = this;
  }

  /**
   * Wire the seams this system owns:
   *   - player ↔ power-up → collect → raise the weapon tier (weapon.upgraded);
   *   - wrap the scene's onEnemyKilled to roll a drop on each formation kill.
   */
  setupCollisions(): void {
    const scene = this.scene;
    if (!scene) return;

    if (scene.player) {
      scene.physics.add.overlap(scene.powerups, scene.player, (powerup: any, _player: any) => {
        if (!powerup || powerup.active === false) return;
        this.collectPowerup(powerup);
      });
    }

    // WRAP (do not replace) the existing onEnemyKilled so other kill listeners survive.
    const prior = scene.onEnemyKilled?.bind(scene);
    scene.onEnemyKilled = (enemy: any) => {
      prior?.(enemy);
      this.maybeDropPowerup(enemy);
    };
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    // Cull power-ups that drifted off the bottom of the field (the no-leak path).
    const grp = scene.powerups;
    if (!grp || typeof grp.getChildren !== 'function') return;
    const H = scene.mapHeight ?? scene.scale?.height ?? 768;
    for (const p of [...grp.getChildren()]) {
      if (!p || p.active === false) continue;
      if (p.y > H + 24) this.releasePowerup(p);
    }
  }

  // ── the drop ──────────────────────────────────────────────────────────────

  /** On a kill, roll the drop chance → spawn a tier power-up that drifts toward the player. */
  private maybeDropPowerup(enemy: any): void {
    const scene = this.scene;
    if (!scene || !enemy) return;
    if (this.tier >= this.maxTier) return; // already maxed — no point dropping.
    if (Math.random() >= this.dropChance) return;

    const key = this.powerupSlot && scene.textures.exists(this.powerupSlot) ? this.powerupSlot : '__px';
    const sprite = scene.physics.add.sprite(enemy.x, enemy.y, key) as any;
    if (typeof sprite.setDisplaySize === 'function') sprite.setDisplaySize(this.powerupSize, this.powerupSize);
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      sprite.setVelocity?.(0, this.dropSpeed); // drift DOWN toward the player's track
    }
    if (!scene.textures.exists(this.powerupSlot ?? '')) sprite.setTint?.(0x44ddff);
    sprite.__type = 'collectible';
    sprite.__kind = 'powerup';
    sprite.__id = `pwr_${this._powerupSeq++}`;
    scene.powerups.add(sprite);
  }

  // ── the collect → tier escalation (the heart) ───────────────────────────────

  /** Collect a power-up: consume it, raise the weapon tier (capped), escalate the cannon. */
  private collectPowerup(powerup: any): void {
    const scene = this.scene;
    this.releasePowerup(powerup);

    if (this.tier >= this.maxTier) return; // maxed — a pickup at the cap is a no-op.
    this.tier += 1;
    scene.weaponTier = this.tier;
    if (scene.player) scene.player.weaponTier = this.tier;
    this.applyTierToCannon(scene);

    const spec = this.specFor(this.tier);
    // The PUSH seam: the player collected a tier power-up (the weapon tier increased).
    this.bus?.emit('weapon.upgraded', {
      tier: this.tier,
      maxTier: this.maxTier,
      shots: spec.shots,
    });
  }

  /** The tier rung for a 1-based tier (clamped into the ladder). */
  private specFor(tier: number): WeaponTierSpec {
    const i = Math.min(this.tiers.length - 1, Math.max(0, tier - 1));
    return this.tiers[i];
  }

  /**
   * Apply the current tier's fire pattern to the live ProjectilePool: scale the BASE
   * cooldown by the rung's multiplier, set per-bullet damage, and set the per-volley
   * shot count the pool fires (a wider spread as the tier climbs). Reads the pool off
   * the scene; a level with no pool just tracks the tier value.
   */
  private applyTierToCannon(scene: any): void {
    const pool = scene.__projectilePool;
    if (!pool) return;
    const spec = this.specFor(this.tier);
    if (this.baseCooldownMs === undefined && typeof pool.cooldownMs === 'number') {
      this.baseCooldownMs = pool.cooldownMs;
    }
    if (typeof this.baseCooldownMs === 'number') {
      pool.cooldownMs = Math.max(60, Math.round(this.baseCooldownMs * spec.cooldownMul));
    }
    if (typeof pool.damage === 'number') pool.damage = spec.damage;
    // The fire-pattern width: the pool reads this when launching a volley. Set unconditionally
    // so a pool that honors a per-volley spread escalates with the tier.
    pool.shotsPerVolley = spec.shots;
  }

  // ── cleanup ─────────────────────────────────────────────────────────────────

  /** Destroy + remove one power-up (idempotent). */
  private releasePowerup(powerup: any): void {
    if (!powerup || powerup.active === false) return;
    powerup.setActive?.(false);
    powerup.setVisible?.(false);
    if (powerup.body) powerup.body.enable = false;
    powerup.destroy?.();
  }

  // ── diagnostics (EXPOSED for the verify driver) ──────────────────────────────

  /** The live weapon tier (the weapon.upgraded observable). */
  public weaponTier(): number {
    return this.tier;
  }
  /** The cap a pickup can reach (the ladder length, bounded by maxTier). */
  public tierCap(): number {
    return this.maxTier;
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - weapon.upgraded ← collectPowerup (the player collects a tier power-up)  [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {
        'weaponTier': () => this.weaponTier(),
      },
      anchors: [],
      events: [
        {
          name: 'weapon.upgraded',
          payload: '{tier,maxTier,shots}',
          scope: 'archetype',
          drivenBy: 'the player collects (overlaps) a tier power-up drop',
          expect:
            'the weapon tier increases (scene.weaponTier increments, the live ProjectilePool fire pattern escalates — faster cooldown, more shots/volley, more damage) up to maxTier; weapon.upgraded logged',
        },
      ],
    };
  }
}
