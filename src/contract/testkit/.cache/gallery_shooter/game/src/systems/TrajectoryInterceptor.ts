/**
 * TrajectoryInterceptor — the MISSILE-COMMAND point-defense system (BUILD —
 * gallery-shooter engine piece, the `point-defense` genre). The classic inverse of
 * the descending-formation shooter: instead of one rigid rack of enemies, a STREAM
 * of independent missiles ARCS down from the top of the arena toward the player's
 * bases; the player aims a defensive shot at a world point and a blast-radius
 * DETONATION there clears every missile caught in its sphere. A missile that reaches
 * a base DESTROYS that base. The level is lost when every base is gone (the engine's
 * own lose path, driven by the player health / a configurable base→lethal hook); it
 * is won when the wave quota of missiles has been spawned AND the sky is clear.
 *
 * This system is SELF-CONTAINED — it OWNS its own missiles + bases (it does not lean
 * on FormationMarch / ProjectilePool). It mirrors the sibling systems' exact shape:
 * an ISceneSystem with reset()/attach()/setupCollisions()/update(), reaching the
 * shared bus via this.scene.eventBus and surfacing its entities through the scene's
 * known groups so __GAME__.entities sees them with ZERO extra hook wiring:
 *   - missiles ride scene.hazards   → surface as type 'hazard'    (the threat count)
 *   - bases    ride scene.obstacles → surface as type 'obstacle'  (the bases-remaining count)
 *
 * OBSERVABLE (the contract):
 *   - LAUNCH:    a missile sprite enters scene.hazards → __GAME__.entities hazard count rises (active missiles ↑).
 *   - INTERCEPT: a player-aimed detonation clears every missile within blastRadius →
 *                those missiles leave scene.hazards → active-missile count falls.
 *   - DESTROY:   a missile that touches a base destroys the base → it leaves
 *                scene.obstacles → __GAME__.entities obstacle count falls (bases remaining ↓).
 *
 * The player AIMS with the pointer (mouse / touch); pressing fire (Space, or a pointer
 * tap) detonates at the cursor's world point. Absent any pointer the shot defaults to
 * a point straight above the cannon. A rate cap throttles detonations.
 *
 * GENERIC: no game/theme, no baked coordinate. Base positions, the arc spawn band,
 * cadence, speed, and blast radius all come from params with sensible defaults. A
 * level that binds it with zero bases is a clean no-op (it spawns nothing to defend).
 *
 * EVENTS (the PUSH channel):
 *   - missile.launched   ← spawnMissile (a fresh arc was spawned)
 *   - intercept.detonated← detonate (a player-aimed blast cleared overlapping missiles)
 *   - base.destroyed     ← destroyBase (a missile reached a base)
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible defaults):
 *   bases          array of {id?,x,y} base CENTERS to defend (default: none — no-op).
 *   baseWidth      base display width px (default 40).
 *   baseHeight     base display height px (default 22).
 *   spawnEveryMs   ms between missile spawns (default 1400).
 *   maxMissiles    total missiles this wave before the spawner stops (default 12).
 *   missileSpeed   |px/s| descent speed of an arcing missile (default 70).
 *   missileSize    missile marker diameter px (default 8).
 *   blastRadius    px radius a detonation clears missiles within (default 56).
 *   detonateCooldownMs minimum ms between defensive detonations (default 220).
 *   blastMs        ms the visible blast ring lingers (default 260).
 *   spawnBandFrac  fraction of arena width the spawn x is jittered across (default 1).
 *   baseLethal     damage dealt to the player when the LAST base falls (default 9999 = lethal lose).
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'TrajectoryInterceptor',
  intent:
    'Missile-Command point defense: a stream of arcing missiles descends toward the player bases; the player aims a defensive shot at a world point and a blast-radius detonation there clears every missile caught in its sphere. A missile that reaches a base destroys it; lose when every base is gone. The gallery-shooter point-defense system.',
  attachesTo: 'scene',
  params: [
    'bases',
    'baseWidth',
    'baseHeight',
    'spawnEveryMs',
    'maxMissiles',
    'missileSpeed',
    'missileSize',
    'blastRadius',
    'detonateCooldownMs',
    'blastMs',
    'spawnBandFrac',
    'baseLethal',
  ],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface BaseSpec {
  id?: string;
  x: number;
  y: number;
}

export interface TrajectoryInterceptorConfig {
  bases?: BaseSpec[];
  baseWidth?: number;
  baseHeight?: number;
  spawnEveryMs?: number;
  maxMissiles?: number;
  missileSpeed?: number;
  missileSize?: number;
  blastRadius?: number;
  detonateCooldownMs?: number;
  blastMs?: number;
  spawnBandFrac?: number;
  baseLethal?: number;
}

export class TrajectoryInterceptor implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly baseSpecs: BaseSpec[];
  private readonly baseWidth: number;
  private readonly baseHeight: number;
  private readonly spawnEveryMs: number;
  private readonly maxMissiles: number;
  private readonly missileSpeed: number;
  private readonly missileSize: number;
  private readonly blastRadius: number;
  private readonly detonateCooldownMs: number;
  private readonly blastMs: number;
  private readonly spawnBandFrac: number;
  private readonly baseLethal: number;

  /** Live in-flight missiles (the threat set — EXPOSED for the active-count proof). */
  private inFlight: Set<any> = new Set();
  /** Live (undestroyed) bases this system owns. */
  private bases: any[] = [];
  /** ms accumulated toward the next missile spawn (fixed-step; frame-rate-independent). */
  private spawnAcc = 0;
  /** Count of missiles spawned this wave (capped by maxMissiles). */
  private spawned = 0;
  /** Timestamp (ms) the next defensive detonation may fire. */
  private nextDetonateAt = 0;
  /** Last-frame fire-key held state (for press-edge detonation). */
  private fireWasHeld = false;
  /** Latched once the last base falls so the lose seam fires exactly once. */
  private lostLatched = false;

  constructor(params: TrajectoryInterceptorConfig = {}) {
    this.baseSpecs = Array.isArray(params.bases) ? params.bases : [];
    this.baseWidth = params.baseWidth ?? 40;
    this.baseHeight = params.baseHeight ?? 22;
    this.spawnEveryMs = Math.max(50, params.spawnEveryMs ?? 1400);
    this.maxMissiles = Math.max(0, Math.floor(params.maxMissiles ?? 12));
    this.missileSpeed = params.missileSpeed ?? 70;
    this.missileSize = params.missileSize ?? 8;
    this.blastRadius = Math.max(1, params.blastRadius ?? 56);
    this.detonateCooldownMs = Math.max(0, params.detonateCooldownMs ?? 220);
    this.blastMs = Math.max(1, params.blastMs ?? 260);
    this.spawnBandFrac = Math.min(1, Math.max(0, params.spawnBandFrac ?? 1));
    this.baseLethal = params.baseLethal ?? 9999;
  }

  reset(): void {
    for (const m of this.inFlight) m?.destroy?.();
    for (const b of this.bases) b?.destroy?.();
    this.inFlight = new Set();
    this.bases = [];
    this.spawnAcc = 0;
    this.spawned = 0;
    this.nextDetonateAt = 0;
    this.fireWasHeld = false;
    this.lostLatched = false;
  }

  attach(scene: any): void {
    this.scene = scene;
    // Reuse the engine's known groups so __GAME__.entities sees our entities with no
    // extra hook wiring: missiles → hazards (threat), bases → obstacles (defended).
    if (!scene.hazards || typeof scene.hazards.getChildren !== 'function') {
      scene.hazards = scene.physics.add.group();
    }
    if (!scene.obstacles || typeof scene.obstacles.getChildren !== 'function') {
      scene.obstacles = scene.physics.add.group();
    }
    for (const spec of this.baseSpecs) this.spawnBase(spec);
    // Publish self so the scene / diagnostics can read the live threat + base counts.
    scene.__trajectoryInterceptor = this;
  }

  /** No engine overlaps to register — missile↔base proximity is checked in update(). */
  setupCollisions(): void {}

  update(): void {
    const scene = this.scene;
    if (!scene) return;

    // 1) SPAWN: drop arcing missiles on a fixed-step cadence until the wave quota.
    if (this.bases.length > 0 && this.spawned < this.maxMissiles) {
      const dtMs = scene.game?.loop?.delta ?? 16.67;
      this.spawnAcc += dtMs;
      if (this.spawnAcc >= this.spawnEveryMs) {
        this.spawnAcc -= this.spawnEveryMs;
        this.spawnMissile();
      }
    }

    // 2) ADVANCE: each missile homes toward its target base; on arrival it destroys it.
    for (const m of [...this.inFlight]) {
      if (!m.active) {
        this.inFlight.delete(m);
        continue;
      }
      const target = m.__targetBase;
      if (!target || target.active === false) {
        // The target base is already gone — retarget to any live base, else let it fall off.
        m.__targetBase = this.bases.find((b) => b.active !== false);
      }
      const tb = m.__targetBase;
      if (!tb) {
        if (m.y > (scene.mapHeight ?? scene.scale?.height ?? 768) + 20) this.releaseMissile(m);
        continue;
      }
      if (this.missileReachedBase(m, tb)) {
        this.releaseMissile(m);
        this.destroyBase(tb);
      }
    }

    // 3) PLAYER-AIMED FIRE: a detonation at the aim point clears overlapping missiles.
    this.readFireIntent();
  }

  /** Read the fire intent (Space edge, or a pointer down) and detonate at the aim point. */
  private readFireIntent(): void {
    const scene = this.scene;
    const space = scene?.spaceKey;
    const pointer = scene?.input?.activePointer;
    const heldKey = !!space?.isDown;
    const pointerDown = !!pointer?.isDown;
    const wantsFire = (heldKey && !this.fireWasHeld) || (pointerDown && !this.fireWasHeld);
    this.fireWasHeld = heldKey || pointerDown;
    if (!wantsFire) return;

    // The AIM point: the pointer's world position, else straight above the cannon.
    let aimX: number;
    let aimY: number;
    if (pointer && (pointer.worldX !== undefined || pointer.x !== undefined)) {
      aimX = pointer.worldX ?? pointer.x;
      aimY = pointer.worldY ?? pointer.y;
    } else {
      const p = scene?.player;
      aimX = p?.x ?? (scene?.mapWidth ?? 432) / 2;
      aimY = (p?.y ?? (scene?.mapHeight ?? 768)) - 200;
    }
    this.detonate(aimX, aimY);
  }

  /** A player-aimed defensive blast at (x,y): clear every missile within blastRadius. */
  private detonate(x: number, y: number): void {
    const scene = this.scene;
    const now = scene?.time?.now ?? Date.now();
    if (now < this.nextDetonateAt) return;
    this.nextDetonateAt = now + this.detonateCooldownMs;

    // Clear every in-flight missile whose center is inside the blast sphere.
    let cleared = 0;
    const r2 = this.blastRadius * this.blastRadius;
    for (const m of [...this.inFlight]) {
      if (!m.active) {
        this.inFlight.delete(m);
        continue;
      }
      const dx = m.x - x;
      const dy = m.y - y;
      if (dx * dx + dy * dy <= r2) {
        this.releaseMissile(m);
        cleared += 1;
      }
    }

    this.showBlast(x, y);
    // The PUSH seam: a player-aimed shot reached its aim point + cleared the overlap.
    this.bus?.emit('intercept.detonated', {
      x: Math.round(x),
      y: Math.round(y),
      radius: this.blastRadius,
      cleared,
    });
  }

  // ── live counts (EXPOSED for the observable proofs) ───────────────────────────

  /** Active in-flight missile count (the threat — surfaces too in __GAME__.entities). */
  public activeMissileCount(): number {
    return this.inFlight.size;
  }

  /** Bases still standing (surfaces too as obstacle entities). */
  public basesRemaining(): number {
    return this.bases.filter((b) => b && b.active !== false).length;
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  /** Spawn ONE arcing missile from the top toward a (randomly chosen) live base. */
  private spawnMissile(): void {
    const scene = this.scene;
    const liveBases = this.bases.filter((b) => b.active !== false);
    if (liveBases.length === 0) return;
    const target = liveBases[Math.floor(Math.random() * liveBases.length)];

    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    const margin = (W * (1 - this.spawnBandFrac)) / 2;
    const x = margin + Math.random() * (W - margin * 2);
    const y = -this.missileSize;

    const missile = this.makeMissile(x, y, target);
    // Aim the velocity straight at the target base center (a simple downward arc).
    const dx = target.x - x;
    const dy = target.y - y;
    const len = Math.hypot(dx, dy) || 1;
    const vx = (dx / len) * this.missileSpeed;
    const vy = (dy / len) * this.missileSpeed;
    if (missile.setVelocity) missile.setVelocity(vx, vy);

    this.inFlight.add(missile);
    this.spawned += 1;
    scene.hazards.add(missile);

    // The PUSH seam: a fresh incoming arc was spawned (active missile count rises).
    this.bus?.emit('missile.launched', {
      id: missile.__id,
      x: Math.round(x),
      targetId: target.__id,
    });
  }

  /** True once the missile's center is within reach of the base body. */
  private missileReachedBase(m: any, base: any): boolean {
    const bw = (base.displayWidth ?? this.baseWidth) / 2;
    const bh = (base.displayHeight ?? this.baseHeight) / 2;
    return (
      m.x >= base.x - bw &&
      m.x <= base.x + bw &&
      m.y >= base.y - bh - this.missileSize
    );
  }

  /** Destroy a base: deactivate, drop it from scene.obstacles, fire the lose seam if last. */
  private destroyBase(base: any): void {
    if (!base || base.active === false) return;
    base.setActive(false);
    if (base.body) base.body.enable = false;
    base.destroy();
    this.bases = this.bases.filter((b) => b !== base);

    // The PUSH seam: a missile reached a base (bases remaining falls).
    this.bus?.emit('base.destroyed', {
      id: base.__id,
      remaining: this.basesRemaining(),
    });

    // Lose when the LAST base is gone — route through the engine's own death path.
    if (!this.lostLatched && this.basesRemaining() === 0) {
      this.lostLatched = true;
      this.scene?.player?.takeDamage?.(this.baseLethal);
    }
  }

  /** Return a missile to nothing (deactivate + remove from the hazards group). Idempotent. */
  private releaseMissile(m: any): void {
    if (!this.inFlight.has(m)) return;
    this.inFlight.delete(m);
    m.setActive(false);
    if (m.body) m.body.enable = false;
    m.destroy();
  }

  /** Allocate ONE missile marker sprite. */
  private makeMissile(x: number, y: number, target: any): any {
    const scene = this.scene;
    const sprite = scene.physics.add.sprite(x, y, '__px') as any;
    if (typeof sprite.setDisplaySize === 'function') {
      sprite.setDisplaySize(this.missileSize, this.missileSize);
    }
    sprite.setTint?.(0xff5a4d);
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.enable = true;
    }
    sprite.__type = 'hazard';
    sprite.__id = `missile_${this.spawned}`;
    sprite.__targetBase = target;
    return sprite;
  }

  /** Spawn one defended base into scene.obstacles (surfaces as an obstacle entity). */
  private spawnBase(spec: BaseSpec): void {
    const scene = this.scene;
    const sprite = scene.physics.add.staticSprite(spec.x, spec.y, '__px') as any;
    if (typeof sprite.setDisplaySize === 'function') {
      sprite.setDisplaySize(this.baseWidth, this.baseHeight);
    }
    sprite.setTint?.(0x4db8ff);
    sprite.refreshBody?.();
    sprite.__type = 'obstacle';
    sprite.__id = spec.id ?? `base_${this.bases.length}`;
    sprite.__kind = 'base';
    this.bases.push(sprite);
    scene.obstacles.add(sprite);
  }

  /** A brief, cosmetic blast ring at the detonation point (never gameplay-bearing). */
  private showBlast(x: number, y: number): void {
    const scene = this.scene;
    if (typeof scene?.add?.circle !== 'function') return;
    const ring = scene.add.circle(x, y, this.blastRadius, 0xffe066, 0.35);
    ring.setDepth?.(50);
    scene.tweens?.add?.({
      targets: ring,
      alpha: 0,
      duration: this.blastMs,
      onComplete: () => ring.destroy?.(),
    });
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - missile.launched   ← spawnMissile (a fresh incoming arc)            [archetype]
   *   - intercept.detonated← detonate (a player-aimed blast cleared the overlap) [archetype]
   *   - base.destroyed     ← destroyBase (a missile reached a base)         [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'missile.launched',
          payload: '{id,x,targetId}',
          scope: 'archetype',
          drivenBy: 'an incoming arc spawns (the spawn cadence elapsing, wave quota permitting)',
          expect:
            'a missile enters __GAME__.entities (the active-missile / hazard count rises); missile.launched logged',
        },
        {
          name: 'intercept.detonated',
          payload: '{x,y,radius,cleared}',
          scope: 'archetype',
          drivenBy: 'a defensive shot reaches its aim point (player fire / pointer tap, cooldown permitting)',
          expect:
            'a blast clears every missile within the radius — they leave __GAME__.entities (active-missile count falls); intercept.detonated logged',
        },
        {
          name: 'base.destroyed',
          payload: '{id,remaining}',
          scope: 'archetype',
          drivenBy: 'a missile reaches a base',
          expect:
            'the base leaves __GAME__.entities (bases remaining decreases); the last base falling sends the cannon a lethal blow; base.destroyed logged',
        },
      ],
    };
  }
}
