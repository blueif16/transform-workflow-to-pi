/**
 * ============================================================================
 * ConnectGravityDrop — the CONNECT-FOUR turn-duel board move RULE behavior (BUILD)
 * ============================================================================
 *
 * The bindable move RULE of the turn-duel "drop" genre — a Connect-Four-style
 * variant of the grid_logic board. It is the column-drop sibling of GravityDrop
 * (falling-block) and of TurnDuel (place-on-empty): two sides ALTERNATE turns; on a
 * turn the active side picks a COLUMN and a disc DROPS into it, falling to the LOWEST
 * EMPTY CELL of that column (gravity). The first side to form an N-in-a-row line —
 * horizontal, vertical, OR either diagonal — WINS; if the board FILLS with no winner
 * the game is a DRAW.
 *
 * Like GravityDrop, ConnectGravityDrop is BOTH:
 *
 *   1. an IGridBehavior — resolve(grid, intent) maps a discrete intent to a move on
 *      the active turn: left/right SHIFTS the drop cursor between columns; up/down
 *      (or 'drop') DROPS the disc into the cursor column. It returns the COMPOSITED
 *      grid (settled discs + a faint cursor preview at the top of the active column)
 *      so it slots into the SAME data-driven board the scene routes moves through.
 *
 *   2. a scene-attached duel engine — attach(scene) binds the scene's shared
 *      EventBus + board + status seams. A drop WRITES the disc into the live board,
 *      EMITS the two turn-duel moments on the shared bus (the PUSH channel, exactly
 *      like TurnDuel emits mark.placed / DataGridScene emits board.moved):
 *        - disc.dropped <- a disc lands in a column at its lowest empty cell: the
 *                          board gains the disc and the TURN FLIPS to the other side
 *                          (__GAME__ board gains the disc; the active turn changes).
 *        - board.drawn  <- the board fills with no N-in-a-row for either side: the
 *                          game ends in a draw (__GAME__.status becomes 'draw').
 *      A winning drop drives the shared win seam (scene.win() -> __GAME__.status='won').
 *
 * The board stores a side's DISC-ID in each settled cell (DISC_P1 = 1, DISC_P2 = 2);
 * the renderer (DataGridScene.paintTiles) paints any non-zero cell, so a Connect-Four
 * board renders with zero scene changes — the "two worlds" rule still holds.
 *
 * GENERIC: no game/theme is encoded. Board size is the level data's grid config; the
 * win-length N + which side opens + whether side 2 is an auto opponent are this
 * behavior's params, each with a DECLARED default below — never a hard-coded game value.
 */
import type { Grid } from '../board/GridBoard';
import type { IGridBehavior, GridMoveResult } from './IGridBehavior';
import { EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar — discovered/cataloged by the registry (see discover.mjs). */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'ConnectGravityDrop',
  intent:
    'The Connect-Four-style turn-duel board move RULE: two sides alternate turns; a disc dropped into a column falls to the lowest empty cell; the first to an N-in-a-row line (row/col/either diagonal) wins; the board filling with no winner is a draw. Emits disc.dropped + board.drawn on the shared bus.',
  roles: ['board'],
  params: ['winLength', 'p1First', 'autoOpponent'],
  tuning: ['winLength'],
} as const;

/** The two disc values written into the shared logical board (0 = empty cell). */
const DISC_P1 = 1;
const DISC_P2 = 2;
type Side = typeof DISC_P1 | typeof DISC_P2;

/** Per-game tuning (all OPTIONAL — every value here is the DECLARED default). */
export interface ConnectGravityDropConfig {
  /** discs-in-a-row to win — row/col/either diagonal (default 4, classic Connect-Four). */
  winLength?: number;
  /** true => player 1 (side 1) drops first (default true). */
  p1First?: boolean;
  /**
   * true => side 2 is an automatic opponent that drops a column heuristically right
   * after the human's drop, so a single human input completes a full turn cycle
   * (default true). false => a hot-seat duel where each side is driven externally.
   */
  autoOpponent?: boolean;
}

export class ConnectGravityDrop implements IGridBehavior {
  // ── declared config (sensible defaults; NEVER fabricated per-game) ──
  private readonly winLengthOverride?: number;
  private readonly p1First: boolean;
  private readonly autoOpponent: boolean;

  /** The scene this is attached to (set by attach()); its board + bus + status seams. */
  private scene: any;
  /** The shared event bus we emit on — the scene's when attached, else a local one. */
  private bus: EventBus = new EventBus();

  /** Whose turn it is (the active side). Flipped after every successful drop. */
  private turn: Side = DISC_P1;
  /** The active drop cursor column (left/right move it; the drop targets this column). */
  private cursorCol = 0;
  /** Resolved at attach() from the live board geometry. */
  private rows = 0;
  private cols = 0;
  private winLength = 4;
  /** Latched true once a win or a draw ends the duel (no further drops). */
  private over = false;
  /** A re-entrancy guard so an auto-opponent drop doesn't recurse the human path. */
  private resolving = false;
  private rng: () => number = Math.random;

  constructor(params: ConnectGravityDropConfig = {}) {
    this.winLengthOverride =
      typeof params.winLength === 'number' ? Math.max(2, Math.floor(params.winLength)) : undefined;
    this.p1First = params.p1First !== false; // default true
    this.autoOpponent = params.autoOpponent !== false; // default true
  }

  // ── IGridBehavior: a discrete move on the active turn (the scene's move seam) ──

  /**
   * Resolve one MOVE intent against the live board + the active turn. PURE w.r.t. its
   * `grid` argument (the duel state lives on this behavior, not the passed grid):
   *   - left / right : SHIFT the drop cursor one column (clamped to the board).
   *   - up / down / 'drop' : DROP the active side's disc into the cursor column.
   * Returns the composited grid (settled discs + the cursor preview) so the scene's
   * applyMove path paints it. A no-op (a full column / a game-over board / an unknown
   * intent) returns changed:false. After a successful drop, if autoOpponent is on and
   * it's now side 2's turn, side 2 drops immediately (one human input = a full cycle).
   */
  resolve(grid: Grid, intent: string): GridMoveResult {
    const settled = grid.map((r) => r.slice());
    if (this.cols === 0) this.deriveGeometry(settled); // first call before attach()
    if (this.over) return { grid: this.compose(settled), changed: false, scoreDelta: 0 };

    if (intent === 'left') {
      const c = Math.max(0, this.cursorCol - 1);
      const changed = c !== this.cursorCol;
      this.cursorCol = c;
      return { grid: this.compose(settled), changed, scoreDelta: 0 };
    }
    if (intent === 'right') {
      const c = Math.min(this.cols - 1, this.cursorCol + 1);
      const changed = c !== this.cursorCol;
      this.cursorCol = c;
      return { grid: this.compose(settled), changed, scoreDelta: 0 };
    }
    if (intent === 'up' || intent === 'down' || intent === 'drop') {
      const changed = this.dropInto(settled, this.cursorCol, this.turn);
      return { grid: this.compose(settled), changed, scoreDelta: 0 };
    }
    return { grid: this.compose(settled), changed: false, scoreDelta: 0 };
  }

  // ── scene attachment (the emit side binds the shared bus + status seams) ───────

  /**
   * Bind to the scene: take its real EventBus so disc.dropped / board.drawn land on
   * the SAME bus the core hook folds onto __GAME__.events, then re-arm a fresh duel.
   */
  attach(scene: any): void {
    this.scene = scene;
    if (scene?.eventBus instanceof EventBus) this.bus = scene.eventBus;
    if (typeof scene?.rng === 'function') this.rng = scene.rng;
    else this.rng = Math.random;
    this.rows = scene?.board?.rows ?? this.rows;
    this.cols = scene?.board?.cols ?? this.cols;
    this.winLength = this.winLengthOverride ?? Math.min(4, Math.max(2, Math.min(this.rows, this.cols)));
    this.reset();
  }

  /** Re-arm to a fresh-duel state (a RESTART re-runs this before the next move). */
  reset(): void {
    this.over = false;
    this.resolving = false;
    this.cursorCol = Math.floor(this.cols / 2);
    this.turn = this.p1First ? DISC_P1 : DISC_P2;
  }

  // ── the drop seam (the emitted moments) ───────────────────────────────────────

  /**
   * Drop `side`'s disc into `col`: find the lowest empty cell (gravity), write the
   * disc, emit disc.dropped, then resolve the turn — a win drives scene.win(); a full
   * board with no winner emits board.drawn + ends in a draw; otherwise the turn FLIPS.
   * Mutates `settled` in place (the rendered grid is recomposed from it). Returns true
   * iff a disc actually landed (a full / out-of-bounds column is a no-op).
   */
  private dropInto(settled: Grid, col: number, side: Side): boolean {
    if (this.over) return false;
    const row = this.lowestEmptyRow(settled, col);
    if (row < 0) return false; // the column is full -> no drop

    settled[row][col] = side;
    const next: Side = side === DISC_P1 ? DISC_P2 : DISC_P1;

    // Persist into the LIVE board so the snapshot/the renderer reflect the disc.
    this.scene?.board?.setGrid?.(settled);

    // disc.dropped — a disc landed at its lowest empty cell; the turn flips to `next`.
    this.bus.emit('disc.dropped', { col, row, side, next });

    // A winning drop ends the duel via the shared status seam (__GAME__.status='won').
    if (this.hasLine(settled, side)) {
      this.over = true;
      this.scene?.win?.();
      return true;
    }

    // A full board with no winner is a DRAW.
    if (this.isBoardFull(settled)) {
      this.declareDraw();
      return true;
    }

    // No terminal — flip the turn. If side 2 now plays and the auto-opponent is on,
    // let it take its drop immediately so one human input completes a full cycle.
    this.turn = next;
    if (this.autoOpponent && this.turn === DISC_P2 && !this.resolving) {
      this.resolving = true;
      this.opponentDrop(settled);
      this.resolving = false;
    }
    return true;
  }

  /** The auto-opponent's turn: pick a column heuristically, then drop into it. */
  private opponentDrop(settled: Grid): void {
    if (this.over) return;
    const col = this.bestOpponentColumn(settled);
    if (col < 0) return;
    this.cursorCol = col;
    this.dropInto(settled, col, DISC_P2);
  }

  /**
   * The draw seam — the board filled with no N-in-a-row for either side. Latch the
   * end, emit board.drawn, and drive the shared status to 'draw' (the terminal latch
   * via lose() so __GAME__.status leaves 'playing'; the registry holds the 'draw' tag).
   */
  private declareDraw(): void {
    this.over = true;
    // board.drawn — the board is full with no winner; the game is a draw.
    this.bus.emit('board.drawn', { totalCells: this.rows * this.cols, winner: null });
    // Drive the shared terminal status so __GAME__.status becomes a draw.
    if (this.scene?.registry?.set) this.scene.registry.set('status', 'draw');
    this.scene?.lose?.();
  }

  // ── the opponent heuristic (a genuine, non-placeholder column chooser) ─────────

  /**
   * Choose side 2's column: take an immediate win if one exists; else block an
   * immediate human win; else prefer the most central playable column (the classic
   * Connect-Four center bias). Returns -1 only when the board is full.
   */
  private bestOpponentColumn(settled: Grid): number {
    const playable: number[] = [];
    for (let c = 0; c < this.cols; c += 1) {
      if (this.lowestEmptyRow(settled, c) >= 0) playable.push(c);
    }
    if (playable.length === 0) return -1;

    // 1) win now if a drop completes side 2's line.
    for (const c of playable) if (this.dropWins(settled, c, DISC_P2)) return c;
    // 2) block an immediate human win.
    for (const c of playable) if (this.dropWins(settled, c, DISC_P1)) return c;
    // 3) center bias — the column closest to the board's middle.
    const mid = (this.cols - 1) / 2;
    let best = playable[0];
    let bestDist = Infinity;
    for (const c of playable) {
      const d = Math.abs(c - mid);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  /** True iff dropping `side` into `col` (on a copy) would complete an N-in-a-row. */
  private dropWins(settled: Grid, col: number, side: Side): boolean {
    const row = this.lowestEmptyRow(settled, col);
    if (row < 0) return false;
    const trial = settled.map((r) => r.slice());
    trial[row][col] = side;
    return this.hasLine(trial, side);
  }

  // ── pure board helpers (gravity / line-scan / fullness / geometry) ────────────

  /** The lowest EMPTY row index in `col` (gravity target); -1 when the column is full. */
  private lowestEmptyRow(grid: Grid, col: number): number {
    if (col < 0 || col >= this.cols) return -1;
    for (let r = this.rows - 1; r >= 0; r -= 1) {
      if (grid[r]?.[col] === 0) return r;
    }
    return -1;
  }

  /** True iff every cell is non-empty (the draw condition). */
  private isBoardFull(grid: Grid): boolean {
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        if (grid[r]?.[c] === 0) return false;
      }
    }
    return true;
  }

  /**
   * True iff `side` has an N-in-a-row anywhere: a horizontal, vertical, or either
   * diagonal run of `winLength` equal discs. Scans every cell as a run origin in the
   * four forward directions (the line-scan win — rows/cols/both diagonals).
   */
  private hasLine(grid: Grid, side: Side): boolean {
    const n = this.winLength;
    const R = this.rows;
    const C = this.cols;
    const dirs = [
      [0, 1], // →
      [1, 0], // ↓
      [1, 1], // ↘
      [1, -1], // ↙
    ];
    for (let r = 0; r < R; r += 1) {
      for (let c = 0; c < C; c += 1) {
        if (grid[r]?.[c] !== side) continue;
        for (const [dr, dc] of dirs) {
          let run = 1;
          let rr = r + dr;
          let cc = c + dc;
          while (rr >= 0 && rr < R && cc >= 0 && cc < C && grid[rr]?.[cc] === side) {
            run += 1;
            if (run >= n) return true;
            rr += dr;
            cc += dc;
          }
        }
      }
    }
    return false;
  }

  /** Derive rows/cols/winLength from a passed grid (resolve() may run before attach()). */
  private deriveGeometry(grid: Grid): void {
    this.rows = grid.length;
    this.cols = grid[0]?.length ?? 0;
    this.winLength = this.winLengthOverride ?? Math.min(4, Math.max(2, Math.min(this.rows, this.cols)));
    if (this.cursorCol >= this.cols) this.cursorCol = Math.floor(this.cols / 2);
  }

  /**
   * Paint a faint CURSOR PREVIEW disc at the top of the active column onto a copy of
   * the settled board (the rendered grid), so the player sees where the next disc
   * drops. The preview uses the active side's disc id at the column's lowest empty
   * cell; if the column is full, nothing is previewed.
   */
  private compose(settled: Grid): Grid {
    const out = settled.map((r) => r.slice());
    if (this.over) return out;
    const row = this.lowestEmptyRow(out, this.cursorCol);
    if (row >= 0) out[row][this.cursorCol] = this.turn;
    return out;
  }

  // ── component surface (the declared event set this behavior publishes) ────────

  /**
   * The component surface for the Connect-Four turn-duel rule. Each EventDecl is a
   * TRUE statement about a real .emit() site in this file:
   *   - disc.dropped <- dropInto()    (a disc landed; the turn flips)      [archetype]
   *   - board.drawn  <- declareDraw()  (the board filled with no winner)   [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'disc.dropped',
          payload: '{col,row,side,next}',
          scope: 'archetype',
          drivenBy: 'drop a disc in a column',
          expect: '__GAME__ the disc lands at the lowest empty cell + the turn flips; disc.dropped logged',
        },
        {
          name: 'board.drawn',
          payload: '{totalCells,winner:null}',
          scope: 'archetype',
          drivenBy: 'the board fills with no winner',
          expect: "__GAME__.status becomes a draw; board.drawn logged",
        },
      ],
    };
  }
}
