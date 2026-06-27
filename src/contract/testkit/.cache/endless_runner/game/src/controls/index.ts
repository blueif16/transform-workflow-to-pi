/**
 * controls — the data-driven endless_runner control schemes (KEEP — engine seam).
 *
 * A control scheme is the one-button input the avatar consumes (flap). The blueprint
 * binds one by id (`controlScheme`); the loader resolves it here and attaches the
 * matching DOM-sensing scheme to the run. Mirrors voxel_sandbox/src/controls/ (the
 * scheme-as-class pattern) — an endless runner has no scene-owned input to reuse, so
 * the scheme SENSES raw DOM (headless-driveable via real keydown/pointerdown/touch).
 */
export { GravityFlapScheme, type FlapInput } from './GravityFlapScheme';
export {
  CONTROL_SCHEMES,
  GRAVITY_FLAP_1BTN,
  DEFAULT_SCHEME,
  makeScheme,
  resolveScheme,
  type RunnerScheme,
} from './schemes';
