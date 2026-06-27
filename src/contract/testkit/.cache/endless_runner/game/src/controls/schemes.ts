/**
 * ============================================================================
 * schemes.ts — the endless_runner control-scheme records + resolver
 * ============================================================================
 *
 * The drift-gated `control-scheme` capabilities (the registry discover catalogs them
 * from the taxonomy, membership-gated against the backing class existing). Each record
 * names the input scheme the blueprint binds by id (`controlScheme: '<id>'`); the
 * loader resolves it and attaches the matching DOM-sensing scheme to the run — ZERO
 * per-game input code.
 *
 * SCHEMES (base genre gravity-flap):
 *   - gravity-flap-1btn : ONE button (Space / up / tap / touch) = FLAP. The whole
 *                         Flappy Bird input. Headless-driveable via a real keydown.
 *
 * Wave-2 schemes (auto-run-jump = a jump button + hold-for-higher; hold-to-rise = a
 * held thrust; lane-runner = swipe lane/jump/slide) add one record + class each here.
 */
import { GravityFlapScheme } from './GravityFlapScheme';

/** A control-scheme record: the declarative input binding (id + the backing class). */
export interface RunnerScheme {
  /** The scheme id (matches the blueprint `controlScheme` ref). */
  id: string;
  /** One-line intent (diagnostics; mirrors a genre record's oneLineIntent). */
  intent: string;
  /** The DOM-sensing class that implements the scheme. */
  implements: 'GravityFlapScheme';
}

/** The one-button flap scheme (Space / up / tap = flap). */
export const GRAVITY_FLAP_1BTN: RunnerScheme = {
  id: 'gravity-flap-1btn',
  intent:
    'One-button flap: Space / ArrowUp / W / tap / touch = a single FLAP impulse (one per press, edge-triggered). The whole Flappy Bird input; headless-driveable via a real keydown.',
  implements: 'GravityFlapScheme',
};

/** Every control-scheme record this module ships (the registry catalog reads this). */
export const CONTROL_SCHEMES: readonly RunnerScheme[] = [GRAVITY_FLAP_1BTN] as const;

const BY_ID: Record<string, RunnerScheme> = Object.fromEntries(
  CONTROL_SCHEMES.map((s) => [s.id, s]),
);

/**
 * Construct the DOM-sensing scheme for a bound id. Unknown id → the default flap
 * scheme so a missing/typo'd ref never ships a frozen avatar. GENERIC: id-keyed.
 */
export function makeScheme(id: string | undefined, canvas?: HTMLCanvasElement): GravityFlapScheme {
  const rec = (id && BY_ID[id]) || DEFAULT_SCHEME;
  // Only one implementing class today; the switch grows with Wave-2 schemes.
  switch (rec.implements) {
    case 'GravityFlapScheme':
    default:
      return new GravityFlapScheme(canvas);
  }
}

/** Resolve a scheme id → its record (or undefined). */
export function resolveScheme(id?: string): RunnerScheme | undefined {
  return id ? BY_ID[id] : undefined;
}

/** The default scheme when a level binds none (the one-button flap — the safe floor). */
export const DEFAULT_SCHEME: RunnerScheme = GRAVITY_FLAP_1BTN;
