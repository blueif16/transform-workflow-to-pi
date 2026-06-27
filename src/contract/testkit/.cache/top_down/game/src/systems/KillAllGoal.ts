/**
 * KillAllGoal — win when every enemy is dead (BUILD — system, RB §1/§2.5).
 *
 * The twin-stick / arena win: status -> 'won' once NO enemy remains AND no more
 * enemies are pending. It is the top-down analogue of platformer's GoalReach
 * (a pure-completion win owned by a kind=system, bound by id from
 * blueprint.systems[]) — re-implementing NOTHING the engine owns: the win seam is
 * BaseGameScene.onLevelComplete (status:'won'); the live enemy set is scene.enemies.
 *
 * Drives ONE observable: __GAME__.status (-> 'won'). Each frame it RE-DERIVES the
 * win from the LIVE world — not latched until it actually fires — so a level
 * RESTART re-arms cleanly. It coordinates with a WaveSpawner when present: a wave
 * arena is NOT won the instant a wave is cleared; it is won only when the spawner
 * reports it has no more waves to release (scene.__waveSpawner?.isExhausted()). With
 * no spawner it is a plain "kill every placed enemy" win.
 *
 * GATING the engine's default: BaseGameScene.checkWinCondition() also fires
 * onLevelComplete when all enemies die. That is correct for a single placed wave
 * but WRONG mid-escalation (clearing wave 1 must not win). So this system sets
 * scene.suppressDefaultWin = true while it owns the win, and fires the win itself —
 * the single authority. Generic: no per-game count or coordinate is encoded.
 *
 * Params (all OPTIONAL):
 *   requireAtLeastOne  when true (default), a level that spawned ZERO enemies never
 *                      auto-wins (an empty arena is not "all cleared"). Set false to
 *                      win immediately on an empty enemy set (rare).
 *   winEffectEvent     event fired via scene.fireEffect on the win (default 'level.won').
 */
import type { ISceneSystem } from '../scenes/topdown-data';

/** CAPABILITY sidecar (M3 registry reads this — mirrors platformer system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'KillAllGoal',
  intent:
    'Win (status->won) once every enemy is dead and no more are pending; coordinates with WaveSpawner so an arena wins only after the final wave is cleared.',
  attachesTo: 'scene',
  params: ['requireAtLeastOne', 'winEffectEvent'],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface KillAllGoalConfig {
  /** Never auto-win on an empty enemy set (default true). */
  requireAtLeastOne?: boolean;
  /** Event fired via scene.fireEffect on the win (default 'level.won'). */
  winEffectEvent?: string;
}

export class KillAllGoal implements ISceneSystem {
  private scene: any;
  private won = false;
  private readonly requireAtLeastOne: boolean;
  private readonly winEffectEvent: string;
  /** Did the world ever hold an enemy this run (so an empty set means CLEARED, not "never started"). */
  private everHadEnemy = false;

  constructor(params: KillAllGoalConfig = {}) {
    this.requireAtLeastOne = params.requireAtLeastOne ?? true;
    this.winEffectEvent = params.winEffectEvent ?? 'level.won';
  }

  reset(): void {
    // Clear the one-shot win latch so a restarted level is genuinely replayable.
    this.won = false;
    this.everHadEnemy = false;
  }

  attach(scene: any): void {
    this.scene = scene;
    // Take ownership of the win: suppress the engine's default all-enemies-dead
    // check (which would win the instant a wave clears mid-escalation).
    scene.suppressDefaultWin = true;
  }

  update(): void {
    const scene = this.scene;
    if (!scene || this.won || scene.gameCompleted) return;

    const alive = this.aliveEnemyCount();
    if (alive > 0) {
      this.everHadEnemy = true;
      return;
    }

    // No live enemy. If a spawner still has waves to release, it is NOT a win yet.
    const spawner = scene.__waveSpawner;
    if (spawner && typeof spawner.isExhausted === 'function' && !spawner.isExhausted()) {
      return;
    }

    // requireAtLeastOne: an arena that never held an enemy is not "all cleared".
    const placed = (scene._spawnedEnemyCount ?? 0) > 0 || this.everHadEnemy;
    if (this.requireAtLeastOne && !placed) return;

    this.win();
  }

  /** Count enemies that are active and not flagged dead (generic — plain sprites or BaseEnemy). */
  private aliveEnemyCount(): number {
    const grp = this.scene?.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return 0;
    let n = 0;
    for (const e of grp.getChildren()) {
      if (e && e.active !== false && !e.isDead) n += 1;
    }
    return n;
  }

  /** One-shot win. Idempotent (the engine gameCompleted guard backs it up). */
  private win(): void {
    const scene = this.scene;
    if (this.won || scene.gameCompleted) return;
    this.won = true;
    scene.gameCompleted = true;
    scene.fireEffect?.(this.winEffectEvent, scene.player?.x, scene.player?.y);
    scene.onLevelComplete();
  }
}
