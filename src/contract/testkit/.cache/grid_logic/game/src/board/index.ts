/**
 * board — the LOGICAL grid engine (KEEP — engine, the two-worlds rule).
 *
 * The headlessly-testable core of grid_logic: the cell<->pixel adapter (GridMap),
 * the logical board state (GridBoard), the pure move resolver + win/lose
 * (MergeSlideResolver), and the spawn helper. The scene (DataGridScene) composes
 * these; the verify harness asserts the invariants directly on GridBoard.snapshot().
 */
export { GridMap, type GridCoord, type WorldPoint } from './grid-map';
export { GridBoard, type Grid } from './GridBoard';
export {
  resolveMove,
  hasReachedTarget,
  isGameOver,
  type SlideDir,
  type MoveResult,
} from './MergeSlideResolver';
export {
  spawnTile,
  rollSpawnValue,
  DEFAULT_SPAWN,
  type SpawnWeight,
} from './spawn';
