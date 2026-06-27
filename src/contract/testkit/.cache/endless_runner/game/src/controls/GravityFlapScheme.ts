/**
 * ============================================================================
 * GravityFlapScheme.ts — the one-button FLAP input scheme (BUILD — control-scheme)
 * ============================================================================
 *
 * The `endless_runner:gravity-flap` control scheme (`controlScheme: 'gravity-flap-1btn'`).
 * An endless runner introduces a NEW engine with NO scene-owned input to reuse (unlike
 * top_down, whose schemes are records over already-sensed keys) — so, like the voxel
 * KbmScheme, this scheme SENSES raw DOM events itself and drains them into a single
 * one-shot intent: FLAP. One button, the whole game.
 *
 * HEADLESS-DRIVEABLE (load-bearing for the controllable proof + the verify harness):
 * the scheme listens for real `keydown` (Space / ArrowUp / W), `pointerdown`, and
 * `touchstart`. A harness fires a real `keydown` → the scheme queues a flap → the scene
 * drains it and calls `GravityFlapMovement.flap()` → the avatar's vy jumps negative
 * (the controllable proof). The flap is EDGE-triggered (one per press, drained once) so
 * holding the button does not auto-flap — exactly the Flappy Bird input model.
 *
 * GENERIC: it senses inputs and produces a flap intent — no game, no theme, no obstacle
 * knowledge. The scene owns WHAT a flap does; this scheme only senses WHEN.
 */

/** The per-frame input intent this scheme produces (drained by the scene). */
export interface FlapInput {
  /** True iff a flap was pressed since the last drain (edge — one per press). */
  flap: boolean;
}

export class GravityFlapScheme {
  /** The DOM target raw events are sensed on (window for keys; canvas for pointer). */
  private readonly canvas: HTMLCanvasElement | undefined;
  /** Edge-triggered flap (set on a flap input, drained once by sample()). */
  private flapQueued = false;

  /** The key names that flap (Space + the up keys — the one-button binding). */
  private static readonly FLAP_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W']);

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  private keyDown = (e: KeyboardEvent) => {
    if (GravityFlapScheme.FLAP_KEYS.has(e.key) || e.code === 'Space' || e.code === 'ArrowUp') {
      this.flapQueued = true;
      // Space scrolls the page by default — suppress it so a flap never janks the view.
      if (e.code === 'Space') e.preventDefault();
    }
  };
  private pointerDown = () => {
    // A tap / click anywhere is a flap (mobile + desktop pointer).
    this.flapQueued = true;
  };
  private touchStart = (e: TouchEvent) => {
    this.flapQueued = true;
    // Suppress the synthetic mouse + scroll so one tap is exactly one flap.
    if (e.cancelable) e.preventDefault();
  };

  /** Attach the DOM listeners (call once the run has started). */
  attach(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.keyDown);
    const target: EventTarget = this.canvas ?? window;
    target.addEventListener('pointerdown', this.pointerDown as EventListener);
    target.addEventListener('touchstart', this.touchStart as EventListener, { passive: false } as AddEventListenerOptions);
  }

  /** Detach the DOM listeners (teardown / restart). */
  detach(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('keydown', this.keyDown);
    const target: EventTarget = this.canvas ?? window;
    target.removeEventListener('pointerdown', this.pointerDown as EventListener);
    target.removeEventListener('touchstart', this.touchStart as EventListener);
  }

  /**
   * Drain the per-frame intent: returns `{flap}` and clears the queued edge, so a flap
   * fires EXACTLY once per press (holding the button does not repeat-flap). The scene
   * calls this every frame and, on `flap`, calls the avatar's GravityFlapMovement.flap().
   */
  sample(): FlapInput {
    const flap = this.flapQueued;
    this.flapQueued = false;
    return { flap };
  }
}
