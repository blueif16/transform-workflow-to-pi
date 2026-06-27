/**
 * ============================================================================
 * DataTopDownScene — the DATA-DRIVEN top-down level loader (KEEP — engine)
 * ============================================================================
 *
 * Builds an ENTIRE top-down level from a `TopDownLevelData` object as DATA —
 * floor/walls/bounds, player spawn, enemies, rewards/pickups, the goal, each
 * entity's bound behaviors, the registered systems[], and the event->effect
 * bindings — with ZERO per-game placement or behavior-reimplementation code. The
 * blueprint's `layout` + capability BINDINGS become this data (W2 materializes
 * `src/levels/<level>.json` from them); the SDK instantiates it.
 *
 * It is the top_down analogue of platformer's `scenes/DataLevelScene.ts` (and
 * voxel's `VoxelWorldScene.ts`). It extends BaseGameScene and fills its abstract
 * methods from the level data.
 *
 * The executor (W4) writes ONLY the `custom[]` delta (an IBehavior / ISceneSystem
 * per genuinely-novel entry) and registers it via custom-registry; this loader
 * resolves "$custom:<id>" bindings + custom[] systems against that registry.
 *
 * GENERIC: no game/theme is encoded here. It reads ids and DATA; a game's strings
 * live ONLY in the materialized levels/<level>.json.
 *
 * USAGE (the entire W4-side level file for a data-driven level):
 *   import levelData from '../levels/level1.json';
 *   export class Level1Scene extends DataTopDownScene {
 *     constructor() { super('Level1Scene', levelData as TopDownLevelData); }
 *   }
 *   // + W4 registers custom[] factories once (custom-registry) before boot.
 */
import Phaser from 'phaser';
import { BaseGameScene } from './BaseGameScene';
import { DataPlayer } from '../characters/DataPlayer';
import { resolveBehavior, resolveEffect } from '../behaviors/registry';
import { resolveSystem } from '../systems/registry';
import { BehaviorManager, RangedAttack, type IBehavior } from '../behaviors';
import { resolveScheme, DEFAULT_SCHEME, type TopDownScheme } from '../controls';
import gameConfig from '../gameConfig.json';
import * as utils from '../utils';
import type {
  TopDownLevelData,
  BehaviorBinding,
  RewardData,
  ThreatData,
  WallData,
  ISceneSystem,
} from './topdown-data';
import {
  resolveCustomBehavior,
  resolveCustomSystem,
} from './custom-registry';
import { MazeGrid } from './maze-grid';
import { WorldCueDriver, type CueTarget } from '@contract/guidance/WorldCueDriver';
import { makePhaserMarkerFactory } from '../guidance/phaserCueMarker';

/** Default per-wall color (greybox). */
const WALL_COLOR = 0x4b5d78;

/** Read a number with a fallback (config values are {value:X}). */
const numFrom = (v: any, d: number): number => (typeof v === 'number' ? v : d);

export abstract class DataTopDownScene extends BaseGameScene {
  /** The level data this scene instantiates (set by the subclass constructor). */
  protected readonly levelData: TopDownLevelData;

  /** The active scene systems this level (registered systems[] + custom[]). */
  protected systems: ISceneSystem[] = [];

  /**
   * The resolved control scheme for this level (move/aim/fire binding). Set in
   * createPlayer from levelData.controlScheme; drives the player input config + the
   * twin-stick held-fire loop. Defaults to the move-only scheme.
   */
  protected scheme: TopDownScheme = DEFAULT_SCHEME;

  /**
   * A WaveSpawner (or any system) may set this true to take ownership of the win,
   * suppressing BaseGameScene's default all-enemies-dead check (which would fire mid
   * wave-escalation). Read by checkWinCondition() below.
   */
  public suppressDefaultWin = false;

  /** Bound event->effect bindings (blueprint.effects[]) the loader fires. */
  private effectBindings: TopDownLevelData['effects'] = [];

  /**
   * The built MazeGrid geometry for a maze-chase level (KEEP — engine seam, M5).
   * Built once in create() from levelData.maze, published on the scene as
   * scene.__maze so the maze ghosts (GhostTarget) read the SAME geometry. Absent
   * (undefined) for non-maze levels — the maze path is a clean no-op.
   */
  public __maze?: MazeGrid;
  /** The shared ghost mode (set by GhostModeController; read by GhostTarget). */
  public __ghostMode?: string;
  /** The reverse epoch (bumped by GhostModeController on each transition). */
  public __ghostReverseEpoch?: number;
  /** The blinky ghost owner (slot 0) — inky's reference tile. Set in createEnemies. */
  public __blinky?: any;
  /** Frighten hook (installed by GhostModeController.attach). */
  public frighten?: () => void;

  /**
   * Maze-derived placements (M5). When levelData.maze is present, expandMaze()
   * fills these from the grid (walls/dots/pellets/player-spawn/ghost-threats) and
   * the build methods read these MERGED with the explicit arrays — so a maze is
   * built purely from the ASCII grid with zero per-game placement code.
   */
  private mazeWalls: WallData[] = [];
  private mazeRewards: RewardData[] = [];
  private mazeThreats: ThreatData[] = [];
  private mazePlayerSpawn: { x: number; y: number } | null = null;

  /** Per-reward sprite map, by id (for systems + diagnostics). */
  protected rewardsById: Record<string, Phaser.GameObjects.Sprite> = {};
  /** The goal/exit sprite (if any). */
  public goalSprite?: Phaser.GameObjects.Sprite & {
    __id?: string;
    __type?: string;
    locked?: boolean;
  };

  /**
   * Owners carrying bound behaviors the scene must tick every frame (a bare reward
   * sprite is not on any update list). Collected at build time, driven from THIS
   * scene's update() loop — NOT via per-owner events.on(UPDATE) listeners, which
   * leak across a scene RESTART. Reset per create().
   */
  private boundBehaviorOwners: any[] = [];

  /**
   * The diegetic WORLD-CUE driver (gameConfig.guidance.worldCues[] → in-world
   * markers pinned to a target entity). Renderer-agnostic; the Phaser chevron
   * marker is injected via makePhaserMarkerFactory. Inert when no worldCues[] are
   * declared (the additive guarantee). Constructed in create() after the world is
   * built, baselined once `ready` latches, polled each frame from update().
   */
  private worldCues?: WorldCueDriver;
  /** One-shot guard: baseline the worldCue triggers on the first ready frame. */
  private _worldCueStarted = false;

  constructor(
    sceneKeyOrConfig: string | Phaser.Types.Scenes.SettingsConfig,
    levelData: TopDownLevelData,
  ) {
    super(sceneKeyOrConfig);
    this.levelData = levelData;
  }

  // ── boot ────────────────────────────────────────────────────────────────────

  preload(): void {
    utils.ensurePlaceholderTexture(this, '__px', 8, 8, 'sprite');
    utils.createBulletTextures(this);
  }

  create(): void {
    // Fresh-level state (restart safety): a scene RESTART re-runs create(), so
    // clear the per-build collections so nothing leaks from the prior generation.
    this.boundBehaviorOwners = [];
    this._worldCueStarted = false;
    this.suppressDefaultWin = false;
    this.__blinky = undefined;
    this.__ghostMode = undefined;
    this.__ghostReverseEpoch = undefined;
    // Expand a tile-maze (if present) into walls/dots/spawns BEFORE anything reads
    // them; publishes scene.__maze for the maze ghosts. A non-maze level no-ops.
    this.expandMaze();
    // Resolve the level's control scheme (move/aim/fire binding). A system may
    // later set suppressDefaultWin; the scheme is set in createPlayer.
    this.scheme = resolveScheme(this.levelData.controlScheme) ?? DEFAULT_SCHEME;
    // Resolve & construct the systems BEFORE building, so they can wire collisions
    // in setupCustomCollisions (player exists by then).
    this.constructSystems();
    this.effectBindings = this.levelData.effects ?? [];
    this.createBaseElements();
    // Diegetic world cues: build AFTER the world (player/goal/rewards exist so the
    // entity resolver can find them). Inert when no worldCues[] are declared.
    this.worldCues = new WorldCueDriver(
      (id) => this.findEntityById(id),
      makePhaserMarkerFactory(this),
    );
    this.worldCues.mount(gameConfig as Record<string, unknown>);
    this.cameras.main.fadeIn(300);
  }

  update(): void {
    this.baseUpdate();
    // Tick every bound entity behavior from the ONE scene update loop (no leaked
    // per-owner listeners).
    for (const owner of this.boundBehaviorOwners) {
      if (owner && owner.active !== false && owner.behaviors) owner.behaviors.update();
    }
    // Drive the scheme's per-frame aim/fire on the player (twin-stick auto-fire +
    // 8-way movement-follow aim). Generic — reads the scheme + the live pointer/keys.
    this.driveControlScheme();
    for (const sys of this.systems) sys.update?.();
    // Drive the diegetic world cues: baseline once `ready` latches, then poll +
    // re-pin each live marker to its entity every frame. Inert with no worldCues[].
    const hook = (window as any).__GAME__;
    if (this.worldCues && hook) {
      if (!this._worldCueStarted && hook.ready) {
        this._worldCueStarted = true;
        this.worldCues.start(hook);
      }
      if (this._worldCueStarted) this.worldCues.update(hook);
    }
  }

  /**
   * Per-frame scheme driving (generic, from the resolved scheme record):
   *   - aim 'movement': FaceTarget follows the live MOVE input (8-way facing). Move
   *     and aim coincide here BY DESIGN (move-only scheme).
   *   - fire 'held': while the bound pointer button is down, fire along the AIM angle
   *     (twin-stick auto-fire). RangedAttack's own cooldown rate-limits it.
   *   - fire 'press': fire on the button EDGE.
   * The decoupled-aim invariant: a held-fire shot launches along faceTarget.aimAngle
   * (the POINTER for twin-stick), never along the move vector.
   */
  private driveControlScheme(): void {
    const player = this.player;
    if (!player || !player.active || player.isDead) return;
    const s = this.scheme;

    // 8-way: aim follows the move direction (facing == last move dir).
    if (s.aim === 'movement' && player.faceTarget && player.movement) {
      const ix = player.movement.getInput?.().x ?? 0;
      const iy = player.movement.getInput?.().y ?? 0;
      if (ix !== 0 || iy !== 0) {
        player.faceTarget.aimAngle = Math.atan2(iy, ix);
      }
    }

    if (s.fire === 'none' || !player.ranged) return;
    const pointer = this.input.activePointer;
    const btn = s.fireButton ?? 0;
    const held = btn === 2 ? pointer.rightButtonDown() : pointer.leftButtonDown();
    if (s.fire === 'held') {
      // Fire along the AIM angle (decoupled from move) while held. Cooldown limits.
      if (held) player.ranged.shootAtAngle(player.faceTarget.aimAngle, 'playerBullets');
    } else if (s.fire === 'press') {
      // Edge: fire only on the down-transition (compare to last frame's held state).
      if (held && !this._fireWasHeld) {
        player.ranged.shootAtAngle(player.faceTarget.aimAngle, 'playerBullets');
      }
    }
    this._fireWasHeld = held;
  }

  /** Last-frame fire-button held state (for the scheme's 'press' edge detection). */
  private _fireWasHeld = false;

  /**
   * Juice (override): fire the bound 'enemy.killed' effect (shake/hitStop/damage
   * number) at the dead enemy via resolveEffect — fire the existing ScreenEffectHelper
   * impl, never rebuild it. A level that bound no such effect is a clean no-op. The
   * effect is cosmetic; it never reads/writes an observed field (anti-reward-hack).
   */
  protected override onEnemyKilled(enemy: any): void {
    // Publish the standardized enemy.died event (the base seam) BEFORE the
    // cosmetic effect, so the event protocol fires at the real kill moment.
    super.onEnemyKilled(enemy);
    this.fireEffect('enemy.killed', enemy?.x, enemy?.y);
  }

  /**
   * WIN gate (override): when a system owns the win (suppressDefaultWin, e.g. a
   * WaveSpawner+KillAllGoal arena), DO NOT run the engine's default all-enemies-dead
   * check — the system fires the win at the right moment (after the final wave). With
   * no such system, defer to the engine default (kill every placed enemy).
   */
  protected override checkWinCondition(): void {
    if (this.suppressDefaultWin) return;
    super.checkWinCondition();
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
    this.cameras.main.setBackgroundColor(this.levelData.backgroundColor ?? '#1a1a2e');
  }

  createWalls(): void {
    // Build EVERY wall from the maze grid (if any) + layout.walls[] (geometry as
    // DATA). The blueprint wall x/y is the TOP-LEFT corner; createWall centers the
    // sprite, so convert here.
    this.groundLayer = this.physics.add.staticGroup();
    const walls = [...this.mazeWalls, ...(this.levelData.walls ?? [])];
    const wallTile = this.levelData.wallSlot;
    for (const w of walls) {
      const cx = w.x + w.width / 2;
      const cy = w.y + w.height / 2;
      this.createWall(cx, cy, w.width, w.height, WALL_COLOR, w.assetSlot ?? wallTile);
    }
  }

  createDecorations(): void {
    // Spawn every reward at its coordinate, tagged for __GAME__.entities + bound
    // behaviors instantiated from data (incl. "$custom:<id>"). NOTE: the player does
    // NOT exist yet — only placement here; overlap wiring is a system's job.
    const rewards = [...this.mazeRewards, ...(this.levelData.rewards ?? [])];
    for (const r of rewards) this.spawnReward(r);
    // The goal/exit (layout.goal). Spawned inert; a kind=system / custom[] system
    // owns its lock/unlock + the win overlap (it reads scene.goalSprite).
    this.spawnGoal();
  }

  createPlayer(): void {
    // A maze grid's 'P' cell overrides the explicit playerSpawn (the maze is the
    // source of truth for the corridor the avatar starts in).
    const spawn = this.mazePlayerSpawn ?? this.levelData.playerSpawn;
    const pdata = this.levelData.player ?? {};
    const movement = this.extractMovementParams(pdata.behaviors);
    this.player = new DataPlayer(this, spawn.x, spawn.y, {
      textureKey: pdata.assetSlot,
      displayHeight: pdata.displayHeight,
      displayWidth: pdata.displayWidth,
      movement,
      animKeys: pdata.anim as any,
    });
    (this.player as any).__type = 'player';
    (this.player as any).__id = pdata.id ?? 'player';
    this._spawnPoint = { x: spawn.x, y: spawn.y };
    this.applyControlScheme(this.player);
    // Attach any NON-movement bound behaviors declared on the player (e.g. a
    // "$custom:<id>" attachedTo:player scorer/cleanup) to the player's OWN manager.
    // The movement binding is already consumed by the DataPlayer constructor above
    // (extractMovementParams) — exclude it to avoid a double-instantiation. tick:false
    // because the player self-ticks its behaviors (no scene re-registration).
    this.attachBehaviors(
      this.player,
      this.nonMovementBindings(pdata.behaviors, 'EightWayMovement'),
      { tick: false },
    );
  }

  /**
   * Apply the resolved control scheme to the player (generic — from data). The
   * scheme DECLARES the input binding; this wires the already-composed behaviors to
   * match. No per-game code:
   *   - aim 'pointer'  → FaceTarget tracks the mouse (decoupled from move). The move
   *                      vector comes from WASD/arrows via the FSM; the aim vector
   *                      from the pointer — independent (the twin-stick invariant).
   *   - aim 'movement' → FaceTarget follows the move direction (8-way facing).
   *   - fire !== 'none'→ ensure the player has a RangedAttack so it CAN shoot; the
   *                      per-frame fire (press/held) is driven in update().
   */
  private applyControlScheme(player: any): void {
    if (!player) return;
    const s = this.scheme;
    // Aim source: pointer = decoupled twin-stick aim; movement = facing == move dir.
    if (player.faceTarget) {
      player.faceTarget.useMouseAim = s.aim === 'pointer';
    }
    // Fire: ensure a RangedAttack exists when the scheme grants ranged fire. The
    // projectile is launched along the AIM angle (player.shoot uses faceTarget.aimAngle),
    // so a shot fired while moving points where you AIM, not where you move.
    if (s.fire !== 'none' && !player.ranged && player.behaviors) {
      const pc = (gameConfig as any).playerConfig ?? {};
      player.ranged = player.behaviors.add(
        'ranged',
        new RangedAttack({
          damage: numFrom(pc.attackDamage?.value, 20),
          projectileKey: 'player_bullet',
          projectileSpeed: 600,
          cooldown: 220,
        }),
      );
    }
  }

  createEnemies(): void {
    // Each threat is a MOVING enemy: a plain arcade sprite in scene.enemies with
    // its bound behaviors[] (ChaseAI/PatrolAI/EightWayMovement/GhostTarget…), so
    // the wall collider applies. A ChaseAI is pointed at the player. Placement/
    // tuning stays DATA — this invents no coordinate. Maze ghost threats merge in.
    const threats = [...this.mazeThreats, ...(this.levelData.threats ?? [])];
    for (const t of threats) {
      const sprite = this.spawnMovingEnemy(t);
      // The blinky ghost (slot 0 / a GhostTarget selector 'blinky') is inky's
      // reference; publish it so inky's behavior can read its tile. Generic —
      // detected from the bound GhostTarget params, no game/theme.
      if (!this.__blinky && this.isBlinky(t)) this.__blinky = sprite;
    }
  }

  /** True iff a threat binds a GhostTarget with selector 'blinky' (inky's ref). */
  private isBlinky(t: ThreatData): boolean {
    for (const b of t.behaviors ?? []) {
      if (typeof b === 'object' && b.ref === 'GhostTarget' && b.params?.selector === 'blinky') {
        return true;
      }
    }
    return false;
  }

  // ── post-create: wire systems' collisions ─────────────────────────────────

  protected override setupCustomCollisions(): void {
    for (const sys of this.systems) {
      // reset() runs FIRST (before attach) so a restarted level clears every run
      // latch the system held; the level stays genuinely replayable.
      sys.reset?.();
      sys.attach(this);
      sys.setupCollisions?.();
    }
  }

  /**
   * Resolve a surface entity id to its live {x,y} (the WorldCueDriver's entity
   * resolver). GENERIC — searches the standing entities: the player, the goal, a
   * reward by id, then any enemy by its __id. Returns undefined when no entity
   * matches (the cue marker hides until/unless it resolves). No game/theme.
   */
  private findEntityById(id: string): CueTarget | undefined {
    const p = this.player as any;
    if (p && (p.__id === id || id === 'player')) {
      return { x: p.x, y: p.y, active: p.active !== false };
    }
    const g = this.goalSprite as any;
    if (g && (g.__id === id || id === 'goal')) {
      return { x: g.x, y: g.y, active: g.active !== false };
    }
    const reward = this.rewardsById[id] as any;
    if (reward) return { x: reward.x, y: reward.y, active: reward.active !== false };
    let found: CueTarget | undefined;
    this.enemies?.children?.iterate((e: any) => {
      if (e && e.__id === id) {
        found = { x: e.x, y: e.y, active: e.active !== false };
        return false; // stop iterating
      }
      return true;
    });
    return found;
  }

  /**
   * Mark a reward CONSUMED (generic collection seam for ANY system / behavior).
   * Disables its overlap body, removes it from the interactable set, and destroys
   * the sprite. Idempotent. No game/theme is encoded — the caller decides WHICH
   * reward is consumed and WHEN.
   */
  public consumeReward(sprite: any): void {
    if (!sprite || sprite.__consumed) return;
    sprite.__consumed = true;
    const id = sprite.__id as string | undefined;
    // reward.collected — the standardized event at the real collect moment (every
    // collectathon funnels through this seam). Emitted BEFORE destroy so the
    // payload carries the reward's live id/position.
    this.eventBus.emit('reward.collected', {
      id,
      x: sprite.x ?? 0,
      y: sprite.y ?? 0,
    });
    if (id && this.rewardsById[id]) delete this.rewardsById[id];
    const body = sprite.body as Phaser.Physics.Arcade.Body | undefined;
    if (body) body.enable = false;
    this.boundBehaviorOwners = this.boundBehaviorOwners.filter((o) => o !== sprite);
    if (this.decorations) this.decorations.remove(sprite, false, false);
    sprite.destroy();
  }

  // ── effects: fire a bound event->effect (blueprint.effects[]) ──────────────

  /**
   * Fire every effect bound to `event` (blueprint.effects[].on === event) at (x,y).
   * Cosmetic only — the loader never lets an effect read/write an observed field. A
   * system / behavior calls this on its real game event, so the juice stays bound
   * to the design, not hard-wired.
   */
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

  /**
   * Construct this level's scene systems (KEEP — engine seam). TWO sources, the
   * SAME ISceneSystem lifecycle (reset -> attach -> setupCollisions -> update):
   *   1. REGISTERED systems — levelData.systems[] = {ref,params}, resolved by id
   *      against systems/registry.ts (EMPTY in M1; the genre systems land M2/M5).
   *   2. CUSTOM systems — the genuinely-novel delta W4 authored + registered under
   *      an id (custom-registry).
   * GENERIC: the loader names no game — it resolves ids + DATA.
   */
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

  /**
   * Which custom system ids to construct. A subclass MAY override to pin a fixed
   * set; by default it constructs every custom system the level declared.
   */
  protected customSystemIds(): string[] {
    return (this.levelData.player as any)?.__systems ?? this.defaultSystemIds;
  }
  /** Set by the subclass: the custom[] system ids for this level. */
  protected defaultSystemIds: string[] = [];

  /**
   * Expand a tile-maze (levelData.maze) into walls/dots/pellets + the player +
   * ghost spawns, and publish scene.__maze for the maze ghosts (KEEP — engine
   * seam, M5). PURELY from data: the ASCII grid + the legend (topdown-data.ts
   * MazeGridData). A non-maze level leaves the derived arrays empty (no-op).
   *
   * Ghost slot digits 0..3 (blinky/pinky/inky/clyde) become threats[] entries
   * binding GhostTarget with the matching selector + the slot's scatter corner —
   * SO a maze authored as ASCII needs NO hand-placed ghost behaviors. A maze that
   * ALSO carries explicit threats[] (e.g. a $custom ghost) keeps them (merged).
   */
  private expandMaze(): void {
    this.mazeWalls = [];
    this.mazeRewards = [];
    this.mazeThreats = [];
    this.mazePlayerSpawn = null;
    this.__maze = undefined;

    const m = this.levelData.maze;
    if (!m || !Array.isArray(m.grid) || m.grid.length === 0) return;

    const grid = new MazeGrid(m);
    this.__maze = grid;
    const ts = grid.tileSize;
    const dotSize = m.dotSize ?? ts * 0.25;
    const pelletSize = m.pelletSize ?? ts * 0.5;
    const selectors = ['blinky', 'pinky', 'inky', 'clyde'] as const;
    const corners = m.scatterCorners; // optional per-slot scatter corner cells

    for (let row = 0; row < grid.rows; row += 1) {
      const line = grid.raw[row];
      for (let col = 0; col < grid.cols; col += 1) {
        const ch = line[col];
        const c = grid.cellCenter(col, row);
        if (ch === '#') {
          // One static wall sprite per wall cell (TOP-LEFT corner convention).
          this.mazeWalls.push({
            id: `mw_${col}_${row}`,
            x: grid.originX + col * ts,
            y: grid.originY + row * ts,
            width: ts,
            height: ts,
          });
        } else if (ch === '.') {
          this.mazeRewards.push({
            id: `dot_${col}_${row}`,
            x: c.x,
            y: c.y,
            kind: 'collectible',
            entityKind: 'dot',
            width: dotSize,
            height: dotSize,
            assetSlot: m.dotSlot,
          });
        } else if (ch === 'o') {
          this.mazeRewards.push({
            id: `pellet_${col}_${row}`,
            x: c.x,
            y: c.y,
            kind: 'collectible',
            entityKind: 'power_pellet',
            width: pelletSize,
            height: pelletSize,
            assetSlot: m.dotSlot,
          });
        } else if (ch === 'P') {
          this.mazePlayerSpawn = { x: c.x, y: c.y };
        } else if (ch >= '0' && ch <= '3') {
          const slot = Number(ch);
          const selector = selectors[slot];
          const scatterCorner = corners?.[slot];
          this.mazeThreats.push({
            id: `ghost_${selector}`,
            x: c.x,
            y: c.y,
            kind: 'chaser',
            width: ts * 0.7,
            height: ts * 0.7,
            behaviors: [
              {
                ref: 'GhostTarget',
                params: {
                  selector,
                  ...(scatterCorner ? { scatterCorner } : {}),
                },
              },
            ],
          });
        }
      }
    }
  }

  /** Spawn one reward sprite + attach its bound behaviors. */
  private spawnReward(r: RewardData): void {
    const key = r.assetSlot && this.textures.exists(r.assetSlot) ? r.assetSlot : '__px';
    const sprite = this.physics.add.sprite(r.x, r.y, key) as Phaser.Physics.Arcade.Sprite & {
      __type?: string;
      __id?: string;
      __kind?: string;
      behaviors?: BehaviorManager;
    };
    utils.fitDisplayContain(sprite, r.width ?? 32, r.height ?? 32);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    // Forgiving pickup radius (generic game-feel for ALL collectibles).
    const PICKUP_BODY = 110;
    const bw = Math.max(r.width ?? 32, PICKUP_BODY) / sprite.scaleX;
    const bh = Math.max(r.height ?? 32, PICKUP_BODY) / sprite.scaleY;
    body.setSize(bw, bh, true);
    sprite.__type = r.kind ?? r.role ?? 'collectible';
    sprite.__id = r.id;
    if (r.entityKind) sprite.__kind = r.entityKind;
    this.decorations.add(sprite);
    this.rewardsById[r.id] = sprite;
    this.attachBehaviors(sprite, r.behaviors);
  }

  /** Spawn the goal/exit sprite from layout.goal, tagged for __GAME__.entities. */
  private spawnGoal(): void {
    const g = this.levelData.goal;
    if (!g) return;
    const key = g.assetSlot && this.textures.exists(g.assetSlot) ? g.assetSlot : '__px';
    const sprite = this.physics.add.sprite(g.x, g.y, key) as Phaser.Physics.Arcade.Sprite & {
      __type?: string;
      __id?: string;
      locked?: boolean;
    };
    utils.fitDisplayContain(sprite, g.width ?? 48, g.height ?? 48);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    sprite.__type = 'goal';
    sprite.__id = g.id;
    sprite.locked = true;
    this.decorations.add(sprite);
    this.goalSprite = sprite;
    // Attach the goal's bound behaviors (incl. a "$custom:<id>" attachedTo:<goal>
    // binding — e.g. a power-up / win-gate). The goal is a BARE sprite (no update
    // path), so it IS scene-ticked (default tick:true).
    this.attachBehaviors(sprite, g.behaviors);
  }

  /** Spawn one MOVING enemy from a layout threat (delegates to spawnEnemyAt). */
  private spawnMovingEnemy(t: ThreatData): any {
    return this.spawnEnemyAt({
      x: t.x,
      y: t.y,
      id: t.id,
      kind: t.kind,
      behaviors: t.behaviors,
      assetSlot: t.assetSlot,
      width: t.width,
      height: t.height,
      damage: t.damage,
    });
  }

  /**
   * Spawn ONE moving enemy at (x,y) from a generic spec (KEEP — engine seam). The
   * SINGLE enemy-spawn path: the data threats[] path AND a WaveSpawner system both
   * call it, so every top-down enemy is built identically. GENERIC: no game/theme,
   * no baked coordinate — placement and tuning come from the spec.
   *
   * KILLABLE SEAM (M2): a plain arcade enemy sprite gets a minimal health/takeDamage/
   * isDead/kill so the engine's existing bullet+melee collision path (which calls
   * `enemy.takeDamage?.()` then reads `enemy.isDead` → onEnemyKilled) actually kills
   * it — the prerequisite for the kill-all win. Health is data-tunable (spec.health
   * or enemyConfig.maxHealth). This is the ONE generic enhancement M2 adds to the M1
   * spawn (additive; a threat with no combat against it just never takes damage).
   */
  public spawnEnemyAt(spec: {
    x: number;
    y: number;
    id?: string;
    kind?: string;
    behaviors?: BehaviorBinding[];
    assetSlot?: string;
    width?: number;
    height?: number;
    damage?: number;
    health?: number;
  }): any {
    const key =
      spec.assetSlot && this.textures.exists(spec.assetSlot) ? spec.assetSlot : '__px';
    const sprite = this.physics.add.sprite(spec.x, spec.y, key) as Phaser.Physics.Arcade.Sprite & {
      __type?: string;
      __id?: string;
      __kind?: string;
      damage?: number;
      health?: number;
      maxHealth?: number;
      isDead?: boolean;
      isHurting?: boolean;
      takeDamage?: (n: number) => void;
      kill?: () => void;
      behaviors?: BehaviorManager;
    };
    utils.fitDisplayContain(sprite, spec.width ?? 40, spec.height ?? 40);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    sprite.setCollideWorldBounds(true);
    sprite.__type = 'enemy';
    sprite.__id = spec.id ?? `enemy_${this._spawnedEnemyCount}`;
    if (spec.kind) sprite.__kind = spec.kind;
    const enemyCfg = (gameConfig as any)?.enemyConfig ?? {};
    sprite.damage =
      typeof spec.damage === 'number' ? spec.damage : (enemyCfg.damage?.value ?? 10);

    // --- minimal killable seam (generic; data-tunable health) ---
    sprite.isDead = false;
    sprite.maxHealth =
      typeof spec.health === 'number' ? spec.health : (enemyCfg.maxHealth?.value ?? 30);
    sprite.health = sprite.maxHealth;
    sprite.takeDamage = (n: number) => {
      if (sprite.isDead) return;
      sprite.health = (sprite.health ?? 0) - (Number.isFinite(n) ? n : 0);
      if ((sprite.health ?? 0) <= 0) sprite.kill?.();
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

    // Attach the bound behaviors (ChaseAI/PatrolAI/EightWayMovement/Separation…) +
    // tick via the single scene update() loop.
    this.attachBehaviors(sprite, spec.behaviors);
    // Point every target-taking bound behavior (ChaseAI) at the player.
    if (sprite.behaviors && this.player) {
      for (const b of sprite.behaviors.getAll() as any[]) {
        if (b && typeof b.setTarget === 'function') b.setTarget(this.player);
      }
    }
    return sprite;
  }

  /**
   * Attach a list of behavior bindings to an owner via a fresh BehaviorManager.
   * `opts.tick` (default true) registers the owner in boundBehaviorOwners so THIS
   * scene's update() loop ticks it — correct for a BARE sprite (reward/enemy/goal)
   * with no update path. Pass `tick:false` for an owner that SELF-ticks its
   * behaviors (the player: BasePlayer.update → this.behaviors.update), to avoid a
   * double tick.
   */
  private attachBehaviors(
    owner: any,
    bindings?: BehaviorBinding[],
    opts?: { tick?: boolean },
  ): void {
    if (!bindings || bindings.length === 0) return;
    if (!owner.behaviors) owner.behaviors = new BehaviorManager(owner);
    bindings.forEach((b, i) => {
      const beh = this.instantiateBehavior(b);
      if (beh) owner.behaviors.add(`bound_${i}`, beh);
    });
    if (opts?.tick !== false) this.boundBehaviorOwners.push(owner);
  }

  /** Instantiate one behavior binding: registry {ref,params} or "$custom:<id>". */
  private instantiateBehavior(b: BehaviorBinding): IBehavior | null {
    if (typeof b === 'string') {
      if (b.startsWith('$custom:')) {
        const id = b.slice('$custom:'.length);
        const f = resolveCustomBehavior(id);
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

  /** Extract the EightWayMovement {params} from a behavior-binding list. */
  private extractMovementParams(bindings?: BehaviorBinding[]): any {
    const p = this.firstBoundParams(bindings, 'EightWayMovement');
    return p ?? {};
  }

  /**
   * The behavior bindings MINUS the movement ref. The player's movement is consumed
   * by the DataPlayer constructor (extractMovementParams), so re-attaching it would
   * double-instantiate it. Generic — keys off the ref, no game noun.
   */
  private nonMovementBindings(
    bindings: BehaviorBinding[] | undefined,
    movementRef: string,
  ): BehaviorBinding[] {
    return (bindings ?? []).filter((b) => {
      const ref = typeof b === 'string' ? b : b?.ref;
      return ref !== movementRef;
    });
  }

  /** Find the first binding for `ref` and return its params (or undefined). */
  private firstBoundParams(
    bindings: BehaviorBinding[] | undefined,
    ref: string,
  ): Record<string, any> | undefined {
    for (const b of bindings ?? []) {
      if (typeof b === 'object' && b.ref === ref) return b.params ?? {};
    }
    return undefined;
  }
}
