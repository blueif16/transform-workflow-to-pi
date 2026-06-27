/**
 * MushroomField — the PERSISTENT MUSHROOM-FIELD system (BUILD — gallery-shooter engine
 * piece; the Centipede field the segmented enemy weaves through). RB: the lane is dotted
 * with mushrooms that BLOCK + DEFLECT the snaking enemy (a chain that crawls into a
 * mushroom cell reverses + drops a row, so the field reshapes the descent) and are
 * CLEARED only by repeated player fire — each mushroom soaks several hits, eroding one
 * stage per shot, until it is gone and the lane opens at that cell.
 *
 * This is the standing FIELD, complementary to (and distinct from) SegmentSplit, which
 * GROWS a mushroom as a side-effect of a destroyed segment (its own `mushroom.grown`
 * seam). MushroomField OWNS a config/derived grid of field mushrooms at attach, gives
 * each a hit budget, and publishes ONE seam — `mushroom.cleared` — when a mushroom's
 * last hit empties it and the live field count falls. It does not spawn enemies and does
 * not split chains; it is the lane hazard the chain must navigate.
 *
 * It is SELF-CONTAINED, mirroring the sibling systems' exact shape (SegmentSplit /
 * DestructibleBunker): an ISceneSystem with reset()/attach()/setupCollisions()/update(),
 * reaching the shared bus via this.scene.eventBus and surfacing its mushrooms through the
 * engine's KNOWN group so __GAME__.entities sees them with ZERO extra hook wiring —
 * every field mushroom rides scene.obstacles, tagged `.__mushroom` (type 'obstacle'), so
 * the live mushroom count IS the obstacle-count signal a verify run polls.
 *
 * OBSERVABLE (the contract — what a verify run polls):
 *   - BLOCK/DEFLECT: a segmented chain (a scene.enemies member tagged .__segment) whose
 *     head overlaps a live field mushroom reverses heading + drops a row — the chain's
 *     path is genuinely reshaped by the field (the static mushroom is untouched).
 *   - CLEAR: a player bullet overlapping a mushroom erodes ONE hit-stage off it; when its
 *     hits reach zero the mushroom is removed from scene.obstacles → __GAME__.entities
 *     obstacle count falls → the live mushroom count decreases → mushroom.cleared.
 *
 * It owns NO firing (ProjectilePool / ScrollShmup do) — it only registers the
 * bullet↔mushroom overlap and erodes the mushroom that was struck, returning a pooled
 * bullet to its pool (mirroring SegmentSplit's release path) so one shot is spent per bite.
 *
 * ID SOURCE (the required convention): a mushroom id is DERIVED from its grid cell
 * (`mush_<col>_<row>`) — never a config id. A level may also pass explicit `cells`
 * (each {col,row} or {x,y}); when omitted, the field is DERIVED procedurally from the
 * arena bounds + density param.
 *
 * GENERIC: no game/theme, no baked coordinate. Cell size, the field rows/density, the
 * hit budget per mushroom, and the tint all come from params with declared sensible
 * defaults. A level that binds it with `count: 0` (or an empty `cells`) is a clean no-op.
 *
 * EVENTS (the PUSH channel):
 *   - mushroom.cleared ← clearMushroom (a mushroom took its last hit — it was removed,
 *     the field count fell)                                                  [archetype]
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible declared defaults):
 *   cells       explicit field cells, each {col,row} OR {x,y} (default: derived field).
 *   count       how many mushrooms to derive when `cells` is omitted (default 24).
 *   cellPx      grid cell size px — mushroom display size + grid step (default 24).
 *   fieldTop    y (px) of the topmost derived field row (default 2 cells down).
 *   fieldBottom y (px) of the bottommost derived row (default mapHeight - 3 cells).
 *   marginX     horizontal inset (px) from each arena edge for derived cells (default cellPx).
 *   hitsToClear hits one mushroom soaks before it clears (default 4 — the classic).
 *   mushroomSlot mushroom texture key (default the generated placeholder).
 *   tintFull    mushroom tint at full health, fading toward white as it erodes (default 0xb86bd6).
 *   seed        deterministic RNG seed for the derived layout (default 1337).
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import * as utils from '../utils';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'MushroomField',
  intent:
    'The persistent mushroom field a segmented enemy weaves through (the Centipede field): a grid of mushrooms that block + deflect the snaking chain (a chain whose head reaches a mushroom reverses and drops a row) and are cleared only by repeated player fire — each mushroom soaks several hits, eroding stage by stage until it is gone and the lane opens. Mushrooms ride scene.obstacles so __GAME__.entities falls as the field is cleared; mushroom.cleared fires when a mushroom takes its last hit. The gallery-shooter standing-field hazard.',
  attachesTo: 'scene',
  params: [
    'cells',
    'count',
    'cellPx',
    'fieldTop',
    'fieldBottom',
    'marginX',
    'hitsToClear',
    'mushroomSlot',
    'tintFull',
    'seed',
  ],
  roles: ['enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** One explicit field cell (the id source: derived from its grid cell). */
export interface MushroomCellSpec {
  col?: number;
  row?: number;
  x?: number;
  y?: number;
}

export interface MushroomFieldConfig {
  cells?: MushroomCellSpec[];
  count?: number;
  cellPx?: number;
  fieldTop?: number;
  fieldBottom?: number;
  marginX?: number;
  hitsToClear?: number;
  mushroomSlot?: string;
  tintFull?: number;
  seed?: number;
}

/** Internal bookkeeping for one field mushroom: its id, sprite, and remaining hits. */
interface MushroomRecord {
  id: string;
  sprite: any;
  hits: number;
}

export class MushroomField implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly cellSpecs: MushroomCellSpec[];
  private readonly count: number;
  private readonly cellPx: number;
  private readonly fieldTopParam?: number;
  private readonly fieldBottomParam?: number;
  private readonly marginX: number;
  private readonly hitsToClear: number;
  private readonly mushroomSlot?: string;
  private readonly tintFull: number;
  private seed: number;

  /** Every live field mushroom, keyed by cell id (idempotent — one per cell). */
  private mushrooms: Map<string, MushroomRecord> = new Map();

  constructor(params: MushroomFieldConfig = {}) {
    this.cellSpecs = Array.isArray(params.cells) ? params.cells : [];
    this.count = Math.max(0, Math.floor(params.count ?? 24));
    this.cellPx = Math.max(4, params.cellPx ?? 24);
    this.fieldTopParam = params.fieldTop;
    this.fieldBottomParam = params.fieldBottom;
    this.marginX = Math.max(0, params.marginX ?? (params.cellPx ?? 24));
    this.hitsToClear = Math.max(1, Math.floor(params.hitsToClear ?? 4));
    this.mushroomSlot = params.mushroomSlot;
    this.tintFull = params.tintFull ?? 0xb86bd6;
    this.seed = Math.floor(params.seed ?? 1337);
  }

  reset(): void {
    for (const m of this.mushrooms.values()) m.sprite?.destroy?.();
    this.mushrooms = new Map();
    this.seed = 1337;
  }

  attach(scene: any): void {
    this.scene = scene;
    utils.ensurePlaceholderTexture(scene, '__mushfield', this.cellPx, this.cellPx, 'obstacle');
    // Reuse the engine's known group so __GAME__.entities sees our mushrooms with no extra
    // hook wiring: every field mushroom is an 'obstacle' entity (the standing hazard).
    if (!scene.obstacles || typeof scene.obstacles.add !== 'function') {
      scene.obstacles = scene.physics.add.group();
    }
    for (const cell of this.resolveCells()) this.growMushroom(cell.col, cell.row, cell.x, cell.y);
    // Mirror the live field count onto the scene + publish self so the scene /
    // diagnostics / a verify driver can read the live count.
    scene.mushroomsRemaining = this.mushroomCount();
    scene.__mushroomField = this;
  }

  /**
   * Wire the overlaps this system owns:
   *   - player bullet (scene.playerBullets) ↔ mushroom → erode ONE hit-stage off it;
   *   - segmented chain head (scene.enemies, .__segment) ↔ mushroom → DEFLECT the chain
   *     (reverse heading + drop a row), leaving the static mushroom untouched.
   * The enemies overlap only matters when a SegmentSplit chain is bound; we guard for it
   * so a base field still clears under the player's shots.
   */
  setupCollisions(): void {
    const scene = this.scene;
    if (!scene || !scene.obstacles) return;

    if (scene.playerBullets) {
      scene.physics.add.overlap(scene.playerBullets, scene.obstacles, (bullet: any, mush: any) => {
        if (!mush || mush.active === false || !mush.__mushroomField) return;
        if (!bullet || bullet.active === false) return;
        this.consumeBullet(bullet);
        this.hitMushroom(mush);
      });
    }

    if (scene.enemies) {
      scene.physics.add.overlap(scene.enemies, scene.obstacles, (enemy: any, mush: any) => {
        if (!mush || mush.active === false || !mush.__mushroomField) return;
        if (!enemy || enemy.active === false || !enemy.__segment) return;
        this.deflectChain(enemy);
      });
    }
  }

  /** No per-frame work — the field is static; clearing + deflection are overlap-driven. */
  update(): void {}

  /** Live field-mushroom count (EXPOSED — the field-clearing proof). */
  public mushroomCount(): number {
    return this.mushrooms.size;
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  /** The field cells to grow: explicit param cells, else a derived scatter over the arena. */
  private resolveCells(): { col: number; row: number; x?: number; y?: number }[] {
    if (this.cellSpecs.length > 0) {
      return this.cellSpecs.map((c, i) => ({
        col: Math.floor(c.col ?? (Number.isFinite(c.x) ? (c.x as number) / this.cellPx : i)),
        row: Math.floor(c.row ?? (Number.isFinite(c.y) ? (c.y as number) / this.cellPx : 0)),
        x: c.x,
        y: c.y,
      }));
    }
    return this.deriveField();
  }

  /**
   * Derive a scattered field: pick `count` distinct grid cells inside the lane band
   * [fieldTop, fieldBottom], inset `marginX` from each edge — a deterministic scatter
   * (seeded RNG) so the same level rebuilds the same field.
   */
  private deriveField(): { col: number; row: number }[] {
    const scene = this.scene;
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    const H = scene.mapHeight ?? scene.scale?.height ?? 768;
    if (this.count <= 0) return [];

    const top = this.fieldTopParam ?? 2 * this.cellPx;
    const bottom = this.fieldBottomParam ?? H - 3 * this.cellPx;
    const colMin = Math.max(0, Math.floor(this.marginX / this.cellPx));
    const colMax = Math.max(colMin, Math.floor((W - this.marginX) / this.cellPx));
    const rowMin = Math.max(0, Math.floor(top / this.cellPx));
    const rowMax = Math.max(rowMin, Math.floor(bottom / this.cellPx));

    const colSpan = colMax - colMin + 1;
    const rowSpan = rowMax - rowMin + 1;
    const capacity = colSpan * rowSpan;
    const want = Math.min(this.count, capacity);

    const taken = new Set<string>();
    const out: { col: number; row: number }[] = [];
    let guard = 0;
    while (out.length < want && guard < want * 50) {
      guard += 1;
      const col = colMin + Math.floor(this.rng() * colSpan);
      const row = rowMin + Math.floor(this.rng() * rowSpan);
      const key = `${col}_${row}`;
      if (taken.has(key)) continue;
      taken.add(key);
      out.push({ col, row });
    }
    return out;
  }

  /** A small deterministic LCG so the derived field is stable across rebuilds/restarts. */
  private rng(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  /** Grow one field mushroom obstacle at a cell — once per cell (idempotent). */
  private growMushroom(col: number, row: number, px?: number, py?: number): void {
    const id = `mush_${col}_${row}`;
    if (this.mushrooms.has(id)) return; // one mushroom per cell.
    const scene = this.scene;
    const x = Number.isFinite(px) ? (px as number) : col * this.cellPx + this.cellPx / 2;
    const y = Number.isFinite(py) ? (py as number) : row * this.cellPx + this.cellPx / 2;
    const key =
      this.mushroomSlot && utils.textureExists(scene, this.mushroomSlot) ? this.mushroomSlot : '__mushfield';
    const sprite = scene.physics.add.staticSprite(x, y, key) as any;
    utils.fitDisplayContain(sprite, this.cellPx, this.cellPx);
    sprite.setTint?.(this.tintFull);
    sprite.refreshBody?.();
    sprite.__type = 'obstacle';
    sprite.__kind = 'mushroom';
    sprite.__mushroom = true;
    sprite.__mushroomField = true; // distinguish OUR field mushrooms from SegmentSplit's
    sprite.__id = id;
    if (scene.obstacles && typeof scene.obstacles.add === 'function') scene.obstacles.add(sprite);
    this.mushrooms.set(id, { id, sprite, hits: this.hitsToClear });
  }

  /**
   * Erode ONE hit-stage off the struck mushroom. While it still has hits left it fades
   * toward white (the visible erosion) and stays standing; when its last hit empties it
   * the mushroom is removed and mushroom.cleared fires.
   */
  private hitMushroom(sprite: any): void {
    const id: string | undefined = sprite.__id;
    const record = id ? this.mushrooms.get(id) : undefined;
    if (!record) return;

    record.hits -= 1;
    if (record.hits > 0) {
      // Still standing — show the erosion by fading the tint toward white.
      const t = record.hits / this.hitsToClear; // 1 → just below full, approaching 0
      sprite.setTint?.(this.fade(this.tintFull, t));
      return;
    }
    this.clearMushroom(record);
  }

  /** Remove a fully-eroded mushroom from the field + scene.obstacles, and fire the seam. */
  private clearMushroom(record: MushroomRecord): void {
    if (!this.mushrooms.has(record.id)) return;
    this.mushrooms.delete(record.id);
    const sprite = record.sprite;
    sprite?.setActive?.(false);
    sprite?.setVisible?.(false);
    if (sprite?.body) sprite.body.enable = false;
    sprite?.destroy?.();

    const remaining = this.mushroomCount();
    this.scene.mushroomsRemaining = remaining;
    // The PUSH seam: a mushroom took its last hit — it was cleared, the field count fell.
    this.bus?.emit('mushroom.cleared', { id: record.id, remaining });
  }

  /**
   * Deflect a segmented chain that ran its head into a field mushroom: reverse its
   * heading and drop the whole chain one cell down (the classic block + descent), the
   * way SegmentSplit's crawl handles an arena edge — so the standing field reshapes the
   * chain's path. The mushroom itself is untouched (it only clears under player fire).
   */
  private deflectChain(head: any): void {
    const chainId: string | undefined = head.__chainId;
    const segSplit = this.scene?.__segmentSplit;
    // Prefer the chain-aware reverse via the bound SegmentSplit system, if present.
    if (chainId && segSplit && typeof segSplit.deflectChain === 'function') {
      try {
        segSplit.deflectChain(chainId, this.cellPx);
        return;
      } catch {
        /* fall through to the local nudge below */
      }
    }
    // Fallback: nudge the struck head down a row + flip its own heading marker so the
    // chain visibly reacts even when SegmentSplit exposes no hook.
    head.__dir = -(head.__dir ?? 1);
    head.y = (head.y ?? 0) + this.cellPx;
  }

  /** Consume the bullet that struck a mushroom (one shot = one bite, no leak). */
  private consumeBullet(bullet: any): void {
    const scene = this.scene;
    const pool = scene?.__projectilePool;
    if (pool && typeof pool.release === 'function') {
      try {
        pool.release(bullet);
        return;
      } catch {
        /* a release is best-effort — fall through to a plain deactivate */
      }
    }
    bullet.setActive?.(false);
    bullet.setVisible?.(false);
    if (bullet.body) bullet.body.enable = false;
  }

  /** Lerp a packed-hex tint toward white by amount (1-t) — the erosion fade. */
  private fade(hex: number, t: number): number {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    const k = Math.max(0, Math.min(1, t));
    const nr = clamp(r + (255 - r) * (1 - k));
    const ng = clamp(g + (255 - g) * (1 - k));
    const nb = clamp(b + (255 - b) * (1 - k));
    return (nr << 16) | (ng << 8) | nb;
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - mushroom.cleared ← clearMushroom (a mushroom took its last hit — removed)  [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {
        'mushroomsRemaining': () => this.mushroomCount(),
      },
      anchors: [],
      events: [
        {
          name: 'mushroom.cleared',
          payload: '{id,remaining}',
          scope: 'archetype',
          drivenBy: 'a player bullet hits a mushroom enough times to take its last hit',
          expect:
            'that mushroom is removed from scene.obstacles ⇒ __GAME__.entities obstacle count falls and the live mushroom count (scene.mushroomsRemaining) decreases; mushroom.cleared logged',
        },
      ],
    };
  }
}
