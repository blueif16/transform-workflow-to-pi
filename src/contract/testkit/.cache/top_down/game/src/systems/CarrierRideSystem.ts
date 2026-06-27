/**
 * CarrierRideSystem — the RIVER INVERSION (Frogger's log-carry; lane-dodge's
 * SIGNATURE per DR §9, the genre inversion hook per DR §12 H5). ADDED beyond the
 * seeds: no catalog system carries/translates the player on a moving body.
 *
 * The inversion (same overlap test, OPPOSITE consequence to a dodge lane): on a
 * RIDE lane the OPEN surface is LETHAL and a moving CARRIER is the only safe
 * footing.
 *   - While the player OVERLAPS a moving carrier → the carrier SAVES the player AND
 *     translates them by the carrier's per-frame velocity (px/frame = velocity * dt),
 *     so the player drifts with the log. We emit `player.carried` at this true seam.
 *   - OFF a carrier while OVER an open ride surface (a declared ride region, no
 *     carrier overlap) → the open water is lethal → flip status to 'lost'.
 *   - CARRIED OFF the screen edge (the carry drift pushes the player out of bounds)
 *     → also lethal → 'lost'.
 *
 * It re-implements NOTHING the engine owns: the lose seam is the SDK death pipeline
 * (`player.takeDamage(Infinity)` → kill → FSM 'dying' → `scene.onPlayerDeath()`,
 * which sets status='lost' and emits the standard `player.died`); the carry just
 * adds the carrier's per-frame velocity to `player.x/y`. The ridden carrier's id is
 * AUTO-DERIVED from the overlapped carrier entity's `__id` in the live world — NOT a
 * config.id param. The ride-lane layout is level DATA.
 *
 * Observable (__GAME__): while `__GAME__.player` overlaps a carrier, player.x|y
 * translate by the carrier's velocity each frame; off a carrier over an open ride
 * surface, `__GAME__.status` flips to 'lost'.
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, no game/theme/coordinate baked):
 *   carrierKind?    only entities whose `__kind` equals this count as carriers
 *                   (e.g. 'log','turtle'). Absent => any moving entity in the
 *                   scanned groups is a carrier.
 *   rideRegions?    the ride-lane rectangles (level DATA), each {x,y,width,height}
 *                   in world px — the open surface INSIDE a region is lethal. Absent
 *                   => `scene.levelData.rideLanes` is used; absent there too => no
 *                   region is lethal (the inversion is a no-op, safe degrade).
 *   minCarrierSpeed minimum |velocity| (px/s) for an entity to count as a moving
 *                   carrier (default 1 — a parked sprite never carries).
 *   overlapPad      forgiving half-extent added to the carrier AABB so the ride is
 *                   not pixel-brittle (default 6px).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (registry/discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'CarrierRideSystem',
  intent:
    'The river inversion (lane-dodge SIGNATURE): on a ride lane the open surface is lethal and a moving carrier saves+translates the player by its per-frame velocity; off a carrier over open water, or carried off-screen, flips status to lost.',
  attachesTo: 'scene',
  params: ['carrierKind', 'rideRegions', 'minCarrierSpeed', 'overlapPad'],
  roles: ['player', 'carrier'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** A ride-lane rectangle (world px) — the open surface inside is lethal. */
export interface RideRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CarrierRideConfig {
  carrierKind?: string;
  rideRegions?: RideRegion[];
  minCarrierSpeed?: number;
  overlapPad?: number;
}

export class CarrierRideSystem implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly carrierKind?: string;
  private readonly minCarrierSpeed: number;
  private readonly overlapPad: number;
  private rideRegions: RideRegion[];
  /** Latches once the player has been drowned/swept so we never double-fire the lose. */
  private lost = false;

  constructor(params: CarrierRideConfig = {}) {
    this.carrierKind = params.carrierKind;
    this.minCarrierSpeed = params.minCarrierSpeed ?? 1;
    this.overlapPad = params.overlapPad ?? 6;
    this.rideRegions = params.rideRegions ?? [];
  }

  reset(): void {
    this.lost = false;
  }

  attach(scene: any): void {
    this.scene = scene;
    // The ride-lane layout is level DATA: prefer an explicit param, else read it off
    // the level data the scene already holds. Absent everywhere => no lethal region
    // (the inversion safely degrades to a no-op).
    if (this.rideRegions.length === 0) {
      const fromData = scene?.levelData?.rideLanes;
      if (Array.isArray(fromData)) this.rideRegions = fromData;
    }
  }

  /** Per-frame: carry the player on the overlapped carrier, else drown on open water. */
  update(): void {
    const scene = this.scene;
    const player = scene?.player;
    if (!scene || this.lost || scene.gameCompleted) return;
    if (!player?.active || player.isDead) return;

    const carrier = this.findCarrierUnder(player);
    if (carrier) {
      // Riding: translate the player by the carrier's per-frame velocity, then test
      // for being carried off the screen edge.
      this.carry(player, carrier);
      if (this.isOffScreen(player)) this.drown(player); // swept off the edge → lethal
      return;
    }

    // No carrier: if the player is over an OPEN ride surface, the water is lethal.
    if (this.isOverOpenRideSurface(player)) this.drown(player);
  }

  /**
   * Translate the player by the carrier's per-frame velocity (px/frame = px/s * dt)
   * and emit `player.carried` at this true gameplay seam. The carrier id is
   * AUTO-DERIVED from the overlapped entity's `__id` (never a config param).
   */
  private carry(player: any, carrier: any): void {
    const body = carrier.body;
    const vx = body?.velocity?.x ?? 0;
    const vy = body?.velocity?.y ?? 0;
    // Per-frame delta from per-second velocity (defensive default ~60fps).
    const dt = (this.scene?.game?.loop?.delta ?? 1000 / 60) / 1000;
    const dx = vx * dt;
    const dy = vy * dt;
    player.x += dx;
    player.y += dy;
    // Keep the arcade body in lockstep with the translated display position so the
    // next physics step does not snap the player back off the log.
    if (player.body?.reset) player.body.reset(player.x, player.y);

    const carrierId = (carrier.__id as string | undefined) ?? 'carrier';
    this.bus?.emit('player.carried', {
      carrierId,
      dx: Math.round(dx * 100) / 100,
      dy: Math.round(dy * 100) / 100,
    });
  }

  /** The lethal seam: drive the SDK death pipeline (→ status 'lost' + player.died). */
  private drown(player: any): void {
    if (this.lost) return;
    this.lost = true;
    // Lethal damage flows through the engine's own death path (kill → FSM 'dying' →
    // scene.onPlayerDeath → status='lost' + the standard player.died emit). If a game
    // gave the player no health seam, fall back to flipping the registry directly.
    if (typeof player.takeDamage === 'function') {
      player.takeDamage(Number.POSITIVE_INFINITY);
    } else {
      this.scene?.registry?.set('status', 'lost');
    }
  }

  /**
   * The first moving carrier the player overlaps (display-center AABB; forgiving).
   * Scans the carrier-bearing groups; honors the optional `carrierKind` filter and
   * the `minCarrierSpeed` gate (a parked sprite is not a carrier).
   */
  private findCarrierUnder(player: any): any {
    for (const sprite of this.candidateCarriers()) {
      if (!sprite || sprite.active === false || sprite.isDead) continue;
      if (this.carrierKind && sprite.__kind !== this.carrierKind) continue;
      if (this.speedOf(sprite) < this.minCarrierSpeed) continue;
      if (this.overlap(player, sprite)) return sprite;
    }
    return undefined;
  }

  /** Every sprite that could be a carrier (moving lane bodies live in these groups). */
  private candidateCarriers(): any[] {
    const scene = this.scene;
    const out: any[] = [];
    for (const group of [scene?.decorations, scene?.enemies, scene?.obstacles]) {
      if (group && typeof group.getChildren === 'function') out.push(...group.getChildren());
    }
    return out;
  }

  private speedOf(sprite: any): number {
    const v = sprite.body?.velocity;
    if (!v) return 0;
    return Math.hypot(v.x ?? 0, v.y ?? 0);
  }

  /** Display-center AABB overlap with a forgiving pad (frame-deterministic). */
  private overlap(a: any, b: any): boolean {
    if (!a || !b) return false;
    const pad = this.overlapPad;
    const aw = (a.displayWidth ?? 32) / 2;
    const ah = (a.displayHeight ?? 32) / 2;
    const bw = (b.displayWidth ?? 32) / 2 + pad;
    const bh = (b.displayHeight ?? 32) / 2 + pad;
    return Math.abs(a.x - b.x) < aw + bw && Math.abs(a.y - b.y) < ah + bh;
  }

  /** True when the player's center sits inside any declared ride-lane region. */
  private isOverOpenRideSurface(player: any): boolean {
    for (const r of this.rideRegions) {
      if (
        player.x >= r.x &&
        player.x <= r.x + r.width &&
        player.y >= r.y &&
        player.y <= r.y + r.height
      ) {
        return true;
      }
    }
    return false;
  }

  /** True once the carry drift has pushed the player off the visible play area. */
  private isOffScreen(player: any): boolean {
    const scene = this.scene;
    const W = scene?.mapWidth ?? scene?.scale?.width ?? 432;
    const H = scene?.mapHeight ?? scene?.scale?.height ?? 768;
    const m = (player.displayWidth ?? 32) / 2;
    return player.x < -m || player.x > W + m || player.y < -m || player.y > H + m;
  }

  /** The PUSH-channel surface: declares + (via carry()) really fires player.carried. */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'player.carried',
          payload: '{carrierId,dx,dy}',
          scope: 'archetype',
          drivenBy: 'the player stands on a moving carrier on a ride lane',
          expect:
            "__GAME__.player.x|y translate by the carrier's per-frame velocity while overlapping; stepping off over open water flips status to lost; player.carried logged",
        },
      ],
    };
  }
}
