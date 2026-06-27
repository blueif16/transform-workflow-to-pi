import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import type { ComponentSurface } from '@contract/component-surface';

/**
 * CAPABILITY sidecar (kept consistent with the systems' sidecar shape; the paddle_ball
 * BEHAVIOR registry discovers behaviors via the authored taxonomy in
 * `registry/discover.mjs`, not via this const — so this is inert-but-documenting
 * metadata, never read by the drift gate).
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'PaddleController',
  intent:
    "One-axis paddle locomotion: read the bound control scheme's input source (Left/Right + A/D keys, OR the pointer) and slide the paddle ALONG its axis only, clamped to the play field — the rest of the paddle's degrees of freedom are frozen. This is what makes a paddle_ball game CONTROLLABLE (a frozen paddle is a fail); it pairs with a control-scheme record (paddle-keys / paddle-pointer).",
  roles: ['paddle'],
  params: ['speed', 'axis', 'source'],
  tuning: ['paddleSpeed'],
} as const;

/** PaddleController config — every number a DECLARED default, none baked from a game. */
export interface PaddleControllerConfig {
  /** paddle slide speed in px/s for the KEYS source (default 520). */
  speed?: number;
  /** which axis the paddle slides on ('x' = bottom bat, 'y' = side bat; default 'x'). */
  axis?: 'x' | 'y';
  /** input source: 'keys' (Left/Right + A/D) or 'pointer' (track cursor); default 'keys'. */
  source?: 'keys' | 'pointer';
}

/**
 * PaddleController — the one-axis CONTROLLABLE paddle locomotion (the archetype seam).
 *
 * Reads the SCENE-OWNED input the BasePaddleScene wires (cursors/wasdKeys + the live
 * pointer) and moves the paddle ONLY along its bound axis, clamped to the play field so
 * it never leaves the screen. The cross-axis position is frozen (a bottom bat never
 * rises). Because the paddle IS window.__GAME__.player, a real `keydown` (Left/Right or
 * A/D) moves __GAME__.player.x — the CONTROLLABLE invariant [RB §2.6]. A `setInput`
 * override seam lets the responsiveness driver drive it headless.
 *
 * Emits `paddle.moved {x,y}` on the shared bus at the real move moment (the position
 * changed this frame). Generic — no game/theme, no baked coordinate.
 */
export class PaddleController extends BaseBehavior {
  public speed: number;
  public axis: 'x' | 'y';
  public source: 'keys' | 'pointer';

  /** Min/max travel on the bound axis (set by the scene from the play-field bounds). */
  public min = 0;
  public max = Infinity;

  /** External per-frame input override (-1|0|1 on the bound axis), or null to self-read. */
  private overrideDir: number | null = null;

  constructor(config: PaddleControllerConfig = {}) {
    super();
    this.speed = config.speed ?? 520;
    this.axis = config.axis ?? 'x';
    this.source = config.source ?? 'keys';
  }

  /** Per-frame: read input, move the paddle on its axis (clamped), emit on a real move. */
  update(): void {
    const owner = this.getOwner<Phaser.GameObjects.Sprite & { scene: any }>();
    const scene = owner.scene as any;
    if (!owner || !scene) return;

    const before = this.axis === 'x' ? owner.x : owner.y;

    if (this.source === 'pointer' && this.overrideDir === null) {
      // Track the pointer on the bound axis (clamped).
      const p = scene.input?.activePointer;
      const target = this.axis === 'x' ? p?.worldX ?? p?.x : p?.worldY ?? p?.y;
      if (typeof target === 'number') {
        this.setAxis(owner, this.clamp(target));
      }
    } else {
      // Keys (or the override) — a discrete -1|0|1 direction × speed × dt.
      const dt = Math.min(0.05, (scene.game?.loop?.delta ?? 1000 / 60) / 1000);
      const dir = this.overrideDir ?? this.readKeyDir(scene);
      this.overrideDir = null; // override is per-frame
      if (dir !== 0) {
        const next = this.clamp(before + dir * this.speed * dt);
        this.setAxis(owner, next);
      }
    }

    const after = this.axis === 'x' ? owner.x : owner.y;
    if (after !== before) {
      // paddle.moved — fired at the real move moment (the position changed). Reach the
      // scene's shared bus (a scene without a bus is a clean no-op).
      this.bus?.emit('paddle.moved', { x: owner.x, y: owner.y });
    }
  }

  /** Resolve a -1|0|1 key direction on the bound axis from the scene-owned keys. */
  private readKeyDir(scene: any): number {
    const cursors = scene.cursors as Phaser.Types.Input.Keyboard.CursorKeys | undefined;
    const wasd = scene.wasdKeys as Record<string, Phaser.Input.Keyboard.Key> | undefined;
    const down = (k?: Phaser.Input.Keyboard.Key): boolean => !!k && k.isDown;
    let dir = 0;
    if (this.axis === 'x') {
      if (down(cursors?.left) || down(wasd?.A)) dir -= 1;
      if (down(cursors?.right) || down(wasd?.D)) dir += 1;
    } else {
      if (down(cursors?.up) || down(wasd?.W)) dir -= 1;
      if (down(cursors?.down) || down(wasd?.S)) dir += 1;
    }
    return dir;
  }

  /** Set the paddle's bound-axis position (and keep its body in sync if it has one). */
  private setAxis(owner: any, value: number): void {
    if (this.axis === 'x') owner.x = value;
    else owner.y = value;
    const body = owner.body as Phaser.Physics.Arcade.Body | undefined;
    if (body && typeof body.reset === 'function') body.reset(owner.x, owner.y);
  }

  /** Clamp a candidate position to the paddle's travel range on its axis. */
  private clamp(v: number): number {
    return Math.max(this.min, Math.min(this.max, v));
  }

  /**
   * Programmatic input override for ONE frame (mirrors top_down's behavior setInput):
   * the FSM / scene / responsiveness driver can drive the paddle headless.
   * @param dir -1 = toward min, 0 = none, +1 = toward max (on the bound axis)
   */
  setInput(dir: number): void {
    this.overrideDir = Math.sign(dir);
  }

  /**
   * The uniform component surface — the PUSH channel this behavior owns. Declares
   * `paddle.moved` (emitted from the real move seam in update()). The paddle position
   * flows via the existing __GAME__ adapter (player.x/y read off the sprite), so this
   * surface declares only the event + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'paddle.moved',
          payload: '{x,y}',
          scope: 'archetype',
          drivenBy: 'move input (Left/Right or A/D key, or pointer) on the paddle axis',
          expect: '__GAME__.player.x (or .y) changes this frame; paddle.moved logged',
        },
      ],
    };
  }
}
