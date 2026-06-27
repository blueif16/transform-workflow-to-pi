/**
 * Scenes — Game scene classes for the gallery_shooter archetype (data-driven).
 *
 * Architecture (the data-driven spine the other 2D modules prove):
 *
 *   BaseGameScene        ← the shared engine base: groups (the formation in `enemies`,
 *                          bunkers in `obstacles`, pooled bullets in `playerBullets`),
 *                          scene-owned input (←/→/A/D + Space), the shared EventBus, the
 *                          markReady() + win/lose registry seam, the 5 abstract build
 *                          methods.
 *     └── DataShooterScene ← THE data-driven loader: reads a ShooterLevelData and
 *                            instantiates the WHOLE level from DATA (the formation grid,
 *                            the axis-constrained cannon, the bunkers), runs systems[]
 *                            (FormationMarch + ProjectilePool + WaveLoop), drives the
 *                            resolved control scheme's move+fire, resolves "$custom:<id>".
 *                            ZERO per-game placement code.
 *
 * The in-game HUD (UIScene) and all menu/end-screen scenes are provided by
 * `templates/core/` — this module does NOT ship its own UIScene.
 */

export { BaseGameScene } from './BaseGameScene';

// Data-driven level loader (the core) + its data/system contracts.
export { DataShooterScene } from './DataShooterScene';
export type {
  ShooterLevelData,
  FormationData,
  FormationRowTemplate,
  BunkerData,
  EffectBinding,
  SystemBinding,
  BehaviorBinding,
  ISceneSystem,
} from './shooter-data';
export { LEVEL_ORDER } from './shooter-data';
export {
  registerCustomBehavior,
  registerCustomSystem,
  resolveCustomBehavior,
  resolveCustomSystem,
  type CustomBehaviorFactory,
  type CustomSystemFactory,
} from './custom-registry';
