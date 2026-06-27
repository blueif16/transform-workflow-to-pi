/**
 * ============================================================================
 * schemes.ts — the gallery_shooter control-scheme records + resolver
 * ============================================================================
 *
 * The drift-gated `controlScheme` capabilities (the registry catalogs them from
 * here). Each is a declarative `ShooterScheme` the loader resolves by id and applies
 * to the player. The blueprint binds `controlScheme: '<id>'`; nothing per-game lives
 * here.
 *
 * SCHEMES (RB §2):
 *   - fixed-axis : slide ←/→ along the bottom track + fire Space upward, one shot per
 *                  press, rate-limited by the projectile-pool cooldown. The classic
 *                  Space Invaders laser-cannon control. There is NO up/down binding,
 *                  so the player physically cannot leave its track (the constrained-
 *                  axis invariant lives in the record SHAPE).
 *
 * The discovery selector reads the FIXED_AXIS const's id/intent/move/aim/fire fields
 * (code-truth); the membership gate trips if the record disappears.
 */
import type { ShooterScheme } from './ShooterScheme';

/** Bottom-track laser cannon: slide ←/→ on x, fire Space upward (press). */
export const FIXED_AXIS: ShooterScheme = {
  id: 'fixed-axis',
  intent:
    'Slide left/right along the bottom track and fire straight up (one shot per press, rate-limited by the projectile pool). The Space Invaders laser cannon — no up/down, the player cannot leave its axis.',
  move: 'lr-arrows',
  aim: 'x',
  fire: 'press',
  fireKey: 'SPACE',
};

/** Every control-scheme record this module ships (the registry reads this). */
export const CONTROL_SCHEMES: readonly ShooterScheme[] = [FIXED_AXIS] as const;

const BY_ID: Record<string, ShooterScheme> = Object.fromEntries(
  CONTROL_SCHEMES.map((s) => [s.id, s]),
);

/**
 * Resolve a control-scheme id → its record. Unknown id → undefined (the loader
 * falls back to the default scheme so a missing/typo'd ref never crashes the build).
 */
export function resolveScheme(id?: string): ShooterScheme | undefined {
  return id ? BY_ID[id] : undefined;
}

/** The default scheme when a level binds none (the bottom-track cannon). */
export const DEFAULT_SCHEME: ShooterScheme = FIXED_AXIS;
