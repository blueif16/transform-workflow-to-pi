/**
 * Systems — composable scene-level kind=system logics (KEEP — engine).
 *
 * A SYSTEM is scene-level cross-entity orchestration: it reads/advances entities
 * across the level AND writes an observable (status/score). It implements ISceneSystem
 * (scenes/shooter-data.ts); DataShooterScene constructs it from a blueprint `systems[]`
 * binding ({ref,params}), then runs its lifecycle (reset -> attach -> setupCollisions
 * -> per-frame update). The design binds small logics BY ID and tunes them with PARAMS.
 *
 * The three base-genre systems compose the whole fixed-axis loop:
 *   - FormationMarch  : the descending, accelerating, edge-dropping rack + lose-on-land
 *   - ProjectilePool  : pooled upward bullets (no leak) + the fire seam
 *   - WaveLoop        : clear→next-wave / win-on-final-clear
 *
 * BARREL DISCIPLINE (mirrors top_down/src/systems/index.ts): export the system CLASSES
 * here; the runtime resolution map (SYSTEM_CLASSES / resolveSystem) lives in ./registry
 * and is imported DIRECTLY by DataShooterScene — NOT re-exported here. A system class
 * exported here with no CAPABILITY const FAILS the stranded-export gate.
 */

export {
  FormationMarch,
  type FormationMarchConfig,
} from './FormationMarch';
export {
  ProjectilePool,
  type ProjectilePoolConfig,
} from './ProjectilePool';
export {
  WaveLoop,
  type WaveLoopConfig,
} from './WaveLoop';
export {
  EntrySpline,
  type EntrySplineConfig,
} from './EntrySpline';
export {
  TrajectoryInterceptor,
  type TrajectoryInterceptorConfig,
  type BaseSpec,
} from './TrajectoryInterceptor';
export {
  SegmentSplit,
  type SegmentSplitConfig,
} from './SegmentSplit';
export {
  ScrollShmup,
  type ScrollShmupConfig,
} from './ScrollShmup';
export {
  DestructibleBunker,
  type DestructibleBunkerConfig,
  type BunkerSpec,
} from './DestructibleBunker';
export {
  PowerUpTier,
  type PowerUpTierConfig,
  type WeaponTierSpec,
} from './PowerUpTier';
export {
  BossPhase,
  type BossPhaseConfig,
} from './BossPhase';
export {
  SmartBomb,
  type SmartBombConfig,
} from './SmartBomb';
export {
  MushroomField,
  type MushroomCellSpec,
  type MushroomFieldConfig,
} from './MushroomField';
export {
  BulletHellEmitter,
  type BulletHellEmitterConfig,
  type CurtainPattern,
} from './BulletHellEmitter';
