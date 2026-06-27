/**
 * ============================================================================
 * HoldGhostPiece — the HOLD-PIECE + GHOST HARD-DROP falling-block move RULE (BUILD)
 * ============================================================================
 *
 * A falling-block (tetromino) board move RULE — the grid_logic sibling of GravityDrop
 * — that adds the two modern-Tetris affordances a falling-block game lives or dies by:
 *
 *   1. HOLD  — the player parks the active piece in a "hold" slot and pulls out
 *              whatever was held (or the next bag piece on the first hold). The classic
 *              ONCE-PER-DROP rule applies: you may hold at most once before the next
 *              piece locks, so hold is a deliberate stash, never a free re-roll. The
 *              swapped-in piece re-spawns at the top in its spawn orientation.
 *   2. HARD-DROP — the player slams the active piece straight down to the GHOST-PREVIEW
 *              position (the lowest row the piece can legally occupy in its current
 *              column) and LOCKS it there immediately — no further gravity, no lock
 *              delay. The ghost preview IS the landing row, so a hard-drop is "lock at
 *              the ghost."
 *
 * Like GravityDrop it is BOTH an IGridBehavior (resolve(grid,intent) -> the composited
 * grid the scene paints) AND a scene-attached gravity engine (attach(scene)+update()
 * run the fall/lock against the scene's LIVE board). It manages its OWN active piece,
 * 7-bag, and hold slot — fully self-contained, exactly like BoxPush/ChainClear/
 * GravityDrop are each self-contained rules — so the falling-block board is genuinely
 * playable through this one rule with hold + hard-drop wired in.
 *
 * THE TWO EMITTED MOMENTS (the PUSH channel, on the scene's shared EventBus — the same
 * seam DataGridScene emits board.moved through):
 *   - piece.held       <- a 'hold' intent swaps the active piece with the hold slot
 *                         (__GAME__ active piece + held piece swap; once per drop).
 *   - piece.hardDropped <- a 'harddrop' intent drops the piece to the ghost row and
 *                         locks it there (__GAME__ board gains the locked cells at the
 *                         ghost-preview position).
 *
 * The board stores a piece's COLOR-ID in each settled cell (a small positive int 1..7);
 * DataGridScene.paintTiles paints any non-zero cell, so this renders with zero scene
 * changes (the two-worlds rule holds).
 *
 * GENERIC: no game/theme is encoded. Board size + the gravity/lock knobs are the
 * per-game DELTA (the level data's grid config + this rule's params); every default
 * below is DECLARED in HoldGhostPieceConfig. Piece COLOR-IDs (the payload `pieceId` /
 * `heldId`) are AUTO-DERIVED from the active/held tetromino, never a config value.
 */
import type { Grid } from '../board/GridBoard';
import type { IGridBehavior, GridMoveResult } from './IGridBehavior';
import { EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar — discovered/cataloged by the registry (see discover.mjs). */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'HoldGhostPiece',
  intent:
    'The falling-block move RULE with HOLD + GHOST HARD-DROP: a hold intent parks the active piece in a hold slot and pulls out the held (or next) piece (once per drop); a hard-drop intent slams the piece to the ghost-preview row (its lowest legal position) and locks it there immediately. Spawn from a 7-bag, fall on a gravity tick, shift/rotate/soft-drop, and clear+collapse full rows. Emits piece.held + piece.hardDropped on the shared bus.',
  roles: ['board'],
  params: ['gravityMs', 'lockDelayMs', 'softDropMs', 'lineScore', 'hardDropScore'],
  tuning: ['gravityMs', 'lockDelayMs', 'hardDropScore'],
} as const;

/** Per-game tuning (all OPTIONAL — every value here is the DECLARED default). */
export interface HoldGhostPieceConfig {
  /** ms between automatic 1-cell gravity drops (default 800). */
  gravityMs?: number;
  /** ms the piece may rest on a surface before it locks (lock-delay; default 500). */
  lockDelayMs?: number;
  /** ms between drops while soft-dropping (a 'down' intent; default 50). */
  softDropMs?: number;
  /** base score per simultaneously-cleared row (×rows², default 100). */
  lineScore?: number;
  /** bonus score per cell a hard-drop falls (rewards the slam; default 2). */
  hardDropScore?: number;
}

/** A tetromino shape: its id (1..7) + its rotation states as [row,col] cell offsets. */
interface Tetromino {
  id: number;
  /** rotations[state] = the 4 occupied cells (relative to the piece origin) per SRS state. */
  rotations: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
}

/** The active piece in play: which tetromino, its rotation state, and its board origin. */
interface ActivePiece {
  tetromino: Tetromino;
  state: number; // 0..3 rotation index
  row: number; // origin row on the board
  col: number; // origin col on the board
}

// ── the seven tetrominoes (id = the cell's stored color; spawn-orientation + 90°CW) ──
// Offsets are [row, col] from the piece origin. State 0 is spawn orientation.
const TETROMINOES: readonly Tetromino[] = [
  // I
  { id: 1, rotations: [
    [[1, 0], [1, 1], [1, 2], [1, 3]], [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[2, 0], [2, 1], [2, 2], [2, 3]], [[0, 1], [1, 1], [2, 1], [3, 1]],
  ] },
  // J
  { id: 2, rotations: [
    [[0, 0], [1, 0], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]], [[0, 1], [1, 1], [2, 0], [2, 1]],
  ] },
  // L
  { id: 3, rotations: [
    [[0, 2], [1, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [1, 2], [2, 0]], [[0, 0], [0, 1], [1, 1], [2, 1]],
  ] },
  // O
  { id: 4, rotations: [
    [[0, 1], [0, 2], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [1, 2]],
    [[0, 1], [0, 2], [1, 1], [1, 2]], [[0, 1], [0, 2], [1, 1], [1, 2]],
  ] },
  // S
  { id: 5, rotations: [
    [[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 1], [1, 2], [2, 0], [2, 1]], [[0, 0], [1, 0], [1, 1], [2, 1]],
  ] },
  // T
  { id: 6, rotations: [
    [[0, 1], [1, 0], [1, 1], [1, 2]], [[0, 1], [1, 1], [1, 2], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 1]], [[0, 1], [1, 0], [1, 1], [2, 1]],
  ] },
  // Z
  { id: 7, rotations: [
    [[0, 0], [0, 1], [1, 1], [1, 2]], [[0, 2], [1, 1], [1, 2], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]], [[0, 1], [1, 0], [1, 1], [2, 0]],
  ] },
];

export class HoldGhostPiece implements IGridBehavior {
  private readonly gravityMs: number;
  private readonly lockDelayMs: number;
  private readonly softDropMs: number;
  private readonly lineScore: number;
  private readonly hardDropScore: number;

  /** The scene this is attached to (set by attach()); its board + bus + score. */
  private scene: any;
  /** The shared event bus we emit on — the scene's when attached, else a local one. */
  private bus: EventBus = new EventBus();

  /** The active falling piece (null between lock and the next spawn). */
  private active: ActivePiece | null = null;
  /** The held tetromino (the hold slot; null until the first hold). */
  private held: Tetromino | null = null;
  /** Once-per-drop hold latch: true after a hold, cleared when the next piece spawns. */
  private holdUsed = false;
  /** The 7-bag: a shuffled queue of tetromino indices, refilled when empty. */
  private bag: number[] = [];
  /** ms accumulated toward the next gravity drop. */
  private fallAccum = 0;
  /** ms the active piece has rested on a surface (the lock-delay timer; -1 = airborne). */
  private lockTimer = -1;
  /** the soft-drop flag — set while a 'down' intent is held this tick window. */
  private softDropping = false;
  private rng: () => number = Math.random;

  constructor(params: HoldGhostPieceConfig = {}) {
    this.gravityMs = params.gravityMs ?? 800;
    this.lockDelayMs = params.lockDelayMs ?? 500;
    this.softDropMs = params.softDropMs ?? 50;
    this.lineScore = params.lineScore ?? 100;
    this.hardDropScore = params.hardDropScore ?? 2;
  }

  // ── IGridBehavior: a manual move on the active piece (the scene's move seam) ──

  /**
   * Resolve one MANUAL move intent against the live board + active piece. Returns the
   * composited grid (settled cells + the active piece) so the scene's applyMove path
   * paints it. PURE w.r.t. its `grid` argument (the engine state lives on the active
   * piece, not the passed grid):
   *   left/right -> shift · up -> rotate (CW) · down -> soft-drop one cell ·
   *   hold       -> swap active <-> held (once per drop)               [emit piece.held]
   *   harddrop   -> drop to the ghost row + lock there                 [emit piece.hardDropped]
   * Unknown intent / no active piece -> a no-op (changed:false).
   */
  resolve(grid: Grid, intent: string): GridMoveResult {
    const settled = grid.map((r) => r.slice());
    if (!this.active) {
      return { grid: settled, changed: false, scoreDelta: 0 };
    }
    let changed = false;
    let scoreDelta = 0;
    if (intent === 'left') changed = this.tryShift(settled, 0, -1);
    else if (intent === 'right') changed = this.tryShift(settled, 0, 1);
    else if (intent === 'up') changed = this.tryRotate(settled);
    else if (intent === 'down') {
      this.softDropping = true;
      changed = this.tryShift(settled, 1, 0); // one soft-drop step now
    } else if (intent === 'hold') {
      changed = this.tryHold(settled);
    } else if (intent === 'harddrop') {
      scoreDelta = this.hardDrop(settled);
      changed = true;
    }
    // Recompose the board for the renderer: settled cells + the active piece painted in.
    return { grid: this.compose(settled), changed, scoreDelta };
  }

  // ── HOLD: swap the active piece with the hold slot (once per drop) ─────────────

  /**
   * Park the active piece in the hold slot and pull out the held tetromino (or the
   * next bag piece on the first hold), re-spawning it at the top in spawn orientation.
   * GUARDED once-per-drop by `holdUsed` (cleared on the next natural spawn) so hold is
   * a deliberate stash, not a free re-roll. Emits piece.held at the swap seam.
   * Returns true iff the swap happened (a second hold this drop is a no-op).
   */
  private tryHold(settled: Grid): boolean {
    if (this.holdUsed || !this.active) return false;
    const outgoing = this.active.tetromino;
    const incoming = this.held ?? TETROMINOES[this.nextFromBag()];
    this.held = outgoing;
    this.holdUsed = true;

    const placed = this.spawnSpecific(settled, incoming);
    // piece.held — the active piece moved to the hold slot; the held piece is now active.
    this.bus.emit('piece.held', {
      heldId: outgoing.id, // the piece now parked in the hold slot
      activeId: incoming.id, // the piece now in play (pulled from hold/bag)
      swapped: placed,
    });
    return placed;
  }

  // ── HARD-DROP: slam to the ghost row + lock there ─────────────────────────────

  /**
   * Slam the active piece straight down to the GHOST-PREVIEW row (the lowest row it can
   * legally occupy in its current column) and LOCK it there immediately — no gravity
   * tick, no lock delay. The ghost preview IS the landing row, so this is "lock at the
   * ghost." Emits piece.hardDropped, then runs the standard line-clear + next spawn via
   * lockActive(). Returns the score gained (a hard-drop bonus + any line-clear score).
   */
  private hardDrop(settled: Grid): number {
    const piece = this.active!;
    const ghostRow = this.ghostRow(settled, piece);
    const fell = Math.max(0, ghostRow - piece.row);
    piece.row = ghostRow; // snap to the ghost-preview position

    // piece.hardDropped — the piece reached the ghost row and is about to lock there.
    this.bus.emit('piece.hardDropped', {
      pieceId: piece.tetromino.id,
      landingRow: ghostRow,
      cellsFell: fell,
    });

    const bonus = fell * this.hardDropScore;
    // Lock at the ghost (write cells, clear lines, spawn next). Returns line-clear score.
    const lineGain = this.lockActive(settled);
    return bonus + lineGain;
  }

  /** The ghost row: the lowest origin-row the active piece can legally occupy now. */
  private ghostRow(board: Grid, piece: ActivePiece): number {
    const offsets = piece.tetromino.rotations[piece.state];
    let r = piece.row;
    while (this.canPlace(board, offsets, r + 1, piece.col)) r += 1;
    return r;
  }

  // ── scene attachment + the gravity engine (the emit side) ─────────────────────

  /**
   * Bind to the scene: take its real EventBus so piece.held / piece.hardDropped land on
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
    this.held = null;
    this.holdUsed = false;
    this.bag = [];
    this.fallAccum = 0;
    this.lockTimer = -1;
    this.softDropping = false;
  }

  /**
   * The gravity tick — call once per frame with the elapsed ms (the scene drives this
   * from update()). Accumulates toward a gravity drop; when the piece can fall no
   * further, runs the lock-delay; on lock, settles the piece + clears any full rows,
   * then spawns the next piece. (hold + hard-drop are player-driven via resolve().)
   */
  update(dtMs: number): void {
    if (!this.scene || this.scene.gameCompleted) return;
    const board: Grid = this.scene.board?.snapshot?.();
    if (!board || !this.active) return;

    const interval = this.softDropping ? this.softDropMs : this.gravityMs;
    this.fallAccum += dtMs;
    this.softDropping = false; // soft-drop is per-frame; the scheme re-asserts it on hold

    while (this.fallAccum >= interval) {
      this.fallAccum -= interval;
      if (this.canPlace(board, this.active.tetromino.rotations[this.active.state], this.active.row + 1, this.active.col)) {
        this.active.row += 1;
        this.lockTimer = -1; // moved down -> airborne again, reset the lock timer
      } else if (this.lockTimer < 0) {
        this.lockTimer = 0; // resting on a surface — start the lock-delay
      }
    }

    // Lock-delay: once resting, count ms; lock when the delay elapses.
    if (this.lockTimer >= 0) {
      this.lockTimer += dtMs;
      if (this.lockTimer >= this.lockDelayMs) {
        this.lockActive(board);
        this.scene.board.setGrid(board);
        this.scene.refreshAfterGravity?.();
      }
    }
  }

  // ── the lock + line-clear seam (shared by gravity-lock and hard-drop) ─────────

  /**
   * Settle the active piece into `board`, clear+collapse full rows, then spawn the
   * next piece. Returns the line-clear score gained. Used by BOTH the gravity lock
   * (update) and the hard-drop (resolve). When a scene is attached it also banks the
   * cleared-line score onto the scene registry.
   */
  private lockActive(board: Grid): number {
    const piece = this.active;
    if (!piece) return 0;
    const cells = this.absoluteCells(piece.tetromino.rotations[piece.state], piece.row, piece.col);
    for (const [r, c] of cells) {
      if (r >= 0 && r < board.length && c >= 0 && c < (board[0]?.length ?? 0)) {
        board[r][c] = piece.tetromino.id;
      }
    }
    this.active = null;
    this.lockTimer = -1;
    this.fallAccum = 0;

    const cleared = this.clearFullRows(board);
    let gained = 0;
    if (cleared > 0) {
      gained = this.lineScore * cleared * cleared; // n-row bonus (1,4,9,16 ×)
      if (this.scene) {
        const score = ((this.scene.registry?.get?.('score') as number) ?? 0) + gained;
        this.scene.registry?.set?.('score', score);
      }
    }
    this.spawnPiece(board);
    return gained;
  }

  /**
   * Remove every full row and collapse the rows above into the gap. Mutates `board` in
   * place; returns how many rows were cleared.
   */
  private clearFullRows(board: Grid): number {
    const cols = board[0]?.length ?? 0;
    const kept: number[][] = [];
    let cleared = 0;
    for (let r = board.length - 1; r >= 0; r -= 1) {
      if (board[r].every((v) => v !== 0)) cleared += 1;
      else kept.push(board[r].slice());
    }
    if (cleared === 0) return 0;
    const rebuilt: number[][] = [];
    for (let i = 0; i < cleared; i += 1) rebuilt.push(new Array(cols).fill(0));
    for (let i = kept.length - 1; i >= 0; i -= 1) rebuilt.push(kept[i]);
    for (let r = 0; r < board.length; r += 1) board[r] = rebuilt[r];
    return cleared;
  }

  // ── piece spawning (the 7-bag randomizer) ─────────────────────────────────────

  /** Spawn the next bag tetromino at top-center; clears the once-per-drop hold latch. */
  private spawnPiece(board?: Grid): void {
    const b: Grid = board ?? this.scene?.board?.snapshot?.();
    if (!b) return;
    this.holdUsed = false; // a fresh drop re-arms hold
    this.spawnSpecific(b, TETROMINOES[this.nextFromBag()]);
  }

  /**
   * Spawn a SPECIFIC tetromino at the top-center in spawn orientation (used by both the
   * bag spawn and the hold swap). If it cannot be placed the board has topped out ->
   * the game is over. Returns true iff the piece was placed.
   */
  private spawnSpecific(board: Grid, tetromino: Tetromino): boolean {
    const cols = board[0]?.length ?? 10;
    const col = Math.max(0, Math.floor((cols - 4) / 2));
    if (!this.canPlace(board, tetromino.rotations[0], 0, col)) {
      this.active = null;
      this.scene?.lose?.();
      return false;
    }
    this.active = { tetromino, state: 0, row: 0, col };
    this.lockTimer = -1;
    this.fallAccum = 0;
    return true;
  }

  /** The 7-bag: yields each of the 7 tetrominoes once before any repeats (refill on empty). */
  private nextFromBag(): number {
    if (this.bag.length === 0) {
      this.bag = [0, 1, 2, 3, 4, 5, 6];
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

  /** Try to rotate CW (a simple in-place rotate; falls back to no-op if blocked). */
  private tryRotate(settled: Grid): boolean {
    const p = this.active!;
    if (p.tetromino.id === 4) return false; // O never rotates meaningfully
    const next = (p.state + 1) % 4;
    if (this.canPlace(settled, p.tetromino.rotations[next], p.row, p.col)) {
      p.state = next;
      return true;
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
      if (r >= 0 && r < out.length && c >= 0 && c < (out[0]?.length ?? 0)) {
        out[r][c] = this.active.tetromino.id;
      }
    }
    return out;
  }

  // ── component surface (the declared event set this behavior publishes) ────────

  /**
   * The component surface for the hold + ghost-hard-drop rule. Each EventDecl is a TRUE
   * statement about a real .emit() site in this file:
   *   - piece.held        <- tryHold()  (the active <-> held swap, once per drop)  [archetype]
   *   - piece.hardDropped <- hardDrop()  (slam to the ghost row + lock there)      [archetype]
   * (The standard board moments — board.moved / score.changed / level.statusChanged —
   * are owned by DataGridScene.surface(); this rule adds the two hold/hard-drop moments.)
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'piece.held',
          payload: '{heldId,activeId,swapped}',
          scope: 'archetype',
          drivenBy: 'press hold',
          expect: '__GAME__ active and held piece swap; piece.held logged',
        },
        {
          name: 'piece.hardDropped',
          payload: '{pieceId,landingRow,cellsFell}',
          scope: 'archetype',
          drivenBy: 'press hard-drop',
          expect: '__GAME__ the piece locks at the ghost position; piece.hardDropped logged',
        },
      ],
    };
  }
}
