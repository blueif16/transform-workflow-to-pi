import Phaser from 'phaser';
import * as utils from '../utils';
import { EventBus, type ComponentSurface } from '@contract/component-surface';
import { ScreenEffectHelper } from '../behaviors';
import {
  aabb,
  paddleBounce,
  subStepCount,
  type AABB,
  type Vec2,
} from './ball-physics';

/**
 * ============================================================================
 * BasePaddleScene — the paddle-ball engine scene base (KEEP — engine)
 * ============================================================================
 *
 * The single foundation for ALL paddle-ball level scenes (the paddle_ball analogue of
 * top_down's BaseGameScene). Template Method + Hooks. The data-driven DataPaddleScene
 * extends this and fills the abstract methods FROM DATA.
 *
 * OWNS the ~80% engine (RB §0):
 *   - the PADDLE as the player (one-axis-controllable; window.__GAME__.player IS the
 *     paddle, so player.x/vx are the live observables);
 *   - the BALL, integrated with SUB-STEPPING so it never tunnels (RB §2.2): each frame
 *     the ball's displacement is split into N small steps, and after every step it
 *     bounces off the three solid walls (mirror) and off any brick (via the BrickGrid
 *     seam, shallow-axis) and off the paddle BY CONTACT POINT (RB §2.1) — never a plain
 *     mirror; total speed is preserved;
 *   - LIVES: a ball below the paddle costs EXACTLY one life (latched per serve; RB §2.4),
 *     then re-serves — or loses (status:'lost') at 0 lives;
 *   - the WIN seam (onLevelComplete -> status:'won') the BrickGrid fires on clear-all
 *     (RB §2.5);
 *   - the markReady() / win-lose registry seam (window.__GAME__) + the shared EventBus.
 *
 * NO gravity. BOOTS EMPTY: renders with ZERO generated art (placeholder rects).
 *
 * ABSTRACT METHODS (DataPaddleScene fills from data):
 *   setupBounds, createBackground, createPaddle, createBall, createBricks
 */
export abstract class BasePaddleScene extends Phaser.Scene {
  // ── scene state ───────────────────────────────────────────────────────────
  public gameCompleted = false;
  private _readyLatched = false;

  // ── event protocol (shared bus + log) ──────────────────────────────────────
  public readonly eventBus = new EventBus();
  private _lastStatus: string | undefined = undefined;

  // ── world dimensions ────────────────────────────────────────────────────────
  public mapWidth = 0;
  public mapHeight = 0;

  // ── core game objects ─────────────────────────────────────────────────────
  /** The PADDLE — the player; read live by __GAME__.player. Set in createPaddle(). */
  public paddle: any;
  /** Alias so window.__GAME__.player (which reads scene.player) IS the paddle. */
  public get player(): any {
    return this.paddle;
  }
  /** The ball sprite. Set in createBall(). */
  public ball: any;
  /** Live ball velocity (px/s) — the sub-step integrator advances the sprite from it. */
  public ballVel: Vec2 = { x: 0, y: 0 };
  /** The ball's launch speed (constant; a paddle bounce changes ANGLE not speed). */
  public ballSpeed = 320;
  /** Obstacles / bricks group — read by __GAME__.entities. */
  public obstacles!: Phaser.GameObjects.Group;

  /** Remaining lives (a ball below the paddle costs one; 0 = lose). __GAME__.lives reads this. */
  public lives = 3;
  /** One-shot latch so a single ball-below transition costs EXACTLY one life (RB §2.4). */
  private _ballLost = false;
  /** True once the ball is in play (after a serve). */
  private _ballLive = false;

  // ── input (scene-owned; the PaddleController reads this state) ──────────────
  public wasdKeys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  public cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  public background?: Phaser.GameObjects.TileSprite;

  constructor(config: string | Phaser.Types.Scenes.SettingsConfig) {
    super(config);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEMPLATE METHOD: CREATE
  // ══════════════════════════════════════════════════════════════════════════

  createBaseElements(): void {
    this.gameCompleted = false;
    this._readyLatched = false;
    this._ballLost = false;
    this._ballLive = false;
    this.registry.set('status', 'playing');

    this.physics.world.gravity.x = 0;
    this.physics.world.gravity.y = 0;

    // environment
    this.setupBounds();
    this.createBackground();
    this.createWorldWalls();

    // groups
    this.obstacles = this.add.group();

    // entities
    this.createBricks();
    this.createPaddle();
    this.createBall();

    // input
    this.setupInputs();

    // systems' collisions (player + ball exist)
    this.setupCustomCollisions();

    // HUD
    this.scene.launch('UIScene', { gameSceneKey: this.scene.key });

    this.cameras.main.fadeIn(200);
  }

  /** Build the three SOLID walls (top/left/right). The BOTTOM is the death line (open). */
  protected createWorldWalls(): void {
    utils.ensurePlaceholderTexture(this, '__px', 8, 8, 'tileset');
    const t = 16; // wall thickness px
    const slot = (this.levelDataWallSlot() && this.textures.exists(this.levelDataWallSlot()!))
      ? this.levelDataWallSlot()!
      : '__px';
    const mk = (x: number, y: number, w: number, h: number) => {
      const wall = this.add.tileSprite(x, y, w, h, slot).setOrigin(0.5, 0.5).setDepth(-1);
      if (slot === '__px') wall.setTint(0x39435a);
    };
    mk(this.mapWidth / 2, t / 2, this.mapWidth, t); // top
    mk(t / 2, this.mapHeight / 2, t, this.mapHeight); // left
    mk(this.mapWidth - t / 2, this.mapHeight / 2, t, this.mapHeight); // right
    this._wallInset = t;
  }
  /** Wall thickness (the ball reflects at this inset from the world edges). */
  protected _wallInset = 16;
  /** Override hook: the level-default wall slot (DataPaddleScene reads it from data). */
  protected levelDataWallSlot(): string | undefined {
    return undefined;
  }

  setupInputs(): void {
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.wasdKeys = {
      W: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEMPLATE METHOD: UPDATE
  // ══════════════════════════════════════════════════════════════════════════

  baseUpdate(): void {
    this.eventBus.setFrame(this.game.loop.frame);
    this.markReady();
    this.publishStatus();
    if (this.gameCompleted) return;

    // 1) Drive the paddle (its bound PaddleController behavior reads the scene input).
    if (this.paddle?.behaviors) this.paddle.behaviors.update();

    // 2) Integrate the ball with SUB-STEPPING (the no-tunnel guarantee, RB §2.2).
    this.stepBall();

    // 3) Tick any registered systems (the BrickGrid's clear-all win check).
    this.onPostUpdate();
  }

  /**
   * Advance the ball one frame, SUB-STEPPED so it can never tunnel (RB §2.2). The
   * per-frame displacement is split into N steps each ≤ the smallest collider half
   * extent; after EVERY step the ball bounces off the three solid walls (mirror), off a
   * brick (the BrickGrid seam — shallow-axis), and off the paddle BY CONTACT POINT
   * (paddleBounce — never a plain mirror). A ball whose top crosses the death line costs
   * exactly one life (latched) and re-serves.
   */
  protected stepBall(): void {
    const ball = this.ball;
    if (!ball || !this._ballLive) return;
    const dt = Math.min(0.05, (this.game?.loop?.delta ?? 1000 / 60) / 1000);
    const minExtent = Math.min(ball.displayWidth, ball.displayHeight) / 2 || 6;
    const steps = subStepCount(this.ballVel, dt, minExtent);
    const sdt = dt / steps;

    for (let i = 0; i < steps; i += 1) {
      ball.x += this.ballVel.x * sdt;
      ball.y += this.ballVel.y * sdt;
      const bbox = aabb(ball.x, ball.y, ball.displayWidth, ball.displayHeight);

      // walls (mirror at the inset). Bottom is OPEN (the death line).
      const inset = this._wallInset;
      if (bbox.cx - bbox.halfW < inset && this.ballVel.x < 0) {
        this.ballVel.x = -this.ballVel.x;
        ball.x = inset + bbox.halfW;
      } else if (bbox.cx + bbox.halfW > this.mapWidth - inset && this.ballVel.x > 0) {
        this.ballVel.x = -this.ballVel.x;
        ball.x = this.mapWidth - inset - bbox.halfW;
      }
      if (bbox.cy - bbox.halfH < inset && this.ballVel.y < 0) {
        this.ballVel.y = -this.ballVel.y;
        ball.y = inset + bbox.halfH;
      }

      // bricks (the BrickGrid seam — shallow-axis bounce + clear). At most one per step.
      const bbox2 = aabb(ball.x, ball.y, ball.displayWidth, ball.displayHeight);
      const hit = (this as any).brickGrid?.hitBrickAt?.(bbox2, this.ballVel);
      if (hit) {
        ball.x = bbox2.cx;
        ball.y = bbox2.cy;
        // ball.bounced — fired at the real reflect moment (a brick reflect).
        this.eventBus.emit('ball.bounced', { x: ball.x, y: ball.y, off: 'brick' });
      }

      // paddle (CONTACT-POINT steering — never a plain mirror; RB §2.1).
      this.maybePaddleBounce(ball);

      // death line: the ball's TOP crossed below the paddle's bottom → costs one life.
      if (ball.y - ball.displayHeight / 2 > this.mapHeight) {
        this.loseBall();
        return;
      }
    }
  }

  /** Reflect off the paddle by contact point when the ball overlaps it moving down. */
  protected maybePaddleBounce(ball: any): void {
    const paddle = this.paddle;
    if (!paddle) return;
    const pbox = aabb(paddle.x, paddle.y, paddle.displayWidth, paddle.displayHeight);
    const bbox = aabb(ball.x, ball.y, ball.displayWidth, ball.displayHeight);
    const overlapping =
      Math.abs(bbox.cx - pbox.cx) < bbox.halfW + pbox.halfW &&
      Math.abs(bbox.cy - pbox.cy) < bbox.halfH + pbox.halfH;
    // Only bounce when descending onto the paddle (avoids a double-bounce / sticking).
    if (overlapping && this.ballVel.y > 0) {
      this.ballVel = paddleBounce(ball.x, paddle.x, pbox.halfW, this.ballSpeed);
      // push the ball just above the paddle so it separates cleanly
      ball.y = pbox.cy - pbox.halfH - bbox.halfH - 0.5;
      // ball.bounced off the paddle (the steering moment) — payload carries the
      // contact offset so a cue/verify can read the steer.
      this.eventBus.emit('ball.bounced', {
        x: ball.x,
        y: ball.y,
        off: 'paddle',
        vx: this.ballVel.x,
        vy: this.ballVel.y,
      });
    }
  }

  /** The ball went below the paddle: cost EXACTLY one life (latched), then re-serve/lose. */
  protected loseBall(): void {
    if (this._ballLost) return; // already counted this serve
    this._ballLost = true;
    this._ballLive = false;
    this.lives = Math.max(0, this.lives - 1);
    // life.lost — fired ONCE per ball below the paddle (RB §2.4).
    this.eventBus.emit('life.lost', { lives: this.lives });
    if (this.lives <= 0) {
      this.onPlayerDeath();
      return;
    }
    // Re-serve after a short beat.
    this.time.delayedCall(400, () => this.serveBall());
  }

  /**
   * Serve the ball: re-center it above the paddle and launch at the configured speed +
   * angle (a small randomization so two serves differ). Arms the lost-latch.
   */
  serveBall(angleDeg?: number): void {
    const ball = this.ball;
    const paddle = this.paddle;
    if (!ball || !paddle) return;
    ball.x = paddle.x;
    ball.y = paddle.y - paddle.displayHeight / 2 - ball.displayHeight / 2 - 4;
    const baseAngle = angleDeg ?? this._serveAngleDeg;
    const jitter = (Math.random() - 0.5) * 16; // ±8deg so runs differ (RB §1 serve discipline)
    const a = ((baseAngle + jitter) * Math.PI) / 180;
    this.ballVel = { x: Math.cos(a) * this.ballSpeed, y: Math.sin(a) * this.ballSpeed };
    this._ballLost = false;
    this._ballLive = true;
  }
  protected _serveAngleDeg = -60;

  protected markReady(): void {
    if (this._readyLatched) return;
    this._readyLatched = true;
    this.registry.set('ready', true);
    const s = this.registry.get('status');
    if (s !== 'won' && s !== 'lost') this.registry.set('status', 'playing');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WIN / LOSE
  // ══════════════════════════════════════════════════════════════════════════

  /** Win seam — a system (BrickGrid) calls this on clear-all. Sets status:'won'. */
  onLevelComplete(): void {
    if (this.gameCompleted && this.registry.get('status') === 'won') return;
    this.gameCompleted = true;
    this.registry.set('status', 'won');
    this.publishStatus();
    ScreenEffectHelper.shakeStrong(this);
    this.time.delayedCall(400, () => {
      this.scene.launch('VictoryUIScene', { currentLevelKey: this.scene.key });
    });
  }

  /** Lose seam — fired when lives reach 0. Sets status:'lost'. */
  protected onPlayerDeath(): void {
    this.gameCompleted = true;
    this.registry.set('status', 'lost');
    this.eventBus.emit('player.died', { x: this.paddle?.x ?? 0, y: this.paddle?.y ?? 0 });
    this.publishStatus();
    this.scene.launch('GameOverUIScene', { currentLevelKey: this.scene.key });
  }

  /** Override to add system collisions (paddle + ball exist). */
  protected setupCustomCollisions(): void {}
  /** Per-frame post hook (DataPaddleScene ticks the registered systems here). */
  protected onPostUpdate(): void {}

  protected publishStatus(): void {
    const s = this.registry.get('status');
    const status = s === 'won' || s === 'lost' || s === 'playing' ? s : undefined;
    if (status === undefined || status === this._lastStatus) return;
    this._lastStatus = status;
    this.eventBus.emit('level.statusChanged', { status });
  }

  /** Fire every effect bound to `event` (overridden by DataPaddleScene). */
  fireEffect(_event: string, _x?: number, _y?: number): void {}

  // ── component surface (the SCENE-OWNED PUSH-channel event set) ──────────────

  /**
   * The uniform component surface for the paddle-ball scene base. Declares the
   * SCENE-OWNED events this engine emits on the shared bus (the PaddleController owns
   * `paddle.moved`; the BrickGrid owns `brick.cleared`). Each EventDecl is a TRUE
   * statement about a real emit site:
   *   - ball.bounced        ← stepBall / maybePaddleBounce (wall/brick/paddle reflect)
   *   - life.lost           ← loseBall (ball below the paddle)
   *   - player.died         ← onPlayerDeath (0 lives)
   *   - level.statusChanged ← publishStatus (ready/win/lose)
   *   - score.changed       ← utils.setScore (re-exported; the score seam)
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'ball.bounced',
          payload: "{x,y,off:'wall'|'brick'|'paddle',vx?,vy?}",
          scope: 'archetype',
          drivenBy: 'the ball reflects off a wall, a brick, or the paddle (by contact point)',
          expect:
            "the ball's velocity reflects (a paddle bounce steers the angle by contact point, total speed preserved); ball.bounced logged",
        },
        {
          name: 'life.lost',
          payload: '{lives}',
          scope: 'archetype',
          drivenBy: 'the ball falls below the paddle (crosses the death line)',
          expect: '__GAME__.lives decreases by EXACTLY one; the ball re-serves; life.lost logged',
        },
        {
          name: 'player.died',
          payload: '{x,y}',
          scope: 'core',
          drivenBy: 'lives reach 0 (last ball lost)',
          expect: "__GAME__.status becomes 'lost'; player.died logged",
        },
        {
          name: 'level.statusChanged',
          payload: "{status:'playing'|'won'|'lost'}",
          scope: 'core',
          drivenBy: 'ready / clear-all win / out-of-lives lose',
          expect: '__GAME__.status matches; level.statusChanged logged',
        },
        {
          name: 'score.changed',
          payload: '{score}',
          scope: 'core',
          drivenBy: 'a brick clears (score awarded)',
          expect: '__GAME__.score increases; score.changed logged',
        },
      ],
    };
  }

  // ── abstract methods (subclass MUST implement — DataPaddleScene fills from data) ──
  /** Set this.mapWidth / this.mapHeight. */
  abstract setupBounds(): void;
  /** Create the background (color and/or a TileSprite floor). */
  abstract createBackground(): void;
  /** Create the paddle. Must set this.paddle. */
  abstract createPaddle(): void;
  /** Create the ball + serve it. Must set this.ball + call serveBall(). */
  abstract createBall(): void;
  /** Create bricks (via the BrickGrid system). */
  abstract createBricks(): void;
}
