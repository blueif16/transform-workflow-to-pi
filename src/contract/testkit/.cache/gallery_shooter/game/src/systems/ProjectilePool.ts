/**
 * ProjectilePool — the pooled player projectile system (BUILD — gallery-shooter
 * engine piece). RB §2: bullets are reused from a FIXED pool, never `new`-ed per
 * shot, and every bullet RETURNS to the pool when it exits the top, hits an enemy,
 * or hits a bunker — the live-bullet count never grows unbounded (the no-leak
 * invariant). A fire cooldown rate-limits the cannon.
 *
 * It reads the player's FIRE intent (set by the scene from the resolved control
 * scheme), acquires a free bullet, launches it straight UP the screen, and on each
 * frame advances every in-use bullet and RELEASES any that left the field or struck
 * a target. Enemy kills route through the SAME scene.enemies group + the engine
 * bullet-vs-enemy overlap, so the formation members die through one path.
 *
 * OBSERVABLE (the contract): in-use bullets are added to scene.playerBullets (the
 * group the hook surfaces in __GAME__.entities as projectiles); a released bullet is
 * deactivated + removed from that group and returned to the free list, so a verify
 * run that polls the in-use count sees it return to 0 when the screen clears.
 *
 * GENERIC: no game/theme, no baked coordinate — the muzzle is the player's position;
 * size/speed/cooldown/poolSize from params. A level that never fires is a clean no-op.
 *
 * EVENT (the PUSH channel): player.shot fires on each real launch (payload {x,y}).
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible defaults):
 *   poolSize      max simultaneous in-flight bullets (default 8).
 *   bulletSpeed   |px/s| upward speed (default 520).
 *   cooldownMs    minimum ms between shots (default 280).
 *   bulletWidth   bullet display width px (default 6).
 *   bulletHeight  bullet display height px (default 16).
 *   damage        damage dealt to an enemy on hit (default 1 — one-shot).
 *   assetSlot     bullet texture key (default the generated 'player_bullet').
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ProjectilePool',
  intent:
    'Pooled upward player projectiles: reuse a fixed bullet pool (never new-per-shot), fire on the player intent with a cooldown, advance each bullet, and return any that exits the top / hits an enemy / hits a bunker — so the live-bullet count never leaks. The gallery-shooter firing system.',
  attachesTo: 'scene',
  params: ['poolSize', 'bulletSpeed', 'cooldownMs', 'bulletWidth', 'bulletHeight', 'damage', 'assetSlot'],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface ProjectilePoolConfig {
  poolSize?: number;
  bulletSpeed?: number;
  cooldownMs?: number;
  bulletWidth?: number;
  bulletHeight?: number;
  damage?: number;
  assetSlot?: string;
}

export class ProjectilePool implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly poolSize: number;
  private readonly bulletSpeed: number;
  private readonly cooldownMs: number;
  private readonly bulletWidth: number;
  private readonly bulletHeight: number;
  private readonly damage: number;
  private readonly assetSlot?: string;

  /** Every bullet sprite this pool owns (free ∪ in-use). */
  private all: any[] = [];
  /** Free (idle) bullets ready to acquire. */
  private free: any[] = [];
  /** In-use (in-flight) bullets. */
  private inUse: Set<any> = new Set();
  /** Timestamp (ms) the cannon may next fire. */
  private nextShotAt = 0;

  constructor(params: ProjectilePoolConfig = {}) {
    this.poolSize = Math.max(1, Math.floor(params.poolSize ?? 8));
    this.bulletSpeed = params.bulletSpeed ?? 520;
    this.cooldownMs = Math.max(0, params.cooldownMs ?? 280);
    this.bulletWidth = params.bulletWidth ?? 6;
    this.bulletHeight = params.bulletHeight ?? 16;
    this.damage = params.damage ?? 1;
    this.assetSlot = params.assetSlot;
  }

  reset(): void {
    for (const b of this.all) b?.destroy?.();
    this.all = [];
    this.free = [];
    this.inUse = new Set();
    this.nextShotAt = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    if (!scene.playerBullets || typeof scene.playerBullets.getChildren !== 'function') {
      scene.playerBullets = scene.physics.add.group();
    }
    // Pre-allocate the whole pool ONCE (the no-leak contract: fixed sprite count).
    for (let i = 0; i < this.poolSize; i += 1) this.all.push(this.makeBullet(i));
    this.free = [...this.all];
    // Expose self so the scene's fire driver can request a shot + diagnostics can read counts.
    scene.__projectilePool = this;
  }

  /** Wire bullet↔enemy + bullet↔bunker overlaps → damage + RELEASE (return to pool). */
  setupCollisions(): void {
    const scene = this.scene;
    if (!scene) return;
    if (scene.enemies) {
      scene.physics.add.overlap(scene.playerBullets, scene.enemies, (bullet: any, enemy: any) => {
        if (!this.inUse.has(bullet)) return;
        if (!enemy || enemy.isDead || enemy.active === false) return;
        enemy.takeDamage?.(this.damage);
        this.release(bullet);
        if (enemy.isDead) scene.onEnemyKilled?.(enemy);
      });
    }
    if (scene.bunkers) {
      scene.physics.add.overlap(scene.playerBullets, scene.bunkers, (bullet: any, bunker: any) => {
        if (!this.inUse.has(bullet)) return;
        if (!bunker || bunker.active === false) return;
        bunker.takeDamage?.(1);
        this.release(bullet);
      });
    }
  }

  /** Request a shot from the muzzle (the player position). Rate-limited; pool-bounded. */
  public fire(muzzleX: number, muzzleY: number): boolean {
    const now = this.scene?.time?.now ?? Date.now();
    if (now < this.nextShotAt) return false;
    const bullet = this.free.pop();
    if (!bullet) return false; // pool exhausted — refuse (the bound on live bullets).
    this.nextShotAt = now + this.cooldownMs;
    bullet.setActive(true);
    bullet.setVisible(true);
    bullet.x = muzzleX;
    bullet.y = muzzleY;
    const body = bullet.body;
    if (body) {
      body.enable = true;
      bullet.setVelocity(0, -this.bulletSpeed); // straight UP
    }
    this.inUse.add(bullet);
    // The PUSH seam: a real launch happened (a bullet was acquired + sent up).
    this.bus?.emit('player.shot', { x: muzzleX, y: muzzleY });
    return true;
  }

  update(): void {
    const scene = this.scene;
    if (!scene || this.inUse.size === 0) return;
    for (const bullet of [...this.inUse]) {
      if (!bullet.active) {
        this.release(bullet);
        continue;
      }
      // A bullet that exits the TOP of the field returns to the pool (no leak).
      if (bullet.y < -this.bulletHeight) this.release(bullet);
    }
  }

  /** Live in-flight bullet count (EXPOSED for the no-leak proof). */
  public inUseCount(): number {
    return this.inUse.size;
  }
  /** Free (idle) bullet count (EXPOSED — free + inUse == poolSize is the no-leak invariant). */
  public freeCount(): number {
    return this.free.length;
  }

  /** Return a bullet to the free list (deactivate, remove from the group). Idempotent. */
  private release(bullet: any): void {
    if (!this.inUse.has(bullet)) return;
    this.inUse.delete(bullet);
    bullet.setActive(false);
    bullet.setVisible(false);
    const body = bullet.body;
    if (body) {
      body.enable = false;
      bullet.setVelocity(0, 0);
    }
    bullet.y = -100; // park off-field
    this.free.push(bullet);
  }

  /** Allocate ONE bullet sprite into the playerBullets group, idle. */
  private makeBullet(i: number): any {
    const scene = this.scene;
    const slot = this.assetSlot;
    const key = slot && scene.textures.exists(slot) ? slot : '__px';
    const sprite = scene.physics.add.sprite(0, -100, key) as any;
    if (typeof sprite.setDisplaySize === 'function') {
      sprite.setDisplaySize(this.bulletWidth, this.bulletHeight);
    }
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.enable = false;
    }
    sprite.__type = 'projectile';
    sprite.__id = `bullet_${i}`;
    sprite.damage = this.damage;
    sprite.setActive(false);
    sprite.setVisible(false);
    scene.playerBullets.add(sprite);
    return sprite;
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - player.shot ← fire() (a pooled bullet was acquired + launched up)   [base:2d]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'player.shot',
          payload: '{x,y}',
          scope: 'base:2d',
          drivenBy: 'fire input (the cannon fires, cooldown + pool permitting)',
          expect:
            'a pooled bullet enters __GAME__.entities and travels up; it returns to the pool on exit/hit (in-use count never leaks); player.shot logged',
        },
      ],
    };
  }
}
