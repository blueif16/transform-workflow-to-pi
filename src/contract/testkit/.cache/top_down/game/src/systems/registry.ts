/**
 * systems/registry.ts — the runtime id->factory resolution map for kind=system
 * scene logics (KEEP — engine seam; mirrors platformer's systems/registry.ts).
 *
 * The blueprint BINDS to system ids as DATA (blueprint.systems[] = {ref,params});
 * the SDK RESOLVES each id -> a constructed ISceneSystem here, so the data-driven
 * loader (DataTopDownScene) instantiates a level's scene logics with NO per-game
 * system code. GENERIC: a logic is added in ONE place (its file + one line below);
 * every future blueprint can then bind it by id. Nothing game-specific lives here.
 *
 * SCOPE NOTE (M2): the first genre systems are registered — KillAllGoal +
 * WaveSpawner (the twin-stick arena). CollectGoal (M2 fast-follow) and
 * GhostModeController (M5) add ONE line each here when built. An unknown ref still
 * returns undefined (the loader skips it cleanly).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { KillAllGoal } from './KillAllGoal';
import { WaveSpawner } from './WaveSpawner';
import { CollectGoal } from './CollectGoal';
import { GhostModeController } from './GhostModeController';
import { ScreenWrapSystem } from './ScreenWrapSystem';
import { BombPlacement } from './BombPlacement';
import { DestructibleGrid } from './DestructibleGrid';
import { LaneScrollSystem } from './LaneScrollSystem';
import { CarrierRideSystem } from './CarrierRideSystem';
import { ComboMultiplier } from './ComboMultiplier';
import { ScoreCoupledThreat } from './ScoreCoupledThreat';
import { WeaponPickup } from './WeaponPickup';
import { ShrinkingArena } from './ShrinkingArena';
import { GhostEatChain } from './GhostEatChain';
import { ElroySpeedup } from './ElroySpeedup';
import { BonusFruit } from './BonusFruit';
import { WarpTunnel } from './WarpTunnel';
import { RoomGateSystem } from './RoomGateSystem';
import { KeyDoorLock } from './KeyDoorLock';
import { SwitchGate } from './SwitchGate';
import { PickupHeart } from './PickupHeart';
import { LivesRespawn } from './LivesRespawn';
import { BossPhases } from './BossPhases';
import { GhostHouseRelease } from './GhostHouseRelease';
import { HazardField } from './HazardField';
import { PortalLink } from './PortalLink';

/** A system factory constructed from a single `params` object (the {ref,params} shape). */
export type SystemFactory = (params?: Record<string, any>) => ISceneSystem;

/**
 * id -> system factory, for `levelData.systems[] = {ref, params}`. The loader does
 * `SYSTEM_CLASSES[ref](params)` and runs the ISceneSystem lifecycle. Genre systems
 * register here as they land (M2: KillAllGoal + WaveSpawner).
 */
export const SYSTEM_CLASSES: Record<string, SystemFactory> = {
  KillAllGoal: (params) => new KillAllGoal(params ?? {}),
  WaveSpawner: (params) => new WaveSpawner(params ?? {}),
  CollectGoal: (params) => new CollectGoal(params ?? {}),
  GhostModeController: (params) => new GhostModeController(params ?? {}),
  ScreenWrapSystem: (params) => new ScreenWrapSystem(params ?? {}),
  BombPlacement: (params) => new BombPlacement(params ?? {}),
  DestructibleGrid: (params) => new DestructibleGrid(params ?? {}),
  LaneScrollSystem: (params) => new LaneScrollSystem(params ?? {}),
  CarrierRideSystem: (params) => new CarrierRideSystem(params ?? {}),
  ComboMultiplier: (params) => new ComboMultiplier(params ?? {}),
  ScoreCoupledThreat: (params) => new ScoreCoupledThreat(params ?? {}),
  WeaponPickup: (params) => new WeaponPickup(params ?? {}),
  ShrinkingArena: (params) => new ShrinkingArena(params ?? {}),
  GhostEatChain: (params) => new GhostEatChain(params ?? {}),
  ElroySpeedup: (params) => new ElroySpeedup(params ?? {}),
  BonusFruit: (params) => new BonusFruit(params ?? {}),
  WarpTunnel: (params) => new WarpTunnel(params ?? {}),
  RoomGateSystem: (params) => new RoomGateSystem(params ?? {}),
  KeyDoorLock: (params) => new KeyDoorLock(params ?? {}),
  SwitchGate: (params) => new SwitchGate(params ?? {}),
  PickupHeart: (params) => new PickupHeart(params ?? {}),
  LivesRespawn: (params) => new LivesRespawn(params ?? {}),
  BossPhases: (params) => new BossPhases(params ?? {}),
  GhostHouseRelease: (params) => new GhostHouseRelease(params ?? {}),
  HazardField: (params) => new HazardField(params ?? {}),
  PortalLink: (params) => new PortalLink(params ?? {}),
};

/** Resolve a system id -> a constructed ISceneSystem; undefined when unknown. */
export function resolveSystem(id: string, params?: Record<string, any>): ISceneSystem | undefined {
  const factory = SYSTEM_CLASSES[id];
  return factory ? factory(params) : undefined;
}
