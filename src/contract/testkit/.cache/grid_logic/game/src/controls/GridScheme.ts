/**
 * ============================================================================
 * GridScheme.ts — the data-driven CONTROL SCHEME contract for grid_logic
 * ============================================================================
 *
 * A grid-logic control scheme is the declarative INPUT BINDING that turns a raw
 * key/pointer event into a discrete MOVE INTENT the resolver consumes (research
 * brief §(b) engine piece 6: "input is mapped to an abstract intent the resolver
 * consumes — never wired straight to board mutation"). The blueprint binds a
 * scheme BY ID (`controlScheme: 'grid-4way'`); the scene resolves it and reads the
 * scheme to map keys -> intents — ZERO per-game input code.
 *
 * WHY A RECORD, like top_down (not a DOM-sensing class): input is ALREADY
 * scene-owned (DataGridScene wires the arrow/WASD keys). A grid scheme DECLARES
 * which already-sensed keys produce which direction intent + the INPUT MODE (press
 * = one move per key-down EDGE, the discrete-move discipline — never a per-frame
 * hold that would fire a move every frame the key is down). The smallest durable
 * edit: reuse the engine's input plumbing, parameterise the binding.
 *
 * HEADLESS-DRIVEABLE: every binding resolves to a Phaser keyCode the scene reads
 * on its down EDGE, so a harness drives a move with a real `keydown` event — no new
 * event path. ONE keydown -> exactly ONE resolved move (the discrete-move invariant
 * the press mode encodes).
 *
 * GENERIC: a scheme names input SOURCES + intents, never a game. The first-ship
 * record (grid-4way) lives in ./schemes; a future scheme (a cell-select swap scheme
 * for match-3) is one more record.
 */

/** The discrete move intents a grid scheme can produce. */
export type GridIntent = 'up' | 'down' | 'left' | 'right';

/**
 * How an input fires a move:
 *   - 'press' : one move per key-DOWN edge (the discrete-move discipline — a held
 *               key does NOT repeat-fire every frame). Every slide/fall genre.
 */
export type GridInputMode = 'press';

/**
 * A control-scheme RECORD: the declarative input binding a grid scheme imposes.
 * The scene reads it and maps each declared key to its intent on the key-down edge.
 * Every field is data; no game/theme is encoded.
 */
export interface GridScheme {
  /** The scheme id (matches the blueprint `controlScheme` ref). */
  id: string;
  /** One-line intent (diagnostics; mirrors a genre record's oneLineIntent). */
  intent: string;
  /** The input mode (press = one move per key-down edge). */
  mode: GridInputMode;
  /**
   * The key -> intent binding. Keys are Phaser KeyCodes names the scene's keyboard
   * plugin understands (UP/DOWN/LEFT/RIGHT/W/A/S/D); the scene listens for each on
   * its DOWN edge and emits the mapped intent exactly once.
   */
  bindings: Record<string, GridIntent>;
}
