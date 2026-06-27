/**
 * PaddleDuelAI — the Pong-style DUEL system: an AI opponent paddle + per-side scoring
 * (BUILD — system; paddle-duel genre).
 *
 * Turns the brick-breaker engine into a two-paddle DUEL. The base scene owns the player
 * paddle (a side bat on axis 'y') + the sub-stepped ball reflection; THIS system owns the
 * opponent half a real Pong needs:
 *   - an AI PADDLE on the far wall that tracks the ball's y (a capped tracking speed, so a
 *     fast volley can beat it — the skill gap);
 *   - the ball SPEED-UP per volley: every successful paddle return scales the ball speed by
 *     a step (capped), so rallies escalate (the Pong tension curve);
 *   - SCORING on a missed return: when the ball passes a paddle's plane (a side wall the
 *     base scene does not own — left/right are reflective walls in the brick engine, so this
 *     system intercepts the ball at the two duel goals itself), the OPPOSING side scores,
 *     the ball re-serves toward the side that conceded, and the match ends at first-to-N.
 *
 * It re-implements NOTHING the engine owns: the ball motion/reflection is the scene's
 * sub-step loop (the system only reads scene.ball + mutates scene.ballVel for the speed-up);
 * the win seam is scene.onLevelComplete(); the score is the registry 'score' (the player's
 * tally — the AI's tally is the system's own counter so __GAME__.score is the player score).
 * GENERIC: no count, no coordinate is baked — every number is a declared default param.
 *
 * Params (all OPTIONAL — declared defaults, never a baked value):
 *   targetScore     points to win the match (default 5 — "first to N").
 *   aiSpeed         AI paddle max tracking speed px/s (default 260 — < ball so it can lose).
 *   aiPaddleSide    which wall the AI bat sits on: 'left' | 'right' (default 'left'; the
 *                   player bat is the opposite side).
 *   aiPaddleHeight  AI bat length px along its slide axis (default 96).
 *   aiPaddleWidth   AI bat thickness px (default 18).
 *   speedUpFactor   ball-speed multiplier applied per paddle return (default 1.06).
 *   maxBallSpeed    ceiling for the per-volley speed-up px/s (default 720).
 *   wallInset       inset of the two duel goals from the world edge px (default 8).
 */
import type { ISceneSystem } from '../scenes/paddle-data';
import type { ComponentSurface, EventBus } from '@contract/component-surface';
import { speedOf, type Vec2 } from '../scenes/ball-physics';

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors every system file). */
export const CAPABILITY = {
  kind: 'system',
  id: 'PaddleDuelAI',
  intent:
    'Turn the engine into a Pong DUEL: an AI opponent paddle tracks the ball y at a capped speed (beatable), the ball speeds up per volley (escalating rallies, capped), and a missed return scores the opposing side, re-serves toward the conceding side, and WINS the match at first-to-N. The duel opponent + per-side scoring layer.',
  attachesTo: 'scene',
  params: [
    'targetScore',
    'aiSpeed',
    'aiPaddleSide',
    'aiPaddleHeight',
    'aiPaddleWidth',
    'speedUpFactor',
    'maxBallSpeed',
    'wallInset',
  ],
  roles: ['ball', 'paddle', 'aiPaddle'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface PaddleDuelAIConfig {
  targetScore?: number;
  aiSpeed?: number;
  aiPaddleSide?: 'left' | 'right';
  aiPaddleHeight?: number;
  aiPaddleWidth?: number;
  speedUpFactor?: number;
  maxBallSpeed?: number;
  wallInset?: number;
}

export class PaddleDuelAI implements ISceneSystem {
  private scene: any;
  private aiPaddle: any = null;
  /** The PLAYER's tally — mirrored onto the registry 'score' so __GAME__.score reads it. */
  private playerScore = 0;
  /** The AI's tally (the opponent side; the system's own counter). */
  private aiScore = 0;
  private over = false;
  /** Last frame's ball-side sign (-1 left of center, +1 right) — a volley-return edge. */
  private lastReturnSide = 0;

  private readonly targetScore: number;
  private readonly aiSpeed: number;
  private readonly aiPaddleSide: 'left' | 'right';
  private readonly aiPaddleHeight: number;
  private readonly aiPaddleWidth: number;
  private readonly speedUpFactor: number;
  private readonly maxBallSpeed: number;
  private readonly wallInset: number;

  constructor(params: PaddleDuelAIConfig = {}) {
    this.targetScore = Math.max(1, params.targetScore ?? 5);
    this.aiSpeed = params.aiSpeed ?? 260;
    this.aiPaddleSide = params.aiPaddleSide ?? 'left';
    this.aiPaddleHeight = params.aiPaddleHeight ?? 96;
    this.aiPaddleWidth = params.aiPaddleWidth ?? 18;
    this.speedUpFactor = params.speedUpFactor ?? 1.06;
    this.maxBallSpeed = params.maxBallSpeed ?? 720;
    this.wallInset = params.wallInset ?? 8;
  }

  /** The shared event bus (the scene owns it; attach() set this.scene). */
  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  /** Re-arm all run state so a restarted level is genuinely replayable. */
  reset(): void {
    this.aiPaddle = null;
    this.playerScore = 0;
    this.aiScore = 0;
    this.over = false;
    this.lastReturnSide = 0;
  }

  /** Build the AI opponent paddle on its wall + serve the first point toward a side. */
  attach(scene: any): void {
    this.scene = scene;
    this.playerScore = Number(scene.registry?.get('score') ?? 0);

    // The AI bat on the far wall (the opposite side from the player). It slides on y.
    const w = this.aiPaddleWidth;
    const h = this.aiPaddleHeight;
    const x =
      this.aiPaddleSide === 'left' ? this.wallInset + w / 2 : scene.mapWidth - this.wallInset - w / 2;
    const y = scene.mapHeight / 2;
    const key = scene.textures?.exists?.('__px') ? '__px' : undefined;
    const sprite = key
      ? scene.add.sprite(x, y, key)
      : scene.add.rectangle(x, y, w, h, 0xe85d75);
    if (key) {
      sprite.setDisplaySize(w, h);
      sprite.setTint(0xe85d75);
    }
    sprite.__type = 'aiPaddle';
    sprite.__id = 'ai_paddle';
    this.aiPaddle = sprite;
    // Surface it so __GAME__.entities counts the opponent bat.
    scene.obstacles?.add?.(sprite);

    // Kick off the first point toward the player's side so the rally starts immediately.
    this.serveToward(this.aiPaddleSide === 'left' ? 'right' : 'left');
  }

  /** No Arcade overlap wiring — the per-frame update() reads the ball directly. */
  setupCollisions(): void {}

  /**
   * Per-frame: (1) drive the AI bat toward the ball's y (capped — beatable); (2) reflect the
   * ball off the AI bat AND apply the per-volley speed-up at the true return seam; (3) score
   * the opposing side when the ball passes a duel goal, re-serve, and win at first-to-N.
   */
  update(): void {
    const scene = this.scene;
    const ball = scene?.ball;
    if (!scene || this.over || scene.gameCompleted || !ball || !this.aiPaddle) return;

    const dt = Math.min(0.05, (scene.game?.loop?.delta ?? 1000 / 60) / 1000);
    const vel: Vec2 = scene.ballVel;

    // (1) AI tracks the ball y at a capped speed (a fast volley can outrun it — the skill gap).
    const ai = this.aiPaddle;
    const halfH = (ai.displayHeight ?? this.aiPaddleHeight) / 2;
    const diff = ball.y - ai.y;
    const stepY = Math.sign(diff) * Math.min(Math.abs(diff), this.aiSpeed * dt);
    ai.y = Math.max(halfH, Math.min(scene.mapHeight - halfH, ai.y + stepY));

    // (2) Reflect the ball off the AI bat (vertical wall → flip vx) + speed up the volley.
    const halfW = (ai.displayWidth ?? this.aiPaddleWidth) / 2;
    const ballHalf = (ball.displayWidth ?? 14) / 2;
    const overlapY = Math.abs(ball.y - ai.y) < halfH + ballHalf;
    const towardAI = this.aiPaddleSide === 'left' ? vel.x < 0 : vel.x > 0;
    const reachAI =
      this.aiPaddleSide === 'left'
        ? ball.x - ballHalf <= ai.x + halfW
        : ball.x + ballHalf >= ai.x - halfW;
    if (overlapY && towardAI && reachAI) {
      vel.x = -vel.x;
      ball.x = this.aiPaddleSide === 'left' ? ai.x + halfW + ballHalf + 0.5 : ai.x - halfW - ballHalf - 0.5;
      this.speedUpVolley(vel);
    }

    // The player bat return (the base scene does not reflect off a side bat by default, so
    // detect the player's wall plane the same way and bounce + speed up there too).
    this.maybePlayerReturn(ball, vel, ballHalf);

    // (3) Score: the ball passed a duel goal (a side wall plane). The OPPOSING side scores.
    const leftGoal = this.wallInset;
    const rightGoal = scene.mapWidth - this.wallInset;
    if (ball.x - ballHalf <= leftGoal) {
      // ball exited the LEFT goal → the RIGHT side scored.
      this.score(this.aiPaddleSide === 'left' ? 'player' : 'ai', 'right');
    } else if (ball.x + ballHalf >= rightGoal) {
      // ball exited the RIGHT goal → the LEFT side scored.
      this.score(this.aiPaddleSide === 'left' ? 'ai' : 'player', 'left');
    }
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /**
   * The PLAYER paddle return on its wall plane. The player bat is the base-scene paddle (a
   * side bat on the wall opposite the AI). Mirror the AI reflect so a rally is two-sided.
   */
  private maybePlayerReturn(ball: any, vel: Vec2, ballHalf: number): void {
    const paddle = this.scene?.paddle;
    if (!paddle) return;
    const side = this.aiPaddleSide === 'left' ? 'right' : 'left';
    const halfW = (paddle.displayWidth ?? 18) / 2;
    const halfH = (paddle.displayHeight ?? 96) / 2;
    const overlapY = Math.abs(ball.y - paddle.y) < halfH + ballHalf;
    const towardPlayer = side === 'left' ? vel.x < 0 : vel.x > 0;
    const reach =
      side === 'left' ? ball.x - ballHalf <= paddle.x + halfW : ball.x + ballHalf >= paddle.x - halfW;
    if (overlapY && towardPlayer && reach) {
      vel.x = -vel.x;
      ball.x = side === 'left' ? paddle.x + halfW + ballHalf + 0.5 : paddle.x - halfW - ballHalf - 0.5;
      this.speedUpVolley(vel);
    }
  }

  /** Scale the ball speed by the per-volley step (capped). The angle is preserved. */
  private speedUpVolley(vel: Vec2): void {
    const cur = speedOf(vel);
    if (cur <= 0) return;
    const next = Math.min(this.maxBallSpeed, cur * this.speedUpFactor);
    const k = next / cur;
    vel.x *= k;
    vel.y *= k;
    // Keep the scene's recorded launch speed in step so a re-serve uses the escalated speed.
    this.scene.ballSpeed = next;
  }

  /**
   * Serve a fresh point: re-center the ball and launch it toward `side` at a duel angle. Fires
   * `ball.served` — the observable point-start moment.
   */
  private serveToward(side: 'left' | 'right'): void {
    const scene = this.scene;
    const ball = scene?.ball;
    if (!ball) return;
    ball.x = scene.mapWidth / 2;
    ball.y = scene.mapHeight / 2;
    const speed = scene.ballSpeed ?? 320;
    const dirX = side === 'left' ? -1 : 1;
    const jitter = (Math.random() - 0.5) * 0.7; // a small vertical lean so serves differ
    const len = Math.hypot(1, jitter) || 1;
    scene.ballVel = { x: (dirX / len) * speed, y: (jitter / len) * speed };
    // The base scene gates its own ball step on its private serve latch; mark the ball live
    // via the public serve seam so the engine integrator advances it, then override the
    // velocity to our duel launch (the base serve points up off the bottom bat).
    if (typeof scene.serveBall === 'function') scene.serveBall();
    scene.ballVel = { x: (dirX / len) * speed, y: (jitter / len) * speed };
    // ball.served — the true point-start seam: the ball launches toward a side.
    this.bus?.emit('ball.served', {
      toward: side,
      speed,
      playerScore: this.playerScore,
      aiScore: this.aiScore,
    });
  }

  /**
   * A side scored on a missed return. Increment that side's tally (the player's mirrors onto
   * the registry 'score'), fire `volley.scored`, then re-serve toward the side that conceded
   * (the loser serves) — or WIN the match at first-to-N.
   */
  private score(winner: 'player' | 'ai', goalSide: 'left' | 'right'): void {
    if (this.over) return;
    if (winner === 'player') {
      this.playerScore += 1;
      const reg = this.scene?.registry;
      if (reg) reg.set('score', this.playerScore);
    } else {
      this.aiScore += 1;
    }
    // volley.scored — the true scoring seam: that side's score incremented.
    this.bus?.emit('volley.scored', {
      side: winner,
      playerScore: this.playerScore,
      aiScore: this.aiScore,
    });

    if (this.playerScore >= this.targetScore || this.aiScore >= this.targetScore) {
      this.over = true;
      // The player winning the match is the level WIN; the AI winning is the loss.
      if (this.playerScore >= this.targetScore) this.scene.onLevelComplete?.();
      else this.scene.onPlayerDeath?.();
      return;
    }
    // The conceding side serves next (the ball went out THEIR goal → serve away from it).
    this.serveToward(goalSide === 'left' ? 'right' : 'left');
  }

  // ── component surface (the declared PUSH-channel event set) ──────────────────

  /**
   * The events this duel layer publishes. Both are TRUE statements about real emit sites:
   *   - ball.served   ← serveToward() (a point starts; the ball launches toward a side)
   *   - volley.scored ← score()       (a missed return; that side's score increments)
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'ball.served',
          payload: "{toward:'left'|'right',speed,playerScore,aiScore}",
          scope: 'archetype',
          drivenBy: 'a point starts (the first serve, or a re-serve after a score)',
          expect: 'the ball re-centers and launches toward a side (__GAME__ ball velocity points to that side); ball.served logged',
        },
        {
          name: 'volley.scored',
          payload: "{side:'player'|'ai',playerScore,aiScore}",
          scope: 'archetype',
          drivenBy: 'the ball passes a paddle (a missed return at a duel goal)',
          expect: "that side's score increments (the player side raises __GAME__.score); at first-to-N __GAME__.status resolves; volley.scored logged",
        },
      ],
    };
  }
}
