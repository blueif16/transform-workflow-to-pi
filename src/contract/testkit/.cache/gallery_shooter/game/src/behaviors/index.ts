/**
 * Behaviors — reusable behavior components for the gallery_shooter archetype.
 *
 * Mirrors top_down/src/behaviors/index.ts (the Component pattern: entities are
 * COMPOSED of behaviors). The registry discovers the bindable behavior taxonomy
 * from the classes here (membership-gated against `export class <impl>`), and the
 * barrel is stranded-export-gated: a behavior class exported here with no taxonomy
 * entry in registry/discover.mjs FAILS registry:check.
 *
 * Available bindable behaviors:
 * - AxisConstrainedMovement: slide the player along ONE axis, hard-lock the other
 *   (the laser-cannon track — the gallery-shooter signature constraint).
 *
 * Non-bindable engine seams (skipped by the stranded gate): IBehavior, BaseBehavior,
 * BehaviorManager, ScreenEffectHelper.
 */

// Core seams
export { type IBehavior, BaseBehavior } from './IBehavior';
export { BehaviorManager } from './BehaviorManager';

// Movement
export {
  AxisConstrainedMovement,
  type AxisConstrainedMovementConfig,
} from './AxisConstrainedMovement';

// Enemy AI / dive
export {
  DiveBomb,
  type DiveBombConfig,
} from './DiveBomb';

// Screen Effects (juice; bound to events via the effect registry)
export {
  ScreenEffectHelper,
  type ShakeConfig,
  type TrailConfig,
  type ExplosionConfig,
} from './ScreenEffectHelper';
