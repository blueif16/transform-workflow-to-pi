/**
 * scenes — the paddle-ball scene layer (KEEP — engine).
 *
 * BasePaddleScene (the engine base: paddle/ball/lives/win-lose) → DataPaddleScene (the
 * data-driven loader) → Level1Scene (the ~5-line shell that loads the committed default
 * levels/level1.json). W2 overwrites the level data per-game; the path is unchanged.
 */
export { BasePaddleScene } from './BasePaddleScene';
export { DataPaddleScene } from './DataPaddleScene';
export { Level1Scene } from './Level1Scene';
export type {
  PaddleLevelData,
  PaddleData,
  BallData,
  BrickData,
  BrickGridData,
  SystemBinding,
  BehaviorBinding,
  ISceneSystem,
} from './paddle-data';
