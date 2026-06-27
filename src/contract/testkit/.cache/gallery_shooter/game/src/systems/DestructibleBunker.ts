/**
 * DestructibleBunker — the ERODING SHIELD-BUNKER system (BUILD — gallery-shooter
 * engine piece, the `fixed-axis` genre). The Space-Invaders cover the player crouches
 * behind: a small row of shield bunkers floats ABOVE the cannon, and each is built
 * from a GRID of small CELL sprites. BOTH the player's upward shots AND the enemies'
 * downward bombs chew the bunkers away ONE CELL AT A TIME — the cover erodes hit-by-hit
 * until a window opens and finally the whole bunker is gone. Real cover that genuinely
 * shrinks, not a single hit-point sponge.
 *
 * This system is SELF-CONTAINED — it OWNS its own bunker cells (it does not lean on the
 * scene's data-built bunkers). It mirrors the sibling systems' exact shape
 * (TrajectoryInterceptor): an ISceneSystem with reset()/attach()/setupCollisions()/
 * update(), reaching the shared bus via this.scene.eventBus and surfacing its cells
 * through the engine's KNOWN group so __GAME__.entities sees them with ZERO extra hook
 * wiring:
 *   - every bunker CELL rides scene.obstacles → surfaces as type 'obstacle'
 *     (the live cell count = the cover-remaining signal).
 *
 * OBSERVABLE (the contract — what a verify run polls):
 *   - DAMAGE:  a shot (player bullet OR enemy bullet) overlaps a cell → that ONE cell
 *              is removed from scene.obstacles → __GAME__.entities obstacle count falls
 *              (the bunker visibly erodes).
 *   - DESTROY: when a bunker's LAST cell is removed the bunker is gone → the live
 *              bunkers-remaining count (mirrored onto scene.bunkersRemaining) decreases.
 *
 * It owns NO firing (ProjectilePool / ScrollShmup do) — it only registers the bullet↔cell
 * overlaps and erodes the cell that was struck. It wires against BOTH bullet groups that
 * may exist (scene.playerBullets always; scene.enemyBullets when a shmup layer is bound),
 * so a bunker erodes under fire from either side. A level that binds it with zero bunkers
 * is a clean no-op (it builds nothing).
 *
 * GENERIC: no game/theme, no baked coordinate. Bunker centers, the cell grid shape, the
 * cell size, and the damage-per-hit all come from params with declared sensible defaults.
 *
 * EVENTS (the PUSH channel):
 *   - bunker.damaged   ← erodeCell (a shot hit a cell — that cell was removed)
 *   - bunker.destroyed ← erodeCell (a bunker's last cell was removed)
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible defaults):
 *   bunkers       array of {id?,x,y} bunker CENTERS (default: 3 bunkers spread across
 *                 the arena, ~120px above the bottom — a sensible Space-Invaders row).
 *   bunkerCount   how many default bunkers to lay out when `bunkers` is omitted (default 3).
 *   cols          cells across one bunker (default 6).
 *   rows          cells down one bunker (default 4).
 *   cellSize      one cell's square display size px (default 9).
 *   cellGap       gap between cell centers px (default 1 ⇒ cells abut).
 *   bunkerY       y (px) of the default bunker row centers (default mapHeight - 150).
 *   damagePerHit  how many cells one shot erodes (default 1 — the classic single bite).
 *   cellTint      cell color when no asset (default 0x3fb27f, the green cover).
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'DestructibleBunker',
  intent:
    'Eroding shield bunkers above the player: each bunker is a grid of cells that both player shots and enemy fire chew away one cell at a time, until a window opens and finally the bunker is gone. Cells ride scene.obstacles so __GAME__.entities erodes hit-by-hit; the bunkers-remaining count falls as each bunker is fully destroyed. The gallery-shooter destructible-cover system.',
  attachesTo: 'scene',
  params: [
    'bunkers',
    'bunkerCount',
    'cols',
    'rows',
    'cellSize',
    'cellGap',
    'bunkerY',
    'damagePerHit',
    'cellTint',
  ],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** One bunker's center placement (the id source: a config param, or auto-derived). */
export interface BunkerSpec {
  id?: string;
  x: number;
  y: number;
}

export interface DestructibleBunkerConfig {
  bunkers?: BunkerSpec[];
  bunkerCount?: number;
  cols?: number;
  rows?: number;
  cellSize?: number;
  cellGap?: number;
  bunkerY?: number;
  damagePerHit?: number;
  cellTint?: number;
}

/** Internal bookkeeping for one bunker: its id + the live cells that compose it. */
interface BunkerRecord {
  id: string;
  cells: Set<any>;
  destroyed: boolean;
}

export class DestructibleBunker implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly bunkerSpecs: BunkerSpec[];
  private readonly bunkerCount: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellSize: number;
  private readonly cellGap: number;
  private readonly bunkerYParam?: number;
  private readonly damagePerHit: number;
  private readonly cellTint: number;

  /** Every bunker this system owns (live ∪ destroyed). */
  private bunkers: BunkerRecord[] = [];

  constructor(params: DestructibleBunkerConfig = {}) {
    this.bunkerSpecs = Array.isArray(params.bunkers) ? params.bunkers : [];
    this.bunkerCount = Math.max(0, Math.floor(params.bunkerCount ?? 3));
    this.cols = Math.max(1, Math.floor(params.cols ?? 6));
    this.rows = Math.max(1, Math.floor(params.rows ?? 4));
    this.cellSize = Math.max(2, params.cellSize ?? 9);
    this.cellGap = Math.max(0, params.cellGap ?? 1);
    this.bunkerYParam = params.bunkerY;
    this.damagePerHit = Math.max(1, Math.floor(params.damagePerHit ?? 1));
    this.cellTint = params.cellTint ?? 0x3fb27f;
  }

  reset(): void {
    for (const b of this.bunkers) {
      for (const c of b.cells) c?.destroy?.();
    }
    this.bunkers = [];
  }

  attach(scene: any): void {
    this.scene = scene;
    // Reuse the engine's known group so __GAME__.entities sees our cells with no extra
    // hook wiring: every bunker cell is an 'obstacle' entity (the eroding cover).
    if (!scene.obstacles || typeof scene.obstacles.getChildren !== 'function') {
      scene.obstacles = scene.physics.add.group();
    }
    // Build every bunker from its grid of cells.
    for (const spec of this.resolveBunkerSpecs()) this.buildBunker(spec);
    // Mirror the live bunkers-remaining count onto the scene (the observable extra) +
    // publish self so the scene / diagnostics / verify driver can read the live counts.
    scene.bunkersRemaining = this.bunkersRemaining();
    scene.__destructibleBunker = this;
  }

  /**
   * Wire the bullet↔cell overlaps this system owns. BOTH fire sources erode the cover:
   *   - player bullet (scene.playerBullets) ↔ cell  → erode that cell;
   *   - enemy bullet  (scene.enemyBullets)  ↔ cell  → erode that cell.
   * The enemyBullets group only exists when a shmup layer (ScrollShmup) is bound; we
   * guard for it so a base fixed-axis level still erodes under the player's shots.
   */
  setupCollisions(): void {
    const scene = this.scene;
    if (!scene || !scene.obstacles) return;

    if (scene.playerBullets) {
      scene.physics.add.overlap(scene.playerBullets, scene.obstacles, (bullet: any, cell: any) => {
        if (!cell || cell.active === false || !cell.__bunkerCell) return;
        if (!bullet || bullet.active === false) return;
        this.consumeBullet(bullet);
        this.erodeCell(cell);
      });
    }

    if (scene.enemyBullets) {
      scene.physics.add.overlap(scene.enemyBullets, scene.obstacles, (bullet: any, cell: any) => {
        if (!cell || cell.active === false || !cell.__bunkerCell) return;
        if (!bullet || bullet.active === false) return;
        this.consumeBullet(bullet);
        this.erodeCell(cell);
      });
    }
  }

  /** No per-frame work — the bunkers are static cover; erosion is overlap-driven. */
  update(): void {}

  // ── live counts (EXPOSED for the observable proofs) ───────────────────────────

  /** Bunkers still standing (at least one live cell). */
  public bunkersRemaining(): number {
    return this.bunkers.filter((b) => !b.destroyed).length;
  }

  /** Total live cells across all bunkers (surfaces too as obstacle entities). */
  public cellsRemaining(): number {
    let n = 0;
    for (const b of this.bunkers) n += b.cells.size;
    return n;
  }

  // ── internals ─────────────────────────────────────────────────────────────────

  /** The bunker centers to build: explicit param specs, else a sensible default row. */
  private resolveBunkerSpecs(): BunkerSpec[] {
    if (this.bunkerSpecs.length > 0) return this.bunkerSpecs;
    const scene = this.scene;
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    const H = scene.mapHeight ?? scene.scale?.height ?? 768;
    const y = this.bunkerYParam ?? H - 150;
    const n = this.bunkerCount;
    if (n <= 0) return [];
    // Evenly spread n bunkers across the arena width (centered slots).
    const out: BunkerSpec[] = [];
    for (let i = 0; i < n; i += 1) {
      const x = (W * (i + 1)) / (n + 1);
      out.push({ id: `bunker_${i}`, x, y });
    }
    return out;
  }

  /** Build ONE bunker: a rows×cols grid of cell sprites centered on (spec.x, spec.y). */
  private buildBunker(spec: BunkerSpec): void {
    const scene = this.scene;
    const id = spec.id ?? `bunker_${this.bunkers.length}`;
    const record: BunkerRecord = { id, cells: new Set(), destroyed: false };

    const step = this.cellSize + this.cellGap;
    const gridW = this.cols * step - this.cellGap;
    const gridH = this.rows * step - this.cellGap;
    const left = spec.x - gridW / 2 + this.cellSize / 2;
    const top = spec.y - gridH / 2 + this.cellSize / 2;

    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const cx = left + col * step;
        const cy = top + row * step;
        const cell = this.makeCell(cx, cy, id, row, col);
        record.cells.add(cell);
        scene.obstacles.add(cell);
      }
    }
    this.bunkers.push(record);
  }

  /** Allocate ONE bunker cell as a static obstacle sprite. */
  private makeCell(x: number, y: number, bunkerId: string, row: number, col: number): any {
    const scene = this.scene;
    const sprite = scene.physics.add.staticSprite(x, y, '__px') as any;
    if (typeof sprite.setDisplaySize === 'function') {
      sprite.setDisplaySize(this.cellSize, this.cellSize);
    }
    sprite.setTint?.(this.cellTint);
    sprite.refreshBody?.();
    sprite.__type = 'obstacle';
    sprite.__kind = 'bunker';
    sprite.__bunkerCell = true;
    sprite.__bunkerId = bunkerId;
    sprite.__id = `${bunkerId}_c${row}_${col}`;
    return sprite;
  }

  /**
   * Erode the struck cell (and, when damagePerHit > 1, its immediate neighbours): remove
   * it from scene.obstacles and fire bunker.damaged. When a bunker loses its LAST cell,
   * fire bunker.destroyed once and decrement the bunkers-remaining count.
   */
  private erodeCell(cell: any): void {
    const record = this.bunkers.find((b) => b.cells.has(cell));
    if (!record) return;

    const victims = this.pickVictims(record, cell);
    for (const v of victims) this.removeCell(record, v);

    // The PUSH seam: a shot hit a bunker cell — that cell eroded (obstacle count fell).
    this.bus?.emit('bunker.damaged', {
      bunkerId: record.id,
      remaining: record.cells.size,
    });

    if (record.cells.size === 0 && !record.destroyed) {
      record.destroyed = true;
      this.scene.bunkersRemaining = this.bunkersRemaining();
      // The PUSH seam: a bunker was fully eroded — bunkers-remaining decreased.
      this.bus?.emit('bunker.destroyed', {
        bunkerId: record.id,
        remaining: this.bunkersRemaining(),
      });
    }
  }

  /** Choose the cells one hit erodes: the struck cell, plus nearest others if damage>1. */
  private pickVictims(record: BunkerRecord, struck: any): any[] {
    if (this.damagePerHit <= 1) return [struck];
    const others = [...record.cells].filter((c) => c !== struck);
    others.sort((a, b) => this.dist2(a, struck) - this.dist2(b, struck));
    return [struck, ...others.slice(0, this.damagePerHit - 1)];
  }

  private dist2(a: any, b: any): number {
    const dx = (a?.x ?? 0) - (b?.x ?? 0);
    const dy = (a?.y ?? 0) - (b?.y ?? 0);
    return dx * dx + dy * dy;
  }

  /** Remove ONE cell from its bunker + scene.obstacles (idempotent). */
  private removeCell(record: BunkerRecord, cell: any): void {
    if (!record.cells.has(cell)) return;
    record.cells.delete(cell);
    cell.setActive?.(false);
    cell.setVisible?.(false);
    if (cell.body) cell.body.enable = false;
    cell.destroy?.();
  }

  /** Consume the bullet that struck a cell (so one shot erodes one bite, then stops). */
  private consumeBullet(bullet: any): void {
    // A player bullet is pooled — let ProjectilePool reclaim it via its own deactivate
    // path by deactivating here; an enemy bullet is plain — destroy it. Both honour the
    // "a shot is spent on the cover it hits" rule without leaking.
    bullet.setActive?.(false);
    bullet.setVisible?.(false);
    if (bullet.body) bullet.body.enable = false;
    if (bullet.__type === 'projectile' && bullet.__kind === 'enemyBullet') {
      bullet.destroy?.();
    }
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One true
   * statement per real emit site:
   *   - bunker.damaged   ← erodeCell (a shot hit a cell — that cell was removed)   [archetype]
   *   - bunker.destroyed ← erodeCell (a bunker's last cell was removed)            [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {
        'bunkersRemaining': () => this.bunkersRemaining(),
        'bunkerCells': () => this.cellsRemaining(),
      },
      anchors: [],
      events: [
        {
          name: 'bunker.damaged',
          payload: '{bunkerId,remaining}',
          scope: 'archetype',
          drivenBy: 'a shot (player bullet or enemy bullet) hits a bunker cell',
          expect:
            'that bunker cell is removed from scene.obstacles ⇒ __GAME__.entities obstacle count falls (the bunker erodes); bunker.damaged logged',
        },
        {
          name: 'bunker.destroyed',
          payload: '{bunkerId,remaining}',
          scope: 'archetype',
          drivenBy: "a bunker's last cell is eroded",
          expect:
            'the live bunkers-remaining count (scene.bunkersRemaining) decreases; bunker.destroyed logged',
        },
      ],
    };
  }
}
