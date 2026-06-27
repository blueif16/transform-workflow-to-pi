/**
 * systems/registry.ts — the runtime id→factory resolution map for kind=system scene
 * logics (KEEP — engine seam; mirrors platformer/top_down systems/registry.ts).
 *
 * The blueprint BINDS to system ids as DATA (blueprint.systems[] = {ref,params}); the
 * SDK RESOLVES each id → a constructed ISceneSystem here, so DataRunnerScene
 * instantiates a run's scene logics with NO per-game system code. GENERIC: a logic is
 * added in ONE place (its file + one line below); every future blueprint can then bind
 * it by id. An unknown ref returns undefined (the loader skips it cleanly).
 *
 * SCOPE (base genre gravity-flap): the two engine systems are registered —
 * ObstacleScrollSystem (the scroller) + ScoreOnPassSystem (the scorer). Wave-2 systems
 * add one line each here.
 */
import type { ISceneSystem } from '../scenes/runner-data';
import { ObstacleScrollSystem } from './ObstacleScrollSystem';
import { ScoreOnPassSystem } from './ScoreOnPassSystem';
import { ChaserSystem } from './ChaserSystem';
import { CoinLinePickup } from './CoinLinePickup';
import { DifficultyRamp } from './DifficultyRamp';
import { ShieldPickup } from './ShieldPickup';
import { NearMissStreak } from './NearMissStreak';
import { MagnetPickup } from './MagnetPickup';
import { BeatGate } from './BeatGate';

/** A system factory constructed from a single `params` object (the {ref,params} shape). */
export type SystemFactory = (params?: Record<string, any>) => ISceneSystem;

/**
 * id → system factory, for `levelData.systems[] = {ref, params}`. The loader does
 * `SYSTEM_CLASSES[ref](params)` and runs the ISceneSystem lifecycle.
 */
export const SYSTEM_CLASSES: Record<string, SystemFactory> = {
  ObstacleScrollSystem: (params) => new ObstacleScrollSystem(params ?? {}),
  ScoreOnPassSystem: (params) => new ScoreOnPassSystem(params ?? {}),
  ChaserSystem: (params) => new ChaserSystem(params ?? {}),
  CoinLinePickup: (params) => new CoinLinePickup(params ?? {}),
  DifficultyRamp: (params) => new DifficultyRamp(params ?? {}),
  ShieldPickup: (params) => new ShieldPickup(params ?? {}),
  NearMissStreak: (params) => new NearMissStreak(params ?? {}),
  MagnetPickup: (params) => new MagnetPickup(params ?? {}),
  BeatGate: (params) => new BeatGate(params ?? {}),
};

/** Resolve a system id → a constructed ISceneSystem; undefined when unknown. */
export function resolveSystem(id: string, params?: Record<string, any>): ISceneSystem | undefined {
  const factory = SYSTEM_CLASSES[id];
  return factory ? factory(params) : undefined;
}
