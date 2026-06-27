/**
 * PaddleGrow — the timed paddle-grow power-up (BUILD — system; brick-breaker genre).
 *
 * A classic brick-breaker power-up: when the player collects a grow pickup, the paddle
 * WIDENS by a factor for a timed window, making the ball easier to keep in play, then
 * REVERTS to its base width when the window expires. Re-collecting while already grown
 * REFRESHES the window (the timer restarts) rather than stacking the width.
 *
 * The OBSERVABLE __GAME__ effect this owns:
 *   - the paddle's display width increases on activation (read live via __GAME__.player
 *     displayWidth) and returns to its base width after `durationMs`.
 *
 * It re-implements NOTHING the engine owns: the paddle sprite + its PaddleController
 * clamp live in DataPaddleScene; this system only resizes the sprite and RE-CLAMPS the
 * controller's travel range so the wider paddle still stays inside the play field.
 *
 * The COLLECTION seam is `activate()` — the scene (or a pickup overlap, or the
 * runtime `check-exposes` driver) calls `scene.paddleGrow.activate()` when a grow
 * power-up is collected; the timed revert is driven by this system's own update().
 *
 * Params (all OPTIONAL — declared defaults, never a baked map):
 *   growFactor  multiplier applied to the paddle's base width on activation (default 1.6).
 *   durationMs  how long the grown window lasts before reverting, ms (default 8000).
 */
import type { ISceneSystem } from '../scenes/paddle-data';
import type { ComponentSurface, EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors every system file). */
export const CAPABILITY = {
  kind: 'system',
  id: 'PaddleGrow',
  intent:
    'A timed paddle-grow power-up: when a grow pickup is collected, widen the paddle by a configured factor for a configured window (re-collecting REFRESHES the window, never stacks the width), then revert to the base width and re-clamp the paddle controller so the wider bat still stays inside the play field. The brick-breaker "wider paddle" power-up.',
  attachesTo: 'scene',
  params: ['growFactor', 'durationMs'],
  roles: ['paddle'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface PaddleGrowConfig {
  growFactor?: number;
  durationMs?: number;
}

export class PaddleGrow implements ISceneSystem {
  private scene: any;
  /** The paddle's natural (un-grown) display width, captured on attach. */
  private baseWidth = 0;
  /** Whether the grow window is currently active. */
  private grown = false;
  /** Wall-clock ms at which the active window reverts (only meaningful while grown). */
  private expiresAt = 0;
  private readonly growFactor: number;
  private readonly durationMs: number;

  constructor(params: PaddleGrowConfig = {}) {
    this.growFactor = params.growFactor ?? 1.6;
    this.durationMs = params.durationMs ?? 8000;
  }

  /** The shared event bus (the scene owns it; attach() set this.scene). */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  /** Re-arm to a fresh-level state so a restarted level starts at the base width. */
  reset(): void {
    this.grown = false;
    this.expiresAt = 0;
    this.baseWidth = 0;
  }

  /** Capture the paddle base width + publish the collection seam under a stable name. */
  attach(scene: any): void {
    this.scene = scene;
    // Publish the read/drive seam so the scene (a pickup overlap, or the runtime
    // check-exposes driver) can collect a grow power-up via scene.paddleGrow.activate().
    scene.paddleGrow = this;
    this.baseWidth = scene.paddle?.displayWidth ?? scene.paddle?.width ?? 96;
  }

  /** No Arcade overlap of its own — the collection arrives via activate(). */
  setupCollisions(): void {}

  /**
   * COLLECT a grow power-up: widen the paddle to base*growFactor for durationMs and
   * arm the revert. Re-collecting while grown REFRESHES the window (restarts the timer)
   * without re-stacking the width. The OBSERVABLE seam: __GAME__.player displayWidth
   * increases now and reverts when the window expires.
   */
  activate(): void {
    const paddle = this.scene?.paddle;
    if (!paddle) return;
    if (!this.grown) {
      // capture the base lazily if attach ran before the paddle existed
      if (this.baseWidth <= 0) this.baseWidth = paddle.displayWidth ?? paddle.width ?? 96;
      this.setPaddleWidth(this.baseWidth * this.growFactor);
      this.grown = true;
    }
    // (re)arm the window — a refresh restarts the clock, never stacks the width.
    this.expiresAt = this.now() + this.durationMs;
    // The true gameplay seam: a grow power-up was activated; the paddle is now wider for
    // a timed window. Lean, JSON-serializable payload (the width + the window length).
    this.bus?.emit('powerup.activated', {
      kind: 'paddleGrow',
      width: paddle.displayWidth,
      durationMs: this.durationMs,
    });
  }

  /** Per-frame: revert the paddle once the active grow window has elapsed. */
  update(): void {
    if (!this.grown) return;
    if (this.now() >= this.expiresAt) {
      this.setPaddleWidth(this.baseWidth);
      this.grown = false;
    }
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /**
   * Resize the paddle sprite AND re-clamp its PaddleController travel range so the new
   * half-width still keeps the bat inside the play field (mirrors how DataPaddleScene
   * clamps the controller from the play-field bounds at create time).
   */
  private setPaddleWidth(width: number): void {
    const scene = this.scene;
    const paddle = scene?.paddle;
    if (!paddle) return;
    const h = paddle.displayHeight ?? paddle.height ?? 18;
    paddle.setDisplaySize?.(width, h);
    // Re-clamp the controller so a wider paddle cannot poke through a side wall.
    const controller: any = paddle.behaviors?.get?.('control');
    if (controller) {
      const inset = scene._wallInset ?? 16;
      if (controller.axis === 'x') {
        controller.min = inset + width / 2;
        controller.max = (scene.mapWidth ?? 0) - inset - width / 2;
      } else {
        controller.min = inset + h / 2;
        controller.max = (scene.mapHeight ?? 0) - inset - h / 2;
      }
    }
  }

  /** Monotonic-ish ms clock (the Phaser scene clock when present, else wall clock). */
  private now(): number {
    return this.scene?.time?.now ?? Date.now();
  }

  // ── component surface (the declared PUSH-channel event set) ──────────────────

  /**
   * The event this system publishes. `powerup.activated` is a TRUE statement about the
   * real emit site in activate(): collecting a grow power-up widens the paddle for a
   * timed window (observable via __GAME__.player displayWidth) and the event is logged;
   * the window then reverts in update().
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'powerup.activated',
          payload: '{kind,width,durationMs}',
          scope: 'archetype',
          drivenBy: 'a paddle-grow power-up is collected (scene.paddleGrow.activate())',
          expect:
            '__GAME__.player display width increases for a timed window then reverts to the base width; powerup.activated logged',
        },
      ],
    };
  }
}
