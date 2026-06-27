/**
 * ============================================================================
 * TopDownScheme.ts — the data-driven CONTROL SCHEME contract for top_down
 * ============================================================================
 *
 * A top-down control scheme is the declarative INPUT BINDING the player consumes:
 * which input drives MOVE, which drives AIM, and whether/how the player FIRES. The
 * blueprint binds a scheme BY ID (`controlScheme: 'twin-stick' | 'topdown-8way'`);
 * the loader resolves it here and configures `DataPlayer` from the record — ZERO
 * per-game input code.
 *
 * WHY A RECORD, NOT A voxel-style sample() class: top_down input is ALREADY
 * scene-owned (BaseGameScene.setupInputs wires WASD/arrows/space/shift/E/Q/mouse)
 * and consumed by the FSM + the FaceTarget/RangedAttack behaviors. So a top-down
 * scheme does not re-sense raw DOM events (the voxel substrate had no scene-owned
 * input to reuse); it DECLARES which of the already-sensed sources map to move/aim/
 * fire, and the player wires its input HOOKS to match. This is the smallest durable
 * edit (Hermes law 6): reuse the engine's input plumbing, parameterize the binding.
 *
 * HEADLESS-DRIVEABLE: every binding resolves to the existing key/mouse hooks the
 * FSM reads, so a harness drives move with WASD `keydown` and aim/fire with the
 * mouse — no new event path. The decoupled-aim invariant (move D vs aim T) is the
 * SHAPE of the twin-stick record itself: move reads keys, aim reads the pointer,
 * fire launches along the aim — never along the move vector.
 *
 * GENERIC: a scheme names input SOURCES, never a game. The two first-ship records
 * (topdown-8way, twin-stick) live in ./schemes; a future scheme is one more record.
 */

/** Where the player's MOVE vector comes from. */
export type MoveSource = 'wasd-arrows';

/** Where the player's AIM (facing/fire) angle comes from — decoupled from move. */
export type AimSource =
  /** Aim follows the mouse/right-stick pointer (twin-stick: independent of move). */
  | 'pointer'
  /** Aim follows the MOVE direction (8-way only: facing == last move dir). */
  | 'movement';

/** How the player FIRES a ranged attack (when the scheme grants one). */
export type FireMode =
  /** No ranged fire (a melee/contact scheme). */
  | 'none'
  /** Fire on a key/button EDGE (one shot per press). */
  | 'press'
  /** Fire continuously while the button is HELD (twin-stick auto-fire). */
  | 'held';

/**
 * A control-scheme RECORD: the declarative input binding a scheme imposes on the
 * player. The loader reads it and configures DataPlayer (aim source, fire mode +
 * the bound input). Every field is data; no game/theme is encoded.
 */
export interface TopDownScheme {
  /** The scheme id (matches the blueprint `controlScheme` ref). */
  id: string;
  /** One-line intent (diagnostics; mirrors a genre record's oneLineIntent). */
  intent: string;
  /** Where the MOVE vector is read (8-way, normalized — diagonal not faster). */
  move: MoveSource;
  /** Where the AIM angle is read (pointer = decoupled twin-stick; movement = 8-way). */
  aim: AimSource;
  /** Whether/how the player fires a ranged attack. */
  fire: FireMode;
  /**
   * The pointer button that fires when `fire !== 'none'` (default left = 0). The
   * decoupled-aim binding: the shot launches along the AIM angle, regardless of
   * the move vector.
   */
  fireButton?: number;
}
