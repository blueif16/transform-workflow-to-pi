/**
 * ============================================================================
 * ObstacleScrollSystem — the auto-scroll + procedural-obstacle engine (BUILD — system)
 * ============================================================================
 *
 * The genre-novel HEART of the endless runner: the world scrolls past the fixed-x
 * avatar, gap-obstacle PAIRS stream in from the right edge at a consistent cadence,
 * advance left every frame, and are CULLED past the left edge. No catalog system does a
 * deterministic procedural auto-scroll, so this is the engine the MODULE owns once.
 *
 * THE INVARIANTS IT ENFORCES (RB §3):
 *   - INV-PASSABLE: the gap height is FIXED (data `gapHeight`), and the gap CENTER is
 *     drawn from `[gapMargin, floorY − gapHeight − gapMargin]` — so a clear, threadable
 *     lane ALWAYS exists (never an edge gap, never a randomized gap SIZE). The avatar
 *     fits with margin (HARDEN keeps gapHeight ≥ avatar height + margin).
 *   - INV-DETERMINISTIC: the gap-center stream comes from a SEEDED PRNG (utils.SeededRandom),
 *     NEVER Math.random() — the same seed ⇒ the identical obstacle sequence (reproducible,
 *     debuggable, replayable).
 *   - INV-COLLISION + lose: an avatar↔obstacle overlap, OR the avatar touching the floor
 *     band / flying above the ceiling, drains the avatar's health → the engine lose seam
 *     (player.died → status:'lost'). AABB rectangle bodies, upright (never the rotated
 *     sprite). The system invents NO new death path.
 *   - INV-RESET: reset() destroys the obstacle pool, re-seeds the PRNG, and clears the
 *     scroll cursor, so a restarted run is byte-identical to a fresh one.
 *   - bounded memory: an obstacle past the left edge is destroyed (no leak — RB §3 PF-7).
 *
 * OBSERVABLE (the contract): every obstacle is added to scene.obstacles (a group the hook
 * surfaces into __GAME__.entities, id/x/y per child), so its position advances each frame.
 *
 * EVENTS (the PUSH channel, on the shared scene.eventBus):
 *   - obstacle.spawned ← once per obstacle pair when it FIRST enters the world (payload {id}).
 *   - hazard.activated ← when the avatar collides with an obstacle / floor / ceiling and
 *     the lose seam fires (payload {id}); the standardized "the run ended on a hazard" moment.
 *
 * GENERIC: no game/theme, no baked coordinate. Every number is data via params; a level
 * that binds no obstacle stream is a clean no-op.
 */
import type { ISceneSystem, ObstacleStreamData } from '../scenes/runner-data';
import { SeededRandom } from '../utils';
import { type EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the other systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ObstacleScrollSystem',
  intent:
    'Auto-scroll + deterministic procedural obstacles: stream gap-obstacle pairs in from the right at a consistent cadence, advance them left each frame, cull off-screen. The gap height is FIXED and the gap center is drawn (from a SEEDED PRNG) within a margin band so a threadable lane always exists. An avatar↔obstacle / floor / ceiling overlap fires the engine lose seam. The endless-runner engine.',
  attachesTo: 'scene',
  params: ['scrollSpeed', 'spawnEveryPx', 'gapHeight', 'gapMargin', 'obstacleWidth', 'seed', 'assetSlot', 'floorY'],
  roles: ['player', 'obstacle'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export type ObstacleScrollConfig = ObstacleStreamData;

/** One live obstacle pair: the two sprites + the gap geometry + the scored latch. */
interface ObstaclePair {
  id: string;
  top: any;
  bottom: any;
  /** The gap center y (for diagnostics / the score system to read). */
  gapCenterY: number;
  /** Whether the avatar has already passed this pair (read by ScoreOnPassSystem). */
  scored: boolean;
}

/** Declared defaults (the gravity-flap feel — RB §5). Re-tuned per game via params. */
const DEF = {
  scrollSpeed: 150,
  spawnEveryPx: 240,
  gapHeight: 210,
  gapMargin: 90,
  obstacleWidth: 64,
  seed: 1,
  floorY: 0, // 0 ⇒ derive from the live map height in attach().
};

export class ObstacleScrollSystem implements ISceneSystem {
  private scene: any;
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly cfg: Required<Omit<ObstacleStreamData, 'assetSlot'>> & { assetSlot?: string };
  private rng: SeededRandom;

  /** Live obstacle pairs (left→right). Exposed to ScoreOnPassSystem via scene.obstaclePairs. */
  private pairs: ObstaclePair[] = [];
  /** Distance scrolled since the last spawn (px) — spawns every `spawnEveryPx`. */
  private sinceSpawn = 0;
  private spawnCount = 0;
  private floorY = 0;

  constructor(params: ObstacleStreamData = {}) {
    this.cfg = {
      scrollSpeed: params.scrollSpeed ?? DEF.scrollSpeed,
      spawnEveryPx: params.spawnEveryPx ?? DEF.spawnEveryPx,
      gapHeight: params.gapHeight ?? DEF.gapHeight,
      gapMargin: params.gapMargin ?? DEF.gapMargin,
      obstacleWidth: params.obstacleWidth ?? DEF.obstacleWidth,
      seed: params.seed ?? DEF.seed,
      floorY: params.floorY ?? DEF.floorY,
      assetSlot: params.assetSlot,
    };
    this.rng = new SeededRandom(this.cfg.seed);
  }

  reset(): void {
    // Destroy any standing obstacles so a restarted run re-arms byte-identically.
    for (const p of this.pairs) {
      p.top?.destroy?.();
      p.bottom?.destroy?.();
    }
    this.pairs = [];
    this.sinceSpawn = 0;
    this.spawnCount = 0;
    this.rng.reset(); // INV-DETERMINISTIC + INV-RESET: same stream after restart.
    if (this.scene) this.scene.obstaclePairs = this.pairs;
  }

  attach(scene: any): void {
    this.scene = scene;
    this.floorY = this.cfg.floorY > 0 ? this.cfg.floorY : this.worldHeight() - 24;
    // Own the obstacles group — the hook surfaces it in __GAME__.entities.
    if (!scene.obstacles || typeof scene.obstacles.getChildren !== 'function') {
      scene.obstacles = scene.physics.add.group();
    }
    // Publish the live pairs for the score system to read (single source of truth).
    scene.obstaclePairs = this.pairs;
    // Spawn the first pair just off the right edge so the run starts with a target.
    this.sinceSpawn = this.cfg.spawnEveryPx;
  }

  /** Wire avatar↔obstacle overlap → the lose seam; floor/ceiling checked in update(). */
  setupCollisions(): void {
    const scene = this.scene;
    const avatar = scene?.player;
    if (!avatar || !scene?.obstacles) return;
    scene.physics.add.overlap(avatar, scene.obstacles, (a: any, obstacle: any) => {
      if (a.isInvulnerable || a.isDead) return;
      if (!obstacle || obstacle.active === false) return;
      this.fireLose(obstacle.__id ?? 'obstacle');
    });
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    const dt = 1 / 60;
    const dx = this.cfg.scrollSpeed * dt;

    // Advance + cull every live obstacle.
    for (const p of this.pairs) {
      p.top.x -= dx;
      p.bottom.x -= dx;
    }
    // Cull pairs fully past the left edge (bounded memory — INV no-leak).
    const culled: ObstaclePair[] = [];
    for (const p of this.pairs) {
      if (p.top.x + this.cfg.obstacleWidth < -8) {
        p.top.destroy();
        p.bottom.destroy();
      } else {
        culled.push(p);
      }
    }
    if (culled.length !== this.pairs.length) {
      this.pairs = culled;
      scene.obstaclePairs = this.pairs;
    }

    // Spawn on the consistent distance cadence (INV consistent spacing — RB §1).
    this.sinceSpawn += dx;
    if (this.sinceSpawn >= this.cfg.spawnEveryPx) {
      this.sinceSpawn -= this.cfg.spawnEveryPx;
      this.spawnPair();
    }

    // Floor / ceiling = lose (INV-COLLISION). Upright AABB, never the rotated sprite.
    const avatar = scene.player;
    if (avatar && !avatar.isDead && !avatar.isInvulnerable) {
      const half = (avatar.displayHeight ?? 34) / 2;
      if (avatar.y + half >= this.floorY || avatar.y - half <= 0) {
        this.fireLose('bounds');
      }
    }
  }

  /** Spawn ONE obstacle pair just off the right edge with a SEEDED gap center. */
  private spawnPair(): void {
    const scene = this.scene;
    const W = this.worldWidth();
    const gap = this.cfg.gapHeight;
    const margin = this.cfg.gapMargin;
    // INV-PASSABLE: gap center drawn from a margin band — never an edge gap.
    const minC = margin + gap / 2;
    const maxC = this.floorY - margin - gap / 2;
    const gapCenterY = maxC > minC ? this.rng.range(minC, maxC) : (minC + maxC) / 2;

    const ow = this.cfg.obstacleWidth;
    const x = W + ow / 2 + 4;
    const slot = this.cfg.assetSlot;
    const key = slot && scene.textures.exists(slot) ? slot : '__px';

    // Top obstacle: from the ceiling down to (gapCenterY − gap/2).
    const topH = Math.max(2, gapCenterY - gap / 2);
    const top = this.makeObstacle(x, topH / 2, ow, topH, key);
    // Bottom obstacle: from (gapCenterY + gap/2) down to the floor.
    const bottomTop = gapCenterY + gap / 2;
    const bottomH = Math.max(2, this.floorY - bottomTop);
    const bottom = this.makeObstacle(x, bottomTop + bottomH / 2, ow, bottomH, key);

    const id = `obstacle_${this.spawnCount}`;
    top.__id = id;
    bottom.__id = id;
    this.spawnCount += 1;
    const pair: ObstaclePair = { id, top, bottom, gapCenterY, scored: false };
    this.pairs.push(pair);
    scene.obstaclePairs = this.pairs;
    // The PUSH seam: an obstacle entered the world (RB §2 score-on-pass funnel).
    this.bus?.emit('obstacle.spawned', { id });
  }

  /** Make one static obstacle body of the given size, tagged for __GAME__.entities. */
  private makeObstacle(cx: number, cy: number, w: number, h: number, key: string): any {
    const scene = this.scene;
    const sprite = scene.physics.add.sprite(cx, cy, key) as any;
    if (typeof sprite.setDisplaySize === 'function') sprite.setDisplaySize(w, h);
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.setImmovable?.(true);
      // Upright AABB sized to the display box (INV-COLLISION — never rotated).
      body.setSize?.(w / (sprite.scaleX || 1), h / (sprite.scaleY || 1), true);
    }
    sprite.__type = 'obstacle';
    scene.obstacles.add(sprite);
    return sprite;
  }

  /** Fire the lose seam ONCE: hazard.activated event + the engine player death path. */
  private fireLose(id: string): void {
    const scene = this.scene;
    const avatar = scene?.player;
    if (!avatar || avatar.isDead) return;
    this.bus?.emit('hazard.activated', { id });
    // The LOSE SEAM via the engine's own death path (status → 'lost'); no new path.
    if (typeof avatar.takeDamage === 'function') avatar.takeDamage(9999);
    else if (typeof scene.onPlayerDeath === 'function') scene.onPlayerDeath();
  }

  private worldWidth(): number {
    return this.scene?.mapWidth ?? this.scene?.scale?.width ?? 432;
  }
  private worldHeight(): number {
    return this.scene?.mapHeight ?? this.scene?.scale?.height ?? 768;
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One true
   * statement per real emit site:
   *   - obstacle.spawned ← spawnPair (a pair first enters the world) [archetype]
   *   - hazard.activated ← fireLose (avatar hit an obstacle / floor / ceiling) [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'obstacle.spawned',
          payload: '{id}',
          scope: 'archetype',
          drivenBy: 'the scroll cadence reaching the spawn interval',
          expect:
            'a new obstacle pair appears in __GAME__.entities at the right edge with a passable gap and advances left each frame; obstacle.spawned logged',
        },
        {
          name: 'hazard.activated',
          payload: '{id}',
          scope: 'archetype',
          drivenBy: 'the avatar overlapping an obstacle, or touching the floor/ceiling',
          expect:
            "the avatar takes the lose seam and __GAME__.status becomes 'lost'; hazard.activated logged",
        },
      ],
    };
  }
}
