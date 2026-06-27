/**
 * ============================================================================
 * ComboMultiplier — the match-3 consecutive-cascade score multiplier (system)
 * ============================================================================
 *
 * The match-3-swap genre's combo escalator: a score multiplier that RISES with
 * the depth of consecutive cascades WITHIN ONE MOVE, then RESETS to 1 once the
 * board settles with no further match. It is the grid_logic analogue of
 * MineReveal/TurnDuel — a scene-level IGridSystem the blueprint binds BY ID and
 * tunes with PARAMS — but for the match-3 (SwapMatch) cascade rule.
 *
 * THE MECHANIC (real logic, derived from cascade DEPTH — the bound rule's seam):
 *   SwapMatch.resolve() runs a processing-gated cascade and emits, on the shared
 *   bus, ONE `match.cleared` per cascade PASS (carrying its 1-based `pass`) and a
 *   single `cascade.resolved` once the board re-settles. ComboMultiplier listens to
 *   that trace:
 *     - the FIRST clear of a move (pass 1) sets the live multiplier to 1 (the swap
 *       you made — no combo yet);
 *     - each SUBSEQUENT clear (pass 2, 3, …) — a cascade chaining another clear —
 *       STEPS the multiplier up by one level (1 -> 1+step -> 1+2*step -> …), capped,
 *       and emits `combo.increased`;
 *     - when `cascade.resolved` fires (the board settled, no further match), the
 *       multiplier RESETS to 1 for the next move, emitting `combo.reset`.
 *   So the multiplier is a pure function of how deep the cascade chained — the
 *   "id" of each combo step is the cascade depth (the rule's `pass` number).
 *
 * THE SCORE EFFECT (an OBSERVABLE __GAME__ transition, not a bookkeeping no-op):
 *   each chained clear awards a BONUS on top of the base clear score the rule
 *   already added — `bonus = round(gained * (multiplier - 1))` — pushed onto the
 *   live registry score. So a deep cascade scores strictly more than the same gems
 *   cleared one swap at a time, the genre's defining reward. The base clear score
 *   stays owned by SwapMatch; this system adds ONLY the combo premium.
 *
 * Observables (its OWN real value, on the pull channel):
 *   __GAME__.comboMultiplier — the live multiplier (1 between moves; rises across a
 *   single move's cascade; back to 1 once settled).
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, never a fabricated game number):
 *   step      how much each extra cascade level adds to the multiplier (default 0.5,
 *             i.e. x1 -> x1.5 -> x2 -> x2.5 …).
 *   maxMultiplier  the multiplier ceiling so a pathological board cannot run away
 *             (default 8).
 *
 * THE SEAM: the system subscribes to the bound rule's cascade trace on the shared
 * eventBus (`match.cleared` / `cascade.resolved`) in attach(), and tears the
 * subscriptions down / re-arms on reset() (restart-safe). It owns no input loop —
 * it is a pure REACTION to the move resolver, like MergeSlideGoal reacts to onMove.
 *
 * GENERIC: no game/theme/board size is encoded — a TYPE bound by id. step and
 * maxMultiplier are declared defaults a blueprint overrides via params.
 */
import type { IGridSystem } from '../scenes/grid-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (globbed by registry/discover.mjs — mirrors MineReveal). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ComboMultiplier',
  intent:
    'Match-3 consecutive-cascade score multiplier: rises with cascade depth within one move (each chained clear steps it up + awards a combo bonus), resets to 1 when the board settles with no further match. Listens to the SwapMatch cascade trace; published as __GAME__.comboMultiplier.',
  attachesTo: 'scene',
  params: ['step', 'maxMultiplier'],
  roles: ['board'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** DECLARED defaults (never a fabricated per-game number). */
const DEFAULT_STEP = 0.5;
const DEFAULT_MAX_MULTIPLIER = 8;

export interface ComboMultiplierConfig {
  /** Multiplier added per extra cascade level (default 0.5: x1 -> x1.5 -> x2 …). */
  step?: number;
  /** The multiplier ceiling (default 8) — a runaway-cascade guard. */
  maxMultiplier?: number;
}

export class ComboMultiplier implements IGridSystem {
  private scene: any;
  private readonly step: number;
  private readonly maxMultiplier: number;

  /** OWN observable — the live multiplier (read by surface().observables). */
  public comboMultiplier = 1;
  /** Cascade passes seen in the CURRENT move (0 between moves; 1 = the swap clear). */
  private clearsThisMove = 0;
  /** The bus unsubscribe fns, torn down on reset (restart-safe). */
  private unsubscribers: Array<() => void> = [];

  /** The shared event bus, resolved from the attached scene. Publish via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  constructor(params: ComboMultiplierConfig = {}) {
    const s = typeof params.step === 'number' && params.step > 0 ? params.step : DEFAULT_STEP;
    const m =
      typeof params.maxMultiplier === 'number' && params.maxMultiplier >= 1
        ? params.maxMultiplier
        : DEFAULT_MAX_MULTIPLIER;
    this.step = s;
    this.maxMultiplier = m;
  }

  /** Re-arm to a fresh-move state (scene calls reset() before attach on a RESTART). */
  reset(): void {
    for (const off of this.unsubscribers) {
      try {
        off();
      } catch {
        /* a stale unsubscribe must never break a restart */
      }
    }
    this.unsubscribers = [];
    this.comboMultiplier = 1;
    this.clearsThisMove = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    const bus = scene?.eventBus;
    if (!bus?.on) return;

    // Each cascade pass clears a run; pass 1 is the swap itself, pass 2+ is a
    // cascade chaining another clear (the combo).
    this.unsubscribers.push(
      bus.on('match.cleared', (payload: any) => this.onClear(payload)),
    );
    // The board re-settled with no further match -> the combo is over.
    this.unsubscribers.push(
      bus.on('cascade.resolved', () => this.onSettle()),
    );
  }

  // ── the combo seam (a reaction to the bound rule's cascade trace) ────────────

  /**
   * A cascade pass cleared a run. The first clear of a move (pass 1) is the swap —
   * multiplier stays 1, no combo. Each subsequent chained clear STEPS the multiplier
   * up one level (capped at maxMultiplier), awards the combo bonus on top of the base
   * clear score, and emits 'combo.increased'.
   */
  private onClear(payload: any): void {
    this.clearsThisMove += 1;

    // The first clear is the swap itself — no combo multiplier yet.
    if (this.clearsThisMove <= 1) {
      this.comboMultiplier = 1;
      return;
    }

    // A cascade chained another clear: step the multiplier up (cascade depth - 1 levels).
    const level = this.clearsThisMove - 1; // 1 for the first chained clear, 2 for the next …
    const next = Math.min(this.maxMultiplier, 1 + level * this.step);
    const rose = next > this.comboMultiplier;
    this.comboMultiplier = next;

    // The combo PREMIUM on top of the base clear score the rule already added —
    // the observable reward that makes a deep cascade worth more (real score effect).
    const gained = typeof payload?.gained === 'number' ? payload.gained : 0;
    const bonus = Math.round(gained * (this.comboMultiplier - 1));
    if (bonus > 0) this.addScore(bonus);

    if (rose) {
      this.bus?.emit('combo.increased', {
        multiplier: this.comboMultiplier,
        depth: this.clearsThisMove,
        bonus,
      });
    }
  }

  /**
   * The cascade settled (no further match). End the combo: reset the per-move pass
   * counter, and — if a combo had built (multiplier > 1) — drop the multiplier back to
   * 1 and emit 'combo.reset' so the next move starts clean.
   */
  private onSettle(): void {
    this.clearsThisMove = 0;
    if (this.comboMultiplier !== 1) {
      this.comboMultiplier = 1;
      this.bus?.emit('combo.reset', { multiplier: 1 });
    }
  }

  /** Add a delta to the live registry score (the same store SwapMatch/the scene use). */
  private addScore(delta: number): void {
    const reg = this.scene?.registry;
    if (!reg?.get || !reg?.set) return;
    const score = (reg.get('score') as number) + delta;
    reg.set('score', score);
    // Mirror the engine's score.changed moment so HUD/guidance see the combo premium.
    this.bus?.emit('score.changed', { score });
  }

  // ── component surface (the declared event + observable set) ────────────────────

  /**
   * The combo system's surface. Each EventDecl is a TRUE statement about a real
   * .emit() site: 'combo.increased' in onClear (a cascade chains another clear),
   * 'combo.reset' in onSettle (the cascade settles with no further match).
   */
  surface(): ComponentSurface {
    return {
      observables: {
        comboMultiplier: () => this.comboMultiplier,
      },
      anchors: [],
      events: [
        {
          name: 'combo.increased',
          payload: '{multiplier,depth,bonus}',
          scope: 'archetype',
          drivenBy: 'a cascade chains another clear',
          expect: '__GAME__ multiplier rises (comboMultiplier > 1); combo.increased logged',
        },
        {
          name: 'combo.reset',
          payload: '{multiplier}',
          scope: 'archetype',
          drivenBy: 'the cascade settles with no further match',
          expect: '__GAME__ multiplier returns to 1 (comboMultiplier === 1); combo.reset logged',
        },
      ],
    };
  }
}
