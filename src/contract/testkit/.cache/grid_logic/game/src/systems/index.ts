/**
 * Systems — composable scene-level kind=system logics (KEEP — engine).
 *
 * A SYSTEM is scene-level orchestration over the board: it reacts to a resolved
 * move (onMove) and writes an observable (status). It implements IGridSystem
 * (scenes/grid-data.ts); DataGridScene constructs it from a blueprint `systems[]`
 * binding ({ref,params}) and runs its lifecycle (reset -> attach -> per-move
 * onMove). This is the registered, composable home for cross-board logic the design
 * binds BY ID and tunes with PARAMS.
 *
 * SCOPE: the merge-slide base genre ships MergeSlideGoal (the win/lose owner —
 * INV-4/INV-5). Future genre systems (a match-3 CascadeResolver, a Tetris
 * LineClearGoal) export here + register in ./registry with ONE line each.
 *
 * BARREL DISCIPLINE (mirrors top_down/src/systems/index.ts): export the system
 * CLASSES here; the runtime resolution map (SYSTEM_CLASSES / resolveSystem) lives in
 * ./registry and is imported DIRECTLY by the scene — NOT re-exported here.
 */
export { MergeSlideGoal, type MergeSlideGoalConfig } from './MergeSlideGoal';
export { MineReveal, type MineRevealConfig } from './MineReveal';
export { TurnDuel, type TurnDuelConfig } from './TurnDuel';
export { ComboMultiplier, type ComboMultiplierConfig } from './ComboMultiplier';
export { SpecialTileFactory, type SpecialTileFactoryConfig } from './SpecialTileFactory';
export { UndoMove, type UndoMoveConfig } from './UndoMove';
export { BoardShuffle, type BoardShuffleConfig } from './BoardShuffle';
