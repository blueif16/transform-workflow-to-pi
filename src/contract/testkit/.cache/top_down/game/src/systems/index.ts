/**
 * Systems — composable scene-level kind=system logics (KEEP — engine).
 *
 * A SYSTEM is scene-level cross-entity orchestration: it reads overlaps across
 * entities (player <-> enemies/rewards/goal) AND writes an observable
 * (score/status). It implements ISceneSystem (scenes/topdown-data.ts); the
 * DataTopDownScene constructs it from a blueprint `systems[]` binding ({ref,params}),
 * then runs its lifecycle (reset -> attach -> setupCollisions -> per-frame update).
 * This is the registered, composable replacement for the orphan's monolithic
 * BaseArenaScene wave-spawner / kill-all base classes — the design binds small
 * logics BY ID and tunes them with PARAMS.
 *
 * SCOPE NOTE (M2): the first genre systems land here — KillAllGoal + WaveSpawner
 * (the twin-stick arena: spawn escalating waves, win when all cleared). CollectGoal
 * (M2 fast-follow) and GhostModeController (M5) follow, each exported here +
 * registered in ./registry with ONE line.
 *
 * BARREL DISCIPLINE (mirrors behaviors/index.ts): export the system CLASSES here;
 * the runtime resolution map (SYSTEM_CLASSES / resolveSystem) lives in ./registry
 * and is imported DIRECTLY by DataTopDownScene — NOT re-exported here.
 */

export { KillAllGoal, type KillAllGoalConfig } from './KillAllGoal';
export {
  WaveSpawner,
  type WaveSpawnerConfig,
  type WaveEnemyTemplate,
} from './WaveSpawner';
export { CollectGoal, type CollectGoalConfig } from './CollectGoal';
export {
  GhostModeController,
  type GhostModeControllerConfig,
  type GhostMode,
} from './GhostModeController';
export {
  ScreenWrapSystem,
  type ScreenWrapConfig,
} from './ScreenWrapSystem';
export {
  BombPlacement,
  type BombPlacementConfig,
} from './BombPlacement';
export {
  DestructibleGrid,
  type DestructibleGridConfig,
  type BrickCell,
  type GridTile,
} from './DestructibleGrid';
export {
  LaneScrollSystem,
  type LaneScrollSystemConfig,
  type LaneTemplate,
} from './LaneScrollSystem';
export {
  CarrierRideSystem,
  type CarrierRideConfig,
  type RideRegion,
} from './CarrierRideSystem';
export {
  ComboMultiplier,
  type ComboMultiplierConfig,
} from './ComboMultiplier';
export {
  ScoreCoupledThreat,
  type ScoreCoupledThreatConfig,
} from './ScoreCoupledThreat';
export {
  WeaponPickup,
  type WeaponPickupConfig,
} from './WeaponPickup';
export {
  ShrinkingArena,
  type ShrinkingArenaConfig,
  type ArenaBounds,
} from './ShrinkingArena';
export {
  GhostEatChain,
  type GhostEatChainConfig,
} from './GhostEatChain';
export {
  ElroySpeedup,
  type ElroySpeedupConfig,
} from './ElroySpeedup';
export {
  BonusFruit,
  type BonusFruitConfig,
  type SpawnCell,
} from './BonusFruit';
export {
  WarpTunnel,
  type WarpTunnelConfig,
  type TunnelPair,
  type TunnelRegion,
} from './WarpTunnel';
export {
  RoomGateSystem,
  type RoomGateSystemConfig,
  type RoomRect,
  type RoomSpec,
} from './RoomGateSystem';
export {
  KeyDoorLock,
  type KeyDoorLockConfig,
} from './KeyDoorLock';
export {
  SwitchGate,
  type SwitchGateConfig,
  type SwitchBinding,
} from './SwitchGate';
export {
  PickupHeart,
  type PickupHeartConfig,
} from './PickupHeart';
export {
  LivesRespawn,
  type LivesRespawnConfig,
} from './LivesRespawn';
export {
  BossPhases,
  type BossPhasesConfig,
  type BossPhaseParam,
} from './BossPhases';
export {
  GhostHouseRelease,
  type GhostHouseReleaseConfig,
} from './GhostHouseRelease';
export {
  HazardField,
  type HazardFieldConfig,
  type HazardSpec,
} from './HazardField';
export {
  PortalLink,
  type PortalLinkConfig,
  type PortalPair,
  type PortalMouth,
} from './PortalLink';
