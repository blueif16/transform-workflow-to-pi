/**
 * ============================================================================
 * schemes.ts — the first-ship grid control-scheme record(s) + resolver
 * ============================================================================
 *
 * The drift-gated `controlScheme` capability (the registry catalogs it from here).
 * Each is a declarative `GridScheme` the scene resolves by id and reads to map keys
 * -> discrete move intents. The blueprint binds `controlScheme: '<id>'`; nothing
 * per-game lives here.
 *
 * SCHEME (research brief §(b) piece 6):
 *   - grid-4way : Arrow keys + WASD -> up/down/left/right move intents, on the
 *                 key-DOWN edge (one move per press). The classic slide/fall control
 *                 (merge-slide/2048, falling-block). Headless-driveable: a `keydown`
 *                 of ArrowLeft fires exactly one 'left' move.
 *
 * The discrete-move invariant lives in the record's SHAPE: mode 'press' means the
 * scene fires the intent on the down EDGE only — a held key never repeat-resolves.
 */
import type { GridScheme } from './GridScheme';

/** 4-direction press control: arrows + WASD -> a single move per key-down edge. */
export const GRID_4WAY: GridScheme = {
  id: 'grid-4way',
  intent:
    '4-direction discrete move: Arrow keys / WASD -> up|down|left|right, one move per key-down edge (slide/fall genres).',
  mode: 'press',
  bindings: {
    UP: 'up',
    DOWN: 'down',
    LEFT: 'left',
    RIGHT: 'right',
    W: 'up',
    S: 'down',
    A: 'left',
    D: 'right',
  },
};

/** Every control-scheme record this module ships (the registry reads this). */
export const CONTROL_SCHEMES: readonly GridScheme[] = [GRID_4WAY] as const;

const BY_ID: Record<string, GridScheme> = Object.fromEntries(
  CONTROL_SCHEMES.map((s) => [s.id, s]),
);

/**
 * Resolve a control-scheme id -> its record. Unknown id -> undefined (the scene
 * falls back to the default 4-way scheme so a missing/typo'd ref never breaks
 * input). GENERIC: id-keyed, no game.
 */
export function resolveScheme(id?: string): GridScheme | undefined {
  return id ? BY_ID[id] : undefined;
}

/** The default scheme when a level binds none (4-way, the safe floor). */
export const DEFAULT_SCHEME: GridScheme = GRID_4WAY;
