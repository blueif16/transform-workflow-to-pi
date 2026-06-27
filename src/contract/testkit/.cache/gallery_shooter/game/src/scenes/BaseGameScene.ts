import Phaser from 'phaser';
import { LevelManager } from '../LevelManager';
import * as utils from '../utils';
import { ScreenEffectHelper } from '../behaviors';
import { EventBus, type ComponentSurface } from '@contract/component-surface';

/**
 * BaseGameScene — Gallery-Shooter Scene Base Class (KEEP — engine)
 *
 * The single foundation for ALL gallery-shooter level scenes (the gallery analogue of
 * top_down's BaseGameScene). Template Method + Hooks. The data-driven DataShooterScene
 * extends this and fills the abstract methods FROM DATA; a custom W4 scene may extend
 * it directly.
 *
 * BOOTS EMPTY: builds a placeholder cannon + a programmatic arena so a level renders &
 * is playable with ZERO generated art. NO global gravity (a fixed-axis shooter: the
 * player slides on its track, bullets/enemies are kinematic).
 *
 * NET-NEW (game-omni): on the first interactive frame it latches the registry `ready`
 * flag and `status` = 'playing' (so window.__GAME__.ready flips true), and sets
 * `status` = 'won'/'lost' at the real win/lose points (template-contract §3.3).
 *
 * PROVIDES (shared engine, no per-game code):
 *   - Group management (enemies = the formation, obstacles = bunkers, playerBullets)
 *   - The shared EventBus (the PUSH channel) + the standardized scene-level events
 *   - Scene-owned input (←/→/A/D + Space)
 *   - Camera + world bounds
 *   - The markReady() / win-lose registry seam (window.__GAME__)
 *
 * ABSTRACT METHODS (subclass MUST implement — DataShooterScene fills from data):
 *   setupMapSize, createBackground, createPlayer, createFormation, createBunkers
 *
 * HOOKS (subclass MAY override): onPreCreate, onPostCreate, onPreUpdate, onPostUpdate,
 *   onPlayerDeath, onLevelComplete, onEnemyKilled, setupCustomCollisions, checkWinCondition
 */
export abstract class BaseGameScene extends Phaser.Scene {
  // ── scene state ───────────────────────────────────────────────────────────
  public gameCompleted = false;
  private _readyLatched = false;

  // ── event protocol (shared bus + log) ──────────────────────────────────────
  /**
   * The shared, engine-agnostic event bus (the PUSH channel). Every standardized
   * gameplay event is emitted here at its real moment; the 2D adapter (core/src/hook.ts)
   * folds the log onto window.__GAME__.events for guidance / verify to poll.
   */
  public readonly eventBus = new EventBus();
  private _lastStatus: string | undefined = undefined;

  // ── map / world dimensions (set by subclass setupMapSize) ─────────────────
  public mapWidth = 0;
  public mapHeight = 0;

  // ── core game objects ─────────────────────────────────────────────────────
  /** Player cannon — set in createPlayer(); read live by __GAME__.player. */
  public player: any;
  /** The descending formation members live here — read by __GAME__.entities. */
  public enemies!: Phaser.GameObjects.Group;
  /** Destructible bunkers (static obstacles) — read by __GAME__.entities. */
  public obstacles!: Phaser.GameObjects.Group;
  /** Pooled player bullets — read by __GAME__.entities (type 'projectile'). */
  public playerBullets!: Phaser.GameObjects.Group;

  /** Count of formation members spawned this level (diagnostics). */
  protected _spawnedEnemyCount = 0;

  /**
   * A system (WaveLoop) sets this true to take ownership of the win, suppressing the
   * default all-formation-cleared check (which would fire between waves). Read by
   * checkWinCondition().
   */
  public suppressDefaultWin = false;

  // ── input (scene-owned; entities consume this state) ──────────────────────
  public cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  public adKeys!: { A: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  public wsKeys!: { W: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key };
  public spaceKey!: Phaser.Input.Keyboard.Key;

  // ── background ────────────────────────────────────────────────────────────
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
    this._spawnedEnemyCount = 0;
    this.suppressDefaultWin = false;
    this.registry.set('status', 'playing');

    this.configurePhysics();
    this.onPreCreate();

    // PHASE 1: environment
    this.setupMapSize();
    this.createBackground();

    // PHASE 2: groups
    this.initializeGroups();

    // PHASE 3: entities
    this.createBunkers();
    this.createPlayer();
    this.createFormation();

    // PHASE 4: systems
    this.setupCamera();
    this.setupWorldBounds();
    this.setupInputs();

    // PHASE 5: collisions
    this.setupCustomCollisions();

    // PHASE 6: HUD
    this.scene.launch('UIScene', { gameSceneKey: this.scene.key });

    this.onPostCreate();
  }

  /** Fixed-axis shooter: NO world gravity (kinematic bullets/enemies + an axis-locked player). */
  protected configurePhysics(): void {
    this.physics.world.gravity.y = 0;
    this.physics.world.gravity.x = 0;
  }

  protected initializeGroups(): void {
    this.enemies = this.add.group();
    this.obstacles = this.add.group();
    this.playerBullets = this.add.group();
  }

  // ── camera / world bounds ──────────────────────────────────────────────────

  protected setupCamera(): void {
    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
    // A fixed-axis shooter is a single-screen arena — the camera does NOT follow.
    this.cameras.main.setScroll(0, 0);
  }

  protected setupWorldBounds(): void {
    this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
    if (this.player?.setCollideWorldBounds) this.player.setCollideWorldBounds(true);
  }

  /**
   * Setup input. Scene-OWNS input; entities read this state, never attach their own
   * listeners. Arrow keys AND A/D both drive the free-axis move; W/S exist for a
   * vertical-axis variant; Space fires.
   */
  setupInputs(): void {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.adKeys = {
      A: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      D: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.wsKeys = {
      W: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      S: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
    };
    this.spaceKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEMPLATE METHOD: UPDATE
  // ══════════════════════════════════════════════════════════════════════════

  baseUpdate(): void {
    this.eventBus.setFrame(this.game.loop.frame);
    this.markReady();
    this.publishStatus();

    this.onPreUpdate();

    if (this.player?.active) {
      try {
        this.player.update?.();
      } catch (error) {
        console.error('Error updating player:', error);
      }
    }

    this.updateEnemies();
    this.checkWinCondition();

    this.onPostUpdate();
  }

  /** Latch the registry `ready` flag once (first interactive frame). */
  protected markReady(): void {
    if (this._readyLatched) return;
    this._readyLatched = true;
    this.registry.set('ready', true);
    const s = this.registry.get('status');
    if (s !== 'won' && s !== 'lost') this.registry.set('status', 'playing');
  }

  private updateEnemies(): void {
    this.enemies.children.iterate((enemy: any) => {
      if (enemy?.active && enemy.update) {
        try {
          enemy.update();
        } catch (error) {
          console.error('Error updating enemy:', error);
        }
      }
      return true;
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WIN / LOSE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Default win condition: all formation members destroyed. Only fires when the level
   * HAD at least one member AND no system owns the win (WaveLoop sets suppressDefaultWin,
   * so the win fires only after the FINAL wave).
   */
  protected checkWinCondition(): void {
    if (this.gameCompleted || this.suppressDefaultWin) return;
    if (this._spawnedEnemyCount === 0) return;
    const alive = this.enemies.children.entries.filter(
      (e: any) => e.active && !e.isDead,
    ).length;
    if (alive === 0) {
      this.gameCompleted = true;
      this.onLevelComplete();
    }
  }

  // ── hooks ───────────────────────────────────────────────────────────────────

  protected onPreCreate(): void {}
  protected onPostCreate(): void {}
  protected onPreUpdate(): void {}
  protected onPostUpdate(): void {}

  /** Called when the player dies. Sets status='lost' then shows game-over. */
  protected onPlayerDeath(): void {
    if (this.registry.get('status') === 'lost') return;
    this.registry.set('status', 'lost');
    // The standardized death + status events at the real death moment.
    this.eventBus.emit('player.died', {
      x: this.player?.x ?? 0,
      y: this.player?.y ?? 0,
    });
    this.publishStatus();
    this.scene.launch('GameOverUIScene', { currentLevelKey: this.scene.key });
  }

  /** Called when the level is completed. Sets status='won' then shows victory. */
  protected onLevelComplete(): void {
    if (this.registry.get('status') === 'won') return;
    this.registry.set('status', 'won');
    this.publishStatus();
    ScreenEffectHelper.shakeMedium(this);
    this.time.delayedCall(500, () => {
      if (LevelManager.isLastLevel(this.scene.key)) {
        this.scene.launch('GameCompleteUIScene', { currentLevelKey: this.scene.key });
      } else {
        this.scene.launch('VictoryUIScene', { currentLevelKey: this.scene.key });
      }
    });
  }

  /** Called when a formation member is killed. Override for scoring / drops. */
  protected onEnemyKilled(enemy: any): void {
    // The standardized enemy-death event at the real kill moment. Score the kill
    // through the shared score seam (utils.addScore → score.changed).
    const points = typeof enemy?.__points === 'number' ? enemy.__points : 0;
    if (points) utils.addScore(this, points);
    this.eventBus.emit('enemy.died', {
      id: enemy?.__id,
      x: enemy?.x ?? 0,
      y: enemy?.y ?? 0,
    });
  }

  /** Override to add system collisions (player/bullets exist). */
  protected setupCustomCollisions(): void {}

  // ── event-protocol publish seam (generic; emit on the shared bus) ───────────

  /**
   * Publish `level.statusChanged` whenever the NORMALIZED registry status moves
   * (booting→playing→won/lost). De-duped against the last published value.
   */
  protected publishStatus(): void {
    const s = this.registry.get('status');
    const status = s === 'won' || s === 'lost' || s === 'playing' ? s : undefined;
    if (status === undefined || status === this._lastStatus) return;
    this._lastStatus = status;
    this.eventBus.emit('level.statusChanged', { status });
  }

  // ── component surface (the declared event set this scene publishes) ─────────

  /**
   * The uniform component surface for the gallery-shooter scene base. Declares the
   * SCENE-OWNED events this engine emits on the shared bus (the CLAIM the catalog/gates
   * read). The PLAYER owns player.damaged (BaseShip.surface); the SYSTEMS own
   * player.shot / formation.* / wave.* (their surfaces). The scene declares the scene-level
   * moments. Each EventDecl is a TRUE statement about a real emit site:
   *   - score.changed       ← utils.addScore (the score seam)            [core]
   *   - player.died          ← onPlayerDeath                              [core]
   *   - level.statusChanged  ← publishStatus (markReady/win/lose)         [core]
   *   - enemy.died           ← onEnemyKilled                              [base:2d]
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'score.changed',
          payload: '{score}',
          scope: 'core',
          drivenBy: 'a formation member killed (points scored)',
          expect: '__GAME__.score changes; score.changed logged',
        },
        {
          name: 'player.died',
          payload: '{x,y}',
          scope: 'core',
          drivenBy: 'the cannon takes a lethal blow',
          expect: "status becomes 'lost'; player.died logged",
        },
        {
          name: 'level.statusChanged',
          payload: "{status:'playing'|'won'|'lost'}",
          scope: 'core',
          drivenBy: 'ready/win/lose',
          expect: '__GAME__.status matches; level.statusChanged logged',
        },
        {
          name: 'enemy.died',
          payload: '{id,x,y}',
          scope: 'base:2d',
          drivenBy: 'a formation member hp reaches 0 (bullet hit)',
          expect: 'the member leaves __GAME__.entities; enemy.died logged',
        },
      ],
    };
  }

  // ── abstract methods (subclass MUST implement) ────────────────────────────

  /** Set this.mapWidth / this.mapHeight. */
  abstract setupMapSize(): void;
  /** Create the background (color and/or a TileSprite floor). */
  abstract createBackground(): void;
  /** Create the player cannon. Must set this.player on its track. */
  abstract createPlayer(): void;
  /** Build the descending enemy formation into this.enemies (tag .__formation). */
  abstract createFormation(): void;
  /** Build the destructible bunkers into this.obstacles. */
  abstract createBunkers(): void;
}
