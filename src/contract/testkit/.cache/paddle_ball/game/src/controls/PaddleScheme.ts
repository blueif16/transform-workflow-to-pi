/**
 * ============================================================================
 * PaddleScheme.ts — the data-driven CONTROL SCHEME contract for paddle_ball
 * ============================================================================
 *
 * A paddle-ball control scheme is the declarative INPUT BINDING the paddle consumes:
 * which input SOURCE drives the paddle's one-axis MOVE, and along which AXIS. The
 * blueprint binds a scheme BY ID (`controlScheme: 'paddle-keys' | 'paddle-pointer'`);
 * the scene resolves it here and configures the PaddleController from the record —
 * ZERO per-game input code.
 *
 * WHY A RECORD (mirrors top_down's TopDownScheme): paddle_ball input is scene-owned
 * (BasePaddleScene wires the keys + the pointer) and consumed by the PaddleController
 * behavior. So a scheme does not re-sense raw DOM events; it DECLARES which already-
 * sensed source maps to the paddle move + which axis it slides on, and the controller
 * wires to match. Smallest durable edit: reuse the engine's input plumbing, parameterize.
 *
 * HEADLESS-DRIVEABLE: every binding resolves to the existing key/pointer hooks the
 * scene reads, so a harness drives the paddle with a real `keydown` (Left/Right or A/D)
 * — no new event path. The CONTROLLABLE invariant [RB §2.6]: under a simulated move key
 * the paddle (window.__GAME__.player) position CHANGES; a frozen paddle is a FAIL.
 *
 * GENERIC: a scheme names input SOURCES + an axis, never a game.
 */

/** Where the paddle's MOVE comes from. */
export type MoveSource =
  /** Left/Right + A/D keys (the classic keyboard paddle). */
  | 'keys'
  /** The pointer x|y (the paddle tracks the cursor on its axis — touch/mouse). */
  | 'pointer';

/** Which axis the paddle slides on (and the ball's death line is the opposite far edge). */
export type PaddleAxis =
  /** Horizontal bat at the bottom (Breakout default). */
  | 'x'
  /** Vertical bat on a side (a Pong wall). */
  | 'y';

/**
 * A control-scheme RECORD: the declarative input binding a scheme imposes on the
 * paddle. The scene reads it and configures the PaddleController (move source + axis).
 * Every field is data; no game/theme is encoded.
 */
export interface PaddleScheme {
  /** The scheme id (matches the blueprint `controlScheme` ref). */
  id: string;
  /** One-line intent (diagnostics; mirrors a genre record's oneLineIntent). */
  intent: string;
  /** Where the MOVE input is read (keys | pointer). */
  move: MoveSource;
  /** Which axis the paddle slides on (x = bottom bat, y = side bat). */
  axis: PaddleAxis;
}
