/**
 * ============================================================================
 * SwapMatch — the match-3 (swap → cascade) board move RULE behavior (BUILD)
 * ============================================================================
 *
 * The bindable move RULE for the `match-3-swap` genre, the grid analogue of
 * MergeSlide: the blueprint binds `SwapMatch` as the board's behavior, the scene
 * resolves it by id and routes every move INTENT through resolve(). Where the
 * merge-slide rule slides+merges a whole row, the match-3 rule SWAPS two adjacent
 * cells and then runs a PROCESSING-GATED CASCADE:
 *
 *   swap the two adjacent cells
 *     -> detect every run of 3+ same-id gems (rows + columns)
 *     -> IF none formed: UNDO the swap (an illegal swap is a no-op, changed:false)
 *     -> ELSE batch-clear the matched cells (set them empty), score them
 *     -> apply GRAVITY (gems above an empty cell fall down to fill it)
 *     -> REFILL the emptied top cells with new gems
 *     -> RE-CHECK for new runs the refill created, and repeat until the board is
 *        STABLE (no run of 3+ remains). Each pass after the first is a cascade step.
 *
 * The rule is PURE over the grid (IGridBehavior.resolve never mutates the input,
 * mirrors MergeSlide): it reads the current grid, computes the fully-settled grid +
 * the total scoreDelta, and the scene swaps it in. The board stores gem IDs (small
 * positive integers, 0 = empty) exactly as GridBoard documents ("match-3 stores gem
 * ids"); the cascade interprets equality of those ids as a match.
 *
 * EVENTS (the PUSH channel). resolve() is pure, but the rule may be constructed with
 * an OPTIONAL `eventBus` (the shared `EventBus` from the scene); when present it
 * EMITS the three player-facing match-3 moments at their true gameplay seam:
 *   - gems.swapped     — the two adjacent cells were exchanged (the input landed)
 *   - match.cleared    — a run of 3+ was batch-cleared (score increased)
 *   - cascade.resolved — the board re-settled after N processing passes
 * The cascade math runs whether or not a bus is wired (the events are the observable
 * TRACE of the real mechanic, never the mechanic itself). The Integrate step wires
 * the scene to pass `{ eventBus }` into the bound rule's params so the emits fire.
 *
 * INTENT FORMAT. A swap intent is the string "swap:r1,c1,r2,c2" — the two CELL
 * coordinates to exchange (0-based row,col). The match-3 control scheme produces it
 * from a two-cell select; a harness drives it directly. Any unparsable / non-adjacent
 * intent is a safe no-op (changed:false) so a stray input never corrupts the board.
 *
 * PARAMS (all OPTIONAL, declared in CAPABILITY.params — sensible DEFAULTS, no game/
 * theme encoded): `gemTypes` (how many distinct gem ids the refill draws from; the
 * board's seeded gems define the palette, this only bounds the refill), `clearScore`
 * (points per cleared gem), `eventBus` (the shared bus — wired by Integrate), `seed`
 * (optional deterministic refill RNG for a headless harness).
 *
 * GENERIC: no board size / palette names / target is encoded — those are level DATA.
 */
import type { Grid } from '../board/GridBoard';
import type { IGridBehavior, GridMoveResult } from './IGridBehavior';
import { type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar — the self-describing taxonomy entry (mirrors the system files). */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'SwapMatch',
  intent:
    'The match-3 board move RULE: swap two adjacent gems, then run a processing-gated cascade — detect runs of 3+, batch-clear them, apply gravity, refill from the top, and re-check until the board is stable. Illegal swaps (no match formed) undo to a no-op. The bindable heart of the match-3-swap genre.',
  roles: ['board'],
  params: ['gemTypes', 'clearScore', 'eventBus', 'seed'],
  tuning: ['gemTypes', 'clearScore'],
} as const;

/** The minimal shared-bus shape this rule needs (avoids importing the concrete class for params). */
interface BusLike {
  emit(type: string, payload?: unknown): void;
}

export interface SwapMatchConfig {
  /** Distinct gem ids (1..gemTypes) the refill draws from. Default 5. */
  gemTypes?: number;
  /** Points awarded per cleared gem. Default 10. */
  clearScore?: number;
  /** The shared EventBus the rule emits its match-3 moments on (wired by Integrate). */
  eventBus?: BusLike;
  /** Optional seed for a deterministic refill RNG (a headless harness sets it). */
  seed?: number;
  [k: string]: any;
}

/** Default knobs — DECLARED here, never fabricated config the design didn't ask for. */
const DEFAULT_GEM_TYPES = 5;
const DEFAULT_CLEAR_SCORE = 10;
/** A run must be this long to clear (the genre's defining constant). */
const MIN_RUN = 3;
/** A hard cap on cascade passes (a pathological board can never loop forever). */
const MAX_CASCADE_PASSES = 64;

const cloneGrid = (g: Grid): Grid => g.map((row) => row.slice());

export class SwapMatch implements IGridBehavior {
  private readonly gemTypes: number;
  private readonly clearScore: number;
  private readonly bus?: BusLike;
  private rng: () => number;

  constructor(config: SwapMatchConfig = {}) {
    this.gemTypes = Math.max(2, Math.floor(config.gemTypes ?? DEFAULT_GEM_TYPES));
    this.clearScore = Math.max(1, Math.floor(config.clearScore ?? DEFAULT_CLEAR_SCORE));
    this.bus = config.eventBus;
    // A seeded LCG so a harness gets deterministic refills; else Math.random.
    if (typeof config.seed === 'number') {
      let s = (config.seed >>> 0) || 1;
      this.rng = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
      };
    } else {
      this.rng = Math.random;
    }
  }

  /**
   * Resolve one match-3 move. `intent` is "swap:r1,c1,r2,c2". PURE — never mutates
   * `grid`. Swaps the two adjacent cells; if no run of 3+ forms, undoes the swap
   * (no-op). Otherwise clears matches, applies gravity, refills, and re-checks until
   * stable, summing the score. Emits gems.swapped / match.cleared / cascade.resolved
   * at their true seams when a bus is wired.
   */
  resolve(grid: Grid, intent: string): GridMoveResult {
    const noop = (): GridMoveResult => ({ grid: cloneGrid(grid), changed: false, scoreDelta: 0 });

    const swap = this.parseSwap(intent);
    if (!swap) return noop();
    const { r1, c1, r2, c2 } = swap;
    if (!this.inBounds(grid, r1, c1) || !this.inBounds(grid, r2, c2)) return noop();
    if (!this.isAdjacent(r1, c1, r2, c2)) return noop();
    if (grid[r1][c1] === 0 || grid[r2][c2] === 0) return noop(); // never swap into empties

    // Exchange the two adjacent gems on a working copy.
    const work = cloneGrid(grid);
    const tmp = work[r1][c1];
    work[r1][c1] = work[r2][c2];
    work[r2][c2] = tmp;

    // A swap is only legal if it CREATES at least one run of 3+ (the genre rule).
    const firstRuns = this.findMatches(work);
    if (firstRuns.length === 0) {
      // Illegal swap — undo, no board change, no events (a no-op move).
      return noop();
    }

    // The swap landed (it formed a match). Emit gems.swapped at the input seam.
    this.bus?.emit('gems.swapped', { r1, c1, r2, c2 });

    // ── the processing-gated cascade ─────────────────────────────────────────
    let scoreDelta = 0;
    let pass = 0;
    let cleared = 0;
    let runs = firstRuns;
    while (runs.length > 0 && pass < MAX_CASCADE_PASSES) {
      pass += 1;
      // Batch-clear every matched cell at once (the union of all runs this pass).
      const matched = this.matchedCells(runs);
      for (const key of matched) {
        const [r, c] = key.split(',').map((n) => parseInt(n, 10));
        work[r][c] = 0;
      }
      const clearedThisPass = matched.size;
      cleared += clearedThisPass;
      const gained = clearedThisPass * this.clearScore;
      scoreDelta += gained;
      // match.cleared at the real clear seam (score increased, cells emptied).
      this.bus?.emit('match.cleared', { count: clearedThisPass, gained, pass });

      // Apply gravity (gems fall into the gaps) then refill the emptied top cells.
      this.applyGravity(work);
      this.refill(work);

      // Re-check — a refill (or the fall) can create NEW runs (the next cascade step).
      runs = this.findMatches(work);
    }

    // cascade.resolved once the board is stable (no run remains).
    this.bus?.emit('cascade.resolved', { passes: pass, cleared, scoreDelta });

    return { grid: work, changed: true, scoreDelta };
  }

  // ── intent parsing + geometry ──────────────────────────────────────────────

  /** Parse "swap:r1,c1,r2,c2" -> the four indices, or null when unparsable. */
  private parseSwap(intent: string): { r1: number; c1: number; r2: number; c2: number } | null {
    if (typeof intent !== 'string') return null;
    const m = intent.match(/^swap:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/);
    if (!m) return null;
    return { r1: +m[1], c1: +m[2], r2: +m[3], c2: +m[4] };
  }

  private inBounds(grid: Grid, r: number, c: number): boolean {
    return r >= 0 && r < grid.length && c >= 0 && c < (grid[r]?.length ?? 0);
  }

  /** True iff the two cells are orthogonally adjacent (a legal swap pair). */
  private isAdjacent(r1: number, c1: number, r2: number, c2: number): boolean {
    return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
  }

  // ── match detection (runs of 3+ in rows + columns) ──────────────────────────

  /**
   * Every run of MIN_RUN+ same-id gems, scanned horizontally then vertically.
   * Each run is a list of "r,c" cell keys. Empty cells (0) never match.
   */
  private findMatches(grid: Grid): string[][] {
    const runs: string[][] = [];
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;

    // Horizontal runs.
    for (let r = 0; r < rows; r += 1) {
      let runStart = 0;
      for (let c = 1; c <= cols; c += 1) {
        const same = c < cols && grid[r][c] !== 0 && grid[r][c] === grid[r][runStart];
        if (!same) {
          const len = c - runStart;
          if (grid[r][runStart] !== 0 && len >= MIN_RUN) {
            const cells: string[] = [];
            for (let k = runStart; k < c; k += 1) cells.push(`${r},${k}`);
            runs.push(cells);
          }
          runStart = c;
        }
      }
    }

    // Vertical runs.
    for (let c = 0; c < cols; c += 1) {
      let runStart = 0;
      for (let r = 1; r <= rows; r += 1) {
        const same = r < rows && grid[r][c] !== 0 && grid[r][c] === grid[runStart][c];
        if (!same) {
          const len = r - runStart;
          if (grid[runStart][c] !== 0 && len >= MIN_RUN) {
            const cells: string[] = [];
            for (let k = runStart; k < r; k += 1) cells.push(`${k},${c}`);
            runs.push(cells);
          }
          runStart = r;
        }
      }
    }
    return runs;
  }

  /** The de-duplicated union of every matched cell key across the runs this pass. */
  private matchedCells(runs: string[][]): Set<string> {
    const set = new Set<string>();
    for (const run of runs) for (const key of run) set.add(key);
    return set;
  }

  // ── gravity + refill ────────────────────────────────────────────────────────

  /** Gems above an empty cell fall straight down to fill it (per column, in place). */
  private applyGravity(grid: Grid): void {
    const rows = grid.length;
    const cols = grid[0]?.length ?? 0;
    for (let c = 0; c < cols; c += 1) {
      let write = rows - 1; // the lowest empty slot to drop the next gem into
      for (let r = rows - 1; r >= 0; r -= 1) {
        if (grid[r][c] !== 0) {
          grid[write][c] = grid[r][c];
          if (write !== r) grid[r][c] = 0;
          write -= 1;
        }
      }
      // Everything above `write` is now empty (the refill fills these).
      for (let r = write; r >= 0; r -= 1) grid[r][c] = 0;
    }
  }

  /** Fill every empty cell (the gaps gravity left at the top) with a fresh gem id. */
  private refill(grid: Grid): void {
    for (let r = 0; r < grid.length; r += 1) {
      for (let c = 0; c < grid[r].length; c += 1) {
        if (grid[r][c] === 0) {
          grid[r][c] = 1 + Math.floor(this.rng() * this.gemTypes);
        }
      }
    }
  }

  // ── component surface (the declared PUSH-channel events this rule publishes) ──

  /**
   * The match-3 rule's event surface. Each EventDecl is a TRUE statement about a real
   * .emit() site in resolve() (guarded by an optional shared bus the Integrate step
   * wires): gems.swapped at the swap seam, match.cleared at each batch-clear seam,
   * cascade.resolved once the board re-settles.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'gems.swapped',
          payload: '{r1,c1,r2,c2}',
          scope: 'archetype',
          drivenBy: 'swap two adjacent gems',
          expect: '__GAME__ board shows the two cells exchanged; gems.swapped logged',
        },
        {
          name: 'match.cleared',
          payload: '{count,gained,pass}',
          scope: 'archetype',
          drivenBy: 'a run of 3+ forms',
          expect: '__GAME__.score increases + matched cells empty; match.cleared logged',
        },
        {
          name: 'cascade.resolved',
          payload: '{passes,cleared,scoreDelta}',
          scope: 'archetype',
          drivenBy: 'refill creates a new match',
          expect: '__GAME__ cascade settles after N steps; cascade.resolved logged',
        },
      ],
    };
  }
}
