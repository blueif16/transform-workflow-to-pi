/**
 * MergeSlide — the merge-slide (2048) board move RULE behavior (KEEP — engine).
 *
 * The bindable wrapper around the pure move resolver (board/MergeSlideResolver):
 * the blueprint binds `MergeSlide` as the board's behavior, the scene resolves it
 * by id and routes every move intent through resolve(). It re-implements NOTHING —
 * it delegates to resolveMove (the one place the compress->merge->compress + merge-
 * once rules live, INV-1/INV-2) — and exists so the move RULE is a swappable,
 * cataloged capability the design binds by id, exactly like a top_down behavior.
 *
 * Params (all OPTIONAL, the DELTA the research brief §(b) names):
 *   none here — winTarget + spawn are owned by GridConfigData (the level data), read
 *   by the scene. MergeSlide is the pure rule; its only job is intent -> resolved grid.
 *
 * GENERIC: no board size / target / theme is encoded — those are level DATA.
 */
import type { Grid } from '../board/GridBoard';
import { resolveMove, type SlideDir } from '../board/MergeSlideResolver';
import type { IGridBehavior, GridMoveResult } from './IGridBehavior';

export interface MergeSlideConfig {
  /** reserved for future tuning (e.g. merge-style variants); none consumed today. */
  [k: string]: any;
}

const DIRS: ReadonlySet<string> = new Set(['left', 'right', 'up', 'down']);

export class MergeSlide implements IGridBehavior {
  constructor(_config: MergeSlideConfig = {}) {
    // No state — the rule is pure. Config reserved for future variants.
  }

  /**
   * Resolve one move. `intent` is a SlideDir ('left'|'right'|'up'|'down'); an
   * unknown intent is a no-op (changed:false) so a stray input never corrupts the
   * board. Delegates to the pure resolver — the single home of the merge rules.
   */
  resolve(grid: Grid, intent: string): GridMoveResult {
    if (!DIRS.has(intent)) {
      return { grid: grid.map((r) => r.slice()), changed: false, scoreDelta: 0 };
    }
    return resolveMove(grid, intent as SlideDir);
  }
}
