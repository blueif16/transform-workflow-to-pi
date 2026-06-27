/**
 * UndoMove — the sokoban move-history UNDO system (BUILD — system).
 *
 * The box-push genre's "take-back": pressing undo reverts the LAST resolved move —
 * the player AND any box it pushed — to the exact board state that preceded it. In a
 * sokoban puzzle a single wrong push can corner-lock a box into an unwinnable state
 * (see BoxPush.isDeadlocked), so a one-key revert is the difference between a
 * frustrating restart and a thinking-game; this is the canonical box-push affordance.
 *
 * SELF-CONTAINED move-history stack (NOT a read of the rule's private history): this
 * system keeps its OWN bounded stack of board SNAPSHOTS. Because the grid_logic board
 * is the single source of truth (the two-worlds rule — a `cell[row][col]` integer
 * array that encodes the player cell, every box, and every goal), one snapshot IS the
 * complete record of a turn; reverting is a single `board.setGrid(prior)` + re-derive.
 * It works for ANY board move rule (sokoban today, merge-slide tomorrow), because it
 * snapshots the resolved grid, not the rule's internals.
 *
 * It is a peer of MergeSlideGoal / TurnDuel — a kind=system bound by id into the
 * scene's systems[] and lifecycled by DataGridScene (reset()/attach()/onMove()). It
 * reuses ONLY the engine-owned seams it MUST share: the scene's board (snapshot/setGrid),
 * the shared eventBus (the PUSH channel), the scene's input (the undo key), and the
 * scene's re-derive seams (refreshCursor/paintTiles) so the cursor + sprites follow
 * the reverted logical board.
 *
 * THE STACK DISCIPLINE (how the history is built + popped):
 *   attach()      -> push the INITIAL board snapshot (the stack base, never popped).
 *   onMove()      -> a changed move resolved; push the new CURRENT board snapshot.
 *   undo (press)  -> if there is a move to take back (stack length > 1): pop the
 *                    current snapshot, setGrid() the now-top (the PRIOR state),
 *                    re-derive the cursor + repaint, roll moveCount back one, and
 *                    emit 'move.undone'. With only the base snapshot left it is a
 *                    no-op (nothing to undo).
 *
 * OBSERVABLE __GAME__ effect (the stub-killer transition): an undo rewrites
 * scene.board to the prior grid, so board.snapshot() (which the hook + verify read)
 * reverts cell-for-cell — the pushed box slides back, the player steps back, and the
 * board cursor (scene.player.gridX/gridY, the highest cell the hook tracks) re-derives
 * to the prior position. The 'move.undone' event carries the restored move index.
 *
 * GENERIC: no game/theme/board size is encoded. The undo key bindings + the history
 * depth are read from params with sensible declared defaults, never a per-game literal.
 *
 * Params (all OPTIONAL — declared defaults below):
 *   undoKeys     Phaser key names that trigger an undo. Default: ['U', 'Z'].
 *   historyLimit max snapshots kept in the stack (bounds memory). Default: 128.
 */
import type { IGridSystem } from '../scenes/grid-data';
import type { Grid } from '../board/GridBoard';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry reads this — globbed by registry/discover.mjs). */
export const CAPABILITY = {
  kind: 'system',
  id: 'UndoMove',
  intent:
    'Move-history UNDO for the box-push genre: pressing undo reverts the last resolved move (the player AND any box it pushed) to the exact prior board state. A self-contained bounded stack of board snapshots; reverting is a single board.setGrid(prior) + cursor re-derive. Drives board.snapshot() back cell-for-cell.',
  attachesTo: 'scene',
  params: ['undoKeys', 'historyLimit'],
  roles: ['board'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** Default keys that trigger an undo (the classic take-back keys). */
const DEFAULT_UNDO_KEYS = ['U', 'Z'] as const;
/** Default cap on the snapshot stack (bounds memory; deep histories truncate the oldest). */
const DEFAULT_HISTORY_LIMIT = 128;

export interface UndoMoveConfig {
  /** Phaser key names that trigger an undo (default ['U','Z']). */
  undoKeys?: string[];
  /** Max snapshots kept in the stack (default 128). */
  historyLimit?: number;
}

export class UndoMove implements IGridSystem {
  /** The owning scene (set by attach) — the route to board / bus / input / re-derive. */
  private scene: any = null;

  // ── declared config (sensible defaults; NEVER fabricated per-game) ──
  private readonly undoKeys: string[];
  private readonly historyLimit: number;

  /**
   * The self-contained move-history stack: a bounded list of board SNAPSHOTS, oldest
   * first. The first entry is the initial board (the base, never popped); each changed
   * move appends the resolved grid. The top is always the CURRENT board state.
   */
  private history: Grid[] = [];

  /** The shared event bus, resolved from the attached scene. Publish via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  constructor(params: UndoMoveConfig = {}) {
    const keys = Array.isArray(params.undoKeys) && params.undoKeys.length > 0
      ? params.undoKeys.filter((k) => typeof k === 'string' && k.length > 0)
      : [...DEFAULT_UNDO_KEYS];
    this.undoKeys = keys.length > 0 ? keys : [...DEFAULT_UNDO_KEYS];
    const lim = Math.floor(params.historyLimit ?? DEFAULT_HISTORY_LIMIT);
    this.historyLimit = lim > 0 ? lim : DEFAULT_HISTORY_LIMIT;
  }

  /** Re-arm for a fresh level / restart: clear the snapshot stack (re-seeded in attach). */
  reset(): void {
    this.history = [];
  }

  attach(scene: any): void {
    this.scene = scene;

    // Seed the stack with the INITIAL board (the base snapshot; the player starts here).
    if (scene.board?.snapshot) this.history = [scene.board.snapshot()];

    // Wire each undo key on the DOWN edge (mirrors DataGridScene.setupInputs: addKey
    // by code, then a 'down' handler — one undo per physical press, no auto-repeat).
    const kb = scene.input?.keyboard;
    const KC: Record<string, number> | undefined =
      kb?.constructor?.KeyCodes ?? scene.input?.keyboard?.KeyCodes;
    if (kb?.addKey) {
      for (const keyName of this.undoKeys) {
        // Resolve the key code from the Phaser KeyCodes table when available; fall back
        // to letting addKey accept the name string directly (Phaser supports both).
        const code = KC ? KC[keyName] : undefined;
        const keyObj = code !== undefined ? kb.addKey(code) : kb.addKey(keyName);
        keyObj?.on?.('down', () => this.undo());
      }
    }
  }

  /**
   * The scene calls this AFTER every resolved move that CHANGED the board (a no-op
   * move never reaches here). Push the new CURRENT board snapshot onto the stack so
   * the move can be taken back.
   */
  onMove(info: { changed: boolean; scoreDelta: number; intent: string }): void {
    if (!info?.changed) return; // defensive: only changed moves are takeable-back
    const snap = this.scene?.board?.snapshot?.();
    if (!snap) return;
    this.history.push(snap);
    while (this.history.length > this.historyLimit) this.history.shift();
  }

  /**
   * Take back the last move (PUBLIC so a headless harness can drive it directly — the
   * same path the key handler calls). With only the base snapshot left there is nothing
   * to undo (a no-op). Otherwise pop the current state, restore the PRIOR grid into the
   * shared board, re-derive the cursor + repaint, roll the move counter back, and emit
   * 'move.undone' — the board reverts cell-for-cell (player + any pushed box).
   */
  public undo(): void {
    const scene = this.scene;
    if (!scene || this.history.length <= 1) return; // base only -> nothing to revert

    // Pop the current state; the new top is the board as it was BEFORE the last move.
    this.history.pop();
    const prior = this.history[this.history.length - 1];

    // Swap the prior grid back into the single source of truth, then sync the two worlds.
    scene.board?.setGrid?.(prior);
    scene.refreshCursor?.();
    scene.paintTiles?.();

    // Roll the move counter back one (never below zero) so __GAME__.moveCount reverts too.
    if (typeof scene.moveCount === 'number') {
      scene.moveCount = Math.max(0, scene.moveCount - 1);
    }

    // move.undone — the board reverted to the prior state (the observable seam). LEAN payload.
    this.bus?.emit('move.undone', {
      moveCount: typeof scene.moveCount === 'number' ? scene.moveCount : 0,
      depth: this.history.length - 1,
    });
  }

  // ── component surface (the declared event set this system publishes) ──────────

  /**
   * The component surface for the undo system. Each EventDecl is a TRUE statement
   * about a real .emit() site in this file:
   *   - move.undone <- undo() when the last move is reverted  [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'move.undone',
          payload: '{moveCount,depth}',
          scope: 'archetype',
          drivenBy: 'the player presses undo',
          expect:
            '__GAME__ board (board.snapshot) reverts to the prior state — the player + any pushed box step back; move.undone logged',
        },
      ],
    };
  }
}
