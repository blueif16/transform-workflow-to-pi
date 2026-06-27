/**
 * shooter-data.ts — the runtime GALLERY-SHOOTER LEVEL DATA contract (KEEP — engine
 * seam). The top_down analogue of topdown-data.ts (`ShooterLevelData` for `TopDownLevelData`).
 *
 * This is the shape of the per-level data file `src/levels/<level>.json` that W2
 * MATERIALIZES from `blueprint.layout` + the blueprint's capability BINDINGS
 * (genre/controlScheme/effects/systems/custom). DataShooterScene reads it and
 * INSTANTIATES the whole level from it — the descending FORMATION, the player
 * (axis-constrained, from the bound behavior), the destructible BUNKERS, the
 * registered systems, and the event->effect bindings — with ZERO per-game placement
 * code. W4 authors ONLY the `custom[]` entries.
 *
 * The runtime bundles `gameConfig.json` + this level file, never `spec/blueprint.json`,
 * so the geometry/bindings ride into the build here.
 *
 * KEY DIFFERENCE FROM top_down: there is NO free 8-way space. The player is CONSTRAINED
 * to one axis (a bottom track); the threat is a rigid grid FORMATION that step-marches
 * and DESCENDS, accelerating as its ranks thin; projectiles are POOLED; the lose
 * condition is the formation REACHING the player's row.
 *
 * GENERIC: no game/theme is encoded in this file — it is a TYPE. A game's strings live
 * ONLY in the materialized `levels/<level>.json` (and `meta.artStyle`).
 */

/** A behavior binding: a registry id, or {ref,params}, or a "$custom:<id>" ref. */
export type BehaviorBinding = string | { ref: string; params?: Record<string, any> };

/**
 * A SYSTEM binding (the scene-level kind=system tier): {ref,params} where `ref` is a
 * registered system id (systems/registry.ts SYSTEM_CLASSES) and `params` is the
 * per-game tuning the SDK constructs it with. The data-driven projection of the
 * blueprint's `systems[]` bucket. The loader resolves each ref → a constructed
 * ISceneSystem and runs its lifecycle. GENERIC: no game/theme — a TYPE.
 */
export type SystemBinding = { ref: string; params?: Record<string, any> };

/**
 * The descending enemy FORMATION (the heart of the archetype). A rigid grid of
 * `rows × cols` enemies that moves as ONE body: it step-marches sideways, reverses +
 * drops a row at each arena edge, and STEPS FASTER as its alive count falls (the
 * signature acceleration). Built once by DataShooterScene; advanced by the
 * FormationMarch system. All numeric — a permuted formation still builds.
 */
export interface FormationData {
  /** Rows in the grid (top→bottom). */
  rows: number;
  /** Columns in the grid (left→right). */
  cols: number;
  /** Horizontal spacing between column centers (px). */
  colSpacing: number;
  /** Vertical spacing between row centers (px). */
  rowSpacing: number;
  /** The formation's TOP-LEFT member CENTER spawn (world px). */
  originX: number;
  originY: number;
  /** Per-member display size (px square-ish). */
  memberWidth?: number;
  memberHeight?: number;
  /**
   * Per-ROW enemy template (index 0 = top row). When shorter than `rows`, the last
   * entry repeats. Each gives the row's asset slot + points + optional health.
   */
  rows_template?: FormationRowTemplate[];
  /** Asset slot for every member when no per-row slot is given. */
  assetSlot?: string;
  /** Points awarded per member killed (when a row template omits points). */
  points?: number;
}

/** One formation ROW's enemy template (GENERIC — from data). */
export interface FormationRowTemplate {
  /** Texture key for this row's members (falls back to formation.assetSlot / placeholder). */
  assetSlot?: string;
  /** Points awarded per member of this row when killed. */
  points?: number;
  /** Member health (default 1 — one-shot, the classic). */
  health?: number;
}

/**
 * A destructible BUNKER (the eroding cover the player hides behind). Placed at a
 * CENTER coordinate; both the player's shots and (Wave-2) enemy bombs chew it away.
 * The base engine renders + collides it; a future genre deepens the per-cell erosion.
 */
export interface BunkerData {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** Hit points the bunker absorbs before it is destroyed (default 8). */
  health?: number;
  assetSlot?: string;
}

/** An event->effect binding (blueprint.effects[]). */
export interface EffectBinding {
  on: string;
  play: string;
  params?: Record<string, any>;
}

/** The whole runtime gallery-shooter level data. */
export interface ShooterLevelData {
  /** the scene key (defaults to 'Level1Scene'). */
  scene?: string;
  /** world bounds (the play field; a single-screen arena = the viewport size). */
  bounds?: { width: number; height: number };
  /** background color (hex string) when no bg slot is given. */
  backgroundColor?: string;
  /** floor/background asset slot key (optional). */
  backgroundSlot?: string;
  /**
   * The control-scheme id this level binds (the data-driven projection of the
   * blueprint's `controlScheme`). Resolved against controls/schemes.ts; it configures
   * the player's input binding (move axis + fire). OPTIONAL — absent → 'fixed-axis'.
   */
  controlScheme?: string;
  /** the player's spawn (CENTER coordinate, on its track). */
  playerSpawn: { x: number; y: number };
  /**
   * The player's asset slot + bound behaviors. The movement binding is normally
   * `{ ref: 'AxisConstrainedMovement', params: { moveSpeed, axis, min, max } }`.
   */
  player?: {
    id?: string;
    assetSlot?: string;
    displayWidth?: number;
    displayHeight?: number;
    behaviors?: BehaviorBinding[];
  };
  /** The descending enemy formation (built once; advanced by FormationMarch). */
  formation?: FormationData;
  /** Destructible bunkers (the eroding cover). */
  bunkers?: BunkerData[];
  effects?: EffectBinding[];
  /**
   * Registered SCENE SYSTEM bindings (the kind=system tier). Each {ref,params} names a
   * system id in systems/registry.ts; the loader constructs + lifecycles each. The
   * data-driven projection of blueprint.systems[]. A complete fixed-axis level binds
   * FormationMarch + ProjectilePool + WaveLoop.
   */
  systems?: SystemBinding[];
}

/**
 * ISceneSystem — the SDK interface a `custom[]` SYSTEM (or a registered kind=system
 * logic) implements (KEEP — engine seam). Identical to top_down's ISceneSystem so a
 * system promotes cleanly. DataShooterScene constructs it, runs its lifecycle, and
 * routes setupCollisions/update through it.
 */
export interface ISceneSystem {
  /** Called once after the level is built (player + entities exist). */
  attach(scene: any): void;
  /** Wire any player<->entity overlaps this system owns. */
  setupCollisions?(): void;
  /** Per-frame tick (optional). */
  update?(): void;
  /**
   * Re-initialize ALL of this system's internal latches/flags to a fresh-level state.
   * The SDK calls reset() at the start of every create() (incl. a scene RESTART)
   * BEFORE attach()/setupCollisions(). A system that holds run state MUST clear it
   * here so a restarted level is genuinely replayable. Optional, generic.
   */
  reset?(): void;
}

/**
 * LEVEL_ORDER — the canonical level sequence (KEEP — engine seam). The committed
 * default is a single level; W4 appends more level keys here when the design has a
 * level ladder.
 */
export const LEVEL_ORDER: string[] = ['Level1Scene'];
