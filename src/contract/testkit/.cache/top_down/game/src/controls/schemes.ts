/**
 * ============================================================================
 * schemes.ts — the two first-ship top-down control-scheme records + resolver
 * ============================================================================
 *
 * The drift-gated `controlScheme` capabilities (M3 catalogs them from here). Each
 * is a declarative `TopDownScheme` the loader resolves by id and applies to the
 * player. The blueprint binds `controlScheme: '<id>'`; nothing per-game lives here.
 *
 * SCHEMES (RB §2.5):
 *   - topdown-8way  : 8-way move; aim FOLLOWS the move direction; no ranged fire.
 *                     The classic move-only top-down control (a maze, a lane-dodge,
 *                     a melee dungeon). Facing == last move dir.
 *   - twin-stick    : 8-way move + DECOUPLED pointer aim + held-button auto-fire.
 *                     The arena-shooter control: the move vector and the aim vector
 *                     are INDEPENDENT — you strafe one way while shooting another.
 *
 * The decoupled-aim invariant lives in the twin-stick record's SHAPE: move reads
 * keys, aim reads the pointer, fire launches along the aim — so a projectile fired
 * while moving in D toward target T points at T, never at D.
 */
import type { TopDownScheme } from './TopDownScheme';

/** Move-only 8-way control (aim tracks the move direction; no fire). */
export const TOPDOWN_8WAY: TopDownScheme = {
  id: 'topdown-8way',
  intent: '8-way move; aim follows the move direction; no ranged fire (melee/maze/lane).',
  move: 'wasd-arrows',
  aim: 'movement',
  fire: 'none',
};

/** Twin-stick: 8-way move + decoupled pointer aim + held-button auto-fire. */
export const TWIN_STICK: TopDownScheme = {
  id: 'twin-stick',
  intent:
    '8-way move + decoupled pointer/right-stick aim + held-button auto-fire (arena shooter).',
  move: 'wasd-arrows',
  aim: 'pointer',
  fire: 'held',
  fireButton: 0,
};

/** Every control-scheme record this module ships (the M3 catalog reads this). */
export const CONTROL_SCHEMES: readonly TopDownScheme[] = [
  TOPDOWN_8WAY,
  TWIN_STICK,
] as const;

const BY_ID: Record<string, TopDownScheme> = Object.fromEntries(
  CONTROL_SCHEMES.map((s) => [s.id, s]),
);

/**
 * Resolve a control-scheme id → its record. Unknown id → undefined (the loader
 * falls back to the default move-only scheme so a missing/typo'd ref never crashes
 * the build). GENERIC: id-keyed, no game.
 */
export function resolveScheme(id?: string): TopDownScheme | undefined {
  return id ? BY_ID[id] : undefined;
}

/** The default scheme when a level binds none (move-only, the safe floor). */
export const DEFAULT_SCHEME: TopDownScheme = TOPDOWN_8WAY;
