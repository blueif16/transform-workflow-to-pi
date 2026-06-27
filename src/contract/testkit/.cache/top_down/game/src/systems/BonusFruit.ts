/**
 * BonusFruit — the timed bonus collectible (BUILD — system; the maze-chase
 * risk-reward detour off the dot route, DR §3, bounded + idempotent DR §6;
 * Pac-Man Dossier: a fruit after 70 and 170 cleared dots, present ~9-10s).
 *
 * The maze-chase reward beat: as the player eats dots the system counts cleared
 * dots (it CONSUMES the standardized `reward.collected` bus event — the same seam
 * every collectathon funnels through); when the running count CROSSES a declared
 * threshold it spawns ONE high-value fruit at a declared cell, worth far more than
 * a dot. The fruit lives for a bounded window then auto-removes if untaken;
 * overlapping it before then bumps the score by the bonus value EXACTLY ONCE and
 * removes it. It drives the player off the safe dot route into ghost territory for
 * a chunk of score — the genre's signature risk/reward.
 *
 * OBSERVABLE (the contract): on a threshold the fruit appears in
 * __GAME__.entities (a real sprite tagged into the hook-known `entities` group, so
 * id/x/y surface); overlapping it raises __GAME__.score by the bonus value exactly
 * once and the fruit LEAVES __GAME__.entities; if the window lapses untaken it
 * leaves on its own. It re-implements NOTHING the engine owns: the score seam is
 * the canonical addScore (registry 'score' → __GAME__.score + scoreChanged), the
 * dot-clear signal is the existing reward.collected bus event, the clock is the
 * scene clock (scene.time.now) so a paused/restarted level re-bases cleanly.
 *
 * IDEMPOTENT ACROSS RESPAWN (DR §6): each fruit carries a monotonically-rising id
 * (`<baseId>_<n>`) and a one-shot collected latch so a single fruit scores once;
 * a later threshold spawns a FRESH fruit that can score again — the latch is
 * per-fruit, never global, so respawn is safe. A threshold already crossed never
 * re-spawns (the high-water mark only advances).
 *
 * GENERIC: no game/theme, no baked count or coordinate. The fruit value, the spawn
 * cell, the bounded window, and the dot-count thresholds are level DATA via params.
 * A level that binds no thresholds is a clean no-op (the fruit never spawns).
 *
 * EVENTS (the PUSH channel) — each fires on the shared scene.eventBus at its true
 * seam:
 *   - fruit.spawned   ← spawnFruit (a threshold crossed)        payload {fruitId,value}
 *   - fruit.collected ← collect    (player overlap in-window)   payload {fruitId,value}
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible declared defaults):
 *   value       score awarded for the fruit, far above a dot (default 100).
 *   thresholds  cleared-dot counts that each spawn a fruit (default [70, 170] — the
 *               Pac-Man Dossier values). Each threshold spawns at most one fruit.
 *   windowMs    how long the fruit stays before auto-removing (default 9500 ≈ 9-10s).
 *   spawnCell   where the fruit appears: {col,row} grid cell (snapped via scene.__maze
 *               when a grid is present) OR {x,y} world px. Default: the maze centre,
 *               else the screen centre.
 *   fruitSlot   texture key for the fruit sprite (default '__px' placeholder).
 *   fruitKind   entity __kind tag for the fruit sprite (default 'bonus_fruit').
 *   size        fruit display size in px (default 28).
 *   baseId      id prefix for spawned fruit (default 'fruit'); the fruit id
 *               auto-derives at spawn as `<baseId>_<n>`.
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';
import { addScore } from '@contract/score';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'BonusFruit',
  intent:
    'The timed bonus collectible: count cleared dots (via reward.collected); when the count crosses a declared threshold spawn one high-value fruit at a declared cell for a bounded window; overlapping it adds its value to score exactly once and removes it, and it auto-removes if the window lapses. The maze-chase risk-reward detour.',
  attachesTo: 'scene',
  params: ['value', 'thresholds', 'windowMs', 'spawnCell', 'fruitSlot', 'fruitKind', 'size', 'baseId'],
  roles: ['player', 'collectible'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** A grid cell or a world point — the declared fruit spawn spot. */
export interface SpawnCell {
  col?: number;
  row?: number;
  x?: number;
  y?: number;
}

export interface BonusFruitConfig {
  value?: number;
  thresholds?: number[];
  windowMs?: number;
  spawnCell?: SpawnCell;
  fruitSlot?: string;
  fruitKind?: string;
  size?: number;
  baseId?: string;
}

export class BonusFruit implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly value: number;
  private readonly thresholds: number[];
  private readonly windowMs: number;
  private readonly spawnCell: SpawnCell | undefined;
  private readonly fruitSlot: string | undefined;
  private readonly fruitKind: string;
  private readonly size: number;
  private readonly baseId: string;

  /** Running count of cleared dots (fed by the reward.collected subscription). */
  private clearedDots = 0;
  /** Highest threshold already spawned — only advances, so each fires at most once. */
  private spawnedHighWater = -1;
  /** Monotonic spawn counter → the per-fruit id (idempotent latch is per-fruit). */
  private seq = 0;
  /** The live fruit on the board (null when none is present). */
  private fruit: LiveFruit | null = null;
  /** Unsubscribe handle for the reward.collected listener (cleared on reset). */
  private unsub: (() => void) | null = null;

  constructor(params: BonusFruitConfig = {}) {
    this.value = Math.max(1, Math.floor(params.value ?? 100));
    const t = Array.isArray(params.thresholds) ? params.thresholds : [70, 170];
    // Sort ascending + dedupe so the high-water gate fires each threshold once, in order.
    this.thresholds = [...new Set(t.map((n) => Math.max(1, Math.floor(n))))].sort((a, b) => a - b);
    this.windowMs = Math.max(1, Math.floor(params.windowMs ?? 9500));
    this.spawnCell = params.spawnCell;
    this.fruitSlot = params.fruitSlot;
    this.fruitKind = params.fruitKind ?? 'bonus_fruit';
    this.size = Math.max(8, Math.floor(params.size ?? 28));
    this.baseId = params.baseId ?? 'fruit';
  }

  /** Re-arm cleanly on a level restart: drop the fruit + every latch + the listener. */
  reset(): void {
    this.removeFruit();
    this.unsub?.();
    this.unsub = null;
    this.clearedDots = 0;
    this.spawnedHighWater = -1;
    this.seq = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    // Own a dedicated hook-known 'entities' group so a spawned fruit surfaces in
    // __GAME__.entities (id/x/y per child). Kept SEPARATE from the dot/reward set
    // (rewardsById / decorations) so CollectGoal never counts the fruit as a dot.
    if (!scene.entities || typeof scene.entities.getChildren !== 'function') {
      scene.entities = scene.physics.add.group();
    }
    // The SPAWN GATE: every dot/pellet pickup funnels through reward.collected, so
    // count those to know the cleared-dot total. Storing the unsubscribe keeps a
    // restart clean (reset() detaches before re-attaching).
    this.unsub = scene.eventBus?.on('reward.collected', () => this.notifyDotCleared()) ?? null;
  }

  /** Wire the player↔fruit pickup overlap (player exists by setupCollisions). */
  setupCollisions(): void {
    const scene = this.scene;
    const player = scene?.player;
    if (!player || !scene?.entities) return;
    scene.physics.add.overlap(player, scene.entities, (_p: any, sprite: any) => {
      // Only the live bonus fruit is collectible here — ignore any other entity.
      if (!this.fruit || sprite !== this.fruit.sprite) return;
      this.collect();
    });
  }

  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    // Auto-remove the fruit once its bounded window lapses untaken (no .emit here —
    // a lapse is not a player-facing collect; the entity simply leaves __GAME__).
    if (this.fruit && this.now() >= this.fruit.expiresAt) {
      this.removeFruit();
    }
  }

  // ── the spawn gate (driven by eating dots) ──────────────────────────────────

  /**
   * Record one cleared dot and spawn a fruit if the running count just crossed the
   * next un-fired threshold. PUBLIC so a unit test (or another system) can drive the
   * gate one dot at a time without a full board; the attach() subscription calls it
   * for every real reward.collected.
   */
  public notifyDotCleared(): void {
    this.clearedDots += 1;
    this.maybeSpawnForCount(this.clearedDots);
  }

  /** Spawn a fruit for the highest threshold this count has crossed but not yet fired. */
  private maybeSpawnForCount(count: number): void {
    for (const th of this.thresholds) {
      if (th > this.spawnedHighWater && count >= th) {
        this.spawnedHighWater = th;
        this.spawnFruit();
      }
    }
  }

  /**
   * Spawn ONE bonus fruit at the declared cell for the bounded window, and emit
   * fruit.spawned. PUBLIC — the clean unit seam: a test/Integrate can drive a spawn
   * directly (no need to feed 70 dots) and then drive the collect. A fruit already
   * on the board is replaced (one fruit at a time), so the seam is always safe.
   */
  public spawnFruit(): void {
    const scene = this.scene;
    if (!scene) return;
    if (this.fruit) this.removeFruit(); // never two fruit at once

    const { x, y } = this.resolveSpawnPoint();
    this.seq += 1;
    const fruitId = `${this.baseId}_${this.seq}`;

    const key = this.fruitSlot && scene.textures?.exists?.(this.fruitSlot) ? this.fruitSlot : '__px';
    const sprite = scene.physics.add.sprite(x, y, key) as any;
    if (typeof sprite.setDisplaySize === 'function') sprite.setDisplaySize(this.size, this.size);
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.setImmovable?.(true);
    }
    sprite.__id = fruitId;
    sprite.__type = 'collectible';
    sprite.__kind = this.fruitKind;
    scene.entities.add(sprite);

    this.fruit = { id: fruitId, sprite, expiresAt: this.now() + this.windowMs, collected: false };

    // fruit.spawned — a high-value fruit is now on the board at the declared cell.
    this.bus?.emit('fruit.spawned', { fruitId, value: this.value });
    scene.fireEffect?.('fruit.spawned', x, y);
  }

  // ── collect ─────────────────────────────────────────────────────────────────

  /**
   * Collect the live fruit: bump the score by the bonus value EXACTLY ONCE (the
   * per-fruit `collected` latch), remove it from __GAME__.entities, and emit
   * fruit.collected. Idempotent — a second overlap in the same frame is a no-op.
   */
  private collect(): void {
    const f = this.fruit;
    if (!f || f.collected) return;
    f.collected = true; // one-shot: score the bonus once, even on a double overlap

    // The canonical score seam: addScore sets registry 'score' (the single source
    // __GAME__.score reads) and emits scoreChanged for the HUD. No score logic re-invented.
    addScore(this.scene, this.value);

    const { x, y } = { x: f.sprite?.x ?? 0, y: f.sprite?.y ?? 0 };
    this.scene.fireEffect?.('fruit.collected', x, y);
    this.removeFruit();

    // fruit.collected — the player took the fruit in-window; score is already bumped.
    this.bus?.emit('fruit.collected', { fruitId: f.id, value: this.value });
  }

  // ── fruit lifecycle ──────────────────────────────────────────────────────────

  /** Remove the live fruit's sprite so it leaves __GAME__.entities (idempotent). */
  private removeFruit(): void {
    const f = this.fruit;
    if (!f) return;
    const sprite = f.sprite;
    if (sprite) {
      const body = sprite.body;
      if (body) body.enable = false;
      this.scene?.entities?.remove?.(sprite, false, false);
      sprite.destroy?.();
    }
    this.fruit = null;
  }

  /**
   * Resolve the declared spawn point to world px: a {col,row} grid cell snapped via
   * scene.__maze when present, an explicit {x,y}, else the maze/screen centre.
   */
  private resolveSpawnPoint(): { x: number; y: number } {
    const scene = this.scene;
    const cell = this.spawnCell;
    const grid = scene?.__maze;
    if (cell && typeof cell.col === 'number' && typeof cell.row === 'number' && grid?.cellCenter) {
      const c = grid.cellCenter(cell.col, cell.row);
      return { x: c.x, y: c.y };
    }
    if (cell && typeof cell.x === 'number' && typeof cell.y === 'number') {
      return { x: cell.x, y: cell.y };
    }
    const W = scene?.mapWidth ?? scene?.scale?.width ?? 432;
    const H = scene?.mapHeight ?? scene?.scale?.height ?? 768;
    return { x: W / 2, y: H / 2 };
  }

  /** The scene clock now (ms); 0-safe before attach. */
  private now(): number {
    return this.scene?.time?.now ?? 0;
  }

  // ── component surface (the declared PUSH-channel events this system emits) ──

  /**
   * The uniform component surface. Declares the two bonus-fruit moments this system
   * emits on the shared bus — each a TRUE statement about a real emit site in this
   * file:
   *   - fruit.spawned   ← spawnFruit (a cleared-dot threshold crossed)
   *   - fruit.collected ← collect    (player overlap before the window lapses)
   * Observables stay on the existing __GAME__ entities adapter (the fruit sprite is
   * tagged into the hook-known `entities` group), so this surface declares only the
   * PUSH channel + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'fruit.spawned',
          payload: '{fruitId,value}',
          scope: 'archetype',
          drivenBy: 'the cleared-dot count crosses a declared threshold',
          expect:
            'a high-value fruit entity appears at the declared cell in __GAME__.entities for the bounded window; fruit.spawned logged',
        },
        {
          name: 'fruit.collected',
          payload: '{fruitId,value}',
          scope: 'archetype',
          drivenBy: 'the player overlaps the fruit before its window lapses',
          expect:
            '__GAME__.score increases by the bonus value exactly once and the fruit leaves __GAME__.entities; fruit.collected logged',
        },
      ],
    };
  }
}

/** A live bonus fruit on the board (the sprite + its id + window + one-shot latch). */
interface LiveFruit {
  id: string;
  sprite: any;
  /** ms (scene clock) the fruit auto-removes if untaken. */
  expiresAt: number;
  /** One-shot: true once collected, so the score bumps exactly once. */
  collected: boolean;
}
