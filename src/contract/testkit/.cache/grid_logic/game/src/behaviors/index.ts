/**
 * Behaviors — composable board-RULE behaviors (KEEP — engine).
 *
 * A behavior is the per-genre MOVE RULE the board routes every move intent through
 * (IGridBehavior). The blueprint binds one by id ({ref,params}); the scene resolves
 * it via ./registry and calls resolve() per move. The merge-slide base genre ships
 * MergeSlide (delegates to the pure resolver — INV-1/INV-2 live there). Future
 * genres add one rule each (a SwapMatch for match-3, a GravityDrop for falling-block).
 *
 * BARREL DISCIPLINE (mirrors top_down/src/behaviors/index.ts): export the behavior
 * CLASSES here; the runtime id->class resolution map (BEHAVIOR_CLASSES /
 * resolveBehavior) lives in ./registry and is imported DIRECTLY by the scene — NOT
 * re-exported here. The discovery harness stranded-export-gates this barrel: a
 * behavior class exported here with no capability taxonomy entry fails registry:check.
 */
export {
  type IGridBehavior,
  type GridMoveResult,
} from './IGridBehavior';
export { MergeSlide, type MergeSlideConfig } from './MergeSlide';
export { SwapMatch, type SwapMatchConfig } from './SwapMatch';
export { GravityDrop, type GravityDropConfig } from './GravityDrop';
export { BoxPush, type BoxPushConfig } from './BoxPush';
export { ChainClear, type ChainClearConfig } from './ChainClear';
export { HoldGhostPiece, type HoldGhostPieceConfig } from './HoldGhostPiece';
export { ChordReveal, type ChordRevealConfig } from './ChordReveal';
export { ConnectGravityDrop, type ConnectGravityDropConfig } from './ConnectGravityDrop';
export { ChainBomb, type ChainBombConfig } from './ChainBomb';
