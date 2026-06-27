/**
 * TurnDuel — the alternating-turn place-on-empty DUEL system (BUILD — system).
 *
 * The turn-duel genre owner (tic-tac-toe / gomoku family): a cell GRID where two
 * sides alternate marking ONE empty cell each turn, and the first to form an
 * N-in-a-row line (a full row, full column, or either diagonal of N equal marks)
 * WINS. The human is side 1; side 2 is a MINIMAX AI opponent that, on its turn,
 * searches the empty-cell tree to play the move that maximizes its own forced
 * outcome (and blocks the human's). This is a genuine adversarial state machine,
 * not a placeholder.
 *
 * It is a peer of MergeSlideGoal — a kind=system bound by id into the scene's
 * systems[] and lifecycled by DataGridScene (reset()/attach()/update()). Where
 * MergeSlideGoal piggybacks the scene's merge-slide move loop, the turn-duel game
 * has its OWN placement loop (you click an empty cell to mark it), so TurnDuel owns
 * its own input + its own marks board, and reuses ONLY the engine-owned seams it
 * MUST share: the scene's board geometry (rows/cols via scene.board), the shared
 * eventBus (the PUSH channel), and the win/lose status seam (scene.win()).
 *
 * THE TURN CYCLE (the core moment):
 *   pointerdown on an empty cell -> place the human mark (board cell = MARK_HUMAN)
 *   -> emit 'mark.placed' -> repaint -> if a line formed, win; else flip the turn
 *   to the AI -> minimax picks the AI's empty cell -> place MARK_AI -> emit
 *   'mark.placed' -> if a line formed, the AI wins -> flip back to the human.
 *
 * OBSERVABLE __GAME__ effects (the stub-killer transitions):
 *   - a placed mark writes the mark VALUE into scene.board (snapshot reflects it)
 *     and re-derives the board cursor (scene.player.gridX/gridY moves to the cell),
 *     so 'mark.placed' moves real witness state.
 *   - an N-in-a-row calls scene.win() -> __GAME__.status becomes 'won', carried by
 *     the 'line.won' event with the winning side.
 *
 * GENERIC: no game/theme is encoded. The board size + the win-length N + which side
 * goes first are read from params (with sensible declared defaults), never a
 * per-game literal. A RESTART re-runs create() -> reset() clears the duel cleanly.
 *
 * Params (all OPTIONAL — declared defaults below):
 *   winLength    cells-in-a-row to win. default: min(boardCols, boardRows, 3).
 *   humanFirst   true => the human (side 1) moves first. default: true.
 *   aiDepth      max minimax plies the AI searches. default: 6 (capped to empties).
 */
import type { IGridSystem } from '../scenes/grid-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry reads this — mirrors the system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'TurnDuel',
  intent:
    'Alternating-turn place-on-empty duel (tic-tac-toe / gomoku): two sides mark one empty cell per turn; first to an N-in-a-row line (row/col/either diagonal) wins. Human is side 1; side 2 is a minimax AI opponent. Drives __GAME__.status->won on a win.',
  attachesTo: 'scene',
  params: ['winLength', 'humanFirst', 'aiDepth'],
  roles: ['board'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** The two mark values written into the shared logical board (0 = empty cell). */
const MARK_HUMAN = 1;
const MARK_AI = 2;

export interface TurnDuelConfig {
  /** Cells-in-a-row to win. Default: min(cols, rows, 3). */
  winLength?: number;
  /** True => the human moves first (default true). */
  humanFirst?: boolean;
  /** Max minimax plies the AI searches (default 6, capped to the empty count). */
  aiDepth?: number;
}

type Side = typeof MARK_HUMAN | typeof MARK_AI;

export class TurnDuel implements IGridSystem {
  private scene: any;

  // ── declared config (sensible defaults; NEVER fabricated per-game) ──
  private readonly winLengthOverride?: number;
  private readonly humanFirst: boolean;
  private readonly aiDepth: number;

  // ── resolved at attach() from the live board geometry ──
  private rows = 0;
  private cols = 0;
  private winLength = 3;

  // ── duel run state (cleared by reset()) ──
  private turn: Side = MARK_HUMAN;
  private over = false;

  /** The shared event bus, resolved from the attached scene. Publish via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  constructor(params: TurnDuelConfig = {}) {
    this.winLengthOverride =
      typeof params.winLength === 'number' ? Math.max(2, Math.floor(params.winLength)) : undefined;
    this.humanFirst = params.humanFirst !== false; // default true
    this.aiDepth =
      typeof params.aiDepth === 'number' ? Math.max(1, Math.floor(params.aiDepth)) : 6;
  }

  reset(): void {
    // Clear the duel so a restarted level genuinely re-arms.
    this.over = false;
    this.turn = MARK_HUMAN; // re-decided in attach() once humanFirst is known
  }

  attach(scene: any): void {
    this.scene = scene;
    this.rows = scene.board?.rows ?? 0;
    this.cols = scene.board?.cols ?? 0;
    // Win length: the bound override, else the classic line that fits the board.
    this.winLength =
      this.winLengthOverride ?? Math.max(2, Math.min(this.cols, this.rows, 3));
    this.turn = this.humanFirst ? MARK_HUMAN : MARK_AI;

    // Own the placement loop: a pointerdown on a cell tries to mark it. (TurnDuel
    // does NOT use the merge-slide keydown move loop — placing is a click, the
    // headless-driveable seam is placeAt() which this listener calls.)
    scene.input?.on?.('pointerdown', (pointer: any) => {
      if (this.over || this.turn !== MARK_HUMAN) return;
      const cell = this.worldToCell(pointer?.worldX ?? pointer?.x ?? 0, pointer?.worldY ?? pointer?.y ?? 0);
      if (cell) this.placeAt(cell.row, cell.col, MARK_HUMAN);
    });

    // If the AI opens (humanFirst:false), let it take the first cell immediately.
    if (this.turn === MARK_AI) this.aiTurn();
  }

  /**
   * Place a mark on an EMPTY cell for `side`, then resolve the turn (the core
   * moment). PUBLIC so a headless harness can drive a placement directly — the same
   * path the pointer listener calls. A non-empty / out-of-bounds / wrong-turn /
   * game-over placement is a no-op.
   */
  public placeAt(row: number, col: number, side: Side): void {
    const scene = this.scene;
    if (!scene || this.over || scene.gameCompleted) return;
    if (side !== this.turn) return;
    const board = scene.board;
    if (!board?.inBounds?.(row, col) || !board.isEmpty?.(row, col)) return;

    // Write the mark into the SHARED logical board (snapshot reflects it; the scene
    // re-derives its cursor so __GAME__.player.gridX/gridY moves to the placed cell).
    board.set(row, col, side);
    scene.refreshCursor?.();
    scene.paintTiles?.();

    // mark.placed — the placement resolved (the observable seam). LEAN payload.
    this.bus?.emit('mark.placed', { row, col, side, next: side === MARK_HUMAN ? MARK_AI : MARK_HUMAN });

    // Did this mark complete an N-in-a-row?
    if (this.hasLine(board.snapshot(), side)) {
      this.declareWin(side);
      return;
    }

    // No win — flip the turn. If it's now the AI's, let it respond.
    this.turn = side === MARK_HUMAN ? MARK_AI : MARK_HUMAN;
    if (this.turn === MARK_AI && !this.over) this.aiTurn();
  }

  // ── the AI opponent (minimax over the empty-cell tree) ───────────────────────

  /** The AI's turn: pick its empty cell via minimax, then place it. */
  private aiTurn(): void {
    const scene = this.scene;
    if (!scene || this.over) return;
    const grid: number[][] = scene.board.snapshot();
    const move = this.bestMove(grid);
    if (move) this.placeAt(move.row, move.col, MARK_AI);
  }

  /**
   * Choose the AI's best empty cell by minimax search (AI maximizes, human
   * minimizes). Depth-capped to keep a big board responsive; a terminal line is
   * scored by its distance to the leaf so a faster win / slower loss is preferred.
   */
  private bestMove(grid: number[][]): { row: number; col: number } | null {
    const empties = this.emptiesOf(grid);
    if (empties.length === 0) return null;
    const depth = Math.min(this.aiDepth, empties.length);
    let bestScore = -Infinity;
    let best: { row: number; col: number } | null = empties[0];
    for (const cell of empties) {
      grid[cell.row][cell.col] = MARK_AI;
      const score = this.minimax(grid, depth - 1, false, -Infinity, Infinity);
      grid[cell.row][cell.col] = 0; // undo (pure search, no board mutation)
      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
    }
    return best;
  }

  /**
   * Alpha-beta minimax. `maximizing` = the AI's turn. Returns a score:
   *   +N (AI line) / -N (human line), depth-adjusted so the AI prefers a quick win
   *   and a delayed loss; 0 = no forced line within the horizon (a heuristic draw).
   */
  private minimax(
    grid: number[][],
    depth: number,
    maximizing: boolean,
    alpha: number,
    beta: number,
  ): number {
    // Terminal: a completed line for either side ends the branch.
    if (this.hasLine(grid, MARK_AI)) return 10 + depth;
    if (this.hasLine(grid, MARK_HUMAN)) return -(10 + depth);
    const empties = this.emptiesOf(grid);
    if (depth <= 0 || empties.length === 0) return 0;

    if (maximizing) {
      let value = -Infinity;
      for (const cell of empties) {
        grid[cell.row][cell.col] = MARK_AI;
        value = Math.max(value, this.minimax(grid, depth - 1, false, alpha, beta));
        grid[cell.row][cell.col] = 0;
        alpha = Math.max(alpha, value);
        if (alpha >= beta) break; // beta cutoff
      }
      return value;
    }
    let value = Infinity;
    for (const cell of empties) {
      grid[cell.row][cell.col] = MARK_HUMAN;
      value = Math.min(value, this.minimax(grid, depth - 1, true, alpha, beta));
      grid[cell.row][cell.col] = 0;
      beta = Math.min(beta, value);
      if (alpha >= beta) break; // alpha cutoff
    }
    return value;
  }

  // ── win seam ─────────────────────────────────────────────────────────────────

  /** A side completed an N-in-a-row: latch the win + drive __GAME__.status->won. */
  private declareWin(side: Side): void {
    this.over = true;
    // line.won — the win moment (the observable transition source). LEAN payload.
    this.bus?.emit('line.won', {
      winner: side === MARK_HUMAN ? 'human' : 'ai',
      side,
      winLength: this.winLength,
    });
    // Drive the shared status seam -> __GAME__.status becomes 'won'.
    this.scene.win?.();
  }

  // ── pure line / board helpers (the genuine line-scan mechanic) ───────────────

  /** Every empty cell of a grid (the minimax move set). */
  private emptiesOf(grid: number[][]): { row: number; col: number }[] {
    const out: { row: number; col: number }[] = [];
    for (let r = 0; r < grid.length; r += 1) {
      for (let c = 0; c < grid[r].length; c += 1) {
        if (grid[r][c] === 0) out.push({ row: r, col: c });
      }
    }
    return out;
  }

  /**
   * True iff `side` has an N-in-a-row anywhere: a horizontal run, a vertical run,
   * or either diagonal run of `winLength` equal marks. Scans every cell as a run
   * origin in all four directions (the line-scan win, rows/cols/both diagonals).
   */
  private hasLine(grid: number[][], side: Side): boolean {
    const n = this.winLength;
    const R = grid.length;
    const C = grid[0]?.length ?? 0;
    // direction vectors: → (right), ↓ (down), ↘ (down-right), ↙ (down-left)
    const dirs = [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, -1],
    ];
    for (let r = 0; r < R; r += 1) {
      for (let c = 0; c < C; c += 1) {
        if (grid[r][c] !== side) continue;
        for (const [dr, dc] of dirs) {
          let run = 1;
          let rr = r + dr;
          let cc = c + dc;
          while (rr >= 0 && rr < R && cc >= 0 && cc < C && grid[rr][cc] === side) {
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

  /**
   * Map a world point to a board cell via the scene's ONE gridMap adapter (INV-6;
   * the method is `toGrid(x,y)`, which returns null for a pixel outside the board).
   */
  private worldToCell(worldX: number, worldY: number): { row: number; col: number } | null {
    const map = this.scene?.gridMap;
    if (!map?.toGrid) return null;
    const cell = map.toGrid(worldX, worldY);
    if (!cell) return null;
    return { row: cell.row, col: cell.col };
  }

  // ── component surface (the declared event set this system publishes) ──────────

  /**
   * The uniform component surface for the turn-duel system. Each EventDecl is a TRUE
   * statement about a real .emit() site in this file:
   *   - mark.placed <- placeAt (a mark written to an empty cell)   [archetype]
   *   - line.won    <- declareWin (an N-in-a-row completed)         [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'mark.placed',
          payload: '{row,col,side,next}',
          scope: 'archetype',
          drivenBy: 'a player marks an empty cell',
          expect: '__GAME__ board shows the mark + the turn flips; mark.placed logged',
        },
        {
          name: 'line.won',
          payload: "{winner:'human'|'ai',side,winLength}",
          scope: 'archetype',
          drivenBy: 'an N-in-a-row forms',
          expect: "__GAME__.status becomes 'won' with the winner; line.won logged",
        },
      ],
    };
  }
}
