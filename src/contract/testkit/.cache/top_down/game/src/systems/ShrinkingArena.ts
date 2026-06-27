/**
 * ShrinkingArena — the arena is the clock: each cleared wave closes the bounding
 * walls inward, so the safe footprint CONTRACTS as the crowd grows (system,
 * top_down; DR §12 H3 "the arena is the clock" spatial gimmick).
 *
 * The escalation pressure for a wave arena, as ONE scene-level system. It owns NO
 * win and SPAWNS no enemy — it reads the SAME wave-clear gate the arena already
 * uses (the live enemy set in scene.enemies emptying after having held enemies,
 * coordinating with a WaveSpawner's wave index when one is present) and, on each
 * cleared wave, steps an inscribed `arenaRadius` inward by a fixed fraction. The
 * radius is MONOTONIC (it only ever falls) and the reachable non-wall area STRICTLY
 * shrinks each step, so wave k+1 is fought in a smaller ring than wave k.
 *
 * The closing is REAL, not cosmetic:
 *   - scene.arenaRadius (a scalar) + scene.arenaBounds (the active inner rect
 *     {x,y,width,height}) are published on the scene each contraction — the
 *     observable footprint W4 / __GAME__ can read, monotonically falling;
 *   - the four bounding walls are drawn as a transient frame that snaps to the new
 *     inner rect, so the wall visibly closes;
 *   - the player is PUSHED by the closing wall: each frame it is clamped back inside
 *     the current inner rect (a player caught outside the new footprint when a wall
 *     closes is shoved to the boundary), so the contraction has teeth.
 *
 * It re-implements NOTHING the engine owns: the world size is scene.mapWidth/Height
 * (BaseGameScene); the wave-clear gate is the same enemy-set read KillAllGoal uses;
 * the bus is scene.eventBus (the shared EventBus). A board with no enemies that ever
 * appear simply never contracts (a clean no-op) — there is no baked count, theme, or
 * coordinate; center + radius are DERIVED from the live bounds.
 *
 * Observable transitions (__GAME__):
 *   a wave is cleared (enemies empties at the wave gate) → scene.arenaRadius
 *     decreases, scene.arenaBounds shrinks to a strictly smaller inner rect, the
 *     player is clamped inside it, and arena.contracted is logged.
 *
 * Params (all OPTIONAL — sensible declared defaults, never a baked game constant):
 *   step        fraction the radius shrinks per cleared wave (default 0.15 → each
 *               cleared wave removes 15% of the current radius; 0<step<1).
 *   minRadius   the floor the radius never falls below, as a fraction of the
 *               starting radius (default 0.25 — the arena stays playable).
 *   margin      px inset of the STARTING footprint from the world edge (default 8).
 *   wallColor   the closing-wall frame color (default 0x4455aa).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ShrinkingArena',
  intent:
    'The arena is the clock: on each cleared wave (the enemy set empties at the wave gate) step the bounding walls inward so the safe footprint contracts. Exposes scene.arenaRadius + scene.arenaBounds, monotonically falling — the reachable non-wall area strictly shrinks per wave — and pushes the player with the closing wall.',
  attachesTo: 'scene',
  params: ['step', 'minRadius', 'margin', 'wallColor'],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface ShrinkingArenaConfig {
  /** Fraction the radius shrinks per cleared wave (default 0.15). */
  step?: number;
  /** Radius floor as a fraction of the starting radius (default 0.25). */
  minRadius?: number;
  /** px inset of the STARTING footprint from the world edge (default 8). */
  margin?: number;
  /** Closing-wall frame color (default 0x4455aa). */
  wallColor?: number;
}

/** The active inner footprint, derived from the center + the current radius. */
export interface ArenaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class ShrinkingArena implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly step: number;
  private readonly minRadiusFrac: number;
  private readonly margin: number;
  private readonly wallColor: number;

  /** Arena center (DERIVED from the live world bounds at attach). */
  private cx = 0;
  private cy = 0;
  /** The full starting radius (half the smaller world span, less the margin). */
  private startRadius = 0;
  /** The current inscribed radius — monotonically FALLS, never rises. */
  private radius = 0;
  /** How many cleared waves have contracted the arena (the emitted `step`). */
  private contractions = 0;

  /** Did the world ever hold a live enemy since the last clear (so an empty set means CLEARED, not "never started"). */
  private everHadEnemy = false;
  /** The wave index last seen on a coordinating WaveSpawner (edge-detect a NEW wave to re-arm the gate). */
  private lastWaveIndex = 0;
  /** The transient wall-frame graphic (redrawn each contraction). */
  private wallGfx: any = null;

  constructor(params: ShrinkingArenaConfig = {}) {
    const s = params.step ?? 0.15;
    this.step = s > 0 && s < 1 ? s : 0.15;
    const mr = params.minRadius ?? 0.25;
    this.minRadiusFrac = mr > 0 && mr <= 1 ? mr : 0.25;
    this.margin = Math.max(0, params.margin ?? 8);
    this.wallColor = params.wallColor ?? 0x4455aa;
  }

  /** Re-arm cleanly on a level restart: clear every latch + reset the radius to full. */
  reset(): void {
    this.contractions = 0;
    this.radius = this.startRadius;
    this.everHadEnemy = false;
    this.lastWaveIndex = 0;
    this.wallGfx?.destroy?.();
    this.wallGfx = null;
  }

  attach(scene: any): void {
    this.scene = scene;
    // DERIVE the center + the starting radius from the live world span (no baked
    // coordinate). The inscribed radius is half the SMALLER span less the margin,
    // so the inner footprint is always a square that fits the arena.
    const W = scene.mapWidth || scene.scale?.width || 432;
    const H = scene.mapHeight || scene.scale?.height || 768;
    this.cx = W / 2;
    this.cy = H / 2;
    this.startRadius = Math.max(1, Math.min(W, H) / 2 - this.margin);
    this.radius = this.startRadius;
    // Publish the opening footprint so __GAME__ reads it from frame one.
    this.publishBounds();
  }

  /** No overlaps to wire — the wall closes by CLAMPING the player, not by a body. */
  setupCollisions(): void {}

  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;

    // 1. WAVE-CLEAR EDGE: detect the moment the live enemy set empties after having
    //    held enemies — the same gate KillAllGoal/WaveSpawner use. A coordinating
    //    WaveSpawner's advancing wave index re-arms the gate so EACH cleared wave
    //    contracts once (not just the first).
    const alive = this.aliveEnemyCount();
    const spawner = scene.__waveSpawner;
    const waveIndex = typeof scene.waveIndex === 'number' ? scene.waveIndex : 0;
    if (waveIndex > this.lastWaveIndex) {
      // A new wave was released → re-arm the cleared-gate for it.
      this.lastWaveIndex = waveIndex;
      this.everHadEnemy = false;
    }

    if (alive > 0) {
      this.everHadEnemy = true;
    } else if (this.everHadEnemy && !this.isExhausted(spawner)) {
      // This wave is CLEARED (held enemies, now empty) and the arena is not over →
      // close the walls inward for the next wave. Consume the gate so one clear =
      // one contraction.
      this.everHadEnemy = false;
      this.contract();
    }

    // 2. The closing wall has TEETH every frame: clamp the player back inside the
    //    current inner footprint (a player left outside a freshly-closed wall is
    //    pushed to the boundary).
    this.clampPlayer();
  }

  /**
   * Step the safe footprint inward by one wave: shrink the radius (monotone, floored
   * at minRadius * startRadius), redraw the closing-wall frame, republish the bound,
   * and EMIT arena.contracted at the true seam (the wave just cleared). The radius
   * STRICTLY falls until it reaches the floor, so the reachable area shrinks per wave.
   */
  private contract(): void {
    const floor = this.startRadius * this.minRadiusFrac;
    const next = Math.max(floor, this.radius * (1 - this.step));
    // Already at the floor → nothing closes; do not emit a no-op contraction.
    if (next >= this.radius - 1e-6) return;

    this.radius = next;
    this.contractions += 1;
    this.publishBounds();
    this.drawWalls();

    // arena.contracted — a wave was cleared and the bounding walls have closed inward.
    this.bus?.emit('arena.contracted', {
      arenaRadius: Math.round(this.radius),
      step: this.contractions,
    });
    this.scene.fireEffect?.('arena.contracted', this.cx, this.cy);
  }

  // ── footprint + walls ──────────────────────────────────────────────────────

  /** Publish the active footprint on the scene (the observable, monotonically falling). */
  private publishBounds(): void {
    const scene = this.scene;
    scene.arenaRadius = this.radius;
    scene.arenaBounds = this.currentBounds();
  }

  /** The current inner rect, derived from the center + the live radius. */
  private currentBounds(): ArenaBounds {
    const r = this.radius;
    return { x: this.cx - r, y: this.cy - r, width: r * 2, height: r * 2 };
  }

  /**
   * Draw the four bounding walls as a frame snapped to the current inner rect, so the
   * wall VISIBLY closes. Redrawn each contraction (cosmetic — the clamp is the
   * mechanic; absent a graphics factory this is a clean no-op).
   */
  private drawWalls(): void {
    const scene = this.scene;
    const b = this.currentBounds();
    if (!this.wallGfx && scene.add?.graphics) {
      this.wallGfx = scene.add.graphics();
      this.wallGfx.setDepth?.(900);
    }
    const g = this.wallGfx;
    if (!g) return;
    g.clear?.();
    g.lineStyle?.(6, this.wallColor, 1);
    g.strokeRect?.(b.x, b.y, b.width, b.height);
  }

  /**
   * Push the player with the closing wall: clamp its position to the current inner
   * footprint each frame. A player caught outside a freshly-closed wall is shoved to
   * the boundary (and its velocity into the wall is zeroed so it doesn't fight it).
   */
  private clampPlayer(): void {
    const player = this.scene?.player;
    if (!player || player.active === false || player.isDead) return;
    const b = this.scene.arenaBounds as ArenaBounds | undefined;
    if (!b) return;
    const left = b.x;
    const right = b.x + b.width;
    const top = b.y;
    const bottom = b.y + b.height;

    if (player.x < left) {
      player.x = left;
      if (player.body && player.body.velocity?.x < 0) player.setVelocityX?.(0);
    } else if (player.x > right) {
      player.x = right;
      if (player.body && player.body.velocity?.x > 0) player.setVelocityX?.(0);
    }
    if (player.y < top) {
      player.y = top;
      if (player.body && player.body.velocity?.y < 0) player.setVelocityY?.(0);
    } else if (player.y > bottom) {
      player.y = bottom;
      if (player.body && player.body.velocity?.y > 0) player.setVelocityY?.(0);
    }
  }

  // ── small helpers ──────────────────────────────────────────────────────────

  /** True once a coordinating spawner reports no more waves (arena over → stop closing). */
  private isExhausted(spawner: any): boolean {
    return !!(spawner && typeof spawner.isExhausted === 'function' && spawner.isExhausted());
  }

  /** Count enemies that are active and not flagged dead (mirrors KillAllGoal/WaveSpawner). */
  private aliveEnemyCount(): number {
    const grp = this.scene?.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return 0;
    let n = 0;
    for (const e of grp.getChildren()) {
      if (e && e.active !== false && !e.isDead) n += 1;
    }
    return n;
  }

  // ── public drive seam (for Integrate wiring + a unit Test) ──────────────────

  /**
   * Force one contraction step — the clean unit seam to DRIVE the system without a
   * full game. This is the SAME contract path the wave-clear edge in update() takes,
   * so firing it asserts the real mechanic: arenaRadius falls, arenaBounds strictly
   * shrinks, and arena.contracted is emitted. Returns the new radius. A no-op once at
   * the floor (the radius is monotone). The driving VERB in-game is move (survive
   * into the next wave); this is the headless equivalent of clearing that wave.
   */
  public onWaveCleared(): number {
    this.contract();
    return this.radius;
  }

  /** The current inscribed radius (so a Test/diagnostic can assert it fell). */
  public get arenaRadius(): number {
    return this.radius;
  }

  // ── component surface (the declared PUSH-channel events this system emits) ──

  /**
   * The uniform component surface. Declares the one arena moment this system emits on
   * the shared bus — a TRUE statement about the real emit site in contract():
   *   - arena.contracted ← contract() (a wave cleared; the bounding walls closed
   *                                    inward; arenaRadius fell + arenaBounds shrank)
   * The footprint observables (arenaRadius / arenaBounds) flow via the scene-scalar
   * adapter onto __GAME__, so this surface declares the PUSH channel + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'arena.contracted',
          payload: '{arenaRadius,step}',
          scope: 'archetype',
          drivenBy: 'a wave is cleared (the enemy set empties at the wave gate while surviving into the next wave)',
          expect:
            'scene.arenaRadius decreases and scene.arenaBounds shrinks to a strictly smaller inner rect; the player is clamped inside the closed walls; arena.contracted logged',
        },
      ],
    };
  }
}
