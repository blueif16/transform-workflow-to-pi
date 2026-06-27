import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import * as utils from '../utils';
import { aabb, resolveAABBBounce } from '../scenes/ball-physics';
import type { ComponentSurface } from '@contract/component-surface';

/**
 * CAPABILITY sidecar (kept consistent with PaddleController's sidecar shape; the
 * paddle_ball BEHAVIOR registry discovers behaviors via the authored taxonomy in
 * `registry/discover.mjs`, not via this const — so this is inert-but-documenting
 * metadata, never read by the drift gate, but ships on every behavior file).
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'PinballFlippers',
  intent:
    'The PINBALL table genre seam: two flippers (left/right) that snap UP on a flip key press then ease back to rest, kicking the ball upward off a raised flipper; plus scoring bumpers that DEFLECT the ball (shallow-axis reflect) and award points; plus a TILT limit (too many nudges locks the flippers). This is what turns the engine ball+walls into a controllable pinball table — without it the genre has no player agency on the ball.',
  roles: ['paddle', 'ball'],
  params: [
    'flipKey',
    'flipAngleDeg',
    'restAngleDeg',
    'flipUpRate',
    'flipDownRate',
    'flipperLength',
    'flipperThickness',
    'leftPivot',
    'rightPivot',
    'kickSpeed',
    'bumpers',
    'bumperRadius',
    'bumperPoints',
    'tiltLimit',
  ],
  tuning: ['ballSpeed'],
} as const;

/** A bumper placement (CENTER); each deflects the ball and scores on contact. */
export interface BumperData {
  x: number;
  y: number;
  /** override the default bumper radius for this peg (optional). */
  radius?: number;
  /** override the default points for this peg (optional). */
  points?: number;
}

/** A flipper pivot point (CENTER of the pivot end of the bat). */
export interface PivotData {
  x: number;
  y: number;
}

/**
 * PinballFlippers config — every number a DECLARED default, none baked from a game.
 * The pivots/bumpers default to null so a level that binds nothing still boots (the
 * behavior derives sensible pivots from the play field when none are given).
 */
export interface PinballFlippersConfig {
  /** which key flicks BOTH flippers up (Phaser key name; default 'SPACE'). */
  flipKey?: string;
  /** flipper angle when fully raised, degrees from rest (default 38). */
  flipAngleDeg?: number;
  /** flipper resting angle, degrees (default 22, splayed down-and-out). */
  restAngleDeg?: number;
  /** how fast a flipper rotates UP, degrees/sec (default 900 — a snap). */
  flipUpRate?: number;
  /** how fast a flipper eases back DOWN to rest, degrees/sec (default 360). */
  flipDownRate?: number;
  /** flipper bat length px (default 92). */
  flipperLength?: number;
  /** flipper bat thickness px (default 18). */
  flipperThickness?: number;
  /** left flipper pivot (CENTER); default derived from the play field. */
  leftPivot?: PivotData;
  /** right flipper pivot (CENTER); default derived from the play field. */
  rightPivot?: PivotData;
  /** upward speed (px/s) imparted to the ball when a RAISED flipper hits it (default 520). */
  kickSpeed?: number;
  /** scoring bumpers (CENTER positions); default a small triangle from the play field. */
  bumpers?: BumperData[];
  /** default bumper collision radius px (default 26). */
  bumperRadius?: number;
  /** default points awarded per bumper hit (default 100). */
  bumperPoints?: number;
  /** max accumulated tilt nudges before the flippers LOCK (a fail-safe; default 3). */
  tiltLimit?: number;
}

/** One live flipper bat the behavior animates + collides the ball against. */
interface LiveFlipper {
  sprite: Phaser.GameObjects.Sprite;
  pivot: PivotData;
  /** -1 = the bat extends to the LEFT of its pivot, +1 = to the RIGHT. */
  side: -1 | 1;
  /** current raise angle (deg above rest); 0 = resting. */
  raise: number;
  /** target raise (flipAngleDeg while the key is held, else 0). */
  target: number;
}

/**
 * PinballFlippers — the pinball table behavior (the pinball genre seam).
 *
 * Mirrors PaddleController's plumbing: it is a BaseBehavior attached to the paddle
 * (the player entity), reads the live `scene` off its owner sprite, and ticks every
 * frame from the scene's behaviors.update() drive. It does NOT move the paddle — it
 * OWNS two flipper bats + the scoring bumpers as its own world objects:
 *
 *   - flip key (default SPACE) pressed → BOTH flippers snap UP to flipAngleDeg, then
 *     ease back to rest when released; the bat sprite's rotation reflects the raise.
 *     A raised flipper that the descending ball touches kicks the ball UPWARD at
 *     kickSpeed (the player's agency on the ball). Emits `flipper.flicked`.
 *   - the engine ball (scene.ball + scene.ballVel) tested each frame against every
 *     bumper: an overlap DEFLECTS the ball (shallow-axis reflect via the shared
 *     ball-physics resolveAABBBounce) and awards points on the registry score (the
 *     single score source, like BrickGrid). Emits `bumper.hit` + `score.changed`.
 *   - a TILT limit: each kick counts as a nudge; once `tiltLimit` nudges accrue the
 *     flippers LOCK (stop raising) — the classic anti-cheat tilt, a declared fail-safe.
 *
 * Generic — no game/theme, no baked coordinate: pivots/bumpers come from config (or a
 * play-field-derived default), every number is a declared default.
 */
export class PinballFlippers extends BaseBehavior {
  public readonly cfg: Required<Omit<PinballFlippersConfig, 'leftPivot' | 'rightPivot' | 'bumpers'>> & {
    leftPivot?: PivotData;
    rightPivot?: PivotData;
    bumpers?: BumperData[];
  };

  private scene: any = null;
  private flippers: LiveFlipper[] = [];
  private bumperBoxes: { x: number; y: number; r: number; points: number }[] = [];
  private flipKeyObj: Phaser.Input.Keyboard.Key | undefined;
  private tiltCount = 0;
  /** latch so one continuous bumper overlap scores ONCE per entry (not every frame). */
  private bumperLatched = false;

  constructor(config: PinballFlippersConfig = {}) {
    super();
    this.cfg = {
      flipKey: config.flipKey ?? 'SPACE',
      flipAngleDeg: config.flipAngleDeg ?? 38,
      restAngleDeg: config.restAngleDeg ?? 22,
      flipUpRate: config.flipUpRate ?? 900,
      flipDownRate: config.flipDownRate ?? 360,
      flipperLength: config.flipperLength ?? 92,
      flipperThickness: config.flipperThickness ?? 18,
      kickSpeed: config.kickSpeed ?? 520,
      bumperRadius: config.bumperRadius ?? 26,
      bumperPoints: config.bumperPoints ?? 100,
      tiltLimit: config.tiltLimit ?? 3,
      leftPivot: config.leftPivot,
      rightPivot: config.rightPivot,
      bumpers: config.bumpers,
    };
  }

  /** Build the two flipper bats + the bumpers from config (or a play-field default). */
  protected onAttach(): void {
    const owner = this.getOwner<Phaser.GameObjects.Sprite & { scene: any }>();
    const scene = owner?.scene as any;
    this.scene = scene;
    if (!scene) return;

    const W = Number(scene.mapWidth) || 720;
    const H = Number(scene.mapHeight) || 1280;

    // Derive sensible default pivots (the lower-third inverted-V the player guards) and a
    // default bumper triangle when the level bound none — so the behavior boots standalone.
    const left = this.cfg.leftPivot ?? { x: W * 0.34, y: H * 0.86 };
    const right = this.cfg.rightPivot ?? { x: W * 0.66, y: H * 0.86 };
    const bumpers =
      this.cfg.bumpers ??
      [
        { x: W * 0.5, y: H * 0.32 },
        { x: W * 0.3, y: H * 0.46 },
        { x: W * 0.7, y: H * 0.46 },
      ];

    utils.ensurePlaceholderTexture(scene, '__flipper', this.cfg.flipperLength, this.cfg.flipperThickness, 'sprite');
    this.flippers = [
      this.makeFlipper(scene, left, -1),
      this.makeFlipper(scene, right, 1),
    ];

    utils.ensurePlaceholderTexture(scene, '__bumper', this.cfg.bumperRadius * 2, this.cfg.bumperRadius * 2, 'image');
    this.bumperBoxes = bumpers.map((b) => {
      const r = b.radius ?? this.cfg.bumperRadius;
      const spr = scene.add?.sprite?.(b.x, b.y, '__bumper');
      if (spr) {
        spr.setDisplaySize?.(r * 2, r * 2);
        spr.setTint?.(0xf2c14e);
        spr.__type = 'bumper';
        scene.obstacles?.add?.(spr);
      }
      return { x: b.x, y: b.y, r, points: b.points ?? this.cfg.bumperPoints };
    });

    // The flip key (named, declared default SPACE). A scene without a keyboard no-ops.
    const code = (Phaser.Input.Keyboard.KeyCodes as any)[this.cfg.flipKey] ?? Phaser.Input.Keyboard.KeyCodes.SPACE;
    this.flipKeyObj = scene.input?.keyboard?.addKey?.(code);
  }

  protected onDetach(): void {
    for (const f of this.flippers) f.sprite?.destroy?.();
    this.flippers = [];
    this.bumperBoxes = [];
    this.scene = null;
  }

  private makeFlipper(scene: any, pivot: PivotData, side: -1 | 1): LiveFlipper {
    const spr = scene.add.sprite(pivot.x, pivot.y, '__flipper');
    spr.setDisplaySize(this.cfg.flipperLength, this.cfg.flipperThickness);
    spr.setTint(side < 0 ? 0x5bc0eb : 0xe85d75);
    // origin at the PIVOT end so rotation pivots there (left bat pivots on its right end).
    spr.setOrigin(side < 0 ? 1 : 0, 0.5);
    spr.setDepth(5);
    return { sprite: spr, pivot, side, raise: this.cfg.restAngleDeg, target: this.cfg.restAngleDeg };
  }

  /** Per-frame: animate the flippers toward their target, run flip + bumper collisions. */
  update(): void {
    const scene = this.scene;
    if (!scene || this.flippers.length === 0) return;
    const dt = Math.min(0.05, (scene.game?.loop?.delta ?? 1000 / 60) / 1000);

    const pressed = !!this.flipKeyObj && Phaser.Input.Keyboard.JustDown(this.flipKeyObj);
    const held = !!this.flipKeyObj && this.flipKeyObj.isDown;
    const locked = this.tiltCount >= this.cfg.tiltLimit;

    // On a fresh press, command BOTH flippers up to the flip angle (unless tilt-locked).
    if (pressed && !locked) {
      for (const f of this.flippers) f.target = this.cfg.restAngleDeg + this.cfg.flipAngleDeg;
      this.tiltCount += 1; // each flick is a nudge toward the tilt limit
      // flipper.flicked — fired at the real flick moment (the key press raised the bats).
      this.bus?.emit('flipper.flicked', {
        tilt: this.tiltCount,
        locked: this.tiltCount >= this.cfg.tiltLimit,
      });
    }
    // Release (or lock) lowers them back toward rest.
    if (!held || locked) {
      for (const f of this.flippers) f.target = this.cfg.restAngleDeg;
    }

    // Ease each flipper toward its target + reflect its rotation onto the sprite.
    for (const f of this.flippers) {
      const rate = f.target > f.raise ? this.cfg.flipUpRate : this.cfg.flipDownRate;
      const step = rate * dt;
      if (Math.abs(f.target - f.raise) <= step) f.raise = f.target;
      else f.raise += Math.sign(f.target - f.raise) * step;
      // a raised flipper rotates UP-and-IN: left bat rotates CCW (negative), right CW.
      const sign = f.side < 0 ? 1 : -1;
      f.sprite.setRotation((sign * f.raise * Math.PI) / 180);
    }

    // Ball interactions (the engine owns the ball; we read scene.ball + scene.ballVel).
    const ball = scene.ball;
    const vel = scene.ballVel;
    if (!ball || !vel) return;

    this.maybeKick(ball, vel);
    this.maybeBumper(scene, ball, vel);
  }

  /** A RAISED flipper that the descending ball touches kicks it UPWARD at kickSpeed. */
  private maybeKick(ball: any, vel: { x: number; y: number }): void {
    for (const f of this.flippers) {
      if (f.raise <= this.cfg.restAngleDeg + 2) continue; // only a raised bat kicks
      // approximate the bat as an AABB around its pivot reach.
      const reach = this.cfg.flipperLength * 0.8;
      const cx = f.pivot.x + f.side * reach * 0.5;
      const box = aabb(cx, f.pivot.y, reach, this.cfg.flipperThickness + 18);
      const bbox = aabb(ball.x, ball.y, ball.displayWidth ?? 16, ball.displayHeight ?? 16);
      const overlapping =
        Math.abs(bbox.cx - box.cx) < bbox.halfW + box.halfW &&
        Math.abs(bbox.cy - box.cy) < bbox.halfH + box.halfH;
      if (overlapping && vel.y >= 0) {
        // kick the ball up-and-toward-center, preserving the configured speed magnitude.
        const dirX = (cx - f.pivot.x) >= 0 ? -0.4 : 0.4; // toward center off the bat
        const dy = -1;
        const len = Math.hypot(dirX, dy) || 1;
        vel.x = (dirX / len) * this.cfg.kickSpeed;
        vel.y = (dy / len) * this.cfg.kickSpeed;
        ball.y = f.pivot.y - this.cfg.flipperThickness - bbox.halfH - 1;
      }
    }
  }

  /** Test the ball against every bumper: deflect + score ONCE per overlap entry. */
  private maybeBumper(scene: any, ball: any, vel: { x: number; y: number }): void {
    const bbox = aabb(ball.x, ball.y, ball.displayWidth ?? 16, ball.displayHeight ?? 16);
    let touching = false;
    for (const b of this.bumperBoxes) {
      const box = aabb(b.x, b.y, b.r * 2, b.r * 2);
      const overlapping =
        Math.abs(bbox.cx - box.cx) < bbox.halfW + box.halfW &&
        Math.abs(bbox.cy - box.cy) < bbox.halfH + box.halfH;
      if (!overlapping) continue;
      touching = true;
      if (this.bumperLatched) continue; // already scored this entry
      this.bumperLatched = true;
      // DEFLECT: shallow-axis reflect off the bumper box (mutates vel + pushes the ball out).
      resolveAABBBounce(bbox, box, vel);
      ball.x = bbox.cx;
      ball.y = bbox.cy;
      // SCORE on the registry (the single source — same seam as BrickGrid) + the
      // standardized score.changed event so __GAME__.score moves observably.
      const reg = scene.registry;
      const next = Number(reg?.get?.('score') ?? 0) + b.points;
      reg?.set?.('score', next);
      this.bus?.emit('score.changed', { score: next });
      // cosmetic juice bound to the hit (no-op if the level bound none)
      scene.fireEffect?.('bumper.hit', b.x, b.y);
      // bumper.hit — fired at the real strike moment (the ball deflected + scored).
      this.bus?.emit('bumper.hit', { x: b.x, y: b.y, points: b.points, score: next });
    }
    if (!touching) this.bumperLatched = false; // ball left every bumper → re-arm
  }

  /**
   * The uniform component surface — the PUSH channel this behavior owns. Declares the
   * two pinball moments; each is a TRUE statement about a real emit site in update():
   *   - flipper.flicked ← the flip-key press raised the bats (and ticked the tilt count)
   *   - bumper.hit      ← the ball struck a bumper (deflected + scored)
   * The flipper rotation + the score flow via existing observation (the score seam +
   * the live sprites), so the surface declares the events + no extra observables.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'flipper.flicked',
          payload: '{tilt,locked}',
          scope: 'archetype',
          drivenBy: 'press the flip key (default SPACE)',
          expect:
            'both flippers rotate UP from rest then ease back; a raised flipper kicks the ball upward; flipper.flicked logged',
        },
        {
          name: 'bumper.hit',
          payload: '{x,y,points,score}',
          scope: 'archetype',
          drivenBy: 'the ball strikes a bumper',
          expect:
            '__GAME__.score increases by the bumper points and the ball deflects (velocity reflects off the bumper); bumper.hit logged',
        },
      ],
    };
  }
}
