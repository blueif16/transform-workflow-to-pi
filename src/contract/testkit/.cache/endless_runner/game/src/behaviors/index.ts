/**
 * Behaviors — reusable component logic for the endless_runner avatar (KEEP — engine).
 *
 * A behavior is a composable piece of avatar logic (the Component pattern). The
 * data-driven scene composes the avatar's bound behaviors[] from the level data and
 * ticks them each frame. Mirrors platformer/top_down behaviors/.
 *
 * BARREL DISCIPLINE: export the behavior CLASSES here; the registry discover.mjs
 * cross-checks this barrel for a STRANDED export (a behavior class with no CAPABILITY
 * const = built-but-unwired). The runtime id→class resolution map lives in ./registry.
 *
 * Available (base genre gravity-flap):
 *   - GravityFlapMovement: gravity + fixed-impulse one-button flap (the core verb).
 */

// Core seam.
export { type IBehavior, BaseBehavior } from './IBehavior';
export { BehaviorManager } from './BehaviorManager';

// Movement.
export {
  GravityFlapMovement,
  type GravityFlapMovementConfig,
} from './GravityFlapMovement';
export { GroundRunJump, type GroundRunJumpConfig } from './GroundRunJump';
export { HoldThrust, type HoldThrustConfig } from './HoldThrust';
export { LaneSnapMovement, type LaneSnapMovementConfig } from './LaneSnapMovement';
export { BeatFlap, type BeatFlapConfig } from './BeatFlap';
export { SlopeGlide, type SlopeGlideConfig } from './SlopeGlide';
export { AirTrick, type AirTrickConfig } from './AirTrick';
