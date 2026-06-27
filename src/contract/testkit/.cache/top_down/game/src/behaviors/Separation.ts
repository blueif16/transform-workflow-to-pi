import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';

/**
 * Separation — Reynolds separation steering (BUILD — net-new, RB §2.3).
 *
 * The crowd genre's missing piece: composed ON THE SAME enemy as `ChaseAI`, it
 * keeps a swarm of chasers from collapsing onto one point. Each frame it sums a
 * repulsion force away from every nearby same-group neighbour
 * (`force += normalize(self.pos - other.pos) / dist`, the inverse-distance
 * Reynolds rule), normalizes it, scales it by `weight`, and NUDGES the owner's
 * velocity along it. ChaseAI sets the seek velocity toward the player; Separation
 * runs AFTER it (later in the behavior list) and adds the spacing push on top —
 * the two compose, neither rewrites the other.
 *
 * It reads its neighbours from the owner's scene group (default `enemies`) so it
 * needs no per-game wiring: drop `{ref:'Separation', params}` next to
 * `{ref:'ChaseAI', params}` on a threat and the swarm spreads. The owner never
 * needs a target — Separation only senses neighbours, so it is also a valid
 * stand-alone flocking primitive.
 *
 * GENERIC: every number is a PARAM (radius/weight/maxNudge/group). No game/theme
 * and no entity coordinate is encoded — placement and counts come from the level
 * DATA, the spacing from these params.
 *
 * Usage (a contested chaser, bound from layout):
 *   threats[].behaviors = [
 *     { ref: 'ChaseAI',    params: { speed: 90 } },
 *     { ref: 'Separation', params: { radius: 56, weight: 0.9 } },
 *   ]
 */
export interface SeparationConfig {
  /**
   * Neighbour-detection radius in px (default 48). Neighbours closer than this
   * push the owner away; farther ones are ignored.
   */
  radius?: number;
  /**
   * Push strength 0..1+ (default 0.8). 0 disables separation entirely (the
   * verify "weight 0 ⇒ enemies clump" contrast). Higher = stronger spacing.
   */
  weight?: number;
  /**
   * Max fraction of the owner's current speed re-aimed by the push per frame
   * (default 1). Caps how hard separation can override the seek so a chaser
   * still advances toward its target while spacing out.
   */
  maxNudge?: number;
  /**
   * The scene group name to read neighbours from (default 'enemies'). Generic —
   * a different crowd group binds a different name.
   */
  group?: string;
}

export class Separation extends BaseBehavior {
  public radius: number;
  public weight: number;
  public maxNudge: number;
  public group: string;

  constructor(config: SeparationConfig = {}) {
    super();
    this.radius = config.radius ?? 48;
    this.weight = config.weight ?? 0.8;
    this.maxNudge = config.maxNudge ?? 1;
    this.group = config.group ?? 'enemies';
  }

  update(): void {
    if (this.weight <= 0) return; // disabled — the swarm clumps (the contrast case)

    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    const body = owner.body as Phaser.Physics.Arcade.Body | undefined;
    if (!body || !owner.scene) return;

    const grp = (owner.scene as any)[this.group];
    const neighbours: any[] =
      grp && typeof grp.getChildren === 'function' ? grp.getChildren() : [];

    // Sum the inverse-distance repulsion from every neighbour inside `radius`.
    let fx = 0;
    let fy = 0;
    const r2 = this.radius * this.radius;
    for (const other of neighbours) {
      if (other === owner || !other || other.active === false) continue;
      const dx = owner.x - other.x;
      const dy = owner.y - other.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= 1e-6 || d2 > r2) continue;
      const d = Math.sqrt(d2);
      // normalize(self - other) / dist — closer neighbours push harder.
      fx += dx / d / d;
      fy += dy / d / d;
    }

    if (fx === 0 && fy === 0) return;

    // Normalize the accumulated push to a unit direction, then scale by weight.
    const fmag = Math.sqrt(fx * fx + fy * fy);
    const ux = fx / fmag;
    const uy = fy / fmag;

    // Blend the push onto the owner's current velocity, preserving its speed so a
    // chaser keeps advancing — only its DIRECTION is re-aimed (observable: pairwise
    // spacing grows, not the speed). When the owner is idle (no seek), the push
    // itself becomes the velocity scaled by the owner's own speed (a flocking-only
    // owner spreads at a sane pace, never explodes).
    const vx = body.velocity.x;
    const vy = body.velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const ref = speed > 1 ? speed : (owner as any).speed ?? 60;

    const nudge = Math.min(1, Math.max(0, this.maxNudge)) * this.weight;
    const nx = vx * (1 - nudge) + ux * ref * nudge;
    const ny = vy * (1 - nudge) + uy * ref * nudge;

    // Re-normalize to the reference speed so the blend never slows the chaser
    // (direction changes; magnitude is preserved). This is what makes the swarm
    // spread WITHOUT stalling.
    const nmag = Math.sqrt(nx * nx + ny * ny);
    if (nmag <= 1e-6) return;
    body.velocity.x = (nx / nmag) * ref;
    body.velocity.y = (ny / nmag) * ref;
  }
}
