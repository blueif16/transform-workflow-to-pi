/**
 * custom-registry.ts — the W4 custom[] component registration seam (KEEP — engine seam).
 *
 * The genuinely-novel delta a blueprint declares in `custom[]` is the ONLY code W4
 * authors. A custom behavior / system registers its factory here ONCE (before boot), and
 * DataRunnerScene resolves "$custom:<id>" bindings + custom[] systems against this
 * registry. Mirrors platformer/top_down's scenes/custom-registry.ts.
 *
 * EMPTY for the base genre (gravity-flap composes entirely from registered ids — the
 * scroller + the scorer + the flap movement). A game with a novel obstacle/pickup
 * behavior registers it here; the resolver returns undefined for an unknown id (clean).
 */
import type { IBehavior } from '../behaviors';
import type { ISceneSystem } from './runner-data';

/** A custom behavior factory: params → an IBehavior. */
export type CustomBehaviorFactory = (params?: Record<string, any>) => IBehavior;
/** A custom system factory: () → an ISceneSystem. */
export type CustomSystemFactory = () => ISceneSystem;

const CUSTOM_BEHAVIORS: Record<string, CustomBehaviorFactory> = {};
const CUSTOM_SYSTEMS: Record<string, CustomSystemFactory> = {};

/** Register a custom behavior factory under an id (W4 calls this once before boot). */
export function registerCustomBehavior(id: string, factory: CustomBehaviorFactory): void {
  CUSTOM_BEHAVIORS[id] = factory;
}
/** Register a custom system factory under an id. */
export function registerCustomSystem(id: string, factory: CustomSystemFactory): void {
  CUSTOM_SYSTEMS[id] = factory;
}

/** Resolve a "$custom:<id>" behavior id → its factory (undefined when unknown). */
export function resolveCustomBehavior(id: string): CustomBehaviorFactory | undefined {
  return CUSTOM_BEHAVIORS[id];
}
/** Resolve a custom system id → its factory (undefined when unknown). */
export function resolveCustomSystem(id: string): CustomSystemFactory | undefined {
  return CUSTOM_SYSTEMS[id];
}
