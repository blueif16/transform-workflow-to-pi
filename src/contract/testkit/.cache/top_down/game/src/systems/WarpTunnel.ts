/**
 * WarpTunnel — the toroidal SIDE warp + ghost-slow escape valve for a maze-chase
 * board (BUILD — system; top_down:maze-chase). A focused, PAIRED-tunnel sibling of
 * ScreenWrapSystem (not a full torus): the Pac-Man side tunnels (GameFAQs Pac-Man
 * guide — ghosts crawl in the tunnels; the player uses them to escape), DR §10
 * "leave a route" as a verb.
 *
 * TWO coupled mechanics, both driven by the MOVE verb (a body crossing a declared
 * edge region):
 *
 *  1. PAIRED WARP. The board declares tunnel REGION PAIRS (params.tunnels[]). When a
 *     body's CENTER enters one tunnel region, it teleports to the PAIRED tunnel's
 *     MOUTH (the cell just inside the far side) — player.x/player.y (or the entity's
 *     entities[] position) JUMPS across the board. A per-entity latch prevents an
 *     immediate re-warp back: once warped, the body must LEAVE both regions before it
 *     can warp again, so a body sitting on the destination mouth does not ping-pong.
 *
 *  2. GHOST SLOW. A ghost (a GhostTarget enemy) whose center is INSIDE any tunnel
 *     region has its GhostTarget `speed` multiplied by `ghostSlowFactor` (< 1) — its
 *     measured Δposition/frame (vx/vy in __GAME__.entities) DROPS while in the tunnel
 *     and is RESTORED to its base speed the moment it leaves. This is the escape
 *     valve: the player keeps full speed through the side tunnel, the chasing ghost
 *     crawls. We mutate the SAME GhostTarget the maze hunt already drives (we only
 *     scale its public `speed`), so nothing the engine owns is re-implemented.
 *
 * Observable transitions (__GAME__):
 *   a body crosses a tunnel edge → player.x/player.y (or its entities[] x|y) jumps to
 *     the paired mouth; entity.warped logged with {id, fromTunnel, toTunnel}.
 *   a ghost enters a tunnel region → its measured speed in __GAME__.entities falls to
 *     ghostSlowFactor× its base; on exit it returns to base.
 *
 * The id in the payload is AUTO-DERIVED from the crossing entity (mirrors
 * core/hook.ts entityId: __id ?? entityId ?? name, and 'player' for the player) —
 * never a config param. The tunnel-pair geometry + the slow factor ARE config params
 * (params.tunnels[], params.ghostSlowFactor).
 *
 * It owns NO win and NO score; it only repositions sprites and scales ghost speed. A
 * board that declares no tunnels (or has no maze ghost) is a clean no-op.
 *
 * Params (all OPTIONAL — sensible declared defaults, no baked game/theme/coordinate):
 *   tunnels   the declared tunnel REGION PAIRS. Each pair is two regions {a, b}; each
 *             region is an AABB {x, y, w, h} (TOP-LEFT corner + size, world px) with a
 *             MOUTH {mouthX, mouthY} (the world point a body warps TO when it crosses
 *             the PAIRED region). Default [] → no warp (clean no-op).
 *   ghostSlowFactor  the speed multiplier applied to a GhostTarget while its owner is
 *             inside any tunnel region (default 0.5 — the canonical "half speed in the
 *             tunnel"). Clamped to (0, 1]; a value >= 1 disables the slow.
 *   groups    the live enemy/sprite group names whose members also warp + (for ghosts)
 *             slow, beyond the player (default ['enemies']). The player always warps.
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** A single tunnel region: an AABB (top-left + size, world px) with the paired mouth. */
export interface TunnelRegion {
  /** Top-left X of the trigger AABB (world px). */
  x: number;
  /** Top-left Y of the trigger AABB (world px). */
  y: number;
  /** Trigger AABB width (world px). */
  w: number;
  /** Trigger AABB height (world px). */
  h: number;
  /**
   * World X of THIS region's exit mouth — where a body LANDS when it emerges here
   * (i.e. after crossing the PAIRED region). Crossing region a deposits the body at
   * b.mouth; crossing b deposits it at a.mouth.
   */
  mouthX: number;
  /** World Y of THIS region's exit mouth (see mouthX). */
  mouthY: number;
}

/** A paired tunnel: crossing region `a` warps to `b.mouth`, and vice versa. */
export interface TunnelPair {
  a: TunnelRegion;
  b: TunnelRegion;
}

export interface WarpTunnelConfig {
  /** The declared tunnel region PAIRS (default [] → no warp). */
  tunnels?: TunnelPair[];
  /** Speed multiplier for a ghost inside a tunnel region (default 0.5; clamped to (0,1]). */
  ghostSlowFactor?: number;
  /** Live group names that also warp/slow beyond the player (default ['enemies']). */
  groups?: string[];
}

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'WarpTunnel',
  intent:
    'The toroidal side warp + ghost slow for a maze-chase board: a body crossing a declared edge-tunnel region teleports to the paired tunnel mouth (player.x/player.y jumps across the board); a ghost inside a tunnel region crawls at a fraction of its speed (the escape valve). A focused paired-tunnel sibling of ScreenWrapSystem; emits entity.warped at the crossing seam.',
  attachesTo: 'scene',
  params: ['tunnels', 'ghostSlowFactor', 'groups'],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** The default group set that warps/slows beyond the always-warped player. */
const DEFAULT_GROUPS = ['enemies'] as const;

/** Per-sprite slow record: the GhostTarget behavior + its captured BASE speed. */
interface SlowRecord {
  behavior: any;
  baseSpeed: number;
  slowed: boolean;
}

export class WarpTunnel implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly tunnels: TunnelPair[];
  private readonly slowFactor: number;
  private readonly groups: string[];

  /**
   * Per-entity warp latch: the index of the tunnel-region a body was LAST warped FROM
   * (encoded `pairIndex*2 + side`), held until the body leaves BOTH regions of that
   * pair — so a body landing on the destination mouth does not immediately warp back.
   */
  private readonly warpLatch = new Map<any, number>();
  /** Per-ghost slow state, keyed by the owner sprite (base speed + slowed flag). */
  private readonly slowState = new Map<any, SlowRecord>();

  constructor(params: WarpTunnelConfig = {}) {
    this.tunnels = Array.isArray(params.tunnels) ? params.tunnels.filter(isPair) : [];
    const f = Number(params.ghostSlowFactor);
    // Clamp to (0,1]: <=0 would freeze a ghost (not the contract); >1 disables the slow.
    this.slowFactor = Number.isFinite(f) && f > 0 ? Math.min(1, f) : 0.5;
    this.groups =
      Array.isArray(params.groups) && params.groups.length > 0
        ? params.groups.slice()
        : [...DEFAULT_GROUPS];
  }

  /** Re-arm cleanly on a level restart: drop every latch + restore each slowed ghost. */
  reset(): void {
    for (const [, rec] of this.slowState) {
      if (rec.slowed && rec.behavior) rec.behavior.speed = rec.baseSpeed;
    }
    this.warpLatch.clear();
    this.slowState.clear();
  }

  attach(scene: any): void {
    this.scene = scene;
  }

  /** No overlaps to wire — the warp + slow are recomputed from live positions each tick. */
  setupCollisions(): void {}

  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    if (this.tunnels.length === 0) return; // no tunnels declared → clean no-op

    // The player ALWAYS warps (surfaces as __GAME__.player.x|y).
    this.processSprite(scene.player, 'player');
    // Every member of the live groups also warps; ghosts among them also slow.
    for (const sprite of this.groupSprites()) {
      this.processSprite(sprite, this.entityIdOf(sprite));
    }
  }

  // ── the per-sprite warp + slow (driven by the MOVE verb each tick) ───────────

  /**
   * Apply BOTH mechanics to one sprite for this tick:
   *   1. if it has moved out of its warp latch's pair, clear the latch (re-armable);
   *   2. if its CENTER is now in a tunnel region it is NOT latched on, WARP it to the
   *      paired mouth and emit entity.warped (the true crossing seam);
   *   3. (ghosts only) scale GhostTarget.speed by slowFactor while inside ANY region,
   *      restoring the base speed on exit — the measured vx/vy drop is the escape valve.
   */
  private processSprite(sprite: any, id: string): void {
    if (!sprite || sprite.active === false) return;

    const region = this.regionAt(sprite.x, sprite.y); // {pairIndex, side} | null
    const regionKey = region ? region.pairIndex * 2 + region.side : -1;

    // (1) clear the latch once the body has LEFT the region it warped from (or any).
    const latched = this.warpLatch.get(sprite);
    if (latched !== undefined && latched !== regionKey) {
      this.warpLatch.delete(sprite);
    }

    // (2) WARP — in a region, and not the one we just warped from.
    if (region && this.warpLatch.get(sprite) === undefined) {
      this.warp(sprite, id, region.pairIndex, region.side);
    }

    // (3) GHOST SLOW — scale speed while inside any region; restore on exit.
    this.applyGhostSlow(sprite, region !== null);
  }

  /**
   * Teleport the sprite to the PAIRED tunnel's mouth and emit the crossing event.
   * `side` 0 = it crossed region `a` (warp to `b.mouth`); 1 = crossed `b` (→ a.mouth).
   * Latch it to the DESTINATION region so it does not warp straight back this tick.
   */
  private warp(sprite: any, id: string, pairIndex: number, side: number): void {
    const pair = this.tunnels[pairIndex];
    const dest = side === 0 ? pair.b : pair.a;
    const fromTunnel = pairIndex * 2 + side;
    const toTunnel = pairIndex * 2 + (side === 0 ? 1 : 0);

    this.reposition(sprite, dest.mouthX, dest.mouthY);
    // Latch on the DESTINATION region key so a body landing inside the far mouth's
    // trigger AABB does not bounce back next tick (cleared once it moves out).
    this.warpLatch.set(sprite, toTunnel);

    // The crossing is the true gameplay seam: the body's x|y just JUMPED to the paired
    // mouth. Surfaces on __GAME__.player.x|y / entities[*].x|y; logged on the bus.
    this.bus?.emit('entity.warped', { id, fromTunnel, toTunnel });
    this.scene.fireEffect?.('entity.warped', dest.mouthX, dest.mouthY);
  }

  /**
   * While `inside` a tunnel region, scale a ghost's GhostTarget speed to slowFactor×
   * its base; restore the base on exit. Idempotent — a ghost already slowed stays
   * slowed (no compounding), a non-ghost sprite is a clean no-op (no GhostTarget).
   */
  private applyGhostSlow(sprite: any, inside: boolean): void {
    if (this.slowFactor >= 1) return; // slow disabled
    const behavior = this.ghostBehaviorOf(sprite);
    if (!behavior) return; // not a maze ghost → nothing to slow

    let rec = this.slowState.get(sprite);
    if (!rec) {
      rec = { behavior, baseSpeed: Number(behavior.speed) || 0, slowed: false };
      this.slowState.set(sprite, rec);
    }
    // Keep the base in sync if another system (e.g. Elroy) raised it while OUTSIDE.
    if (!rec.slowed) rec.baseSpeed = Number(behavior.speed) || rec.baseSpeed;

    if (inside && !rec.slowed) {
      behavior.speed = Math.max(1, Math.round(rec.baseSpeed * this.slowFactor));
      rec.slowed = true;
    } else if (!inside && rec.slowed) {
      behavior.speed = rec.baseSpeed; // back to full speed leaving the tunnel
      rec.slowed = false;
    }
  }

  // ── geometry + resolution (read the live world, generic) ─────────────────────

  /**
   * Which tunnel region (if any) the world point (x,y) is inside. Returns the FIRST
   * match as {pairIndex, side} (side 0 = region a, 1 = region b), else null. An AABB
   * hit-test on the declared trigger rect (top-left + size).
   */
  private regionAt(x: number, y: number): { pairIndex: number; side: number } | null {
    for (let i = 0; i < this.tunnels.length; i++) {
      const { a, b } = this.tunnels[i];
      if (inAabb(x, y, a)) return { pairIndex: i, side: 0 };
      if (inAabb(x, y, b)) return { pairIndex: i, side: 1 };
    }
    return null;
  }

  /** The GhostTarget behavior bound to a sprite, or null (mirrors ElroySpeedup's scan). */
  private ghostBehaviorOf(sprite: any): any {
    if (!sprite || !sprite.behaviors || typeof sprite.behaviors.getAll !== 'function') return null;
    for (const beh of sprite.behaviors.getAll() as any[]) {
      if (beh && beh.constructor?.name === 'GhostTarget') return beh;
    }
    return null;
  }

  /** Every live sprite in the configured groups (the same set __GAME__.entities reads). */
  private groupSprites(): any[] {
    const scene = this.scene;
    const out: any[] = [];
    for (const name of this.groups) {
      const group = scene?.[name];
      if (!group || typeof group.getChildren !== 'function') continue;
      for (const child of group.getChildren()) {
        if (child && child.active !== false) out.push(child);
      }
    }
    return out;
  }

  /** Move a sprite (keep the arcade body in sync — setPosition alone desyncs it). */
  private reposition(sprite: any, x: number, y: number): void {
    if (sprite.body?.reset) sprite.body.reset(x, y);
    else sprite.setPosition?.(x, y);
    // Mirror onto the plain fields so a headless host (no arcade body) still moves.
    sprite.x = x;
    sprite.y = y;
  }

  /** Auto-derive the entity id (mirrors core/hook.ts entityId resolution order). */
  private entityIdOf(sprite: any): string {
    return (sprite?.__id ?? sprite?.entityId ?? sprite?.name ?? 'entity') as string;
  }

  // ── component surface (the declared PUSH channel) ────────────────────────────

  /**
   * The one event this system publishes on the shared bus. A TRUE statement about the
   * real emit site in warp(): a body crossing a declared tunnel edge jumped to the
   * paired mouth. The matching .emit() is
   * `this.scene.eventBus.emit('entity.warped', { id, fromTunnel, toTunnel })`.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'entity.warped',
          payload: '{id,fromTunnel,toTunnel}',
          scope: 'archetype',
          drivenBy: 'move — a body (the player or a ghost) crosses a declared tunnel-edge region',
          expect:
            'the body x|y jumps to the paired tunnel mouth in __GAME__.player.x|y / entities[*].x|y, and a ghost inside a tunnel region has reduced measured speed in entities[]; entity.warped logged',
        },
      ],
    };
  }
}

/** AABB hit-test: is world point (x,y) inside the region's trigger rect? */
function inAabb(x: number, y: number, r: TunnelRegion): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** A declared pair is valid only if both regions carry a numeric AABB + mouth. */
function isPair(p: any): p is TunnelPair {
  return !!p && isRegion(p.a) && isRegion(p.b);
}

function isRegion(r: any): r is TunnelRegion {
  return (
    !!r &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.w) &&
    Number.isFinite(r.h) &&
    Number.isFinite(r.mouthX) &&
    Number.isFinite(r.mouthY)
  );
}
