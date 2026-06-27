/**
 * custom-registry.ts — the `custom[]` resolution seam (KEEP — engine seam).
 *
 * The blueprint's `custom[]` manifest is the genuinely-novel delta W4 authors as code
 * against the SDK interfaces (IBehavior / ISceneSystem). W4 REGISTERS each custom
 * entry's factory under its id here; DataShooterScene RESOLVES "$custom:<id>" behavior
 * bindings and custom[] SYSTEM ids against this registry while building the level from
 * data. This is how the SDK instantiates the level WITHOUT importing any game file.
 *
 * GENERIC: the SDK never names a specific custom capability — it only resolves whatever
 * the game registered. (Mirrors top_down's scenes/custom-registry.ts near-verbatim.)
 */
import type { IBehavior } from '../behaviors/IBehavior';
import type { ISceneSystem } from './shooter-data';

/** A custom behavior factory: params -> an IBehavior (the {ref,params} contract). */
export type CustomBehaviorFactory = (params?: Record<string, any>) => IBehavior;
/** A custom system factory: params -> an ISceneSystem. */
export type CustomSystemFactory = (params?: Record<string, any>) => ISceneSystem;

const behaviorFactories: Record<string, CustomBehaviorFactory> = {};
const systemFactories: Record<string, CustomSystemFactory> = {};

/** Register a `$custom:<id>` behavior (attached to an entity from layout). */
export function registerCustomBehavior(id: string, factory: CustomBehaviorFactory): void {
  behaviorFactories[id] = factory;
}

/** Register a `custom[]` SYSTEM (kind:'system', attachedTo:'scene'). */
export function registerCustomSystem(id: string, factory: CustomSystemFactory): void {
  systemFactories[id] = factory;
}

/** Resolve a registered custom behavior; undefined when not registered. */
export function resolveCustomBehavior(id: string): CustomBehaviorFactory | undefined {
  return behaviorFactories[id];
}

/** Resolve a registered custom system; undefined when not registered. */
export function resolveCustomSystem(id: string): CustomSystemFactory | undefined {
  return systemFactories[id];
}

/** True once at least one custom factory is registered (for diagnostics). */
export function hasCustomRegistrations(): boolean {
  return (
    Object.keys(behaviorFactories).length > 0 ||
    Object.keys(systemFactories).length > 0
  );
}
