/**
 * Systems — composable scene-level kind=system logics (KEEP — engine).
 *
 * A SYSTEM is scene-level orchestration: it reads the run state AND writes an observable
 * (score/status) or owns the world's motion. It implements ISceneSystem (runner-data.ts);
 * DataRunnerScene constructs it from a blueprint `systems[]` binding ({ref,params}) and
 * runs its lifecycle (reset → attach → setupCollisions → per-frame update).
 *
 * BARREL DISCIPLINE (mirrors top_down): export the system CLASSES here; the runtime
 * resolution map (SYSTEM_CLASSES / resolveSystem) lives in ./registry and is imported
 * DIRECTLY by DataRunnerScene — NOT re-exported here. The registry discover.mjs
 * cross-checks this barrel for a STRANDED export (a system class with no CAPABILITY).
 *
 * SCOPE (base genre gravity-flap): the two engine systems —
 *   - ObstacleScrollSystem: auto-scroll + deterministic procedural obstacles + lose seam.
 *   - ScoreOnPassSystem:     score exactly once per threaded obstacle.
 * Wave-2 systems (a difficulty ramp, a pickup line, a chaser) add one export each here.
 */
export {
  ObstacleScrollSystem,
  type ObstacleScrollConfig,
} from './ObstacleScrollSystem';
export {
  ScoreOnPassSystem,
  type ScoreOnPassConfig,
} from './ScoreOnPassSystem';
export {
  ChaserSystem,
  type ChaserConfig,
} from './ChaserSystem';
export {
  CoinLinePickup,
  type CoinLineConfig,
} from './CoinLinePickup';
export {
  DifficultyRamp,
  type DifficultyRampConfig,
} from './DifficultyRamp';
export {
  ShieldPickup,
  type ShieldPickupConfig,
} from './ShieldPickup';
export {
  NearMissStreak,
  type NearMissStreakConfig,
} from './NearMissStreak';
export {
  MagnetPickup,
  type MagnetPickupConfig,
} from './MagnetPickup';
export {
  BeatGate,
  type BeatGateConfig,
} from './BeatGate';
