import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import type { ComponentSurface } from '@contract/component-surface';

/**
 * CAPABILITY sidecar (kept consistent with the systems' sidecar shape; the
 * top_down BEHAVIOR registry discovers behaviors via the authored taxonomy in
 * `registry/discover.mjs`, not via this const — so this is inert-but-documenting
 * metadata, never read by the drift gate). The Integrate step adds the real
 * BEHAVIOR_TAXONOMY row + the barrel export (see the report).
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'InertialThrustController',
  intent:
    'Asteroids-style inertial flight: turn input rotates the player HEADING only (no translation); thrust accelerates along the heading into a COASTING velocity that persists after input stops and decays via frame-rate-independent drag (never an instant stop). Decouples rotation from velocity — the opposite of EightWayMovement.',
  roles: ['player'],
  params: ['turnSpeed', 'thrustAccel', 'maxSpeed', 'drag'],
  tuning: ['walkSpeed'],
} as const;

/**
 * InertialThrustController configuration. Every number is a DECLARED default —
 * none is baked from a specific game; a design node tunes these via params.
 */
export interface InertialThrustControllerConfig {
  /** Heading turn rate in radians per second (default Math.PI = half-turn/s). */
  turnSpeed?: number;
  /** Thrust acceleration in px/s^2 applied along the heading while thrust is held (default 600). */
  thrustAccel?: number;
  /** Speed cap in px/s; coasting velocity is clamped to this magnitude (default 320). */
  maxSpeed?: number;
  /**
   * Per-frame velocity retention at 60fps (0..1). Applied frame-rate-independently
   * as pow(drag, dt*60), so velocity COASTS and decays smoothly — never zeroed.
   * 1 = no drag (pure inertia); lower = quicker coast-down (default 0.985).
   */
  drag?: number;
}

/**
 * InertialThrustController — Asteroids/space-flight locomotion for the
 * `top_down:inertial-space` genre. Rotation is INDEPENDENT of velocity:
 *
 *  - TURN input rotates `this.heading` (radians) ONLY — it never translates the
 *    ship. The heading is mirrored onto the sprite's rotation (visible) and onto
 *    `owner.facingHeading` (a read seam for diagnostics / aim).
 *  - THRUST input accelerates the body's velocity ALONG the current heading,
 *    feeding a COASTING velocity that PERSISTS after the input is released.
 *  - DRAG decays that velocity every frame, frame-rate-independently
 *    (`v *= pow(drag, dt*60)`), so the ship glides to a stop SMOOTHLY — there is
 *    no instant stop (the genre signature vs EightWayMovement's snap).
 *
 * Because `__GAME__.player.vx/vy` are read straight off the body velocity, a held
 * thrust raises them along the heading and they keep coasting (decaying) after
 * release — the OBSERVABLE the contract asserts.
 *
 * Input is read the way the maze behaviors read scene/owner state by name: from
 * the bound player's `cursors`/`wasdKeys` (left/right = turn, up/W = thrust), with
 * a programmatic `setInput(turn, thrust)` override seam (mirrors
 * EightWayMovement.setInput) so an FSM, the scene, or the responsiveness driver
 * can drive it headless. No game/theme, no baked coordinate.
 *
 * Usage (bound to the player from the blueprint):
 *   player.behaviors.add('thrust', new InertialThrustController({ thrustAccel: 700, drag: 0.99 }));
 */
export class InertialThrustController extends BaseBehavior {
  // Configuration (declared defaults — never a game-specific constant)
  public turnSpeed: number;
  public thrustAccel: number;
  public maxSpeed: number;
  public drag: number;

  /** Current heading in radians (rotated by turn input; INDEPENDENT of velocity). */
  public heading: number = 0;

  /** External input override for this frame (turn: -1|0|1, thrust: 0|1), or null to self-read. */
  private overrideTurn: number | null = null;
  private overrideThrust: number | null = null;

  constructor(config: InertialThrustControllerConfig = {}) {
    super();
    this.turnSpeed = config.turnSpeed ?? Math.PI;
    this.thrustAccel = config.thrustAccel ?? 600;
    this.maxSpeed = config.maxSpeed ?? 320;
    this.drag = config.drag ?? 0.985;
  }

  /** Seed the heading from the sprite's current rotation when attached. */
  protected onAttach(): void {
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    this.heading = owner.rotation ?? 0;
  }

  /**
   * Per-frame: rotate the heading from turn input (no translation), accelerate
   * along the heading from thrust input into the body velocity, then apply
   * frame-rate-independent drag so velocity coasts and decays smoothly.
   */
  update(): void {
    const owner = this.getOwner<Phaser.Physics.Arcade.Sprite>();
    const body = owner.body as Phaser.Physics.Arcade.Body | undefined;
    const scene = owner.scene as any;
    if (!body || !scene) return;

    // dt in seconds (frame-rate-independent), clamped against a hitch/first frame.
    const dt = Math.min(0.05, (scene.game?.loop?.delta ?? 1000 / 60) / 1000);

    const { turn, thrust } = this.readInput(owner);

    // 1) ROTATION — heading only, never a position change.
    if (turn !== 0) {
      this.heading += turn * this.turnSpeed * dt;
      owner.setRotation(this.heading); // visible heading (mirrors FaceTarget)
    }
    // Expose the heading as a read seam for aim / diagnostics (generic, by name).
    (owner as any).facingHeading = this.heading;

    // 2) THRUST — accelerate the coasting velocity ALONG the heading.
    let thrusted = false;
    if (thrust > 0) {
      const before = Math.hypot(body.velocity.x, body.velocity.y);
      body.velocity.x += Math.cos(this.heading) * this.thrustAccel * dt;
      body.velocity.y += Math.sin(this.heading) * this.thrustAccel * dt;
      this.clampSpeed(body);
      const after = Math.hypot(body.velocity.x, body.velocity.y);
      // The true gameplay seam: thrust actually raised the coasting speed.
      thrusted = after > before;
    }

    // 3) DRAG — frame-rate-independent decay; velocity COASTS, never instant-stop.
    if (this.drag < 1) {
      const k = Math.pow(this.drag, dt * 60);
      body.velocity.x *= k;
      body.velocity.y *= k;
    }

    // player.thrusted — fired at the real accelerate moment (velocity increased
    // along the heading this frame). The player OWNS this moment; reach the scene's
    // shared bus the way BasePlayer does (a scene without a bus is a clean no-op).
    if (thrusted) {
      this.bus?.emit('player.thrusted', {
        heading: this.heading,
        vx: body.velocity.x,
        vy: body.velocity.y,
      });
    }
  }

  /** Resolve this frame's input: an external override, else the bound player's keys. */
  private readInput(owner: any): { turn: number; thrust: number } {
    if (this.overrideTurn !== null || this.overrideThrust !== null) {
      const turn = this.overrideTurn ?? 0;
      const thrust = this.overrideThrust ?? 0;
      // Override is per-frame; clear after consuming so a stale value never sticks.
      this.overrideTurn = null;
      this.overrideThrust = null;
      return { turn: Math.sign(turn), thrust: thrust > 0 ? 1 : 0 };
    }

    // Self-read from the bound player's keys (left/right = turn, up/W = thrust).
    const cursors = owner.cursors as
      | Phaser.Types.Input.Keyboard.CursorKeys
      | undefined;
    const wasd = owner.wasdKeys as
      | Record<string, Phaser.Input.Keyboard.Key>
      | undefined;
    const down = (k?: Phaser.Input.Keyboard.Key): boolean => !!k && k.isDown;

    let turn = 0;
    if (down(cursors?.left) || down(wasd?.A)) turn -= 1;
    if (down(cursors?.right) || down(wasd?.D)) turn += 1;
    const thrust = down(cursors?.up) || down(wasd?.W) ? 1 : 0;
    return { turn, thrust };
  }

  /** Clamp the coasting velocity to maxSpeed (preserves direction). */
  private clampSpeed(body: Phaser.Physics.Arcade.Body): void {
    const sp = Math.hypot(body.velocity.x, body.velocity.y);
    if (sp > this.maxSpeed && sp > 0) {
      const s = this.maxSpeed / sp;
      body.velocity.x *= s;
      body.velocity.y *= s;
    }
  }

  /**
   * Programmatic input override for ONE frame (mirrors EightWayMovement.setInput):
   * an FSM, the scene, or the responsiveness driver can drive thrust/turn headless.
   * @param turn   -1 = rotate CCW, 0 = none, 1 = rotate CW
   * @param thrust 0 = none, 1 = accelerate along heading
   */
  setInput(turn: number, thrust: number): void {
    this.overrideTurn = Math.sign(turn);
    this.overrideThrust = thrust > 0 ? 1 : 0;
  }

  /**
   * The uniform component surface — the PUSH channel this behavior owns. Declares
   * `player.thrusted` (emitted from the real accelerate seam in update()).
   * Observables flow via the existing __GAME__ adapter (player.vx/vy read off the
   * body velocity), so this surface declares only the event + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'player.thrusted',
          payload: '{heading,vx,vy}',
          scope: 'archetype',
          drivenBy: 'thrust input held (the accelerate verb)',
          expect:
            '__GAME__.player.vx/vy magnitude increases along heading this frame; after release velocity keeps coasting and decays smoothly (not zeroed); player.thrusted logged',
        },
      ],
    };
  }
}
