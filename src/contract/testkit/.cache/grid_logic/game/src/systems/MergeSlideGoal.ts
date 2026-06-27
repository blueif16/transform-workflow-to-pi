/**
 * MergeSlideGoal — the merge-slide WIN/LOSE system (BUILD — system; INV-4/INV-5).
 *
 * The merge-slide win/lose owner: after each resolved move it RE-DERIVES the
 * outcome from the LIVE board — win (status->'won') the moment any tile reaches the
 * blueprint's `winTarget` (INV-4), lose (status->'lost') the moment the board is
 * EXACTLY game-over (no empty cell AND no orthogonally-adjacent equal pair, INV-5).
 * It is the grid analogue of top_down's KillAllGoal (a pure win/lose owner bound by
 * id from blueprint.systems[]) — re-implementing NOTHING the engine owns: the win/
 * lose seam is DataGridScene.win()/lose() (which set the registry status); the live
 * board is scene.board.
 *
 * Drives ONE observable: __GAME__.status (-> 'won' | 'lost'). Each move it
 * re-derives the outcome (not latched until it actually fires), so a level RESTART
 * re-arms cleanly. GENERIC: the target is read from the scene's level data, never
 * hard-coded; no per-game value is encoded.
 *
 * Params (all OPTIONAL):
 *   winTarget  override the board's winTarget (else the scene's grid.winTarget; a
 *              maze/level table can re-tune the win per system binding). default: use
 *              the level data's value.
 */
import { hasReachedTarget, isGameOver } from '../board/MergeSlideResolver';
import type { IGridSystem } from '../scenes/grid-data';

/** CAPABILITY sidecar (the registry reads this — mirrors top_down system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'MergeSlideGoal',
  intent:
    'Win (status->won) when any tile reaches the winTarget (INV-4); lose (status->lost) when the board is exactly game-over — no empty cell and no adjacent equal pair (INV-5). Re-derived from the live board each move.',
  attachesTo: 'scene',
  params: ['winTarget'],
  roles: ['board'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface MergeSlideGoalConfig {
  /** Override the board's win target value (else the level data's grid.winTarget). */
  winTarget?: number;
}

export class MergeSlideGoal implements IGridSystem {
  private scene: any;
  private settled = false;
  private readonly winTargetOverride?: number;

  constructor(params: MergeSlideGoalConfig = {}) {
    this.winTargetOverride =
      typeof params.winTarget === 'number' ? params.winTarget : undefined;
  }

  reset(): void {
    // Clear the one-shot outcome latch so a restarted level is genuinely replayable.
    this.settled = false;
  }

  attach(scene: any): void {
    this.scene = scene;
  }

  /** The core moment: after each resolved move, re-derive win/lose from the board. */
  onMove(_info: { changed: boolean; scoreDelta: number; intent: string }): void {
    this.evaluate();
  }

  private evaluate(): void {
    const scene = this.scene;
    if (!scene || this.settled || scene.gameCompleted) return;
    const grid = scene.board?.snapshot?.();
    if (!grid) return;
    const target = this.winTargetOverride ?? scene.winTarget ?? 2048;

    // INV-4 — win when a tile reaches the target.
    if (hasReachedTarget(grid, target)) {
      this.settled = true;
      scene.win?.();
      return;
    }
    // INV-5 — lose ONLY on the exact game-over (a full board with an adjacent equal
    // pair is NOT over). The board can still merge until isGameOver is true.
    if (isGameOver(grid)) {
      this.settled = true;
      scene.lose?.();
    }
  }
}
