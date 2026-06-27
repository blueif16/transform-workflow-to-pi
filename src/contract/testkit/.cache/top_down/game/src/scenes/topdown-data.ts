/**
 * topdown-data.ts — the runtime TOP-DOWN LEVEL DATA contract (KEEP — engine seam).
 *
 * This is the shape of the per-level data file `src/levels/<level>.json` that W2
 * MATERIALIZES from `blueprint.layout` + the blueprint's capability BINDINGS
 * (genre/behaviors/effects/controlScheme/systems/custom). DataTopDownScene reads
 * it and INSTANTIATES the whole level from it — floor/walls/bounds, player spawn,
 * enemies, pickups, goal, each entity's bound behaviors, the registered systems,
 * and the event->effect bindings — with ZERO per-game placement code. W4 authors
 * ONLY the `custom[]` entries.
 *
 * It is the top_down analogue of platformer's `scenes/level-data.ts` (and voxel's
 * `scenes/world-data.ts`). The runtime bundles `gameConfig.json` + this level file,
 * never `spec/blueprint.json`, so the geometry/bindings ride into the build here.
 *
 * KEY DIFFERENCE FROM PLATFORMER: top-down has NO gravity and a free 8-way space.
 * "Platforms" become solid WALLS the player cannot clip through (the §2.2 no-clip +
 * wall-slide invariant comes for free from arcade collide()); "threats" are moving
 * enemies; there is no fall-death.
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
 * blueprint's `systems[]` bucket. The loader resolves each ref -> a constructed
 * ISceneSystem and runs its lifecycle, exactly like a custom[] system. GENERIC:
 * no game/theme is encoded — a TYPE. (The system CLASSES are M2+; the binding
 * shape ships now so the contract is stable.)
 */
export type SystemBinding = { ref: string; params?: Record<string, any> };

/**
 * A solid WALL / obstacle (the top-down analogue of a platformer platform). x/y is
 * the TOP-LEFT corner (the blueprint/layout convention); the SDK converts to a
 * centered static body. The player and enemies COLLIDE with it (arcade collide) so
 * a diagonal move into it SLIDES along the free axis and never enters its AABB.
 * (Entity placements — playerSpawn/rewards/threats/goal — are CENTER coordinates.)
 */
export interface WallData {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Real wall texture KEY (an index.json slot). When it resolves the wall surface
   * is a seamless tileSprite of that tile; absent → the placeholder rect. The
   * static collision body is unchanged either way.
   */
  assetSlot?: string;
}

/** A reward/collectible/pickup placed at a CENTER coordinate (rewards[] in layout). */
export interface RewardData {
  id: string;
  x: number;
  y: number;
  /** functional kind for __GAME__.entities ('collectible' by default). */
  kind?: string;
  /** asset/texture key (falls back to a placeholder). */
  assetSlot?: string;
  /** per-frame display dims (falls back to a default). */
  width?: number;
  height?: number;
  /** bound behaviors (registry {ref,params} or "$custom:<id>"). */
  behaviors?: BehaviorBinding[];
  /** the entity-level role tag (for __GAME__.entities type). */
  role?: string;
  /**
   * The blueprint ENTITY this reward instances (e.g. 'dot' vs 'power_pellet').
   * Tagged on the sprite as `.__kind` so a custom[] system can distinguish reward
   * classes without per-game placement code.
   */
  entityKind?: string;
}

/**
 * A moving-enemy threat (threats[] in layout). Placed at a CENTER coordinate; the
 * SDK spawns a plain arcade sprite into scene.enemies and attaches its bound
 * `behaviors[]` (ChaseAI/PatrolAI/EightWayMovement…), so the wall collider + the
 * contact-damage path apply. A ChaseAI is pointed at the player automatically.
 */
export interface ThreatData {
  id: string;
  x: number;
  y: number;
  /** layout threat kind ('patrol' | 'chaser' | …) — informational; behaviors[] drives it. */
  kind?: string;
  /** explicit behavior bindings (the AI that drives the enemy). */
  behaviors?: BehaviorBinding[];
  /**
   * Real enemy texture KEY (an index.json slot). When it resolves the enemy renders
   * as that sprite; absent → the placeholder rect (body unchanged).
   */
  assetSlot?: string;
  /** per-frame display dims (falls back to a default). */
  width?: number;
  height?: number;
  /** contact damage dealt to the player on touch (default from enemyConfig). */
  damage?: number;
}

/** The goal/exit entity (layout.goal) — placed at a CENTER coordinate. */
export interface GoalData {
  id: string;
  x: number;
  y: number;
  assetSlot?: string;
  width?: number;
  height?: number;
  /**
   * Bound behaviors (registry {ref,params} or "$custom:<id>"). The goal is a bare
   * sprite the SDK scene-ticks, so an `attachedTo:<goal>` custom (a power-up gate,
   * a dock-to-win) attached here runs every frame. Projected by W2 from the goal
   * entity's behaviors, exactly like the player/reward projection.
   */
  behaviors?: BehaviorBinding[];
}

/** An event->effect binding (blueprint.effects[]). */
export interface EffectBinding {
  on: string;
  play: string;
  params?: Record<string, any>;
}

/**
 * A TILE-MAZE grid (the maze-chase additive layout — BUILD, M5). The §3
 * LAYOUT-VARIANT DECISION (smallest durable): the maze grid is carried HERE, on
 * the module's own TopDownLevelData — NOT as a new archetype-keyed variant in the
 * shared blueprint.schema.json. The GENERIC blueprint `layout` still expresses the
 * maze as ordinary walls[] + rewards[] (a generic top_down layout); the maze
 * record's W2 projection MAY additionally weave this compact grid so a maze is
 * authored once as ASCII rather than as N hand-placed wall rects. When `maze` is
 * present DataTopDownScene EXPANDS it into the wall static-group + dot/pellet
 * rewards + the per-cell wall-occupancy map the ghosts read for grid pathing — so
 * the maze is built PURELY from data with zero per-game placement code.
 *
 * GRID LEGEND (each cell is `tileSize` px square; cell (col,row) center is at
 * x = originX + col*tileSize + tileSize/2, y = originY + row*tileSize + tileSize/2):
 *   '#'  wall          (added to groundLayer; ghosts/player cannot enter)
 *   ' '  open corridor (no entity)
 *   '.'  a DOT         (a collectible reward; entityKind 'dot')
 *   'o'  a POWER PELLET(a collectible reward; entityKind 'power_pellet' — flips ghosts to FRIGHTENED)
 *   'P'  the PLAYER spawn (open corridor; overrides playerSpawn when present)
 *   '0'..'3' a GHOST spawn (open corridor): 0=blinky 1=pinky 2=inky 3=clyde —
 *            woven by the W2 projection into threats[] with the matching GhostTarget
 *            selector; the digit is the SLOT, not a baked game.
 * GENERIC: a TYPE — no game/theme is encoded; the strings live only in the
 * materialized levels/<level>.json. Every numeric (tileSize, scatter corners) is
 * data so a permuted maze still builds.
 */
export interface MazeGridData {
  /** One string per row; every row SHOULD be the same length (cols). The legend above. */
  grid: string[];
  /** Cell edge length in px (square). The wall + dot + lane spacing. */
  tileSize: number;
  /** World x of the grid's TOP-LEFT corner (default 0). */
  originX?: number;
  /** World y of the grid's TOP-LEFT corner (default 0). */
  originY?: number;
  /**
   * The four SCATTER corner target cells {col,row} the ghosts loop to in scatter
   * mode (RB §2.3 — just outside/at the maze corners). Index by ghost slot 0..3
   * (blinky/pinky/inky/clyde). OPTIONAL — absent → the four grid corners are used.
   * Generic: cells, not pixels; a permuted maze supplies its own.
   */
  scatterCorners?: { col: number; row: number }[];
  /** Dot reward display size in px (default tileSize*0.25). */
  dotSize?: number;
  /** Power-pellet reward display size in px (default tileSize*0.5). */
  pelletSize?: number;
  /** Dot/pellet asset slot (placeholder when absent). */
  dotSlot?: string;
}

/** The whole runtime top-down level data. */
export interface TopDownLevelData {
  /** the scene key (defaults to 'Level1Scene'). */
  scene?: string;
  /** world bounds (the camera-followed world; >= viewport). */
  bounds?: { width: number; height: number };
  /** background color (hex string) when no parallax bg slot is given. */
  backgroundColor?: string;
  /** floor/background asset slot key (optional). */
  backgroundSlot?: string;
  /**
   * Level-default wall tile texture KEY (an index.json slot). Every wall without
   * its own assetSlot tiles this; absent → the placeholder rect.
   */
  wallSlot?: string;
  /**
   * The control-scheme id this level binds (the data-driven projection of the
   * blueprint's `controlScheme`). Resolved against controls/schemes.ts; it
   * configures the player's input binding (move/aim/fire). OPTIONAL — absent → the
   * move-only default scheme. Values: 'twin-stick' | 'topdown-8way'. GENERIC: an
   * id, no game/theme. (M2: the scheme catalog is in src/controls/.)
   */
  controlScheme?: string;
  /**
   * A TILE-MAZE grid (maze-chase — M5). When present, DataTopDownScene EXPANDS it
   * (additively, BEFORE walls/rewards/threats from the explicit arrays) into the
   * wall group + dot/pellet rewards + the per-cell occupancy map the ghosts read,
   * and derives the player + ghost spawns from the grid's P/0..3 cells. The
   * explicit walls[]/rewards[]/threats[] still apply on top, so a maze can ALSO
   * carry hand-placed extras. GENERIC — see MazeGridData.
   */
  maze?: MazeGridData;
  /** the player's spawn (CENTER coordinate). */
  playerSpawn: { x: number; y: number };
  /** the player's asset slot + bound behaviors (EightWayMovement {ref,params}). */
  player?: {
    id?: string;
    assetSlot?: string;
    displayHeight?: number;
    displayWidth?: number;
    behaviors?: BehaviorBinding[];
    anim?: Record<string, string>;
  };
  goal?: GoalData;
  /** solid walls/obstacles the player cannot clip through. */
  walls?: WallData[];
  rewards?: RewardData[];
  threats?: ThreatData[];
  effects?: EffectBinding[];
  /**
   * Registered SCENE SYSTEM bindings (the kind=system tier). Each {ref,params}
   * names a system id in systems/registry.ts; the loader constructs + lifecycles
   * each exactly like a custom[] system. The data-driven projection of
   * blueprint.systems[]. OPTIONAL — a level with no scene-level orchestration omits
   * it. (System CLASSES are M2+; the binding shape is stable now.)
   */
  systems?: SystemBinding[];
}

/**
 * ISceneSystem — the SDK interface a `custom[]` SYSTEM (or a registered kind=system
 * logic) implements (KEEP — engine seam). The genuinely-novel scene-level logic W4
 * authors (e.g. a clear-all-dots gate, a wave spawner). DataTopDownScene constructs
 * it, runs its lifecycle, and routes setupCollisions/update through it. attach() gets
 * the live scene; setupCollisions() wires overlaps (player exists by then); update()
 * ticks. Identical to platformer's ISceneSystem so a system promotes cleanly.
 */
export interface ISceneSystem {
  /** Called once after the level is built (player + entities exist). */
  attach(scene: any): void;
  /** Wire any player<->entity overlaps this system owns. */
  setupCollisions?(): void;
  /** Per-frame tick (optional). */
  update?(): void;
  /**
   * Re-initialize ALL of this system's internal latches/flags to a fresh-level
   * state (KEEP — engine seam). The SDK calls reset() at the start of every
   * create() — including a scene RESTART (commands.reset(), the verify probes) —
   * BEFORE attach()/setupCollisions(). A system that holds run state (a one-shot
   * win latch, a per-entity "done" set) MUST clear it here so a restarted level is
   * genuinely replayable. Optional, generic — no game/theme is encoded.
   */
  reset?(): void;
}

/**
 * LEVEL_ORDER — the canonical level sequence (KEEP — engine seam). Mirrors
 * platformer/core LevelManager.LEVEL_ORDER. The committed default is a single
 * level; W4 appends more level keys here when the design has a level ladder. The
 * core LevelManager (overlaid from templates/core) reads its own LEVEL_ORDER; this
 * re-declares the module's default for the data-driven loader's own diagnostics.
 */
export const LEVEL_ORDER: string[] = ['Level1Scene'];
