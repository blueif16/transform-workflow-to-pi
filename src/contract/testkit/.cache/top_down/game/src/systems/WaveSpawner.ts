/**
 * WaveSpawner — edge-spawned enemy waves with non-linear escalation (BUILD —
 * system, RB §1/§2.5). The composable, registered replacement for the orphan's
 * monolithic BaseArenaScene wave logic.
 *
 * Releases enemies in WAVES from the ARENA EDGE (off the bounds, walking in), gates
 * the NEXT wave on "all cleared" (the current wave's enemies are all dead before the
 * next releases), and ESCALATES the count NON-LINEARLY across waves [RB §1: a good
 * arena ramps superlinearly, not +1 each round]. Every enemy it spawns is bound the
 * same behaviors[] (e.g. ChaseAI + Separation) the level data declares, so the crowd
 * chases AND spaces out — the M2 twin-stick crowd.
 *
 * It owns NO win: KillAllGoal owns status->'won' and consults this spawner's
 * isExhausted() so the arena wins only after the FINAL wave is cleared. This system
 * only RELEASES enemies and tracks the wave index (the __GAME__.waveIndex observable
 * reads scene.waveIndex, which this sets).
 *
 * NON-LINEAR escalation (the rule, never a baked count): wave k (1-based) releases
 *   count(k) = round(base * growth^(k-1)) + add * (k-1)^2 ... wait — kept simple &
 * GENERIC: count(k) = round(base * growth^(k-1)), a geometric ramp (growth>1 ⇒
 * superlinear: each wave is `growth`× the last, so the deltas GROW — non-linear by
 * construction). All of base/growth/maxWaves/enemy template are PARAMS from data.
 *
 * GENERIC: no game/theme, no entity coordinate. Spawn positions are derived from the
 * live arena bounds (edge ring) + the scene RNG; counts/behaviors/stats from params.
 *
 * Params (from blueprint.systems[].params):
 *   base        wave-1 enemy count (default 4).
 *   growth      geometric ramp factor >1 for non-linear escalation (default 1.6).
 *   maxWaves    how many waves to release (default 3). After the last, isExhausted().
 *   enemy       the per-enemy spawn template the loader instantiates, GENERIC:
 *               { behaviors?: BehaviorBinding[], assetSlot?, width?, height?, damage?,
 *                 health?, speed? } — defaults to a ChaseAI+Separation chaser.
 *   margin      how far OUTSIDE the bounds to spawn (default 24px — walks in).
 */
import type { ISceneSystem, BehaviorBinding } from '../scenes/topdown-data';

/** CAPABILITY sidecar (M3 registry reads this — mirrors platformer system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'WaveSpawner',
  intent:
    'Release enemy waves from the arena edge, gate the next wave on all-cleared, and escalate the count non-linearly (geometric ramp). Owns no win — KillAllGoal reads isExhausted().',
  attachesTo: 'scene',
  params: ['base', 'growth', 'maxWaves', 'enemy', 'margin'],
  roles: ['enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** The per-enemy spawn template (all GENERIC — from data). */
export interface WaveEnemyTemplate {
  behaviors?: BehaviorBinding[];
  assetSlot?: string;
  width?: number;
  height?: number;
  damage?: number;
  health?: number;
  /** chaser speed in px/s (used as the default ChaseAI speed when behaviors omit it). */
  speed?: number;
}

export interface WaveSpawnerConfig {
  base?: number;
  growth?: number;
  maxWaves?: number;
  enemy?: WaveEnemyTemplate;
  margin?: number;
}

export class WaveSpawner implements ISceneSystem {
  private scene: any;
  private readonly base: number;
  private readonly growth: number;
  private readonly maxWaves: number;
  private readonly enemy: WaveEnemyTemplate;
  private readonly margin: number;

  /** 0 before the first wave; k after wave k has been released. */
  private wavesReleased = 0;
  /** Latches true once the final wave is cleared (KillAllGoal reads isExhausted). */
  private finalCleared = false;

  constructor(params: WaveSpawnerConfig = {}) {
    this.base = Math.max(1, Math.floor(params.base ?? 4));
    this.growth = params.growth ?? 1.6;
    this.maxWaves = Math.max(1, Math.floor(params.maxWaves ?? 3));
    this.enemy = params.enemy ?? {};
    this.margin = params.margin ?? 24;
  }

  reset(): void {
    this.wavesReleased = 0;
    this.finalCleared = false;
  }

  attach(scene: any): void {
    this.scene = scene;
    // Expose self so KillAllGoal can gate the win on the final wave being cleared.
    scene.__waveSpawner = this;
    scene.waveIndex = 0;
    // Release the first wave immediately (the arena opens with enemies).
    this.releaseNextWave();
  }

  update(): void {
    const scene = this.scene;
    if (!scene || this.finalCleared) return;

    if (this.aliveEnemyCount() > 0) return; // current wave still alive — wait.

    if (this.wavesReleased >= this.maxWaves) {
      // Final wave cleared — exhausted; KillAllGoal now wins.
      this.finalCleared = true;
      return;
    }
    // All cleared and waves remain → release the next (the gate: next wave only
    // after all-cleared).
    this.releaseNextWave();
  }

  /** GENERIC count rule: geometric ramp ⇒ non-linear (growing) deltas. */
  public waveCount(k: number): number {
    return Math.max(1, Math.round(this.base * Math.pow(this.growth, k - 1)));
  }

  /** True once the final wave has been released AND cleared (no more enemies coming). */
  public isExhausted(): boolean {
    return this.finalCleared;
  }

  /** The enemy template this spawner uses (so KillAllGoal/diagnostics can inspect). */
  public get totalWaves(): number {
    return this.maxWaves;
  }

  private releaseNextWave(): void {
    const scene = this.scene;
    const k = this.wavesReleased + 1;
    const count = this.waveCount(k);
    for (let i = 0; i < count; i += 1) {
      const pos = this.edgePosition(i, count);
      scene.spawnEnemyAt?.({
        x: pos.x,
        y: pos.y,
        behaviors: this.enemy.behaviors ?? this.defaultChaserBehaviors(),
        assetSlot: this.enemy.assetSlot,
        width: this.enemy.width,
        height: this.enemy.height,
        damage: this.enemy.damage,
        health: this.enemy.health,
      });
    }
    this.wavesReleased = k;
    scene.waveIndex = k;
  }

  /** Default crowd: a chaser that spaces out (ChaseAI + Separation) — composed, generic. */
  private defaultChaserBehaviors(): BehaviorBinding[] {
    const speed = this.enemy.speed ?? 80;
    return [
      { ref: 'ChaseAI', params: { speed } },
      { ref: 'Separation', params: { radius: 48, weight: 0.8 } },
    ];
  }

  /** A point on the arena EDGE ring (just outside the bounds, walks in). */
  private edgePosition(i: number, count: number): { x: number; y: number } {
    const scene = this.scene;
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    const H = scene.mapHeight ?? scene.scale?.height ?? 768;
    const m = this.margin;
    // Distribute evenly around the perimeter with a small RNG jitter so a wave does
    // not stack at one corner (generic placement; no baked coordinate).
    const t = (i + Math.random() * 0.5) / Math.max(1, count);
    const perim = 2 * (W + H);
    let d = t * perim;
    // Walk the ring: top → right → bottom → left.
    if (d < W) return { x: d, y: -m };
    d -= W;
    if (d < H) return { x: W + m, y: d };
    d -= H;
    if (d < W) return { x: W - d, y: H + m };
    d -= W;
    return { x: -m, y: H - d };
  }

  private aliveEnemyCount(): number {
    const grp = this.scene?.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return 0;
    let n = 0;
    for (const e of grp.getChildren()) {
      if (e && e.active !== false && !e.isDead) n += 1;
    }
    return n;
  }
}
