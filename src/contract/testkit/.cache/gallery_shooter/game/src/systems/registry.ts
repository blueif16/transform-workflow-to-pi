/**
 * systems/registry.ts — the runtime id->factory resolution map for kind=system scene
 * logics (KEEP — engine seam; mirrors top_down's systems/registry.ts).
 *
 * The blueprint BINDS to system ids as DATA (blueprint.systems[] = {ref,params}); the
 * SDK RESOLVES each id -> a constructed ISceneSystem here, so the data-driven loader
 * (DataShooterScene) instantiates a level's scene logics with NO per-game system code.
 * GENERIC: a logic is added in ONE place (its file + one line below); every future
 * blueprint can then bind it by id. Nothing game-specific lives here.
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import { FormationMarch } from './FormationMarch';
import { ProjectilePool } from './ProjectilePool';
import { WaveLoop } from './WaveLoop';
import { EntrySpline } from './EntrySpline';
import { TrajectoryInterceptor } from './TrajectoryInterceptor';
import { SegmentSplit } from './SegmentSplit';
import { ScrollShmup } from './ScrollShmup';
import { DestructibleBunker } from './DestructibleBunker';
import { PowerUpTier } from './PowerUpTier';
import { BossPhase } from './BossPhase';
import { SmartBomb } from './SmartBomb';
import { MushroomField } from './MushroomField';
import { BulletHellEmitter } from './BulletHellEmitter';

/** A system factory constructed from a single `params` object (the {ref,params} shape). */
export type SystemFactory = (params?: Record<string, any>) => ISceneSystem;

/**
 * id -> system factory, for `levelData.systems[] = {ref, params}`. The loader does
 * `SYSTEM_CLASSES[ref](params)` and runs the ISceneSystem lifecycle.
 */
export const SYSTEM_CLASSES: Record<string, SystemFactory> = {
  FormationMarch: (params) => new FormationMarch(params ?? {}),
  ProjectilePool: (params) => new ProjectilePool(params ?? {}),
  WaveLoop: (params) => new WaveLoop(params ?? {}),
  EntrySpline: (params) => new EntrySpline(params ?? {}),
  TrajectoryInterceptor: (params) => new TrajectoryInterceptor(params ?? {}),
  SegmentSplit: (params) => new SegmentSplit(params ?? {}),
  ScrollShmup: (params) => new ScrollShmup(params ?? {}),
  DestructibleBunker: (params) => new DestructibleBunker(params ?? {}),
  PowerUpTier: (params) => new PowerUpTier(params ?? {}),
  BossPhase: (params) => new BossPhase(params ?? {}),
  SmartBomb: (params) => new SmartBomb(params ?? {}),
  MushroomField: (params) => new MushroomField(params ?? {}),
  BulletHellEmitter: (params) => new BulletHellEmitter(params ?? {}),
};

/** Resolve a system id -> a constructed ISceneSystem; undefined when unknown. */
export function resolveSystem(id: string, params?: Record<string, any>): ISceneSystem | undefined {
  const factory = SYSTEM_CLASSES[id];
  return factory ? factory(params) : undefined;
}
