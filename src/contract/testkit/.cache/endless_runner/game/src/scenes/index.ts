/**
 * scenes — the endless_runner level scenes + the data-driven loader (KEEP — engine).
 *
 * BaseRunnerScene (the engine base wiring the hook) → DataRunnerScene (the data-driven
 * loader) → Level1Scene (the shell that loads the committed default level data). W4 adds
 * level scenes here when a game has a difficulty ladder.
 */
export { BaseRunnerScene } from './BaseRunnerScene';
export { DataRunnerScene } from './DataRunnerScene';
export { Level1Scene } from './Level1Scene';
export type {
  RunnerLevelData,
  AvatarData,
  ObstacleStreamData,
  BehaviorBinding,
  SystemBinding,
  EffectBinding,
  ISceneSystem,
} from './runner-data';
export { LEVEL_ORDER } from './runner-data';
export {
  registerCustomBehavior,
  registerCustomSystem,
  resolveCustomBehavior,
  resolveCustomSystem,
} from './custom-registry';
