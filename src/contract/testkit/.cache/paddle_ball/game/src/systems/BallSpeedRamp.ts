/**
 * BallSpeedRamp — the ball ACCELERATES in steps as the rally lengthens (BUILD — system;
 * brick-breaker genre). The classic Breakout "the longer you survive, the faster it
 * gets" pressure curve: every brick the player clears WITHOUT losing the ball extends
 * the current rally, and each time the rally length crosses a step the ball speeds up.
 * Lose the ball and the rally (and the speed) reset to base — a fresh start.
 *
 * Why a SYSTEM (not a behavior): the BALL is engine-driven — BasePaddleScene owns the
 * single source of the ball's speed (`scene.ballSpeed`, the constant a paddle/wall/brick
 * bounce rescales the velocity back to; see ball-physics.paddleBounce) and the live
 * velocity (`scene.ballVel`). This system mutates THAT one source: on each step it raises
 * `scene.ballSpeed` AND rescales the in-flight `scene.ballVel` to the new magnitude, so
 * the ball that is already in play visibly accelerates the same frame.
 *
 * The OBSERVABLE __GAME__ effect this owns:
 *   - the ball's speed (the magnitude of scene.ballVel, and scene.ballSpeed) INCREASES at
 *     each rally step and RETURNS to the captured base when the ball is lost.
 *
 * The RALLY seams (no new collision — it reads the engine's existing events):
 *   - `brick.cleared` (BrickGrid) extends the rally; crossing a step accelerates + emits
 *     `ball.speedChanged`.
 *   - `life.lost`     (BasePaddleScene, ball below the paddle) resets the rally + speed.
 * It also exposes a public crossStep() seam so a $custom effect or the runtime
 * check-exposes driver can drive a step deterministically.
 *
 * It re-implements NOTHING the engine owns: the ball integration, the reflections, and
 * the life-loss all live in BasePaddleScene; this system only nudges the speed scalar +
 * the live velocity at the rally boundary.
 *
 * Params (all OPTIONAL — declared defaults, never a baked map):
 *   bricksPerStep  bricks cleared in one rally per speed step (default 4).
 *   stepFactor     multiplier applied to the ball speed at each step (default 1.12).
 *   maxSteps       cap on accumulated steps within one rally (default 5).
 *   triggerEvent   the bus event that extends the rally (default 'brick.cleared').
 *   resetEvent     the bus event that resets the rally + speed (default 'life.lost').
 */
import type { ISceneSystem } from '../scenes/paddle-data';
import type { ComponentSurface, EventBus } from '@contract/component-surface';
import { speedOf, type Vec2 } from '../scenes/ball-physics';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors every system file). */
export const CAPABILITY = {
  kind: 'system',
  id: 'BallSpeedRamp',
  intent:
    'The ball accelerates in steps as the rally (bricks cleared without losing the ball) lengthens: each brick.cleared extends the current rally, and every bricksPerStep bricks the ball speed is raised by stepFactor (capped at maxSteps) — raising the engine ballSpeed AND rescaling the in-flight ballVel so the live ball speeds up immediately. Losing the ball (life.lost) resets the rally and reverts the speed to the captured base. The brick-breaker escalating-pressure curve.',
  attachesTo: 'scene',
  params: ['bricksPerStep', 'stepFactor', 'maxSteps', 'triggerEvent', 'resetEvent'],
  roles: ['ball'],
} as const;

export const BALL_SPEED_RAMP_CAPABILITIES = [CAPABILITY] as const;

export interface BallSpeedRampConfig {
  bricksPerStep?: number;
  stepFactor?: number;
  maxSteps?: number;
  triggerEvent?: string;
  resetEvent?: string;
}

export class BallSpeedRamp implements ISceneSystem {
  private scene: any;
  /** The ball's natural (un-ramped) speed, captured on attach — the reset target. */
  private baseSpeed = 0;
  /** Bricks cleared in the CURRENT rally (reset on life.lost). */
  private rally = 0;
  /** Speed steps already applied within the current rally (capped at maxSteps). */
  private steps = 0;
  /** Unsubscribe handles for the two bus listeners (cleaned up on reset). */
  private offTrigger: (() => void) | null = null;
  private offReset: (() => void) | null = null;
  private readonly bricksPerStep: number;
  private readonly stepFactor: number;
  private readonly maxSteps: number;
  private readonly triggerEvent: string;
  private readonly resetEvent: string;

  constructor(params: BallSpeedRampConfig = {}) {
    this.bricksPerStep = Math.max(1, params.bricksPerStep ?? 4);
    this.stepFactor = Math.max(1, params.stepFactor ?? 1.12);
    this.maxSteps = Math.max(1, params.maxSteps ?? 5);
    this.triggerEvent = params.triggerEvent ?? 'brick.cleared';
    this.resetEvent = params.resetEvent ?? 'life.lost';
  }

  /** The shared event bus (the scene owns it; attach() set this.scene). */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  /** Re-arm to a fresh-level state so a restarted level starts at the base speed. */
  reset(): void {
    this.offTrigger?.();
    this.offReset?.();
    this.offTrigger = null;
    this.offReset = null;
    this.rally = 0;
    this.steps = 0;
    this.baseSpeed = 0;
  }

  /** Capture the base ball speed + wire the rally listeners on the shared bus. */
  attach(scene: any): void {
    this.scene = scene;
    // Publish the read/drive seam so a $custom effect or the check-exposes driver can
    // drive a step via scene.ballSpeedRamp.crossStep() / noteRallyHit().
    scene.ballSpeedRamp = this;
    this.baseSpeed = speedOf(scene.ballVel ?? { x: 0, y: 0 }) || scene.ballSpeed || 320;
    // Extend the rally on every cleared brick; reset it on a lost ball. Mirrors how
    // MultiBall listens on the same bus for its trigger event.
    this.offTrigger = scene.eventBus?.on?.(this.triggerEvent, () => this.noteRallyHit());
    this.offReset = scene.eventBus?.on?.(this.resetEvent, () => this.resetRally());
  }

  /** No Arcade overlap of its own — the rally arrives via the bus listeners. */
  setupCollisions(): void {}

  /** No per-frame work — the ramp is event-driven (rally hits + the reset). */
  update(): void {}

  // ── the rally → speed mechanic ────────────────────────────────────────────────

  /**
   * Extend the current rally by one cleared brick. Whenever the rally length crosses a
   * `bricksPerStep` boundary (and we are under `maxSteps`), apply one speed step. Public
   * so the real flow (the bus listener) AND a deterministic driver share one path.
   */
  noteRallyHit(): void {
    this.rally += 1;
    const wantSteps = Math.min(this.maxSteps, Math.floor(this.rally / this.bricksPerStep));
    while (this.steps < wantSteps) this.crossStep();
  }

  /**
   * Apply ONE speed step: raise the engine's ball speed by `stepFactor` and rescale the
   * in-flight velocity to the new magnitude so the live ball accelerates this frame. The
   * OBSERVABLE seam — speedOf(scene.ballVel) (and scene.ballSpeed) goes UP. Public so a
   * $custom effect or the runtime check-exposes driver can drive a step directly.
   */
  crossStep(): void {
    const scene = this.scene;
    if (!scene) return;
    if (this.steps >= this.maxSteps) return;
    this.steps += 1;
    const prev = scene.ballSpeed || this.baseSpeed || speedOf(scene.ballVel ?? { x: 0, y: 0 });
    const next = prev * this.stepFactor;
    scene.ballSpeed = next;
    // Rescale the live velocity to the new speed (preserve direction) so the ball that is
    // already in play speeds up immediately, not only on the next serve.
    const vel: Vec2 | undefined = scene.ballVel;
    if (vel) {
      const mag = speedOf(vel) || 1;
      vel.x = (vel.x / mag) * next;
      vel.y = (vel.y / mag) * next;
    }
    // The true gameplay seam: the rally crossed a step and the ball got faster. Lean,
    // JSON-serializable payload (the new speed + the step index + the rally length).
    this.bus?.emit('ball.speedChanged', {
      speed: next,
      step: this.steps,
      rally: this.rally,
    });
  }

  /**
   * Reset the rally + revert to the captured base speed (a fresh rally starts at base).
   * Driven by the lost-ball event — "without losing the ball" made literally true.
   */
  resetRally(): void {
    this.rally = 0;
    this.steps = 0;
    const scene = this.scene;
    if (!scene || this.baseSpeed <= 0) return;
    scene.ballSpeed = this.baseSpeed;
    const vel: Vec2 | undefined = scene.ballVel;
    if (vel) {
      const mag = speedOf(vel) || 1;
      vel.x = (vel.x / mag) * this.baseSpeed;
      vel.y = (vel.y / mag) * this.baseSpeed;
    }
  }

  // ── component surface (the declared PUSH-channel event set) ──────────────────

  /**
   * The event this system publishes. `ball.speedChanged` is a TRUE statement about the
   * real emit site in crossStep(): when the rally length crosses a step the ball's speed
   * is raised (observable via speedOf(scene.ballVel) and scene.ballSpeed going up) and
   * the event is logged; a lost ball reverts the speed in resetRally().
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'ball.speedChanged',
          payload: '{speed,step,rally}',
          scope: 'archetype',
          drivenBy:
            'the rally length (bricks cleared without losing the ball) crosses a bricksPerStep boundary',
          expect:
            '__GAME__ ball speed increases (speedOf(scene.ballVel) and scene.ballSpeed go up); a lost ball reverts to the base speed; ball.speedChanged logged',
        },
      ],
    };
  }
}
