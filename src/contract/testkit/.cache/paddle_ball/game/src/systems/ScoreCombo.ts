/**
 * ScoreCombo — the consecutive-clear combo multiplier (BUILD — system; brick-breaker genre).
 *
 * A classic brick-breaker chaining mechanic: clearing bricks in QUICK SUCCESSION builds a
 * combo multiplier (×2, ×3, …), and that multiplier resets the moment the ball returns to
 * the PADDLE (one paddle touch = one combo window). The faster the player rallies bricks on
 * a single ball trip, the higher the multiplier — and a higher multiplier awards bonus score.
 *
 * The OBSERVABLE __GAME__ effect this owns:
 *   - the combo multiplier, written to the Phaser registry as `comboMultiplier` (a live
 *     __GAME__-readable value, single-sourced the same way BrickGrid single-sources `score`):
 *       · each brick cleared within `windowMs` of the previous clear bumps the multiplier
 *         by one (capped at `maxMultiplier`);
 *       · a brick cleared after the window lapses (or the very first clear of a window)
 *         resets the multiplier to 1;
 *       · the ball bouncing off the PADDLE resets the multiplier to 1 (the chain ended).
 *   - bonus score: when the multiplier is >1 at the moment a brick clears, the EXTRA points
 *     (base × (multiplier − 1)) are added to the registry `score` — so a combo visibly pays.
 *
 * It re-implements NOTHING the engine owns: BrickGrid still clears the brick + awards its
 * base points and emits `brick.cleared`; the scene still emits `ball.bounced` off the paddle.
 * This system only LISTENS to those two real seams (via the shared EventBus) and maintains
 * the multiplier + the bonus. It writes the multiplier read seam to the registry so the
 * runtime witness (__GAME__) can observe the transition.
 *
 * Params (all OPTIONAL — declared defaults, never a baked map):
 *   windowMs       max ms between two clears to count as "quick succession" (default 1200).
 *   maxMultiplier  the ceiling the multiplier climbs to (default 8).
 *   basePoints     base points a combo step scales its bonus from (default 10 — mirrors
 *                  BrickGrid's default brickPoints so the bonus reads in the same units).
 */
import type { ISceneSystem } from '../scenes/paddle-data';
import type { ComponentSurface, EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors every system file). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ScoreCombo',
  intent:
    'A consecutive-clear score combo: clearing bricks in quick succession (within a window) raises a combo multiplier capped at a configured ceiling, awarding bonus score that scales with the multiplier; the multiplier resets to 1 when the window lapses between clears or when the ball returns to the paddle (the chain ends). The brick-breaker "rally" reward mechanic.',
  attachesTo: 'scene',
  params: ['windowMs', 'maxMultiplier', 'basePoints'],
  roles: ['ball', 'brick', 'paddle'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface ScoreComboConfig {
  windowMs?: number;
  maxMultiplier?: number;
  basePoints?: number;
}

export class ScoreCombo implements ISceneSystem {
  private scene: any;
  /** The live combo multiplier (1 = no combo). Mirrored to registry `comboMultiplier`. */
  private multiplier = 1;
  /** Scene-clock ms of the previous brick clear (−Infinity = none yet this window). */
  private lastClearAt = Number.NEGATIVE_INFINITY;
  /** Unsubscribe handles for the two bus listeners, released on reset. */
  private offBrick: (() => void) | null = null;
  private offBounce: (() => void) | null = null;
  private readonly windowMs: number;
  private readonly maxMultiplier: number;
  private readonly basePoints: number;

  constructor(params: ScoreComboConfig = {}) {
    this.windowMs = params.windowMs ?? 1200;
    this.maxMultiplier = Math.max(1, params.maxMultiplier ?? 8);
    this.basePoints = params.basePoints ?? 10;
  }

  /** The shared event bus (the scene owns it; attach() set this.scene). */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  /** Re-arm to a fresh-level state (multiplier 1, no listeners) so a restart replays clean. */
  reset(): void {
    this.multiplier = 1;
    this.lastClearAt = Number.NEGATIVE_INFINITY;
    this.offBrick?.();
    this.offBounce?.();
    this.offBrick = null;
    this.offBounce = null;
  }

  /**
   * Subscribe to the two real gameplay seams on the shared bus:
   *   - `brick.cleared` (emitted by BrickGrid.clearBrick) → advance/start the combo;
   *   - `ball.bounced` with off:'paddle' (emitted by BasePaddleScene.maybePaddleBounce)
   *     → reset the combo (the ball came back, the rally chain ended).
   * Publishes the read/drive seam under a stable name + seeds the registry value.
   */
  attach(scene: any): void {
    this.scene = scene;
    scene.scoreCombo = this;
    scene.registry?.set?.('comboMultiplier', this.multiplier);
    this.offBrick = scene.eventBus?.on?.('brick.cleared', () => this.onBrickCleared());
    this.offBounce = scene.eventBus?.on?.('ball.bounced', (p: any) => {
      if (p?.off === 'paddle') this.resetCombo();
    });
  }

  /** No Arcade overlap of its own — the combo is driven entirely by the bus events. */
  setupCollisions(): void {}

  /** Per-frame: the combo is event-driven, so no per-frame work is required. */
  update(): void {}

  /**
   * Drive the combo when a brick clears. Within `windowMs` of the previous clear the
   * multiplier bumps (capped); otherwise the window restarted, so the multiplier resets
   * to 1. When the multiplier is >1 the bonus (base × (multiplier−1)) is added to the
   * registry `score`. Public so the runtime check-exposes driver can invoke the verb.
   */
  onBrickCleared(): void {
    const now = this.clockMs();
    if (now - this.lastClearAt <= this.windowMs) {
      this.setMultiplier(Math.min(this.maxMultiplier, this.multiplier + 1));
      this.awardBonus();
    } else {
      // first clear of a new window — the chain (re)starts at ×1
      this.setMultiplier(1);
    }
    this.lastClearAt = now;
  }

  /** Reset the combo to ×1 (the rally ended at the paddle, or an external reset). */
  resetCombo(): void {
    this.lastClearAt = Number.NEGATIVE_INFINITY;
    this.setMultiplier(1);
  }

  /** The live combo multiplier (read seam for any HUD / the witness). */
  current(): number {
    return this.multiplier;
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /**
   * Set the multiplier, single-source it to the registry (`comboMultiplier`, the
   * __GAME__-observable value), and emit `combo.changed` ONLY when it actually moved —
   * the true gameplay seam this component publishes.
   */
  private setMultiplier(next: number): void {
    const clamped = Math.max(1, Math.min(this.maxMultiplier, Math.round(next)));
    if (clamped === this.multiplier) return;
    this.multiplier = clamped;
    this.scene?.registry?.set?.('comboMultiplier', clamped);
    // The true gameplay seam: the combo multiplier transitioned (rise or reset).
    this.bus?.emit('combo.changed', { multiplier: clamped });
  }

  /** Add the combo bonus to the registry score so a higher multiplier visibly pays. */
  private awardBonus(): void {
    const reg = this.scene?.registry;
    if (!reg || this.multiplier <= 1) return;
    const bonus = this.basePoints * (this.multiplier - 1);
    const next = Number(reg.get('score') ?? 0) + bonus;
    reg.set('score', next);
    // The score moved — mirror the standardized score push the scene base declares.
    this.bus?.emit('score.changed', { score: next });
  }

  /** Scene clock ms when present (matches PaddleGrow's clock), else wall clock. */
  private clockMs(): number {
    return this.scene?.time?.now ?? Date.now();
  }

  // ── component surface (the declared PUSH-channel event set) ──────────────────

  /**
   * The event this system publishes. `combo.changed` is a TRUE statement about the real
   * emit site in setMultiplier(): every time the combo multiplier transitions — bumped by
   * a quick-succession clear or reset to ×1 by a window lapse / a paddle return — the new
   * multiplier is written to the registry (__GAME__ `comboMultiplier`) and logged.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'combo.changed',
          payload: '{multiplier}',
          scope: 'archetype',
          drivenBy:
            'clear bricks in quick succession (within the window) to raise the multiplier, or return the ball to the paddle to reset it',
          expect:
            '__GAME__ comboMultiplier changes (rises on a quick-succession clear, resets to 1 on a paddle return or a lapsed window); combo.changed logged',
        },
      ],
    };
  }
}
