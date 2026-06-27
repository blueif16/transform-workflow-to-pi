/**
 * IBehavior — interface for behavior components (KEEP — engine seam).
 *
 * Behaviors are reusable pieces of game logic attached to an entity (the avatar).
 * They follow the Component pattern: an entity is COMPOSED of behaviors rather than
 * inheriting a deep class hierarchy. Identical seam to platformer/top_down so a
 * behavior promotes cleanly across modules.
 *
 * Lifecycle: attach(owner) → update() each frame → detach(). A behavior should be
 * stateless where possible (config-driven), so a restarted run re-instantiates it
 * fresh with no leaked state.
 */

import type { EventBus } from '@contract/component-surface';

export interface IBehavior {
  /** Whether this behavior is currently active. */
  enabled: boolean;
  /** Called when the behavior is attached to an owner (set up references). */
  attach(owner: any): void;
  /** Called when the behavior is removed (clean up references). */
  detach(): void;
  /** Called every frame when enabled (the behavior logic). */
  update(): void;
}

/**
 * BaseBehavior — abstract base providing the common attach/detach plumbing. Extend
 * this to create a new behavior; implement update() + (optionally) onAttach/onDetach.
 */
export abstract class BaseBehavior implements IBehavior {
  public enabled = true;
  protected owner: any = null;

  /** The shared event bus, resolved from the owner's scene. Publish moments via
   *  `this.bus?.emit('<name>', payload)` — the ONE canonical vocabulary. */
  protected get bus(): EventBus | undefined {
    return (this.owner as any)?.scene?.eventBus;
  }

  attach(owner: any): void {
    this.owner = owner;
    this.onAttach();
  }

  detach(): void {
    this.onDetach();
    this.owner = null;
  }

  abstract update(): void;

  protected onAttach(): void {
    // Override in subclasses.
  }

  protected onDetach(): void {
    // Override in subclasses.
  }

  protected getOwner<T = any>(): T {
    if (!this.owner) {
      throw new Error(`${this.constructor.name}: Not attached to an owner`);
    }
    return this.owner as T;
  }

  isAttached(): boolean {
    return this.owner !== null;
  }
}
