/**
 * runner-data.ts — the runtime ENDLESS-RUNNER LEVEL DATA contract (KEEP — engine seam).
 *
 * The shape of the per-level data file `src/levels/<level>.json` that W2 MATERIALIZES
 * from `blueprint.layout` + the blueprint's capability BINDINGS (genre / behaviors /
 * controlScheme / systems / custom). DataRunnerScene reads it and INSTANTIATES the
 * whole run from it — the avatar + its bound movement behavior, the procedural-obstacle
 * cadence/gap/speed/seed, the score-on-pass logic, the control scheme — with ZERO
 * per-game placement code. W4 authors ONLY the `custom[]` entries.
 *
 * It is the endless_runner analogue of platformer's `scenes/level-data.ts` and
 * top_down's `scenes/topdown-data.ts`. The runtime bundles `gameConfig.json` + this
 * level file (never `spec/blueprint.json`), so the tuning/bindings ride into the build
 * here.
 *
 * KEY DIFFERENCE FROM PLATFORMER: there is no hand-placed level geometry. The world is
 * an INFINITE auto-scroll — the obstacles are PROCEDURALLY generated at runtime from a
 * SEEDED stream (deterministic, reproducible), not authored as platforms[]. The avatar
 * x is FIXED; the world scrolls past it. There is no goal/exit (gravity-flap = survival
 * + score); the lose seam is touching an obstacle / the ground / the ceiling.
 *
 * GENERIC: no game/theme is encoded in this file — it is a TYPE. A game's strings live
 * ONLY in the materialized `levels/<level>.json` (and `meta.artStyle`).
 */

/** A behavior binding: a registry id, or {ref,params}, or a "$custom:<id>" ref. */
export type BehaviorBinding = string | { ref: string; params?: Record<string, any> };

/**
 * A SYSTEM binding (the scene-level kind=system tier): {ref,params} where `ref` is a
 * registered system id (systems/registry.ts) and `params` is the per-game tuning. The
 * data-driven projection of the blueprint's `systems[]` bucket. The loader resolves
 * each ref → a constructed ISceneSystem and runs its lifecycle. GENERIC — a TYPE.
 */
export type SystemBinding = { ref: string; params?: Record<string, any> };

/** An event→effect binding (blueprint.effects[]). Cosmetic only. */
export interface EffectBinding {
  on: string;
  play: string;
  params?: Record<string, any>;
}

/** The avatar spec (the one player entity — placed at a FIXED x, gravity-driven y). */
export interface AvatarData {
  id?: string;
  /** The avatar's FIXED world x (it never moves horizontally; the world scrolls). */
  x: number;
  /** The avatar's starting world y. */
  y: number;
  /** asset/texture key (falls back to a placeholder). */
  assetSlot?: string;
  /** display dims in px (the AABB collision box size — RB §2 INV-COLLISION). */
  width?: number;
  height?: number;
  /** bound behaviors (registry {ref,params} or "$custom:<id>") — the movement verb. */
  behaviors?: BehaviorBinding[];
}

/**
 * The PROCEDURAL-OBSTACLE stream spec (the auto-scroll heart). Read by
 * ObstacleScrollSystem to deterministically generate the gap-obstacle stream. Every
 * value is DATA so a re-tuned game is a different number, not different code.
 */
export interface ObstacleStreamData {
  /** Scroll speed (px/s) the world moves left past the fixed avatar. */
  scrollSpeed?: number;
  /** Horizontal spacing (px) between successive obstacle pairs (consistent — RB §1). */
  spawnEveryPx?: number;
  /** The FIXED vertical gap height (px). MUST be ≥ avatar height + margin (INV-PASSABLE). */
  gapHeight?: number;
  /** Margin (px) the gap CENTER keeps from the ceiling and the floor band (no edge gaps). */
  gapMargin?: number;
  /** Obstacle (pipe) width in px. */
  obstacleWidth?: number;
  /** The deterministic PRNG seed for the gap-center stream (INV-DETERMINISTIC). */
  seed?: number;
  /** asset/texture key for the obstacle body (falls back to a placeholder). */
  assetSlot?: string;
  /** The y of the ground band the avatar dies on contact with (default near bottom). */
  floorY?: number;
}

/** The whole runtime endless-runner level data. */
export interface RunnerLevelData {
  /** the scene key (defaults to 'Level1Scene'). */
  scene?: string;
  /** world/viewport bounds (the fixed portrait canvas; the run scrolls within it). */
  bounds?: { width: number; height: number };
  /** background color (hex string) when no parallax bg slot is given. */
  backgroundColor?: string;
  /** parallax background asset slot key (optional). */
  backgroundSlot?: string;
  /**
   * The control-scheme id this level binds (the data-driven projection of the
   * blueprint's `controlScheme`). Resolved against controls/schemes.ts; it attaches
   * the matching DOM-sensing scheme. OPTIONAL — absent → the default one-button flap.
   * Values: 'gravity-flap-1btn'. GENERIC: an id, no game/theme.
   */
  controlScheme?: string;
  /** the avatar (the one player entity). */
  avatar: AvatarData;
  /** the procedural-obstacle stream spec (the auto-scroll engine reads this). */
  obstacles?: ObstacleStreamData;
  /** cosmetic event→effect bindings (blueprint.effects[]). */
  effects?: EffectBinding[];
  /**
   * Registered SCENE SYSTEM bindings (the kind=system tier). Each {ref,params} names a
   * system id in systems/registry.ts; the loader constructs + lifecycles each. The
   * data-driven projection of blueprint.systems[]. The base genre binds the
   * ObstacleScrollSystem (the scroller) + ScoreOnPassSystem (the scorer). OPTIONAL.
   */
  systems?: SystemBinding[];
}

/**
 * ISceneSystem — the SDK interface a `custom[]` SYSTEM (or a registered kind=system
 * logic) implements (KEEP — engine seam). DataRunnerScene constructs it, runs its
 * lifecycle, and routes setupCollisions/update through it. attach() gets the live
 * scene; setupCollisions() wires overlaps (the avatar exists by then); update() ticks.
 * Identical to platformer/top_down's ISceneSystem so a system promotes cleanly.
 */
export interface ISceneSystem {
  /** Called once after the run is built (the avatar exists). */
  attach(scene: any): void;
  /** Wire any avatar↔entity overlaps this system owns. */
  setupCollisions?(): void;
  /** Per-frame tick (optional). */
  update?(): void;
  /**
   * Re-initialize ALL of this system's internal latches/flags to a fresh-run state
   * (KEEP — engine seam). The SDK calls reset() at the start of every create() —
   * including a RESTART (the instant-restart loop) — BEFORE attach()/setupCollisions().
   * A system holding run state (the obstacle pool, the score latch, the PRNG cursor)
   * MUST clear it here so a restarted run is genuinely byte-identical to a fresh one
   * (INV-RESET / RB §3). Optional, generic — no game/theme.
   */
  reset?(): void;
}

/**
 * LEVEL_ORDER — the canonical level sequence (KEEP — engine seam). An endless runner is
 * a single endless level; the committed default is one level. Mirrors the other
 * modules' LEVEL_ORDER re-declaration for the loader's own diagnostics.
 */
export const LEVEL_ORDER: string[] = ['Level1Scene'];
