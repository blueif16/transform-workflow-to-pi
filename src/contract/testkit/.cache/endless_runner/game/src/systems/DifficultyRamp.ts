/**
 * ============================================================================
 * DifficultyRamp — distance-driven escalation of speed + spawn density (BUILD — system)
 * ============================================================================
 *
 * The endless-runner difficulty curve: as the run goes longer, it gets HARDER. This
 * system tracks the DISTANCE the world has scrolled and, each time distance crosses the
 * next threshold, RAMPS the run UP one level — the world scrolls FASTER and obstacle
 * pairs stream in MORE OFTEN (a smaller gap between them). A flat runner is boring; this
 * is the pressure curve that turns "survive" into "survive longer than you could last
 * time", and the reason a high score is meaningful.
 *
 * THE MECHANIC (no baked coordinate — every number is a DECLARED default, re-tunable):
 *   - DISTANCE is accumulated from the LIVE scroll speed each frame (distance += speed*dt),
 *     so the meter advances at exactly the rate the world actually moves (idSource:
 *     derived from distance). It is NOT wall-clock — pausing the scroll pauses the ramp.
 *   - Every `stepEveryPx` of distance the run crosses a THRESHOLD → level += 1. On each
 *     step the live scroller's scroll speed is MULTIPLIED by `speedMul` (clamped to
 *     `maxScrollSpeed`) and its spawn spacing is MULTIPLIED by `spawnMul` (< 1 ⇒ pairs
 *     arrive sooner, clamped to `minSpawnEveryPx`) — both effects observable in the world.
 *   - It reaches the running scroller via the scene's live systems (the same
 *     ObstacleScrollSystem the data loader constructed) and MUTATES its tunable config
 *     in place; the scroller reads `this.cfg.scrollSpeed` / `this.cfg.spawnEveryPx` every
 *     frame, so the new values take effect on the very next tick. It edits NO other file.
 *
 * OBSERVABLE (the contract): each ramp step both (a) increases the live scroll speed —
 * every obstacle in __GAME__.entities advances left faster — and (b) shortens the spawn
 * spacing — new obstacle pairs enter __GAME__.entities from the right at a higher rate.
 * The current curve is also published on scene.difficulty (a {level, scrollSpeed,
 * spawnEveryPx, distance} snapshot) for diagnostics / a HUD effect — a single source.
 *
 * IDENTITY (id source): the event carries the difficulty LEVEL it just reached — a value
 * DERIVED FROM DISTANCE (the level the accumulated distance has crossed into), not a
 * config id. The thresholds are config (`stepEveryPx`); the level is computed.
 *
 * INV-RESET: reset() clears the accumulated distance + the level back to a fresh run and
 * re-publishes the base curve, so a restarted run ramps identically from zero (no leaked
 * speed-up carried across a RESTART).
 *
 * GENERIC: no game/theme, no baked coordinate. The distance meter is a pure accumulation
 * of the live scroll speed; the ramp is a multiply on the scroller's own tunables.
 */
import type { ISceneSystem } from '../scenes/runner-data';
import { type EventBus, type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'DifficultyRamp',
  intent:
    'Distance-driven difficulty curve: as the run scrolls past successive distance thresholds, ramp the world up one level — the scroll speed is multiplied (clamped) so obstacles advance faster, and the obstacle spawn spacing is shortened (clamped) so pairs stream in more often. Tracks distance from the live scroll speed and mutates the running scroller\'s tunables in place. The escalation that makes a longer run harder.',
  attachesTo: 'scene',
  params: ['stepEveryPx', 'speedMul', 'spawnMul', 'maxScrollSpeed', 'minSpawnEveryPx', 'maxLevel'],
  tuning: ['stepEveryPx', 'speedMul', 'spawnMul', 'maxScrollSpeed', 'minSpawnEveryPx', 'maxLevel'],
  roles: ['obstacle'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** Per-game tuning for the ramp (every field DECLARED with a sensible default). */
export interface DifficultyRampConfig {
  /** Distance (px) the world must scroll to cross to the next difficulty level. Default 1800. */
  stepEveryPx?: number;
  /** Scroll-speed multiplier applied to the live scroller per level. Default 1.12. */
  speedMul?: number;
  /** Spawn-spacing multiplier per level (< 1 ⇒ pairs arrive sooner). Default 0.92. */
  spawnMul?: number;
  /** Hard cap (px/s) the scroll speed never ramps past (the fairness ceiling). Default 360. */
  maxScrollSpeed?: number;
  /** Floor (px) the spawn spacing never shrinks below (always threadable). Default 150. */
  minSpawnEveryPx?: number;
  /** Highest level the ramp reaches (no more steps past it). Default 8. */
  maxLevel?: number;
}

/** Declared defaults (a gentle, fair escalation). Re-tuned per game via params. */
const DEF = {
  stepEveryPx: 1800,
  speedMul: 1.12,
  spawnMul: 0.92,
  maxScrollSpeed: 360,
  minSpawnEveryPx: 150,
  maxLevel: 8,
};

/** The subset of the scroller's tunable config this system reads + mutates in place. */
interface RampableScroller {
  cfg: { scrollSpeed: number; spawnEveryPx: number };
}

export class DifficultyRamp implements ISceneSystem {
  private scene: any;
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly cfg: Required<DifficultyRampConfig>;

  /** Distance (px) the world has scrolled this run (the ramp meter — INV-RESET). */
  private distance = 0;
  /** The difficulty level reached so far (0 = base; bumped at each threshold). */
  private level = 0;

  constructor(params: DifficultyRampConfig = {}) {
    this.cfg = {
      stepEveryPx: params.stepEveryPx ?? DEF.stepEveryPx,
      speedMul: params.speedMul ?? DEF.speedMul,
      spawnMul: params.spawnMul ?? DEF.spawnMul,
      maxScrollSpeed: params.maxScrollSpeed ?? DEF.maxScrollSpeed,
      minSpawnEveryPx: params.minSpawnEveryPx ?? DEF.minSpawnEveryPx,
      maxLevel: params.maxLevel ?? DEF.maxLevel,
    };
  }

  reset(): void {
    this.distance = 0;
    this.level = 0;
    if (this.scene) this.publishCurve();
  }

  attach(scene: any): void {
    this.scene = scene;
    this.distance = 0;
    this.level = 0;
    // Publish the base curve so a HUD / diagnostics has it from frame zero.
    this.publishCurve();
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    const avatar = scene.player;
    // Freeze the ramp once the run has ended (no escalation against a dead avatar).
    if (avatar?.isDead) return;

    const scroller = this.findScroller();
    if (!scroller) return;

    const dt = 1 / 60;
    // Advance the distance meter at the rate the world ACTUALLY scrolls (derived from
    // the live scroll speed — pausing the scroll pauses the ramp). idSource: distance.
    this.distance += scroller.cfg.scrollSpeed * dt;

    // Cross every threshold the distance now covers (handles a large dt in one tick).
    while (
      this.level < this.cfg.maxLevel &&
      this.distance >= (this.level + 1) * this.cfg.stepEveryPx
    ) {
      this.level += 1;
      this.applyRamp(scroller);
    }
  }

  /** Ramp the live scroller up one level: faster scroll + tighter spawn cadence. */
  private applyRamp(scroller: RampableScroller): void {
    // (a) scroll FASTER — clamped to the fairness ceiling.
    scroller.cfg.scrollSpeed = Math.min(
      this.cfg.maxScrollSpeed,
      scroller.cfg.scrollSpeed * this.cfg.speedMul,
    );
    // (b) spawn pairs SOONER — spacing shrinks, clamped to the threadable floor.
    scroller.cfg.spawnEveryPx = Math.max(
      this.cfg.minSpawnEveryPx,
      scroller.cfg.spawnEveryPx * this.cfg.spawnMul,
    );

    this.publishCurve();
    // The PUSH seam: the run crossed a distance threshold and got harder. The payload
    // carries the new level (derived from distance) + the now-live tunables (lean,
    // JSON-serializable primitives — never a class instance).
    this.bus?.emit('difficulty.increased', {
      level: this.level,
      scrollSpeed: Math.round(scroller.cfg.scrollSpeed),
      spawnEveryPx: Math.round(scroller.cfg.spawnEveryPx),
    });
  }

  /**
   * Find the live ObstacleScrollSystem the data loader constructed. The runner scene
   * holds its active systems in `scene.systems` (DataRunnerScene); we pick the one that
   * carries the scroll tunables we ramp. Defensive: returns null if absent (clean no-op).
   */
  private findScroller(): RampableScroller | null {
    const systems = (this.scene?.systems ?? []) as any[];
    for (const sys of systems) {
      const cfg = sys?.cfg;
      if (cfg && typeof cfg.scrollSpeed === 'number' && typeof cfg.spawnEveryPx === 'number') {
        return sys as RampableScroller;
      }
    }
    return null;
  }

  /** Publish the current curve on scene.difficulty (the single diagnostics source). */
  private publishCurve(): void {
    const scroller = this.findScroller();
    this.scene.difficulty = {
      level: this.level,
      scrollSpeed: scroller ? Math.round(scroller.cfg.scrollSpeed) : 0,
      spawnEveryPx: scroller ? Math.round(scroller.cfg.spawnEveryPx) : 0,
      distance: Math.round(this.distance),
    };
  }

  /**
   * The PUSH channel this system publishes (one true statement per real emit site):
   *   - difficulty.increased ← applyRamp (the distance meter crossed the next
   *     threshold; the live scroll speed and spawn cadence both stepped up) [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'difficulty.increased',
          payload: '{level,scrollSpeed,spawnEveryPx}',
          scope: 'archetype',
          drivenBy: 'the scrolled distance crossing the next difficulty threshold',
          expect:
            'the live scroll speed increases (every obstacle in __GAME__.entities advances left faster) and the spawn spacing shortens (new obstacle pairs enter __GAME__.entities more often); difficulty.increased logged with the new level',
        },
      ],
    };
  }
}
