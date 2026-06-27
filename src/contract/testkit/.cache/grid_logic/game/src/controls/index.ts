/**
 * controls — the data-driven grid control schemes (KEEP — engine seam).
 *
 * A control scheme is the declarative INPUT BINDING the scene consumes: which key
 * produces which discrete move intent, on the key-down edge. The blueprint binds
 * one by id (`controlScheme`); the scene resolves it here and maps keys -> intents.
 * Mirrors top_down/src/controls/ (the scheme-record pattern) — grid_logic's schemes
 * are RECORDS (input is already scene-owned) rather than DOM-sensing classes.
 */
export type {
  GridScheme,
  GridIntent,
  GridInputMode,
} from './GridScheme';
export {
  CONTROL_SCHEMES,
  GRID_4WAY,
  DEFAULT_SCHEME,
  resolveScheme,
} from './schemes';
