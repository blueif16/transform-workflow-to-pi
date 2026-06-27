/**
 * controls — the data-driven top-down control schemes (KEEP — engine seam).
 *
 * A control scheme is the declarative INPUT BINDING the player consumes (move/aim/
 * fire sources). The blueprint binds one by id (`controlScheme`); the loader
 * resolves it here and configures DataPlayer. Mirrors voxel_sandbox/src/controls/
 * (the scheme-file pattern) — top_down's schemes are RECORDS (input is already
 * scene-owned) rather than DOM-sensing classes.
 */
export type {
  TopDownScheme,
  MoveSource,
  AimSource,
  FireMode,
} from './TopDownScheme';
export {
  CONTROL_SCHEMES,
  TOPDOWN_8WAY,
  TWIN_STICK,
  DEFAULT_SCHEME,
  resolveScheme,
} from './schemes';
