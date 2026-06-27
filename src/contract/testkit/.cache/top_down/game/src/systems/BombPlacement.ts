/**
 * BombPlacement — the grid-bomber spine: place a cell-snapped bomb, tick its
 * fuse, then detonate a 4-direction cross-blast (system, top_down:grid-bomber).
 *
 * The Bomberman/85bits loop, as ONE scene-level system over the shared maze grid
 * (scene.__maze, the MazeGrid cell<->world + isWall source). On the place-bomb
 * input it SNAPS a bomb to the player's CURRENT grid cell (one bomb per cell),
 * arms a fuse, and on fuse-zero detonates: a cross-blast propagates per-direction
 * up to `range` cells, STOPS at a solid wall, destroys a destructible brick
 * (delegated to a DestructibleGrid hook on the scene — no-op if absent), and
 * CHAINS — a blast cell holding another ARMED bomb detonates it. A per-cycle
 * processed-bomb Set makes the chain TERMINATE (each bomb detonates at most once
 * per detonation cycle, even in a cross-shaped chain). The blast is lethal to the
 * placer too: any entity (player/enemy) standing in a blast cell takes the
 * death/lose seam (player.takeDamage → scene onPlayerDeath → status 'lost';
 * enemy.takeDamage → scene.onEnemyKilled).
 *
 * It re-implements NOTHING the engine owns: cell/world conversion + wall occupancy
 * come from scene.__maze (maze-grid.ts); a bomb is a real arcade sprite in
 * scene.obstacles tagged for __GAME__.entities (so placed→armed→detonated is
 * observable — the bomb APPEARS on place and LEAVES on detonate); the lethal seam
 * is the standard takeDamage path; the brick removal is delegated.
 *
 * Observable transitions (__GAME__):
 *   place-bomb input → a bomb at the player's cell joins __GAME__.entities (armed)
 *   fuse → 0 (or a chained blast) → the bomb leaves __GAME__.entities + a cross-
 *          blast occupies cells up to range (stopping at walls); an entity in a
 *          blast cell takes the death/lose seam; the chain terminates.
 *
 * Params (all OPTIONAL — sensible declared defaults, never a baked game constant):
 *   id          base bomb id (the $custom config.id pattern; default 'bomb'). Each
 *               placed bomb gets a unique suffix so two on the board never collide.
 *   fuseMs      ms from place→detonate (default 2000).
 *   range       blast reach in cells per direction (default 2).
 *   blastMs     ms a blast cell stays lethal/visible (default 350).
 *   damage      damage a blast cell deals to an entity in it (default 100 — lethal).
 *   maxActive   max simultaneous live bombs from this placer (default 1).
 *   bombSlot    bomb sprite texture key (placeholder rect when absent).
 *
 * GENERIC: no game/theme, no coordinate, no count is baked — the grid is the DATA
 * (scene.__maze), the cell is DERIVED from the player at place time, and a board
 * with no maze grid is a clean no-op (can't cell-snap without one).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'BombPlacement',
  intent:
    'The grid-bomber spine: on the place-bomb input snap a bomb to the player cell, tick a fuse, then detonate a 4-direction cross-blast that stops at walls, destroys bricks (delegated), chains to other armed bombs (terminating), and is lethal to any entity in a blast cell (the placer included).',
  attachesTo: 'scene',
  params: ['id', 'fuseMs', 'range', 'blastMs', 'damage', 'maxActive', 'bombSlot'],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface BombPlacementConfig {
  id?: string;
  fuseMs?: number;
  range?: number;
  blastMs?: number;
  damage?: number;
  maxActive?: number;
  bombSlot?: string;
}

/** A live bomb tracked by the system (the sprite + its grid cell + fuse deadline). */
interface LiveBomb {
  id: string;
  col: number;
  row: number;
  /** scene-clock ms the fuse fires at. */
  fuseAt: number;
  /** the on-board sprite (in scene.obstacles, tagged for __GAME__.entities). */
  sprite: any;
  /** true once it has been queued/processed in a detonation cycle (chain guard). */
  detonating: boolean;
}

export class BombPlacement implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly baseId: string;
  private readonly fuseMs: number;
  private readonly range: number;
  private readonly blastMs: number;
  private readonly damage: number;
  private readonly maxActive: number;
  private readonly bombSlot?: string;

  /** Live bombs by id (placed → armed; removed on detonate). */
  private bombs = new Map<string, LiveBomb>();
  /** Per-placer monotonic suffix so two bombs never share an id. */
  private seq = 0;
  /** Edge-detect the place button (only place on the press, not while held). */
  private placeHeld = false;

  constructor(params: BombPlacementConfig = {}) {
    this.baseId = params.id ?? 'bomb';
    this.fuseMs = Math.max(1, params.fuseMs ?? 2000);
    this.range = Math.max(1, Math.floor(params.range ?? 2));
    this.blastMs = Math.max(1, params.blastMs ?? 350);
    this.damage = Math.max(1, params.damage ?? 100);
    this.maxActive = Math.max(1, Math.floor(params.maxActive ?? 1));
    this.bombSlot = params.bombSlot;
  }

  /** Re-arm cleanly on a level restart: clear every latch + destroy stray sprites. */
  reset(): void {
    for (const b of this.bombs.values()) this.removeSprite(b);
    this.bombs.clear();
    this.seq = 0;
    this.placeHeld = false;
  }

  attach(scene: any): void {
    this.scene = scene;
  }

  /** No overlaps to wire — the blast resolves by GRID cell each detonation, not by body. */
  setupCollisions(): void {}

  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;

    // 1. PLACE on the press edge of the place-bomb input (SPACE — scene-owned).
    const pressed = this.placePressed();
    if (pressed && !this.placeHeld) this.tryPlace();
    this.placeHeld = pressed;

    // 2. FUSE: any bomb whose fuse has elapsed detonates (chains resolve inline).
    const now = this.nowMs();
    for (const b of [...this.bombs.values()]) {
      if (!b.detonating && now >= b.fuseAt) this.detonate(b);
    }
  }

  // ── place ────────────────────────────────────────────────────────────────

  /** Is the place-bomb input currently down? (SPACE — the scene owns input.) */
  private placePressed(): boolean {
    const key = this.scene?.spaceKey;
    return !!(key && key.isDown);
  }

  /** Place a bomb SNAPPED to the player's current grid cell, if the rules allow. */
  private tryPlace(): void {
    const scene = this.scene;
    const grid = scene?.__maze;
    const player = scene?.player;
    if (!grid || !player || player.isDead) return; // no grid → can't cell-snap (no-op)
    if (this.liveCount() >= this.maxActive) return; // placer's bomb budget

    const cell = grid.worldToCell(player.x, player.y);
    if (!grid.inBounds(cell.col, cell.row) || grid.isWall(cell.col, cell.row)) return;
    if (this.bombAt(cell.col, cell.row)) return; // one bomb per cell

    const center = grid.cellCenter(cell.col, cell.row);
    this.seq += 1;
    const id = `${this.baseId}_${this.seq}`;
    const sprite = this.spawnBombSprite(id, center.x, center.y, cell.col, cell.row);

    const bomb: LiveBomb = {
      id,
      col: cell.col,
      row: cell.row,
      fuseAt: this.nowMs() + this.fuseMs,
      sprite,
      detonating: false,
    };
    this.bombs.set(id, bomb);

    // bomb.placed — the armed bomb is now on the board at the player's cell.
    this.bus?.emit('bomb.placed', { id, gridX: cell.col, gridY: cell.row });
    scene.fireEffect?.('bomb.placed', center.x, center.y);
  }

  // ── detonate (with chain) ──────────────────────────────────────────────────

  /**
   * Detonate `start` and every bomb its cross-blast reaches, in ONE cycle. A
   * processed Set guarantees each bomb detonates at most once → the chain
   * TERMINATES (a 4-way cross of bombs can't loop back). Each direction stops at
   * the first solid wall (and at a brick, after destroying it).
   */
  private detonate(start: LiveBomb): void {
    const grid = this.scene?.__maze;
    if (!grid) return;

    const processed = new Set<string>();
    const queue: LiveBomb[] = [start];

    while (queue.length > 0) {
      const bomb = queue.shift()!;
      if (processed.has(bomb.id)) continue;
      processed.add(bomb.id);
      bomb.detonating = true;

      // Remove the bomb from the board FIRST so the payload carries its live cell
      // and it leaves __GAME__.entities at the detonation moment.
      this.bombs.delete(bomb.id);
      this.removeSprite(bomb);

      // bomb.detonated — fuse reached zero (or a chained blast reached it).
      this.bus?.emit('bomb.detonated', {
        id: bomb.id,
        gridX: bomb.col,
        gridY: bomb.row,
      });
      const c0 = grid.cellCenter(bomb.col, bomb.row);
      this.scene.fireEffect?.('bomb.detonated', c0.x, c0.y);

      // Resolve the cross-blast cell-by-cell, queuing any armed bomb it reaches.
      this.resolveBlast(bomb.col, bomb.row, queue, processed);
    }
  }

  /**
   * The cross-blast from (col,row): the origin cell + each of the 4 directions out
   * to `range`, STOPPING that arm at the first solid wall, and STOPPING (after
   * destroying) at a brick. Each blast cell is made lethal + queues any armed bomb
   * sitting in it (the chain).
   */
  private resolveBlast(
    col: number,
    row: number,
    queue: LiveBomb[],
    processed: Set<string>,
  ): void {
    const grid = this.scene.__maze;
    this.hitCell(col, row, queue, processed); // the origin cell is always lethal

    const dirs = [
      { dc: 0, dr: -1 },
      { dc: 0, dr: 1 },
      { dc: -1, dr: 0 },
      { dc: 1, dr: 0 },
    ];
    for (const d of dirs) {
      for (let step = 1; step <= this.range; step += 1) {
        const c = col + d.dc * step;
        const r = row + d.dr * step;
        if (grid.isWall(c, r)) break; // a solid wall stops this arm (blast doesn't pass)
        // A destructible brick (delegated) stops the arm too — after it's destroyed.
        if (this.destroyBrickAt(c, r)) break;
        this.hitCell(c, r, queue, processed);
      }
    }
  }

  /**
   * Make one blast cell lethal: paint a transient blast marker, kill any entity
   * (player/enemy) standing in it via the standard death seam, and queue any ARMED
   * bomb in the cell for chain detonation.
   */
  private hitCell(
    col: number,
    row: number,
    queue: LiveBomb[],
    processed: Set<string>,
  ): void {
    const grid = this.scene.__maze;
    const center = grid.cellCenter(col, row);
    this.spawnBlastMarker(center.x, center.y);

    // Chain: an armed bomb in this cell detonates this same cycle (terminating).
    const other = this.bombAt(col, row);
    if (other && !processed.has(other.id)) queue.push(other);

    // Lethal to entities in the cell — the placer included.
    this.killEntitiesInCell(col, row);
  }

  /**
   * Kill (lose/death seam) any player/enemy whose grid cell is (col,row). Uses the
   * standard takeDamage path: a lethal hit on the player flips status→'lost' (scene
   * onPlayerDeath); a lethal hit on an enemy routes through scene.onEnemyKilled.
   */
  private killEntitiesInCell(col: number, row: number): void {
    const scene = this.scene;
    const grid = scene.__maze;

    const player = scene.player;
    if (player && player.active !== false && !player.isDead) {
      const pc = grid.worldToCell(player.x, player.y);
      if (pc.col === col && pc.row === row) player.takeDamage?.(this.damage);
    }

    const group = scene.enemies;
    if (group && typeof group.getChildren === 'function') {
      for (const e of [...group.getChildren()]) {
        if (!e || e.active === false || e.isDead) continue;
        const ec = grid.worldToCell(e.x, e.y);
        if (ec.col !== col || ec.row !== row) continue;
        const wasDead = e.isDead;
        e.takeDamage?.(this.damage);
        if (!wasDead && e.isDead) scene.onEnemyKilled?.(e);
      }
    }
  }

  // ── brick delegation (DestructibleGrid) ─────────────────────────────────────

  /**
   * Destroy a destructible brick at (col,row), DELEGATED to a DestructibleGrid hook
   * on the scene (its sibling system publishes one). Returns true iff a brick was
   * there (so the blast arm stops AT it). A board with no brick system is a clean
   * no-op → false (the arm continues), so this never hard-depends on the sibling.
   */
  private destroyBrickAt(col: number, row: number): boolean {
    const scene = this.scene;
    const dg = scene.destructibleGrid ?? scene.bricks;
    if (dg && typeof dg.destroyBrickAt === 'function') {
      return !!dg.destroyBrickAt(col, row);
    }
    if (typeof scene.destroyBrickAt === 'function') {
      return !!scene.destroyBrickAt(col, row);
    }
    return false;
  }

  // ── sprites ──────────────────────────────────────────────────────────────

  /**
   * Spawn the bomb as a real arcade sprite in scene.obstacles, tagged so it shows
   * in __GAME__.entities (type 'bomb', the id, and its grid cell). A texture key is
   * used when the slot resolves; else a placeholder rectangle (zone-bodied).
   */
  private spawnBombSprite(id: string, x: number, y: number, col: number, row: number): any {
    const scene = this.scene;
    const ts = scene.__maze?.tileSize ?? 32;
    const size = Math.max(8, ts * 0.8);
    let sprite: any;
    if (this.bombSlot && scene.textures?.exists?.(this.bombSlot)) {
      sprite = scene.physics.add.sprite(x, y, this.bombSlot);
      sprite.setDisplaySize?.(size, size);
    } else {
      sprite = scene.add.rectangle(x, y, size, size, 0x222222);
      scene.physics.add.existing(sprite);
    }
    sprite.__id = id;
    sprite.__type = 'bomb';
    sprite.gridX = col;
    sprite.gridY = row;
    const body = sprite.body;
    if (body) {
      body.setAllowGravity?.(false);
      body.immovable = true;
    }
    scene.obstacles?.add?.(sprite);
    return sprite;
  }

  /** A transient blast-cell marker (cosmetic; auto-clears after blastMs). */
  private spawnBlastMarker(x: number, y: number): void {
    const scene = this.scene;
    const ts = scene.__maze?.tileSize ?? 32;
    const size = Math.max(8, ts * 0.9);
    const rect = scene.add?.rectangle?.(x, y, size, size, 0xff7a1a, 0.7);
    if (!rect) return;
    scene.time?.delayedCall?.(this.blastMs, () => rect.destroy?.());
  }

  /** Remove a bomb's sprite from the board (so it leaves __GAME__.entities). */
  private removeSprite(bomb: LiveBomb): void {
    const sprite = bomb?.sprite;
    if (!sprite) return;
    const body = sprite.body;
    if (body) body.enable = false;
    this.scene?.obstacles?.remove?.(sprite, false, false);
    sprite.destroy?.();
    bomb.sprite = null;
  }

  // ── small helpers ──────────────────────────────────────────────────────────

  /** The bomb occupying (col,row), if any (one bomb per cell). */
  private bombAt(col: number, row: number): LiveBomb | undefined {
    for (const b of this.bombs.values()) {
      if (b.col === col && b.row === row) return b;
    }
    return undefined;
  }

  /** Live bombs not yet detonating (the placer's active budget). */
  private liveCount(): number {
    let n = 0;
    for (const b of this.bombs.values()) if (!b.detonating) n += 1;
    return n;
  }

  /** The scene clock now (ms); 0-safe before attach. */
  private nowMs(): number {
    return this.scene?.time?.now ?? 0;
  }

  // ── component surface (the declared PUSH-channel events this system emits) ──

  /**
   * The uniform component surface. Declares the two grid-bomber moments this system
   * emits on the shared bus — each a TRUE statement about a real emit site in this
   * file:
   *   - bomb.placed    ← tryPlace   (a bomb is snapped to the player cell + armed)
   *   - bomb.detonated ← detonate   (fuse-zero or a chained blast; bomb leaves +
   *                                  cross-blast + lethal seam + chain terminates)
   * Observables stay on the existing __GAME__ entities adapter (the bomb sprite is
   * tagged), so this surface declares only the PUSH channel + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'bomb.placed',
          payload: '{id,gridX,gridY}',
          scope: 'archetype',
          drivenBy: 'place-bomb input on the player cell',
          expect:
            'a bomb appears at the player grid cell in __GAME__.entities with an armed fuse; bomb.placed logged',
        },
        {
          name: 'bomb.detonated',
          payload: '{id,gridX,gridY}',
          scope: 'archetype',
          drivenBy: "a bomb's fuse reaches zero (or a chained blast reaches it)",
          expect:
            'the bomb leaves __GAME__.entities and a cross-blast occupies cells up to range stopping at solid walls; any entity in a blast cell takes the death/lose seam; the chain terminates; bomb.detonated logged',
        },
      ],
    };
  }
}
