/**
 * ============================================================================
 * MagnetPickup — a timed coin-magnet power-up (BUILD — system)
 * ============================================================================
 *
 * The endless-runner power-up layer: streams a rare MAGNET pickup through the auto-scroll
 * world (one icon at a seeded long cadence, drawn at a reachable vertical band), advances
 * it LEFT at the world scroll each frame, and CULLS it past the left edge. When the
 * fixed-x avatar OVERLAPS the magnet it is COLLECTED → a timed MAGNET WINDOW opens: for
 * `durationMs` every live coin in the world is DRAWN toward the avatar (each coin's sprite
 * is moved a `pullSpeed` step along the vector to the avatar every frame), so a magnet
 * sweeps a whole field of coins into the player instead of forcing a precise thread.
 *
 * It does NOT own the coins — it borrows the live coin pool the reward system (CoinLinePickup)
 * already spawns on `scene.coins`, exactly as DifficultyRamp borrows the live scroller via
 * `scene.systems`. While the window is active it nudges each of those coins toward the
 * avatar; CoinLinePickup's own overlap handler then COLLECTS them as they arrive (one true
 * collection path — this system never double-scores). When the timer elapses the window
 * closes and coins resume their normal leftward drift.
 *
 * THE MECHANIC (no baked coordinate — every number is a DECLARED default, re-tunable):
 *   - SPAWN: one magnet icon enters from the right every `spawnEveryPx` of scroll, at a
 *     SEEDED center y in a reachable [margin, floor−margin] band (utils.SeededRandom — never
 *     Math.random(), so the layout is deterministic / replayable). It drifts left at
 *     `scrollSpeed` and is culled past the left edge (bounded memory — no leak).
 *   - ACTIVATE: avatar↔magnet overlap consumes the icon and sets `magnetUntilFrame` =
 *     now + duration. A re-collect while active REFRESHES the window (extends, never stacks).
 *   - PULL: while active, every live coin on scene.coins is moved toward the avatar by up to
 *     `pullSpeed * dt` px each frame (capped at the remaining distance so it never overshoots).
 *     The active window + the live remaining time are published on scene.magnet (a single
 *     diagnostics source) and surfaced as the `magnetActive` / `magnetMsLeft` observables.
 *
 * OBSERVABLE (the contract): collecting a magnet flips scene.magnet.active true with a live
 * countdown (magnetMsLeft) AND, for that window, coins in __GAME__.entities visibly converge
 * on __GAME__.player (their x/y move toward the avatar each frame) — the timed draw-in. The
 * window auto-closes when the timer elapses.
 *
 * IDENTITY (id source): the magnet.activated payload's `durationMs` is a CONFIG param
 * (CAPABILITY.params.magnetDurationMs, default below) — the timed-window length is the
 * component's declared identity per the standard's ID-SOURCE convention (idSource: config
 * magnet duration). The pickup's own `id` is auto-derived from a monotonic counter at spawn.
 *
 * INV-RESET: reset() destroys any standing magnet icon, clears the active window + the
 * spawn cursor + the PRNG, so a restarted run re-arms byte-identically (no leaked icon, no
 * carried-over magnet window).
 *
 * GENERIC: no game/theme, no baked coordinate. If no coin system is present the window still
 * opens cleanly (it simply has no coins to pull) — a clean no-op, never a crash.
 */
import type { ISceneSystem } from '../scenes/runner-data';
import { SeededRandom } from '../utils';
import { type EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'MagnetPickup',
  intent:
    'A timed coin-magnet power-up: streams a rare magnet icon through the auto-scroll world; when the fixed-x avatar collects it a timed window opens during which every live coin is drawn toward the avatar each frame (the reward system then collects them as they arrive). Spawns/moves/culls its own icon and borrows the live coin pool — never double-scores. The endless-runner power-up layer.',
  attachesTo: 'scene',
  params: [
    'scrollSpeed',
    'spawnEveryPx',
    'magnetDurationMs',
    'pullSpeed',
    'pullRange',
    'iconSize',
    'centerMargin',
    'seed',
    'assetSlot',
    'floorY',
  ],
  tuning: ['spawnEveryPx', 'magnetDurationMs', 'pullSpeed', 'pullRange'],
  roles: ['player', 'coin', 'magnet'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** Per-game tuning for the magnet power-up (every field DECLARED with a sensible default). */
export interface MagnetPickupConfig {
  /** Scroll speed (px/s) the magnet icon drifts left — matched to the world scroll. Default 150. */
  scrollSpeed?: number;
  /** Horizontal spacing (px) between successive magnet spawns (rare). Default 1600. */
  spawnEveryPx?: number;
  /** How long (ms) the magnet window stays active after collection. Default 5000. */
  magnetDurationMs?: number;
  /** How fast (px/s) a coin is drawn toward the avatar while the window is active. Default 520. */
  pullSpeed?: number;
  /** Only coins within this distance (px) of the avatar are pulled (0 ⇒ all coins). Default 0. */
  pullRange?: number;
  /** Magnet icon display diameter (px) — also the AABB collision box size. Default 30. */
  iconSize?: number;
  /** Margin (px) the icon keeps from the ceiling and floor (reachable band). Default 90. */
  centerMargin?: number;
  /** The deterministic PRNG seed for the spawn layout (INV-DETERMINISTIC). Default 11. */
  seed?: number;
  /** asset/texture key for the magnet body (falls back to a placeholder). */
  assetSlot?: string;
  /** The floor y the reachable band stops above (0 ⇒ derive from the live map height). Default 0. */
  floorY?: number;
}

/** Declared defaults (the runner magnet-power-up feel). Re-tuned per game via params. */
const DEF = {
  scrollSpeed: 150,
  spawnEveryPx: 1600,
  magnetDurationMs: 5000,
  pullSpeed: 520,
  pullRange: 0, // 0 ⇒ pull every live coin (whole-field magnet).
  iconSize: 30,
  centerMargin: 90,
  seed: 11,
  floorY: 0, // 0 ⇒ derive from the live map height in attach().
};

/** One live magnet icon: the sprite + its consumed latch + its auto-derived id. */
interface MagnetIcon {
  id: string;
  sprite: any;
  /** Whether this icon has already been collected (one icon activates exactly once). */
  consumed: boolean;
}

export class MagnetPickup implements ISceneSystem {
  private scene: any;
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly cfg: Required<Omit<MagnetPickupConfig, 'assetSlot'>> & { assetSlot?: string };
  private rng: SeededRandom;

  /** Live magnet icons drifting left (usually 0–1; bounded). */
  private icons: MagnetIcon[] = [];
  /** Distance scrolled since the last icon spawn (px). */
  private sinceSpawn = 0;
  /** Monotonic icon counter — mints each icon's auto-derived id. */
  private spawnCount = 0;
  /** Frame the active magnet window ends on (≤ current frame ⇒ inactive). */
  private magnetUntilFrame = 0;
  /** A monotonic frame counter (the magnet timer runs on it; deterministic). */
  private frame = 0;
  /** How many times this run has activated a magnet (for the activated payload). */
  private activations = 0;
  private floorY = 0;

  constructor(params: MagnetPickupConfig = {}) {
    this.cfg = {
      scrollSpeed: params.scrollSpeed ?? DEF.scrollSpeed,
      spawnEveryPx: params.spawnEveryPx ?? DEF.spawnEveryPx,
      magnetDurationMs: params.magnetDurationMs ?? DEF.magnetDurationMs,
      pullSpeed: params.pullSpeed ?? DEF.pullSpeed,
      pullRange: params.pullRange ?? DEF.pullRange,
      iconSize: params.iconSize ?? DEF.iconSize,
      centerMargin: params.centerMargin ?? DEF.centerMargin,
      seed: params.seed ?? DEF.seed,
      floorY: params.floorY ?? DEF.floorY,
      assetSlot: params.assetSlot,
    };
    this.rng = new SeededRandom(this.cfg.seed);
  }

  reset(): void {
    // Destroy any standing icon + clear the active window so a restart re-arms identically.
    for (const m of this.icons) m.sprite?.destroy?.();
    this.icons = [];
    this.sinceSpawn = 0;
    this.spawnCount = 0;
    this.magnetUntilFrame = 0;
    this.frame = 0;
    this.activations = 0;
    this.rng.reset(); // INV-DETERMINISTIC + INV-RESET: same layout after restart.
    if (this.scene) this.publishState();
  }

  attach(scene: any): void {
    this.scene = scene;
    this.magnetUntilFrame = 0;
    this.frame = 0;
    this.activations = 0;
    this.floorY = this.cfg.floorY > 0 ? this.cfg.floorY : this.worldHeight() - 24;
    // Own the magnets group — the hook surfaces it in __GAME__.entities.
    if (!scene.magnets || typeof scene.magnets.getChildren !== 'function') {
      scene.magnets = scene.physics.add.group();
    }
    // Stagger the first magnet so it does not arrive at the very start of the run.
    this.sinceSpawn = 0;
    this.publishState();
  }

  /** Wire avatar↔magnet overlap → activate the timed window. */
  setupCollisions(): void {
    const scene = this.scene;
    const avatar = scene?.player;
    if (!avatar || !scene?.magnets) return;
    scene.physics.add.overlap(avatar, scene.magnets, (a: any, iconSprite: any) => {
      if (a.isDead) return;
      if (!iconSprite || iconSprite.active === false) return;
      this.activate(iconSprite);
    });
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    this.frame += 1;
    const dt = 1 / 60;
    const dx = this.cfg.scrollSpeed * dt;

    // Advance every live icon left, then cull anything past the edge (bounded memory).
    for (const m of this.icons) m.sprite.x -= dx;
    const kept: MagnetIcon[] = [];
    for (const m of this.icons) {
      if (m.sprite.x + this.cfg.iconSize < -8) m.sprite.destroy();
      else kept.push(m);
    }
    this.icons = kept;

    // Spawn a new icon on the (rare) distance cadence.
    this.sinceSpawn += dx;
    if (this.sinceSpawn >= this.cfg.spawnEveryPx) {
      this.sinceSpawn -= this.cfg.spawnEveryPx;
      this.spawnIcon();
    }

    // While the window is active, draw the live coins toward the avatar.
    if (this.isActive()) this.pullCoins(dt);
    this.publishState();
  }

  // ── the timed magnet window ───────────────────────────────────────────────────

  /** True while the magnet window is open (the live countdown is positive). */
  private isActive(): boolean {
    return this.frame < this.magnetUntilFrame;
  }

  /** Milliseconds left on the active window (0 when closed) — the live countdown. */
  private msLeft(): number {
    const framesLeft = Math.max(0, this.magnetUntilFrame - this.frame);
    return Math.round((framesLeft / 60) * 1000);
  }

  /** Consume the icon and open (or refresh) the timed magnet window. */
  private activate(iconSprite: any): void {
    const scene = this.scene;
    const icon = this.icons.find((m) => m.sprite === iconSprite);
    if (!icon || icon.consumed) return;
    icon.consumed = true;

    // Open the window: now + duration (refreshes if re-collected while active).
    const durationFrames = Math.max(1, Math.round((this.cfg.magnetDurationMs / 1000) * 60));
    this.magnetUntilFrame = this.frame + durationFrames;
    this.activations += 1;

    // Despawn the consumed icon immediately (no lingering sprite) + drop it from the pool.
    icon.sprite?.destroy?.();
    this.icons = this.icons.filter((m) => m !== icon);
    this.publishState();

    // The PUSH seam: the avatar collected a magnet — the timed window is now active and
    // coins begin drawing in. Lean, JSON-serializable payload (primitives only).
    this.bus?.emit('magnet.activated', {
      id: icon.id,
      durationMs: this.cfg.magnetDurationMs,
      activations: this.activations,
    });
  }

  /**
   * Draw every live coin toward the avatar by up to pullSpeed*dt this frame. Borrows the
   * coin pool the reward system owns (scene.coins) — exactly as DifficultyRamp borrows the
   * live scroller. CoinLinePickup's own overlap handler then collects them as they arrive,
   * so this system never scores (one true collection path).
   */
  private pullCoins(dt: number): void {
    const scene = this.scene;
    const avatar = scene.player;
    if (!avatar) return;
    const coins = this.liveCoinSprites();
    if (coins.length === 0) return;
    const step = this.cfg.pullSpeed * dt;
    const range = this.cfg.pullRange;

    for (const sprite of coins) {
      if (!sprite || sprite.active === false) continue;
      const ddx = avatar.x - sprite.x;
      const ddy = avatar.y - sprite.y;
      const dist = Math.hypot(ddx, ddy);
      if (dist < 0.001) continue;
      if (range > 0 && dist > range) continue; // out of magnet range → untouched.
      // Move the coin toward the avatar, capped at the remaining distance (no overshoot).
      const move = Math.min(step, dist);
      sprite.x += (ddx / dist) * move;
      sprite.y += (ddy / dist) * move;
    }
  }

  /** The live coin sprites the reward system owns (defensive — empty if none present). */
  private liveCoinSprites(): any[] {
    const group = this.scene?.coins;
    if (group && typeof group.getChildren === 'function') {
      return group.getChildren().filter((s: any) => s && s.active !== false);
    }
    if (Array.isArray(group)) return group.map((c: any) => c?.sprite ?? c).filter(Boolean);
    return [];
  }

  // ── spawning ───────────────────────────────────────────────────────────────────

  /** Spawn ONE magnet icon just off the right edge at a SEEDED reachable center y. */
  private spawnIcon(): void {
    const scene = this.scene;
    const W = this.worldWidth();
    const margin = this.cfg.centerMargin;
    const minC = margin;
    const maxC = this.floorY - margin;
    const cy = maxC > minC ? this.rng.range(minC, maxC) : (minC + maxC) / 2;
    const cx = W + this.cfg.iconSize / 2 + 4;

    const slot = this.cfg.assetSlot;
    const key = slot && scene.textures.exists(slot) ? slot : '__px';
    const id = `magnet_${this.spawnCount}`;
    this.spawnCount += 1;
    const sprite = this.makeIcon(cx, cy, key, id);
    this.icons.push({ id, sprite, consumed: false });
  }

  /** Make one magnet body of the configured size, tagged for __GAME__.entities. */
  private makeIcon(cx: number, cy: number, key: string, id: string): any {
    const scene = this.scene;
    const size = this.cfg.iconSize;
    const sprite = scene.physics.add.sprite(cx, cy, key) as any;
    if (typeof sprite.setDisplaySize === 'function') sprite.setDisplaySize(size, size);
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.setImmovable?.(true);
      body.setSize?.(size / (sprite.scaleX || 1), size / (sprite.scaleY || 1), true);
    }
    sprite.__id = id;
    sprite.__type = 'magnet';
    scene.magnets.add(sprite);
    return sprite;
  }

  // ── diagnostics ──────────────────────────────────────────────────────────────

  /** Publish the live magnet window on scene.magnet (the single diagnostics source). */
  private publishState(): void {
    if (!this.scene) return;
    this.scene.magnet = {
      active: this.isActive(),
      msLeft: this.msLeft(),
      activations: this.activations,
    };
  }

  private worldWidth(): number {
    return this.scene?.mapWidth ?? this.scene?.scale?.width ?? 432;
  }
  private worldHeight(): number {
    return this.scene?.mapHeight ?? this.scene?.scale?.height ?? 768;
  }

  /**
   * The PUSH + PULL channels this system publishes (one true statement per real seam):
   *   - magnet.activated ← activate (the avatar collected a magnet icon) [archetype]
   *   - observable magnetActive ← whether the timed window is currently open
   *   - observable magnetMsLeft ← the live ms remaining on the active window
   */
  surface(): ComponentSurface {
    return {
      observables: {
        magnetActive: () => this.isActive(),
        magnetMsLeft: () => this.msLeft(),
      },
      anchors: [],
      events: [
        {
          name: 'magnet.activated',
          payload: '{id,durationMs,activations}',
          scope: 'archetype',
          drivenBy: 'the avatar overlapping a magnet power-up icon',
          expect:
            "__GAME__ magnet window becomes active (scene.magnet.active true with a positive msLeft countdown) and, for that window, live coins in __GAME__.entities move toward __GAME__.player each frame; magnet.activated logged",
        },
      ],
    };
  }
}
