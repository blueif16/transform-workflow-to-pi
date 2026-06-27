import type { IBehavior } from './IBehavior';

/**
 * BehaviorManager — composes behavior components onto an entity (KEEP — engine seam).
 * Adds/removes behaviors, ticks every enabled one each frame, exposes access by name.
 * Identical seam to platformer/top_down so a behavior promotes cleanly.
 *
 *   this.behaviors = new BehaviorManager(this);
 *   this.movement = this.behaviors.add('movement', new GravityFlapMovement(cfg));
 *   // in update: this.behaviors.update();
 */
export class BehaviorManager {
  private owner: any;
  private behaviors: Map<string, IBehavior> = new Map();

  constructor(owner: any) {
    this.owner = owner;
  }

  add<T extends IBehavior>(name: string, behavior: T): T {
    if (this.behaviors.has(name)) this.remove(name);
    behavior.attach(this.owner);
    this.behaviors.set(name, behavior);
    return behavior;
  }

  get<T extends IBehavior>(name: string): T | undefined {
    return this.behaviors.get(name) as T | undefined;
  }

  has(name: string): boolean {
    return this.behaviors.has(name);
  }

  remove(name: string): boolean {
    const behavior = this.behaviors.get(name);
    if (behavior) {
      behavior.detach();
      this.behaviors.delete(name);
      return true;
    }
    return false;
  }

  update(): void {
    for (const behavior of this.behaviors.values()) {
      if (behavior.enabled) behavior.update();
    }
  }

  clear(): void {
    for (const [name] of this.behaviors) this.remove(name);
  }

  getAll(): IBehavior[] {
    return Array.from(this.behaviors.values());
  }
}
