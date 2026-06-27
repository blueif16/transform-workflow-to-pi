/**
 * BoardShuffle — the deadlock-recovery system (kind=system; merge-slide genre).
 *
 * The "no-dead-end" safety valve for a merge-slide board: after each resolved move
 * it RE-DERIVES whether the board is deadlocked (no legal move remains) and, if so,
 * RECOMPOSES the board's existing tiles into a new arrangement that has at least one
 * legal move — so play can continue instead of ending. When recomposition is GENUINELY
 * impossible (the multiset of tile values admits no non-deadlocked layout — e.g. a
 * full board of all-distinct values), it applies a DECLARED score penalty so the move
 * still has a consequence. Either way it emits `board.shuffled`.
 *
 * It is a scene-level IGridSystem bound by id from blueprint.systems[] (like
 * MergeSlideGoal / MineReveal), tuned by PARAMS, re-deriving its outcome from the LIVE
 * board each move (scene.board) — re-implementing nothing the engine owns. It must run
 * BEFORE the win/lose owner in the bound systems[] order so it recomposes the board
 * before MergeSlideGoal would read the same board as game-over and call scene.lose():
 * a recomposed board is no longer isGameOver(), so the lose seam never fires.
 *
 * THE MECHANIC (real logic, re-derived from the live board):
 *   - DEADLOCK DETECTION: a board is deadlocked iff isGameOver(grid) — no empty cell
 *     AND no two orthogonally-adjacent cells are equal (the SAME predicate the engine
 *     uses, imported from MergeSlideResolver so the rule lives in ONE place).
 *   - RECOMPOSE: collect every non-zero tile value, deterministically shuffle them
 *     (seeded by the move count so a restart/replay is reproducible), and re-lay them
 *     into the board's cells. Search a bounded number of shuffles for an arrangement
 *     that is NOT deadlocked (hasLegalMove). Apply the first non-deadlocked one.
 *   - PENALTY FALLBACK: if no tried arrangement breaks the deadlock (the value
 *     multiset is intrinsically stuck), deduct the declared `penalty` from the score
 *     so the player still pays for the dead board, and leave the board as-is.
 *
 * THE SEAM: onMove (the post-move re-derive, mirrors MergeSlideGoal). recompose() is
 * also PUBLIC so a headless harness can drive a shuffle directly (the driveable seam).
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, never a fabricated game number):
 *   penalty   score points to deduct when the deadlock is unrecoverable (default 0 —
 *             no penalty; a blueprint sets a positive number to make a stuck board cost).
 *   maxTries  how many shuffles to attempt before falling back to the penalty
 *             (default 32 — a deterministic bound so update is never unbounded).
 *
 * GENERIC: no game/theme is encoded — a TYPE bound by id. The penalty is a declared
 * default a blueprint overrides via params, never a hard-coded per-game value.
 */
import { isGameOver } from '../board/MergeSlideResolver';
import type { Grid } from '../board/GridBoard';
import type { IGridSystem } from '../scenes/grid-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (globbed by registry/discover.mjs — mirrors MergeSlideGoal). */
export const CAPABILITY = {
  kind: 'system',
  id: 'BoardShuffle',
  intent:
    'Deadlock-recovery system: when no legal move remains (isGameOver), recompose the board by reshuffling its existing tiles into an arrangement that has a legal move so play continues; if the board is intrinsically stuck, deduct a declared score penalty. Emits board.shuffled at the recovery seam.',
  attachesTo: 'scene',
  params: ['penalty', 'maxTries'],
  roles: ['board'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** DECLARED defaults — never a per-game fabricated number. */
const DEFAULT_PENALTY = 0;
const DEFAULT_MAX_TRIES = 32;

export interface BoardShuffleConfig {
  /** Score points deducted when a deadlock cannot be broken by reshuffling (default 0). */
  penalty?: number;
  /** Max shuffle attempts before falling back to the penalty (default 32). */
  maxTries?: number;
}

export class BoardShuffle implements IGridSystem {
  private scene: any;
  private readonly penalty: number;
  private readonly maxTries: number;

  /** OWN observable: how many times the board has been recomposed this run. */
  public shuffleCount = 0;

  /** Per-run deterministic seed (advanced each shuffle so attempts differ; resettable). */
  private seed = 0;

  /** The shared event bus, resolved from the attached scene. Publish via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  constructor(params: BoardShuffleConfig = {}) {
    this.penalty =
      typeof params.penalty === 'number' && params.penalty >= 0
        ? Math.floor(params.penalty)
        : DEFAULT_PENALTY;
    this.maxTries =
      typeof params.maxTries === 'number' && params.maxTries > 0
        ? Math.floor(params.maxTries)
        : DEFAULT_MAX_TRIES;
  }

  /** Re-arm to a fresh-run state (the scene calls reset() before attach on a RESTART). */
  reset(): void {
    this.shuffleCount = 0;
    this.seed = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
  }

  /**
   * The core moment: after each resolved move, re-derive whether the board is
   * deadlocked and, if so, recover it (recompose or penalize) so play can continue.
   * Runs BEFORE the win/lose owner in the systems[] order, so a recomposed board is
   * never seen as game-over by MergeSlideGoal.
   */
  onMove(_info: { changed: boolean; scoreDelta: number; intent: string }): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    const grid: Grid | undefined = scene.board?.snapshot?.();
    if (!grid) return;
    // A legal move still exists -> nothing to do (the common case).
    if (!isGameOver(grid)) return;
    this.recompose();
  }

  // ── the recovery seam (PUBLIC — a headless harness can drive a shuffle) ───────

  /**
   * Recompose a deadlocked board: gather its non-zero tile values and search a bounded
   * number of seeded shuffles for a re-layout that is NOT deadlocked. Apply the first
   * such layout and emit `board.shuffled`. If none is found, deduct the declared
   * penalty (and still emit board.shuffled, with recovered:false, so the move has a
   * recorded consequence). No-op when the board is not actually deadlocked.
   */
  public recompose(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    const board = scene.board;
    const grid: Grid | undefined = board?.snapshot?.();
    if (!grid) return;
    if (!isGameOver(grid)) return; // only recompose a genuinely stuck board

    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;
    if (rows === 0 || cols === 0) return;

    // The multiset of tile values to re-lay (a deadlocked board is full, so this is
    // every cell; gathered defensively so a partial board also recomposes correctly).
    const values: number[] = [];
    for (const row of grid) for (const v of row) if (v !== 0) values.push(v);

    // Search bounded seeded shuffles for an arrangement with a legal move.
    for (let attempt = 0; attempt < this.maxTries; attempt += 1) {
      const layout = this.layoutFrom(this.shuffled(values), rows, cols);
      if (this.hasLegalMove(layout)) {
        board.setGrid(layout);
        this.shuffleCount += 1;
        // Re-paint + re-derive the cursor through the engine's normal path.
        scene.paintTiles?.();
        scene.refreshCursor?.();
        this.bus?.emit('board.shuffled', {
          shuffleCount: this.shuffleCount,
          recovered: true,
          penalty: 0,
        });
        return;
      }
    }

    // Intrinsically stuck: pay the declared penalty so the dead board has a cost.
    let applied = 0;
    if (this.penalty > 0 && scene.registry?.get && scene.registry?.set) {
      const score = (scene.registry.get('score') as number) ?? 0;
      const next = Math.max(0, score - this.penalty);
      applied = score - next;
      scene.registry.set('score', next);
    }
    this.shuffleCount += 1;
    this.bus?.emit('board.shuffled', {
      shuffleCount: this.shuffleCount,
      recovered: false,
      penalty: applied,
    });
  }

  // ── pure helpers (re-derived from the grid; no engine duplication) ────────────

  /**
   * A legal move exists iff the board is NOT game-over (an empty cell or an adjacent
   * equal pair). Uses the engine's own predicate so the deadlock rule lives in ONE place.
   */
  private hasLegalMove(grid: Grid): boolean {
    return !isGameOver(grid);
  }

  /** Re-lay a flat value list into a rows x cols grid (row-major). */
  private layoutFrom(flat: number[], rows: number, cols: number): Grid {
    const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (let i = 0; i < flat.length && i < rows * cols; i += 1) {
      out[Math.floor(i / cols)][i % cols] = flat[i];
    }
    return out;
  }

  /**
   * A deterministic Fisher-Yates shuffle of a COPY of `values`, driven by a per-run
   * seed (advanced each call) so repeated attempts differ AND a replay from the same
   * reset() state is reproducible. Mulberry32 — a small, well-distributed PRNG.
   */
  private shuffled(values: number[]): number[] {
    const out = values.slice();
    this.seed = (this.seed + 0x9e3779b9) >>> 0;
    let s = this.seed >>> 0;
    const rand = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // ── component surface (the declared event + observable set) ────────────────────

  surface(): ComponentSurface {
    return {
      observables: {
        shuffleCount: () => this.shuffleCount,
      },
      anchors: [],
      events: [
        {
          name: 'board.shuffled',
          payload: '{shuffleCount,recovered,penalty}',
          scope: 'archetype',
          drivenBy: 'no legal move remains (the board is deadlocked) after a move',
          expect:
            '__GAME__ the board is recomposed into a layout with a legal move (or the declared penalty is applied); board.shuffled logged',
        },
      ],
    };
  }
}
