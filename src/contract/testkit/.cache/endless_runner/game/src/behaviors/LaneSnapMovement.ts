/**
 * ============================================================================
 * LaneSnapMovement — the three-lane snap + jump/slide locomotion verb (BUILD — behavior)
 * ============================================================================
 *
 * The CORE engine of the `endless_runner:lane-runner` (Subway-Surfers / Temple-Run)
 * genre: the avatar auto-runs forward (the world scrolls past its fixed forward axis)
 * down a track of THREE fixed lanes, and the player's inputs are (1) snap LEFT / snap
 * RIGHT to an adjacent lane, (2) a JUMP to clear a low obstacle, and (3) a SLIDE to
 * duck under a high one. Like every runner verb, the avatar's forward SCREEN position
 * is FIXED — the world scrolls past it (ObstacleScrollSystem); this behavior owns only
 * the LATERAL lane position (the x snap) and the vertical jump/slide STATE.
 *
 * THE LANE SNAP (the whole feel — "snaps cleanly to an adjacent lane"): the track has a
 * fixed array of lane x-centres (`lanes`, the config lane positions — the ID SOURCE for
 * the lane index). The avatar holds a current lane INDEX; a left/right press moves the
 * index by exactly ONE toward an adjacent lane (clamped at the track edges — no wrap),
 * and each frame the avatar's x is eased toward that lane's centre at a fixed
 * `snapSpeed` and CLAMPED so it never overshoots. The press is an edge (queued once per
 * input), so the snap is deterministic — the destination is a function of the index, not
 * of where the avatar happened to be mid-glide. When the eased x reaches the target
 * centre the snap is settled; the avatar is cleanly in the new lane.
 *
 * THE JUMP / SLIDE STATES (the vertical verbs): a JUMP sets an upward vy impulse from
 * the ground and gravity integrates it back down, snapping the avatar to the ground band
 * (`groundY`) on landing — a single grounded hop (no air double-jump / double-slide). A
 * SLIDE drops the avatar into a timed crouch state for `slideFrames` (a lower AABB to
 * duck a high obstacle), then auto-stands. Jump and slide are mutually exclusive with the
 * grounded gate — you can only jump or slide from the ground — so the state is always one
 * of {grounded, jumping, sliding}, exposed as `owner.runnerState` for systems/effects.
 *
 * HEADLESS-DRIVEABLE: the verbs are public one-shots the control scheme calls on a real
 * keydown/swipe — `moveLeft()` / `moveRight()` (the lateral snap), `jump()` (aliased to
 * `flap()` so the SHARED one-button GravityFlapScheme still drives the vertical verb with
 * ZERO control edits), and `slide()`. The behavior reads NO raw DOM itself (the scheme
 * owns input). A harness fires a real key event → the scheme → `moveLeft()` → the lane
 * index decrements and x eases toward the new lane (the controllable proof).
 *
 * EVENT (the PUSH channel): `lane.changed` fires on the shared scene.eventBus at the real
 * lane-change seam — a press to an adjacent lane that moves the index (payload {lane}).
 *
 * GENERIC: every value is a config param (no game/theme). The owner is any sprite with a
 * Phaser arcade body; the behavior writes `owner.x` (the lane snap), `body.velocity.y` +
 * the owner's vy/vx mirror (the jump), and `owner.runnerState` — surfaced by the hook as
 * __GAME__.player.x / .vy / .vx. It reaches the shared bus the way a sibling does — via
 * the owner's scene (`owner.scene.eventBus`).
 */
import { BaseBehavior } from './IBehavior';
import { type ComponentSurface } from '@contract/component-surface';

export interface LaneSnapMovementConfig {
  /**
   * The track lane x-centres (world px), left→right. The avatar snaps its x to one of
   * these; the current INDEX into this array is the lane id (the ID SOURCE). When absent
   * it is derived once from the scene width as three evenly-spaced lanes.
   */
  lanes?: number[];
  /** Which lane index the avatar starts in (default the centre lane). */
  startLane?: number;
  /** Lateral ease speed (px/s) the avatar x moves toward the target lane centre. */
  snapSpeed?: number;
  /** Downward acceleration (px/s^2) applied to vy each frame while airborne. */
  gravity?: number;
  /** The FIXED upward velocity (px/s, positive magnitude) a ground jump SETS vy to. */
  jumpImpulse?: number;
  /** Terminal fall-speed cap (px/s, positive magnitude) — the fairness clamp. */
  maxFallSpeed?: number;
  /** Frames the timed slide/crouch state lasts before the avatar auto-stands. */
  slideFrames?: number;
  /**
   * The ground band the avatar runs on / lands back onto (world y of the feet line).
   * When absent it is derived once from the scene's map height (a band near the bottom).
   */
  groundY?: number;
}

/** The avatar's vertical state (exposed as owner.runnerState for systems/effects). */
type RunnerState = 'grounded' | 'jumping' | 'sliding';

/** Sensible declared defaults (the lane-runner feel; re-tuned per game). */
const DEFAULTS: Required<Omit<LaneSnapMovementConfig, 'lanes' | 'groundY'>> = {
  startLane: 1,
  snapSpeed: 900,
  gravity: 2200,
  jumpImpulse: 720,
  maxFallSpeed: 1000,
  slideFrames: 36,
};

export class LaneSnapMovement extends BaseBehavior {
  private readonly configLanes?: number[];
  private readonly startLane: number;
  private readonly snapSpeed: number;
  private readonly gravity: number;
  private readonly jumpImpulse: number;
  private readonly maxFallSpeed: number;
  private readonly slideFramesMax: number;
  private readonly configGroundY?: number;

  /** Resolved lane x-centres (from config or derived from the scene once). */
  private lanes: number[] = [];
  /** Resolved ground-band y (from config or derived from the scene once). */
  private groundY = 0;

  /** The avatar's current lane index into `lanes` (the lane id). */
  private laneIndex = 1;
  /** Pending lateral step queued by moveLeft/moveRight; applied once per frame (edge). */
  private pendingStep = 0;
  /** Set by jump()/flap(); the next update() initiates a grounded jump once (edge). */
  private jumpQueued = false;
  /** Set by slide(); the next update() initiates a grounded slide once (edge). */
  private slideQueued = false;
  /** The current vertical state. */
  private state: RunnerState = 'grounded';
  /** Frames elapsed in the current slide window (auto-stands at slideFramesMax). */
  private slideElapsed = 0;

  constructor(config: LaneSnapMovementConfig = {}) {
    super();
    this.configLanes = config.lanes;
    this.startLane = config.startLane ?? DEFAULTS.startLane;
    this.snapSpeed = config.snapSpeed ?? DEFAULTS.snapSpeed;
    this.gravity = config.gravity ?? DEFAULTS.gravity;
    this.jumpImpulse = config.jumpImpulse ?? DEFAULTS.jumpImpulse;
    this.maxFallSpeed = config.maxFallSpeed ?? DEFAULTS.maxFallSpeed;
    this.slideFramesMax = config.slideFrames ?? DEFAULTS.slideFrames;
    this.configGroundY = config.groundY;
  }

  protected onAttach(): void {
    const owner = this.owner;
    // Resolve the lane track once: explicit config, else three evenly-spaced lanes.
    const sceneW = owner?.scene?.mapWidth ?? owner?.scene?.scale?.width ?? 432;
    const sceneH = owner?.scene?.mapHeight ?? owner?.scene?.scale?.height ?? 768;
    if (this.configLanes && this.configLanes.length > 0) {
      this.lanes = this.configLanes.slice();
    } else {
      // Three evenly-spaced lanes across the quarter / half / three-quarter columns.
      this.lanes = [sceneW * 0.25, sceneW * 0.5, sceneW * 0.75];
    }
    this.groundY = this.configGroundY ?? sceneH - 96;

    // Start the avatar in its starting lane (clamped into range), grounded, standing.
    this.laneIndex = this.clampLane(this.startLane);
    this.pendingStep = 0;
    this.jumpQueued = false;
    this.slideQueued = false;
    this.state = 'grounded';
    this.slideElapsed = 0;
    if (owner) {
      owner.x = this.lanes[this.laneIndex];
      owner.runnerState = this.state;
    }
  }

  /**
   * Snap one lane LEFT (the lateral verb). Queues a single step; the next update()
   * decrements the lane index (clamped at the left edge — no wrap). Called by the
   * control scheme on a real keydown/swipe-left (headless-driveable). Idempotent per frame.
   */
  moveLeft(): void {
    this.pendingStep = -1;
  }

  /** Snap one lane RIGHT (the lateral verb; clamped at the right edge — no wrap). */
  moveRight(): void {
    this.pendingStep = 1;
  }

  /**
   * The vertical JUMP verb (aliased as flap() so the shared GravityFlapScheme drives it
   * unchanged). Queues a grounded jump; the next update() applies the impulse once.
   */
  jump(): void {
    this.jumpQueued = true;
  }

  /** Alias for the shared one-button scheme (same seam as jump()). */
  flap(): void {
    this.jumpQueued = true;
  }

  /**
   * The vertical SLIDE verb. Queues a grounded crouch; the next update() enters the timed
   * slide state (a lower AABB) that auto-stands after slideFrames. A grounded press only.
   */
  slide(): void {
    this.slideQueued = true;
  }

  update(): void {
    if (!this.enabled) return;
    const owner = this.owner;
    if (!owner) return;
    const body = owner.body as { velocity: { y: number } } | undefined;
    if (!body) return;

    const dt = 1 / 60;

    // ── lateral lane snap (the contract: snap cleanly to an adjacent lane) ─────────
    if (this.pendingStep !== 0) {
      const next = this.clampLane(this.laneIndex + this.pendingStep);
      this.pendingStep = 0;
      if (next !== this.laneIndex) {
        // A real adjacent-lane change committed → set the target index + emit the seam.
        this.laneIndex = next;
        this.emitLaneChanged();
      }
    }

    // Ease x toward the current lane's centre, clamped so it never overshoots.
    const targetX = this.lanes[this.laneIndex] ?? owner.x ?? 0;
    const curX = owner.x ?? targetX;
    const dx = targetX - curX;
    const maxStep = this.snapSpeed * dt;
    if (Math.abs(dx) <= maxStep) {
      owner.x = targetX; // settled cleanly in the lane.
    } else {
      owner.x = curX + Math.sign(dx) * maxStep;
    }

    // ── vertical state machine: jump / slide are grounded-only and exclusive ───────
    if (this.state === 'grounded') {
      if (this.jumpQueued) {
        this.jumpQueued = false;
        this.slideQueued = false; // a jump wins over a same-frame slide.
        body.velocity.y = -this.jumpImpulse; // SET (deterministic apex), not added.
        this.state = 'jumping';
      } else if (this.slideQueued) {
        this.slideQueued = false;
        this.state = 'sliding';
        this.slideElapsed = 0;
        body.velocity.y = 0;
      } else {
        body.velocity.y = 0; // pinned to the band between verbs.
      }
    }

    if (this.state === 'jumping') {
      // Gravity integration → land back on the ground band (snap on contact).
      body.velocity.y += this.gravity * dt;
      if (body.velocity.y > this.maxFallSpeed) body.velocity.y = this.maxFallSpeed;
      const feet = (owner.y ?? 0) + this.ownerHalfHeight(owner);
      if (body.velocity.y >= 0 && feet >= this.groundY) {
        owner.y = this.groundY - this.ownerHalfHeight(owner);
        body.velocity.y = 0;
        this.state = 'grounded';
      }
    } else if (this.state === 'sliding') {
      // Timed crouch; pinned to the band, auto-stands when the window lapses.
      body.velocity.y = 0;
      this.slideElapsed += 1;
      if (this.slideElapsed >= this.slideFramesMax) {
        this.state = 'grounded';
        this.slideElapsed = 0;
      }
    }

    // Drain any inputs queued while airborne/sliding (no double-jump / double-slide).
    if (this.state !== 'grounded') {
      this.jumpQueued = false;
      this.slideQueued = false;
    }

    // Mirror onto the owner for the hook surface (__GAME__.player.vy/.vx) + the state.
    owner.vy = body.velocity.y;
    owner.vx = 0; // the avatar's forward axis is FIXED — the world scrolls (auto-run).
    owner.runnerState = this.state;
  }

  /** Clamp a lane index into the track range (no wrap — clean edges). */
  private clampLane(i: number): number {
    const max = Math.max(0, this.lanes.length - 1);
    if (i < 0) return 0;
    if (i > max) return max;
    return i;
  }

  /** Half the owner's display height (for the feet line); a safe fallback when absent. */
  private ownerHalfHeight(owner: any): number {
    const h = owner?.displayHeight ?? owner?.height ?? 34;
    return h / 2;
  }

  /** Emit lane.changed on the shared scene bus (the way a sibling reaches it). */
  private emitLaneChanged(): void {
    const bus = this.owner?.scene?.eventBus;
    if (bus && typeof bus.emit === 'function') {
      this.bus?.emit('lane.changed', { lane: this.laneIndex });
    }
  }

  /**
   * The PUSH channel this behavior publishes:
   *   - lane.changed ← a press to an adjacent lane that moves the lane index (the
   *     avatar snaps to the new lane), payload {lane} [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'lane.changed',
          payload: '{lane}',
          scope: 'archetype',
          drivenBy: 'a press to an adjacent lane',
          expect:
            "__GAME__.player.x eases toward the new lane centre (the avatar snaps to the new lane index); lane.changed logged",
        },
      ],
    };
  }
}

/**
 * CAPABILITY — the registry sidecar (discover.mjs globs this). The drift-gated `behavior`
 * capability the blueprint binds by id. CODE is the source of truth.
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'LaneSnapMovement',
  intent:
    'Three-lane snap + jump/slide locomotion (Subway-Surfers / Temple-Run lane runner): the avatar auto-runs forward down a track of three fixed lanes (config lane positions); a left/right press snaps it cleanly to an adjacent lane (the index moves by exactly one, clamped at the edges — no wrap), and its x eases to the new lane centre. A grounded JUMP clears low obstacles and a timed SLIDE ducks high ones — jump and slide are grounded-only and exclusive (no double-jump). The forward axis is fixed; the world scrolls past it.',
  implements: 'LaneSnapMovement',
  roles: ['player'],
  params: ['lanes', 'startLane', 'snapSpeed', 'gravity', 'jumpImpulse', 'maxFallSpeed', 'slideFrames', 'groundY'],
  tuning: ['snapSpeed', 'gravity', 'jumpImpulse', 'maxFallSpeed', 'slideFrames'],
} as const;
