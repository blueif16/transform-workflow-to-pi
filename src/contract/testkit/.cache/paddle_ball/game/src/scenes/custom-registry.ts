/**
 * custom-registry.ts — the `custom[]` resolution seam (KEEP — engine seam).
 *
 * The blueprint's `custom[]` manifest is the genuinely-novel delta W4 authors as code
 * against the SDK interfaces (IBehavior / ISceneSystem). W4 REGISTERS each custom
 * entry's factory under its id here; DataPaddleScene RESOLVES "$custom:<id>" behavior
 * bindings and custom[] SYSTEM ids against this registry while building the level from
 * data. The SDK never names a specific custom capability — it only resolves whatever
 * the game registered. Mirrors top_down's scenes/custom-registry.ts near-verbatim.
 */
import type { IBehavior } from '../behaviors/IBehavior';
import type { ISceneSystem } from './paddle-data';

export type CustomBehaviorFactory = (params?: Record<string, any>) => IBehavior;
export type CustomSystemFactory = (params?: Record<string, any>) => ISceneSystem;

const behaviorFactories: Record<string, CustomBehaviorFactory> = {};
const systemFactories: Record<string, CustomSystemFactory> = {};

export function registerCustomBehavior(id: string, factory: CustomBehaviorFactory): void {
  behaviorFactories[id] = factory;
}
export function registerCustomSystem(id: string, factory: CustomSystemFactory): void {
  systemFactories[id] = factory;
}
export function resolveCustomBehavior(id: string): CustomBehaviorFactory | undefined {
  return behaviorFactories[id];
}
export function resolveCustomSystem(id: string): CustomSystemFactory | undefined {
  return systemFactories[id];
}
export function hasCustomRegistrations(): boolean {
  return (
    Object.keys(behaviorFactories).length > 0 || Object.keys(systemFactories).length > 0
  );
}
