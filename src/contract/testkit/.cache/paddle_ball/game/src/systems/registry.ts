/**
 * systems/registry.ts — the runtime id->factory resolution map for kind=system scene
 * logics (KEEP — engine seam; mirrors top_down's systems/registry.ts).
 *
 * The blueprint BINDS to system ids as DATA (blueprint.systems[] = {ref,params}); the
 * SDK RESOLVES each id -> a constructed ISceneSystem here, so the data-driven loader
 * (DataPaddleScene) instantiates a level's scene logics with NO per-game system code.
 * GENERIC: a logic is added in ONE place (its file + one line below). An unknown ref
 * returns undefined (the loader skips it cleanly).
 */
import type { ISceneSystem } from '../scenes/paddle-data';
import { BrickGrid } from './BrickGrid';
import { PaddleDuelAI } from './PaddleDuelAI';
import { MultiBall } from './MultiBall';
import { PaddleGrow } from './PaddleGrow';
import { BrickTypes } from './BrickTypes';
import { PowerUpDrop } from './PowerUpDrop';
import { BallSpeedRamp } from './BallSpeedRamp';
import { ScoreCombo } from './ScoreCombo';
import { PinballBumpers } from './PinballBumpers';

/** A system factory constructed from a single `params` object (the {ref,params} shape). */
export type SystemFactory = (params?: Record<string, any>) => ISceneSystem;

/** id -> system factory, for `levelData.systems[] = {ref, params}`. */
export const SYSTEM_CLASSES: Record<string, SystemFactory> = {
  BrickGrid: (params) => new BrickGrid(params ?? {}),
  PaddleDuelAI: (params) => new PaddleDuelAI(params ?? {}),
  MultiBall: (params) => new MultiBall(params ?? {}),
  PaddleGrow: (params) => new PaddleGrow(params ?? {}),
  BrickTypes: (params) => new BrickTypes(params ?? {}),
  PowerUpDrop: (params) => new PowerUpDrop(params ?? {}),
  BallSpeedRamp: (params) => new BallSpeedRamp(params ?? {}),
  ScoreCombo: (params) => new ScoreCombo(params ?? {}),
  PinballBumpers: (params) => new PinballBumpers(params ?? {}),
};

/** Resolve a system id -> a constructed ISceneSystem; undefined when unknown. */
export function resolveSystem(id: string, params?: Record<string, any>): ISceneSystem | undefined {
  const factory = SYSTEM_CLASSES[id];
  return factory ? factory(params) : undefined;
}
