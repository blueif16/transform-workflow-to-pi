/**
 * ============================================================================
 * DataPaddleScene — the DATA-DRIVEN paddle-ball level loader (KEEP — engine)
 * ============================================================================
 *
 * Builds an ENTIRE paddle-ball level from a `PaddleLevelData` object as DATA — bounds,
 * the paddle (+ its bound control scheme), the ball serve, the brick grid (expanded
 * from the compact BrickGridData ∪ the explicit bricks[]), lives, the registered
 * systems[], and the event->effect bindings — with ZERO per-game placement code. The
 * blueprint's `layout` + capability BINDINGS become this data (W2 materializes
 * `src/levels/<level>.json`); the SDK instantiates it.
 *
 * It is the paddle_ball analogue of platformer's DataLevelScene / top_down's
 * DataTopDownScene. It extends BasePaddleScene and fills its abstract methods from data.
 *
 * GENERIC: no game/theme is encoded here. It reads ids + DATA; a game's strings live
 * ONLY in the materialized levels/<level>.json.
 */
import Phaser from 'phaser';
import { BasePaddleScene } from './BasePaddleScene';
import { BehaviorManager, PaddleController, type IBehavior } from '../behaviors';
import { resolveBehavior, resolveEffect } from '../behaviors/registry';
import { resolveSystem } from '../systems/registry';
import { resolveScheme, DEFAULT_SCHEME, type PaddleScheme } from '../controls';
import * as utils from '../utils';
import type {
  PaddleLevelData,
  BehaviorBinding,
  BrickData,
  ISceneSystem,
} from './paddle-data';
import { resolveCustomBehavior, resolveCustomSystem } from './custom-registry';

export abstract class DataPaddleScene extends BasePaddleScene {
  protected readonly levelData: PaddleLevelData;
  protected systems: ISceneSystem[] = [];
  protected scheme: PaddleScheme = DEFAULT_SCHEME;
  private effectBindings: PaddleLevelData['effects'] = [];

  constructor(
    sceneKeyOrConfig: string | Phaser.Types.Scenes.SettingsConfig,
    levelData: PaddleLevelData,
  ) {
    super(sceneKeyOrConfig);
    this.levelData = levelData;
  }

  // ── boot ────────────────────────────────────────────────────────────────────

  preload(): void {
    utils.ensurePlaceholderTexture(this, '__px', 8, 8, 'sprite');
  }

  create(): void {
    this.systems = [];
    this.scheme = resolveScheme(this.levelData.controlScheme) ?? DEFAULT_SCHEME;
    this.effectBindings = this.levelData.effects ?? [];
    this.ballSpeed = this.levelData.ball?.speed ?? 320;
    this._serveAngleDeg = this.levelData.ball?.angleDeg ?? -60;
    this.lives = this.levelData.lives ?? 3;
    // Expand the compact brick grid into bricks[] BEFORE the systems build them.
    this.expandBrickGrid();
    // Construct registered systems BEFORE building so they can wire in setupCollisions.
    this.constructSystems();
    this.createBaseElements();
  }

  update(): void {
    this.baseUpdate();
  }

  // ── the data-driven build (the abstract methods, all from DATA) ──────────────

  setupBounds(): void {
    const b = this.levelData.bounds;
    this.mapWidth = b?.width ?? this.scale.width;
    this.mapHeight = b?.height ?? this.scale.height;
  }

  createBackground(): void {
    const slot = this.levelData.backgroundSlot;
    if (slot && this.textures.exists(slot)) {
      this.background = this.add
        .tileSprite(0, 0, this.mapWidth, this.mapHeight, slot)
        .setOrigin(0)
        .setScrollFactor(0)
        .setDepth(-100);
    }
    this.cameras.main.setBackgroundColor(this.levelData.backgroundColor ?? '#10121e');
  }

  protected override levelDataWallSlot(): string | undefined {
    return this.levelData.wallSlot;
  }

  /** Bricks are built by the BrickGrid system (constructed in constructSystems). */
  createBricks(): void {
    // no-op: the BrickGrid system's attach() builds the bricks from levelData.bricks.
    // If the level bound no BrickGrid system, auto-add one so a brick layout always plays.
    const hasBrickGrid = this.systems.some((s) => (s as any)?.constructor?.name === 'BrickGrid');
    if (!hasBrickGrid && (this.levelData.bricks?.length ?? 0) > 0) {
      const sys = resolveSystem('BrickGrid', {});
      if (sys) this.systems.push(sys);
    }
  }

  createPaddle(): void {
    const pd = this.levelData.paddle;
    const w = pd.width ?? 96;
    const h = pd.height ?? 18;
    const key = pd.assetSlot && this.textures.exists(pd.assetSlot) ? pd.assetSlot : '__px';
    const paddle = this.add.sprite(pd.x, pd.y, key) as Phaser.GameObjects.Sprite & {
      __type?: string;
      __id?: string;
      behaviors?: BehaviorManager;
    };
    paddle.setDisplaySize(w, h);
    if (key === '__px') paddle.setTint(0x6fd3e8);
    paddle.__type = 'player';
    paddle.__id = pd.id ?? 'paddle';
    this.paddle = paddle;

    // Wire the CONTROLLABLE seam: the control scheme decides the move source + axis;
    // a PaddleController behavior reads the scene input + slides the paddle (clamped).
    paddle.behaviors = new BehaviorManager(paddle);
    const controller = paddle.behaviors.add(
      'control',
      new PaddleController({ source: this.scheme.move, axis: this.scheme.axis }),
    );
    // Clamp the paddle to the play field on its axis (the half-extent keeps it inside).
    const inset = this._wallInset;
    if (this.scheme.axis === 'x') {
      controller.min = inset + w / 2;
      controller.max = this.mapWidth - inset - w / 2;
    } else {
      controller.min = inset + h / 2;
      controller.max = this.mapHeight - inset - h / 2;
    }
    // Attach any extra bound behaviors declared on the paddle (a $custom paddle-grow).
    this.attachExtraBehaviors(paddle, pd.behaviors);
  }

  createBall(): void {
    const bd = this.levelData.ball;
    const size = bd.size ?? 14;
    const key = bd.assetSlot && this.textures.exists(bd.assetSlot) ? bd.assetSlot : '__px';
    const ball = this.add.sprite(bd.x, bd.y, key) as Phaser.GameObjects.Sprite & {
      __type?: string;
      __id?: string;
    };
    ball.setDisplaySize(size, size);
    if (key === '__px') ball.setTint(0xffe066);
    ball.__type = 'ball';
    ball.__id = bd.id ?? 'ball';
    this.ball = ball;
    this.serveBall();
  }

  // ── post-create: wire systems' collisions ─────────────────────────────────

  protected override setupCustomCollisions(): void {
    for (const sys of this.systems) {
      sys.reset?.();
      sys.attach(this);
      sys.setupCollisions?.();
    }
  }

  protected override onPostUpdate(): void {
    for (const sys of this.systems) sys.update?.();
  }

  // ── effects: fire a bound event->effect (blueprint.effects[]) ──────────────

  override fireEffect(event: string, x?: number, y?: number): void {
    const px = typeof x === 'number' ? x : this.paddle?.x ?? 0;
    const py = typeof y === 'number' ? y : this.paddle?.y ?? 0;
    for (const e of this.effectBindings ?? []) {
      if (e.on !== event) continue;
      const invoke = resolveEffect(e.play);
      if (invoke) {
        try {
          invoke(this, px, py, e.params);
        } catch {
          /* an effect is cosmetic — never fail the level on it */
        }
      }
    }
  }

  // ── internals (generic instantiation from data) ────────────────────────────

  private constructSystems(): void {
    for (const b of this.levelData.systems ?? []) {
      if (!b?.ref) continue;
      // a $custom: system id resolves against the custom-registry; else the registry.
      if (b.ref.startsWith('$custom:')) {
        const factory = resolveCustomSystem(b.ref.slice('$custom:'.length));
        if (factory) this.systems.push(factory(b.params));
        continue;
      }
      const sys = resolveSystem(b.ref, b.params);
      if (sys) this.systems.push(sys);
    }
  }

  /**
   * Expand the compact BrickGridData into individual BrickData cells, MERGED with any
   * explicit bricks[] (a grid PLUS hand-placed extras) — purely from data, zero per-game
   * code. The merged set is written back onto levelData.bricks so the BrickGrid system
   * (and createBricks) read ONE array.
   */
  private expandBrickGrid(): void {
    const g = this.levelData.brickGrid;
    const explicit = this.levelData.bricks ?? [];
    if (!g) {
      this.levelData.bricks = explicit;
      return;
    }
    const gapX = g.gapX ?? 0;
    const gapY = g.gapY ?? 0;
    const originX = g.originX ?? 0;
    const originY = g.originY ?? 0;
    const out: BrickData[] = [];
    for (let row = 0; row < g.rows; row += 1) {
      const rowHp = g.rowHp?.[row];
      const hp = rowHp !== undefined ? rowHp : g.hp ?? 1;
      if (hp <= 0) continue; // a gap row
      for (let col = 0; col < g.cols; col += 1) {
        const cx = originX + col * (g.brickWidth + gapX) + g.brickWidth / 2;
        const cy = originY + row * (g.brickHeight + gapY) + g.brickHeight / 2;
        out.push({
          id: `brick_${col}_${row}`,
          x: cx,
          y: cy,
          width: g.brickWidth,
          height: g.brickHeight,
          hp,
          points: g.points,
          assetSlot: g.brickSlot,
        });
      }
    }
    this.levelData.bricks = [...out, ...explicit];
  }

  /** Attach extra (non-control) bound behaviors to an owner from data. */
  private attachExtraBehaviors(owner: any, bindings?: BehaviorBinding[]): void {
    if (!bindings || bindings.length === 0) return;
    if (!owner.behaviors) owner.behaviors = new BehaviorManager(owner);
    bindings.forEach((b, i) => {
      const beh = this.instantiateBehavior(b);
      if (beh) owner.behaviors.add(`bound_${i}`, beh);
    });
  }

  private instantiateBehavior(b: BehaviorBinding): IBehavior | null {
    if (typeof b === 'string') {
      if (b.startsWith('$custom:')) {
        const f = resolveCustomBehavior(b.slice('$custom:'.length));
        return f ? f({}) : null;
      }
      const Cls = resolveBehavior(b);
      return Cls ? new Cls({}) : null;
    }
    const ref = b.ref;
    if (ref?.startsWith('$custom:')) {
      const f = resolveCustomBehavior(ref.slice('$custom:'.length));
      return f ? f(b.params) : null;
    }
    const Cls = resolveBehavior(ref);
    return Cls ? new Cls(b.params ?? {}) : null;
  }
}
