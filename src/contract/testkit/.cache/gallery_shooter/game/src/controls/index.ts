/**
 * controls — the data-driven gallery-shooter control schemes (KEEP — engine seam).
 *
 * A control scheme is the declarative INPUT BINDING the player consumes (move along
 * the free axis + fire). The blueprint binds one by id (`controlScheme`); the loader
 * resolves it here and configures the player. Mirrors top_down/src/controls/ (the
 * scheme-record pattern) — input is already scene-owned, so a scheme is a RECORD, not
 * a DOM-sensing class.
 */
export type {
  ShooterScheme,
  MoveSource,
  FireMode,
} from './ShooterScheme';
export {
  CONTROL_SCHEMES,
  FIXED_AXIS,
  DEFAULT_SCHEME,
  resolveScheme,
} from './schemes';
