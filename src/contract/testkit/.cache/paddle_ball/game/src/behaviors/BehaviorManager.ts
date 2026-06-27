/**
 * BehaviorManager — composes IBehaviors onto an owner entity (KEEP — engine seam).
 * Mirrors top_down's behaviors/BehaviorManager.ts (the minimal add/get/update surface
 * the data-driven loader uses to attach bound behaviors to the paddle).
 */
import type { IBehavior } from './IBehavior';

export class BehaviorManager {
  private readonly owner: any;
  private readonly behaviors = new Map<string, IBehavior>();

  constructor(owner: any) {
    this.owner = owner;
  }

  /** Add (and attach) a behavior under a key; returns the behavior for chaining. */
  add<T extends IBehavior>(key: string, behavior: T): T {
    behavior.attach(this.owner);
    this.behaviors.set(key, behavior);
    return behavior;
  }

  /** Get a behavior by key. */
  get<T extends IBehavior = IBehavior>(key: string): T | undefined {
    return this.behaviors.get(key) as T | undefined;
  }

  /** Every attached behavior. */
  getAll(): IBehavior[] {
    return [...this.behaviors.values()];
  }

  /** Tick every enabled behavior (called from the owner's / scene's update loop). */
  update(): void {
    for (const b of this.behaviors.values()) {
      if (b.enabled) b.update();
    }
  }
}
