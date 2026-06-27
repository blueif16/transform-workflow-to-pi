/**
 * IGridBehavior — the board-RULE behavior interface (KEEP — engine seam).
 *
 * A grid behavior is the per-genre MOVE RULE: given the logical grid + a move
 * intent, it produces the resolved grid + whether it changed + the score gained.
 * It is the bindable, swappable heart of the archetype — merge-slide binds
 * MergeSlide; a future match-3 genre binds a SwapMatch behavior; falling-block
 * binds a GravityDrop behavior. The scene resolves the bound behavior by id and
 * routes every move through it, so the SAME scene serves every genre purely by
 * which rule is bound (no per-game move code).
 *
 * This is the grid analogue of top_down's IBehavior (an entity-composed component);
 * here the "owner" is the BOARD and the verb is "resolve a move," not "tick a
 * sprite." GENERIC: a behavior names a rule, never a game.
 */
import type { Grid } from '../board/GridBoard';

/** The result of one resolved move (a NEW grid; the input is never mutated). */
export interface GridMoveResult {
  grid: Grid;
  changed: boolean;
  scoreDelta: number;
}

export interface IGridBehavior {
  /** Resolve one move over `grid` in `intent`; PURE (never mutate `grid`). */
  resolve(grid: Grid, intent: string): GridMoveResult;
}
