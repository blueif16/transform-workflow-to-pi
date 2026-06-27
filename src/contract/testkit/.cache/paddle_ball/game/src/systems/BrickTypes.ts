/**
 * BrickTypes — multi-hit + unbreakable brick semantics (BUILD — system; brick-breaker genre).
 *
 * The brick-breaker variety layer: not every brick dies in one hit. This system gives the
 * brick field two extra TYPES on top of the plain one-hit brick the base BrickGrid clears:
 *   - MULTI-HIT bricks (hp > 1) — a ball contact CRACKS the brick (its remaining hit-count
 *     drops by one) but does NOT destroy it; only the final hit clears it (the base
 *     BrickGrid already decrements hp + clears at 0). The crack is the missing MOMENT — the
 *     base layer is silent on a hit that doesn't clear, so this system owns `brick.cracked`.
 *   - UNBREAKABLE bricks (`unbreakable:true`) — they reflect the ball FOREVER and are
 *     EXCLUDED from the clear-all win count (the base BrickGrid already reflects + excludes
 *     them; this system simply never counts them as crackable, so a ball off an unbreakable
 *     brick fires nothing).
 *
 * THE OBSERVABLE __GAME__ TRANSITION (the contract): when a multi-hit brick is hit but
 * survives, that brick's remaining hit-count DECREASES while the brick STAYS in the world
 * (it is NOT removed from __GAME__.entities — that is what distinguishes a CRACK from a
 * CLEAR). This system tracks each multi-hit brick's remaining hits itself (seeded from the
 * same levelData.bricks the BrickGrid builds from) and publishes the live value via the
 * event payload (`hitsRemaining`) + the public hitsRemaining(id) read seam.
 *
 * WHY A COMPANION (not a replacement): the base genre always binds BrickGrid, which OWNS the
 * brick layer + the ball↔brick collision seam (`scene.brickGrid.hitBrickAt`) + the clear-all
 * win. This system re-implements NONE of that — it WRAPS that one seam: at each ball↔brick
 * contact it checks whether a tracked multi-hit brick survived the hit, and if so emits
 * `brick.cracked`. It composes with BrickGrid rather than colliding with the `scene.brickGrid`
 * ownership, so a level binds BOTH (BrickGrid + BrickTypes) and gets the variety for free.
 *
 * THE CRACK seam is the wrapped collision PLUS a public `crack(brickId?)` — the scene (a
 * level script, or the runtime `check-exposes` driver) calls `scene.brickTypes.crack()` to
 * deterministically crack a multi-hit brick (the lowest-hp tracked one, or a named id),
 * mirroring how PaddleGrow exposes `activate()`.
 *
 * It re-implements NOTHING the engine owns: the ball motion + reflection + hp decrement +
 * clear live in BrickGrid / the scene's sub-step loop; this system only OBSERVES the hit and
 * publishes the crack moment. GENERIC: no count, no coordinate is baked — which bricks are
 * multi-hit / unbreakable comes from the DATA.
 *
 * Params (all OPTIONAL — declared defaults, never a baked map):
 *   crackEffect  cosmetic effect event fired via scene.fireEffect on a crack (default 'brick.cracked').
 */
import type { ISceneSystem } from '../scenes/paddle-data';
import type { ComponentSurface, EventBus } from '@contract/component-surface';
import { aabb, type AABB, type Vec2 } from '../scenes/ball-physics';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors every system file). */
export const CAPABILITY = {
  kind: 'system',
  id: 'BrickTypes',
  intent:
    'Multi-hit + unbreakable brick semantics layered over the BrickGrid: a multi-hit brick (hp>1) CRACKS on a ball contact (its remaining hit-count drops by one) but is not destroyed until the final hit, while an unbreakable brick reflects forever and is excluded from the clear-all win count. Wraps the BrickGrid collision seam to publish the missing brick.cracked moment (the base layer is silent on a non-clearing hit); tracks each multi-hit brick`s remaining hits and exposes a crack() drive seam.',
  attachesTo: 'scene',
  params: ['crackEffect'],
  roles: ['ball', 'brick'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface BrickTypesConfig {
  /** cosmetic effect event fired via scene.fireEffect on a crack (default 'brick.cracked'). */
  crackEffect?: string;
}

/** One multi-hit brick this system tracks (its box + remaining hits; unbreakable excluded). */
interface TrackedBrick {
  id: string;
  box: AABB;
  hitsRemaining: number;
}

export class BrickTypes implements ISceneSystem {
  private scene: any;
  /** Multi-hit bricks only (hp>1, breakable). Unbreakable bricks are never tracked here. */
  private tracked: TrackedBrick[] = [];
  /** The original BrickGrid.hitBrickAt, captured so the wrapper can delegate to it. */
  private innerHit: ((ball: AABB, vel: Vec2) => boolean) | null = null;
  private readonly crackEffect: string;

  constructor(params: BrickTypesConfig = {}) {
    this.crackEffect = params.crackEffect ?? 'brick.cracked';
  }

  /** The shared event bus (the scene owns it; attach() set this.scene). */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  /** Re-arm to a fresh-level state so a restarted level re-tracks from data (replayable). */
  reset(): void {
    this.tracked = [];
    this.innerHit = null;
  }

  /**
   * Seed the multi-hit tracker from the SAME levelData the BrickGrid builds from, then WRAP
   * the BrickGrid collision seam so every ball↔brick contact passes through this system. The
   * wrapper delegates to the real seam (the base layer still bounces / decrements / clears),
   * then checks whether a tracked multi-hit brick survived the hit → a CRACK.
   */
  attach(scene: any): void {
    this.scene = scene;
    // Publish the drive/read seam under a stable name (scene.brickTypes.crack(), .hitsRemaining()).
    scene.brickTypes = this;

    // Seed: a multi-hit brick is a breakable brick with hp>1; unbreakable bricks never crack.
    const data = scene.levelData?.bricks ?? [];
    for (const b of data) {
      if (b.unbreakable) continue;
      const hp = Math.max(1, b.hp ?? 1);
      if (hp <= 1) continue; // one-hit bricks clear straight away — no crack moment
      const w = b.width ?? 48;
      const h = b.height ?? 20;
      this.tracked.push({
        id: b.id ?? `brick_${Math.round(b.x)}_${Math.round(b.y)}`,
        box: aabb(b.x, b.y, w, h),
        hitsRemaining: hp,
      });
    }

    // Wrap the BrickGrid seam (the scene's ball loop + MultiBall both call scene.brickGrid.hitBrickAt).
    const grid = scene.brickGrid;
    if (grid && typeof grid.hitBrickAt === 'function' && !grid.__brickTypesWrapped) {
      this.innerHit = grid.hitBrickAt.bind(grid);
      const self = this;
      grid.hitBrickAt = function wrappedHitBrickAt(ball: AABB, vel: Vec2): boolean {
        // Which tracked multi-hit brick (if any) is the ball overlapping AT the moment of
        // contact — captured BEFORE the inner seam mutates the ball position / clears it.
        const candidate = self.findOverlapping(ball);
        const hit = self.innerHit ? self.innerHit(ball, vel) : false;
        if (hit && candidate) self.onMultiHit(candidate);
        return hit;
      };
      grid.__brickTypesWrapped = true;
    }
  }

  /** No Arcade overlap wiring — the crack arrives through the wrapped BrickGrid seam / crack(). */
  setupCollisions(): void {}

  /** No per-frame work — cracks are event-driven (the wrapped collision seam + crack()). */
  update(): void {}

  /**
   * The PUBLIC crack seam: deterministically CRACK a multi-hit brick — a named `brickId`, or
   * (default) the tracked brick CLOSEST to being cleared (lowest hitsRemaining > 1) so a
   * crack always leaves the brick alive. Returns the brick's remaining hits after the crack,
   * or -1 when there is no crackable multi-hit brick. Safe to call from a level script or the
   * runtime `check-exposes` driver (mirrors PaddleGrow.activate()).
   */
  crack(brickId?: string): number {
    const tb = brickId
      ? this.tracked.find((t) => t.id === brickId && t.hitsRemaining > 1)
      : this.lowestCrackable();
    if (!tb) return -1;
    return this.onMultiHit(tb);
  }

  /** Remaining hits a tracked multi-hit brick has left (Infinity-safe; -1 when not tracked). */
  hitsRemaining(brickId: string): number {
    return this.tracked.find((t) => t.id === brickId)?.hitsRemaining ?? -1;
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /**
   * Apply one hit to a tracked multi-hit brick: decrement its remaining hits. When it
   * SURVIVES (hitsRemaining still > 0) it CRACKED — emit `brick.cracked` with the new
   * hit-count (the observable transition: the brick's hit-count decreased, the brick stays
   * in the world). When it reaches 0 it has fully cleared (the base BrickGrid removes it +
   * emits brick.cleared), so stop tracking it — no crack on the clearing hit. Returns the
   * remaining hits after this hit.
   */
  private onMultiHit(tb: TrackedBrick): number {
    tb.hitsRemaining -= 1;
    if (tb.hitsRemaining <= 0) {
      // fully cleared on this hit — BrickGrid owns the clear + brick.cleared; drop tracking.
      this.tracked = this.tracked.filter((t) => t !== tb);
      return 0;
    }
    // cosmetic juice bound to the crack moment (no-op if the level bound none).
    this.scene?.fireEffect?.(this.crackEffect, tb.box.cx, tb.box.cy);
    // The true gameplay seam: a multi-hit brick was hit but NOT destroyed — its remaining
    // hit-count just dropped while the brick stays in __GAME__.entities (crack, not clear).
    this.bus?.emit('brick.cracked', {
      id: tb.id,
      x: tb.box.cx,
      y: tb.box.cy,
      hitsRemaining: tb.hitsRemaining,
    });
    return tb.hitsRemaining;
  }

  /** The tracked multi-hit brick the ball AABB overlaps right now (the one about to be hit). */
  private findOverlapping(ball: AABB): TrackedBrick | null {
    for (const t of this.tracked) {
      if (
        Math.abs(ball.cx - t.box.cx) < ball.halfW + t.box.halfW &&
        Math.abs(ball.cy - t.box.cy) < ball.halfH + t.box.halfH
      ) {
        return t;
      }
    }
    return null;
  }

  /** The tracked multi-hit brick closest to clearing (lowest hits > 1), for a deterministic crack. */
  private lowestCrackable(): TrackedBrick | null {
    let best: TrackedBrick | null = null;
    for (const t of this.tracked) {
      if (t.hitsRemaining <= 1) continue; // a crack must leave it alive (>1 → >0 after)
      if (!best || t.hitsRemaining < best.hitsRemaining) best = t;
    }
    return best;
  }

  // ── component surface (the declared PUSH-channel event set) ──────────────────

  /**
   * The event this system publishes. `brick.cracked` is a TRUE statement about the real
   * emit site in onMultiHit(): when a multi-hit brick is hit but survives, its remaining
   * hit-count decreases (the brick stays in __GAME__.entities — a crack, not a clear) and
   * the event is logged. The CLEAR moment (final hit) flows through BrickGrid's
   * `brick.cleared`; unbreakable bricks fire nothing (they never crack).
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'brick.cracked',
          payload: '{id,x,y,hitsRemaining}',
          scope: 'archetype',
          drivenBy: 'a multi-hit brick (hp>1) is hit by the ball but not destroyed (scene.brickTypes.crack() also drives it)',
          expect:
            'that brick`s remaining hit-count decreases by one while the brick STAYS in __GAME__.entities (a crack, not a clear); brick.cracked logged',
        },
      ],
    };
  }
}
