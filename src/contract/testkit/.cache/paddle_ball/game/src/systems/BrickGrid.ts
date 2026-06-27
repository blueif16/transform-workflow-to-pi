/**
 * BrickGrid — the brick layer + the clear-all-bricks WIN (BUILD — system; RB §2.3, §2.5).
 *
 * The paddle_ball spatial substrate: every breakable/unbreakable brick of the level,
 * built PURELY from DATA (a compact BrickGridData expanded by the scene into bricks[],
 * plus any explicit bricks[]). It owns:
 *   - building one static brick sprite per cell, tagged for __GAME__.entities;
 *   - the exact ball↔brick collision SEAM the scene's sub-step loop calls
 *     (scene.brickGrid.hitBrickAt(ballAABB, vel)) — resolves the SHALLOW axis, decrements
 *     the brick's hp, clears it at 0, scores it, and emits `brick.cleared`;
 *   - the WIN: status->won once NO breakable brick remains (unbreakable cells excluded;
 *     RB §2.5 — never before the last breakable brick is gone).
 *
 * It re-implements NOTHING the engine owns: the ball motion + reflection live in the
 * scene's ball-physics sub-step loop; the win seam is scene.onLevelComplete(); the
 * score is the registry 'score'. GENERIC: no count, no coordinate is baked — which
 * bricks exist comes from the DATA.
 *
 * Params (all OPTIONAL — declared defaults, never a baked map):
 *   brickPoints   default score per cleared breakable brick (default 10).
 *   winEffectEvent event fired via scene.fireEffect on the win (default 'level.statusChanged').
 */
import type { ISceneSystem } from '../scenes/paddle-data';
import type { ComponentSurface, EventBus } from '@contract/component-surface';
import { aabb, resolveAABBBounce, type AABB, type Vec2 } from '../scenes/ball-physics';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors every system file). */
export const CAPABILITY = {
  kind: 'system',
  id: 'BrickGrid',
  intent:
    'Build the level brick layer from DATA, resolve the exact ball↔brick collision (shallow-axis bounce, decrement hp, clear at 0, score), and WIN (status->won) once every BREAKABLE brick is cleared — unbreakable cells reflect forever and are excluded from the win count. The brick-breaker spatial substrate + the clear-all win.',
  attachesTo: 'scene',
  params: ['brickPoints', 'winEffectEvent'],
  roles: ['ball', 'brick'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface BrickGridConfig {
  brickPoints?: number;
  winEffectEvent?: string;
}

/** One live brick the grid tracks (the sprite + its hp + flags). */
interface LiveBrick {
  sprite: any;
  box: AABB;
  hp: number;
  unbreakable: boolean;
  points: number;
}

export class BrickGrid implements ISceneSystem {
  private scene: any;
  private bricks: LiveBrick[] = [];
  private group: any = null;
  private won = false;
  private everHadBreakable = false;
  private readonly brickPoints: number;
  private readonly winEffectEvent: string;

  constructor(params: BrickGridConfig = {}) {
    this.brickPoints = params.brickPoints ?? 10;
    this.winEffectEvent = params.winEffectEvent ?? 'level.statusChanged';
  }

  /** The shared event bus (the scene owns it; attach() set this.scene). */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  /** Clear the built brick set so a restarted level rebuilds from data (replayable). */
  reset(): void {
    this.bricks = [];
    this.group = null;
    this.won = false;
    this.everHadBreakable = false;
  }

  /** Build every brick from DATA (the scene already expanded brickGrid -> bricks[]). */
  attach(scene: any): void {
    this.scene = scene;
    // Publish the read seam under the name the scene's ball loop looks up.
    scene.brickGrid = this;

    const data = scene.levelData?.bricks ?? [];
    this.group = scene.physics.add.staticGroup();
    for (const b of data) {
      const w = b.width ?? 48;
      const h = b.height ?? 20;
      const key = b.assetSlot && scene.textures?.exists?.(b.assetSlot) ? b.assetSlot : '__px';
      const sprite = scene.physics.add.staticSprite(b.x, b.y, key);
      sprite.setDisplaySize(w, h);
      if (key === '__px') sprite.setTint(b.unbreakable ? 0x8893a5 : 0xd9694a);
      sprite.refreshBody();
      sprite.__type = 'brick';
      sprite.__id = b.id ?? `brick_${Math.round(b.x)}_${Math.round(b.y)}`;
      sprite.__unbreakable = !!b.unbreakable;
      this.group.add(sprite);
      // Surface it in the scene's obstacles group so __GAME__.entities counts it.
      scene.obstacles?.add?.(sprite);
      const unbreakable = !!b.unbreakable;
      if (!unbreakable) this.everHadBreakable = true;
      this.bricks.push({
        sprite,
        box: aabb(b.x, b.y, w, h),
        hp: Math.max(1, b.hp ?? 1),
        unbreakable,
        points: b.points ?? this.brickPoints,
      });
    }
  }

  /** No Arcade overlap wiring — the scene's sub-step loop calls hitBrickAt() directly. */
  setupCollisions(): void {}

  /**
   * The PRIMARY collision seam the scene's ball sub-step loop calls at each sub-step:
   * if the ball AABB overlaps a brick, resolve the SHALLOW-axis bounce (mutating `vel`),
   * decrement that brick's hp, clear it at 0 (score + remove + emit `brick.cleared`),
   * and return TRUE (a hit happened this sub-step — at most one, so a fast ball can't
   * wipe a row in one frame; RB §2.3). Returns FALSE when the ball touched no brick.
   */
  hitBrickAt(ball: AABB, vel: Vec2): boolean {
    for (let i = 0; i < this.bricks.length; i += 1) {
      const lb = this.bricks[i];
      // overlap test (strict AABB)
      if (
        Math.abs(ball.cx - lb.box.cx) < ball.halfW + lb.box.halfW &&
        Math.abs(ball.cy - lb.box.cy) < ball.halfH + lb.box.halfH
      ) {
        resolveAABBBounce(ball, lb.box, vel); // flip the correct axis + push out
        if (lb.unbreakable) return true; // bounces forever, never clears
        lb.hp -= 1;
        if (lb.hp <= 0) this.clearBrick(i);
        return true; // at most one brick per sub-step
      }
    }
    return false;
  }

  /** Number of BREAKABLE bricks still standing (the win count; unbreakable excluded). */
  breakableRemaining(): number {
    let n = 0;
    for (const lb of this.bricks) if (!lb.unbreakable) n += 1;
    return n;
  }

  /** Total live bricks (breakable + unbreakable) — for diagnostics. */
  totalRemaining(): number {
    return this.bricks.length;
  }

  /** Per-frame: check the clear-all win (a system that owns the win drives it here). */
  update(): void {
    const scene = this.scene;
    if (!scene || this.won || scene.gameCompleted) return;
    if (!this.everHadBreakable) return; // a level with no breakable brick never "clears"
    if (this.breakableRemaining() === 0) this.win();
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** Clear brick i: score it, remove the sprite (count -1), emit `brick.cleared`. */
  private clearBrick(i: number): void {
    const lb = this.bricks[i];
    if (!lb) return;
    this.bricks.splice(i, 1);
    // score (the single source — the registry 'score') + the standardized PUSH-channel
    // score.changed event at the real score moment (the scene base declares it).
    const reg = this.scene?.registry;
    if (reg) {
      const next = Number(reg.get('score') ?? 0) + lb.points;
      reg.set('score', next);
      this.bus?.emit('score.changed', { score: next });
    }
    // cosmetic juice bound to the clear moment (no-op if the level bound none)
    this.scene?.fireEffect?.('brick.cleared', lb.box.cx, lb.box.cy);
    // remove from the live world → __GAME__.entities count -1
    this.group?.remove?.(lb.sprite, false, false);
    this.scene?.obstacles?.remove?.(lb.sprite, false, false);
    lb.sprite.destroy();
    // The true gameplay seam: a breakable brick left __GAME__ (bricksRemaining -1).
    this.bus?.emit('brick.cleared', {
      id: lb.sprite.__id,
      x: lb.box.cx,
      y: lb.box.cy,
    });
  }

  /** One-shot win. Idempotent (the engine gameCompleted guard backs it up). */
  private win(): void {
    const scene = this.scene;
    if (this.won || scene.gameCompleted) return;
    this.won = true;
    scene.gameCompleted = true;
    scene.fireEffect?.(this.winEffectEvent, scene.paddle?.x, scene.paddle?.y);
    scene.onLevelComplete();
  }

  // ── component surface (the declared PUSH-channel event set) ──────────────────

  /**
   * The event this layer publishes. `brick.cleared` is a TRUE statement about the real
   * emit site in clearBrick(): when the ball breaks a brick, the brick leaves __GAME__
   * (bricksRemaining -1) and the event is logged. The clear-all WIN flows through the
   * scene's `level.statusChanged` (BasePaddleScene), so this surface declares the
   * brick-level moment only.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'brick.cleared',
          payload: '{id,x,y}',
          scope: 'archetype',
          drivenBy: 'the ball overlaps a breakable brick and depletes its hp',
          expect:
            'the brick leaves __GAME__.entities (bricksRemaining -1); when the last breakable brick clears status becomes won; brick.cleared logged',
        },
      ],
    };
  }
}
