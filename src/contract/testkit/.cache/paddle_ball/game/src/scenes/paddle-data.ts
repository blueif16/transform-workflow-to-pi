/**
 * paddle-data.ts — the runtime PADDLE-BALL LEVEL DATA contract (KEEP — engine seam).
 *
 * This is the shape of the per-level data file `src/levels/<level>.json` that W2
 * MATERIALIZES from `blueprint.layout` + the blueprint's capability BINDINGS
 * (genre/controlScheme/effects/systems/custom). DataPaddleScene reads it and
 * INSTANTIATES the WHOLE level from it — bounds, the paddle, the ball serve, the
 * brick grid, lives, and the event->effect bindings — with ZERO per-game code. W4
 * authors ONLY the `custom[]` entries (a Pong AI paddle, a multi-ball power-up …).
 *
 * It is the paddle_ball analogue of platformer's `scenes/level-data.ts` and top_down's
 * `scenes/topdown-data.ts`. The runtime bundles `gameConfig.json` + this level file,
 * never `spec/blueprint.json`, so the geometry/bindings ride into the build here.
 *
 * KEY ARCHETYPE FACTS: there is NO gravity. The PADDLE is the player (one-axis
 * controllable; window.__GAME__.player is the paddle). The BALL is engine-driven
 * (sub-stepped so it never tunnels) and reflects off walls (mirror), bricks
 * (axis-resolved), and the paddle BY CONTACT POINT (a near-edge hit returns at a
 * steeper angle than a center hit — never a plain mirror; RB §2.1). A ball below the
 * paddle costs EXACTLY one life; clearing every breakable brick = win; 0 lives = lose.
 *
 * GENERIC: no game/theme is encoded in this file — it is a TYPE. A game's strings
 * live ONLY in the materialized `levels/<level>.json` (and `meta.artStyle`).
 */

/** A behavior binding: a registry id, or {ref,params}, or a "$custom:<id>" ref. */
export type BehaviorBinding = string | { ref: string; params?: Record<string, any> };

/**
 * A SYSTEM binding (the scene-level kind=system tier): {ref,params} where `ref` is a
 * registered system id (systems/registry.ts SYSTEM_CLASSES) and `params` is the
 * per-game tuning the SDK constructs it with. The data-driven projection of the
 * blueprint's `systems[]` bucket — e.g. the BrickGrid the base genre always binds, or
 * a future PaddleDuelAI / MultiBall power-up. The loader resolves each ref -> a
 * constructed ISceneSystem and runs its lifecycle. GENERIC: no game/theme — a TYPE.
 */
export type SystemBinding = { ref: string; params?: Record<string, any> };

/**
 * The PADDLE entity (the player). One-axis-clamped bat the control scheme drives.
 * x/y is the CENTER. The `axis` is which axis the paddle slides on ('x' = a bottom
 * bat that moves left/right — the Breakout default; 'y' = a side bat — a Pong wall).
 */
export interface PaddleData {
  id?: string;
  /** CENTER x of the paddle's start. */
  x: number;
  /** CENTER y of the paddle's start. */
  y: number;
  /** paddle display width px (the contact-point steering uses the half-width). */
  width?: number;
  /** paddle display height px. */
  height?: number;
  /** which axis the paddle slides on (default 'x' — a bottom bat). */
  axis?: 'x' | 'y';
  /** asset/texture key (falls back to a placeholder rect). */
  assetSlot?: string;
  /**
   * Bound behaviors (registry {ref,params} or "$custom:<id>"). The control scheme
   * (controlScheme) is what makes the paddle MOVE; behaviors[] carry any extra bound
   * logic (e.g. a $custom paddle-grow). OPTIONAL.
   */
  behaviors?: BehaviorBinding[];
}

/**
 * The BALL serve. x/y is the CENTER start; angleDeg + speed define the launch
 * velocity (angle measured from +x, CCW; the default ~ -60deg sends it up-right). The
 * engine sub-steps the ball at `speed` so a fast serve never tunnels (RB §2.2).
 */
export interface BallData {
  id?: string;
  /** CENTER x of the ball's start (typically just above the paddle). */
  x: number;
  /** CENTER y of the ball's start. */
  y: number;
  /** ball diameter px (the collider is a square of this size for exact grid math). */
  size?: number;
  /** launch speed px/s (CONSTANT — a paddle bounce changes ANGLE, not speed; RB §1). */
  speed?: number;
  /** launch angle in degrees (from +x, CCW; default -60 = up and to the right). */
  angleDeg?: number;
  /** asset/texture key (falls back to a placeholder). */
  assetSlot?: string;
}

/**
 * ONE brick (a breakable or unbreakable cell). x/y is the CENTER. `hp` > 1 means a
 * multi-hit brick (each ball contact decrements hp; it clears at 0). `unbreakable`
 * bricks reflect the ball forever and are EXCLUDED from the win count (RB §2.5).
 */
export interface BrickData {
  id?: string;
  /** CENTER x of the brick. */
  x: number;
  /** CENTER y of the brick. */
  y: number;
  /** brick width px. */
  width?: number;
  /** brick height px. */
  height?: number;
  /** hits to clear (default 1). */
  hp?: number;
  /** an unbreakable brick: reflects forever, never counted toward the win. */
  unbreakable?: boolean;
  /** score awarded when this brick clears (default from paddleConfig.brickPoints). */
  points?: number;
  /** asset/texture key (falls back to a placeholder rect). */
  assetSlot?: string;
}

/**
 * A COMPACT brick-grid spec (the additive grid convenience — the paddle_ball analogue
 * of top_down's MazeGridData). DataPaddleScene EXPANDS it into individual BrickData
 * cells laid out on a regular grid, so a wall of bricks is authored once as
 * rows×cols + spacing rather than as N hand-placed rects. Each cell becomes a brick at
 *   x = originX + col*(brickWidth+gapX) + brickWidth/2
 *   y = originY + row*(brickHeight+gapY) + brickHeight/2
 * The explicit `bricks[]` array still applies ON TOP (a grid PLUS hand-placed extras).
 * GENERIC: a TYPE — every numeric is data so a permuted grid still builds.
 */
export interface BrickGridData {
  /** number of rows. */
  rows: number;
  /** number of columns. */
  cols: number;
  /** per-brick width px. */
  brickWidth: number;
  /** per-brick height px. */
  brickHeight: number;
  /** horizontal gap between bricks px (default 0). */
  gapX?: number;
  /** vertical gap between bricks px (default 0). */
  gapY?: number;
  /** world x of the grid's TOP-LEFT corner (default 0). */
  originX?: number;
  /** world y of the grid's TOP-LEFT corner (default 0). */
  originY?: number;
  /** uniform hp per generated brick (default 1; per-cell overrides via hpMap). */
  hp?: number;
  /**
   * OPTIONAL per-row hp overrides (index 0 = top row). A row with hp 0 is SKIPPED
   * (a gap row). Generic: a number array, no game/theme.
   */
  rowHp?: number[];
  /** default points per generated brick (default from paddleConfig.brickPoints). */
  points?: number;
  /** default brick texture KEY for generated cells (placeholder when absent). */
  brickSlot?: string;
}

/** An event->effect binding (blueprint.effects[]). */
export interface EffectBinding {
  on: string;
  play: string;
  params?: Record<string, any>;
}

/** The whole runtime paddle-ball level data. */
export interface PaddleLevelData {
  /** the scene key (defaults to 'Level1Scene'). */
  scene?: string;
  /** world bounds (the play field; the four walls are derived from these — top/left/right are solid, the BOTTOM is the death line below the paddle). */
  bounds?: { width: number; height: number };
  /** background color (hex string) when no bg slot is given. */
  backgroundColor?: string;
  /** floor/background asset slot key (optional). */
  backgroundSlot?: string;
  /** wall tile texture KEY for the three solid walls (optional placeholder when absent). */
  wallSlot?: string;
  /** starting lives (a ball below the paddle costs one; 0 = lose). Default from paddleConfig.lives. */
  lives?: number;
  /**
   * The control-scheme id this level binds (the data-driven projection of the
   * blueprint's `controlScheme`). Resolved against controls/schemes.ts; it configures
   * the paddle's one-axis input binding (keys / pointer). OPTIONAL — absent → the
   * keys-on-x default. Values: 'paddle-keys' | 'paddle-pointer'. GENERIC: an id.
   */
  controlScheme?: string;
  /** the paddle (the player). */
  paddle: PaddleData;
  /** the ball serve. */
  ball: BallData;
  /** a COMPACT brick grid expanded into bricks (additive; explicit bricks[] apply on top). */
  brickGrid?: BrickGridData;
  /** explicit individual bricks (applied on top of any brickGrid expansion). */
  bricks?: BrickData[];
  effects?: EffectBinding[];
  /**
   * Registered SCENE SYSTEM bindings (the kind=system tier). Each {ref,params} names a
   * system id in systems/registry.ts; the loader constructs + lifecycles each. The
   * base brick-breaker genre binds BrickGrid here. The data-driven projection of
   * blueprint.systems[]. OPTIONAL.
   */
  systems?: SystemBinding[];
}

/**
 * ISceneSystem — the SDK interface a `custom[]` SYSTEM (or a registered kind=system
 * logic) implements (KEEP — engine seam). DataPaddleScene constructs it, runs its
 * lifecycle, and routes setupCollisions/update through it. attach() gets the live
 * scene; setupCollisions() wires overlaps; update() ticks; reset() re-arms run state
 * so a restarted level is genuinely replayable. Identical to platformer/top_down's
 * ISceneSystem so a system promotes cleanly.
 */
export interface ISceneSystem {
  /** Called once after the level is built (paddle + ball exist). */
  attach(scene: any): void;
  /** Wire any overlaps this system owns. */
  setupCollisions?(): void;
  /** Per-frame tick (optional). */
  update?(): void;
  /** Re-initialize ALL internal latches to a fresh-level state (called at every create()). */
  reset?(): void;
}

/**
 * LEVEL_ORDER — the canonical level sequence (KEEP — engine seam). Mirrors
 * platformer/core LevelManager.LEVEL_ORDER. The committed default is a single level;
 * W4 appends more level keys here when the design has a level ladder.
 */
export const LEVEL_ORDER: string[] = ['Level1Scene'];
