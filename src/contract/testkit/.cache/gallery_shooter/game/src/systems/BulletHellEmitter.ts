/**
 * BulletHellEmitter — the DANSE-MACABRE bullet-curtain layer (BUILD — gallery-shooter
 * engine piece, genre=bullet-hell). Where ScrollShmup adds a thin aimed/spread/radial
 * trickle, the bullet-hell genre is about DENSE, READABLE CURTAINS the player threads
 * — and the signature scoring twist that rewards reading them: GRAZE. This system adds
 * the two things bullet-hell needs beyond the gallery base:
 *
 *   1. DENSE PATTERN EMITTERS — on a cadence, an emitter (a live formation member, or
 *      a fixed top-of-screen turret when the rack is empty) fires a whole PATTERN at
 *      once: a RADIAL ring (n bullets evenly around the circle) or a SPIRAL arm (each
 *      volley rotated by a fixed step so successive rings trace a turning spiral). The
 *      bullets are pooled into scene.enemyBullets (the group __GAME__ surfaces as enemy
 *      projectiles) so the live count is bounded (no leak). A volley raises the active
 *      enemy-bullet count — the observable behind pattern.emitted.
 *
 *   2. GRAZE SCORING — the risk/reward heart of the genre. Each frame, any live enemy
 *      bullet whose distance to the player is inside the GRAZE ring (grazeRadius) but
 *      OUTSIDE the hit ring (hitRadius) is a NEAR-MISS: it scores grazePoints through
 *      the shared score seam (utils.addScore → __GAME__.score rises) WITHOUT damaging
 *      the player, then is marked so one bullet grazes at most once. A bullet that
 *      crosses the hit ring damages the player on the engine death path (the existing
 *      enemyBullets↔player overlap, also wired here). Grazing — flying CLOSE without
 *      being hit — is how a bullet-hell player runs up the score.
 *
 * It owns NO formation movement (FormationMarch does), NO player firing (ProjectilePool
 * does) and NO wave bookkeeping (WaveLoop does) — it READS the formation off the scene
 * (scene.enemies) and LAYERS the curtain + graze feel on top. A level that binds it on
 * a base with no formation still runs (the fixed turret keeps the curtain alive).
 *
 * GENERIC: no game/theme, no baked coordinate — geometry comes from the live members +
 * map bounds; every cadence/count/radius/points is DATA via params with a declared
 * default. A level that never spawns a bullet is a clean no-op until a turret/member exists.
 *
 * OBSERVABLE (the contract — what a verify run polls):
 *   - enemy bullets enter scene.enemyBullets ⇒ __GAME__ active enemy-bullet count rises
 *     (pattern.emitted raises the live count);
 *   - a near-miss raises the score: __GAME__.score increases by grazePoints and the live
 *     graze count rises (graze.scored), with NO player damage.
 *
 * EVENT (the PUSH channel): pattern.emitted ← an emitter fires a dense pattern;
 *   graze.scored ← a live bullet near-misses the player (inside graze, outside hit).
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible defaults):
 *   fireEveryMs    ms between pattern volleys (default 900).
 *   pattern        'radial' | 'spiral' curtain shape (default 'radial').
 *   bulletsPerRing bullets in one ring / spiral volley (default 12).
 *   spiralStepDeg  per-volley rotation in degrees (spiral only; default 13).
 *   bulletSpeed    |px/s| enemy bullet speed (default 140).
 *   bulletSize     enemy bullet display px (default 8).
 *   bulletDamage   damage one enemy bullet deals on a hit (default 1).
 *   enemyBulletCap max simultaneous live enemy bullets, the no-leak bound (default 96).
 *   grazeRadius    px — a bullet inside this ring (but outside hitRadius) grazes (default 28).
 *   hitRadius      px — a bullet inside this ring damages the player (default 12).
 *   grazePoints    score awarded per first-time graze of a bullet (default 5).
 *   bulletSlot     enemy-bullet texture key (default placeholder).
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import * as utils from '../utils';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'BulletHellEmitter',
  intent:
    'Overlay the gallery base with the bullet-hell curtain layer: dense radial/spiral enemy bullet-pattern emitters into a pooled, bounded enemyBullets group, plus GRAZE scoring — a near-miss (inside the graze ring, outside the hit ring) raises __GAME__.score without damaging the player, the risk/reward heart of the genre. Reads the formation off the scene.',
  attachesTo: 'scene',
  params: [
    'fireEveryMs',
    'pattern',
    'bulletsPerRing',
    'spiralStepDeg',
    'bulletSpeed',
    'bulletSize',
    'bulletDamage',
    'enemyBulletCap',
    'grazeRadius',
    'hitRadius',
    'grazePoints',
    'bulletSlot',
  ],
  roles: ['enemy', 'player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export type CurtainPattern = 'radial' | 'spiral';

export interface BulletHellEmitterConfig {
  fireEveryMs?: number;
  pattern?: CurtainPattern;
  bulletsPerRing?: number;
  spiralStepDeg?: number;
  bulletSpeed?: number;
  bulletSize?: number;
  bulletDamage?: number;
  enemyBulletCap?: number;
  grazeRadius?: number;
  hitRadius?: number;
  grazePoints?: number;
  bulletSlot?: string;
}

export class BulletHellEmitter implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly fireEveryMs: number;
  private readonly pattern: CurtainPattern;
  private readonly bulletsPerRing: number;
  private readonly spiralStepRad: number;
  private readonly bulletSpeed: number;
  private readonly bulletSize: number;
  private readonly bulletDamage: number;
  private readonly enemyBulletCap: number;
  private readonly grazeRadius: number;
  private readonly hitRadius: number;
  private readonly grazePoints: number;
  private readonly bulletSlot?: string;

  /** ms accumulated toward the next volley (fixed-step, frame-rate-independent). */
  private fireAcc = 0;
  /** The spiral's running base angle (radians); each volley advances it by spiralStepRad. */
  private spiralPhase = 0;
  /** Running total of near-misses (the graze.scored observable). */
  private grazeCount = 0;
  /** Monotonic id for spawned bullets (diagnostics / payloads). */
  private _ebulletSeq = 0;

  constructor(params: BulletHellEmitterConfig = {}) {
    this.fireEveryMs = Math.max(1, params.fireEveryMs ?? 900);
    this.pattern = params.pattern === 'spiral' ? 'spiral' : 'radial';
    this.bulletsPerRing = Math.max(1, Math.floor(params.bulletsPerRing ?? 12));
    this.spiralStepRad = ((params.spiralStepDeg ?? 13) * Math.PI) / 180;
    this.bulletSpeed = params.bulletSpeed ?? 140;
    this.bulletSize = params.bulletSize ?? 8;
    this.bulletDamage = Math.max(1, params.bulletDamage ?? 1);
    this.enemyBulletCap = Math.max(1, Math.floor(params.enemyBulletCap ?? 96));
    this.grazeRadius = Math.max(1, params.grazeRadius ?? 28);
    this.hitRadius = Math.max(0, params.hitRadius ?? 12);
    this.grazePoints = Math.max(1, Math.floor(params.grazePoints ?? 5));
    this.bulletSlot = params.bulletSlot;
  }

  reset(): void {
    this.fireAcc = 0;
    this.spiralPhase = 0;
    this.grazeCount = 0;
    this._ebulletSeq = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    // The pooled enemy-bullet group this layer fills. enemyBullets is a hook-known
    // group name (__GAME__.entities surfaces it as enemy projectiles).
    if (!scene.enemyBullets || typeof scene.enemyBullets.getChildren !== 'function') {
      scene.enemyBullets = scene.physics.add.group();
    }
    // Expose self for diagnostics / the verify driver.
    scene.__bulletHellEmitter = this;
  }

  /**
   * Wire the one overlap this layer owns: an enemy bullet that reaches the player
   * (the hit ring is enforced in the graze pass, but Phaser's overlap is the
   * engine death path) damages the player + releases the bullet. Graze is NOT an
   * overlap — it is a per-frame distance test in update() so a near-miss never
   * touches the player body.
   */
  setupCollisions(): void {
    const scene = this.scene;
    if (!scene || !scene.player) return;
    scene.physics.add.overlap(scene.enemyBullets, scene.player, (bullet: any, player: any) => {
      if (!bullet || bullet.active === false) return;
      if (!player || player.isDead || player.active === false) return;
      player.takeDamage?.(this.bulletDamage);
      this.releaseBullet(bullet);
    });
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;

    this.advanceEnemyBullets(scene);
    this.scoreGrazes(scene);

    // Pattern cadence (fixed-step accumulator).
    const dtMs = scene.game?.loop?.delta ?? 16.67;
    this.fireAcc += dtMs;
    if (this.fireAcc >= this.fireEveryMs) {
      this.fireAcc -= this.fireEveryMs;
      this.fireCurtain(scene);
    }
  }

  // ── dense pattern emitters ───────────────────────────────────────────────────

  /** The live emitter: a random alive formation member, or a fixed top-screen turret. */
  private pickEmitter(scene: any): { x: number; y: number } | null {
    const grp = scene.enemies;
    if (grp && typeof grp.getChildren === 'function') {
      const alive = grp.getChildren().filter((e: any) => e && e.active !== false && !e.isDead);
      if (alive.length > 0) {
        const e = alive[Math.floor(Math.random() * alive.length)];
        return { x: e.x, y: e.y + (e.displayHeight ?? 22) / 2 };
      }
    }
    // No formation → a fixed turret at top-center keeps the curtain alive.
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    return { x: W / 2, y: 60 };
  }

  /** Fire one DENSE pattern (radial ring or spiral arm) from a live emitter. */
  private fireCurtain(scene: any): void {
    const src = this.pickEmitter(scene);
    if (!src) return;
    const n = this.bulletsPerRing;

    // The spiral advances a running base angle each volley so successive rings turn;
    // a pure radial ring has a zero step (every volley is the same evenly-spaced ring).
    if (this.pattern === 'spiral') this.spiralPhase += this.spiralStepRad;
    const base = this.pattern === 'spiral' ? this.spiralPhase : 0;

    let fired = 0;
    for (let i = 0; i < n; i += 1) {
      const ang = base + (i / n) * Math.PI * 2;
      fired += this.spawnBullet(scene, src.x, src.y, ang) ? 1 : 0;
    }

    if (fired > 0) {
      // The PUSH seam: an emitter fired a dense pattern (active enemy bullets rose).
      this.bus?.emit('pattern.emitted', {
        x: Math.round(src.x),
        y: Math.round(src.y),
        pattern: this.pattern,
        count: fired,
      });
    }
  }

  /** Spawn ONE enemy bullet at (x,y) along `angle`. Respects the no-leak cap. */
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
    if (!scene.textures.exists(this.bulletSlot ?? '')) sprite.setTint?.(0xff66bb);
    sprite.__type = 'projectile';
    sprite.__kind = 'enemyBullet';
    sprite.__id = `ebullet_${this._ebulletSeq++}`;
    sprite.__grazed = false; // one graze per bullet (latched in scoreGrazes).
    grp.add(sprite);
    return true;
  }

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

  // ── graze scoring (the risk/reward heart) ────────────────────────────────────

  /**
   * Score every NEAR-MISS this frame: a live bullet inside the graze ring but outside
   * the hit ring scores grazePoints ONCE (latched on the bullet) WITHOUT damaging the
   * player. The score rises through the shared seam (utils.addScore → __GAME__.score).
   */
  private scoreGrazes(scene: any): void {
    const player = scene.player;
    const grp = scene.enemyBullets;
    if (!player || player.isDead || player.active === false) return;
    if (!grp || typeof grp.getChildren !== 'function') return;

    const grazeSq = this.grazeRadius * this.grazeRadius;
    const hitSq = this.hitRadius * this.hitRadius;
    for (const b of grp.getChildren()) {
      if (!b || b.active === false || b.__grazed) continue;
      const dx = b.x - player.x;
      const dy = b.y - player.y;
      const dSq = dx * dx + dy * dy;
      if (dSq <= grazeSq && dSq > hitSq) {
        b.__grazed = true; // one graze per bullet — no double-count as it lingers near.
        this.grazeCount += 1;
        // Award through the shared score seam (raises __GAME__.score; emits score.changed).
        utils.addScore(scene, this.grazePoints);
        // The PUSH seam: the player grazed a bullet (near-miss, no hit) — score rose.
        this.bus?.emit('graze.scored', {
          x: Math.round(b.x),
          y: Math.round(b.y),
          points: this.grazePoints,
          grazes: this.grazeCount,
        });
      }
    }
  }

  // ── diagnostics (EXPOSED for the verify driver) ──────────────────────────────

  /** Live enemy-bullet count (the no-leak proof + the pattern.emitted observable). */
  public enemyBulletCount(): number {
    const grp = this.scene?.enemyBullets;
    if (!grp || typeof grp.getChildren !== 'function') return 0;
    return grp.getChildren().filter((b: any) => b && b.active !== false).length;
  }
  /** Running near-miss total (the graze.scored observable). */
  public grazes(): number {
    return this.grazeCount;
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - pattern.emitted ← fireCurtain (an emitter fires a dense radial/spiral pattern) [archetype]
   *   - graze.scored    ← scoreGrazes (a live bullet near-misses the player)           [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {
        'enemyBulletsActive': () => this.enemyBulletCount(),
        'grazeCount': () => this.grazes(),
      },
      anchors: [],
      events: [
        {
          name: 'pattern.emitted',
          payload: '{x,y,pattern,count}',
          scope: 'archetype',
          drivenBy: 'an emitter fires a pattern (the curtain cadence elapsing)',
          expect:
            'one or more enemy bullets enter scene.enemyBullets ⇒ __GAME__ active enemy-bullet count increases; pattern.emitted logged',
        },
        {
          name: 'graze.scored',
          payload: '{x,y,points,grazes}',
          scope: 'archetype',
          drivenBy: 'the player grazes a bullet without being hit (inside the graze ring, outside the hit ring)',
          expect:
            '__GAME__.score increases by grazePoints (the graze count rises) with NO player damage; graze.scored logged',
        },
      ],
    };
  }
}
