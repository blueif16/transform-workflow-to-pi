/**
 * Scenes — Game scene classes for top-down games (data-driven).
 *
 * Architecture (M1 modernization — the dead class-inheritance level path was
 * retired in favor of the data-driven spine platformer/voxel prove):
 *
 *   BaseGameScene        ← the shared engine base: groups, programmatic-wall
 *                          collision (no-clip + wall-slide), entity collisions,
 *                          Y-sort, scene-owned input, camera follow, the
 *                          markReady() + win/lose registry seam, the 6 abstract
 *                          build methods.
 *     └── DataTopDownScene ← THE data-driven loader: reads a TopDownLevelData and
 *                            instantiates the WHOLE level from DATA (walls, spawn,
 *                            enemies, rewards, goal), binds each entity's behaviors,
 *                            runs systems[], resolves "$custom:<id>". ZERO per-game
 *                            placement code.
 *
 * The in-game HUD (UIScene) and all menu/end-screen scenes are provided by
 * `templates/core/` — this module does NOT ship its own UIScene.
 */

export { BaseGameScene, type PlayerClassMap } from './BaseGameScene';

// Data-driven level loader (the Track-B core) + its data/system contracts.
export { DataTopDownScene } from './DataTopDownScene';
export type {
  TopDownLevelData,
  WallData,
  RewardData,
  ThreatData,
  GoalData,
  EffectBinding,
  SystemBinding,
  BehaviorBinding,
  ISceneSystem,
} from './topdown-data';
export { LEVEL_ORDER } from './topdown-data';
export {
  registerCustomBehavior,
  registerCustomSystem,
  resolveCustomBehavior,
  resolveCustomSystem,
  type CustomBehaviorFactory,
  type CustomSystemFactory,
} from './custom-registry';
