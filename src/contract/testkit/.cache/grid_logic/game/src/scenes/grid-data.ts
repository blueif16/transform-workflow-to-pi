/**
 * grid-data.ts — the runtime GRID LEVEL DATA contract (KEEP — engine seam).
 *
 * This is the shape of the per-level data file `src/levels/<level>.json` that W2
 * MATERIALIZES from `blueprint.layout` + the blueprint's capability BINDINGS
 * (genre/controlScheme/systems/custom). DataGridScene reads it and INSTANTIATES the
 * whole board from it — grid geometry, the seeded starting tiles, the win target,
 * the spawn table, the bound control scheme, and the registered systems — with ZERO
 * per-game placement code. W4 authors ONLY the `custom[]` entries.
 *
 * It is the grid_logic analogue of top_down's `scenes/topdown-data.ts` (and
 * platformer's `level-data.ts`). The runtime bundles `gameConfig.json` + this level
 * file, never `spec/blueprint.json`, so the board/bindings ride into the build here.
 *
 * KEY DIFFERENCE FROM top_down: there is NO physics movement, no gravity, no
 * continuous space. The world is a 2D CELL GRID resolved PER MOVE (a state machine,
 * not a kinematic arena). The "player" is the BOARD CURSOR — its observed gridX/gridY
 * is the last-merged / highest tile cell (a real, observable position that CHANGES
 * under a move input), satisfying the controllable contract without a free-moving
 * avatar.
 *
 * GENERIC: no game/theme is encoded in this file — it is a TYPE. A game's strings
 * live ONLY in the materialized `levels/<level>.json` (and `meta.artStyle`).
 */

/** A behavior binding: a registry id, or {ref,params}, or a "$custom:<id>" ref. */
export type BehaviorBinding = string | { ref: string; params?: Record<string, any> };

/**
 * A SYSTEM binding (the scene-level kind=system tier): {ref,params} where `ref` is
 * a registered system id (systems/registry.ts SYSTEM_CLASSES) and `params` is the
 * per-game tuning the SDK constructs it with. The data-driven projection of the
 * blueprint's `systems[]` bucket. The scene resolves each ref -> a constructed
 * IGridSystem and runs its lifecycle. GENERIC: no game/theme — a TYPE.
 */
export type SystemBinding = { ref: string; params?: Record<string, any> };

/** One spawn-value weight: a tile VALUE and its relative probability weight. */
export interface SpawnWeightData {
  value: number;
  weight: number;
}

/**
 * One seeded starting tile (the board's initial state). row/col are CELL indices
 * (0-based, row 0 = top); value is the tile value (a power of two for merge-slide).
 * The blueprint's layout expresses the opening position as these cells; the rest of
 * the board is empty. A merge-slide game typically seeds 2 tiles.
 */
export interface TileData {
  row: number;
  col: number;
  value: number;
}

/**
 * The board GEOMETRY + RULE KNOBS (the per-game DELTA the research brief §(b) names:
 * board size, win-target, spawn rates). All DATA — a permuted board still builds.
 */
export interface GridConfigData {
  /** Number of rows (default 4). */
  rows: number;
  /** Number of columns (default 4). */
  cols: number;
  /** Cell edge length in world px (the rendered tile size; default 96). */
  cellSize?: number;
  /** Board top-left world x (default: centered in the viewport). */
  originX?: number;
  /** Board top-left world y (default: centered in the viewport). */
  originY?: number;
  /** The win-target tile value (default 2048) — INV-4. */
  winTarget: number;
  /** The spawn-value weight table (default 90% 2 / 10% 4) — INV-3 DELTA. */
  spawn?: SpawnWeightData[];
}

/** An IGridSystem — the SDK interface a kind=system / custom[] scene logic implements. */
export interface IGridSystem {
  /** Called once after the board is built. */
  attach(scene: any): void;
  /** React to a resolved move (the core moment): the scene calls this AFTER each move. */
  onMove?(info: { changed: boolean; scoreDelta: number; intent: string }): void;
  /** Per-frame tick (optional; grid games rarely need it). */
  update?(): void;
  /**
   * Re-initialize ALL internal latches to a fresh-level state. The scene calls
   * reset() at the start of every create() (incl. a RESTART) BEFORE attach(), so a
   * system holding run state (a one-shot win latch) clears it here. Optional, generic.
   */
  reset?(): void;
}

/** The whole runtime grid level data. */
export interface GridLevelData {
  /** the scene key (defaults to 'Level1Scene'). */
  scene?: string;
  /** viewport/world bounds (the camera-fixed board surface; defaults to the screen). */
  bounds?: { width: number; height: number };
  /** background color (hex string). */
  backgroundColor?: string;
  /** floor/background asset slot key (optional). */
  backgroundSlot?: string;
  /** the board geometry + rule knobs (rows/cols/winTarget/spawn). */
  grid: GridConfigData;
  /** the seeded opening tiles (the board's initial position). */
  tiles?: TileData[];
  /**
   * The control-scheme id this level binds (the data-driven projection of the
   * blueprint's `controlScheme`). Resolved against controls/schemes.ts; the scene
   * reads it to map keys -> move intents. OPTIONAL — absent -> the 4-way default.
   * Value: 'grid-4way'. GENERIC: an id, no game/theme.
   */
  controlScheme?: string;
  /** per-tile-value asset slot map (e.g. {"2":"tile_2","4":"tile_4"}); optional. */
  tileSlots?: Record<string, string>;
  /**
   * Registered SCENE SYSTEM bindings (the kind=system tier). Each {ref,params}
   * names a system id in systems/registry.ts; the scene constructs + lifecycles
   * each. The data-driven projection of blueprint.systems[]. OPTIONAL.
   */
  systems?: SystemBinding[];
}

/**
 * LEVEL_ORDER — the canonical level sequence (KEEP — engine seam). Mirrors
 * top_down/core LevelManager.LEVEL_ORDER. The committed default is a single level;
 * W4 appends more level keys here when the design has a level ladder.
 */
export const LEVEL_ORDER: string[] = ['Level1Scene'];
