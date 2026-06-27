/**
 * Systems — composable scene-level kind=system logics (KEEP — engine).
 *
 * A SYSTEM is scene-level cross-entity orchestration: it reads the ball↔brick world AND
 * writes an observable (score/status). It implements ISceneSystem (scenes/paddle-data.ts);
 * the DataPaddleScene constructs it from a blueprint `systems[]` binding ({ref,params}),
 * then runs its lifecycle (reset -> attach -> setupCollisions -> per-frame update).
 *
 * The base brick-breaker genre binds BrickGrid (the brick layer + clear-all win). Wave-2
 * deltas (PaddleDuelAI, MultiBall, PaddleGrow) land here + in ./registry with one line each.
 *
 * BARREL DISCIPLINE (mirrors top_down): export the system CLASSES here; the runtime
 * resolution map (SYSTEM_CLASSES / resolveSystem) lives in ./registry.
 */
export { BrickGrid, type BrickGridConfig } from './BrickGrid';
export { PaddleDuelAI, type PaddleDuelAIConfig } from './PaddleDuelAI';
export { MultiBall, type MultiBallConfig } from './MultiBall';
export { PaddleGrow, type PaddleGrowConfig } from './PaddleGrow';
export { BrickTypes, type BrickTypesConfig } from './BrickTypes';
export { PowerUpDrop, type PowerUpDropConfig } from './PowerUpDrop';
export { BallSpeedRamp, type BallSpeedRampConfig } from './BallSpeedRamp';
export { ScoreCombo, type ScoreComboConfig } from './ScoreCombo';
export {
  PinballBumpers,
  type PinballBumpersConfig,
  type BumperSpec,
  type TargetSpec,
  type RampZone,
  type RampSpec,
} from './PinballBumpers';
