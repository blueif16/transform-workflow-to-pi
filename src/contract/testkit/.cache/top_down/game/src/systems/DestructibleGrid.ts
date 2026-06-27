/**
 * DestructibleGrid — the grid-bomber BREAKABLE-WALL layer (BUILD — system; DR §9
 * grid-bomber; tile types GROUND / BRICK(destroy) / WALL(stop)).
 *
 * The genre's spatial substrate: a maze of cells split into THREE kinds —
 *   - FLOOR : walkable; a blast passes through it.
 *   - BRICK : a BREAKABLE wall; solid until a blast reaches it, then it clears to
 *             floor and becomes passable (the genre's "bomb the bricks" loop).
 *   - WALL  : an INDESTRUCTIBLE wall; solid forever — a blast STOPS at it.
 *
 * This system OWNS only the brick (breakable) layer — the indestructible '#' walls
 * are already built as static collision by the scene (DataTopDownScene.createWalls
 * → groundLayer). It builds one static brick sprite per brick cell, makes them
 * solid (a collider vs the player + enemies), and ALSO pushes each into the scene's
 * `obstacles` group so a live brick is counted in __GAME__.entities (the observable
 * the contract reads). The BOMB/BLAST is a SIBLING custom[] delta (the genre's
 * named BombPlacement component); its propagation READS + MUTATES this layer through
 * the seam it publishes on the scene by name:
 *
 *   scene.destructibleGrid.destroyBrickAt(gridX, gridY) -> boolean
 *
 * The blast WALKS each arm and (per the genre check) STOPS at an indestructible '#'
 * wall on its OWN (grid.isWall) — that wall is never this layer's to touch. At each
 * cell the arm reaches it calls destroyBrickAt(): a brick there is DESTROYED (returns
 * TRUE so the arm STOPS at it, after clearing it) — the sprite is removed (so the
 * destructible-wall count in __GAME__ drops by one), the cell becomes passable, and
 * `wall.destroyed {gridX,gridY}` is emitted on the shared bus; an empty cell returns
 * FALSE (the arm continues). The richer tileAt()/tryDestroyAt() helpers expose the
 * same logic as a tile kind ('floor'|'brick'|'wall') for any consumer that prefers it.
 *
 * GRID SOURCE = level DATA (never a baked layout). The brick cells come from the
 * maze legend (scene.__maze): any legend char in `brickChars` (default 'B'/'b') is
 * a brick cell — the SAME geometry helper (maze-grid.ts originX/originY/tileSize)
 * every maze entity reads, so a brick's grid cell <-> its world centre never drifts.
 * A level WITHOUT a maze may instead pass an explicit `bricks[]` data array of
 * {gridX,gridY} cells + the grid metrics (tileSize/originX/originY). Either way the
 * layout is DATA and a destroyed cell's id is AUTO-DERIVED from its (gridX,gridY) —
 * no per-cell config.id is invented.
 *
 * Params (all OPTIONAL — sensible declared defaults, never a baked map):
 *   brickChars   maze legend chars treated as a breakable brick (default ['B','b']).
 *   bricks       fallback brick cells when there is no maze: [{gridX,gridY}, …].
 *   tileSize     grid metrics for the `bricks` fallback (default 32).
 *   originX      grid origin x for the `bricks` fallback (default 0).
 *   originY      grid origin y for the `bricks` fallback (default 0).
 *   brickColor   tint for a brick sprite with no real texture (default 0xb5651d).
 *   brickSlot    texture KEY for a brick sprite (default 'wall' / the level wallSlot).
 *
 * Lifecycle (the SDK ISceneSystem contract): reset() clears the built brick set so a
 * restarted level rebuilds cleanly; attach() builds the bricks; setupCollisions()
 * makes them solid. GENERIC: no game/theme, no coordinate is baked — only DATA + math.
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import type { ComponentSurface, EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors every system file). */
export const CAPABILITY = {
  kind: 'system',
  id: 'DestructibleGrid',
  intent:
    'Track a breakable-BRICK layer vs the indestructible WALL layer of a grid-bomber maze; a blast clears a brick cell to floor (passable; destructible-wall count -1) and STOPS at an indestructible wall. The sibling bomb/blast (BombPlacement) clears a brick via scene.destructibleGrid.destroyBrickAt(gridX,gridY).',
  attachesTo: 'scene',
  params: ['brickChars', 'bricks', 'tileSize', 'originX', 'originY', 'brickColor', 'brickSlot'],
  roles: ['player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** A grid cell the fallback `bricks[]` data carries. */
export interface BrickCell {
  gridX: number;
  gridY: number;
}

export interface DestructibleGridConfig {
  brickChars?: string[];
  bricks?: BrickCell[];
  tileSize?: number;
  originX?: number;
  originY?: number;
  brickColor?: number;
  brickSlot?: string;
}

/** What kind of tile occupies a grid cell (the blast reads this to propagate/stop). */
export type GridTile = 'floor' | 'brick' | 'wall';

export class DestructibleGrid implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  /** Live brick sprites keyed by "gridX,gridY" (one per breakable cell). */
  private bricks = new Map<string, any>();
  /** Static collision group holding the brick bodies (solid until destroyed). */
  private brickGroup: any = null;

  private readonly brickChars: string[];
  private readonly fallbackBricks: BrickCell[];
  private readonly fallbackTileSize: number;
  private readonly fallbackOriginX: number;
  private readonly fallbackOriginY: number;
  private readonly brickColor: number;
  private readonly brickSlotParam?: string;

  constructor(params: DestructibleGridConfig = {}) {
    this.brickChars = params.brickChars ?? ['B', 'b'];
    this.fallbackBricks = params.bricks ?? [];
    this.fallbackTileSize = params.tileSize ?? 32;
    this.fallbackOriginX = params.originX ?? 0;
    this.fallbackOriginY = params.originY ?? 0;
    this.brickColor = params.brickColor ?? 0xb5651d;
    this.brickSlotParam = params.brickSlot;
  }

  /** Clear the built brick set so a restarted level rebuilds from data (replayable). */
  reset(): void {
    this.bricks.clear();
    this.brickGroup = null;
  }

  /** Build the breakable-brick layer from DATA (maze legend, else the bricks[] fallback). */
  attach(scene: any): void {
    this.scene = scene;
    // Publish the read seam under the name the sibling bomb/blast (BombPlacement)
    // looks up: scene.destructibleGrid.destroyBrickAt(col,row). __destructibleGrid is
    // an additional alias for any consumer that reaches the layer by that name.
    scene.destructibleGrid = this;
    scene.__destructibleGrid = this;

    const metrics = this.gridMetrics();
    if (!metrics) return;
    const { tileSize, originX, originY } = metrics;

    const slot = this.brickSlotParam ?? scene.levelData?.wallSlot;
    const hasTex = !!slot && scene.textures?.exists?.(slot);
    this.brickGroup = scene.physics.add.staticGroup();

    for (const cell of this.brickCells()) {
      const cx = originX + cell.gridX * tileSize + tileSize / 2;
      const cy = originY + cell.gridY * tileSize + tileSize / 2;
      const brick = scene.physics.add.staticSprite(cx, cy, hasTex ? slot : '__px');
      brick.setDisplaySize(tileSize, tileSize);
      if (!hasTex) {
        // No real texture: ensure the placeholder exists + tint it a brick colour.
        if (!scene.textures.exists('__px')) {
          scene.textures.generate?.('__px', { data: ['1'], pixelWidth: 8 });
        }
        brick.setTexture('__px');
        brick.setTint(this.brickColor);
      }
      brick.refreshBody();
      // Tag so __GAME__.entities reports it as a destructible wall with its cell id.
      brick.__type = 'wall';
      brick.__id = `brick_${cell.gridX}_${cell.gridY}`;
      brick.__destructible = true;
      brick.gridX = cell.gridX;
      brick.gridY = cell.gridY;

      this.brickGroup.add(brick);
      // ALSO surface it in the scene's obstacles group so the hook counts it (the
      // observable __GAME__ destructible-wall count) — destroying it drops the count.
      scene.obstacles?.add?.(brick);
      this.bricks.set(this.key(cell.gridX, cell.gridY), brick);
    }
  }

  /** Make the bricks solid: the player + enemies collide with the brick layer. */
  setupCollisions(): void {
    const scene = this.scene;
    if (!scene || !this.brickGroup) return;
    if (scene.player) scene.physics.add.collider(scene.player, this.brickGroup);
    if (scene.enemies) scene.physics.add.collider(scene.enemies, this.brickGroup);
  }

  /**
   * What occupies a grid cell — the seam the blast WALKS to propagate. A blast steps
   * outward until tileAt() returns 'wall' (then it halts there) or it spends its range.
   */
  tileAt(gridX: number, gridY: number): GridTile {
    if (this.bricks.has(this.key(gridX, gridY))) return 'brick';
    // An indestructible '#' wall (the maze legend) or out-of-bounds halts a blast.
    const maze = this.scene?.__maze;
    if (maze && typeof maze.isWall === 'function' && maze.isWall(gridX, gridY)) {
      return 'wall';
    }
    return 'floor';
  }

  /**
   * The active call at the cell a blast REACHES.
   *   - a 'brick' is DESTROYED: the sprite is removed (destructible-wall count -1),
   *     the cell becomes passable, and `wall.destroyed {gridX,gridY}` is emitted.
   *   - a 'wall' is returned unchanged (the blast STOPS, does not pass it).
   *   - a 'floor' is a clean no-op.
   * Returns the tile kind the blast found at that cell (so the caller can stop on 'wall').
   */
  tryDestroyAt(gridX: number, gridY: number): GridTile {
    const tile = this.tileAt(gridX, gridY);
    if (tile !== 'brick') return tile; // 'wall' stops the blast; 'floor' is a no-op
    const k = this.key(gridX, gridY);
    const brick = this.bricks.get(k);
    this.bricks.delete(k);
    if (brick) {
      this.brickGroup?.remove?.(brick, false, false);
      this.scene?.obstacles?.remove?.(brick, false, false);
      brick.destroy(); // drops it from the live world → __GAME__ count -1, cell passable
    }
    // The true gameplay seam: a brick left __GAME__ (count -1) and the cell is now floor.
    this.bus?.emit('wall.destroyed', { gridX, gridY });
    return 'brick';
  }

  /**
   * The PRIMARY blast seam the sibling bomb/blast (BombPlacement) calls at each
   * cell its arm reaches: destroy the brick there if present. Returns TRUE iff a
   * brick was destroyed (so the blast arm STOPS at it, after clearing it) — FALSE
   * when the cell holds no brick (the arm continues into floor). A 'brick' hit
   * removes the sprite (destructible-wall count -1), makes the cell passable, and
   * emits `wall.destroyed`. Indestructible '#' walls are the blast's own concern
   * (it checks grid.isWall before calling here), so this never destroys one.
   */
  destroyBrickAt(gridX: number, gridY: number): boolean {
    return this.tryDestroyAt(gridX, gridY) === 'brick';
  }

  /** Count of breakable bricks still standing (the live destructible-wall count). */
  destructibleWallCount(): number {
    return this.bricks.size;
  }

  // ── component surface (the declared PUSH-channel event set) ──────────────────

  /**
   * The event this layer publishes. `wall.destroyed` is a TRUE statement about the
   * real emit site in tryDestroyAt(): when a blast clears a brick, the brick leaves
   * __GAME__ (destructible-wall count -1), the cell becomes passable, and the event
   * is logged. Observable: a brick entity disappears from __GAME__.entities.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'wall.destroyed',
          payload: '{gridX,gridY}',
          scope: 'archetype',
          drivenBy: 'a blast cell reaches a breakable brick',
          expect:
            'the brick leaves __GAME__ (destructible-wall count -1) and the cell becomes passable; wall.destroyed logged',
        },
      ],
    };
  }

  // ── internals (generic, data-driven) ─────────────────────────────────────────

  /** Stable cell key. */
  private key(gridX: number, gridY: number): string {
    return `${gridX},${gridY}`;
  }

  /** The grid metrics to lay bricks on: the maze's (preferred) else the fallback params. */
  private gridMetrics(): { tileSize: number; originX: number; originY: number } | null {
    const maze = this.scene?.__maze;
    if (maze && typeof maze.tileSize === 'number') {
      return { tileSize: maze.tileSize, originX: maze.originX ?? 0, originY: maze.originY ?? 0 };
    }
    if (this.fallbackBricks.length > 0) {
      return {
        tileSize: this.fallbackTileSize,
        originX: this.fallbackOriginX,
        originY: this.fallbackOriginY,
      };
    }
    return null;
  }

  /** The brick cells from DATA: the maze legend's brick chars, else the bricks[] fallback. */
  private brickCells(): BrickCell[] {
    const maze = this.scene?.__maze;
    const out: BrickCell[] = [];
    if (maze && Array.isArray(maze.raw)) {
      const chars = new Set(this.brickChars);
      for (let row = 0; row < maze.raw.length; row += 1) {
        const line = maze.raw[row] as string;
        for (let col = 0; col < line.length; col += 1) {
          if (chars.has(line[col])) out.push({ gridX: col, gridY: row });
        }
      }
      if (out.length > 0) return out;
    }
    return this.fallbackBricks.slice();
  }
}
