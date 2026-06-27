/**
 * ============================================================================
 * ShooterScheme.ts — the data-driven CONTROL SCHEME contract for gallery_shooter
 * ============================================================================
 *
 * A gallery-shooter control scheme is the declarative INPUT BINDING the player
 * consumes: which input drives MOVE along the FREE axis, and how the player FIRES
 * upward. The blueprint binds a scheme BY ID (`controlScheme: 'fixed-axis'`); the
 * loader resolves it here and configures the player from the record — ZERO per-game
 * input code.
 *
 * WHY A RECORD (mirrors top_down's TopDownScheme): input is ALREADY scene-owned
 * (BaseGameScene.setupInputs wires ←/→/A/D + Space), so a scheme does not re-sense
 * raw DOM events; it DECLARES which already-sensed sources map to move/fire, and the
 * scene wires the player to match. Reuse the engine's input plumbing, parameterize
 * the binding (Hermes law 6: the smallest durable edit).
 *
 * HEADLESS-DRIVEABLE: every binding resolves to the existing key hooks the scene
 * reads, so a harness drives MOVE with ←/→ (or A/D) `keydown` and FIRE with Space —
 * no new event path. The constrained-axis invariant is the SHAPE of the record:
 * move sources only the FREE-axis arrow pair; there is no "up/down" binding at all,
 * so the player physically cannot leave its track.
 *
 * GENERIC: a scheme names input SOURCES, never a game.
 */

/** Where the player's MOVE input (along the free axis) comes from. */
export type MoveSource =
  /** Left/right arrow + A/D keys → the horizontal free axis (the bottom track). */
  | 'lr-arrows'
  /** Up/down arrow + W/S keys → the vertical free axis (a side track). */
  | 'ud-arrows';

/** How the player FIRES its projectile upward. */
export type FireMode =
  /** Fire on the key EDGE (one shot per press, rate-limited by the pool cooldown). */
  | 'press'
  /** Fire continuously while the key is HELD (auto-fire; pool cooldown rate-limits). */
  | 'held';

/**
 * A control-scheme RECORD: the declarative input binding a scheme imposes on the
 * gallery-shooter player. The loader reads it and configures the player (free axis,
 * fire mode + the bound key). Every field is data; no game/theme is encoded.
 */
export interface ShooterScheme {
  /** The scheme id (matches the blueprint `controlScheme` ref). */
  id: string;
  /** One-line intent (diagnostics; mirrors a genre record's oneLineIntent). */
  intent: string;
  /** Which arrow pair sources the free-axis MOVE input. */
  move: MoveSource;
  /**
   * The FREE axis the move input drives ('x' = a horizontal bottom track, 'y' = a
   * vertical side track). The OTHER axis is hard-locked by AxisConstrainedMovement.
   * Mirrors the Aim slot position in top_down's record (the third descriptor field).
   */
  aim: 'x' | 'y';
  /** Whether the fire key fires on the edge (press) or continuously (held). */
  fire: FireMode;
  /** The keyboard key that fires (default 'SPACE'). */
  fireKey?: string;
}
