/**
 * LaneScrollSystem — the ROAD half of lane-dodge (BUILD — system; the top_down
 * Frogger/Crossy lane traffic). Refines the LaneScrollingHazard seed: renamed to
 * ...System (systems-barrel convention) with the kill-on-overlap consequence folded
 * in (the seed only spawned + scrolled). No catalog system does per-lane scroll +
 * recycle, so this is the genre-novel delta.
 *
 * Each KILL lane is ONE hazard type moving in ONE direction; ADJACENT lanes
 * alternate direction (lane 0 →, lane 1 ←, …). Per lane it maintains a fixed POOL
 * of hazard sprites evenly phased across the road, advances every hazard by the
 * lane's signed speed each frame, and RECYCLES a hazard that exits one side back to
 * the entry edge (wrap) — so the road never empties. On a kill lane, the player
 * overlapping any hazard takes the LOSE SEAM (player.takeDamage → the engine's
 * player.died/status:'lost' path); the system invents NO new death path.
 *
 * OBSERVABLE (the contract): every hazard is added to scene.hazards (the hook's
 * `hazards` group → surfaces in __GAME__.entities, id/x/y per child) so its position
 * advances each frame per its lane speed, and a hazard exiting one side reappears at
 * the other. It re-implements NOTHING the engine owns: the lose seam is the existing
 * player.takeDamage; physics overlap is scene.physics.add.overlap.
 *
 * GENERIC: no game/theme, no baked coordinate. The road geometry comes from the live
 * map bounds; the lane templates (count / type / speed / hazard size) are level DATA
 * via params. A level that binds no lanes is a clean no-op.
 *
 * EVENT (the PUSH channel): hazard.spawned fires on the shared scene.eventBus at the
 * true seam — once per hazard when it FIRST enters the road AND each time a recycled
 * hazard re-enters from the entry edge — payload {id,lane}.
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible declared defaults):
 *   lanes        per-lane templates: Array<{
 *                  y?            lane centre-line Y (default: evenly spread across the road band)
 *                  speed?        |px/s| scroll magnitude for the lane (default 60)
 *                  count?        hazards pooled in the lane (default 3)
 *                  kind?         entity __kind tag, e.g. 'car' (default 'hazard')
 *                  assetSlot?    texture key for the hazard sprite (default '__px')
 *                  width?/height? hazard display size in px (default 48 x 28)
 *                  damage?       contact damage applied on player overlap (default 999 = one-hit kill)
 *                }>. When omitted, NO lanes spawn (clean no-op).
 *   laneCount    how many lanes to auto-generate when `lanes` is omitted but a road
 *                is still wanted (default 0 ⇒ no auto-lanes; data drives this).
 *   roadTop      Y of the first lane band (default 0.2 * mapHeight).
 *   roadBottom   Y of the last lane band  (default 0.8 * mapHeight).
 *   baseSpeed    default lane speed when a lane omits `speed` (default 60 px/s).
 *   wrapMargin   px past the edge a hazard travels before recycling (default = hazard width).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'LaneScrollSystem',
  intent:
    'Per-lane scrolling traffic: pool one hazard type per kill lane moving one direction (adjacent lanes alternate), advance each frame by the lane speed, recycle off-screen hazards to the entry edge, and apply the lose seam when the player overlaps a hazard. The road half of lane-dodge.',
  attachesTo: 'scene',
  params: ['lanes', 'laneCount', 'roadTop', 'roadBottom', 'baseSpeed', 'wrapMargin'],
  roles: ['player', 'hazard'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** One lane's template — all GENERIC, from level data. */
export interface LaneTemplate {
  /** Lane centre-line Y; defaults to an even spread across the road band. */
  y?: number;
  /** Scroll magnitude in px/s (sign comes from the lane index — adjacent alternate). */
  speed?: number;
  /** Hazards pooled in this lane. */
  count?: number;
  /** Entity __kind tag (e.g. 'car'). */
  kind?: string;
  /** Texture key for the hazard sprite. */
  assetSlot?: string;
  /** Hazard display size in px. */
  width?: number;
  height?: number;
  /** Contact damage applied to the player on overlap (default one-hit kill). */
  damage?: number;
}

export interface LaneScrollSystemConfig {
  lanes?: LaneTemplate[];
  laneCount?: number;
  roadTop?: number;
  roadBottom?: number;
  baseSpeed?: number;
  wrapMargin?: number;
}

/** A live, pooled hazard sprite (the sprite + its owning lane index). */
interface LaneHazard {
  sprite: any;
  lane: number;
}

export class LaneScrollSystem implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly lanesCfg: LaneTemplate[];
  private readonly laneCount: number;
  private readonly roadTopFrac: number | undefined;
  private readonly roadBottomFrac: number | undefined;
  private readonly baseSpeed: number;
  private readonly wrapMarginCfg: number | undefined;

  /** Per-lane resolved geometry (centre Y + signed velocity), index-aligned to lanes. */
  private laneY: number[] = [];
  private laneVx: number[] = [];
  /** Live pooled hazards across all lanes. */
  private hazards: LaneHazard[] = [];
  private spawnCount = 0;

  constructor(params: LaneScrollSystemConfig = {}) {
    this.lanesCfg = Array.isArray(params.lanes) ? params.lanes : [];
    this.laneCount = Math.max(0, Math.floor(params.laneCount ?? 0));
    this.roadTopFrac = params.roadTop;
    this.roadBottomFrac = params.roadBottom;
    this.baseSpeed = params.baseSpeed ?? 60;
    this.wrapMarginCfg = params.wrapMargin;
  }

  reset(): void {
    // Destroy any standing hazards so a restarted level re-arms cleanly.
    for (const h of this.hazards) h.sprite?.destroy?.();
    this.hazards = [];
    this.laneY = [];
    this.laneVx = [];
    this.spawnCount = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    // Own a dedicated 'hazards' group — the hook surfaces it in __GAME__.entities.
    if (!scene.hazards || typeof scene.hazards.getChildren !== 'function') {
      scene.hazards = scene.physics.add.group();
    }
    this.buildLanes();
  }

  /** Wire player↔hazard overlap → the lose seam (player.takeDamage). */
  setupCollisions(): void {
    const scene = this.scene;
    const player = scene?.player;
    if (!player || !scene?.hazards) return;
    scene.physics.add.overlap(player, scene.hazards, (p: any, hazard: any) => {
      if (p.isInvulnerable || p.isHurting || p.isDead) return;
      if (!hazard || hazard.active === false) return;
      // The LOSE SEAM: damage the player via the engine's own death path. A one-hit
      // lane (default damage 999) drains health → player.died → status 'lost'.
      p.takeDamage?.(hazard.damage ?? 999);
    });
  }

  update(): void {
    const scene = this.scene;
    if (!scene || this.hazards.length === 0) return;
    const W = this.roadWidth();
    for (const h of this.hazards) {
      const s = h.sprite;
      if (!s || s.active === false) continue;
      const vx = this.laneVx[h.lane] ?? 0;
      const margin = this.wrapMargin(s);
      s.x += vx * (1 / 60); // advance by lane speed (fixed-step; generic, no game state)
      // Recycle: a hazard that exits one side wraps to the entry edge of the SAME lane.
      if (vx > 0 && s.x > W + margin) {
        s.x = -margin;
        this.onRecycled(h);
      } else if (vx < 0 && s.x < -margin) {
        s.x = W + margin;
        this.onRecycled(h);
      }
    }
  }

  /** Resolve lane geometry + spawn each lane's pool. */
  private buildLanes(): void {
    const lanes = this.resolveLaneTemplates();
    const W = this.roadWidth();
    lanes.forEach((lane, i) => {
      const y = lane.y ?? this.defaultLaneY(i, lanes.length);
      const mag = lane.speed ?? this.baseSpeed;
      // Adjacent lanes alternate direction: even → (+), odd → (-).
      const vx = i % 2 === 0 ? Math.abs(mag) : -Math.abs(mag);
      this.laneY[i] = y;
      this.laneVx[i] = vx;
      const count = Math.max(1, Math.floor(lane.count ?? 3));
      for (let k = 0; k < count; k += 1) {
        // Phase the pool evenly across the road so the lane reads as continuous traffic.
        const x = (W * (k + 0.5)) / count;
        this.spawnHazard(i, lane, x, y);
      }
    });
  }

  /** Spawn ONE hazard into a lane at (x,y); tag it for __GAME__.entities + emit. */
  private spawnHazard(laneIdx: number, lane: LaneTemplate, x: number, y: number): void {
    const scene = this.scene;
    const slot = lane.assetSlot;
    const key = slot && scene.textures.exists(slot) ? slot : '__px';
    const sprite = scene.physics.add.sprite(x, y, key) as any;
    const w = lane.width ?? 48;
    const h = lane.height ?? 28;
    if (typeof sprite.setDisplaySize === 'function') sprite.setDisplaySize(w, h);
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.setImmovable?.(true);
    }
    const id = `hazard_${laneIdx}_${this.spawnCount}`;
    sprite.__type = 'hazard';
    sprite.__id = id;
    sprite.__kind = lane.kind ?? 'hazard';
    sprite.damage = lane.damage ?? 999;
    scene.hazards.add(sprite);
    this.hazards.push({ sprite, lane: laneIdx });
    this.spawnCount += 1;
    this.emitSpawned(id, laneIdx);
  }

  /** A recycled hazard re-entering the road IS a fresh spawn moment — emit again. */
  private onRecycled(h: LaneHazard): void {
    const id = h.sprite?.__id ?? `hazard_${h.lane}_${this.spawnCount}`;
    this.emitSpawned(id, h.lane);
  }

  /** Fire the declared hazard.spawned event on the shared scene bus (the PUSH seam). */
  private emitSpawned(id: string, lane: number): void {
    this.bus?.emit('hazard.spawned', { id, lane });
  }

  /** Lanes from data; else auto-generate `laneCount` plain lanes (default 0 ⇒ none). */
  private resolveLaneTemplates(): LaneTemplate[] {
    if (this.lanesCfg.length > 0) return this.lanesCfg;
    return Array.from({ length: this.laneCount }, () => ({}));
  }

  /** Even vertical spread of lane `i` across the road band [roadTop, roadBottom]. */
  private defaultLaneY(i: number, total: number): number {
    const H = this.scene?.mapHeight ?? this.scene?.scale?.height ?? 768;
    const top = this.roadTopFrac ?? 0.2 * H;
    const bottom = this.roadBottomFrac ?? 0.8 * H;
    if (total <= 1) return (top + bottom) / 2;
    return top + ((bottom - top) * i) / (total - 1);
  }

  private roadWidth(): number {
    return this.scene?.mapWidth ?? this.scene?.scale?.width ?? 432;
  }

  /** How far past the edge a hazard travels before wrapping (default its own width). */
  private wrapMargin(sprite: any): number {
    if (typeof this.wrapMarginCfg === 'number') return this.wrapMarginCfg;
    return (sprite?.displayWidth ?? 48) / 2 + 8;
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - hazard.spawned ← spawnHazard (first entry) AND onRecycled (re-entry) [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'hazard.spawned',
          payload: '{id,lane}',
          scope: 'archetype',
          drivenBy: "a lane's spawn cadence (or a recycled hazard re-entering)",
          expect:
            'a hazard appears in __GAME__.entities at the lane entry edge and advances by the lane speed each frame; hazard.spawned logged',
        },
      ],
    };
  }
}
