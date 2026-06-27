/**
 * Behaviors — reusable behavior components for paddle_ball games.
 *
 * Behaviors follow the Component pattern (compose, don't inherit). The paddle's
 * locomotion is the one shipped behavior; future deltas (a Pong AI mover, a flipper)
 * land here + in ./registry with one line each.
 *
 * Available behaviors:
 * - PaddleController: one-axis paddle locomotion (the CONTROLLABLE seam).
 */

// Core
export { type IBehavior, BaseBehavior } from './IBehavior';
export { BehaviorManager } from './BehaviorManager';
export { ScreenEffectHelper, type ShakeConfig } from './ScreenEffectHelper';

// Locomotion
export {
  PaddleController,
  type PaddleControllerConfig,
} from './PaddleController';

// Genre seams
export {
  PinballFlippers,
  type PinballFlippersConfig,
} from './PinballFlippers';
export { SpinShot, type SpinShotConfig } from './SpinShot';
