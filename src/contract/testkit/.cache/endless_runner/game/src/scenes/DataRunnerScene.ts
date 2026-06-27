/**
 * ============================================================================
 * DataRunnerScene — the DATA-DRIVEN endless-runner level loader (KEEP — engine)
 * ============================================================================
 *
 * Builds an ENTIRE endless-runner level from a `RunnerLevelData` object as DATA — the
 * background, the avatar + its bound movement behavior, the procedural-obstacle stream
 * (cadence/gap/speed/seed), the score-on-pass logic, and the control scheme — with ZERO
 * per-game placement or behavior-reimplementation code. The blueprint's `layout` +
 * capability BINDINGS become this data (W2 materializes `src/levels/<level>.json` from
 * them); the SDK instantiates it.
 *
 * It is the endless_runner analogue of platformer's DataLevelScene / top_down's
 * DataTopDownScene. It extends BaseRunnerScene and fills its abstract create hooks from
 * the level data.
 *
 * The executor (W4) writes ONLY the `custom[]` delta (an IBehavior / ISceneSystem per
 * genuinely-novel entry) and registers it; this loader resolves "$custom:<id>" bindings
 * + custom[] systems against that registry. (A custom-registry seam mirrors the other
 * modules; for the base genre the two engine systems are registered ids.)
 *
 * GENERIC: no game/theme is encoded here. It reads ids + DATA; a game's strings live
 * ONLY in the materialized levels/<level>.json.
 *
 * USAGE (the W4-side level file for a data-driven level):
 *   import levelData from '../levels/level1.json';
 *   export class Level1Scene extends DataRunnerScene {
 *     constructor() { super('Level1Scene', levelData as RunnerLevelData); }
 *   }
 */
import Phaser from 'phaser';
import { BaseRunnerScene } from './BaseRunnerScene';
import { BehaviorManager, GravityFlapMovement, type IBehavior } from '../behaviors';
import { resolveBehavior, resolveEffect } from '../behaviors/registry';
import { resolveSystem } from '../systems/registry';
import { makeScheme, GravityFlapScheme } from '../controls';
import * as utils from '../utils';
import type {
  RunnerLevelData,
  BehaviorBinding,
  ISceneSystem,
} from './runner-data';

const numFrom = (v: any, d: number): number => (typeof v === 'number' ? v : d);

export abstract class DataRunnerScene extends BaseRunnerScene {
  /** The level data this scene instantiates (set by the subclass constructor). */
  protected readonly levelData: RunnerLevelData;

  /** The active scene systems (the scroller + the scorer; + any custom[]). */
  protected systems: ISceneSystem[] = [];

  /** The resolved one-button input scheme (DOM-sensing; headless-driveable). */
  protected scheme!: GravityFlapScheme;

  /** Bound event→effect bindings (blueprint.effects[]) the loader fires (cosmetic). */
  private effectBindings: RunnerLevelData['effects'] = [];

  constructor(
    sceneKeyOrConfig: string | Phaser.Types.Scenes.SettingsConfig,
    levelData: RunnerLevelData,
  ) {
    super(typeof sceneKeyOrConfig === 'string' ? { key: sceneKeyOrConfig } : sceneKeyOrConfig);
    this.levelData = levelData;
  }

  // ── the data-driven build (the abstract hooks, all from DATA) ────────────────

  protected setupMapSize(): void {
    const b = this.levelData.bounds;
    this.mapWidth = b?.width ?? this.scale.width;
    this.mapHeight = b?.height ?? this.scale.height;
  }

  protected createBackground(): void {
    const slot = this.levelData.backgroundSlot;
    if (slot && this.textures.exists(slot)) {
      this.add
        .tileSprite(0, 0, this.mapWidth, this.mapHeight, slot)
        .setOrigin(0)
        .setScrollFactor(0)
        .setDepth(-100);
    }
    this.cameras.main.setBackgroundColor(this.levelData.backgroundColor ?? '#5ec0e8');
  }

  protected createAvatar(): void {
    const a = this.levelData.avatar;
    const key = a.assetSlot && this.textures.exists(a.assetSlot) ? a.assetSlot : '__px';
    const sprite = this.physics.add.sprite(a.x, a.y, key) as BaseRunnerScene['player'];
    const w = a.width ?? 34;
    const h = a.height ?? 34;
    if (typeof sprite.setDisplaySize === 'function') sprite.setDisplaySize(w, h);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    // The behavior OWNS gravity integration (one source of truth for the feel), so the
    // body's own gravity is off; the upright AABB is the display box (INV-COLLISION).
    body.setAllowGravity(false);
    body.setSize(w / (sprite.scaleX || 1), h / (sprite.scaleY || 1), true);
    sprite.__type = 'player' as any;
    sprite.__id = a.id ?? 'avatar';
    sprite.health = 1;
    sprite.maxHealth = 1;
    sprite.isDead = false;
    sprite.vx = 0;
    sprite.vy = 0;
    // The lose seam (the scroller drains health to fire it → onPlayerDeath).
    sprite.takeDamage = (n: number) => {
      if (sprite.isDead) return;
      sprite.health = (sprite.health ?? 0) - (Number.isFinite(n) ? n : 0);
      if ((sprite.health ?? 0) <= 0) this.onPlayerDeath();
    };

    // Compose the bound movement behavior(s) from data (the {ref,params} / $custom).
    sprite.behaviors = new BehaviorManager(sprite);
    const movement = this.attachBehaviors(sprite, a.behaviors);
    // Expose the movement seam the control scheme drives (flap).
    sprite.movement = movement as any;
    this.player = sprite;

    // Resolve + attach the one-button scheme (headless-driveable via real keydown).
    const canvas = this.game.canvas as HTMLCanvasElement | undefined;
    this.scheme = makeScheme(this.levelData.controlScheme, canvas);
    this.scheme.attach();
  }

  protected setupSystems(): void {
    this.systems = [];
    this.effectBindings = this.levelData.effects ?? [];
    for (const b of this.levelData.systems ?? []) {
      if (!b?.ref) continue;
      const sys = resolveSystem(b.ref, b.params);
      if (sys) this.systems.push(sys);
    }
    // Lifecycle: reset (clear run state — INV-RESET) → attach → setupCollisions.
    for (const sys of this.systems) {
      sys.reset?.();
      sys.attach(this);
      sys.setupCollisions?.();
    }
  }

  protected onUpdate(): void {
    // Drain the one-button input and apply the flap (the controllable seam). A real
    // keydown the harness fires → the scheme queues a flap → the avatar's movement
    // sets vy negative (the controllable proof). Suppressed once dead.
    const p = this.player as any;
    if (this.scheme && p && !p.isDead) {
      const input = this.scheme.sample();
      if (input.flap && p.movement?.flap) p.movement.flap();
    }
    // Tick the systems (the scroller advances/spawns/culls; the scorer scores).
    for (const sys of this.systems) sys.update?.();
  }

  // ── internals (generic instantiation from data) ──────────────────────────────

  /**
   * Attach a list of behavior bindings to the avatar; returns the FIRST movement
   * behavior (the flap seam the scheme drives). Resolves registry {ref,params} +
   * "$custom:<id>". A binding that resolves to GravityFlapMovement (or any behavior
   * exposing flap()) is returned as the movement; absent → a default GravityFlapMovement.
   */
  private attachBehaviors(owner: any, bindings?: BehaviorBinding[]): IBehavior {
    let movement: IBehavior | undefined;
    (bindings ?? []).forEach((b, i) => {
      const beh = this.instantiateBehavior(b);
      if (!beh) return;
      owner.behaviors.add(`bound_${i}`, beh);
      if (!movement && typeof (beh as any).flap === 'function') movement = beh;
    });
    if (!movement) {
      // The safe floor: a default flap movement so the avatar is never frozen.
      movement = owner.behaviors.add('movement', new GravityFlapMovement(this.defaultMovementParams()));
    }
    return movement;
  }

  /** Default movement params from gameConfig.runnerConfig (the committed tuning). */
  private defaultMovementParams(): Record<string, number> {
    const rc = ((this.game.registry.get('__config') as any) ?? {}).runnerConfig ?? {};
    return {
      gravity: numFrom(rc.gravity?.value, 1400),
      flapImpulse: numFrom(rc.flapImpulse?.value, 420),
      maxFallSpeed: numFrom(rc.maxFallSpeed?.value, 520),
    };
  }

  /** Instantiate one behavior binding: registry {ref,params} or "$custom:<id>". */
  private instantiateBehavior(b: BehaviorBinding): IBehavior | null {
    const ref = typeof b === 'string' ? b : b.ref;
    const params = typeof b === 'string' ? {} : b.params ?? {};
    if (ref?.startsWith('$custom:')) {
      // The W4 custom-behavior seam (resolved against the custom registry once it
      // exists). For the base genre no custom[] is bound; returns null cleanly.
      return null;
    }
    const Cls = resolveBehavior(ref);
    return Cls ? new Cls(params) : null;
  }

  /** Fire every effect bound to `event` (cosmetic; never reads/writes an observed field). */
  public fireEffect(event: string, x?: number, y?: number): void {
    const px = typeof x === 'number' ? x : this.player?.x ?? 0;
    const py = typeof y === 'number' ? y : this.player?.y ?? 0;
    for (const e of this.effectBindings ?? []) {
      if (e.on !== event) continue;
      const invoke = resolveEffect(e.play);
      if (invoke) {
        try {
          invoke(this, px, py, e.params);
        } catch {
          /* an effect is cosmetic — never fail the run on it */
        }
      }
    }
  }
}
