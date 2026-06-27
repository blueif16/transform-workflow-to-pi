/**
 * DiveBomb — the formation enemy that PEELS OFF on a dive-attack run (BUILD — the
 * Galaga "formation" genre engine piece). Where FormationMarch animates the rack as
 * one rigid body and EntrySpline flies members IN to their slots, DiveBomb is the
 * layer that breaks a SINGLE member OUT of the settled rack: on a per-member cadence
 * the enemy leaves its formation slot, swoops down a curved attack path toward the
 * player's position, and then either RETURNS to its slot (re-joining the rack) or
 * EXITS off the bottom of the arena.
 *
 * It is a BEHAVIOR attached to ONE formation member sprite (the owner), not a
 * scene system — so each diving enemy carries its own dive clock and trajectory and
 * many members can peel off independently. It cooperates with FormationMarch by
 * TOGGLING the owner's `.__formation` tag: while diving the member clears the tag, so
 * FormationMarch stops marching it (the rack steps without it); on a RETURN it
 * restores the tag and snaps back to its slot, re-joining the body.
 *
 * The dive cycle (per member):
 *   1. IDLE in the rack — accumulate toward the next dive on a jittered cadence; the
 *      member is part of the formation (FormationMarch owns its position).
 *   2. PEEL OFF — capture the current slot, lock the player's x/y as the dive TARGET,
 *      clear `.__formation` (FormationMarch releases it), flag `.__diving`, and emit
 *      enemy.dived. The member is now on its own attack path.
 *   3. DIVE — fly along a quadratic-Bézier path (slot → a bowed control point → past
 *      the player) so the swoop is a CURVE, not a straight line. The body stays
 *      collidable so a player shot can kill it mid-dive.
 *   4. RESOLVE — once the path completes: if the member has fallen below the arena it
 *      EXITS (killed/parked off-screen); otherwise it RETURNS to its rack slot, sets
 *      `.__formation` back, clears `.__diving`, and resumes the idle clock.
 *
 * GENERIC: no game/theme, no baked coordinate — the slot is the member's live
 * position at peel-off and the target is the live player position; cadence / dive
 * duration / bow / exit behaviour come from params. A member with no scene/player is
 * a clean no-op (it just stays in the rack).
 *
 * ID-SOURCE: the `id` payload field is AUTO-DERIVED from the bound entity — the owner
 * formation member's engine-assigned `.__id` (DataShooterScene.spawnMember sets
 * `inv_<row>_<col>_<n>`), never a fabricated config id.
 *
 * EVENT (the PUSH channel):
 *   - enemy.dived ← peelOff (a formation member starts a dive run; leaves the rack)
 *
 * Params (the {ref,params} binding, all OPTIONAL — sensible declared defaults):
 *   diveDelayMs    base idle time in the rack before this member dives (default 4000).
 *   diveJitterMs   random extra idle added to the base (so members don't sync; default 3000).
 *   diveMs         ms the member takes to fly its full dive path (default 1400).
 *   bowPx          lateral bow of the dive control point off the straight line (default 90).
 *   diveChance     0..1 probability a due member actually commits to a dive (default 1).
 *   exitOnPass     when true, a member that dives past the player EXITS instead of
 *                  returning to its slot (default false = boomerang back).
 */
import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import { type ComponentSurface } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'DiveBomb',
  intent:
    'A settled formation member PEELS OFF on a jittered cadence, swoops down a curved Bézier attack path toward the player, then returns to its rack slot or exits off-screen — the Galaga dive-bomb run. Cooperates with FormationMarch by toggling the member’s formation tag while diving.',
  params: ['diveDelayMs', 'diveJitterMs', 'diveMs', 'bowPx', 'diveChance', 'exitOnPass'],
  roles: ['enemy', 'player'],
} as const;

export const BEHAVIOR_CAPABILITIES = [CAPABILITY] as const;

export interface DiveBombConfig {
  diveDelayMs?: number;
  diveJitterMs?: number;
  diveMs?: number;
  bowPx?: number;
  diveChance?: number;
  exitOnPass?: boolean;
}

/** The owner's dive phase. */
type DivePhase = 'idle' | 'diving';

export class DiveBomb extends BaseBehavior {
  private readonly diveDelayMs: number;
  private readonly diveJitterMs: number;
  private readonly diveMs: number;
  private readonly bowPx: number;
  private readonly diveChance: number;
  private readonly exitOnPass: boolean;

  /** The current phase of this member's dive cycle. */
  private phase: DivePhase = 'idle';
  /** ms accumulated toward the next dive (idle phase). */
  private idleAcc = 0;
  /** the jittered idle target for THIS cycle (re-rolled each idle). */
  private nextDiveAt = 0;
  /** ms elapsed against the current dive flight clock. */
  private t = 0;

  /** The rack SLOT this member peeled off from (the return target). */
  private sx = 0;
  private sy = 0;
  /** The curved control point of the dive path (slot/target midpoint, bowed). */
  private cx = 0;
  private cy = 0;
  /** The dive END point (past the player, lower on the arena). */
  private ex = 0;
  private ey = 0;

  constructor(config: DiveBombConfig = {}) {
    super();
    this.diveDelayMs = Math.max(0, config.diveDelayMs ?? 4000);
    this.diveJitterMs = Math.max(0, config.diveJitterMs ?? 3000);
    this.diveMs = Math.max(1, config.diveMs ?? 1400);
    this.bowPx = config.bowPx ?? 90;
    this.diveChance = Math.min(1, Math.max(0, config.diveChance ?? 1));
    this.exitOnPass = config.exitOnPass ?? false;
  }

  /** Seed this member's first jittered idle clock once it is attached. */
  protected override onAttach(): void {
    this.rollNextDive();
  }

  private rollNextDive(): void {
    this.idleAcc = 0;
    this.nextDiveAt = this.diveDelayMs + Math.random() * this.diveJitterMs;
  }

  /** The scene that owns the member (Phaser sprites carry `.scene`). */
  private getScene(): any {
    const owner = this.owner as Phaser.GameObjects.GameObject | null;
    return owner ? (owner as any).scene ?? null : null;
  }

  /** Quadratic Bézier point at parameter u∈[0,1] over (a → c → b). */
  private bezier(a: number, c: number, b: number, u: number): number {
    const iu = 1 - u;
    return iu * iu * a + 2 * iu * u * c + u * u * b;
  }

  update(): void {
    const owner = this.owner as any;
    const scene = this.getScene();
    if (!owner || owner.isDead || owner.active === false || !scene) return;
    const dtMs = scene.game?.loop?.delta ?? 16.67;

    if (this.phase === 'idle') {
      this.tickIdle(owner, scene, dtMs);
    } else {
      this.tickDive(owner, scene, dtMs);
    }
  }

  /** Count down to the next dive while the member is settled in the rack. */
  private tickIdle(owner: any, scene: any, dtMs: number): void {
    // Only dive once SETTLED in the rack (not still flying its entry spline).
    if (owner.__entering) return;
    this.idleAcc += dtMs;
    if (this.idleAcc < this.nextDiveAt) return;

    // Due to dive — roll the commit chance; on a skip, wait another jittered cycle.
    if (Math.random() > this.diveChance) {
      this.rollNextDive();
      return;
    }
    this.peelOff(owner, scene);
  }

  /**
   * PEEL OFF: capture the slot, lock the player as the dive target, build the curved
   * path, release the member from the rack, and emit enemy.dived (the attack begins).
   */
  private peelOff(owner: any, scene: any): void {
    const player = scene.player;
    // The slot is the member's live rack position (the return/anchor point).
    this.sx = owner.x;
    this.sy = owner.y;
    // Aim at the player's current position; with no player, dive straight down.
    const W = scene.mapWidth ?? scene.scale?.width ?? 432;
    const H = scene.mapHeight ?? scene.scale?.height ?? 768;
    const targetX = player && player.active !== false ? player.x : this.sx;
    const targetY = player && player.active !== false ? player.y : H * 0.85;
    // The dive END continues PAST the player toward/below the arena floor.
    this.ex = Phaser.Math.Clamp(targetX + (targetX - this.sx) * 0.4, 8, W - 8);
    this.ey = H + 48; // off the bottom edge — a full swoop past the player row.
    // Bow the control point laterally so the path is a CURVE, not a straight line.
    const midX = (this.sx + this.ex) / 2;
    const midY = (this.sy + targetY) / 2;
    const bowDir = this.sx <= targetX ? 1 : -1;
    this.cx = midX + bowDir * this.bowPx;
    this.cy = midY;

    this.phase = 'diving';
    this.t = 0;
    owner.__formation = false; // FormationMarch releases this member (rack steps without it).
    owner.__diving = true;

    // The PUSH seam: this formation member started a dive run (it leaves the rack).
    this.bus?.emit('enemy.dived', {
      id: owner.__id,
      x: this.sx,
      y: this.sy,
      targetX,
      targetY,
    });
  }

  /** Fly the member one step along its dive path; on completion, return or exit. */
  private tickDive(owner: any, scene: any, dtMs: number): void {
    this.t += dtMs;
    const u = Math.min(1, this.t / this.diveMs);
    owner.x = this.bezier(this.sx, this.cx, this.ex, u);
    owner.y = this.bezier(this.sy, this.cy, this.ey, u);

    if (u < 1) return;

    // The dive completed. EXIT off the bottom, or BOOMERANG back to the rack slot.
    const H = scene.mapHeight ?? scene.scale?.height ?? 768;
    const wentPast = owner.y >= H;
    if (this.exitOnPass || wentPast) {
      this.exit(owner);
    } else {
      this.returnToRack(owner);
    }
  }

  /** Park the member off-screen and remove it from play (a clean exit). */
  private exit(owner: any): void {
    owner.__diving = false;
    if (typeof owner.kill === 'function') {
      owner.kill();
    } else {
      owner.setActive?.(false);
      if (owner.body) owner.body.enable = false;
    }
  }

  /** Snap the member back to its rack slot and re-join the formation. */
  private returnToRack(owner: any): void {
    owner.x = this.sx;
    owner.y = this.sy;
    owner.__diving = false;
    owner.__formation = true; // FormationMarch owns it again.
    this.phase = 'idle';
    this.rollNextDive();
  }

  /**
   * The PUSH channel this behavior publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - enemy.dived ← peelOff (a formation member starts a dive run; leaves the rack) [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'enemy.dived',
          payload: '{id,x,y,targetX,targetY}',
          scope: 'archetype',
          drivenBy: 'a settled formation member becoming due to dive (its jittered dive clock elapses)',
          expect:
            "the member clears its __formation tag (FormationMarch stops marching it) and flies a curved attack path toward the player's position; enemy.dived logged",
        },
      ],
    };
  }
}
