/**
 * PinballBumpers — the PINBALL scoring field: bumpers, ramps, and targets (BUILD — system; pinball genre).
 *
 * The pinball-table genre's reward substrate. Where the base engine owns the ball + walls + the
 * flippers (PinballFlippers behavior owns the player's flip agency), THIS system owns the FIELD the
 * ball scores against — the part that makes a pinball table feel alive and pay out:
 *
 *   - BUMPERS / TARGETS (scoring obstacles): an AABB the ball DEFLECTS off (shallow-axis reflect, the
 *     exact BrickGrid collision math) and that AWARDS points on contact. A bumper additionally KICKS
 *     the ball outward (a small speed boost) — the classic "pop bumper" snap; a plain target just
 *     deflects + scores. Each fires `target.hit` at the contact moment, so __GAME__.score rises and
 *     the ball's velocity visibly reflects.
 *   - RAMPS (routing bonus lanes): a directed lane with a MOUTH (entry zone) and an EXIT zone. The ball
 *     does NOT bounce off a ramp — it rolls THROUGH it; latching the mouth then reaching the exit =
 *     a completed ramp, which awards a (larger) ramp BONUS and fires `ramp.completed`.
 *
 * The OBSERVABLE __GAME__ effect this owns:
 *   - score: every bumper/target hit and every completed ramp adds to the registry `score` (the single
 *     score source, single-sourced exactly the way BrickGrid/ScoreCombo write it) → __GAME__.score rises;
 *   - ball deflection: a bumper/target contact mutates the live scene.ballVel (shallow-axis reflect +
 *     optional kick), so __GAME__ ball motion visibly changes direction at the hit.
 *
 * It re-implements NOTHING the engine owns: the ball integration + wall/paddle reflection live in the
 * scene's sub-step loop; the score IS the registry `score`; the event log IS the shared EventBus. This
 * system READS the live ball each frame (scene.ball + scene.ballVel) — the same world-read pattern every
 * other paddle_ball system uses — and resolves its own field collisions in update().
 *
 * GENERIC: no count, no coordinate is baked. WHICH bumpers/ramps/targets exist comes from `params`
 * (config), and when none are configured a sensible DEFAULT field is laid out from the play bounds so
 * the genre always plays. Every numeric is a declared default, never a baked map.
 *
 * Params (all OPTIONAL — declared defaults, never a baked map):
 *   bumpers      Array<{id?,x,y,radius?,points?,kick?}> — round pop-bumpers (deflect + kick + score).
 *   targets      Array<{id?,x,y,width?,height?,points?}> — rectangular scoring targets (deflect + score).
 *   ramps        Array<{id?,mouth:{x,y,width?,height?},exit:{x,y,width?,height?},bonus?}> — bonus lanes.
 *   bumperPoints default points a bumper awards when none is set on the element (default 50).
 *   targetPoints default points a target awards when none is set on the element (default 25).
 *   rampBonus    default bonus a completed ramp awards when none is set on the element (default 150).
 *   bumperRadius default bumper radius px when none is set on the element (default 22).
 *   kickBoost    extra speed (px/s) a bumper adds to the ball on contact (default 60).
 *   hitCooldownMs minimum ms between two scoring contacts on the SAME element (default 120) — so one
 *                 physical contact awards once even across several sub-frames.
 */
import type { ISceneSystem } from '../scenes/paddle-data';
import type { ComponentSurface, EventBus } from '@contract/component-surface';
import { aabb, resolveAABBBounce, speedOf, type AABB, type Vec2 } from '../scenes/ball-physics';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors every system file). */
export const CAPABILITY = {
  kind: 'system',
  id: 'PinballBumpers',
  intent:
    'A pinball scoring field of bumpers, ramps, and targets: bumpers/targets DEFLECT the ball (shallow-axis reflect, exact grid math) and AWARD points on contact (a bumper also KICKS the ball outward with a small speed boost); ramps are routing bonus lanes the ball rolls through — latching a ramp mouth then reaching its exit completes the ramp and awards a larger bonus. Builds a sensible default field from the play bounds when none is configured, so the pinball genre always pays out and the ball always has something to score against.',
  attachesTo: 'scene',
  params: [
    'bumpers',
    'targets',
    'ramps',
    'bumperPoints',
    'targetPoints',
    'rampBonus',
    'bumperRadius',
    'kickBoost',
    'hitCooldownMs',
  ],
  roles: ['ball', 'bumper', 'target', 'ramp'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** A round pop-bumper (deflect + kick + score), config shape. */
export interface BumperSpec {
  id?: string;
  x: number;
  y: number;
  radius?: number;
  points?: number;
  kick?: number;
}

/** A rectangular scoring target (deflect + score), config shape. */
export interface TargetSpec {
  id?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: number;
}

/** A ramp zone (mouth/exit) — a box by CENTER + size. */
export interface RampZone {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/** A ramp routing lane: enter the mouth, reach the exit → bonus. */
export interface RampSpec {
  id?: string;
  mouth: RampZone;
  exit: RampZone;
  bonus?: number;
}

export interface PinballBumpersConfig {
  bumpers?: BumperSpec[];
  targets?: TargetSpec[];
  ramps?: RampSpec[];
  bumperPoints?: number;
  targetPoints?: number;
  rampBonus?: number;
  bumperRadius?: number;
  kickBoost?: number;
  hitCooldownMs?: number;
}

/** One live scoring obstacle the field tracks (bumper or target). */
interface LiveObstacle {
  id: string;
  box: AABB;
  points: number;
  kind: 'bumper' | 'target';
  kick: number;
  /** scene-clock ms of the last scored contact (cooldown latch). */
  lastHitAt: number;
}

/** One live ramp lane (mouth + exit boxes + its latch). */
interface LiveRamp {
  id: string;
  mouth: AABB;
  exit: AABB;
  bonus: number;
  /** true once the ball entered the mouth and has not yet reached the exit. */
  onRamp: boolean;
}

export class PinballBumpers implements ISceneSystem {
  private scene: any;
  private obstacles: LiveObstacle[] = [];
  private ramps: LiveRamp[] = [];
  private readonly cfg: PinballBumpersConfig;
  private readonly bumperPoints: number;
  private readonly targetPoints: number;
  private readonly rampBonus: number;
  private readonly bumperRadius: number;
  private readonly kickBoost: number;
  private readonly hitCooldownMs: number;

  constructor(params: PinballBumpersConfig = {}) {
    this.cfg = params;
    this.bumperPoints = params.bumperPoints ?? 50;
    this.targetPoints = params.targetPoints ?? 25;
    this.rampBonus = params.rampBonus ?? 150;
    this.bumperRadius = params.bumperRadius ?? 22;
    this.kickBoost = params.kickBoost ?? 60;
    this.hitCooldownMs = params.hitCooldownMs ?? 120;
  }

  /** The shared event bus (the scene owns it; attach() set this.scene). */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  /** Re-arm to a fresh-level state so a restart rebuilds + replays clean. */
  reset(): void {
    this.obstacles = [];
    this.ramps = [];
  }

  /**
   * Build the scoring field from config (or a sensible default from the play bounds when
   * none is configured), tag a placeholder sprite for each so __GAME__.entities counts it,
   * and publish the read seam under the name the scene looks up.
   */
  attach(scene: any): void {
    this.scene = scene;
    scene.pinballBumpers = this;

    const bumpers = this.cfg.bumpers ?? [];
    const targets = this.cfg.targets ?? [];
    const ramps = this.cfg.ramps ?? [];

    // When the level configured NO field, lay out a small default one from the bounds so
    // the genre always has something to score against (generic — derived from data).
    if (bumpers.length === 0 && targets.length === 0 && ramps.length === 0) {
      const w = scene.mapWidth || 540;
      const h = scene.mapHeight || 960;
      const r = this.bumperRadius;
      // three pop-bumpers in the upper-middle field (a classic triangular cluster)
      for (const [i, [fx, fy]] of [
        [0.5, 0.28],
        [0.34, 0.42],
        [0.66, 0.42],
      ].entries()) {
        this.obstacles.push(
          this.makeObstacle(`bumper_${i}`, w * fx, h * fy, r * 2, r * 2, this.bumperPoints, 'bumper', this.kickBoost),
        );
      }
      // two side targets
      this.obstacles.push(this.makeObstacle('target_0', w * 0.16, h * 0.34, 28, 64, this.targetPoints, 'target', 0));
      this.obstacles.push(this.makeObstacle('target_1', w * 0.84, h * 0.34, 28, 64, this.targetPoints, 'target', 0));
      // one side ramp: enter near the right wall, exit up top → bonus
      this.ramps.push(
        this.makeRamp(
          'ramp_0',
          { x: w * 0.9, y: h * 0.6, width: 36, height: 90 },
          { x: w * 0.9, y: h * 0.16, width: 36, height: 60 },
          this.rampBonus,
        ),
      );
    } else {
      for (const [i, b] of bumpers.entries()) {
        const r = b.radius ?? this.bumperRadius;
        this.obstacles.push(
          this.makeObstacle(b.id ?? `bumper_${i}`, b.x, b.y, r * 2, r * 2, b.points ?? this.bumperPoints, 'bumper', b.kick ?? this.kickBoost),
        );
      }
      for (const [i, t] of targets.entries()) {
        this.obstacles.push(
          this.makeObstacle(t.id ?? `target_${i}`, t.x, t.y, t.width ?? 28, t.height ?? 64, t.points ?? this.targetPoints, 'target', 0),
        );
      }
      for (const [i, rmp] of ramps.entries()) {
        this.ramps.push(this.makeRamp(rmp.id ?? `ramp_${i}`, rmp.mouth, rmp.exit, rmp.bonus ?? this.rampBonus));
      }
    }
  }

  /** No Arcade overlap wiring — the field is resolved against the live ball in update(). */
  setupCollisions(): void {}

  /**
   * Per-frame: read the live ball (the same world-read every paddle_ball system uses) and
   * resolve the scoring field against it — bumper/target deflect+score, ramp routing bonus.
   */
  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    const ball = scene.ball;
    const vel: Vec2 | undefined = scene.ballVel;
    if (!ball || !vel) return;
    const bbox = aabb(ball.x, ball.y, ball.displayWidth, ball.displayHeight);

    this.resolveObstacles(ball, bbox, vel);
    this.resolveRamps(bbox);
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** Build one obstacle + its placeholder sprite (counted in __GAME__.entities). */
  private makeObstacle(
    id: string,
    cx: number,
    cy: number,
    w: number,
    h: number,
    points: number,
    kind: 'bumper' | 'target',
    kick: number,
  ): LiveObstacle {
    this.spawnSprite(cx, cy, w, h, kind === 'bumper' ? 0xff7a59 : 0x8fd14f, kind);
    return { id, box: aabb(cx, cy, w, h), points, kind, kick, lastHitAt: Number.NEGATIVE_INFINITY };
  }

  /** Build one ramp lane (mouth + exit boxes). The ramp draws faint guide markers only. */
  private makeRamp(id: string, mouth: RampZone, exit: RampZone, bonus: number): LiveRamp {
    this.spawnSprite(mouth.x, mouth.y, mouth.width ?? 36, mouth.height ?? 90, 0x4aa3ff, 'ramp', 0.25);
    this.spawnSprite(exit.x, exit.y, exit.width ?? 36, exit.height ?? 60, 0x4aa3ff, 'ramp', 0.25);
    return {
      id,
      mouth: aabb(mouth.x, mouth.y, mouth.width ?? 36, mouth.height ?? 90),
      exit: aabb(exit.x, exit.y, exit.width ?? 36, exit.height ?? 60),
      bonus,
      onRamp: false,
    };
  }

  /** Add a tinted placeholder rect to the obstacles group so __GAME__.entities counts it. */
  private spawnSprite(cx: number, cy: number, w: number, h: number, tint: number, type: string, alpha = 1): void {
    const scene = this.scene;
    const key = '__px';
    const sprite = scene.add?.sprite?.(cx, cy, key);
    if (!sprite) return;
    sprite.setDisplaySize?.(w, h);
    sprite.setTint?.(tint);
    sprite.setAlpha?.(alpha);
    sprite.__type = type;
    sprite.__id = `${type}_${Math.round(cx)}_${Math.round(cy)}`;
    scene.obstacles?.add?.(sprite);
  }

  /**
   * Resolve every bumper/target against the ball: on overlap, deflect (shallow-axis bounce,
   * the exact engine math), apply a bumper KICK, score it (registry `score` + score.changed),
   * and emit `target.hit` at the contact moment — once per element per cooldown window.
   */
  private resolveObstacles(ball: any, bbox: AABB, vel: Vec2): void {
    const now = this.clockMs();
    for (const ob of this.obstacles) {
      const overlapping =
        Math.abs(bbox.cx - ob.box.cx) < bbox.halfW + ob.box.halfW &&
        Math.abs(bbox.cy - ob.box.cy) < bbox.halfH + ob.box.halfH;
      if (!overlapping) continue;
      // Always deflect (so the ball never sticks in the obstacle) — exact grid reflect.
      resolveAABBBounce(bbox, ob.box, vel);
      ball.x = bbox.cx;
      ball.y = bbox.cy;
      // A pop-bumper kicks the ball outward (a small speed boost) — preserve direction.
      if (ob.kind === 'bumper' && ob.kick > 0) this.applyKick(vel, ob.kick);
      // ball.bounced mirror so a deflect reads on the standard reflect channel too.
      this.bus?.emit('ball.bounced', { x: ball.x, y: ball.y, off: 'brick' });
      // Score at most once per cooldown window (one physical contact = one award).
      if (now - ob.lastHitAt < this.hitCooldownMs) continue;
      ob.lastHitAt = now;
      this.scoreTarget(ob);
    }
  }

  /** Boost the ball's speed by `kick` px/s along its CURRENT direction (preserves angle). */
  private applyKick(vel: Vec2, kick: number): void {
    const s = speedOf(vel);
    if (s <= 1e-6) return;
    const scale = (s + kick) / s;
    vel.x *= scale;
    vel.y *= scale;
  }

  /**
   * Award a bumper/target's points to the single score source (registry `score`), mirror the
   * standardized `score.changed` push, fire any bound cosmetic effect, then emit the true
   * gameplay seam `target.hit` — so __GAME__.score has already risen when the event logs.
   */
  private scoreTarget(ob: LiveObstacle): void {
    const reg = this.scene?.registry;
    if (reg) {
      const next = Number(reg.get('score') ?? 0) + ob.points;
      reg.set('score', next);
      this.bus?.emit('score.changed', { score: next });
    }
    this.scene?.fireEffect?.('target.hit', ob.box.cx, ob.box.cy);
    // The true gameplay seam: a scoring target/bumper was hit — score rose + the ball deflected.
    this.bus?.emit('target.hit', {
      id: ob.id,
      kind: ob.kind,
      points: ob.points,
      x: ob.box.cx,
      y: ob.box.cy,
    });
  }

  /**
   * Resolve every ramp against the ball: entering a ramp's MOUTH latches it "on ramp"; while
   * latched, reaching that ramp's EXIT completes the ramp — award the bonus (registry `score`
   * + score.changed) and emit `ramp.completed`. A ramp does NOT deflect the ball (it is a lane).
   */
  private resolveRamps(bbox: AABB): void {
    for (const r of this.ramps) {
      if (!r.onRamp) {
        if (this.boxOverlap(bbox, r.mouth)) r.onRamp = true;
        continue;
      }
      // latched on this ramp — completing it requires reaching the exit zone.
      if (this.boxOverlap(bbox, r.exit)) {
        r.onRamp = false;
        this.completeRamp(r);
      }
    }
  }

  /** Award a completed ramp's bonus + fire `ramp.completed` (the true ramp-bonus seam). */
  private completeRamp(r: LiveRamp): void {
    const reg = this.scene?.registry;
    if (reg) {
      const next = Number(reg.get('score') ?? 0) + r.bonus;
      reg.set('score', next);
      this.bus?.emit('score.changed', { score: next });
    }
    this.scene?.fireEffect?.('ramp.completed', r.exit.cx, r.exit.cy);
    // The true gameplay seam: the ball completed a ramp → a ramp bonus applied.
    this.bus?.emit('ramp.completed', {
      id: r.id,
      bonus: r.bonus,
      x: r.exit.cx,
      y: r.exit.cy,
    });
  }

  /** Strict AABB overlap test (mirrors ball-physics.aabbOverlap; touching edges excluded). */
  private boxOverlap(a: AABB, b: AABB): boolean {
    return (
      Math.abs(a.cx - b.cx) < a.halfW + b.halfW &&
      Math.abs(a.cy - b.cy) < a.halfH + b.halfH
    );
  }

  /** Scene clock ms when present (matches ScoreCombo's clock), else wall clock. */
  private clockMs(): number {
    return this.scene?.time?.now ?? Date.now();
  }

  // ── component surface (the declared PUSH-channel event set) ──────────────────

  /**
   * The events this scoring field publishes. Each EventDecl is a TRUE statement about a real
   * emit site:
   *   - target.hit     ← scoreTarget(): the ball overlaps a bumper/target → score rises + ball deflects.
   *   - ramp.completed ← completeRamp(): the ball enters a ramp mouth then reaches its exit → bonus applies.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'target.hit',
          payload: '{id,kind,points,x,y}',
          scope: 'archetype',
          drivenBy: 'the ball hits a scoring target/bumper on the pinball field',
          expect:
            '__GAME__.score increases by the element points and the ball deflects (its velocity reflects, a bumper also kicks it); target.hit logged',
        },
        {
          name: 'ramp.completed',
          payload: '{id,bonus,x,y}',
          scope: 'archetype',
          drivenBy: 'the ball enters a ramp mouth and then reaches that ramp exit',
          expect: '__GAME__.score increases by the ramp bonus; ramp.completed logged',
        },
      ],
    };
  }
}
