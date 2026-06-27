/**
 * PowerUpDrop — falling power-up drops the paddle catches (BUILD — system; brick-breaker genre).
 *
 * The classic brick-breaker capsule: SOME cleared bricks release a power-up that FALLS
 * toward the paddle; if the paddle catches it (an overlap on the way down) the power-up's
 * EFFECT applies; if it falls past the paddle it is lost. This system owns the drops
 * end-to-end — it is NOT the engine ball, so it spawns each as its own sprite, integrates
 * the fall in update(), and resolves the paddle catch itself.
 *
 * THE TRIGGER (a brick carrying a drop is cleared): the system listens on the shared bus
 * for `brick.cleared` (the BrickGrid seam) and, with a configured chance, spawns a falling
 * power-up at the cleared brick's position. It also exposes a public spawnDrop(x,y) seam so
 * a $custom effect, or the runtime check-exposes driver, can spawn a drop deterministically.
 *
 * THE OBSERVABLE __GAME__ TRANSITIONS (the contract):
 *   - powerup.dropped → a falling power-up sprite enters the scene `entities` group tagged
 *     `__type='powerup'`, so __GAME__.entities gains an entry of that type.
 *   - powerup.caught  → the paddle overlaps a falling drop: the drop leaves __GAME__.entities
 *     AND its effect applies. The DEFAULT effect grants one life (observable: __GAME__.lives
 *     increases by one). When effectKind='grow' and the scene exposes a paddleGrow seam, the
 *     catch ALSO widens the paddle (still observable via __GAME__.player displayWidth).
 *
 * It re-implements NOTHING the engine owns: the paddle + its lives live in BasePaddleScene;
 * the bricks + their clear emit live in BrickGrid; this system only adds the falling capsule
 * layer and the catch→effect seam. GENERIC: no count, no coordinate, no theme is baked.
 *
 * Params (all OPTIONAL — declared defaults, never a baked map):
 *   dropChance  probability in [0,1] that a cleared brick releases a drop (default 0.25).
 *   fallSpeed   the power-up's downward fall speed px/s (default 160).
 *   maxDrops    cap on simultaneously-falling drops (default 4).
 *   effectKind  which effect a caught drop applies: 'extraLife' | 'grow' (default 'extraLife').
 *   triggerEvent the bus event a cleared-brick drop listens on (default 'brick.cleared').
 *   capsuleSize the falling capsule's display size px (default 18).
 */
import type { ISceneSystem } from '../scenes/paddle-data';
import type { ComponentSurface, EventBus } from '@contract/component-surface';
import { aabb } from '../scenes/ball-physics';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors every system file). */
export const CAPABILITY = {
  kind: 'system',
  id: 'PowerUpDrop',
  intent:
    'Some cleared bricks release a power-up capsule that falls toward the paddle; catching it (a paddle overlap on the way down) applies the power-up effect (default: grant one life — observable on __GAME__.lives), while a drop that falls past the paddle is lost. Listens on a configurable bus event (default brick.cleared) with a configured chance, spawns each capsule into the scene entities group (so the active power-up count rises), and exposes a public spawnDrop() seam; emits powerup.dropped at the spawn and powerup.caught at the catch.',
  attachesTo: 'scene',
  params: ['dropChance', 'fallSpeed', 'maxDrops', 'effectKind', 'triggerEvent', 'capsuleSize'],
  roles: ['paddle', 'brick'],
} as const;

export const POWERUPDROP_CAPABILITIES = [CAPABILITY] as const;

export interface PowerUpDropConfig {
  dropChance?: number;
  fallSpeed?: number;
  maxDrops?: number;
  effectKind?: 'extraLife' | 'grow';
  triggerEvent?: string;
  capsuleSize?: number;
}

/** One falling power-up this system owns (the sprite + a stable id). */
interface Drop {
  sprite: any;
  id: string;
}

export class PowerUpDrop implements ISceneSystem {
  private scene: any;
  private drops: Drop[] = [];
  private group: any = null;
  private unsubscribe: (() => void) | null = null;
  private serial = 0;
  private readonly dropChance: number;
  private readonly fallSpeed: number;
  private readonly maxDrops: number;
  private readonly effectKind: 'extraLife' | 'grow';
  private readonly triggerEvent: string;
  private readonly capsuleSize: number;

  constructor(params: PowerUpDropConfig = {}) {
    this.dropChance = Math.min(1, Math.max(0, params.dropChance ?? 0.25));
    this.fallSpeed = Math.max(1, params.fallSpeed ?? 160);
    this.maxDrops = Math.max(1, params.maxDrops ?? 4);
    this.effectKind = params.effectKind === 'grow' ? 'grow' : 'extraLife';
    this.triggerEvent = params.triggerEvent ?? 'brick.cleared';
    this.capsuleSize = Math.max(4, params.capsuleSize ?? 18);
  }

  /** The shared event bus (the scene owns it; attach() set this.scene). */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  /** Re-arm to a fresh-level state so a restarted level is genuinely replayable. */
  reset(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.drops = [];
    this.group = null;
    this.serial = 0;
  }

  /** Wire the cleared-brick trigger listener + the entities group the drops live in. */
  attach(scene: any): void {
    this.scene = scene;
    // Publish the read/drive seam so a $custom effect or the runtime check-exposes driver
    // can spawn a drop via scene.powerUpDrop.spawnDrop(x, y).
    scene.powerUpDrop = this;
    // The 'entities' group is one of the core hook's scanned group names, so any sprite
    // added here (tagged __type='powerup') shows up in __GAME__.entities.
    if (!scene.entities || typeof scene.entities.add !== 'function') {
      scene.entities = scene.add.group();
    }
    this.group = scene.entities;
    // A brick carrying a drop is cleared: listen for the configured bus event and, with
    // the configured chance, release a falling power-up at the cleared brick's position.
    this.unsubscribe = scene.eventBus?.on?.(this.triggerEvent, (payload: any) => {
      if (Math.random() >= this.dropChance) return;
      const x = typeof payload?.x === 'number' ? payload.x : (scene.paddle?.x ?? scene.mapWidth / 2);
      const y = typeof payload?.y === 'number' ? payload.y : 40;
      this.spawnDrop(x, y);
    });
  }

  /** This system owns its own drop integration in update() — no Arcade overlap wiring. */
  setupCollisions(): void {}

  /**
   * The PUBLIC drop seam: release ONE falling power-up at (x, y). Adds it to the entities
   * group (active power-up count UP) and emits `powerup.dropped`. Returns the spawned id,
   * or null when capped or no scene. Safe to call from a $custom effect / a verify driver.
   */
  spawnDrop(x: number, y: number): string | null {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return null;
    if (this.drops.length >= this.maxDrops) return null;
    const id = `powerup_${(this.serial += 1)}`;
    const sprite = this.spawnSprite(x, y, id);
    this.drops.push({ sprite, id });
    // The true gameplay seam: a falling power-up just entered __GAME__.entities.
    this.bus?.emit('powerup.dropped', {
      id,
      kind: this.effectKind,
      x: Math.round(x),
      y: Math.round(y),
    });
    return id;
  }

  /** Number of power-ups currently falling (for diagnostics / a verify witness). */
  activeDropCount(): number {
    return this.drops.length;
  }

  /**
   * Per-frame: fall each drop straight down; if the paddle overlaps it (a catch) apply the
   * effect + emit `powerup.caught` + remove it; if it falls below the field, drop it (a miss,
   * no penalty). The fall uses the scene clock delta so it matches the engine's frame rate.
   */
  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted || this.drops.length === 0) return;
    const dt = Math.min(0.05, (scene.game?.loop?.delta ?? 1000 / 60) / 1000);
    const mapH = scene.mapHeight ?? 0;
    const paddle = scene.paddle;

    for (let i = this.drops.length - 1; i >= 0; i -= 1) {
      const drop = this.drops[i];
      const sprite = drop.sprite;
      if (!sprite || sprite.active === false) {
        this.drops.splice(i, 1);
        continue;
      }
      sprite.y += this.fallSpeed * dt;

      // The CATCH: the paddle overlaps a descending drop → apply the effect.
      if (paddle && this.overlapsPaddle(sprite, paddle)) {
        this.applyEffect(drop);
        this.removeDrop(i);
        continue;
      }
      // The MISS: the drop fell past the bottom of the field → lost (no penalty).
      if (sprite.y - sprite.displayHeight / 2 > mapH) {
        this.removeDrop(i);
      }
    }
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** Spawn one falling power-up sprite into the entities group, tagged so the hook counts it. */
  private spawnSprite(x: number, y: number, id: string): any {
    const scene = this.scene;
    const hasTex = scene.textures?.exists?.('__px');
    const sprite = scene.add.sprite(x, y, hasTex ? '__px' : undefined);
    sprite.setDisplaySize?.(this.capsuleSize, this.capsuleSize);
    sprite.setTint?.(this.effectKind === 'grow' ? 0x4ad991 : 0xffd24a);
    sprite.__type = 'powerup';
    sprite.__id = id;
    this.group?.add?.(sprite);
    return sprite;
  }

  /** True iff the paddle's AABB overlaps the falling drop's AABB (the catch test). */
  private overlapsPaddle(sprite: any, paddle: any): boolean {
    const pbox = aabb(paddle.x, paddle.y, paddle.displayWidth, paddle.displayHeight);
    const dbox = aabb(sprite.x, sprite.y, sprite.displayWidth, sprite.displayHeight);
    return (
      Math.abs(dbox.cx - pbox.cx) < dbox.halfW + pbox.halfW &&
      Math.abs(dbox.cy - pbox.cy) < dbox.halfH + pbox.halfH
    );
  }

  /**
   * Apply a caught drop's effect and emit `powerup.caught`. The DEFAULT effect grants ONE
   * life (observable: __GAME__.lives increases). When effectKind='grow' and the scene
   * exposes a paddleGrow seam (the PaddleGrow sibling), the catch ALSO widens the paddle.
   */
  private applyEffect(drop: Drop): void {
    const scene = this.scene;
    if (this.effectKind === 'grow' && typeof scene?.paddleGrow?.activate === 'function') {
      scene.paddleGrow.activate();
    } else {
      // Grant one life — the always-observable default (BasePaddleScene.lives → __GAME__.lives).
      scene.lives = (scene.lives ?? 0) + 1;
    }
    // cosmetic juice bound to the catch moment (no-op if the level bound none)
    scene?.fireEffect?.('powerup.caught', drop.sprite.x, drop.sprite.y);
    // The true gameplay seam: the paddle caught a drop → its effect just applied.
    this.bus?.emit('powerup.caught', {
      id: drop.id,
      kind: this.effectKind,
      lives: scene?.lives ?? 0,
    });
  }

  /** Remove drop i from the world (count -1) and stop tracking it. */
  private removeDrop(i: number): void {
    const drop = this.drops[i];
    if (!drop) return;
    this.drops.splice(i, 1);
    this.group?.remove?.(drop.sprite, false, false);
    drop.sprite?.destroy?.();
  }

  // ── component surface (the declared PUSH-channel event set) ──────────────────

  /**
   * The events this system publishes. Each EventDecl is a TRUE statement about a real
   * emit site:
   *   - powerup.dropped ← spawnDrop(): a falling capsule enters __GAME__.entities.
   *   - powerup.caught  ← applyEffect(): the paddle catches a drop and its effect applies
   *     (the default grants one life → __GAME__.lives increases).
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'powerup.dropped',
          payload: '{id,kind,x,y}',
          scope: 'archetype',
          drivenBy: 'a brick carrying a drop is cleared (the configured bus event fires and the drop chance hits), or spawnDrop() is called',
          expect:
            "a falling power-up spawns — __GAME__.entities gains an entry of type 'powerup'; powerup.dropped logged",
        },
        {
          name: 'powerup.caught',
          payload: '{id,kind,lives}',
          scope: 'archetype',
          drivenBy: 'the paddle overlaps a falling power-up (catches it on the way down)',
          expect:
            "the power-up effect applies — the drop leaves __GAME__.entities and (default effect) __GAME__.lives increases by one; powerup.caught logged",
        },
      ],
    };
  }
}
