/**
 * ============================================================================
 * DataGridScene — the DATA-DRIVEN grid-board level loader (KEEP — engine)
 * ============================================================================
 *
 * Builds an ENTIRE grid_logic level from a `GridLevelData` object as DATA — the
 * board geometry (rows/cols/cellSize/origin), the seeded opening tiles, the win
 * target, the spawn table, the bound move-RULE behavior, the bound control scheme,
 * and the registered systems[] — with ZERO per-game code. The blueprint's `layout`
 * + capability BINDINGS become this data (W2 materializes `src/levels/<level>.json`
 * from them); the SDK instantiates it.
 *
 * It is the grid_logic analogue of top_down's `DataTopDownScene` (and platformer's
 * DataLevelScene). It is a Phaser.Scene (coreBase 'core' = Phaser 2D) but uses NO
 * physics — the world is the LOGICAL board (the two-worlds rule): the move resolver
 * computes a new grid (the logic), the scene then re-paints the tile sprites to
 * match (the visuals). Every engine invariant is asserted on board.snapshot().
 *
 * THE CORE LOOP (per move, the move-resolution discipline):
 *   keydown edge -> the bound control scheme maps it to a direction INTENT ->
 *   the bound behavior.resolve(grid, intent) -> { grid', changed, scoreDelta } ->
 *   IF changed: apply grid', add scoreDelta, spawn ONE tile on an empty cell
 *   (INV-3), re-paint, notify systems[].onMove (win/lose, INV-4/INV-5).
 *   A no-op move (changed:false) spawns NOTHING.
 *
 * It exposes window.__GAME__ via the core hook (core/src/hook.ts reads scene.player
 * + scene.board): the "player" is the BOARD CURSOR — its gridX/gridY is the
 * highest-value tile's cell, a REAL observable position that CHANGES under a move
 * input (the controllable proof) without a free-moving avatar.
 *
 * GENERIC: no game/theme is encoded here. A game's strings live ONLY in the
 * materialized levels/<level>.json.
 */
import Phaser from 'phaser';
import { GridBoard } from '../board/GridBoard';
import { GridMap } from '../board/grid-map';
import { spawnTile, DEFAULT_SPAWN, type SpawnWeight } from '../board/spawn';
import { resolveBehavior, type GridBehaviorClass } from '../behaviors/registry';
import type { IGridBehavior } from '../behaviors/IGridBehavior';
import { resolveSystem } from '../systems/registry';
import { resolveScheme, DEFAULT_SCHEME, type GridScheme, type GridIntent } from '../controls';
import { resolveCustomBehavior, resolveCustomSystem } from './custom-registry';
import type { GridLevelData, IGridSystem } from './grid-data';
import { EventBus, type ComponentSurface } from '@contract/component-surface';

/** Default board geometry when the level data omits it. */
const DEFAULT_CELL = 96;
const DEFAULT_WIN_TARGET = 2048;
/** A tile value -> a greybox tint (the value ramp; a real game overrides via tileSlots). */
const TILE_TINTS: Record<number, number> = {
  2: 0xeee4da, 4: 0xede0c8, 8: 0xf2b179, 16: 0xf59563, 32: 0xf67c5f,
  64: 0xf65e3b, 128: 0xedcf72, 256: 0xedcc61, 512: 0xedc850,
  1024: 0xedc53f, 2048: 0xedc22e,
};

export abstract class DataGridScene extends Phaser.Scene {
  /** The level data this scene instantiates (set by the subclass constructor). */
  protected readonly levelData: GridLevelData;

  /** The LOGICAL board — the single source of truth (read by the hook + verify). */
  public board!: GridBoard;
  /** The cell<->pixel adapter (ONE home for the mapping — INV-6). */
  public gridMap!: GridMap;
  /** The bound move-RULE behavior (merge-slide: MergeSlide). */
  private rule!: IGridBehavior;
  /** The resolved control scheme (key -> intent map). */
  protected scheme: GridScheme = DEFAULT_SCHEME;
  /** The active scene systems (registered systems[] + custom[]). */
  protected systems: IGridSystem[] = [];

  /** The win target value (read by MergeSlideGoal; from level data) — INV-4. */
  public winTarget = DEFAULT_WIN_TARGET;
  /** The spawn-value table — INV-3 DELTA. */
  private spawnTable: SpawnWeight[] = DEFAULT_SPAWN;

  /** Flag to prevent multiple completion triggers (the engine win/lose latch). */
  public gameCompleted = false;
  /** Latched true after the first interactive frame (drives __GAME__.ready). */
  private _readyLatched = false;
  /** Move counter (drives __GAME__.moveCount). */
  public moveCount = 0;
  /** Last status published as level.statusChanged (de-dupe per transition). */
  private _lastStatus: string | undefined = undefined;

  /**
   * The board cursor — the "player" the core hook reads. gridX/gridY track the
   * HIGHEST-value tile's cell (a real, observable position that CHANGES under a move
   * input). x/y are its world pixel (via the ONE gridMap). Re-derived after each move.
   */
  public player: {
    gridX: number;
    gridY: number;
    x: number;
    y: number;
    health: number;
    maxHealth: number;
    isDead: boolean;
  } = { gridX: 0, gridY: 0, x: 0, y: 0, health: 1, maxHealth: 1, isDead: false };

  /**
   * The shared, engine-agnostic event bus (the PUSH channel). Every standardized
   * board moment is emitted here; the core 2D adapter (core/src/hook.ts) folds the
   * log onto window.__GAME__.events for guidance / verify to poll.
   */
  public readonly eventBus = new EventBus();

  /** The tile sprites, indexed [row][col] (the VISUAL world; null = empty). */
  private tileSprites: (Phaser.GameObjects.Container | null)[][] = [];
  /** Per-key down-edge guard (the discrete-move discipline — one move per press). */
  private keyObjs: Record<string, Phaser.Input.Keyboard.Key> = {};
  /** RNG (Phaser-seeded so commands.seed makes the harness deterministic). */
  private rng: () => number = Math.random;

  constructor(
    sceneKeyOrConfig: string | Phaser.Types.Scenes.SettingsConfig,
    levelData: GridLevelData,
  ) {
    super(sceneKeyOrConfig);
    this.levelData = levelData;
  }

  // ── boot ────────────────────────────────────────────────────────────────────

  create(): void {
    // Fresh-level state (a RESTART re-runs create()).
    this.gameCompleted = false;
    this._readyLatched = false;
    this._lastStatus = undefined;
    this.moveCount = 0;
    this.registry.set('status', 'playing');
    this.registry.set('score', 0);
    this.rng = () => Phaser.Math.RND.frac();

    const cfg = this.levelData.grid ?? ({ rows: 4, cols: 4, winTarget: DEFAULT_WIN_TARGET } as any);
    const rows = cfg.rows ?? 4;
    const cols = cfg.cols ?? 4;
    const cellSize = cfg.cellSize ?? DEFAULT_CELL;
    this.winTarget = cfg.winTarget ?? DEFAULT_WIN_TARGET;
    this.spawnTable = (cfg.spawn as SpawnWeight[]) ?? DEFAULT_SPAWN;

    // Center the board in the viewport unless an explicit origin is given.
    const vw = this.levelData.bounds?.width ?? this.scale.width;
    const vh = this.levelData.bounds?.height ?? this.scale.height;
    const originX = cfg.originX ?? Math.round((vw - cols * cellSize) / 2);
    const originY = cfg.originY ?? Math.round((vh - rows * cellSize) / 2);

    this.gridMap = new GridMap({ rows, cols, cellSize, originX, originY });
    this.board = new GridBoard(rows, cols);

    // Background.
    this.cameras.main.setBackgroundColor(this.levelData.backgroundColor ?? '#1b1b2f');
    this.drawBoardFrame();

    // The bound move RULE (the board's behavior). Default MergeSlide.
    this.rule = this.resolveRule();

    // The control scheme (key -> intent). Wire each declared key for down-edge reads.
    this.scheme = resolveScheme(this.levelData.controlScheme) ?? DEFAULT_SCHEME;
    this.setupInputs();

    // Seed the opening tiles from DATA (the board's initial position).
    this.tileSprites = Array.from({ length: rows }, () => new Array(cols).fill(null));
    for (const t of this.levelData.tiles ?? []) {
      if (this.board.inBounds(t.row, t.col)) this.board.set(t.row, t.col, t.value);
    }
    // If the data seeded NO tiles, spawn two (a standard merge-slide opening) so the
    // board is non-empty and playable even from a bare default.
    if ((this.levelData.tiles ?? []).length === 0) {
      spawnTile(this.board, this.spawnTable, this.rng);
      spawnTile(this.board, this.spawnTable, this.rng);
    }

    // Construct + attach the systems (win/lose owner). reset() first (restart-safe).
    this.constructSystems();
    for (const sys of this.systems) {
      sys.reset?.();
      sys.attach(this);
    }

    this.paintTiles();
    this.refreshCursor();
    this.cameras.main.fadeIn(200);
  }

  update(): void {
    // Stamp the frame on the bus so logged events carry a real frame number.
    this.eventBus.setFrame(this.game.loop.frame);
    this.markReady();
    this.publishStatus();
  }

  // ── input -> intent -> resolve -> spawn -> systems (the core loop) ───────────

  /**
   * Wire every key the scheme binds for a DOWN-EDGE read (the discrete-move
   * discipline: one move per press, mode 'press'). A `keydown` of a bound key fires
   * exactly one resolved move — the headless-driveable controllable seam.
   */
  protected setupInputs(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    this.keyObjs = {};
    const KC = Phaser.Input.Keyboard.KeyCodes as Record<string, number>;
    for (const keyName of Object.keys(this.scheme.bindings)) {
      const code = KC[keyName];
      if (code === undefined) continue;
      const keyObj = kb.addKey(code);
      this.keyObjs[keyName] = keyObj;
      // The down EDGE: Phaser fires 'down' once per physical press (auto-repeat off),
      // so a held key does NOT repeat-resolve — exactly the press-mode contract.
      keyObj.on('down', () => {
        const intent = this.scheme.bindings[keyName];
        if (intent) this.applyMove(intent);
      });
    }
  }

  /**
   * Resolve ONE move (the core-loop body). Reads the live grid, runs the bound rule,
   * and — ONLY when the move CHANGED the board (INV-3) — applies the new grid, adds
   * the score, spawns one tile, re-paints, and notifies the systems. A no-op move
   * (e.g. pushing into a packed wall) changes nothing and spawns nothing.
   *
   * PUBLIC so a headless harness can drive a move directly (the controllable proof
   * uses a real keydown, but this is the same path the keydown listener calls).
   */
  public applyMove(intent: GridIntent | string): void {
    if (this.gameCompleted) return;
    const before = this.board.snapshot();
    const res = this.rule.resolve(before, intent);
    if (!res.changed) return; // no-op move: spawn nothing (INV-3)

    this.board.setGrid(res.grid);
    this.moveCount += 1;

    // board.moved — the move resolved + changed the board (the core moment).
    this.eventBus.emit('board.moved', { intent, moveCount: this.moveCount });

    if (res.scoreDelta > 0) {
      const score = (this.registry.get('score') as number) + res.scoreDelta;
      this.registry.set('score', score);
      // tile.merged + score.changed at the real merge moment.
      this.eventBus.emit('tile.merged', { gained: res.scoreDelta });
      this.eventBus.emit('score.changed', { score });
    }

    // INV-3: spawn ONE tile on an empty cell, ONLY because the move changed.
    const spawned = spawnTile(this.board, this.spawnTable, this.rng);
    if (spawned) {
      this.eventBus.emit('tile.spawned', {
        row: spawned.row,
        col: spawned.col,
        value: spawned.value,
      });
    }

    this.paintTiles();
    this.refreshCursor();

    // Notify the win/lose systems with the resolved move (INV-4 / INV-5).
    for (const sys of this.systems) {
      sys.onMove?.({ changed: res.changed, scoreDelta: res.scoreDelta, intent });
    }
  }

  // ── win / lose seams (the systems call these) ────────────────────────────────

  /** Win seam — sets status:'won'. Called by MergeSlideGoal on INV-4. */
  public win(): void {
    if (this.gameCompleted) return;
    this.gameCompleted = true;
    this.registry.set('status', 'won');
    this.publishStatus();
  }

  /** Lose seam — sets status:'lost'. Called by MergeSlideGoal on INV-5. */
  public lose(): void {
    if (this.gameCompleted) return;
    this.gameCompleted = true;
    this.registry.set('status', 'lost');
    this.player.isDead = true;
    this.publishStatus();
  }

  /** Latch the registry `ready` flag once (first interactive frame). */
  protected markReady(): void {
    if (this._readyLatched) return;
    this._readyLatched = true;
    this.registry.set('ready', true);
    const s = this.registry.get('status');
    if (s !== 'won' && s !== 'lost') this.registry.set('status', 'playing');
  }

  /**
   * Publish level.statusChanged whenever the normalized status moves
   * (booting->playing->won/lost), de-duped against the last published value.
   */
  protected publishStatus(): void {
    const s = this.registry.get('status');
    const status = s === 'won' || s === 'lost' || s === 'playing' ? s : undefined;
    if (status === undefined || status === this._lastStatus) return;
    this._lastStatus = status;
    this.eventBus.emit('level.statusChanged', { status });
  }

  // ── the board cursor (the observed "player") ─────────────────────────────────

  /**
   * Re-derive the board cursor: the HIGHEST-value tile's cell. A real, observable
   * position (player.gridX/gridY + its world x/y via the ONE gridMap) that CHANGES
   * as the board resolves — the controllable proof without a free-moving avatar.
   */
  private refreshCursor(): void {
    const grid = this.board.snapshot();
    let best = -1;
    let br = 0;
    let bc = 0;
    for (let r = 0; r < grid.length; r += 1) {
      for (let c = 0; c < grid[r].length; c += 1) {
        if (grid[r][c] > best) {
          best = grid[r][c];
          br = r;
          bc = c;
        }
      }
    }
    const w = this.gridMap.toWorld(br, bc);
    this.player.gridX = bc;
    this.player.gridY = br;
    this.player.x = w.x;
    this.player.y = w.y;
  }

  // ── rendering (the VISUAL world — a re-paint to match the logical board) ──────

  private drawBoardFrame(): void {
    const g = this.add.graphics();
    g.fillStyle(0x12121f, 1);
    g.fillRoundedRect(
      this.gridMap.originX - 6,
      this.gridMap.originY - 6,
      this.gridMap.widthPx + 12,
      this.gridMap.heightPx + 12,
      10,
    );
    // Empty cell wells.
    g.fillStyle(0x2a2a3d, 1);
    for (let r = 0; r < this.gridMap.rows; r += 1) {
      for (let c = 0; c < this.gridMap.cols; c += 1) {
        const w = this.gridMap.toWorld(r, c);
        const s = this.gridMap.cellSize;
        g.fillRoundedRect(w.x - s / 2 + 4, w.y - s / 2 + 4, s - 8, s - 8, 6);
      }
    }
    g.setDepth(-10);
  }

  /** Re-paint every tile sprite to match the logical board (the two-worlds sync). */
  private paintTiles(): void {
    const grid = this.board.snapshot();
    const slots = this.levelData.tileSlots ?? {};
    for (let r = 0; r < grid.length; r += 1) {
      for (let c = 0; c < grid[r].length; c += 1) {
        const v = grid[r][c];
        const existing = this.tileSprites[r][c];
        if (existing) {
          existing.destroy();
          this.tileSprites[r][c] = null;
        }
        if (v === 0) continue;
        const w = this.gridMap.toWorld(r, c);
        const s = this.gridMap.cellSize - 8;
        const container = this.add.container(w.x, w.y);
        const slot = slots[String(v)];
        if (slot && this.textures.exists(slot)) {
          const img = this.add.image(0, 0, slot).setDisplaySize(s, s);
          container.add(img);
        } else {
          const rect = this.add.rectangle(0, 0, s, s, TILE_TINTS[v] ?? 0x3c3a32).setOrigin(0.5);
          const label = this.add
            .text(0, 0, String(v), {
              fontSize: `${Math.max(16, Math.floor(s * 0.34))}px`,
              color: v <= 4 ? '#776e65' : '#f9f6f2',
              fontStyle: 'bold',
            })
            .setOrigin(0.5);
          container.add([rect, label]);
        }
        container.setDepth(1);
        this.tileSprites[r][c] = container;
      }
    }
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** Resolve the board's bound move-rule behavior (default MergeSlide). */
  private resolveRule(): IGridBehavior {
    // A future blueprint may bind the rule by id via levelData; the merge-slide
    // default binds MergeSlide. Resolve via the registry so it stays data-driven.
    const Cls: GridBehaviorClass | undefined = resolveBehavior('MergeSlide');
    if (Cls) return new Cls({});
    // Defensive fallback (should never happen): a custom rule registered by W4.
    const custom = resolveCustomBehavior('MergeSlide');
    if (custom) return custom({});
    throw new Error('grid_logic: no bound move-rule behavior resolved');
  }

  /** Construct this level's scene systems (registered systems[] + custom[]). */
  private constructSystems(): void {
    this.systems = [];
    for (const b of this.levelData.systems ?? []) {
      if (!b?.ref) continue;
      if (b.ref.startsWith('$custom:')) {
        const factory = resolveCustomSystem(b.ref.slice('$custom:'.length));
        if (factory) this.systems.push(factory(b.params));
        continue;
      }
      const sys = resolveSystem(b.ref, b.params);
      if (sys) this.systems.push(sys);
    }
    // Default win/lose owner when the data bound none (so a bare level still ends).
    if (this.systems.length === 0) {
      const goal = resolveSystem('MergeSlideGoal', {});
      if (goal) this.systems.push(goal);
    }
  }

  // ── component surface (the declared event set this scene publishes) ───────────

  /**
   * The uniform component surface for the grid-board scene. Declares the events this
   * engine emits on the shared bus (the CLAIM the catalog + the check-event-wiring
   * gate read). Each EventDecl is a TRUE statement about a real .emit() site in
   * applyMove / win / lose / publishStatus:
   *   - board.moved         <- applyMove (a changed move resolved)        [archetype]
   *   - tile.merged         <- applyMove (scoreDelta > 0)                 [archetype]
   *   - tile.spawned        <- applyMove (a tile spawned after a change)  [archetype]
   *   - score.changed       <- applyMove (score increased)               [core]
   *   - level.statusChanged <- publishStatus (ready/win/lose)            [core]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'board.moved',
          payload: '{intent,moveCount}',
          scope: 'archetype',
          drivenBy: 'a direction move that changes the board',
          expect: '__GAME__.player.gridX/gridY may change; board.moved logged',
        },
        {
          name: 'tile.merged',
          payload: '{gained}',
          scope: 'archetype',
          drivenBy: 'a move that merges equal tiles',
          expect: '__GAME__.score increases; tile.merged logged',
        },
        {
          name: 'tile.spawned',
          payload: '{row,col,value}',
          scope: 'archetype',
          drivenBy: 'a changed move (spawn-on-change, INV-3)',
          expect: 'a new tile appears on an empty cell; tile.spawned logged',
        },
        {
          name: 'score.changed',
          payload: '{score}',
          scope: 'core',
          drivenBy: 'a merge increases the score',
          expect: '__GAME__.score changes; score.changed logged',
        },
        {
          name: 'level.statusChanged',
          payload: "{status:'playing'|'won'|'lost'}",
          scope: 'core',
          drivenBy: 'ready/win(INV-4)/lose(INV-5)',
          expect: '__GAME__.status matches; level.statusChanged logged',
        },
      ],
    };
  }
}
