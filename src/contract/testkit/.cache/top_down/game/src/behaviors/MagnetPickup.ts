import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import type { ComponentSurface } from '@contract/component-surface';

/**
 * CAPABILITY — self-describing registry sidecar (capability-registry-harness).
 * Globbed by the registry build; bound by the blueprint via `id`. EDIT THIS, not
 * capabilities.json. (The top_down BEHAVIOR taxonomy row + the barrel export are
 * added by Integrate — see the report — this const is documenting metadata.)
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'MagnetPickup',
  intent:
    'The magnetized collectible (Geometry Wars / War Robots shard-sweep): a collectible carrying this behavior stays put until the player comes within magnetRadius, then DRIFTS toward the player at an accelerating speed (a gentle ramp, never a teleport) and is auto-collected on contact — crediting its value to __GAME__.score exactly once and removing itself from __GAME__.entities. Couples movement to the collection economy (pairs with ComboMultiplier\'s shard-sweep chain).',
  roles: ['collectible'],
  params: ['magnetRadius', 'pullSpeed', 'pullAccel', 'collectRadius', 'value'],
} as const;

export const BEHAVIOR_CAPABILITIES = [CAPABILITY] as const;

/**
 * MagnetPickup configuration. Every number is a DECLARED default — none is baked
 * from a specific game; a design node tunes these via the capability params.
 */
export interface MagnetPickupConfig {
  /** Range (px) within which the pickup begins drifting toward the player. Default 140. */
  magnetRadius?: number;
  /** Initial drift speed (px/s) the moment the pull starts (the gentle ramp's floor). Default 40. */
  pullSpeed?: number;
  /** Acceleration (px/s²) the drift speed ramps by each second while magnetized. Default 320. */
  pullAccel?: number;
  /** Contact distance (px) at which the pickup is auto-collected. Default 18. */
  collectRadius?: number;
  /**
   * Score credited on collect (default 25). The pickup may override this per-entity
   * via its own `__value` tag (the spawned reward's surfaced value) — see resolveValue.
   */
  value?: number;
}

/**
 * MagnetPickup — the MAGNETIZED-COLLECTIBLE behavior (per-entity; the PushBlock /
 * SplitterEnemy precedent — `roles:['collectible']`).
 *
 * Attaches to a COLLECTIBLE entity (a reward in `scene.decorations`/`rewardsById`).
 * It is the pickup's OWN response to the player approaching:
 *
 *  - OUTSIDE magnetRadius: the pickup stays put (its x/y in __GAME__.entities is
 *    static) — `update()` is a clean no-op.
 *  - The frame the player enters magnetRadius: the pull ARMS — `pickup.magnetized`
 *    fires once and the drift speed re-bases to `pullSpeed`. Each subsequent frame
 *    the pickup translates toward the player by `currentSpeed * dt`, and the speed
 *    RAMPS by `pullAccel * dt` (a gentle accelerating drift, never a teleport). The
 *    pickup's x/y in __GAME__.entities now MOVES toward the player each frame.
 *  - On CONTACT (within collectRadius of the player): it is auto-collected — its
 *    `value` is credited to __GAME__.score exactly once (via the registry 'score',
 *    the single source CollectGoal/ComboMultiplier also write) and it is removed
 *    through the standard `scene.consumeReward()` seam (deletes it from rewardsById +
 *    destroys the sprite → it leaves __GAME__.entities[], also firing the base
 *    `reward.collected`). `pickup.collected` fires at this true collect moment.
 *
 * It re-implements NOTHING the engine owns: the score source is the registry 'score'
 * key the __GAME__ adapter reads; removal goes through scene.consumeReward (exactly
 * like CollectGoal / PickupHeart). The collected pickup id AUTO-DERIVES from the
 * carrier entity's __id (the entity this behavior ATTACHES to) — never a config param.
 *
 * THE PER-FRAME SEAM (why this is in update()). The carrier is a reward the scene
 * ticks via boundBehaviorOwners → owner.behaviors.update() (DataTopDownScene), so the
 * drift + the contact check run each frame the carrier is active — the `move` verb's
 * effect on this pickup is the player closing the distance, and the response is the
 * pickup drifting in. Once consumed the carrier is dropped from boundBehaviorOwners,
 * so the behavior never ticks again (the collect latch backs this up).
 *
 * DRIVE SEAM (for Integrate/Test). Two public verbs run the moment headless WITHOUT
 * a full game loop, mirroring SplitterEnemy.split():
 *   - `pullStep(dt?)` — arm-if-in-range + advance ONE drift step toward the player
 *     (the magnetize → drift moment); fires `pickup.magnetized` the first time it arms.
 *   - `collect()` — run the auto-collect directly (credit score + emit + remove).
 * The driving verb in-game is `move` (the player closes within the magnet radius);
 * these verbs are the same effects, invoked at the seam.
 *
 * GENERIC: no game/theme, no baked coordinate. The radius / speed / accel / value are
 * PARAMS; a scene without `scene.player` (or without a bus / consumeReward) is a clean
 * no-op so nothing breaks. Restart re-arms via reset().
 *
 * Usage (composed on a collectible entity, bound from the blueprint):
 *   reward.behaviors.add('magnet', new MagnetPickup({ magnetRadius: 160, value: 50 }));
 */
export class MagnetPickup extends BaseBehavior {
  // Configuration (declared defaults — never a game-specific constant)
  public magnetRadius: number;
  public pullSpeed: number;
  public pullAccel: number;
  public collectRadius: number;
  public value: number;

  /** True once the player has entered the radius and the pull has armed this run. */
  private magnetized = false;
  /** The live drift speed (px/s) — re-bases to pullSpeed on arm, ramps by pullAccel. */
  private currentSpeed = 0;
  /** Latches true once collected, so score credits + the event fire exactly once. */
  private collected = false;

  constructor(config: MagnetPickupConfig = {}) {
    super();
    this.magnetRadius = positiveOr(config.magnetRadius, 140);
    this.pullSpeed = positiveOr(config.pullSpeed, 40);
    this.pullAccel = positiveOr(config.pullAccel, 320);
    this.collectRadius = positiveOr(config.collectRadius, 18);
    this.value = positiveOr(config.value, 25);
    this.currentSpeed = this.pullSpeed;
  }

  /** Re-arm so a restarted level magnetizes/collects from a clean state. */
  reset(): void {
    this.magnetized = false;
    this.collected = false;
    this.currentSpeed = this.pullSpeed;
  }

  /**
   * Per-frame: while the carrier is alive and uncollected, run ONE drift step toward
   * the player (a no-op outside the radius). The scene-supplied delta drives the ramp.
   */
  update(): void {
    if (this.collected) return;
    const scene = this.owner ? (this.getOwner<any>().scene as any) : null;
    // Scene delta in seconds (game.loop.delta is ms); fall back to a 60fps step.
    const dt = Math.max(0, (scene?.game?.loop?.delta ?? 16.7)) / 1000;
    this.pullStep(dt);
  }

  // ── the drive seams (the `move` verb's two moments) ────────────────────────

  /**
   * Advance ONE drift step (the magnetize → drift verb). Drivable WITHOUT a full game:
   * arms the pull the first frame the player is within magnetRadius (firing
   * `pickup.magnetized` once), then translates the carrier toward the player by
   * currentSpeed*dt and ramps currentSpeed by pullAccel*dt. When the carrier reaches
   * the player (within collectRadius) it auto-collects. Outside the radius (and not yet
   * magnetized) it is a clean no-op — the pickup stays put. Idempotent after collect.
   *
   * @param dt step in seconds (default one 60fps frame); the test can pass a larger dt.
   */
  pullStep(dt = 1 / 60): boolean {
    if (this.collected) return false;
    const owner = this.owner ? this.getOwner<any>() : null;
    if (!owner || owner.active === false) return false;
    const scene = owner.scene as any;
    const player = scene?.player;
    if (!player || player.active === false) return false;

    const dx = (player.x ?? 0) - (owner.x ?? 0);
    const dy = (player.y ?? 0) - (owner.y ?? 0);
    const dist = Math.hypot(dx, dy);

    // Already touching → collect (covers a player that spawns on top of the pickup).
    if (dist <= this.collectRadius) {
      this.collect();
      return true;
    }

    // Outside the radius and not yet pulled in → stay put (no drift, no event).
    if (!this.magnetized && dist > this.magnetRadius) return false;

    // First time in range → ARM: re-base the drift speed + announce the magnetize.
    if (!this.magnetized) {
      this.magnetized = true;
      this.currentSpeed = this.pullSpeed;
      // pickup.magnetized — fired at the true arm moment (the player just entered the
      // magnet radius; the pickup now starts drifting). Reach the scene's shared bus the
      // way the other components do; a scene without a bus is a clean no-op. Declared in
      // this component's surface().
      this.bus?.emit('pickup.magnetized', { pickupId: this.pickupId(owner) });
    }

    // Drift toward the player by currentSpeed*dt, then ramp the speed (the gentle accel).
    const step = this.currentSpeed * dt;
    if (step >= dist) {
      // This step reaches the player → snap to contact and collect.
      this.collect();
      return true;
    }
    const inv = 1 / dist;
    this.setOwnerPos(owner, (owner.x ?? 0) + dx * inv * step, (owner.y ?? 0) + dy * inv * step);
    this.currentSpeed += this.pullAccel * dt;

    // Reached the player after the move (within collectRadius) → collect.
    const nd = Math.hypot((player.x ?? 0) - owner.x, (player.y ?? 0) - owner.y);
    if (nd <= this.collectRadius) this.collect();
    return true;
  }

  /**
   * The COLLECT verb (the drive seam): credit this pickup's value to __GAME__.score
   * EXACTLY once and remove the carrier through the standard scene seam. Drivable
   * WITHOUT a full game — call collect() to run the auto-collect directly. Idempotent:
   * a second call (or a re-fire) after the carrier is collected is a clean no-op (the
   * latch), so the score is credited once and the event fires once. Public so Integrate
   * can wire it and the responsiveness driver / a unit test can fire the moment headless.
   */
  collect(): void {
    if (this.collected) return;
    const owner = this.owner ? this.getOwner<any>() : null;
    if (!owner) return;
    this.collected = true;

    const scene = owner.scene as any;
    const pickupId = this.pickupId(owner);
    const value = this.resolveValue(owner);

    // Credit the value to the single score source (the registry 'score') — the same
    // seam CollectGoal/ComboMultiplier write, so __GAME__.score rises by exactly `value`.
    const reg = scene?.registry;
    if (reg && typeof reg.get === 'function' && typeof reg.set === 'function') {
      reg.set('score', Number(reg.get('score') ?? 0) + value);
    }

    // pickup.collected — fired at the real collect moment, BEFORE removal so the payload
    // carries the live id + value. Declared in this component's surface().
    this.bus?.emit('pickup.collected', { pickupId, value });

    // Remove through the standard collection seam (deletes from rewardsById + destroys
    // the sprite → it leaves __GAME__.entities[]; also fires the base reward.collected).
    if (typeof scene?.consumeReward === 'function') {
      scene.consumeReward(owner);
    } else {
      owner.__consumed = true;
      owner.destroy?.();
    }
  }

  /** Whether this pickup has been collected (read seam for diagnostics/tests). */
  isCollected(): boolean {
    return this.collected;
  }

  /** Whether the pull has armed (read seam for diagnostics/tests). */
  isMagnetized(): boolean {
    return this.magnetized;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * The score credited on collect. ID-SOURCE for the value: a config param by default
   * (this.value, from CAPABILITY.params.value), overridable PER-ENTITY by the pickup's
   * own `__value` tag (the spawned reward's surfaced value). Never fabricated — falls
   * back to the declared default.
   */
  private resolveValue(owner: any): number {
    const fromEntity = owner?.__value;
    if (typeof fromEntity === 'number' && Number.isFinite(fromEntity) && fromEntity > 0) {
      return fromEntity;
    }
    return this.value;
  }

  /**
   * This pickup's id for the lean payload — AUTO-DERIVED from the carrier entity's __id
   * (the entity this behavior attaches to; the same id __GAME__.entities reports), never
   * a config param.
   */
  private pickupId(owner: any): string {
    return owner.__id ?? owner.entityId ?? owner.name ?? 'pickup';
  }

  /** Translate the carrier, keeping the physics body in lock-step (setPosition desyncs it). */
  private setOwnerPos(owner: any, x: number, y: number): void {
    owner.x = x;
    owner.y = y;
    const body = owner.body as Phaser.Physics.Arcade.Body | undefined;
    if (body && typeof body.reset === 'function') body.reset(x, y);
  }

  // ============================================================================
  // COMPONENT SURFACE (the events THIS behavior owns + emits)
  // ============================================================================

  /**
   * The uniform component surface — the PUSH channel this behavior owns. Declares the
   * two pickup-owned moments, each a TRUE statement about a real emit site in this file:
   *   - pickup.magnetized ← pullStep() arming (the player entered the magnet radius)
   *   - pickup.collected  ← collect() (the drifting pickup reached the player)
   * The pickup's position + removal flow through the existing __GAME__.entities adapter
   * (scene.decorations), and score through the registry 'score', so this surface declares
   * only the PUSH channel + no observables/anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'pickup.magnetized',
          payload: '{pickupId}',
          scope: 'archetype',
          drivenBy: 'move — the player enters the magnet radius of the pickup',
          expect:
            'the pickup begins drifting toward the player (its x/y in __GAME__.entities moves toward the player each frame instead of staying static); pickup.magnetized logged',
        },
        {
          name: 'pickup.collected',
          payload: '{pickupId,value}',
          scope: 'archetype',
          drivenBy: 'move — the magnetized pickup reaches the player and is auto-collected',
          expect:
            'the pickup leaves __GAME__.entities and its value is credited to __GAME__.score exactly once; pickup.collected logged',
        },
      ],
    };
  }
}

/** Coerce to a positive finite number or fall back to a sensible declared default. */
function positiveOr(v: number | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
