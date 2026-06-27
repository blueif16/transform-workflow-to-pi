/**
 * SegmentSplit — the SEGMENTED-ENEMY chain + split + mushroom-field system (BUILD —
 * gallery-shooter engine piece; the Centipede signature). RB §2: a segmented enemy is
 * a HEAD-led chain of body segments that snakes down the field as ONE tracked body; a
 * shot to a MID-BODY segment destroys that link and CLEAVES the chain into two
 * INDEPENDENTLY-tracked chains (the front keeps its head, the rear grows a NEW head),
 * and every destroyed segment GROWS A MUSHROOM at its cell (the field that thickens as
 * the fight wears on — the hazard that reshapes the lane).
 *
 * It is SELF-CONTAINED: it spawns its own chains as `.__segment`-tagged sprites into the
 * SAME scene.enemies group the bullet-collision/win paths read (so they surface in
 * __GAME__.entities and die through the shared killable seam), and wires its OWN
 * bullet↔segment overlap — mirroring ProjectilePool.setupCollisions — so a hit routes
 * through THIS system's split logic, not the formation's one-shot kill. Mushrooms are
 * tagged `.__mushroom` obstacles in scene.obstacles (the eroding-cover group), so a
 * verify run that polls obstacle count sees the field grow.
 *
 * SPLIT MATH (RB §2): each live chain is an ordered array of segment sprites,
 * front→rear. A bullet hit at index `i`:
 *   - i == 0 (the head)      → the head dies; the next segment becomes the new head
 *                              (the chain SHORTENS, no split).
 *   - i == last (the tail)   → the tail dies (the chain SHORTENS, no split).
 *   - 0 < i < last (mid)     → the segment dies; [0..i-1] stays the FRONT chain, [i+1..]
 *                              becomes a NEW REAR chain with its own id → segment.split.
 * EVERY destroyed segment (any index) grows a mushroom at its cell → mushroom.grown.
 *
 * ID SOURCE (the required convention): a chain id is DERIVED — the front chain keeps the
 * hit chain's id; the rear chain gets `<chainId>.<splitCount>` (derived from the hit
 * segment index's position in the chain, monotonic per parent). A mushroom id is DERIVED
 * from the destroyed segment's grid cell (`mush_<col>_<row>`). No config id.
 *
 * GENERIC: no game/theme, no baked coordinate — geometry comes from the arena bounds +
 * params; a level that binds no segmented enemy is a clean no-op (chains=0).
 *
 * EVENTS (the PUSH channel): segment.split fires when a mid-body hit cleaves a chain in
 * two (payload {chainId,newChainId,index}); mushroom.grown fires when a destroyed segment
 * leaves a mushroom (payload {id,col,row}).
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible declared defaults):
 *   chains        number of segmented enemies to spawn at attach (default 1).
 *   segments      body segments per chain at spawn, head included (default 9).
 *   cellPx        grid cell size px — segment size + mushroom size + step distance (default 24).
 *   speed         chain crawl speed |px/s| along the row (default 90).
 *   originX       the head spawn X of the first chain (px; default 1 cell in).
 *   originY       the head spawn Y of every chain (px; default 1 cell down).
 *   chainGapPx    horizontal gap between consecutive chains' heads at spawn (default 3 cells).
 *   damage        damage a bullet deals a segment (default 1 — one-shot per link).
 *   segmentSlot   segment texture key (default the generated placeholder).
 *   mushroomSlot  mushroom texture key (default the generated placeholder).
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import * as utils from '../utils';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'SegmentSplit',
  intent:
    'Segmented snaking enemies (the Centipede signature): each chain crawls the lane as one tracked body; a shot to a MID-BODY segment cleaves the chain into two independently-tracked chains, and every destroyed segment grows a mushroom at its cell — the hazard field that thickens and reshapes the lane over the fight.',
  attachesTo: 'scene',
  params: [
    'chains',
    'segments',
    'cellPx',
    'speed',
    'originX',
    'originY',
    'chainGapPx',
    'damage',
    'segmentSlot',
    'mushroomSlot',
  ],
  roles: ['enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface SegmentSplitConfig {
  chains?: number;
  segments?: number;
  cellPx?: number;
  speed?: number;
  originX?: number;
  originY?: number;
  chainGapPx?: number;
  damage?: number;
  segmentSlot?: string;
  mushroomSlot?: string;
}

/** One tracked chain: an ordered front→rear list of live segment sprites + its id + heading. */
interface Chain {
  id: string;
  segments: any[];
  /** Crawl heading: +1 = right, -1 = left. */
  dir: number;
  /** Monotonic split counter (the rear-id suffix source for splits off THIS chain). */
  splits: number;
}

export class SegmentSplit implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly chainCount: number;
  private readonly segmentCount: number;
  private readonly cellPx: number;
  private readonly speed: number;
  private readonly originX: number;
  private readonly originY: number;
  private readonly chainGapPx: number;
  private readonly damage: number;
  private readonly segmentSlot?: string;
  private readonly mushroomSlot?: string;

  /** Every live chain, keyed by id (split makes new ids; a head/tail trim shrinks one). */
  private chains: Map<string, Chain> = new Map();
  /** Mushrooms grown this level, keyed by cell id (idempotent — one per cell). */
  private mushrooms: Map<string, any> = new Map();
  /** Monotonic chain-id seed for the spawn batch. */
  private chainSeq = 0;

  constructor(params: SegmentSplitConfig = {}) {
    this.chainCount = Math.max(0, Math.floor(params.chains ?? 1));
    this.segmentCount = Math.max(1, Math.floor(params.segments ?? 9));
    this.cellPx = Math.max(4, params.cellPx ?? 24);
    this.speed = params.speed ?? 90;
    this.originX = params.originX ?? this.cellPx;
    this.originY = params.originY ?? this.cellPx;
    this.chainGapPx = params.chainGapPx ?? 3 * (params.cellPx ?? 24);
    this.damage = params.damage ?? 1;
    this.segmentSlot = params.segmentSlot;
    this.mushroomSlot = params.mushroomSlot;
  }

  reset(): void {
    this.chains = new Map();
    this.mushrooms = new Map();
    this.chainSeq = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    utils.ensurePlaceholderTexture(scene, '__seg', this.cellPx, this.cellPx, 'enemy');
    utils.ensurePlaceholderTexture(scene, '__mush', this.cellPx, this.cellPx, 'obstacle');
    if (!scene.enemies || typeof scene.enemies.add !== 'function') return;
    for (let c = 0; c < this.chainCount; c += 1) this.spawnChain(c);
    // Publish self so diagnostics / a verify driver can read the live chain count.
    scene.__segmentSplit = this;
  }

  /** Wire bullet↔segment overlap → THIS system's hit handler (mirrors ProjectilePool). */
  setupCollisions(): void {
    const scene = this.scene;
    if (!scene || !scene.playerBullets || !scene.enemies) return;
    scene.physics.add.overlap(scene.playerBullets, scene.enemies, (bullet: any, target: any) => {
      // Only OUR segments route through the split logic; formation members are not ours.
      if (!target || !target.__segment || target.isDead || target.active === false) return;
      this.onSegmentHit(target);
      // Return the bullet to its pool if the pool owns it (mirror the engine release path).
      const pool = scene.__projectilePool;
      if (pool && typeof pool.release === 'function') {
        try {
          (pool as any).release(bullet);
        } catch {
          /* a release is best-effort — never fail a hit on it */
        }
      }
    });
  }

  /** Live tracked-chain count (EXPOSED — a split increments it; a trim-to-empty drops it). */
  public chainCountLive(): number {
    return this.chains.size;
  }

  /** Live mushroom count (EXPOSED — the field-growth proof). */
  public mushroomCount(): number {
    return this.mushrooms.size;
  }

  update(): void {
    const scene = this.scene;
    if (!scene || this.chains.size === 0) return;
    const dtMs = scene.game?.loop?.delta ?? 16.67;
    const stepPx = (this.speed * dtMs) / 1000;
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    for (const chain of [...this.chains.values()]) {
      this.crawlChain(chain, stepPx, W);
    }
  }

  /** Advance one chain: the head leads, each segment trails the prior cell; bounce + drop at an edge. */
  private crawlChain(chain: Chain, stepPx: number, W: number): void {
    const segs = chain.segments;
    if (segs.length === 0) {
      this.chains.delete(chain.id);
      return;
    }
    const head = segs[0];
    const halfW = (head.displayWidth ?? this.cellPx) / 2;
    const nextX = head.x + chain.dir * stepPx;
    // Edge bounce + a one-cell row drop (the snaking descent).
    if (nextX - halfW <= 0 || nextX + halfW >= W) {
      chain.dir *= -1;
      for (const s of segs) s.y += this.cellPx;
    }
    // The body FOLLOWS: each trailing segment chases the cell ahead of it.
    for (let i = segs.length - 1; i > 0; i -= 1) {
      segs[i].x = segs[i - 1].x;
      segs[i].y = segs[i - 1].y;
    }
    head.x += chain.dir * stepPx;
  }

  /**
   * A bullet struck `seg`. Find its chain + index, destroy it (grow a mushroom), and —
   * when it is a MID-BODY link — CLEAVE the chain into a front + a new rear chain.
   */
  private onSegmentHit(seg: any): void {
    const chainId: string | undefined = seg.__chainId;
    const chain = chainId ? this.chains.get(chainId) : undefined;
    if (!chain) {
      // An orphan segment (already-split bookkeeping) — still destroy + mushroom it.
      this.destroySegment(seg);
      return;
    }
    const i = chain.segments.indexOf(seg);
    if (i < 0) {
      this.destroySegment(seg);
      return;
    }
    const last = chain.segments.length - 1;
    const isMidBody = i > 0 && i < last;

    // Destroy the hit segment (grows the mushroom at its cell).
    this.destroySegment(seg);

    // Partition the survivors around the hit index.
    const front = chain.segments.slice(0, i);
    const rear = chain.segments.slice(i + 1);
    chain.segments = front;

    if (isMidBody && rear.length > 0 && front.length > 0) {
      // CLEAVE: the front keeps this chain's id; the rear becomes a NEW tracked chain.
      chain.splits += 1;
      const newChainId = `${chain.id}.${chain.splits}`;
      const rearChain: Chain = {
        id: newChainId,
        segments: rear,
        dir: -chain.dir, // the severed rear peels off the other way (the classic break)
        splits: 0,
      };
      for (const s of rear) s.__chainId = newChainId;
      this.chains.set(newChainId, rearChain);
      // The PUSH seam: the chain split into two independently-tracked chains.
      this.bus?.emit('segment.split', {
        chainId: chain.id,
        newChainId,
        index: i,
      });
    } else {
      // Head/tail trim (no split): the rear, if any, simply re-joins the same chain.
      chain.segments = front.concat(rear);
      for (const s of chain.segments) s.__chainId = chain.id;
    }

    if (chain.segments.length === 0) this.chains.delete(chain.id);
  }

  /** Kill a segment + grow a mushroom at its grid cell (idempotent per cell). */
  private destroySegment(seg: any): void {
    const col = Math.round((seg.x - this.originX) / this.cellPx);
    const row = Math.round((seg.y - this.originY) / this.cellPx);
    const px = seg.x;
    const py = seg.y;
    seg.kill?.();
    this.growMushroom(col, row, px, py);
  }

  /** Grow a mushroom obstacle at a cell — once per cell (the thickening field). */
  private growMushroom(col: number, row: number, px: number, py: number): void {
    const id = `mush_${col}_${row}`;
    if (this.mushrooms.has(id)) return; // one mushroom per cell (idempotent).
    const scene = this.scene;
    const key = this.mushroomSlot && utils.textureExists(scene, this.mushroomSlot) ? this.mushroomSlot : '__mush';
    const sprite = scene.physics.add.staticSprite(px, py, key) as any;
    utils.fitDisplayContain(sprite, this.cellPx, this.cellPx);
    sprite.refreshBody?.();
    sprite.__type = 'obstacle';
    sprite.__kind = 'mushroom';
    sprite.__mushroom = true;
    sprite.__id = id;
    if (scene.obstacles && typeof scene.obstacles.add === 'function') scene.obstacles.add(sprite);
    this.mushrooms.set(id, sprite);
    // The PUSH seam: a destroyed segment grew a mushroom at this cell.
    this.bus?.emit('mushroom.grown', { id, col, row });
  }

  /** Spawn one segmented chain (head + body) into scene.enemies, tagged for our hit path. */
  private spawnChain(index: number): void {
    const scene = this.scene;
    const id = `chain_${this.chainSeq}`;
    this.chainSeq += 1;
    const headX = this.originX + index * this.chainGapPx;
    const headY = this.originY;
    const segs: any[] = [];
    for (let s = 0; s < this.segmentCount; s += 1) {
      // The body trails LEFT of the head along the spawn row (front→rear = head→tail).
      const sx = headX - s * this.cellPx;
      const sprite = this.makeSegment(sx, headY, id);
      segs.push(sprite);
    }
    this.chains.set(id, { id, segments: segs, dir: 1, splits: 0 });
  }

  /** Allocate ONE segment sprite: a killable enemy tagged .__segment with its chain id. */
  private makeSegment(x: number, y: number, chainId: string): any {
    const scene = this.scene;
    const key = this.segmentSlot && utils.textureExists(scene, this.segmentSlot) ? this.segmentSlot : '__seg';
    const sprite = scene.physics.add.sprite(x, y, key) as any;
    utils.fitDisplayContain(sprite, this.cellPx, this.cellPx);
    const body = sprite.body;
    body?.setAllowGravity?.(false);
    if (body) body.setImmovable?.(true);
    sprite.__type = 'enemy';
    sprite.__segment = true;
    sprite.__chainId = chainId;
    sprite.__points = 10;
    sprite.isDead = false;
    sprite.health = Math.max(1, this.damage);
    sprite.takeDamage = (n: number) => {
      if (sprite.isDead) return;
      sprite.health -= Number.isFinite(n) ? n : 0;
      if (sprite.health <= 0) sprite.kill();
    };
    sprite.kill = () => {
      if (sprite.isDead) return;
      sprite.isDead = true;
      sprite.setActive(false);
      const b = sprite.body;
      if (b) b.enable = false;
      sprite.destroy();
    };
    scene.enemies.add(sprite);
    return sprite;
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - segment.split   ← onSegmentHit (a mid-body hit cleaves the chain in two)  [archetype]
   *   - mushroom.grown  ← growMushroom (a destroyed segment leaves a mushroom)    [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'segment.split',
          payload: '{chainId,newChainId,index}',
          scope: 'archetype',
          drivenBy: 'a shot hits a mid-body segment (an index that is neither head nor tail)',
          expect:
            'the chain cleaves into two independently-tracked chains (a new rear chain id appears, the live chain count grows); segment.split logged',
        },
        {
          name: 'mushroom.grown',
          payload: '{id,col,row}',
          scope: 'archetype',
          drivenBy: 'a segment is destroyed (any index hit)',
          expect:
            'a mushroom obstacle appears at that cell in __GAME__.entities (the mushroom count grows); mushroom.grown logged',
        },
      ],
    };
  }
}
