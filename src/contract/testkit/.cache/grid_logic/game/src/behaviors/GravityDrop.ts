/**
 * ============================================================================
 * GravityDrop — the FALLING-BLOCK (tetromino) board move RULE behavior (BUILD)
 * ============================================================================
 *
 * The bindable move RULE of the falling-block genre — the grid_logic analogue of
 * MergeSlide for merge-slide. Where MergeSlide is a PURE direction->grid transform,
 * a falling-block board is a continuous-gravity state machine: a piece spawns from a
 * 7-BAG, FALLS on a gravity tick, the player SHIFTS / ROTATES (SRS wall-kicks) /
 * SOFT-DROPS it, it LOCKS after a lock-delay once it can fall no further, and any
 * FULL ROW clears + collapses (the rows above slide down). So GravityDrop is BOTH:
 *
 *   1. an IGridBehavior — resolve(grid, intent) maps one direction intent to a manual
 *      move on the active piece (left/right = shift, up = rotate, down = soft-drop) and
 *      returns the COMPOSITED grid (settled cells + the active piece painted in), so it
 *      slots into the SAME data-driven board the scene already routes moves through.
 *
 *   2. a scene-attached gravity engine — attach(scene) + update() run the gravity tick,
 *      the lock-delay, and the line-clear/collapse against the scene's LIVE board, and
 *      EMIT the two falling-block moments on the scene's shared EventBus (the PUSH
 *      channel, exactly like DataGridScene emits board.moved/tile.merged):
 *        - piece.locked  <- a falling piece can fall no further past the lock delay:
 *                           the settled cells are written into the board (__GAME__ board
 *                           gains the locked cells).
 *        - lines.cleared <- one or more full rows complete: the score increases and the
 *                           rows above collapse down (__GAME__.score increases + rows
 *                           collapse).
 *
 * The board stores a piece's COLOR-ID in each settled cell (a small positive int 1..7);
 * the renderer (DataGridScene.paintTiles) paints any non-zero cell, so a falling-block
 * board renders with zero scene changes — the "two worlds" rule still holds.
 *
 * GENERIC: no game/theme is encoded. Board size + the gravity/lock/scoring knobs are
 * the per-game DELTA (the level data's grid config + this behavior's params), never a
 * hard-coded game value. Every default below is DECLARED in GravityDropConfig.
 */
import type { Grid } from '../board/GridBoard';
import type { IGridBehavior, GridMoveResult } from './IGridBehavior';
import { EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar — discovered/cataloged by the registry (see discover.mjs). */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'GravityDrop',
  intent:
    'The falling-block (tetromino) board move RULE: spawn pieces from a 7-bag, fall on a gravity tick, shift/rotate (SRS wall-kick) and soft-drop the active piece, lock it after a lock-delay, and clear+collapse any full row. Emits piece.locked + lines.cleared on the shared bus.',
  roles: ['board'],
  params: [
    'gravityMs',
    'lockDelayMs',
    'softDropMs',
    'rowsPerLevel',
    'lineScore',
  ],
  tuning: ['gravityMs', 'lockDelayMs', 'lineScore'],
} as const;

/** Per-game tuning (all OPTIONAL — every value here is the DECLARED default). */
export interface GravityDropConfig {
  /** ms between automatic 1-cell gravity drops (default 800). */
  gravityMs?: number;
  /** ms the piece may rest on a surface before it locks (lock-delay; default 500). */
  lockDelayMs?: number;
  /** ms between drops while soft-dropping (a 'down' intent; default 50). */
  softDropMs?: number;
  /** how many cleared rows step the gravity speed up one notch (default 10). */
  rowsPerLevel?: number;
  /** base score per simultaneously-cleared row (×rows, default 100). */
  lineScore?: number;
}

/** A tetromino shape: its id (1..7) + its rotation states as [row,col] cell offsets. */
interface Tetromino {
  id: number;
  /** rotations[state] = the 4 occupied cells (relative to the piece origin) per SRS state. */
  rotations: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  /** which wall-kick table this piece uses ('I' has its own; the rest share 'JLSTZ'). */
  kick: 'I' | 'JLSTZ' | 'O';
}

/** The active piece in play: which tetromino, its rotation state, and its board origin. */
interface ActivePiece {
  tetromino: Tetromino;
  state: number; // 0..3 rotation index
  row: number; // origin row on the board
  col: number; // origin col on the board
}

// ── the seven tetrominoes (SRS rotation states; id = the cell's stored color) ──
// Offsets are [row, col] from the piece origin. State 0 is spawn orientation; states
// 1..3 are 90°-CW rotations. Coordinates follow the canonical SRS bounding boxes.
const TETROMINOES: readonly Tetromino[] = [
  // I
  {
    id: 1,
    kick: 'I',
    rotations: [
      [[1, 0], [1, 1], [1, 2], [1, 3]],
      [[0, 2], [1, 2], [2, 2], [3, 2]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
      [[0, 1], [1, 1], [2, 1], [3, 1]],
    ],
  },
  // J
  {
    id: 2,
    kick: 'JLSTZ',
    rotations: [
      [[0, 0], [1, 0], [1, 1], [1, 2]],
      [[0, 1], [0, 2], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 0], [2, 1]],
    ],
  },
  // L
  {
    id: 3,
    kick: 'JLSTZ',
    rotations: [
      [[0, 2], [1, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [1, 2], [2, 0]],
      [[0, 0], [0, 1], [1, 1], [2, 1]],
    ],
  },
  // O
  {
    id: 4,
    kick: 'O',
    rotations: [
      [[0, 1], [0, 2], [1, 1], [1, 2]],
      [[0, 1], [0, 2], [1, 1], [1, 2]],
      [[0, 1], [0, 2], [1, 1], [1, 2]],
      [[0, 1], [0, 2], [1, 1], [1, 2]],
    ],
  },
  // S
  {
    id: 5,
    kick: 'JLSTZ',
    rotations: [
      [[0, 1], [0, 2], [1, 0], [1, 1]],
      [[0, 1], [1, 1], [1, 2], [2, 2]],
      [[1, 1], [1, 2], [2, 0], [2, 1]],
      [[0, 0], [1, 0], [1, 1], [2, 1]],
    ],
  },
  // T
  {
    id: 6,
    kick: 'JLSTZ',
    rotations: [
      [[0, 1], [1, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [1, 2], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 1]],
      [[0, 1], [1, 0], [1, 1], [2, 1]],
    ],
  },
  // Z
  {
    id: 7,
    kick: 'JLSTZ',
    rotations: [
      [[0, 0], [0, 1], [1, 1], [1, 2]],
      [[0, 2], [1, 1], [1, 2], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
      [[0, 1], [1, 0], [1, 1], [2, 0]],
    ],
  },
];

// ── SRS wall-kick tables: per (fromState -> toState) the [dCol, dRow] offsets to try ──
// The standard SRS data. Offsets are tried in order; the first that fits is used.
type KickList = ReadonlyArray<readonly [number, number]>; // [dCol, dRow]
const KICKS_JLSTZ: Record<string, KickList> = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I: Record<string, KickList> = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

export class GravityDrop implements IGridBehavior {
  private readonly gravityMs: number;
  private readonly lockDelayMs: number;
  private readonly softDropMs: number;
  private readonly rowsPerLevel: number;
  private readonly lineScore: number;

  /** The scene this is attached to (set by attach()); its board + bus + score. */
  private scene: any;
  /** The shared event bus we emit on — the scene's when attached, else a local one. */
  private bus: EventBus = new EventBus();

  /** The active falling piece (null between lock and the next spawn). */
  private active: ActivePiece | null = null;
  /** The 7-bag: a shuffled queue of tetromino indices, refilled when empty. */
  private bag: number[] = [];
  /** ms accumulated toward the next gravity drop. */
  private fallAccum = 0;
  /** ms the active piece has rested on a surface (the lock-delay timer; -1 = airborne). */
  private lockTimer = -1;
  /** total rows cleared this run (drives the level/speed ramp). */
  private rowsCleared = 0;
  /** the soft-drop flag — set while a 'down' intent is held this tick window. */
  private softDropping = false;
  private rng: () => number = Math.random;

  constructor(params: GravityDropConfig = {}) {
    this.gravityMs = params.gravityMs ?? 800;
    this.lockDelayMs = params.lockDelayMs ?? 500;
    this.softDropMs = params.softDropMs ?? 50;
    this.rowsPerLevel = params.rowsPerLevel ?? 10;
    this.lineScore = params.lineScore ?? 100;
  }

  // ── IGridBehavior: a manual move on the active piece (the scene's move seam) ──

  /**
   * Resolve one MANUAL move intent against the live board + active piece. Returns the
   * composited grid (settled cells + the active piece) so the scene's applyMove path
   * paints it. PURE w.r.t. its `grid` argument (the engine state lives on the active
   * piece, not the passed grid) — left/right shift, up rotates (SRS wall-kick), down
   * soft-drops one cell. Unknown intent / no active piece -> a no-op (changed:false).
   */
  resolve(grid: Grid, intent: string): GridMoveResult {
    const settled = grid.map((r) => r.slice());
    if (!this.active) {
      return { grid: settled, changed: false, scoreDelta: 0 };
    }
    let changed = false;
    if (intent === 'left') changed = this.tryShift(settled, 0, -1);
    else if (intent === 'right') changed = this.tryShift(settled, 0, 1);
    else if (intent === 'up') changed = this.tryRotate(settled);
    else if (intent === 'down') {
      this.softDropping = true;
      changed = this.tryShift(settled, 1, 0); // one soft-drop step now
    }
    // Recompose the board for the renderer: settled cells + the active piece painted in.
    return { grid: this.compose(settled), changed, scoreDelta: 0 };
  }

  // ── scene attachment + the gravity engine (the emit side) ─────────────────────

  /**
   * Bind to the scene: take its real EventBus so piece.locked / lines.cleared land on
   * the SAME bus the core hook folds onto __GAME__.events, and spawn the first piece.
   */
  attach(scene: any): void {
    this.scene = scene;
    if (scene?.eventBus instanceof EventBus) this.bus = scene.eventBus;
    if (typeof scene?.rng === 'function') this.rng = scene.rng;
    else this.rng = Math.random;
    this.reset();
    this.spawnPiece();
  }

  /** Re-arm to a fresh-board state (a RESTART re-runs this before the first spawn). */
  reset(): void {
    this.active = null;
    this.bag = [];
    this.fallAccum = 0;
    this.lockTimer = -1;
    this.rowsCleared = 0;
    this.softDropping = false;
  }

  /**
   * The gravity tick — call once per frame with the elapsed ms (the scene drives this
   * from update()). Accumulates toward a gravity drop; when the piece can fall no
   * further, runs the lock-delay; on lock, settles the piece (emit piece.locked) and
   * clears any full rows (emit lines.cleared), then spawns the next piece from the bag.
   */
  update(dtMs: number): void {
    if (!this.scene || this.scene.gameCompleted) return;
    const board: Grid = this.scene.board?.snapshot?.();
    if (!board || !this.active) return;

    const interval = this.softDropping ? this.softDropMs : this.currentGravityMs();
    this.fallAccum += dtMs;
    this.softDropping = false; // soft-drop is per-frame; the scheme re-asserts it on hold

    while (this.fallAccum >= interval) {
      this.fallAccum -= interval;
      if (this.canPlace(board, this.active.tetromino.rotations[this.active.state], this.active.row + 1, this.active.col)) {
        this.active.row += 1;
        this.lockTimer = -1; // moved down -> airborne again, reset the lock timer
      } else {
        // Resting on a surface — run the lock-delay.
        if (this.lockTimer < 0) this.lockTimer = 0;
      }
    }

    // Lock-delay: once resting, count ms; lock when the delay elapses.
    if (this.lockTimer >= 0) {
      this.lockTimer += dtMs;
      if (this.lockTimer >= this.lockDelayMs) this.lockAndAdvance(board);
    }
  }

  // ── the lock + line-clear seam (the two emitted moments) ──────────────────────

  /** Settle the active piece into the board, clear full rows, then spawn the next. */
  private lockAndAdvance(board: Grid): void {
    const piece = this.active;
    if (!piece) return;
    const cells = this.absoluteCells(piece.tetromino.rotations[piece.state], piece.row, piece.col);

    // Write the locked cells into the LIVE board (the __GAME__ board gains them).
    for (const [r, c] of cells) {
      if (r >= 0 && r < board.length && c >= 0 && c < board[0].length) {
        board[r][c] = piece.tetromino.id;
      }
    }
    this.scene.board.setGrid(board);

    // piece.locked — a falling piece landed; the board now holds its cells.
    this.bus.emit('piece.locked', {
      pieceId: piece.tetromino.id,
      cells: cells.map(([r, c]) => ({ row: r, col: c })),
    });

    this.active = null;
    this.lockTimer = -1;
    this.fallAccum = 0;

    // Full-row clear + collapse.
    const cleared = this.clearFullRows(board);
    if (cleared > 0) {
      this.scene.board.setGrid(board);
      this.rowsCleared += cleared;
      const gained = this.lineScore * cleared * cleared; // n-row bonus (1,4,9,16 ×)
      const score = ((this.scene.registry?.get?.('score') as number) ?? 0) + gained;
      this.scene.registry?.set?.('score', score);

      // lines.cleared — full rows completed; the score increased and rows collapsed.
      this.bus.emit('lines.cleared', { rows: cleared, gained, score, totalRows: this.rowsCleared });
    }

    // Re-derive win/lose + re-paint via the scene's normal post-move path, then spawn.
    this.scene.refreshAfterGravity?.();
    this.spawnPiece();
  }

  /**
   * Remove every full row and collapse the rows above into the gap (gravity for the
   * settled stack). Mutates `board` in place; returns how many rows were cleared.
   */
  private clearFullRows(board: Grid): number {
    const cols = board[0]?.length ?? 0;
    const kept: number[][] = [];
    let cleared = 0;
    for (let r = board.length - 1; r >= 0; r -= 1) {
      const full = board[r].every((v) => v !== 0);
      if (full) cleared += 1;
      else kept.push(board[r].slice());
    }
    if (cleared === 0) return 0;
    // Rebuild bottom-up: kept rows stay, empty rows pad the top.
    const rebuilt: number[][] = [];
    for (let i = 0; i < cleared; i += 1) rebuilt.push(new Array(cols).fill(0));
    for (let i = kept.length - 1; i >= 0; i -= 1) rebuilt.push(kept[i]);
    for (let r = 0; r < board.length; r += 1) board[r] = rebuilt[r];
    return cleared;
  }

  // ── piece spawning (the 7-bag randomizer) ─────────────────────────────────────

  /** Spawn the next tetromino at the top-center; if it can't be placed, the game is over. */
  private spawnPiece(): void {
    const board: Grid = this.scene?.board?.snapshot?.();
    if (!board) return;
    const tetromino = TETROMINOES[this.nextFromBag()];
    const cols = board[0]?.length ?? 10;
    const col = Math.max(0, Math.floor((cols - 4) / 2));
    const candidate: ActivePiece = { tetromino, state: 0, row: 0, col };
    if (!this.canPlace(board, tetromino.rotations[0], candidate.row, candidate.col)) {
      // Top-out: no room for the new piece -> the board is game-over.
      this.scene?.lose?.();
      return;
    }
    this.active = candidate;
    this.lockTimer = -1;
    this.fallAccum = 0;
  }

  /** The 7-bag: yields each of the 7 tetrominoes once before any repeats (refill on empty). */
  private nextFromBag(): number {
    if (this.bag.length === 0) {
      this.bag = [0, 1, 2, 3, 4, 5, 6];
      // Fisher-Yates shuffle with the scene RNG (seeded -> deterministic harness).
      for (let i = this.bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop() as number;
  }

  // ── piece geometry helpers (shift / rotate / placement / compose) ─────────────

  /** Try to move the active piece by (dRow,dCol); apply iff it still fits. */
  private tryShift(settled: Grid, dRow: number, dCol: number): boolean {
    const p = this.active!;
    const r = p.row + dRow;
    const c = p.col + dCol;
    if (!this.canPlace(settled, p.tetromino.rotations[p.state], r, c)) return false;
    p.row = r;
    p.col = c;
    if (dRow > 0) this.lockTimer = -1; // a successful drop re-arms airborne state
    return true;
  }

  /** Try to rotate CW with SRS wall-kicks; apply the first kick offset that fits. */
  private tryRotate(settled: Grid): boolean {
    const p = this.active!;
    if (p.tetromino.kick === 'O') return false; // O never rotates meaningfully
    const next = (p.state + 1) % 4;
    const key = `${p.state}>${next}`;
    const table = p.tetromino.kick === 'I' ? KICKS_I : KICKS_JLSTZ;
    const kicks = table[key] ?? [[0, 0]];
    for (const [dCol, dRow] of kicks) {
      const r = p.row + dRow;
      const c = p.col + dCol;
      if (this.canPlace(settled, p.tetromino.rotations[next], r, c)) {
        p.state = next;
        p.row = r;
        p.col = c;
        return true;
      }
    }
    return false;
  }

  /** True iff the rotation's cells at origin (row,col) are all in-bounds + empty. */
  private canPlace(board: Grid, offsets: ReadonlyArray<readonly [number, number]>, row: number, col: number): boolean {
    const rows = board.length;
    const cols = board[0]?.length ?? 0;
    for (const [dr, dc] of offsets) {
      const r = row + dr;
      const c = col + dc;
      if (c < 0 || c >= cols || r >= rows) return false; // walls / floor
      if (r >= 0 && board[r][c] !== 0) return false; // an occupied settled cell
    }
    return true;
  }

  /** The board-absolute [row,col] cells of a rotation placed at origin (row,col). */
  private absoluteCells(offsets: ReadonlyArray<readonly [number, number]>, row: number, col: number): [number, number][] {
    return offsets.map(([dr, dc]) => [row + dr, col + dc] as [number, number]);
  }

  /** Paint the active piece onto a copy of the settled board (the rendered grid). */
  private compose(settled: Grid): Grid {
    const out = settled.map((r) => r.slice());
    if (!this.active) return out;
    const cells = this.absoluteCells(
      this.active.tetromino.rotations[this.active.state],
      this.active.row,
      this.active.col,
    );
    for (const [r, c] of cells) {
      if (r >= 0 && r < out.length && c >= 0 && c < out[0].length) {
        out[r][c] = this.active.tetromino.id;
      }
    }
    return out;
  }

  /** Gravity interval at the current level (speeds up every rowsPerLevel cleared). */
  private currentGravityMs(): number {
    const level = Math.floor(this.rowsCleared / this.rowsPerLevel);
    return Math.max(80, this.gravityMs - level * 70);
  }

  // ── component surface (the declared event set this behavior publishes) ────────

  /**
   * The component surface for the falling-block rule. Declares the two falling-block
   * moments it emits on the shared bus — each a TRUE statement about a real .emit()
   * site in this file:
   *   - piece.locked  <- lockAndAdvance() (a piece settled into the board)  [archetype]
   *   - lines.cleared <- lockAndAdvance() (full rows cleared + collapsed)    [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'piece.locked',
          payload: '{pieceId,cells:[{row,col}]}',
          scope: 'archetype',
          drivenBy: 'a falling piece lands',
          expect: '__GAME__ board gains the locked cells; piece.locked logged',
        },
        {
          name: 'lines.cleared',
          payload: '{rows,gained,score,totalRows}',
          scope: 'archetype',
          drivenBy: 'a full row completes',
          expect: '__GAME__.score increases + rows collapse; lines.cleared logged',
        },
      ],
    };
  }
}
