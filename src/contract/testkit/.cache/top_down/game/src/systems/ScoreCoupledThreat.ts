/**
 * ScoreCoupledThreat — COUPLE PAYOFF TO PERIL (top_down arena escalation; DR §12 H4
 * coupled-fates, the Cruise-Elroy "the more you win, the more dangerous it gets"
 * generalized to the twin-stick arena). ADDED beyond the seeds: no catalog system
 * ties the board's danger to the player's progress toward winning.
 *
 * The coupling (the closer to victory, the hotter the board): every time the player
 * scores — a SCORED KILL (the twin-stick driver, `enemy.died` on the bus) or a WAVE
 * CLEAR (`scene.waveIndex` advances, which WaveSpawner sets on each all-cleared
 * release) — a counter ticks. Once it crosses the declared `step`, the system
 * ESCALATES the bound enemy group: it raises every bound chaser's `walkSpeed` (its
 * ChaseAI `speed`, the px/s that drives velocity each frame) by `speedStep`, and —
 * when a WaveSpawner is present — releases the next wave EARLY (so the enemy count
 * rises too). It emits `threat.escalated` at this true seam.
 *
 * It re-implements NOTHING the engine owns: the scored-kill / collect / wave seams
 * are the SDK's own standardized emits (BaseGameScene.onEnemyKilled → `enemy.died`,
 * DataTopDownScene.consumeReward → `reward.collected`, WaveSpawner → `scene.waveIndex`).
 * This system only LISTENS to those moments and turns the board's screws. The
 * escalated enemy GROUP/ROLE is a config param (`group`/`role`) with a default of the
 * chaser role — NO per-emit id is generated.
 *
 * Observable (__GAME__): after a scored kill (or a wave clear) crosses the step, a
 * bound enemy's MEASURED speed (Δ position/frame in __GAME__.entities) rises — OR, via
 * the early WaveSpawner release, the enemy COUNT in __GAME__.entities rises. The
 * `threat.escalated` event logs each step on the bus.
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, no game/theme/coordinate baked):
 *   step        scored kills/clears BETWEEN escalations (default 3 — every 3rd payoff
 *               turns the screw once). A kill and a wave clear both count as one tick.
 *   speedStep   px/s added to each bound chaser's walkSpeed per escalation (default 24).
 *   maxSpeed    hard cap on a chaser's escalated walkSpeed (default 320 — the board
 *               gets harder, never un-survivable).
 *   group       only enemies whose `__kind` equals this are escalated (e.g. 'chaser').
 *               Absent => every enemy carrying a ChaseAI is escalated (the chaser role).
 *   coupleKill  count a scored kill (`enemy.died`) as a tick (default true).
 *   coupleScore count a reward collect (`reward.collected`) as a tick (default false —
 *               a twin-stick arena scores by kills, not pickups; flip on for a
 *               collect-scored board).
 *   coupleWave  count a wave clear (scene.waveIndex advance) as a tick AND release the
 *               next WaveSpawner wave early on escalation (default true).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (registry/discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ScoreCoupledThreat',
  intent:
    'Couple payoff to peril (DR §12 H4 coupled-fates): each scored kill or wave clear ticks a counter; crossing the declared step raises the bound chaser role\'s walkSpeed (and releases the next WaveSpawner wave early) so the board gets more dangerous the closer the player is to winning.',
  attachesTo: 'scene',
  params: ['step', 'speedStep', 'maxSpeed', 'group', 'coupleKill', 'coupleScore', 'coupleWave'],
  roles: ['enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface ScoreCoupledThreatConfig {
  step?: number;
  speedStep?: number;
  maxSpeed?: number;
  group?: string;
  coupleKill?: boolean;
  coupleScore?: boolean;
  coupleWave?: boolean;
}

export class ScoreCoupledThreat implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly step: number;
  private readonly speedStep: number;
  private readonly maxSpeed: number;
  private readonly group?: string;
  private readonly coupleKill: boolean;
  private readonly coupleScore: boolean;
  private readonly coupleWave: boolean;

  /** Scored payoffs counted since the last escalation (resets each escalation). */
  private payoffs = 0;
  /** How many escalation steps have fired this run (the tier — 1-based once it climbs). */
  private tier = 0;
  /** The last wave index seen, so a wave ADVANCE is detected exactly once. */
  private lastWaveIndex = 0;
  /** Bus unsubscribe fns, torn down on reset so a restart re-arms cleanly. */
  private unsubs: Array<() => void> = [];

  constructor(params: ScoreCoupledThreatConfig = {}) {
    this.step = Math.max(1, Math.floor(params.step ?? 3));
    this.speedStep = params.speedStep ?? 24;
    this.maxSpeed = params.maxSpeed ?? 320;
    this.group = params.group;
    this.coupleKill = params.coupleKill ?? true;
    this.coupleScore = params.coupleScore ?? false;
    this.coupleWave = params.coupleWave ?? true;
  }

  reset(): void {
    this.payoffs = 0;
    this.tier = 0;
    this.lastWaveIndex = 0;
    for (const off of this.unsubs) off();
    this.unsubs = [];
  }

  attach(scene: any): void {
    this.scene = scene;
    this.lastWaveIndex = scene?.waveIndex ?? 0;
    // LIVE wiring: subscribe to the SDK's own standardized scored-payoff moments on
    // the shared bus. A scored kill (enemy.died) and/or a reward collect drive the
    // counter; the unsubscribe fns are torn down in reset() so a restart re-arms.
    const bus = scene?.eventBus;
    if (bus && typeof bus.on === 'function') {
      if (this.coupleKill) this.unsubs.push(bus.on('enemy.died', () => this.recordKill()));
      if (this.coupleScore)
        this.unsubs.push(bus.on('reward.collected', () => this.recordScore()));
    }
  }

  /**
   * Per-frame: detect a WAVE CLEAR (WaveSpawner advances scene.waveIndex on each
   * all-cleared release) as a scored payoff. Edge-triggered on the index ADVANCE so a
   * clear counts exactly once.
   */
  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    if (!this.coupleWave) return;
    const wave = scene.waveIndex ?? 0;
    if (wave > this.lastWaveIndex) {
      this.lastWaveIndex = wave;
      this.recordPayoff();
    }
  }

  // ── the drive seams (public verbs — Integrate wires the bus, Test fires these) ──

  /** A scored KILL — the twin-stick driver. Ticks the payoff counter. */
  public recordKill(): void {
    if (this.coupleKill) this.recordPayoff();
  }

  /** A reward COLLECT scored — ticks the payoff counter (when coupleScore is on). */
  public recordScore(): void {
    if (this.coupleScore) this.recordPayoff();
  }

  /** A WAVE CLEAR — ticks the payoff counter (the alt scored path). */
  public recordWaveClear(): void {
    if (this.coupleWave) this.recordPayoff();
  }

  /**
   * Tick one scored payoff. Once `step` payoffs accumulate, ESCALATE the board (raise
   * the bound chasers' walkSpeed + release the next wave early) and emit
   * `threat.escalated` at this true seam, then reset the per-step counter.
   */
  private recordPayoff(): void {
    if (this.scene?.gameCompleted) return;
    this.payoffs += 1;
    if (this.payoffs < this.step) return;
    this.payoffs = 0;
    this.escalate();
  }

  /**
   * Turn the screw once: raise every bound chaser's walkSpeed by `speedStep` (capped),
   * release the next WaveSpawner wave early (so the enemy count can rise too), and emit
   * `threat.escalated`. The escalated GROUP is the `group`/chaser role (a config param,
   * never a per-emit id).
   */
  private escalate(): void {
    this.tier += 1;
    const enemySpeed = this.raiseBoundChaserSpeed();
    this.releaseNextWaveEarly();

    // The PUSH-channel emit at the true escalation seam (lean, JSON-serializable).
    this.bus?.emit('threat.escalated', {
      tier: this.tier,
      enemySpeed: Math.round(enemySpeed * 100) / 100,
    });
  }

  /**
   * Raise the walkSpeed of every bound chaser (an enemy carrying a ChaseAI behavior,
   * filtered by the optional `group` __kind) by `speedStep`, capped at `maxSpeed`.
   * Returns the resulting (max) escalated chaser speed — the number reported in the
   * event payload (0 when no chaser is bound, e.g. a count-only escalation).
   */
  private raiseBoundChaserSpeed(): number {
    let maxAfter = 0;
    for (const enemy of this.boundEnemies()) {
      const chase = this.chaseOf(enemy);
      if (!chase) continue;
      const after = Math.min(this.maxSpeed, (chase.speed ?? 0) + this.speedStep);
      chase.speed = after;
      if (after > maxAfter) maxAfter = after;
    }
    return maxAfter;
  }

  /** Release the next WaveSpawner wave early on escalation (so the enemy count rises). */
  private releaseNextWaveEarly(): void {
    if (!this.coupleWave) return;
    const spawner = this.scene?.__waveSpawner;
    if (spawner && typeof spawner.escalateRelease === 'function') {
      spawner.escalateRelease();
    }
  }

  /** Live enemies that match the optional `group` __kind filter (else every enemy). */
  private boundEnemies(): any[] {
    const grp = this.scene?.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return [];
    const out: any[] = [];
    for (const e of grp.getChildren()) {
      if (!e || e.active === false || e.isDead) continue;
      if (this.group && e.__kind !== this.group) continue;
      out.push(e);
    }
    return out;
  }

  /** The ChaseAI behavior bound to an enemy (the walkSpeed seam), or undefined. */
  private chaseOf(enemy: any): { speed?: number } | undefined {
    const mgr = enemy?.behaviors;
    if (!mgr || typeof mgr.getAll !== 'function') return undefined;
    for (const b of mgr.getAll() as any[]) {
      // A chaser is identified structurally (a behavior with a numeric `speed` that
      // can chase) — generic, no per-game class coupling.
      if (b && typeof b.speed === 'number' && typeof b.setTarget === 'function') return b;
    }
    return undefined;
  }

  /** The PUSH-channel surface: declares + (via escalate()) really fires threat.escalated. */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'threat.escalated',
          payload: '{tier,enemySpeed}',
          scope: 'archetype',
          drivenBy: 'a scored kill (or a wave clear) crosses the escalation step',
          expect:
            "a bound chaser's walkSpeed rises (its measured speed in __GAME__.entities increases) or the enemy count in __GAME__.entities rises; threat.escalated logged",
        },
      ],
    };
  }
}
