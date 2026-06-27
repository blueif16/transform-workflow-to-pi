/**
 * BossPhase — the MULTI-PHASE BOSS system (BUILD — gallery-shooter engine piece,
 * genre=scrolling-shmup). The climax of a vertical shmup: once the marching
 * formation is cleared a single large boss spawns with a big HP pool, and as the
 * player whittles that pool down it crosses a ladder of HP THRESHOLDS — at each
 * crossing the boss ESCALATES into a new ATTACK PHASE (a tougher bullet pattern,
 * a faster fire cadence). When the HP finally reaches 0 the boss is DEFEATED and
 * the level is won.
 *
 * This is the difference between ScrollShmup's flat single-HP boss and a real
 * boss FIGHT: the phase ladder gives the encounter rising tension and a readable
 * tell ("it changed colour / it's firing a ring now"). The phase index is the
 * observable that climbs; the win is the final fall to 0.
 *
 * It owns NO formation movement (FormationMarch / EntrySpline do) and NO player
 * firing (ProjectilePool does). It READS the formation off the scene to know when
 * to spawn the boss, then OWNS the boss sprite, its HP, its phase ladder, and the
 * down-firing bullet pattern of the CURRENT phase. The boss is added to
 * scene.enemies and given a .takeDamage(n) method, so the existing
 * playerBullets↔enemies overlap (ProjectilePool) ALSO damages it — no new
 * collision wiring is needed for player shots to chew the boss.
 *
 * GENERIC: no game/theme, no baked coordinate — the spawn point comes from the
 * map bounds; every HP value / phase pattern / cadence is DATA via params with a
 * declared default. A level binding it on a base with no formation simply spawns
 * the boss immediately (the formation reads as already cleared).
 *
 * OBSERVABLE (the contract — what a verify run polls):
 *   - the boss HP is mirrored onto scene.enemyHP (the HP-bar value) and falls on
 *     each player hit;
 *   - the boss PHASE index is mirrored onto scene.bossPhase and INCREMENTS each
 *     time HP crosses a threshold downward (boss.phaseChanged);
 *   - when HP reaches 0 the boss dies and scene.onLevelComplete() flips
 *     __GAME__.status to 'won' (boss.defeated).
 *
 * EVENT (the PUSH channel):
 *   - boss.phaseChanged ← the boss HP crosses a phase threshold (phase index ++);
 *   - boss.defeated     ← the boss HP reaches 0 (the win).
 *
 * ID-SOURCE: the boss `id` payload field is a CONFIG param — `bossId` (declared in
 * CAPABILITY.params, default 'boss'), the $custom-system config-id pattern.
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible declared defaults):
 *   bossId        the boss entity id (the event payload id source) (default 'boss').
 *   bossHp        the boss HP pool / HP-bar denominator (default 60).
 *   phaseCount    how many attack phases the boss escalates through (default 3).
 *   bossDamage    minimum damage one player shot deals the boss (default 1).
 *   baseFireMs    ms between volleys in phase 1; each later phase fires faster (default 1400).
 *   bulletSpeed   |px/s| boss bullet speed (default 200).
 *   bulletSize    boss bullet display px (default 9).
 *   bulletDamage  damage one boss bullet deals the player (default 1).
 *   bossBulletCap max simultaneous live boss bullets, the no-leak bound (default 64).
 *   bossSlot      boss texture key (default the generated 'boss' / placeholder).
 *   bulletSlot    boss-bullet texture key (default placeholder).
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'BossPhase',
  intent:
    'Spawn a single multi-phase boss once the formation is cleared: a big HP pool that the player whittles down, escalating the boss into a new ATTACK PHASE (tougher bullet pattern + faster cadence) each time HP crosses a threshold, and ending the level in a win when HP reaches 0. Reads the formation off the scene; the climax layer of the gallery shooter.',
  attachesTo: 'scene',
  params: [
    'bossId',
    'bossHp',
    'phaseCount',
    'bossDamage',
    'baseFireMs',
    'bulletSpeed',
    'bulletSize',
    'bulletDamage',
    'bossBulletCap',
    'bossSlot',
    'bulletSlot',
  ],
  roles: ['enemy', 'player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface BossPhaseConfig {
  bossId?: string;
  bossHp?: number;
  phaseCount?: number;
  bossDamage?: number;
  baseFireMs?: number;
  bulletSpeed?: number;
  bulletSize?: number;
  bulletDamage?: number;
  bossBulletCap?: number;
  bossSlot?: string;
  bulletSlot?: string;
}

export class BossPhase implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly bossId: string;
  private readonly bossHp: number;
  private readonly phaseCount: number;
  private readonly bossDamage: number;
  private readonly baseFireMs: number;
  private readonly bulletSpeed: number;
  private readonly bulletSize: number;
  private readonly bulletDamage: number;
  private readonly bossBulletCap: number;
  private readonly bossSlot?: string;
  private readonly bulletSlot?: string;

  /** The boss sprite once spawned (null before the formation clears / after death). */
  private boss: any = null;
  /** Latches true once the boss has been spawned (so it spawns exactly once). */
  private bossSpawned = false;
  /** Latches true once the boss is dead (so the win fires exactly once). */
  private bossDead = false;
  /**
   * The current attack-phase INDEX (1-based: phase 1 is the freshest, full-HP boss).
   * Increments each time HP crosses a threshold downward; mirrored to scene.bossPhase.
   */
  private phase = 1;
  /** ms accumulated toward the next boss volley (fixed-step, frame-rate-independent). */
  private fireAcc = 0;
  /** Monotonic id sequence for spawned boss bullets. */
  private _bbulletSeq = 0;

  constructor(params: BossPhaseConfig = {}) {
    this.bossId = typeof params.bossId === 'string' && params.bossId ? params.bossId : 'boss';
    this.bossHp = Math.max(1, Math.floor(params.bossHp ?? 60));
    this.phaseCount = Math.max(1, Math.floor(params.phaseCount ?? 3));
    this.bossDamage = Math.max(1, params.bossDamage ?? 1);
    this.baseFireMs = Math.max(1, params.baseFireMs ?? 1400);
    this.bulletSpeed = params.bulletSpeed ?? 200;
    this.bulletSize = params.bulletSize ?? 9;
    this.bulletDamage = params.bulletDamage ?? 1;
    this.bossBulletCap = Math.max(1, Math.floor(params.bossBulletCap ?? 64));
    this.bossSlot = params.bossSlot;
    this.bulletSlot = params.bulletSlot;
  }

  reset(): void {
    this.boss = null;
    this.bossSpawned = false;
    this.bossDead = false;
    this.phase = 1;
    this.fireAcc = 0;
    this._bbulletSeq = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    // The pooled group the boss fires into. bossBullets is surfaced as enemy
    // projectiles (same convention ScrollShmup uses for enemyBullets).
    if (!scene.bossBullets || typeof scene.bossBullets.getChildren !== 'function') {
      scene.bossBullets = scene.physics.add.group();
    }
    // Mirror the phase index so it is observable before the boss even spawns.
    scene.bossPhase = this.phase;
    // Expose self for diagnostics / the verify driver.
    scene.__bossPhase = this;
  }

  /**
   * Wire the one overlap this system owns: a boss bullet hitting the player damages
   * the player + releases the bullet. The player-shot↔boss path is NOT wired here —
   * the boss is added to scene.enemies with a .takeDamage seam, so ProjectilePool's
   * existing playerBullets↔enemies overlap reaches it.
   */
  setupCollisions(): void {
    const scene = this.scene;
    if (!scene) return;
    if (scene.player) {
      scene.physics.add.overlap(scene.bossBullets, scene.player, (bullet: any, player: any) => {
        if (!bullet || bullet.active === false) return;
        if (!player || player.isDead || player.active === false) return;
        player.takeDamage?.(this.bulletDamage);
        this.releaseBullet(bullet);
      });
    }
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;

    // Spawn the boss (once) the frame the marching formation is cleared.
    if (!this.bossSpawned && this.formationCleared()) {
      this.spawnBoss(scene);
    }

    this.advanceBullets(scene);

    // Boss fire cadence (fixed-step accumulator). Later phases fire faster.
    if (this.boss && !this.bossDead) {
      const dtMs = scene.game?.loop?.delta ?? 16.67;
      this.fireAcc += dtMs;
      const fireMs = this.currentFireMs();
      if (this.fireAcc >= fireMs) {
        this.fireAcc -= fireMs;
        this.fireVolley(scene);
      }
    }
  }

  // ── boss-phase gate ───────────────────────────────────────────────────────

  /** Whether the marching formation has been fully cleared (the boss-phase gate). */
  private formationCleared(): boolean {
    const fm = this.scene?.__formationMarch;
    if (fm && typeof fm.aliveCount === 'function') return fm.aliveCount() === 0;
    const grp = this.scene?.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return true;
    return grp.getChildren().filter((e: any) => e && e.active !== false && !e.isDead && !e.__isBoss).length === 0;
  }

  // ── the boss + its HP / phase ladder ────────────────────────────────────────

  /** Spawn the boss (once) with a large HP pool surfaced as __GAME__.enemyHP. */
  private spawnBoss(scene: any): void {
    this.bossSpawned = true;
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    const key = this.bossSlot && scene.textures.exists(this.bossSlot) ? this.bossSlot : '__px';
    const boss = scene.physics.add.sprite(W / 2, 96, key) as any;
    if (typeof boss.setDisplaySize === 'function') boss.setDisplaySize(132, 72);
    const body = boss.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.setImmovable?.(true);
    }
    if (!scene.textures.exists(this.bossSlot ?? '')) boss.setTint?.(0xcc3344);
    boss.__type = 'enemy';
    boss.__kind = 'boss';
    boss.__isBoss = true;
    boss.__id = this.bossId;
    boss.isDead = false;
    boss.maxHealth = this.bossHp;
    boss.health = this.bossHp;
    // The boss takes the SAME .takeDamage seam a formation member uses, so the
    // existing playerBullets↔enemies overlap (ProjectilePool) ALSO damages it.
    boss.takeDamage = (n: number) => this.damageBoss(n);
    scene.enemies.add(boss); // so ProjectilePool's bullet↔enemies overlap reaches it
    this.boss = boss;

    // Surface the boss HP + phase for the HP-bar / __GAME__ extras.
    scene.enemyHP = boss.health;
    scene.bossMaxHP = boss.maxHealth;
    scene.bossPhase = this.phase;
  }

  /**
   * Damage the boss by a player shot: drop HP, escalate the phase if a threshold was
   * crossed (boss.phaseChanged), and win on death (boss.defeated).
   */
  private damageBoss(n: number): void {
    const scene = this.scene;
    const boss = this.boss;
    if (!boss || boss.isDead) return;
    const dmg = Number.isFinite(n) ? Math.max(this.bossDamage, n) : this.bossDamage;
    boss.health = Math.max(0, boss.health - dmg);
    scene.enemyHP = boss.health; // the HP-bar denominator falls (the observable transition).

    // Phase ladder: the HP pool is split into `phaseCount` equal bands. The phase the
    // boss SHOULD be in is derived from the fraction of HP remaining; if that target
    // phase is higher than the live phase, the boss has crossed one (or more) downward
    // thresholds → escalate, emitting boss.phaseChanged for EACH crossing.
    const targetPhase = this.phaseForHp(boss.health);
    while (this.phase < targetPhase && !this.bossDead) {
      this.phase += 1;
      scene.bossPhase = this.phase; // the phase index increments (the observable transition).
      // The PUSH seam: the boss HP crossed a threshold → a new attack phase.
      this.bus?.emit('boss.phaseChanged', {
        id: this.bossId,
        phase: this.phase,
        hp: boss.health,
        maxHp: boss.maxHealth,
      });
    }

    if (boss.health <= 0 && !this.bossDead) {
      this.bossDead = true;
      boss.isDead = true;
      boss.setActive?.(false);
      if (boss.body) boss.body.enable = false;
      boss.destroy?.();
      this.boss = null;

      // The PUSH seam: the boss HP reached 0 → defeated.
      this.bus?.emit('boss.defeated', { id: this.bossId, maxHp: scene.bossMaxHP ?? this.bossHp });

      // The boss is the final threat — its defeat is the win (status → 'won').
      scene.onLevelComplete?.();
    }
  }

  /**
   * The attack PHASE a given HP value falls into (1-based). Full HP → phase 1; HP at 0
   * → phaseCount. The pool is split into `phaseCount` equal bands; lower HP ⇒ higher
   * phase. Clamped to [1, phaseCount].
   */
  private phaseForHp(hp: number): number {
    const frac = Math.max(0, Math.min(1, hp / this.bossHp)); // 1 at full, 0 at dead
    // bands of remaining-fraction: (1..1-1/n] = phase 1, … ; lost = ceil(crossed)+1.
    const crossed = Math.floor((1 - frac) * this.phaseCount); // 0 at full → phaseCount at 0
    return Math.max(1, Math.min(this.phaseCount, crossed + 1));
  }

  /** ms between volleys for the CURRENT phase: each later phase fires ~15% faster (floor 250ms). */
  private currentFireMs(): number {
    const ms = this.baseFireMs * Math.pow(0.85, this.phase - 1);
    return Math.max(250, ms);
  }

  // ── the down-firing bullet pattern (escalates per phase) ─────────────────────

  /**
   * Fire one volley DOWN from the boss. The pattern WIDENS with the phase: phase 1 fires
   * a single aimed shot, each later phase adds one bullet to a downward fan (the
   * escalating tell that the threshold crossing is real).
   */
  private fireVolley(scene: any): void {
    const boss = this.boss;
    if (!boss || boss.isDead) return;
    const player = scene.player;
    const sx = boss.x;
    const sy = boss.y + (boss.displayHeight ?? 72) / 2;

    const count = this.phase; // phase 1 → 1 bullet, phase 2 → 2, … (the escalation)
    const center = player ? Math.atan2(player.y - sy, player.x - sx) : Math.PI / 2;
    if (count <= 1) {
      this.spawnBullet(scene, sx, sy, center);
    } else {
      const fanRad = (40 * Math.PI) / 180; // ±40° total fan, denser at higher phase
      for (let i = 0; i < count; i += 1) {
        const t = i / (count - 1) - 0.5; // -0.5..0.5
        this.spawnBullet(scene, sx, sy, center + t * fanRad);
      }
    }
  }

  /** Spawn ONE boss bullet at (x,y) moving along `angle`. Respects the no-leak cap. */
  private spawnBullet(scene: any, x: number, y: number, angle: number): boolean {
    const grp = scene.bossBullets;
    if (!grp) return false;
    const live = grp.getChildren().filter((b: any) => b && b.active !== false).length;
    if (live >= this.bossBulletCap) return false; // bound the live count (no leak).

    const key = this.bulletSlot && scene.textures.exists(this.bulletSlot) ? this.bulletSlot : '__px';
    const sprite = scene.physics.add.sprite(x, y, key) as any;
    if (typeof sprite.setDisplaySize === 'function') sprite.setDisplaySize(this.bulletSize, this.bulletSize);
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      sprite.setVelocity?.(Math.cos(angle) * this.bulletSpeed, Math.sin(angle) * this.bulletSpeed);
    }
    if (!scene.textures.exists(this.bulletSlot ?? '')) sprite.setTint?.(0xff8833);
    sprite.__type = 'projectile';
    sprite.__kind = 'bossBullet';
    sprite.__id = `bbullet_${this._bbulletSeq++}`;
    grp.add(sprite);
    return true;
  }

  /** Advance + cull boss bullets that left the field (the no-leak path). */
  private advanceBullets(scene: any): void {
    const grp = scene.bossBullets;
    if (!grp || typeof grp.getChildren !== 'function') return;
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    const H = scene.mapHeight ?? scene.scale?.height ?? 768;
    for (const b of [...grp.getChildren()]) {
      if (!b || b.active === false) continue;
      if (b.y > H + 16 || b.y < -16 || b.x < -16 || b.x > W + 16) this.releaseBullet(b);
    }
  }

  /** Destroy + remove one boss bullet (idempotent). */
  private releaseBullet(bullet: any): void {
    if (!bullet || bullet.active === false) return;
    bullet.setActive?.(false);
    bullet.setVisible?.(false);
    const body = bullet.body;
    if (body) body.enable = false;
    bullet.destroy?.();
  }

  // ── diagnostics (EXPOSED for the verify driver) ──────────────────────────────

  /** The live boss HP, or undefined before the boss spawns (the boss.defeated observable). */
  public bossHP(): number | undefined {
    return this.boss ? this.boss.health : undefined;
  }
  /** The live attack-phase index (the boss.phaseChanged observable). */
  public bossPhaseIndex(): number {
    return this.phase;
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - boss.phaseChanged ← damageBoss (HP crossed a phase threshold)  [archetype]
   *   - boss.defeated     ← damageBoss (HP reached 0 → win)            [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {
        'enemyHP': () => this.bossHP(),
        'bossPhase': () => this.bossPhaseIndex(),
      },
      anchors: [],
      events: [
        {
          name: 'boss.phaseChanged',
          payload: '{id,phase,hp,maxHp}',
          scope: 'archetype',
          drivenBy: 'the boss HP crosses a phase threshold (a downward HP-band boundary)',
          expect:
            'the boss phase index increments (scene.bossPhase ⇒ __GAME__ boss phase rises) and the boss escalates to a wider/faster attack; boss.phaseChanged logged',
        },
        {
          name: 'boss.defeated',
          payload: '{id,maxHp}',
          scope: 'archetype',
          drivenBy: 'the boss HP reaches 0',
          expect:
            "the boss dies and scene.onLevelComplete() fires ⇒ __GAME__.status becomes 'won'; boss.defeated logged",
        },
      ],
    };
  }
}
