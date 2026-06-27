/**
 * ============================================================================
 * ShieldPickup — a one-hit shield power-up that absorbs the next lethal hit (BUILD — system)
 * ============================================================================
 *
 * The endless-runner "second chance" reward layer: it streams collectible SHIELD power-ups
 * through the auto-scroll world (one orb at a config cadence, its vertical center drawn from
 * a SEEDED PRNG so it sits in a reachable band), advances each orb LEFT at the scroll speed
 * every frame, and CULLS orbs past the left edge. When the fixed-x avatar OVERLAPS an orb it
 * is COLLECTED: the run gains a SHIELD (a one-hit charge) and the orb DESPAWNS.
 *
 * The shield then ABSORBS the NEXT lethal hit instead of letting the avatar die. The runner's
 * single death path is `avatar.takeDamage(n)` (the scroller / chaser drain health to fire the
 * engine lose seam). This system WRAPS that one seam in attach(): while a shield is held, a
 * LETHAL incoming damage (enough to drop health to ≤ 0) is CONSUMED — the shield breaks, the
 * avatar's health is restored to full, and the run SURVIVES (status stays 'playing'); the
 * underlying death path is NOT called. Without a shield (or for non-lethal damage) the wrap is
 * transparent — the original takeDamage runs unchanged, so it invents NO new death/damage path.
 *
 * So a shield turns one fatal mistake into a survivable one — exactly once per orb collected.
 *
 * IDENTITY (id source): the orb's `id` is this system's OWN auto-derived id (`shield_<n>`,
 * minted at spawn from a monotonic counter) — NOT a config param; an orb is this system's own
 * spawned entity, so its id is auto-derived per the standard's ID-SOURCE convention.
 *
 * THE INVARIANTS IT ENFORCES:
 *   - INV-ABSORB-ONCE: each collected shield absorbs EXACTLY ONE lethal hit, then is gone — the
 *     `shielded` flag is a single-charge latch (gained on collect, cleared on the absorbed hit).
 *   - INV-TRANSPARENT: when no shield is held the wrapped takeDamage is byte-identical to the
 *     original; a non-lethal hit while shielded also passes straight through (the shield only
 *     spends itself to PREVENT death). The system owns no death path of its own.
 *   - INV-DETERMINISTIC: the orb cadence + vertical center come from a SEEDED PRNG
 *     (utils.SeededRandom), NEVER Math.random() — same seed ⇒ identical orb layout (replayable).
 *   - INV-RESET: reset() destroys live orbs, re-seeds the PRNG, clears the shield flag + cursor,
 *     and restores the ORIGINAL takeDamage wrap state, so a restarted run re-arms byte-identically.
 *   - bounded memory: an orb past the left edge is destroyed (no leak).
 *
 * OBSERVABLE (the contract): a collect sets the run's shield flag (this.shielded → mirrored on
 * scene.shielded) true; an absorbed hit clears it AND the avatar survives (registry 'status'
 * stays 'playing', the hook surfaces it). Every live orb is added to scene.shieldPickups so the
 * hook can surface it among the world entities.
 *
 * EVENTS (the PUSH channel, on the shared scene.eventBus):
 *   - shield.gained ← the avatar overlaps a shield orb (payload {id}); the shield flag becomes true.
 *   - shield.broken ← a lethal hit lands while shielded (payload {id}); the shield is consumed and
 *     the avatar survives (status stays 'playing').
 *
 * GENERIC: no game/theme, no baked coordinate. Every number is a DECLARED default, re-tunable via
 * params; a level that binds no shield stream just spawns the configured default orb cadence.
 */
import type { ISceneSystem } from '../scenes/runner-data';
import { SeededRandom } from '../utils';
import { type EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ShieldPickup',
  intent:
    "A one-hit shield power-up streamed through the auto-scroll world: collect an orb to gain a shield (a single charge). The shield absorbs the NEXT lethal hit instead of dying — it wraps the avatar's one death seam (takeDamage), consumes itself on the fatal hit, restores health, and the run survives (status stays 'playing'). The endless-runner second-chance reward.",
  attachesTo: 'scene',
  params: [
    'scrollSpeed',
    'spawnEveryPx',
    'orbSize',
    'centerMargin',
    'seed',
    'assetSlot',
    'floorY',
  ],
  tuning: ['scrollSpeed', 'spawnEveryPx', 'centerMargin'],
  roles: ['player', 'shield'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** Per-game tuning for the shield stream (every field DECLARED with a sensible default). */
export interface ShieldPickupConfig {
  /** Scroll speed (px/s) orbs drift left — matched to the world scroll. Default 150. */
  scrollSpeed?: number;
  /** Horizontal spacing (px) between successive shield orbs (rare reward). Default 1400. */
  spawnEveryPx?: number;
  /** Orb display diameter (px) — also the AABB collision box size. Default 30. */
  orbSize?: number;
  /** Margin (px) the orb keeps from the ceiling and floor (reachable band). Default 90. */
  centerMargin?: number;
  /** The deterministic PRNG seed for the orb layout (INV-DETERMINISTIC). Default 11. */
  seed?: number;
  /** asset/texture key for the orb body (falls back to a placeholder). */
  assetSlot?: string;
  /** The floor y the reachable band stops above (0 ⇒ derive from the live map height). Default 0. */
  floorY?: number;
}

/** Declared defaults (the runner shield-reward feel). Re-tuned per game via params. */
const DEF = {
  scrollSpeed: 150,
  spawnEveryPx: 1400,
  orbSize: 30,
  centerMargin: 90,
  seed: 11,
  floorY: 0, // 0 ⇒ derive from the live map height in attach().
};

/** One live shield orb: the sprite + its collected latch + its auto-derived id. */
interface ShieldOrb {
  id: string;
  sprite: any;
  /** Whether this orb has already been collected (so it scores/grants exactly once). */
  collected: boolean;
}

export class ShieldPickup implements ISceneSystem {
  private scene: any;
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly cfg: Required<Omit<ShieldPickupConfig, 'assetSlot'>> & { assetSlot?: string };
  private rng: SeededRandom;

  /** Live orbs (left→right). */
  private orbs: ShieldOrb[] = [];
  /** Distance scrolled since the last orb spawn (px). */
  private sinceSpawn = 0;
  /** Monotonic orb counter — mints each orb's auto-derived id. */
  private spawnCount = 0;
  /** The one-hit shield latch (INV-ABSORB-ONCE): true once an orb is collected. */
  private shielded = false;
  /** The id of the orb that granted the current shield (the shield.broken payload). */
  private chargeId = '';
  private floorY = 0;

  /** The avatar's original takeDamage, captured so the wrap is reversible (INV-RESET). */
  private originalTakeDamage: ((n: number) => void) | null = null;
  /** The avatar the wrap was installed on (so reset() can restore it precisely). */
  private wrappedAvatar: any = null;

  constructor(params: ShieldPickupConfig = {}) {
    this.cfg = {
      scrollSpeed: params.scrollSpeed ?? DEF.scrollSpeed,
      spawnEveryPx: params.spawnEveryPx ?? DEF.spawnEveryPx,
      orbSize: params.orbSize ?? DEF.orbSize,
      centerMargin: params.centerMargin ?? DEF.centerMargin,
      seed: params.seed ?? DEF.seed,
      floorY: params.floorY ?? DEF.floorY,
      assetSlot: params.assetSlot,
    };
    this.rng = new SeededRandom(this.cfg.seed);
  }

  reset(): void {
    // Destroy any standing orbs so a restarted run re-arms byte-identically.
    for (const o of this.orbs) o.sprite?.destroy?.();
    this.orbs = [];
    this.sinceSpawn = 0;
    this.spawnCount = 0;
    this.shielded = false;
    this.chargeId = '';
    this.rng.reset(); // INV-DETERMINISTIC + INV-RESET: same layout after restart.
    // Restore the original takeDamage wrap (so a restart does not double-wrap).
    if (this.wrappedAvatar && this.originalTakeDamage) {
      this.wrappedAvatar.takeDamage = this.originalTakeDamage;
    }
    this.wrappedAvatar = null;
    this.originalTakeDamage = null;
    if (this.scene) {
      this.scene.shieldPickups = this.orbs;
      this.scene.shielded = false;
    }
  }

  attach(scene: any): void {
    this.scene = scene;
    this.shielded = false;
    this.chargeId = '';
    this.floorY = this.cfg.floorY > 0 ? this.cfg.floorY : this.worldHeight() - 24;
    // Own the orbs group — the hook surfaces it among the world entities.
    if (!scene.shieldPickups || typeof scene.shieldPickups.getChildren !== 'function') {
      scene.shieldPickups = scene.physics.add.group();
    }
    // Publish the live shield flag for diagnostics / a HUD effect (single source of truth).
    scene.shielded = false;
    // Spawn the first orb just off the right edge so a shield is reachable early.
    this.sinceSpawn = this.cfg.spawnEveryPx;
    // Install the one-hit absorb by WRAPPING the avatar's single death seam.
    this.installAbsorbWrap();
  }

  /**
   * Wrap the avatar's takeDamage so a LETHAL hit while shielded is absorbed (the shield
   * breaks, health is restored, the run survives) instead of reaching the engine death path.
   * Transparent when no shield is held or the damage is non-lethal (INV-TRANSPARENT).
   */
  private installAbsorbWrap(): void {
    const scene = this.scene;
    const avatar = scene?.player;
    if (!avatar || typeof avatar.takeDamage !== 'function') return;
    // Capture the original once (reset() restores it; never double-wrap).
    if (this.wrappedAvatar === avatar && this.originalTakeDamage) return;
    const original = avatar.takeDamage.bind(avatar) as (n: number) => void;
    this.originalTakeDamage = original;
    this.wrappedAvatar = avatar;

    const self = this;
    avatar.takeDamage = function patchedTakeDamage(n: number): void {
      const dmg = Number.isFinite(n) ? n : 0;
      const lethal = (avatar.health ?? 0) - dmg <= 0;
      if (self.shielded && lethal && !avatar.isDead) {
        // ABSORB: spend the shield, restore the avatar, survive (no death path).
        self.breakShield(avatar);
        return;
      }
      // Transparent: a non-lethal hit, or no shield held — the original runs unchanged.
      original(dmg);
    };
  }

  /** Consume the one-hit shield: clear the flag, restore health, survive, emit. */
  private breakShield(avatar: any): void {
    const scene = this.scene;
    const brokenId = this.chargeId || 'shield';
    // The OBSERVABLE transition: the shield is consumed (flag → false); restore to full
    // so the avatar genuinely survives the otherwise-fatal hit.
    this.shielded = false;
    this.chargeId = '';
    if (scene) scene.shielded = false;
    avatar.health = avatar.maxHealth ?? 1;
    avatar.isInvulnerable = false;
    // The PUSH seam: a lethal hit landed while shielded — shield consumed, player survives.
    this.bus?.emit('shield.broken', { id: brokenId });
  }

  /** Wire avatar↔orb overlap → collect the shield (grant + despawn). */
  setupCollisions(): void {
    const scene = this.scene;
    const avatar = scene?.player;
    if (!avatar || !scene?.shieldPickups) return;
    scene.physics.add.overlap(avatar, scene.shieldPickups, (a: any, orbSprite: any) => {
      if (a.isDead) return;
      if (!orbSprite || orbSprite.active === false) return;
      this.collect(orbSprite);
    });
    // The avatar may not have existed when attach() ran in some orders; ensure the wrap.
    this.installAbsorbWrap();
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    const dt = 1 / 60;
    const dx = this.cfg.scrollSpeed * dt;

    // Advance every live orb.
    for (const o of this.orbs) o.sprite.x -= dx;

    // Cull orbs fully past the left edge (bounded memory — no leak).
    const kept: ShieldOrb[] = [];
    for (const o of this.orbs) {
      if (o.sprite.x + this.cfg.orbSize < -8) o.sprite.destroy();
      else kept.push(o);
    }
    if (kept.length !== this.orbs.length) {
      this.orbs = kept;
      scene.shieldPickups = scene.shieldPickups; // group identity unchanged; pool refreshed
    }

    // Spawn a new orb on the consistent distance cadence.
    this.sinceSpawn += dx;
    if (this.sinceSpawn >= this.cfg.spawnEveryPx) {
      this.sinceSpawn -= this.cfg.spawnEveryPx;
      this.spawnOrb();
    }
  }

  /** Spawn ONE shield orb just off the right edge at a SEEDED center y. */
  private spawnOrb(): void {
    const scene = this.scene;
    const W = this.worldWidth();
    const margin = this.cfg.centerMargin;
    // The orb drawn from a reachable band — never an edge spawn.
    const minC = margin;
    const maxC = this.floorY - margin;
    const centerY = maxC > minC ? this.rng.range(minC, maxC) : (minC + maxC) / 2;

    const slot = this.cfg.assetSlot;
    const key = slot && scene.textures.exists(slot) ? slot : '__px';
    const cx = W + this.cfg.orbSize / 2 + 4;
    const id = `shield_${this.spawnCount}`;
    this.spawnCount += 1;
    const sprite = this.makeOrb(cx, centerY, key, id);
    this.orbs.push({ id, sprite, collected: false });
  }

  /** Make one orb body of the configured size, tagged for the world entities surface. */
  private makeOrb(cx: number, cy: number, key: string, id: string): any {
    const scene = this.scene;
    const size = this.cfg.orbSize;
    const sprite = scene.physics.add.sprite(cx, cy, key) as any;
    if (typeof sprite.setDisplaySize === 'function') sprite.setDisplaySize(size, size);
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.setImmovable?.(true);
      body.setSize?.(size / (sprite.scaleX || 1), size / (sprite.scaleY || 1), true);
    }
    sprite.__id = id;
    sprite.__type = 'shield';
    scene.shieldPickups.add(sprite);
    return sprite;
  }

  /** Collect ONE orb: grant the shield, despawn, emit — exactly once. */
  private collect(orbSprite: any): void {
    const scene = this.scene;
    // Find the live orb record by sprite identity; ignore an already-collected one.
    const orb = this.orbs.find((o) => o.sprite === orbSprite);
    if (!orb || orb.collected) return;
    orb.collected = true;

    // The OBSERVABLE transition: the run's shield flag becomes true (single charge).
    this.shielded = true;
    this.chargeId = orb.id;
    scene.shielded = true;
    // Ensure the absorb wrap is live (covers any attach/collision ordering).
    this.installAbsorbWrap();

    // Despawn the orb immediately (no lingering sprite) and drop it from the pool.
    orb.sprite?.destroy?.();
    this.orbs = this.orbs.filter((o) => o !== orb);
    scene.shieldPickups = scene.shieldPickups; // group identity unchanged; pool refreshed

    // The PUSH seam: the avatar overlapped a shield orb — the shield flag is now true.
    this.bus?.emit('shield.gained', { id: orb.id });
  }

  private worldWidth(): number {
    return this.scene?.mapWidth ?? this.scene?.scale?.width ?? 432;
  }
  private worldHeight(): number {
    return this.scene?.mapHeight ?? this.scene?.scale?.height ?? 768;
  }

  /**
   * The PUSH channel this system publishes (one true statement per real emit site):
   *   - shield.gained ← collect (the avatar overlapped a shield orb) [archetype]
   *   - shield.broken ← breakShield (a lethal hit landed while shielded) [archetype]
   *
   * No surface observables: the shield flag is an archetype extra (not a core GameHook
   * field), so — like ChaserSystem's gap — it is published on scene.shielded for
   * diagnostics and witnessed via the event log + the survival fact (status stays
   * 'playing'), keeping the observable membership clean.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'shield.gained',
          payload: '{id}',
          scope: 'archetype',
          drivenBy: 'the avatar overlapping a shield power-up orb',
          expect:
            'the orb despawns and the run gains a one-hit shield (scene.shielded becomes true); shield.gained logged',
        },
        {
          name: 'shield.broken',
          payload: '{id}',
          scope: 'archetype',
          drivenBy: 'a lethal hit landing while the avatar is shielded',
          expect:
            "the shield is consumed (scene.shielded becomes false) and the avatar SURVIVES — __GAME__.status stays 'playing' instead of becoming 'lost'; shield.broken logged",
        },
      ],
    };
  }
}
