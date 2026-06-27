/**
 * scenes — the data-driven grid-board level scenes (KEEP — engine).
 *
 * DataGridScene is the data-driven loader (builds the whole board from
 * GridLevelData, exposes window.__GAME__); Level1Scene is the committed default
 * shell. W4 appends more level shells; the construction path is unchanged.
 */
export { DataGridScene } from './DataGridScene';
export { Level1Scene } from './Level1Scene';
export type {
  GridLevelData,
  GridConfigData,
  TileData,
  SystemBinding,
  BehaviorBinding,
  IGridSystem,
  SpawnWeightData,
} from './grid-data';
export { LEVEL_ORDER } from './grid-data';
export {
  registerCustomBehavior,
  registerCustomSystem,
  resolveCustomBehavior,
  resolveCustomSystem,
  hasCustomRegistrations,
  type CustomBehaviorFactory,
  type CustomSystemFactory,
} from './custom-registry';
