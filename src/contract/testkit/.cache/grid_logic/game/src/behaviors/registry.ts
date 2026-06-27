/**
 * behaviors/registry.ts — the runtime id->class resolution map for grid board-rule
 * behaviors (KEEP — engine seam; mirrors top_down's behaviors/registry.ts).
 *
 * The blueprint BINDS to a behavior id as DATA ({ref,params}); the SDK RESOLVES the
 * id -> its class here, so the board's move RULE is selected from data with no
 * per-game move code. GENERIC: a behavior is added in ONE place (its file + one line
 * below); every future grid blueprint can then bind it by id.
 *
 * SCOPE: the merge-slide base genre registers MergeSlide. Future genre rules
 * (SwapMatch, GravityDrop, BoxPush, …) add one line each here when built.
 */
import { MergeSlide } from './MergeSlide';
import { SwapMatch } from './SwapMatch';
import { GravityDrop } from './GravityDrop';
import { BoxPush } from './BoxPush';
import { ChainClear } from './ChainClear';
import { HoldGhostPiece } from './HoldGhostPiece';
import { ChordReveal } from './ChordReveal';
import { ConnectGravityDrop } from './ConnectGravityDrop';
import { ChainBomb } from './ChainBomb';
import type { IGridBehavior } from './IGridBehavior';

/** A behavior class constructed from a single `params` object (the {ref,params} shape). */
export type GridBehaviorClass = new (params: any) => IGridBehavior;

/**
 * id -> behavior class, for the board's bound move rule. The scene does
 * `new BEHAVIOR_CLASSES[ref](params)` and routes each move intent through resolve().
 */
export const BEHAVIOR_CLASSES: Record<string, GridBehaviorClass> = {
  MergeSlide: MergeSlide as unknown as GridBehaviorClass,
  SwapMatch: SwapMatch as unknown as GridBehaviorClass,
  GravityDrop: GravityDrop as unknown as GridBehaviorClass,
  BoxPush: BoxPush as unknown as GridBehaviorClass,
  ChainClear: ChainClear as unknown as GridBehaviorClass,
  HoldGhostPiece: HoldGhostPiece as unknown as GridBehaviorClass,
  ChordReveal: ChordReveal as unknown as GridBehaviorClass,
  ConnectGravityDrop: ConnectGravityDrop as unknown as GridBehaviorClass,
  ChainBomb: ChainBomb as unknown as GridBehaviorClass,
};

/** Resolve a behavior id -> class; undefined when unknown (the scene reports it). */
export function resolveBehavior(id: string): GridBehaviorClass | undefined {
  return BEHAVIOR_CLASSES[id];
}
