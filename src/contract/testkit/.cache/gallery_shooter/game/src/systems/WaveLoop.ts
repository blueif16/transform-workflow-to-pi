/**
 * WaveLoop — the wave progression + win owner (BUILD — gallery-shooter engine
 * piece). RB §2: when the formation's alive count hits 0 the game advances — either
 * a fresh, harder formation spawns (the next wave) or, once the wave quota is met,
 * the player WINS. It owns status->'won'; FormationMarch owns the lose (the rack
 * landing) and the marching; this system only watches the count + orchestrates waves.
 *
 * On each frame it reads the live formation alive count (via scene.__formationMarch,
 * or scene.enemies directly). When it reaches 0 AND the rack has not landed:
 *   - if waves remain → call scene.spawnFormation(nextSpec) (denser/lower/faster ramp)
 *     and re-arm the marcher, advancing scene.waveIndex;
 *   - else → the final wave is cleared → onLevelComplete (status:'won').
 *
 * GENERIC: no game/theme. The per-wave ramp (extra rows, drop, speed-up) is DATA via
 * params; the base formation shape comes from the level the scene already built.
 *
 * EVENT (the PUSH channel): wave.cleared fires when a wave is emptied (payload
 * {wave}); wave.started fires when the next is spawned (payload {wave}).
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible defaults):
 *   maxWaves      total waves to clear before the win (default 1 ⇒ clear one, win).
 *   addRowsPerWave  extra formation rows added each subsequent wave (default 1).
 *   stepSpeedup   fraction the base step interval shrinks per wave (default 0.15).
 *   descendPerWave  px lower the next wave's formation spawns (default 16).
 */
import type { ISceneSystem } from '../scenes/shooter-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'WaveLoop',
  intent:
    'Watch the formation alive count: when a formation is cleared, spawn the next (denser/lower/faster) or — once the wave quota is met — win. Owns status->won; pairs with FormationMarch (which owns the march + the lose). The gallery-shooter wave loop.',
  attachesTo: 'scene',
  params: ['maxWaves', 'addRowsPerWave', 'stepSpeedup', 'descendPerWave'],
  roles: ['enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface WaveLoopConfig {
  maxWaves?: number;
  addRowsPerWave?: number;
  stepSpeedup?: number;
  descendPerWave?: number;
}

export class WaveLoop implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly maxWaves: number;
  private readonly addRowsPerWave: number;
  private readonly stepSpeedup: number;
  private readonly descendPerWave: number;

  /** 1-based index of the wave currently on screen. */
  private wave = 1;
  /** Latches true once every wave is cleared (the win). */
  private won = false;
  /** Guard: a one-frame grace so we don't read alive==0 before the first formation builds. */
  private seenFormation = false;

  constructor(params: WaveLoopConfig = {}) {
    this.maxWaves = Math.max(1, Math.floor(params.maxWaves ?? 1));
    this.addRowsPerWave = Math.max(0, Math.floor(params.addRowsPerWave ?? 1));
    this.stepSpeedup = params.stepSpeedup ?? 0.15;
    this.descendPerWave = params.descendPerWave ?? 16;
  }

  reset(): void {
    this.wave = 1;
    this.won = false;
    this.seenFormation = false;
  }

  attach(scene: any): void {
    this.scene = scene;
    scene.waveIndex = 1;
    // Tell the scene to suppress its default all-enemies-dead win — THIS system owns
    // the win (so a mid-wave empty frame between formations does not falsely win).
    scene.suppressDefaultWin = true;
  }

  /** The live formation alive count (prefer the marcher's count; else the group). */
  private aliveCount(): number {
    const fm = this.scene?.__formationMarch;
    if (fm && typeof fm.aliveCount === 'function') return fm.aliveCount();
    const grp = this.scene?.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return 0;
    return grp.getChildren().filter((e: any) => e && e.__formation && e.active !== false && !e.isDead).length;
  }

  update(): void {
    const scene = this.scene;
    if (!scene || this.won) return;
    const alive = this.aliveCount();
    if (alive > 0) {
      this.seenFormation = true;
      return;
    }
    if (!this.seenFormation) return; // the first formation hasn't built yet — wait.

    // The wave is cleared.
    this.bus?.emit('wave.cleared', { wave: this.wave });

    if (this.wave >= this.maxWaves) {
      // Final wave cleared → WIN.
      this.won = true;
      scene.onLevelComplete?.();
      return;
    }

    // Spawn the next wave (denser / lower / faster) and re-arm the marcher.
    this.wave += 1;
    scene.waveIndex = this.wave;
    const spec = {
      addRows: this.addRowsPerWave * (this.wave - 1),
      descendPx: this.descendPerWave * (this.wave - 1),
      stepSpeedup: this.stepSpeedup * (this.wave - 1),
    };
    scene.spawnFormation?.(spec);
    scene.__formationMarch?.rearm?.();
    this.seenFormation = false;
    this.bus?.emit('wave.started', { wave: this.wave });
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - wave.cleared ← update (the on-screen formation emptied)        [archetype]
   *   - wave.started ← update (the next formation was spawned)         [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'wave.cleared',
          payload: '{wave}',
          scope: 'archetype',
          drivenBy: 'the on-screen formation alive count reaching 0',
          expect:
            'either the next (harder) formation spawns or — on the final wave — __GAME__.status becomes \'won\'; wave.cleared logged',
        },
        {
          name: 'wave.started',
          payload: '{wave}',
          scope: 'archetype',
          drivenBy: 'a fresh formation spawning after the prior was cleared',
          expect: 'new formation members enter __GAME__.entities; __GAME__.waveIndex increments; wave.started logged',
        },
      ],
    };
  }
}
