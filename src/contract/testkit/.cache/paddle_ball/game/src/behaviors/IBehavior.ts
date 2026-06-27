/**
 * IBehavior — the behavior-component interface for paddle_ball (KEEP — engine seam).
 *
 * Behaviors are reusable pieces of game logic composed onto an entity (the paddle, a
 * future power-up target) rather than baked into a class hierarchy. Mirrors top_down's
 * behaviors/IBehavior.ts so a behavior promotes cleanly between modules.
 */
import type { EventBus } from '@contract/component-surface';

export interface IBehavior {
  /** Whether this behavior is currently active. */
  enabled: boolean;
  /** Called when the behavior is attached to an owner (set up references). */
  attach(owner: any): void;
  /** Called when the behavior is removed (clean up references). */
  detach(): void;
  /** Called every frame when enabled. */
  update(): void;
}

/** Abstract base providing the common attach/detach/owner plumbing. */
export abstract class BaseBehavior implements IBehavior {
  public enabled = true;
  protected owner: any = null;

  attach(owner: any): void {
    this.owner = owner;
    this.onAttach();
  }
  detach(): void {
    this.onDetach();
    this.owner = null;
  }
  abstract update(): void;

  protected onAttach(): void {}
  protected onDetach(): void {}

  /** The shared event bus, resolved from the owner's scene. Publish moments via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  protected get bus(): EventBus | undefined {
    return (this.owner as any)?.scene?.eventBus;
  }

  protected getOwner<T = any>(): T {
    if (!this.owner) throw new Error(`${this.constructor.name}: not attached to an owner`);
    return this.owner as T;
  }
  isAttached(): boolean {
    return this.owner !== null;
  }
}
