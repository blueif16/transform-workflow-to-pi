/**
 * systems/registry.ts — the runtime id->factory resolution map for kind=system
 * scene logics (KEEP — engine seam; mirrors top_down's systems/registry.ts).
 *
 * The blueprint BINDS to system ids as DATA (blueprint.systems[] = {ref,params});
 * the SDK RESOLVES each id -> a constructed IGridSystem here, so DataGridScene
 * instantiates a level's scene logics with NO per-game system code. GENERIC: a logic
 * is added in ONE place (its file + one line below); every future blueprint can then
 * bind it by id. Nothing game-specific lives here.
 *
 * SCOPE: the merge-slide base genre registers MergeSlideGoal (win/lose). Future genre
 * systems add ONE line each here when built. An unknown ref returns undefined (the
 * scene skips it cleanly).
 */
import type { IGridSystem } from '../scenes/grid-data';
import { MergeSlideGoal } from './MergeSlideGoal';
import { MineReveal } from './MineReveal';
import { TurnDuel } from './TurnDuel';
import { ComboMultiplier } from './ComboMultiplier';
import { SpecialTileFactory } from './SpecialTileFactory';
import { UndoMove } from './UndoMove';
import { BoardShuffle } from './BoardShuffle';

/** A system factory constructed from a single `params` object (the {ref,params} shape). */
export type SystemFactory = (params?: Record<string, any>) => IGridSystem;

/**
 * id -> system factory, for `levelData.systems[] = {ref, params}`. The scene does
 * `SYSTEM_CLASSES[ref](params)` and runs the IGridSystem lifecycle.
 */
export const SYSTEM_CLASSES: Record<string, SystemFactory> = {
  MergeSlideGoal: (params) => new MergeSlideGoal(params ?? {}),
  MineReveal: (params) => new MineReveal(params ?? {}),
  TurnDuel: (params) => new TurnDuel(params ?? {}),
  ComboMultiplier: (params) => new ComboMultiplier(params ?? {}),
  SpecialTileFactory: (params) => new SpecialTileFactory(params ?? {}),
  UndoMove: (params) => new UndoMove(params ?? {}),
  BoardShuffle: (params) => new BoardShuffle(params ?? {}),
};

/** Resolve a system id -> a constructed IGridSystem; undefined when unknown. */
export function resolveSystem(id: string, params?: Record<string, any>): IGridSystem | undefined {
  const factory = SYSTEM_CLASSES[id];
  return factory ? factory(params) : undefined;
}
