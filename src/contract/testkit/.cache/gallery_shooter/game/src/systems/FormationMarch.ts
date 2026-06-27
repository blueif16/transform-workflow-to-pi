/**
 * FormationMarch — the descending, step-marching enemy FORMATION (BUILD — the
 * load-bearing gallery-shooter engine piece). RB §2: the swarm is ONE rigid body
 * with a shared direction; only the live bounding columns trigger the edge reverse +
 * row drop; the inter-step interval scales with the alive count so the rack
 * ACCELERATES as its ranks thin (the Space Invaders signature feel).
 *
 * It DOES NOT own enemy creation — DataShooterScene builds the grid members (tagged
 * .__formation, with a __col/__row offset and a points value) into scene.enemies, the
 * SAME group the bullet-collision path kills. This system READS that group and:
 *   1. step-marches the whole rack sideways on a count-scaled timer;
 *   2. at an arena edge (live leftmost/rightmost column), reverses dir + drops a row;
 *   3. ACCELERATES: stepIntervalMs = max(floorMs, baseStepMs * alive/total);
 *   4. LOSES when the lowest live member crosses the player's row (formation lands).
 *
 * It owns NO win (WaveLoop watches the alive count → spawns the next / wins). It
 * writes only the lose seam (player.takeDamage with a lethal blow → the engine's
 * player.died/status:'lost' path) and reads scene.enemies. GENERIC: no game/theme,
 * no baked coordinate — geometry comes from the live members + the map bounds; cadence
 * + drop from params.
 *
 * EVENT (the PUSH channel): formation.stepped fires once per completed march step
 * (payload {alive,dir}); formation.landed fires when the rack reaches the player row.
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible defaults):
 *   baseStepMs    inter-step interval at FULL alive count (default 600).
 *   floorMs       the fastest the rack ever steps (the last enemy; default 60).
 *   stepPx        horizontal distance per step (default 14).
 *   dropPx        vertical drop at each edge reverse (default 24).
 *   edgeMargin    px from the arena edge a member must reach to trigger reverse (default 8).
 *   landDamage    damage dealt to the player when the rack lands (default 9999 = lethal).
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'FormationMarch',
  intent:
    'March the rigid enemy formation as one body: step sideways on a count-scaled timer (faster as ranks thin — the signature acceleration), reverse + drop a row at each arena edge (live columns only), and fire the lose seam when the rack reaches the player row. The heart of the gallery shooter.',
  attachesTo: 'scene',
  params: ['baseStepMs', 'floorMs', 'stepPx', 'dropPx', 'edgeMargin', 'landDamage'],
  roles: ['enemy', 'player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface FormationMarchConfig {
  baseStepMs?: number;
  floorMs?: number;
  stepPx?: number;
  dropPx?: number;
  edgeMargin?: number;
  landDamage?: number;
}

export class FormationMarch implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly baseStepMs: number;
  private readonly floorMs: number;
  private readonly stepPx: number;
  private readonly dropPx: number;
  private readonly edgeMargin: number;
  private readonly landDamage: number;

  /** Marching direction: +1 = right, -1 = left. */
  private dir = 1;
  /** ms accumulated toward the next step (fixed-step accumulator; frame-rate-independent). */
  private acc = 0;
  /** The total member count at spawn (the denominator of the acceleration ratio). */
  private total = 0;
  /** Latched once the rack has landed (lose) so the lose seam fires exactly once. */
  private landed = false;
  /** The last inter-step interval used (EXPOSED for diagnostics / the accelerate proof). */
  public lastStepIntervalMs = 0;

  constructor(params: FormationMarchConfig = {}) {
    this.baseStepMs = Math.max(1, params.baseStepMs ?? 600);
    this.floorMs = Math.max(1, params.floorMs ?? 60);
    this.stepPx = params.stepPx ?? 14;
    this.dropPx = params.dropPx ?? 24;
    this.edgeMargin = params.edgeMargin ?? 8;
    this.landDamage = params.landDamage ?? 9999;
  }

  reset(): void {
    this.dir = 1;
    this.acc = 0;
    this.total = 0;
    this.landed = false;
    this.lastStepIntervalMs = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    this.total = this.members().length;
    // Publish self so WaveLoop / diagnostics can read the live alive count + cadence.
    scene.__formationMarch = this;
    scene.waveIndex = scene.waveIndex ?? 0;
  }

  /** The live formation members (tagged .__formation, still active + not dead). */
  private members(): any[] {
    const grp = this.scene?.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return [];
    return grp.getChildren().filter((e: any) => e && e.__formation && e.active !== false && !e.isDead);
  }

  /** The current ALIVE member count (read by WaveLoop for the clear→next gate). */
  public aliveCount(): number {
    return this.members().length;
  }

  /** Re-seed the denominator (called by WaveLoop when it spawns a fresh formation). */
  public rearm(): void {
    this.dir = 1;
    this.acc = 0;
    this.landed = false;
    this.total = this.members().length;
  }

  /** The interval (ms) until the next step at the CURRENT alive count (the accel rule). */
  public stepIntervalMs(): number {
    const alive = this.aliveCount();
    const total = Math.max(1, this.total);
    const ratio = Math.max(0, alive) / total;
    return Math.max(this.floorMs, this.baseStepMs * ratio);
  }

  update(): void {
    const scene = this.scene;
    if (!scene || this.landed) return;
    const members = this.members();
    if (members.length === 0) return; // cleared — WaveLoop handles the next wave / win.

    // Fixed-step accumulator (frame-rate-independent): advance by the real elapsed ms.
    const dtMs = scene.game?.loop?.delta ?? 16.67;
    this.acc += dtMs;
    const interval = this.stepIntervalMs();
    this.lastStepIntervalMs = interval;
    if (this.acc < interval) return;
    this.acc -= interval;

    this.stepRack(members);
  }

  /** Execute ONE march step of the whole rack (uniform move, edge test, reverse+drop). */
  private stepRack(members: any[]): void {
    const W = this.scene.mapWidth ?? this.scene.scale?.width ?? 432;

    // Live bounding edges (RB §2: only the leftmost/rightmost ALIVE member matters).
    let minX = Infinity;
    let maxX = -Infinity;
    for (const m of members) {
      const halfW = (m.displayWidth ?? 32) / 2;
      minX = Math.min(minX, m.x - halfW);
      maxX = Math.max(maxX, m.x + halfW);
    }

    // Would this step push a bounding edge past the arena? Reverse + drop instead.
    const nextMin = minX + this.dir * this.stepPx;
    const nextMax = maxX + this.dir * this.stepPx;
    const hitEdge =
      (this.dir > 0 && nextMax >= W - this.edgeMargin) ||
      (this.dir < 0 && nextMin <= this.edgeMargin);

    if (hitEdge) {
      this.dir *= -1;
      for (const m of members) m.y += this.dropPx;
      this.checkLanded(members);
    } else {
      const dx = this.dir * this.stepPx;
      for (const m of members) m.x += dx;
    }

    // The PUSH seam: one event per completed step (the cadence the HUD/sound reads).
    this.bus?.emit('formation.stepped', {
      alive: members.length,
      dir: this.dir,
    });
  }

  /** Lose when the lowest live member reaches/crosses the player's row. */
  private checkLanded(members: any[]): void {
    const player = this.scene?.player;
    if (!player || this.landed) return;
    const playerTop = player.y - (player.displayHeight ?? 32) / 2;
    let lowest = -Infinity;
    for (const m of members) lowest = Math.max(lowest, m.y + (m.displayHeight ?? 32) / 2);
    if (lowest >= playerTop) {
      this.landed = true;
      // The PUSH seam: the rack landed (the lose moment).
      this.bus?.emit('formation.landed', { alive: members.length });
      // The LOSE SEAM: a lethal blow via the engine's own death path → status 'lost'.
      player.takeDamage?.(this.landDamage);
    }
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - formation.stepped ← stepRack (one completed march step)            [archetype]
   *   - formation.landed  ← checkLanded (the rack reaches the player row)  [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'formation.stepped',
          payload: '{alive,dir}',
          scope: 'archetype',
          drivenBy: 'the count-scaled step timer elapsing (one march step)',
          expect:
            'every live formation member advances one step (or reverses + drops at an edge); the step interval shrinks as alive count falls; formation.stepped logged',
        },
        {
          name: 'formation.landed',
          payload: '{alive}',
          scope: 'archetype',
          drivenBy: 'the descending rack reaching the player row',
          expect: "the player takes a lethal blow; __GAME__.status becomes 'lost'; formation.landed logged",
        },
      ],
    };
  }
}
