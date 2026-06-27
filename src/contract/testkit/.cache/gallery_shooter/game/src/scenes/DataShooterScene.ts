/**
 * ============================================================================
 * DataShooterScene — the DATA-DRIVEN gallery-shooter level loader (KEEP — engine)
 * ============================================================================
 *
 * Builds an ENTIRE gallery-shooter level from a `ShooterLevelData` object as DATA —
 * the descending FORMATION grid, the axis-constrained player CANNON (from its bound
 * AxisConstrainedMovement {ref,params}), the destructible BUNKERS, the registered
 * systems[] (FormationMarch + ProjectilePool + WaveLoop), and the event->effect
 * bindings — with ZERO per-game placement or behavior-reimplementation code. The
 * blueprint's `layout` + capability BINDINGS become this data (W2 materializes
 * `src/levels/<level>.json` from them); the SDK instantiates it.
 *
 * It is the top_down analogue of DataTopDownScene. It extends BaseGameScene and fills
 * its abstract methods from the level data, then drives the resolved control scheme's
 * MOVE + FIRE intent each frame.
 *
 * The executor (W4) writes ONLY the `custom[]` delta (an ISceneSystem per genuinely-
 * novel entry) and registers it via custom-registry; this loader resolves custom[]
 * systems against that registry.
 *
 * GENERIC: no game/theme is encoded here. It reads ids + DATA; a game's strings live
 * ONLY in the materialized levels/<level>.json.
 *
 * USAGE:
 *   import levelData from '../levels/level1.json';
 *   export class Level1Scene extends DataShooterScene {
 *     constructor() { super('Level1Scene', levelData as ShooterLevelData); }
 *   }
 */
import Phaser from 'phaser';
import { BaseGameScene } from './BaseGameScene';
import { DataShip } from '../characters/DataShip';
import { resolveBehavior, resolveEffect } from '../behaviors/registry';
import { AxisConstrainedMovement } from '../behaviors';
import { resolveSystem } from '../systems/registry';
import { resolveScheme, DEFAULT_SCHEME, type ShooterScheme } from '../controls';
import * as utils from '../utils';
import type {
  ShooterLevelData,
  FormationData,
  BunkerData,
  BehaviorBinding,
  ISceneSystem,
} from './shooter-data';
import { resolveCustomSystem } from './custom-registry';

const numFrom = (v: any, d: number): number => (typeof v === 'number' ? v : d);

export abstract class DataShooterScene extends BaseGameScene {
  protected readonly levelData: ShooterLevelData;

  /** The active scene systems this level (registered systems[] + custom[]). */
  protected systems: ISceneSystem[] = [];

  /** The resolved control scheme (move axis + fire mode). Set in createPlayer. */
  protected scheme: ShooterScheme = DEFAULT_SCHEME;

  /** Bound event->effect bindings (blueprint.effects[]) the loader fires. */
  private effectBindings: ShooterLevelData['effects'] = [];

  /** Last-frame fire-key held state (for the scheme's 'press' edge detection). */
  private _fireWasHeld = false;

  /** The formation's data (kept so a wave respawn re-uses the base shape). */
  private formationData?: FormationData;

  constructor(
    sceneKeyOrConfig: string | Phaser.Types.Scenes.SettingsConfig,
    levelData: ShooterLevelData,
  ) {
    super(sceneKeyOrConfig);
    this.levelData = levelData;
  }

  // ── boot ────────────────────────────────────────────────────────────────────

  preload(): void {
    utils.ensurePlaceholderTexture(this, '__px', 8, 8, 'sprite');
  }

  create(): void {
    this.scheme = resolveScheme(this.levelData.controlScheme) ?? DEFAULT_SCHEME;
    this.constructSystems();
    this.effectBindings = this.levelData.effects ?? [];
    this.createBaseElements();
    this.cameras.main.fadeIn(300);
  }

  update(): void {
    this.baseUpdate();
    // Drive the resolved control scheme's per-frame MOVE + FIRE on the player.
    this.driveControlScheme();
    for (const sys of this.systems) sys.update?.();
  }

  /**
   * Per-frame scheme driving (generic, from the resolved scheme record):
   *   - MOVE: read the scheme's arrow pair → set the axis mover's input (-1|0|+1).
   *     A move source for the OTHER axis is structurally absent (the player can't
   *     leave its track — the constrained-axis invariant).
   *   - FIRE: 'press' fires on the key EDGE; 'held' fires while down. The shot is
   *     launched by the ProjectilePool system (rate-limited by its cooldown).
   */
  private driveControlScheme(): void {
    const player = this.player as any;
    if (!player || !player.active || player.isDead) return;
    const s = this.scheme;

    // MOVE — set the axis mover input from the scheme's arrow pair.
    const mover: AxisConstrainedMovement | undefined = player.movement;
    if (mover) {
      let dir = 0;
      if (s.move === 'lr-arrows') {
        if (this.cursors.left.isDown || this.adKeys.A.isDown) dir -= 1;
        if (this.cursors.right.isDown || this.adKeys.D.isDown) dir += 1;
      } else {
        if (this.cursors.up.isDown || this.wsKeys.W.isDown) dir -= 1;
        if (this.cursors.down.isDown || this.wsKeys.S.isDown) dir += 1;
      }
      mover.setInput(dir);
    }

    // FIRE — route through the ProjectilePool (the muzzle is the player position).
    const pool = (this as any).__projectilePool;
    if (!pool) return;
    const held = this.spaceKey.isDown;
    if (s.fire === 'held') {
      if (held) pool.fire(player.x, player.y);
    } else {
      // press: fire on the down-transition only.
      if (held && !this._fireWasHeld) pool.fire(player.x, player.y);
    }
    this._fireWasHeld = held;
  }

  /**
   * Juice (override): fire the bound 'enemy.died' effect (explosion/shake) at the dead
   * member via resolveEffect — fire the existing ScreenEffectHelper impl, never rebuild
   * it. A level that bound no such effect is a clean no-op.
   */
  protected override onEnemyKilled(enemy: any): void {
    super.onEnemyKilled(enemy);
    this.fireEffect('enemy.died', enemy?.x, enemy?.y);
  }

  // ── the data-driven build (the abstract methods, all from DATA) ──────────────

  setupMapSize(): void {
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
    this.cameras.main.setBackgroundColor(this.levelData.backgroundColor ?? '#0b1026');
  }

  createBunkers(): void {
    for (const b of this.levelData.bunkers ?? []) this.spawnBunker(b);
  }

  createPlayer(): void {
    const spawn = this.levelData.playerSpawn;
    const pdata = this.levelData.player ?? {};
    this.player = new DataShip(this, spawn.x, spawn.y, {
      textureKey: pdata.assetSlot,
      displayWidth: pdata.displayWidth,
      displayHeight: pdata.displayHeight,
    });
    (this.player as any).__type = 'player';
    (this.player as any).__id = pdata.id ?? 'player';
    // Attach the axis-constrained mover from the player's bound behaviors (the
    // {ref:'AxisConstrainedMovement', params} binding). Clamp defaults to the arena.
    this.attachAxisMover(this.player, pdata.behaviors);
  }

  createFormation(): void {
    const f = this.levelData.formation;
    if (!f) return;
    this.formationData = f;
    this.buildFormation(f, { addRows: 0, descendPx: 0 });
  }

  // ── system-facing seam: (re)spawn a formation (WaveLoop calls this) ───────────

  /**
   * Spawn a formation, optionally denser/lower (the WaveLoop ramp). GENERIC — reads
   * the level's base FormationData + the per-wave delta. Called once from
   * createFormation, then by WaveLoop on each cleared wave.
   */
  public spawnFormation(spec?: { addRows?: number; descendPx?: number; stepSpeedup?: number }): void {
    if (!this.formationData) return;
    this.buildFormation(this.formationData, {
      addRows: spec?.addRows ?? 0,
      descendPx: spec?.descendPx ?? 0,
    });
  }

  /** Instantiate every formation member from the grid data into scene.enemies. */
  private buildFormation(f: FormationData, ramp: { addRows: number; descendPx: number }): void {
    const rows = Math.max(1, Math.floor(f.rows)) + Math.max(0, Math.floor(ramp.addRows));
    const cols = Math.max(1, Math.floor(f.cols));
    const mw = f.memberWidth ?? 30;
    const mh = f.memberHeight ?? 22;
    const startX = f.originX;
    const startY = f.originY + ramp.descendPx;
    for (let row = 0; row < rows; row += 1) {
      const tmpl = this.rowTemplate(f, row);
      for (let col = 0; col < cols; col += 1) {
        const cx = startX + col * f.colSpacing;
        const cy = startY + row * f.rowSpacing;
        this.spawnMember(cx, cy, mw, mh, tmpl, row, col);
      }
    }
  }

  private rowTemplate(f: FormationData, row: number) {
    const arr = f.rows_template ?? [];
    if (arr.length === 0) {
      return { assetSlot: f.assetSlot, points: f.points ?? 10, health: 1 };
    }
    const t = arr[Math.min(row, arr.length - 1)];
    return {
      assetSlot: t.assetSlot ?? f.assetSlot,
      points: t.points ?? f.points ?? 10,
      health: t.health ?? 1,
    };
  }

  /** Spawn ONE formation member: a killable arcade sprite tagged .__formation. */
  private spawnMember(
    x: number,
    y: number,
    w: number,
    h: number,
    tmpl: { assetSlot?: string; points: number; health: number },
    row: number,
    col: number,
  ): void {
    const key = tmpl.assetSlot && this.textures.exists(tmpl.assetSlot) ? tmpl.assetSlot : '__px';
    const sprite = this.physics.add.sprite(x, y, key) as any;
    utils.fitDisplayContain(sprite, w, h);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    sprite.__type = 'enemy';
    sprite.__formation = true;
    sprite.__row = row;
    sprite.__col = col;
    sprite.__id = `inv_${row}_${col}_${this._spawnedEnemyCount}`;
    sprite.__points = tmpl.points;
    // The killable seam (generic; data-tunable health). One-shot by default.
    sprite.isDead = false;
    sprite.maxHealth = Math.max(1, tmpl.health);
    sprite.health = sprite.maxHealth;
    sprite.takeDamage = (n: number) => {
      if (sprite.isDead) return;
      sprite.health -= Number.isFinite(n) ? n : 0;
      if (sprite.health <= 0) sprite.kill();
    };
    sprite.kill = () => {
      if (sprite.isDead) return;
      sprite.isDead = true;
      sprite.setActive(false);
      const b = sprite.body as Phaser.Physics.Arcade.Body | undefined;
      if (b) b.enable = false;
      sprite.destroy();
    };
    this.enemies.add(sprite);
    this._spawnedEnemyCount += 1;
  }

  /** Spawn one destructible bunker into scene.obstacles (surfaces in __GAME__.entities). */
  private spawnBunker(b: BunkerData): void {
    const key = b.assetSlot && this.textures.exists(b.assetSlot) ? b.assetSlot : '__px';
    const sprite = this.physics.add.staticSprite(b.x, b.y, key) as any;
    utils.fitDisplayContain(sprite, b.width ?? 64, b.height ?? 36);
    sprite.refreshBody();
    sprite.__type = 'obstacle';
    sprite.__id = b.id;
    sprite.__kind = 'bunker';
    sprite.health = Math.max(1, b.health ?? 8);
    sprite.takeDamage = (n: number) => {
      sprite.health -= Number.isFinite(n) ? n : 1;
      if (sprite.health <= 0) {
        sprite.setActive(false);
        if (sprite.body) sprite.body.enable = false;
        sprite.destroy();
      }
    };
    if (!this.textures.exists(b.assetSlot ?? '')) sprite.setTint(0x3fb27f);
    this.obstacles.add(sprite);
  }

  // ── post-create: wire systems' collisions ─────────────────────────────────

  protected override setupCustomCollisions(): void {
    for (const sys of this.systems) {
      sys.reset?.();
      sys.attach(this);
      sys.setupCollisions?.();
    }
  }

  // ── effects: fire a bound event->effect (blueprint.effects[]) ──────────────

  /** Fire every effect bound to `event` (blueprint.effects[].on === event) at (x,y). */
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
          /* an effect is cosmetic — never fail the level on it */
        }
      }
    }
  }

  // ── internals (generic instantiation from data) ────────────────────────────

  /** Construct this level's scene systems (registered systems[] + custom[]). */
  private constructSystems(): void {
    this.systems = [];
    if (!this.levelData) return;
    for (const b of this.levelData.systems ?? []) {
      if (!b?.ref) continue;
      const sys = resolveSystem(b.ref, b.params);
      if (sys) this.systems.push(sys);
    }
    for (const id of this.customSystemIds()) {
      const factory = resolveCustomSystem(id);
      if (factory) this.systems.push(factory());
    }
  }

  /** Which custom system ids to construct. A subclass MAY override to pin a set. */
  protected customSystemIds(): string[] {
    return this.defaultSystemIds;
  }
  protected defaultSystemIds: string[] = [];

  /**
   * Attach the axis-constrained mover to the player from its bound behaviors. The
   * binding is normally {ref:'AxisConstrainedMovement', params:{moveSpeed,axis,min,max}}.
   * If the params omit min/max, default to the arena edges so the cannon stays on screen.
   */
  private attachAxisMover(player: any, bindings?: BehaviorBinding[]): void {
    const binding = (bindings ?? []).find((b) => {
      const ref = typeof b === 'string' ? b : b?.ref;
      return ref === 'AxisConstrainedMovement';
    });
    let params: Record<string, any> = {};
    if (binding && typeof binding === 'object') params = binding.params ?? {};
    const axis = params.axis === 'y' ? 'y' : 'x';
    const halfW = (player.displayWidth ?? 44) / 2;
    const halfH = (player.displayHeight ?? 28) / 2;
    const resolved = {
      moveSpeed: numFrom(params.moveSpeed, 260),
      axis,
      min: numFrom(params.min, axis === 'x' ? halfW : halfH),
      max: numFrom(
        params.max,
        axis === 'x' ? this.mapWidth - halfW : this.mapHeight - halfH,
      ),
    };
    // Prefer the registered class (so a typo'd ref still falls back cleanly).
    const Cls = resolveBehavior('AxisConstrainedMovement') ?? AxisConstrainedMovement;
    const mover = new (Cls as any)(resolved) as AxisConstrainedMovement;
    player.movement = player.behaviors.add('movement', mover);
  }
}
