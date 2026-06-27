/**
 * MultiBall — a multiball power-up that SPLITS the active ball into N extra balls
 * (BUILD — system; brick-breaker delta). The brick-breaker crowd-pleaser: a power-up
 * trigger forks the one ball into several, each tracked + reflected INDEPENDENTLY.
 *
 * Why a SYSTEM (not a behavior): the engine's BasePaddleScene drives exactly ONE ball
 * (`scene.ball` + `scene.ballVel`, integrated in stepBall). The extra balls a split
 * creates are NOT that engine ball, so this system OWNS them end-to-end — it spawns
 * each as a sprite in the scene's `entities` group (so __GAME__.entities counts it as a
 * 'ball'), gives each its OWN velocity, and in update() integrates EACH with the same
 * sub-stepped reflection the engine uses for the primary ball (walls mirror + the
 * BrickGrid shallow-axis seam + the paddle CONTACT-POINT bounce). "Each with its own
 * reflection" is literally true: every tracked ball reflects on its own state.
 *
 * THE OBSERVABLE TRANSITION (the contract): a split increases the active ball count.
 * The primary engine ball is `scene.ball`; each extra ball is a sprite tagged
 * `__type='ball'` added to `scene.entities`, which the core hook's collectEntities()
 * scans — so `__GAME__.entities.filter(e => e.type==='ball').length` GOES UP on a split.
 *
 * THE TRIGGER (a multiball power-up triggers): the system listens on the shared bus for
 * a configurable power-up event (default 'brick.cleared') and splits with a configured
 * chance; it also exposes a public triggerSplit() seam so a $custom power-up effect, or
 * a verify driver, can fire a split deterministically. On a split it emits 'ball.split'.
 *
 * Params (all OPTIONAL — declared defaults, never baked):
 *   splitCount   how many EXTRA balls each split spawns (default 2).
 *   maxBalls     cap on simultaneously-tracked extra balls (default 6).
 *   triggerEvent the bus event that can fire a split (default 'brick.cleared').
 *   splitChance  probability in [0,1] a trigger fires a split (default 0.25).
 *   spreadDeg    total angular spread the extra balls fan across (default 50).
 */
import type { ISceneSystem } from '../scenes/paddle-data';
import type { ComponentSurface, EventBus } from '@contract/component-surface';
import {
  aabb,
  paddleBounce,
  speedOf,
  subStepCount,
  type Vec2,
} from '../scenes/ball-physics';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors every system file). */
export const CAPABILITY = {
  kind: 'system',
  id: 'MultiBall',
  intent:
    'A multiball power-up splits the active ball into N independently-tracked extra balls, each spawned into the scene entities group (so the active ball count rises) and integrated with its OWN sub-stepped reflection (walls mirror, the BrickGrid shallow-axis seam, the paddle contact-point bounce). Triggers off a configurable bus event with a configured chance, or via the public triggerSplit() seam; emits ball.split at the real fork moment.',
  attachesTo: 'scene',
  params: ['splitCount', 'maxBalls', 'triggerEvent', 'splitChance', 'spreadDeg'],
  roles: ['ball'],
} as const;

export const MULTIBALL_CAPABILITIES = [CAPABILITY] as const;

export interface MultiBallConfig {
  splitCount?: number;
  maxBalls?: number;
  triggerEvent?: string;
  splitChance?: number;
  spreadDeg?: number;
}

/** One extra ball this system owns (the sprite + its independent velocity). */
interface ExtraBall {
  sprite: any;
  vel: Vec2;
}

export class MultiBall implements ISceneSystem {
  private scene: any;
  private extras: ExtraBall[] = [];
  private group: any = null;
  private unsubscribe: (() => void) | null = null;
  private serial = 0;
  private readonly splitCount: number;
  private readonly maxBalls: number;
  private readonly triggerEvent: string;
  private readonly splitChance: number;
  private readonly spreadDeg: number;

  constructor(params: MultiBallConfig = {}) {
    this.splitCount = Math.max(1, params.splitCount ?? 2);
    this.maxBalls = Math.max(1, params.maxBalls ?? 6);
    this.triggerEvent = params.triggerEvent ?? 'brick.cleared';
    this.splitChance = Math.min(1, Math.max(0, params.splitChance ?? 0.25));
    this.spreadDeg = params.spreadDeg ?? 50;
  }

  /** The shared event bus (the scene owns it; attach() set this.scene). */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  /** Re-arm to a fresh-level state so a restarted level is genuinely replayable. */
  reset(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.extras = [];
    this.group = null;
    this.serial = 0;
  }

  /** Wire the trigger listener + the entities group the spawned balls live in. */
  attach(scene: any): void {
    this.scene = scene;
    // The 'entities' group is one of the core hook's scanned group names, so any
    // sprite added here (tagged __type='ball') shows up in __GAME__.entities.
    if (!scene.entities || typeof scene.entities.add !== 'function') {
      scene.entities = scene.add.group();
    }
    this.group = scene.entities;
    // A power-up trigger: listen for the configured bus event; split by chance.
    this.unsubscribe = scene.eventBus?.on?.(this.triggerEvent, () => {
      if (Math.random() < this.splitChance) this.triggerSplit();
    });
  }

  /** This system owns its own ball integration in update() — no Arcade overlap wiring. */
  setupCollisions(): void {}

  /**
   * The PUBLIC power-up seam: split the CURRENT active ball into `splitCount` extra
   * balls. Each new ball starts at the source ball's position with the source ball's
   * speed, fanned across `spreadDeg` so they diverge. Adds each to the entities group
   * (active ball count UP) and emits `ball.split`. Returns the number actually spawned
   * (0 when capped or no live source ball). Safe to call from a $custom effect/driver.
   */
  triggerSplit(): number {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return 0;
    const src = scene.ball;
    if (!src) return 0;

    // Source velocity + speed: prefer the live engine ball velocity; fall back to an
    // already-tracked extra so a chain-split still has a sane heading/speed.
    const srcVel: Vec2 = scene.ballVel && speedOf(scene.ballVel) > 1e-3
      ? { x: scene.ballVel.x, y: scene.ballVel.y }
      : (this.extras[0]?.vel ?? { x: 0, y: -(scene.ballSpeed ?? 320) });
    const speed = speedOf(srcVel) || (scene.ballSpeed ?? 320);
    const baseAngle = Math.atan2(srcVel.y, srcVel.x);

    const room = this.maxBalls - this.extras.length;
    const want = Math.min(this.splitCount, Math.max(0, room));
    if (want <= 0) return 0;

    const spread = (this.spreadDeg * Math.PI) / 180;
    const size = src.displayWidth || 14;
    let spawned = 0;
    for (let i = 0; i < want; i += 1) {
      // Fan the extra balls symmetrically around the source heading.
      const frac = want === 1 ? 0 : i / (want - 1) - 0.5; // [-0.5 .. 0.5]
      const a = baseAngle + frac * spread + (Math.random() - 0.5) * 0.08;
      const vel: Vec2 = { x: Math.cos(a) * speed, y: Math.sin(a) * speed };
      const sprite = this.spawnBall(src.x, src.y, size);
      this.extras.push({ sprite, vel });
      spawned += 1;
    }

    if (spawned > 0) {
      // The true gameplay seam: the active ball count just rose by `spawned`.
      this.bus?.emit('ball.split', {
        spawned,
        active: this.activeBallCount(),
      });
    }
    return spawned;
  }

  /** Active ball count = the engine primary ball (if live) + every tracked extra. */
  activeBallCount(): number {
    const hasPrimary = this.scene?.ball ? 1 : 0;
    return hasPrimary + this.extras.length;
  }

  /**
   * Per-frame: integrate EVERY extra ball with its OWN sub-stepped reflection (the
   * same engine rules the primary ball uses — walls mirror, the BrickGrid shallow-axis
   * seam, the paddle contact-point bounce). A ball that falls below the field is removed
   * (an extra ball costs no life — only the engine's primary ball does, per RB §2.4).
   */
  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted || this.extras.length === 0) return;
    const dt = Math.min(0.05, (scene.game?.loop?.delta ?? 1000 / 60) / 1000);
    const inset = scene._wallInset ?? 16;
    const mapW = scene.mapWidth ?? 0;
    const mapH = scene.mapHeight ?? 0;

    for (let i = this.extras.length - 1; i >= 0; i -= 1) {
      const eb = this.extras[i];
      const sprite = eb.sprite;
      if (!sprite || sprite.active === false) {
        this.extras.splice(i, 1);
        continue;
      }
      const minExtent = Math.min(sprite.displayWidth, sprite.displayHeight) / 2 || 6;
      const steps = subStepCount(eb.vel, dt, minExtent);
      const sdt = dt / steps;
      let dead = false;

      for (let s = 0; s < steps; s += 1) {
        sprite.x += eb.vel.x * sdt;
        sprite.y += eb.vel.y * sdt;
        const box = aabb(sprite.x, sprite.y, sprite.displayWidth, sprite.displayHeight);

        // walls (mirror at the inset). Bottom is OPEN (the death line).
        if (box.cx - box.halfW < inset && eb.vel.x < 0) {
          eb.vel.x = -eb.vel.x;
          sprite.x = inset + box.halfW;
        } else if (box.cx + box.halfW > mapW - inset && eb.vel.x > 0) {
          eb.vel.x = -eb.vel.x;
          sprite.x = mapW - inset - box.halfW;
        }
        if (box.cy - box.halfH < inset && eb.vel.y < 0) {
          eb.vel.y = -eb.vel.y;
          sprite.y = inset + box.halfH;
        }

        // bricks (the shared BrickGrid seam — shallow-axis bounce + clear/score).
        const box2 = aabb(sprite.x, sprite.y, sprite.displayWidth, sprite.displayHeight);
        const hit = scene.brickGrid?.hitBrickAt?.(box2, eb.vel);
        if (hit) {
          sprite.x = box2.cx;
          sprite.y = box2.cy;
          this.bus?.emit('ball.bounced', { x: sprite.x, y: sprite.y, off: 'brick' });
        }

        // paddle (CONTACT-POINT steering — its OWN reflection, never a plain mirror).
        this.bounceOffPaddle(sprite, eb);

        // death line: this extra ball fell below the field → drop it (no life cost).
        if (sprite.y - sprite.displayHeight / 2 > mapH) {
          dead = true;
          break;
        }
      }

      if (dead) {
        this.group?.remove?.(sprite, false, false);
        sprite.destroy?.();
        this.extras.splice(i, 1);
      }
    }
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** Spawn one extra ball sprite into the entities group, tagged so the hook counts it. */
  private spawnBall(x: number, y: number, size: number): any {
    const scene = this.scene;
    const hasTex = scene.textures?.exists?.('__px');
    const sprite = scene.add.sprite(x, y, hasTex ? '__px' : undefined);
    sprite.setDisplaySize?.(size, size);
    sprite.setTint?.(0xffe066);
    sprite.__type = 'ball';
    sprite.__id = `ball_split_${(this.serial += 1)}`;
    this.group?.add?.(sprite);
    return sprite;
  }

  /** Reflect an extra ball off the paddle by contact point when descending onto it. */
  private bounceOffPaddle(sprite: any, eb: ExtraBall): void {
    const paddle = this.scene?.paddle;
    if (!paddle) return;
    const pbox = aabb(paddle.x, paddle.y, paddle.displayWidth, paddle.displayHeight);
    const bbox = aabb(sprite.x, sprite.y, sprite.displayWidth, sprite.displayHeight);
    const overlapping =
      Math.abs(bbox.cx - pbox.cx) < bbox.halfW + pbox.halfW &&
      Math.abs(bbox.cy - pbox.cy) < bbox.halfH + pbox.halfH;
    if (overlapping && eb.vel.y > 0) {
      const speed = speedOf(eb.vel) || (this.scene?.ballSpeed ?? 320);
      eb.vel = paddleBounce(sprite.x, paddle.x, pbox.halfW, speed);
      sprite.y = pbox.cy - pbox.halfH - bbox.halfH - 0.5;
      this.bus?.emit('ball.bounced', {
        x: sprite.x,
        y: sprite.y,
        off: 'paddle',
        vx: eb.vel.x,
        vy: eb.vel.y,
      });
    }
  }

  // ── component surface (the declared PUSH-channel event set) ──────────────────

  /**
   * The event this system publishes. `ball.split` is a TRUE statement about the real
   * emit site in triggerSplit(): when a power-up trigger fires, N extra balls are added
   * to the entities group and the active ball count rises — the observable transition.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'ball.split',
          payload: '{spawned,active}',
          scope: 'archetype',
          drivenBy: 'a multiball power-up triggers (a bound bus event fires a split, or triggerSplit() is called)',
          expect:
            "the active ball count increases — __GAME__.entities gains `spawned` more entries of type 'ball'; ball.split logged",
        },
      ],
    };
  }
}
