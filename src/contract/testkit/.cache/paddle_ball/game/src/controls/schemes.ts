/**
 * ============================================================================
 * schemes.ts — the two first-ship paddle control-scheme records + resolver
 * ============================================================================
 *
 * The drift-gated `controlScheme` capabilities (the registry catalogs them FROM
 * here). Each is a declarative `PaddleScheme` the scene resolves by id and applies to
 * the PaddleController. The blueprint binds `controlScheme: '<id>'`; nothing per-game
 * lives here.
 *
 * SCHEMES (RB §2.6):
 *   - paddle-keys    : the paddle slides on x driven by Left/Right + A/D keys. The
 *                      classic keyboard Breakout control; headless-driveable by a real
 *                      keydown (the proof the archetype is CONTROLLABLE).
 *   - paddle-pointer : the paddle tracks the pointer x on its axis (mouse / touch) —
 *                      the same one-axis paddle, pointer-driven for a phone.
 */
import type { PaddleScheme } from './PaddleScheme';

/** Keyboard paddle on the x axis (Left/Right + A/D). */
export const PADDLE_KEYS: PaddleScheme = {
  id: 'paddle-keys',
  intent: 'Slide the bottom bat left/right with the Left/Right or A/D keys — the classic keyboard Breakout control.',
  move: 'keys',
  axis: 'x',
};

/** Pointer-tracking paddle on the x axis (mouse / touch). */
export const PADDLE_POINTER: PaddleScheme = {
  id: 'paddle-pointer',
  intent: 'Track the pointer x with the bottom bat (mouse / touch) — the one-finger paddle for a phone.',
  move: 'pointer',
  axis: 'x',
};

/** Every control-scheme record this module ships (the catalog reads this). */
export const CONTROL_SCHEMES: readonly PaddleScheme[] = [
  PADDLE_KEYS,
  PADDLE_POINTER,
] as const;

const BY_ID: Record<string, PaddleScheme> = Object.fromEntries(
  CONTROL_SCHEMES.map((s) => [s.id, s]),
);

/**
 * Resolve a control-scheme id → its record. Unknown id → undefined (the scene falls
 * back to the keys default so a missing/typo'd ref never crashes the build). GENERIC.
 */
export function resolveScheme(id?: string): PaddleScheme | undefined {
  return id ? BY_ID[id] : undefined;
}

/** The default scheme when a level binds none (keys-on-x — the safe, controllable floor). */
export const DEFAULT_SCHEME: PaddleScheme = PADDLE_KEYS;
