/**
 * ChordReveal — the deduction-grid CHORD (both-button) reveal behavior (BUILD —
 * engine seam; the Minesweeper-family "chord" convenience that makes a beginner
 * field fast to clear). kind=behavior, the deduction-grid sibling of MineReveal.
 *
 * THE MECHANIC (the headline move, the real Minesweeper chord):
 *   A CHORD acts on an ALREADY-REVEALED numbered cell. When that number's count of
 *   FLAGGED adjacent cells EQUALS its adjacent-mine number (the number is
 *   "satisfied"), the chord reveals EVERY adjacent UNFLAGGED, still-hidden cell at
 *   once — the fast-clear the player earns by having flagged the right cells. The
 *   classic both-mouse-button (or double-click) input. Chording an unsatisfied
 *   number, an unrevealed cell, or a blank is a NO-OP — the player must commit
 *   their flags first.
 *
 * WHY A SELF-CONTAINED BEHAVIOR (the design, re-derived from the module's grain):
 *   The chord is a SECOND verb over the SAME deduction overlay MineReveal owns —
 *   but a grid_logic behavior is a self-describing, independently-bound unit (the
 *   move-RULE tier), not a patch onto another system. So ChordReveal owns its OWN
 *   minimal deduction state (mine / adjacent-count / revealed / flagged grids),
 *   laid LAZILY first-click-safe on the first reveal exactly like MineReveal, and
 *   exposes THREE driveable seams — revealAt / toggleFlagAt / chordAt — so a level
 *   that binds ChordReveal gets a fully playable deduction board WITH the chord move
 *   from a single component. It reads NOTHING private of another component; the
 *   chord's correctness is re-derived from its OWN flag/number grids. (A level may
 *   ALSO bind MineReveal for the base reveal/flag economy; ChordReveal stands alone
 *   so the gate can drive its chord verb without a second component present.)
 *
 * THE SEAM: the player acts on a CELL. The scene's input layer routes a chord
 * gesture (both buttons / a modifier+click) to chordAt(row,col) — PUBLIC so a
 * headless harness drives a chord directly, exactly as MineReveal.revealAt is the
 * driveable reveal seam. resolve(grid, intent) is the IGridBehavior registry seam:
 * it parses a 'chord,row,col' (or 'reveal,r,c' / 'flag,r,c') intent and routes to
 * the matching public seam, then returns a NO-OP GridMoveResult — the deduction
 * overlay is NOT the merge-slide tile grid, so the merge board never changes (the
 * scene spawns nothing, the move counter does not tick).
 *
 * Observables (its OWN real counters, published on the pull channel):
 *   __GAME__.revealedCount — safe cells revealed so far (INCREASES on reveal/chord);
 *   __GAME__.flagCount     — flags currently placed (TOGGLES on flag/unflag).
 *   (A behavior's observables are advisory — the legacy 2D hook getters drive the
 *   canonical __GAME__ shape — but a CHORD's observable proof is the revealedCount
 *   JUMP it produces, the stub-killer the responsiveness gate can witness.)
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, never a fabricated game number):
 *   mineCount  number of mines to lay (default 10, the classic beginner field).
 *   rows/cols  field dimensions (default: the scene's live board geometry).
 *
 * GENERIC: no game/theme is encoded — a TYPE bound by id. The mine count is a
 * declared default a blueprint overrides via params, never a hard-coded per-game value.
 */
import type { Grid } from '../board/GridBoard';
import type { IGridBehavior, GridMoveResult } from './IGridBehavior';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (self-describing; the registry behavior-taxonomy entry mirrors it). */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'ChordReveal',
  intent:
    'The deduction-grid CHORD (both-button) reveal: chording an already-revealed number whose flagged-neighbour count EQUALS its adjacent-mine count reveals every adjacent unflagged hidden cell at once (the Minesweeper fast-clear). Self-contained — owns its own first-click-safe mine/number/reveal/flag overlay and exposes reveal/flag/chord seams; chording an unsatisfied number is a no-op.',
  roles: ['board'],
  params: ['mineCount', 'rows', 'cols'],
} as const;

/** Default field knobs (DECLARED defaults — the classic beginner field, never per-game). */
const DEFAULT_MINE_COUNT = 10;

export interface ChordRevealConfig {
  /** Number of mines to lay (default 10). */
  mineCount?: number;
  /** Field rows (default: the scene board's row count). */
  rows?: number;
  /** Field cols (default: the scene board's col count). */
  cols?: number;
}

/** A minimal view of the owning scene this behavior reaches (bus + board geometry). */
interface SceneOwner {
  eventBus?: { emit(type: string, payload?: unknown): void };
  board?: { rows?: number; cols?: number };
  gameCompleted?: boolean;
  lose?: () => void;
}

export class ChordReveal implements IGridBehavior {
  /** The owning scene (set by attach) — the route to the shared EventBus + geometry. */
  private owner: SceneOwner | null = null;
  private readonly cfgMineCount: number;
  private readonly cfgRows?: number;
  private readonly cfgCols?: number;

  private rows = 0;
  private cols = 0;
  /** True once mines are laid (lazy, on the first reveal — first-click-safe). */
  private placed = false;
  /** mine[r][c] — a mine occupies this cell. */
  private mine: boolean[][] = [];
  /** adj[r][c] — count of adjacent mines (0..8), valid after placement. */
  private adj: number[][] = [];
  /** revealed[r][c] — this safe cell is open. */
  private revealed: boolean[][] = [];
  /** flagged[r][c] — this hidden cell is flagged (blocks reveal; feeds the chord count). */
  private flagged: boolean[][] = [];

  /** OWN observable counters (read by surface().observables thunks). */
  public revealedCount = 0;
  public flagCount = 0;

  constructor(config: ChordRevealConfig = {}) {
    this.cfgMineCount =
      typeof config.mineCount === 'number' && config.mineCount > 0
        ? Math.floor(config.mineCount)
        : DEFAULT_MINE_COUNT;
    this.cfgRows = typeof config.rows === 'number' ? Math.floor(config.rows) : undefined;
    this.cfgCols = typeof config.cols === 'number' ? Math.floor(config.cols) : undefined;
  }

  /**
   * Lifecycle the scene calls to hand this behavior the shared bus + board geometry
   * (the same owner seam ChainClear/BoxPush use). Allocates the deduction overlay
   * sized to the live board. Idempotent — safe to call after reset() on a RESTART.
   */
  attach(owner: SceneOwner): void {
    this.owner = owner;
    this.rows = this.cfgRows ?? owner.board?.rows ?? 0;
    this.cols = this.cfgCols ?? owner.board?.cols ?? 0;
    if (this.rows <= 0) this.rows = 4;
    if (this.cols <= 0) this.cols = 4;
    this.allocGrids();
  }

  /** Re-arm to a fresh-field state (a RESTART re-attaches; clears all run state). */
  reset(): void {
    this.placed = false;
    this.mine = [];
    this.adj = [];
    this.revealed = [];
    this.flagged = [];
    this.revealedCount = 0;
    this.flagCount = 0;
  }

  // ── the IGridBehavior registry seam ──────────────────────────────────────────

  /**
   * Resolve ONE deduction intent. `intent` is 'chord,row,col' (the headline move),
   * or 'reveal,row,col' / 'flag,row,col' for the base economy. It routes to the
   * matching public seam (which fires the real emit) and ALWAYS returns a NO-OP
   * GridMoveResult: the merge-slide tile grid is NOT the deduction overlay, so the
   * scene's merge board, score, and move counter are untouched — the deduction work
   * happens entirely on this behavior's own overlay.
   */
  resolve(grid: Grid, intent: string): GridMoveResult {
    const noop: GridMoveResult = { grid: grid.map((r) => r.slice()), changed: false, scoreDelta: 0 };
    const cmd = parseIntent(intent);
    if (!cmd) return noop;
    if (cmd.verb === 'chord') this.chordAt(cmd.row, cmd.col);
    else if (cmd.verb === 'reveal') this.revealAt(cmd.row, cmd.col);
    else if (cmd.verb === 'flag') this.toggleFlagAt(cmd.row, cmd.col);
    return noop;
  }

  // ── the player seams (PUBLIC — a headless harness drives these directly) ──────

  /**
   * CHORD a cell (the headline move). A chord acts only on an already-REVEALED
   * numbered cell whose flagged-neighbour count EQUALS its adjacent-mine number
   * (the number is satisfied). When satisfied, EVERY adjacent unflagged hidden cell
   * is revealed at once (flood-filling through any 0-count cells opened). Chording
   * an unrevealed cell, a 0-cell, or an unsatisfied number is a NO-OP. Emits
   * 'chord.revealed' at the true seam with the number, the satisfied flag, and the
   * count of cells opened (>= 0). Hitting a mine through a chord loses the run (an
   * over-eager / mis-flagged chord is the Minesweeper risk that makes the move tense).
   */
  public chordAt(row: number, col: number): void {
    if (!this.inBounds(row, col) || this.owner?.gameCompleted) return;
    // A chord requires a revealed NUMBER (a 0-cell has nothing to chord).
    if (!this.placed || !this.revealed[row][col] || this.mine[row][col]) return;
    const number = this.adj[row][col];
    if (number <= 0) return;

    // Count the FLAGGED neighbours; the number is "satisfied" iff they equal it.
    let flaggedNeighbours = 0;
    const targets: Array<[number, number]> = [];
    for (const [nr, nc] of this.neighbours(row, col)) {
      if (!this.inBounds(nr, nc)) continue;
      if (this.flagged[nr][nc]) flaggedNeighbours += 1;
      else if (!this.revealed[nr][nc]) targets.push([nr, nc]); // a hidden, unflagged candidate
    }
    if (flaggedNeighbours !== number) {
      // Unsatisfied — the player has not committed enough flags; the chord is a no-op.
      this.bus?.emit('chord.revealed', {
        row,
        col,
        number,
        satisfied: false,
        opened: 0,
        revealed: this.revealedCount,
      });
      return;
    }

    // Satisfied: reveal every adjacent unflagged hidden cell (the fast-clear).
    let opened = 0;
    let hitMine = false;
    for (const [tr, tc] of targets) {
      if (this.revealed[tr][tc]) continue;
      if (this.mine[tr][tc]) {
        // A mis-flagged chord can detonate a mine (the genuine Minesweeper risk).
        this.revealed[tr][tc] = true;
        hitMine = true;
        continue;
      }
      opened += this.floodReveal(tr, tc);
    }
    this.revealedCount += opened;

    this.bus?.emit('chord.revealed', {
      row,
      col,
      number,
      satisfied: true,
      opened,
      revealed: this.revealedCount,
    });

    if (hitMine) this.owner?.lose?.();
  }

  /**
   * Reveal a single cell (the base economy). Lays mines first-click-safe on the very
   * first reveal, then flood-fills a 0-count cell. PUBLIC so a level/harness can
   * open the opening pocket that makes the first chord possible. (No emit here — the
   * chord is this behavior's declared event; the base reveal mirrors MineReveal's
   * own 'cell.revealed', which a level binding MineReveal already owns.)
   */
  public revealAt(row: number, col: number): void {
    if (!this.inBounds(row, col) || this.owner?.gameCompleted) return;
    if (this.revealed[row][col] || this.flagged[row][col]) return;
    if (!this.placed) this.placeMines(row, col);
    if (this.mine[row][col]) {
      this.revealed[row][col] = true;
      this.owner?.lose?.();
      return;
    }
    this.revealedCount += this.floodReveal(row, col);
  }

  /** Toggle a flag on a hidden cell (the chord's prerequisite; revealed cells can't flag). */
  public toggleFlagAt(row: number, col: number): void {
    if (!this.inBounds(row, col) || this.owner?.gameCompleted) return;
    if (this.revealed[row][col]) return;
    const next = !this.flagged[row][col];
    this.flagged[row][col] = next;
    this.flagCount += next ? 1 : -1;
    if (this.flagCount < 0) this.flagCount = 0;
  }

  /** The shared event bus, resolved from the owning scene/board. Publish moments via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  private get bus(): EventBus | undefined {
    return (this.owner as any)?.eventBus;
  }

  // ── core mechanic internals (the same flood/placement as MineReveal) ──────────

  /** Iterative BFS flood-fill: open `start`, auto-opening the region of 0-count cells
   *  (stopping at numbered cells). Returns the number of cells newly opened. */
  private floodReveal(startRow: number, startCol: number): number {
    let opened = 0;
    const queue: Array<[number, number]> = [[startRow, startCol]];
    while (queue.length > 0) {
      const [r, c] = queue.shift()!;
      if (!this.inBounds(r, c)) continue;
      if (this.revealed[r][c] || this.flagged[r][c] || this.mine[r][c]) continue;
      this.revealed[r][c] = true;
      opened += 1;
      if (this.adj[r][c] === 0) {
        for (const [nr, nc] of this.neighbours(r, c)) {
          if (this.inBounds(nr, nc) && !this.revealed[nr][nc] && !this.flagged[nr][nc]) {
            queue.push([nr, nc]);
          }
        }
      }
    }
    return opened;
  }

  /** Lay `mineCount` mines, NEVER on the safe cell nor its 8 neighbours
   *  (first-click-safe), then compute every cell's adjacent-mine count. */
  private placeMines(safeRow: number, safeCol: number): void {
    this.placed = true;
    const forbidden = new Set<number>();
    forbidden.add(safeRow * this.cols + safeCol);
    for (const [nr, nc] of this.neighbours(safeRow, safeCol)) {
      if (this.inBounds(nr, nc)) forbidden.add(nr * this.cols + nc);
    }
    const candidates: number[] = [];
    for (let i = 0; i < this.rows * this.cols; i += 1) {
      if (!forbidden.has(i)) candidates.push(i);
    }
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const want = Math.min(this.cfgMineCount, candidates.length);
    for (let i = 0; i < want; i += 1) {
      const idx = candidates[i];
      this.mine[Math.floor(idx / this.cols)][idx % this.cols] = true;
    }
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        if (this.mine[r][c]) continue;
        let n = 0;
        for (const [nr, nc] of this.neighbours(r, c)) {
          if (this.inBounds(nr, nc) && this.mine[nr][nc]) n += 1;
        }
        this.adj[r][c] = n;
      }
    }
  }

  private allocGrids(): void {
    const blank = <T,>(fill: T): T[][] =>
      Array.from({ length: this.rows }, () => new Array(this.cols).fill(fill));
    this.mine = blank(false);
    this.adj = blank(0);
    this.revealed = blank(false);
    this.flagged = blank(false);
  }

  private inBounds(r: number, c: number): boolean {
    return r >= 0 && c >= 0 && r < this.rows && c < this.cols;
  }

  /** The 8 surrounding cells (orthogonal + diagonal). */
  private neighbours(r: number, c: number): Array<[number, number]> {
    return [
      [r - 1, c - 1], [r - 1, c], [r - 1, c + 1],
      [r, c - 1], [r, c + 1],
      [r + 1, c - 1], [r + 1, c], [r + 1, c + 1],
    ];
  }

  // ── component surface (the declared event + observable set) ────────────────────

  /**
   * The component surface for the chord behavior. The single EventDecl is a TRUE
   * statement about a real .emit() site in chordAt():
   *   - chord.revealed <- chordAt() (a chord on a satisfied number opens the
   *                       adjacent unflagged cells; revealedCount jumps)  [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {
        revealedCount: () => this.revealedCount,
        flagCount: () => this.flagCount,
      },
      anchors: [],
      events: [
        {
          name: 'chord.revealed',
          payload: '{row,col,number,satisfied,opened,revealed}',
          scope: 'archetype',
          drivenBy: 'player chords a revealed number whose flags are satisfied',
          expect: '__GAME__ adjacent unflagged cells reveal (revealedCount jumps); chord.revealed logged',
        },
      ],
    };
  }
}

// ── pure helpers ───────────────────────────────────────────────────────────────

/** Parse a 'verb,row,col' intent -> {verb,row,col}; null when malformed. The verb is
 *  'chord' (the headline move), 'reveal', or 'flag'. */
function parseIntent(
  intent: string,
): { verb: 'chord' | 'reveal' | 'flag'; row: number; col: number } | null {
  if (typeof intent !== 'string') return null;
  const parts = intent.split(',');
  if (parts.length !== 3) return null;
  const verb = parts[0].trim();
  if (verb !== 'chord' && verb !== 'reveal' && verb !== 'flag') return null;
  const row = Number.parseInt(parts[1], 10);
  const col = Number.parseInt(parts[2], 10);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { verb, row, col };
}
