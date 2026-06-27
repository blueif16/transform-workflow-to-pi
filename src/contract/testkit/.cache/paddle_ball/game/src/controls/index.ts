/**
 * controls — the data-driven paddle control schemes (KEEP — engine seam).
 *
 * A control scheme is the declarative INPUT BINDING the paddle consumes (move source +
 * axis). The blueprint binds one by id (`controlScheme`); the scene resolves it here
 * and configures the PaddleController. Mirrors top_down/src/controls/ (the scheme-file
 * pattern) — paddle_ball's schemes are RECORDS (input is scene-owned).
 */
export type { PaddleScheme, MoveSource, PaddleAxis } from './PaddleScheme';
export {
  CONTROL_SCHEMES,
  PADDLE_KEYS,
  PADDLE_POINTER,
  DEFAULT_SCHEME,
  resolveScheme,
} from './schemes';
