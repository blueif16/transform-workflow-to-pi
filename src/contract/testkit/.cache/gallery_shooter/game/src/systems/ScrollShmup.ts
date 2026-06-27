/**
 * ScrollShmup — the SCROLLING SHOOT-'EM-UP layer (BUILD — gallery-shooter engine
 * piece, genre=scrolling-shmup). It overlays the fixed-axis gallery base with the
 * three things a vertical shmup adds beyond a static Space-Invaders rack:
 *
 *   1. a SCROLLING BACKGROUND — the bound bg TileSprite scrolls downward each frame
 *      (the sense of forward flight), the cheapest, most-readable shmup signal;
 *   2. ENEMY BULLET-PATTERN EMITTERS — on a cadence, each live formation enemy fires
 *      a configurable bullet PATTERN (aimed / spread / radial) DOWN at the player;
 *      the bullets are pooled into scene.enemyBullets (the group __GAME__ surfaces as
 *      enemy projectiles) and chew the player on overlap;
 *   3. POWER-UP WEAPON TIERS — killed enemies occasionally drop a power-up; the player
 *      flying through it RAISES the weapon tier (tier N ⇒ a faster, harder-hitting
 *      cannon), which this system applies to the live ProjectilePool;
 *   4. a BOSS with an HP BAR — once the wave quota is exhausted a boss spawns with a
 *      large HP pool (surfaced as __GAME__.enemyHP); player shots whittle it down and
 *      its death is the win.
 *
 * It owns NO movement of the formation (FormationMarch does), NO player firing
 * (ProjectilePool does) and NO wave bookkeeping (WaveLoop does) — it READS those
 * systems off the scene (scene.__projectilePool, scene.__formationMarch) and LAYERS
 * the shmup feel on top. A level that binds it on a base with no formation still runs
 * (the emitter loop simply finds no enemies → a clean no-op until the boss).
 *
 * GENERIC: no game/theme, no baked coordinate — geometry comes from the live members
 * + map bounds; every cadence/speed/tier is DATA via params with a declared default.
 *
 * OBSERVABLE (the contract — what a verify run polls):
 *   - enemy bullets enter scene.enemyBullets ⇒ __GAME__.entities gains enemy-bullet
 *     projectiles (pattern.fired raises the active count);
 *   - the weapon tier is mirrored onto scene.weaponTier (and the player) and rises on
 *     pickup (powerup.collected);
 *   - the boss HP is mirrored onto scene.enemyHP (the surfaced extra) and falls on a
 *     player hit (boss.damaged).
 *
 * EVENT (the PUSH channel): pattern.fired ← an enemy emits a bullet pattern;
 *   powerup.collected ← the player overlaps a power-up; boss.damaged ← a player shot
 *   hits the boss.
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible defaults):
 *   scrollSpeed     bg downward scroll px/s (default 60).
 *   fireEveryMs     ms between enemy pattern volleys (default 1100).
 *   pattern         'aimed' | 'spread' | 'radial' enemy bullet shape (default 'aimed').
 *   spreadCount     bullets per spread/radial volley (default 3).
 *   bulletSpeed     |px/s| enemy bullet speed (default 180).
 *   bulletSize      enemy bullet display px (default 8).
 *   bulletDamage    damage one enemy bullet deals the player (default 1).
 *   enemyBulletCap  max simultaneous live enemy bullets, the no-leak bound (default 48).
 *   dropChance      0..1 chance a killed enemy drops a power-up (default 0.25).
 *   maxTier         the highest weapon tier a pickup can reach (default 3).
 *   bossHp          the boss HP pool / HP-bar denominator (default 40).
 *   bossDamage      damage one player shot deals the boss (default 1).
 *   bossSlot        boss texture key (default the generated 'boss' / placeholder).
 *   bulletSlot      enemy-bullet texture key (default placeholder).
 *   powerupSlot     power-up texture key (default placeholder).
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ScrollShmup',
  intent:
    'Overlay the gallery base with the scrolling shoot-\'em-up layer: a scrolling background, enemy bullet-pattern emitters (aimed/spread/radial) into a pooled enemyBullets group, power-up weapon tiers applied to the live ProjectilePool, and a boss with an HP bar whose death is the win. Reads the formation/firing/wave systems off the scene; the genre layer of the gallery shooter.',
  attachesTo: 'scene',
  params: [
    'scrollSpeed',
    'fireEveryMs',
    'pattern',
    'spreadCount',
    'bulletSpeed',
    'bulletSize',
    'bulletDamage',
    'enemyBulletCap',
    'dropChance',
    'maxTier',
    'bossHp',
    'bossDamage',
    'bossSlot',
    'bulletSlot',
    'powerupSlot',
  ],
  roles: ['enemy', 'player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export type BulletPattern = 'aimed' | 'spread' | 'radial';

export interface ScrollShmupConfig {
  scrollSpeed?: number;
  fireEveryMs?: number;
  pattern?: BulletPattern;
  spreadCount?: number;
  bulletSpeed?: number;
  bulletSize?: number;
  bulletDamage?: number;
  enemyBulletCap?: number;
  dropChance?: number;
  maxTier?: number;
  bossHp?: number;
  bossDamage?: number;
  bossSlot?: string;
  bulletSlot?: string;
  powerupSlot?: string;
}

export class ScrollShmup implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly scrollSpeed: number;
  private readonly fireEveryMs: number;
  private readonly pattern: BulletPattern;
  private readonly spreadCount: number;
  private readonly bulletSpeed: number;
  private readonly bulletSize: number;
  private readonly bulletDamage: number;
  private readonly enemyBulletCap: number;
  private readonly dropChance: number;
  private readonly maxTier: number;
  private readonly bossHp: number;
  private readonly bossDamage: number;
  private readonly bossSlot?: string;
  private readonly bulletSlot?: string;
  private readonly powerupSlot?: string;

  /** ms accumulated toward the next enemy volley (fixed-step, frame-rate-independent). */
  private fireAcc = 0;
  /** The live weapon tier (starts at 1; raised by power-ups, capped at maxTier). */
  private tier = 1;
  /** The boss sprite once spawned (null before the wave quota is met / after death). */
  private boss: any = null;
  /** Latches true once the boss has been spawned (so it spawns exactly once). */
  private bossSpawned = false;
  /** Latches true once the boss is dead (so the win fires exactly once). */
  private bossDead = false;

  constructor(params: ScrollShmupConfig = {}) {
    this.scrollSpeed = params.scrollSpeed ?? 60;
    this.fireEveryMs = Math.max(1, params.fireEveryMs ?? 1100);
    this.pattern = params.pattern === 'spread' || params.pattern === 'radial' ? params.pattern : 'aimed';
    this.spreadCount = Math.max(1, Math.floor(params.spreadCount ?? 3));
    this.bulletSpeed = params.bulletSpeed ?? 180;
    this.bulletSize = params.bulletSize ?? 8;
    this.bulletDamage = params.bulletDamage ?? 1;
    this.enemyBulletCap = Math.max(1, Math.floor(params.enemyBulletCap ?? 48));
    this.dropChance = Math.min(1, Math.max(0, params.dropChance ?? 0.25));
    this.maxTier = Math.max(1, Math.floor(params.maxTier ?? 3));
    this.bossHp = Math.max(1, Math.floor(params.bossHp ?? 40));
    this.bossDamage = Math.max(1, params.bossDamage ?? 1);
    this.bossSlot = params.bossSlot;
    this.bulletSlot = params.bulletSlot;
    this.powerupSlot = params.powerupSlot;
  }

  reset(): void {
    this.fireAcc = 0;
    this.tier = 1;
    this.boss = null;
    this.bossSpawned = false;
    this.bossDead = false;
  }

  attach(scene: any): void {
    this.scene = scene;
    // The two pooled groups this layer owns. enemyBullets is a hook-known group name
    // (__GAME__.entities surfaces it as enemy projectiles); powerups is a plain group.
    if (!scene.enemyBullets || typeof scene.enemyBullets.getChildren !== 'function') {
      scene.enemyBullets = scene.physics.add.group();
    }
    if (!scene.powerups || typeof scene.powerups.getChildren !== 'function') {
      scene.powerups = scene.physics.add.group();
    }
    // Mirror the live weapon tier onto the scene + player so it is observable.
    scene.weaponTier = this.tier;
    if (scene.player) scene.player.weaponTier = this.tier;
    // Expose self for diagnostics / the verify driver.
    scene.__scrollShmup = this;
  }

  /**
   * Wire the overlaps this layer owns:
   *   - enemy bullet  ↔ player   → damage the player + release the bullet;
   *   - player bullet ↔ boss     → damage the boss (boss.damaged) + release the shot;
   *   - player        ↔ power-up → raise the tier (powerup.collected) + consume it.
   * The enemy-killed → power-up drop hook is wired off the scene's onEnemyKilled.
   */
  setupCollisions(): void {
    const scene = this.scene;
    if (!scene) return;

    // enemy bullet hits the player → the player takes a hit (engine death path).
    if (scene.player) {
      scene.physics.add.overlap(scene.enemyBullets, scene.player, (bullet: any, player: any) => {
        if (!bullet || bullet.active === false) return;
        if (!player || player.isDead || player.active === false) return;
        player.takeDamage?.(this.bulletDamage);
        this.releaseBullet(bullet);
      });
    }

    // player flies through a power-up → raise the weapon tier.
    if (scene.player) {
      scene.physics.add.overlap(scene.powerups, scene.player, (powerup: any, _player: any) => {
        if (!powerup || powerup.active === false) return;
        this.collectPowerup(powerup);
      });
    }

    // Hook the enemy-killed seam to roll a power-up drop. We WRAP the scene's existing
    // onEnemyKilled (BaseGameScene fires it on every formation kill) without replacing it.
    const prior = scene.onEnemyKilled?.bind(scene);
    scene.onEnemyKilled = (enemy: any) => {
      prior?.(enemy);
      this.maybeDropPowerup(enemy);
    };
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;

    this.scrollBackground(scene);
    this.advanceEnemyBullets(scene);

    // Boss phase: once the formation is cleared AND every wave is done, spawn the boss.
    if (!this.bossSpawned && this.formationCleared()) {
      this.spawnBoss(scene);
    }

    // Enemy fire cadence (fixed-step accumulator). Volleys come from the live formation
    // (pre-boss) or from the boss itself (boss phase).
    const dtMs = scene.game?.loop?.delta ?? 16.67;
    this.fireAcc += dtMs;
    if (this.fireAcc >= this.fireEveryMs) {
      this.fireAcc -= this.fireEveryMs;
      this.fireEnemyVolley(scene);
    }
  }

  // ── background scroll ───────────────────────────────────────────────────────

  /** Scroll the bound bg TileSprite downward for the sense of forward flight. */
  private scrollBackground(scene: any): void {
    const bg = scene.background;
    if (!bg || typeof bg.tilePositionY !== 'number') return;
    const dt = (scene.game?.loop?.delta ?? 16.67) / 1000;
    bg.tilePositionY -= this.scrollSpeed * dt; // negative ⇒ texture appears to fall toward the player
  }

  // ── enemy bullet-pattern emitters ────────────────────────────────────────────

  /** Whether the marching formation has been fully cleared (the boss-phase gate). */
  private formationCleared(): boolean {
    const fm = this.scene?.__formationMarch;
    if (fm && typeof fm.aliveCount === 'function') return fm.aliveCount() === 0;
    const grp = this.scene?.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return true;
    return grp.getChildren().filter((e: any) => e && e.active !== false && !e.isDead).length === 0;
  }

  /** The live shooter: a random alive formation member, or the boss in the boss phase. */
  private pickShooter(scene: any): any {
    if (this.boss && this.boss.active !== false && !this.boss.isDead) return this.boss;
    const grp = scene.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return null;
    const alive = grp.getChildren().filter((e: any) => e && e.active !== false && !e.isDead);
    if (alive.length === 0) return null;
    return alive[Math.floor(Math.random() * alive.length)];
  }

  /** Fire one bullet PATTERN from a live shooter DOWN toward the player. */
  private fireEnemyVolley(scene: any): void {
    const shooter = this.pickShooter(scene);
    if (!shooter) return;
    const player = scene.player;
    const sx = shooter.x;
    const sy = shooter.y + (shooter.displayHeight ?? 22) / 2;

    let fired = 0;
    if (this.pattern === 'aimed' && player) {
      // One bullet straight at the player's current position.
      const ang = Math.atan2(player.y - sy, player.x - sx);
      fired += this.spawnBullet(scene, sx, sy, ang) ? 1 : 0;
    } else if (this.pattern === 'spread') {
      // A fan of bullets centered on straight-down (or at the player if present).
      const center = player ? Math.atan2(player.y - sy, player.x - sx) : Math.PI / 2;
      const fanRad = (30 * Math.PI) / 180; // ±30° total fan
      const n = this.spreadCount;
      for (let i = 0; i < n; i += 1) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5..0.5
        fired += this.spawnBullet(scene, sx, sy, center + t * fanRad) ? 1 : 0;
      }
    } else {
      // radial — a ring of bullets in every direction.
      const n = this.spreadCount;
      for (let i = 0; i < n; i += 1) {
        const ang = (i / n) * Math.PI * 2;
        fired += this.spawnBullet(scene, sx, sy, ang) ? 1 : 0;
      }
    }

    if (fired > 0) {
      // The PUSH seam: an enemy emitted a bullet pattern (active enemy bullets rose).
      this.bus?.emit('pattern.fired', {
        x: Math.round(sx),
        y: Math.round(sy),
        pattern: this.pattern,
        count: fired,
      });
    }
  }

  /** Spawn ONE enemy bullet at (x,y) moving along `angle`. Respects the no-leak cap. */
  private spawnBullet(scene: any, x: number, y: number, angle: number): boolean {
    const grp = scene.enemyBullets;
    if (!grp) return false;
    const live = grp.getChildren().filter((b: any) => b && b.active !== false).length;
    if (live >= this.enemyBulletCap) return false; // bound the live count (no leak).

    const key = this.bulletSlot && scene.textures.exists(this.bulletSlot) ? this.bulletSlot : '__px';
    const sprite = scene.physics.add.sprite(x, y, key) as any;
    if (typeof sprite.setDisplaySize === 'function') {
      sprite.setDisplaySize(this.bulletSize, this.bulletSize);
    }
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      sprite.setVelocity?.(Math.cos(angle) * this.bulletSpeed, Math.sin(angle) * this.bulletSpeed);
    }
    if (!scene.textures.exists(this.bulletSlot ?? '')) sprite.setTint?.(0xff5577);
    sprite.__type = 'projectile';
    sprite.__kind = 'enemyBullet';
    sprite.__id = `ebullet_${this._ebulletSeq++}`;
    grp.add(sprite);
    return true;
  }
  private _ebulletSeq = 0;

  /** Advance + cull enemy bullets that left the field (the no-leak path). */
  private advanceEnemyBullets(scene: any): void {
    const grp = scene.enemyBullets;
    if (!grp || typeof grp.getChildren !== 'function') return;
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    const H = scene.mapHeight ?? scene.scale?.height ?? 768;
    for (const b of [...grp.getChildren()]) {
      if (!b || b.active === false) continue;
      if (b.y > H + 16 || b.y < -16 || b.x < -16 || b.x > W + 16) this.releaseBullet(b);
    }
  }

  /** Destroy + remove one enemy bullet (idempotent). */
  private releaseBullet(bullet: any): void {
    if (!bullet || bullet.active === false) return;
    bullet.setActive?.(false);
    bullet.setVisible?.(false);
    const body = bullet.body;
    if (body) body.enable = false;
    bullet.destroy?.();
  }

  // ── power-up weapon tiers ────────────────────────────────────────────────────

  /** On a kill, roll the drop chance → spawn a power-up that falls toward the player. */
  private maybeDropPowerup(enemy: any): void {
    const scene = this.scene;
    if (!scene || !enemy) return;
    if (this.tier >= this.maxTier) return; // already maxed — no need to drop.
    if (Math.random() >= this.dropChance) return;
    const key = this.powerupSlot && scene.textures.exists(this.powerupSlot) ? this.powerupSlot : '__px';
    const sprite = scene.physics.add.sprite(enemy.x, enemy.y, key) as any;
    if (typeof sprite.setDisplaySize === 'function') sprite.setDisplaySize(16, 16);
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      sprite.setVelocity?.(0, 90); // drift down toward the player's track
    }
    if (!scene.textures.exists(this.powerupSlot ?? '')) sprite.setTint?.(0x44ddff);
    sprite.__type = 'collectible';
    sprite.__kind = 'powerup';
    sprite.__id = `pwr_${this._powerupSeq++}`;
    scene.powerups.add(sprite);
  }
  private _powerupSeq = 0;

  /** Collect a power-up: raise the weapon tier (capped) + boost the live ProjectilePool. */
  private collectPowerup(powerup: any): void {
    const scene = this.scene;
    powerup.setActive?.(false);
    powerup.setVisible?.(false);
    if (powerup.body) powerup.body.enable = false;
    powerup.destroy?.();

    if (this.tier >= this.maxTier) return;
    this.tier += 1;
    scene.weaponTier = this.tier;
    if (scene.player) scene.player.weaponTier = this.tier;
    this.applyTierToCannon(scene);

    // The PUSH seam: the player collected a power-up (the weapon tier rose).
    this.bus?.emit('powerup.collected', { tier: this.tier });
  }

  /**
   * Apply the current tier to the live ProjectilePool (faster cooldown + more damage).
   * Reads the pool off the scene; a level with no pool just tracks the tier value.
   */
  private applyTierToCannon(scene: any): void {
    const pool = scene.__projectilePool;
    if (!pool) return;
    // tier 1 = baseline; each tier shaves cooldown ~20% (floor 80ms) and +1 damage.
    if (typeof pool.cooldownMs === 'number') {
      pool.cooldownMs = Math.max(80, Math.round(pool.cooldownMs * 0.8));
    }
    if (typeof pool.damage === 'number') pool.damage += 1;
  }

  // ── the boss + its HP bar ────────────────────────────────────────────────────

  /** Spawn the boss (once) with a large HP pool surfaced as __GAME__.enemyHP. */
  private spawnBoss(scene: any): void {
    this.bossSpawned = true;
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    const key = this.bossSlot && scene.textures.exists(this.bossSlot) ? this.bossSlot : '__px';
    const boss = scene.physics.add.sprite(W / 2, 90, key) as any;
    if (typeof boss.setDisplaySize === 'function') boss.setDisplaySize(120, 64);
    const body = boss.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.setImmovable?.(true);
    }
    if (!scene.textures.exists(this.bossSlot ?? '')) boss.setTint?.(0xcc3344);
    boss.__type = 'enemy';
    boss.__kind = 'boss';
    boss.__id = 'boss';
    boss.isDead = false;
    boss.maxHealth = this.bossHp;
    boss.health = this.bossHp;
    // The boss takes the SAME .takeDamage seam a formation member uses, so the existing
    // playerBullets↔enemies overlap (ProjectilePool) ALSO damages it once it's in enemies.
    boss.takeDamage = (n: number) => this.damageBoss(n);
    scene.enemies.add(boss); // so ProjectilePool's bullet↔enemies overlap reaches it
    this.boss = boss;

    // Surface the boss HP for the HP-bar / __GAME__.enemyHP extra.
    scene.enemyHP = boss.health;
    scene.bossMaxHP = boss.maxHealth;
  }

  /** Damage the boss by a player shot: drop HP, fire boss.damaged, win on death. */
  private damageBoss(n: number): void {
    const scene = this.scene;
    const boss = this.boss;
    if (!boss || boss.isDead) return;
    const dmg = Number.isFinite(n) ? Math.max(this.bossDamage, n) : this.bossDamage;
    boss.health = Math.max(0, boss.health - dmg);
    scene.enemyHP = boss.health; // the HP-bar denominator falls (the observable transition).

    // The PUSH seam: a player shot hit the boss (its HP fell).
    this.bus?.emit('boss.damaged', { hp: boss.health, maxHp: boss.maxHealth });

    if (boss.health <= 0 && !this.bossDead) {
      this.bossDead = true;
      boss.isDead = true;
      boss.setActive?.(false);
      if (boss.body) boss.body.enable = false;
      boss.destroy?.();
      this.boss = null;
      // The boss is the final threat — its death is the win.
      scene.onLevelComplete?.();
    }
  }

  // ── diagnostics (EXPOSED for the verify driver) ──────────────────────────────

  /** Live enemy-bullet count (the no-leak proof + the pattern.fired observable). */
  public enemyBulletCount(): number {
    const grp = this.scene?.enemyBullets;
    if (!grp || typeof grp.getChildren !== 'function') return 0;
    return grp.getChildren().filter((b: any) => b && b.active !== false).length;
  }
  /** The live weapon tier (the powerup.collected observable). */
  public weaponTier(): number {
    return this.tier;
  }
  /** The live boss HP, or undefined before the boss spawns (the boss.damaged observable). */
  public bossHP(): number | undefined {
    return this.boss ? this.boss.health : undefined;
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - pattern.fired     ← fireEnemyVolley (an enemy emits a bullet pattern)   [archetype]
   *   - powerup.collected ← collectPowerup (the player flies through a pickup)  [archetype]
   *   - boss.damaged      ← damageBoss (a player shot strikes the boss)         [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {
        'enemyBulletsActive': () => this.enemyBulletCount(),
        'weaponTier': () => this.weaponTier(),
        'enemyHP': () => this.bossHP(),
      },
      anchors: [],
      events: [
        {
          name: 'pattern.fired',
          payload: '{x,y,pattern,count}',
          scope: 'archetype',
          drivenBy: 'an enemy emits a bullet pattern (the volley cadence elapsing)',
          expect:
            'one or more enemy bullets enter scene.enemyBullets ⇒ __GAME__ active enemy-bullet count increases; pattern.fired logged',
        },
        {
          name: 'powerup.collected',
          payload: '{tier}',
          scope: 'archetype',
          drivenBy: 'the player overlaps a power-up drop',
          expect:
            'the weapon tier rises (scene.weaponTier increments, the live cannon speeds up) up to maxTier; powerup.collected logged',
        },
        {
          name: 'boss.damaged',
          payload: '{hp,maxHp}',
          scope: 'archetype',
          drivenBy: 'a player shot hits the boss',
          expect:
            "__GAME__.enemyHP (the boss HP-bar value) decreases; on reaching 0 the boss dies and __GAME__.status becomes 'won'; boss.damaged logged",
        },
      ],
    };
  }
}
