/**
 * ============================================================================
 * CoinLinePickup — collectible coin lines that score on overlap (BUILD — system)
 * ============================================================================
 *
 * The endless-runner reward layer: streams LINES of collectible coins through the
 * world (a horizontal run of N coins at a config cadence, the line's vertical center
 * drawn from a SEEDED PRNG so it sits in a reachable band), advances each coin LEFT at
 * the scroll speed every frame, and CULLS coins past the left edge. When the fixed-x
 * avatar OVERLAPS a coin it is COLLECTED: the coin count + the score both increase and
 * the coin DESPAWNS — so a clean threading line is a tangible reward, never a hazard.
 *
 * It is the carrot to ObstacleScrollSystem's stick: it spawns + moves + culls its OWN
 * coin pool (it does NOT touch the obstacle stream) and it shares the runner's scroll
 * feel via the same `scrollSpeed` default so coins drift at the world's pace.
 *
 * THE INVARIANTS IT ENFORCES:
 *   - INV-COLLECT-ONCE: each coin carries a `collected` latch; the overlap handler ignores
 *     an already-collected coin, so one coin scores EXACTLY ONCE and despawns immediately
 *     (no double-count, no lingering sprite).
 *   - INV-DETERMINISTIC: the line cadence + the vertical center come from a SEEDED PRNG
 *     (utils.SeededRandom), NEVER Math.random() — same seed ⇒ the identical coin layout
 *     (reproducible, replayable). The line's center stays in a [margin, floor−margin] band.
 *   - INV-RESET: reset() destroys the live coins, re-seeds the PRNG, and zeroes the coin
 *     count + scroll cursor, so a restarted run re-arms byte-identically (no leaked coins,
 *     no leaked count).
 *   - bounded memory: a coin past the left edge is destroyed (no leak).
 *
 * IDENTITY (id source): the coin.collected payload's `id` is the coin's own auto-derived
 * id (`coin_<n>`, minted at spawn from this system's monotonic counter) — NOT a config
 * param; a coin is this system's OWN spawned entity, so its id is auto-derived per the
 * standard's ID-SOURCE convention.
 *
 * OBSERVABLE (the contract): a collect writes the engine's ONE score channel
 * (scene.setScore / registry 'score' → __GAME__.score) AND publishes the live running
 * coin count on scene.coinCount (also surfaced as the `coinCount` observable thunk). Every
 * live coin is added to scene.coins (a group the hook surfaces into __GAME__.entities).
 *
 * EVENT (the PUSH channel, on the shared scene.eventBus):
 *   - coin.collected ← the avatar overlaps a coin (payload {id, coinCount, score}); the coin
 *     count + score both increase and the coin despawns.
 *
 * GENERIC: no game/theme, no baked coordinate. Every number is a DECLARED default,
 * re-tunable via params; a level that binds no coin layout is a clean no-op (the system
 * just spawns the configured default stream).
 */
import type { ISceneSystem } from '../scenes/runner-data';
import { SeededRandom } from '../utils';
import { type EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'CoinLinePickup',
  intent:
    'Collectible coin lines streamed through the auto-scroll world: spawn a horizontal run of coins at a seeded cadence + reachable vertical band, advance them left each frame, cull off-screen. When the fixed-x avatar overlaps a coin it is collected exactly once — the coin count + the score both increase and the coin despawns. The endless-runner reward layer.',
  attachesTo: 'scene',
  params: [
    'scrollSpeed',
    'spawnEveryPx',
    'coinsPerLine',
    'coinSpacingPx',
    'coinSize',
    'coinValue',
    'centerMargin',
    'seed',
    'assetSlot',
    'floorY',
  ],
  tuning: ['scrollSpeed', 'spawnEveryPx', 'coinsPerLine', 'coinSpacingPx', 'coinValue'],
  roles: ['player', 'coin'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** Per-game tuning for the coin stream (every field DECLARED with a sensible default). */
export interface CoinLineConfig {
  /** Scroll speed (px/s) coins drift left — matched to the world scroll. Default 150. */
  scrollSpeed?: number;
  /** Horizontal spacing (px) between successive coin LINES. Default 360. */
  spawnEveryPx?: number;
  /** How many coins make up one line. Default 4. */
  coinsPerLine?: number;
  /** Spacing (px) between coins within a line. Default 44. */
  coinSpacingPx?: number;
  /** Coin display diameter (px) — also the AABB collision box size. Default 26. */
  coinSize?: number;
  /** Score awarded per collected coin. Default 1. */
  coinValue?: number;
  /** Margin (px) the line center keeps from the ceiling and floor (reachable band). Default 90. */
  centerMargin?: number;
  /** The deterministic PRNG seed for the line layout (INV-DETERMINISTIC). Default 7. */
  seed?: number;
  /** asset/texture key for the coin body (falls back to a placeholder). */
  assetSlot?: string;
  /** The floor y the reachable band stops above (0 ⇒ derive from the live map height). Default 0. */
  floorY?: number;
}

/** Declared defaults (the runner reward-line feel). Re-tuned per game via params. */
const DEF = {
  scrollSpeed: 150,
  spawnEveryPx: 360,
  coinsPerLine: 4,
  coinSpacingPx: 44,
  coinSize: 26,
  coinValue: 1,
  centerMargin: 90,
  seed: 7,
  floorY: 0, // 0 ⇒ derive from the live map height in attach().
};

/** One live coin: the sprite + its collected latch + its auto-derived id. */
interface Coin {
  id: string;
  sprite: any;
  /** Whether this coin has already been collected (INV-COLLECT-ONCE). */
  collected: boolean;
}

export class CoinLinePickup implements ISceneSystem {
  private scene: any;
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly cfg: Required<Omit<CoinLineConfig, 'assetSlot'>> & { assetSlot?: string };
  private rng: SeededRandom;

  /** Live coins (left→right). */
  private coins: Coin[] = [];
  /** Distance scrolled since the last line spawn (px). */
  private sinceSpawn = 0;
  /** Monotonic coin counter — mints each coin's auto-derived id. */
  private spawnCount = 0;
  /** Running count of coins this run has collected (INV-RESET zeroes it). */
  private coinCount = 0;
  private floorY = 0;

  constructor(params: CoinLineConfig = {}) {
    this.cfg = {
      scrollSpeed: params.scrollSpeed ?? DEF.scrollSpeed,
      spawnEveryPx: params.spawnEveryPx ?? DEF.spawnEveryPx,
      coinsPerLine: params.coinsPerLine ?? DEF.coinsPerLine,
      coinSpacingPx: params.coinSpacingPx ?? DEF.coinSpacingPx,
      coinSize: params.coinSize ?? DEF.coinSize,
      coinValue: params.coinValue ?? DEF.coinValue,
      centerMargin: params.centerMargin ?? DEF.centerMargin,
      seed: params.seed ?? DEF.seed,
      floorY: params.floorY ?? DEF.floorY,
      assetSlot: params.assetSlot,
    };
    this.rng = new SeededRandom(this.cfg.seed);
  }

  reset(): void {
    // Destroy any standing coins so a restarted run re-arms byte-identically.
    for (const c of this.coins) c.sprite?.destroy?.();
    this.coins = [];
    this.sinceSpawn = 0;
    this.spawnCount = 0;
    this.coinCount = 0;
    this.rng.reset(); // INV-DETERMINISTIC + INV-RESET: same layout after restart.
    if (this.scene) {
      this.scene.coins = this.coins;
      this.scene.coinCount = 0;
    }
  }

  attach(scene: any): void {
    this.scene = scene;
    this.coinCount = 0;
    this.floorY = this.cfg.floorY > 0 ? this.cfg.floorY : this.worldHeight() - 24;
    // Own the coins group — the hook surfaces it in __GAME__.entities.
    if (!scene.coins || typeof scene.coins.getChildren !== 'function') {
      scene.coins = scene.physics.add.group();
    }
    // Publish the live coin count for diagnostics / a HUD effect (single source of truth).
    scene.coinCount = 0;
    // Spawn the first line just off the right edge so the run starts with a reward.
    this.sinceSpawn = this.cfg.spawnEveryPx;
  }

  /** Wire avatar↔coin overlap → collect (scoring + despawn). */
  setupCollisions(): void {
    const scene = this.scene;
    const avatar = scene?.player;
    if (!avatar || !scene?.coins) return;
    scene.physics.add.overlap(avatar, scene.coins, (a: any, coinSprite: any) => {
      if (a.isDead) return;
      if (!coinSprite || coinSprite.active === false) return;
      this.collect(coinSprite);
    });
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    const dt = 1 / 60;
    const dx = this.cfg.scrollSpeed * dt;

    // Advance every live coin.
    for (const c of this.coins) c.sprite.x -= dx;

    // Cull coins fully past the left edge (bounded memory — no leak).
    const kept: Coin[] = [];
    for (const c of this.coins) {
      if (c.sprite.x + this.cfg.coinSize < -8) c.sprite.destroy();
      else kept.push(c);
    }
    if (kept.length !== this.coins.length) {
      this.coins = kept;
      scene.coins = scene.coins; // group identity unchanged; pool array refreshed
    }

    // Spawn a new line on the consistent distance cadence.
    this.sinceSpawn += dx;
    if (this.sinceSpawn >= this.cfg.spawnEveryPx) {
      this.sinceSpawn -= this.cfg.spawnEveryPx;
      this.spawnLine();
    }
  }

  /** Spawn ONE horizontal line of coins just off the right edge at a SEEDED center y. */
  private spawnLine(): void {
    const scene = this.scene;
    const W = this.worldWidth();
    const n = Math.max(1, Math.floor(this.cfg.coinsPerLine));
    const margin = this.cfg.centerMargin;
    // The line center drawn from a reachable band — never an edge line.
    const minC = margin;
    const maxC = this.floorY - margin;
    const centerY = maxC > minC ? this.rng.range(minC, maxC) : (minC + maxC) / 2;

    const slot = this.cfg.assetSlot;
    const key = slot && scene.textures.exists(slot) ? slot : '__px';
    const x0 = W + this.cfg.coinSize / 2 + 4;

    for (let i = 0; i < n; i++) {
      const cx = x0 + i * this.cfg.coinSpacingPx;
      const id = `coin_${this.spawnCount}`;
      this.spawnCount += 1;
      const sprite = this.makeCoin(cx, centerY, key, id);
      this.coins.push({ id, sprite, collected: false });
    }
  }

  /** Make one coin body of the configured size, tagged for __GAME__.entities. */
  private makeCoin(cx: number, cy: number, key: string, id: string): any {
    const scene = this.scene;
    const size = this.cfg.coinSize;
    const sprite = scene.physics.add.sprite(cx, cy, key) as any;
    if (typeof sprite.setDisplaySize === 'function') sprite.setDisplaySize(size, size);
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.setImmovable?.(true);
      body.setSize?.(size / (sprite.scaleX || 1), size / (sprite.scaleY || 1), true);
    }
    sprite.__id = id;
    sprite.__type = 'coin';
    scene.coins.add(sprite);
    return sprite;
  }

  /** Collect ONE coin: score + count up, despawn, emit — exactly once (INV-COLLECT-ONCE). */
  private collect(coinSprite: any): void {
    const scene = this.scene;
    // Find the live coin record by sprite identity; ignore an already-collected one.
    const coin = this.coins.find((c) => c.sprite === coinSprite);
    if (!coin || coin.collected) return;
    coin.collected = true;

    // The OBSERVABLE transitions: the coin count + the engine score both increase.
    this.coinCount += 1;
    scene.coinCount = this.coinCount;
    const newScore = this.currentScore() + this.cfg.coinValue;
    this.writeScore(newScore);

    // Despawn the coin immediately (no lingering sprite) and drop it from the pool.
    coin.sprite?.destroy?.();
    this.coins = this.coins.filter((c) => c !== coin);
    scene.coins = scene.coins; // group identity unchanged; pool array refreshed

    // The PUSH seam: the avatar overlapped a coin — count + score up, coin despawned.
    this.bus?.emit('coin.collected', {
      id: coin.id,
      coinCount: this.coinCount,
      score: newScore,
    });
  }

  /** Read the current engine score (the single source — registry/getScore). */
  private currentScore(): number {
    const scene = this.scene;
    if (typeof scene.getScore === 'function') return Number(scene.getScore() ?? 0);
    if (scene.registry && typeof scene.registry.get === 'function') {
      return Number(scene.registry.get('score') ?? 0);
    }
    return 0;
  }

  /** Write the single score source (the engine's score channel; the hook reads it). */
  private writeScore(value: number): void {
    const scene = this.scene;
    if (typeof scene.setScore === 'function') scene.setScore(value);
    else if (scene.registry && typeof scene.registry.set === 'function') {
      scene.registry.set('score', value);
    }
  }

  private worldWidth(): number {
    return this.scene?.mapWidth ?? this.scene?.scale?.width ?? 432;
  }
  private worldHeight(): number {
    return this.scene?.mapHeight ?? this.scene?.scale?.height ?? 768;
  }

  /**
   * The PUSH + PULL channels this system publishes (one true statement per real seam):
   *   - coin.collected ← collect (the avatar overlapped a coin) [archetype]
   *   - observable coinCount ← the live running count this system computes
   */
  surface(): ComponentSurface {
    return {
      observables: {
        coinCount: () => this.coinCount,
      },
      anchors: [],
      events: [
        {
          name: 'coin.collected',
          payload: '{id,coinCount,score}',
          scope: 'archetype',
          drivenBy: 'the avatar overlapping a coin',
          expect:
            'the collected coin despawns; __GAME__ coin count increases by one and __GAME__.score increases by coinValue; coin.collected logged',
        },
      ],
    };
  }
}
