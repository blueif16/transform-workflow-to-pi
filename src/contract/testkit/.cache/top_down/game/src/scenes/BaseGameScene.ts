import Phaser from 'phaser';
import { LevelManager } from '../LevelManager';
import * as utils from '../utils';
import { ScreenEffectHelper } from '../behaviors';
import { EventBus, type ComponentSurface } from '@contract/component-surface';

/**
 * Player class registry for dynamic player creation (character select).
 */
export type PlayerClassMap = Record<
  string,
  new (scene: Phaser.Scene, x: number, y: number) => any
>;

/**
 * BaseGameScene — Top-Down Game Scene Base Class  (KEEP — engine)
 *
 * The single foundation for ALL top-down level scenes (the top-down analogue of
 * platformer's BaseLevelScene). Template Method + Hooks. The data-driven
 * DataTopDownScene extends this and fills the abstract methods FROM DATA; a custom
 * W4 scene may extend it directly.
 *
 * BOOTS EMPTY: builds PROGRAMMATIC walls (a static physics group) so a level
 * renders & is playable with ZERO generated art (placeholder textures from the
 * Preloader). NO global gravity (free 8-way space).
 *
 * NET-NEW (game-omni): on the first interactive frame it latches the registry
 * `ready` flag and `status` = 'playing' (so window.__GAME__.ready flips true), and
 * sets `status` = 'won'/'lost' at the real win/lose points (template-contract §3.3).
 *
 * PROVIDES (shared engine, no per-game code):
 *   - Group management (enemies, decorations, obstacles, bullets, ySortGroup)
 *   - Programmatic WALL collision (no-clip + wall-slide via arcade collide)
 *   - Entity-vs-entity collisions (contact damage, melee, bullets)
 *   - Y-Sort depth rendering (feet-position sort)
 *   - Scene-owned input (WASD + arrows, Space, Shift, E, Q, mouse)
 *   - Camera follow + world bounds
 *   - The markReady() / win-lose registry seam (window.__GAME__)
 *
 * ABSTRACT METHODS (subclass MUST implement — DataTopDownScene fills from data):
 *   setupMapSize, createBackground, createWalls, createDecorations,
 *   createPlayer, createEnemies
 *
 * HOOKS (subclass MAY override): onPreCreate, onPostCreate, onPreUpdate,
 *   onPostUpdate, onPlayerDeath, onLevelComplete, onEnemyKilled,
 *   setupCustomCollisions, checkWinCondition
 *
 * ARCHITECTURE NOTE (M1 modernization): the dead class-inheritance level path
 * (BaseLevelScene/BaseArenaScene/Level1Scene + the _Template* stubs) was retired;
 * the still-valid mechanisms (Y-sort, collision wiring, markReady, the win/lose
 * seam) were HARVESTED into this single base. The wave-spawner / kill-all logics
 * the old BaseArenaScene/BaseLevelScene baked in become composable kind=system
 * bindings (systems/registry — M2), NOT base classes.
 */
export abstract class BaseGameScene extends Phaser.Scene {
  // ── scene state ───────────────────────────────────────────────────────────
  /** Flag to prevent multiple completion triggers. */
  public gameCompleted = false;
  /** Latched true after the first interactive frame (drives __GAME__.ready). */
  private _readyLatched = false;

  // ── event protocol (shared bus + log) ──────────────────────────────────────
  /**
   * The shared, engine-agnostic event bus (the PUSH channel). Every standardized
   * gameplay event is emitted here at its real moment; the bus mirrors each emit
   * into a bounded, frame-tagged log that the 2D adapter (core/src/hook.ts) folds
   * onto window.__GAME__.events for guidance / verify to poll. Public so the score
   * seam (utils.setScore), the reward-collect seam, and the dash seam reach it.
   */
  public readonly eventBus = new EventBus();
  /** Cache of `status` last published as level.statusChanged (de-dupes per-frame). */
  private _lastStatus: string | undefined = undefined;

  // ── map / world dimensions (set by subclass setupMapSize) ─────────────────
  /** World width in pixels (>= viewport; camera follows the player). */
  public mapWidth = 0;
  /** World height in pixels. */
  public mapHeight = 0;

  // ── core game objects ─────────────────────────────────────────────────────
  /** Player — set in createPlayer(); read live by __GAME__.player. */
  public player: any;
  /** Enemies group — read by __GAME__.entities. */
  public enemies!: Phaser.GameObjects.Group;
  /** Enemy melee triggers group (for boss attacks). */
  public enemyMeleeTriggers!: Phaser.GameObjects.Group;
  /** Decorations / collectibles — read by __GAME__.entities. */
  public decorations!: Phaser.GameObjects.Group;
  /** Physics obstacles (auto Y-sorted props like crates). */
  public obstacles!: Phaser.GameObjects.Group;
  public playerBullets!: Phaser.GameObjects.Group;
  public enemyBullets!: Phaser.GameObjects.Group;
  /** Container for Y-sorted entities (sorted by foot position each frame). */
  public ySortGroup!: Phaser.GameObjects.Group;

  /**
   * Wall collision target: a static physics group of programmatic wall sprites.
   * The player + enemies COLLIDE with it (arcade collide → no-clip + wall-slide).
   */
  public groundLayer!: Phaser.Physics.Arcade.StaticGroup;

  /** Count of enemies spawned this level (gates the kill-all win condition). */
  protected _spawnedEnemyCount = 0;

  /** The respawn point (defaults to the player's create-time position). */
  protected _spawnPoint: { x: number; y: number } | null = null;

  // ── input (scene-owned; entities consume this state) ──────────────────────
  public wasdKeys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  public cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  public spaceKey!: Phaser.Input.Keyboard.Key;
  public shiftKey!: Phaser.Input.Keyboard.Key;
  public eKey!: Phaser.Input.Keyboard.Key;
  public qKey!: Phaser.Input.Keyboard.Key;

  // ── background ────────────────────────────────────────────────────────────
  public background?: Phaser.GameObjects.TileSprite;

  // ── audio ─────────────────────────────────────────────────────────────────
  public backgroundMusic?: Phaser.Sound.BaseSound;

  constructor(config: string | Phaser.Types.Scenes.SettingsConfig) {
    super(config);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEMPLATE METHOD: CREATE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Build all level elements (call from your create()).
   */
  createBaseElements(): void {
    this.gameCompleted = false;
    this._readyLatched = false;
    this._spawnedEnemyCount = 0;
    this._spawnPoint = null;
    this.registry.set('status', 'playing');

    this.configurePhysics();
    this.onPreCreate();

    // PHASE 1: environment
    this.setupMapSize();
    this.createBackground();
    this.createWalls();

    // PHASE 2: groups
    this.initializeGroups();

    // PHASE 3: entities
    this.createDecorations();
    this.createPlayer();
    if (this.player && this._spawnPoint === null) {
      this._spawnPoint = { x: this.player.x, y: this.player.y };
    }
    this.createEnemies();

    // PHASE 4: systems
    this.setupCamera();
    this.setupWorldBounds();
    this.setupInputs();

    // PHASE 5: collisions
    this.setupBaseCollisions();
    this.setupCustomCollisions();

    // PHASE 6: HUD
    this.scene.launch('UIScene', { gameSceneKey: this.scene.key });

    this.onPostCreate();
  }

  /** Top-down: NO world gravity (entities also setAllowGravity(false)). */
  protected configurePhysics(): void {
    this.physics.world.gravity.y = 0;
    this.physics.world.gravity.x = 0;
  }

  protected initializeGroups(): void {
    this.decorations = this.add.group();
    this.obstacles = this.add.group();
    this.enemies = this.add.group();
    this.enemyMeleeTriggers = this.add.group();
    this.playerBullets = this.add.group();
    this.enemyBullets = this.add.group();
    this.ySortGroup = this.add.group();
  }

  /**
   * Build a static WALL and add it to groundLayer. Returns the wall sprite.
   *
   * VISUAL: when `textureKey` resolves to a real loaded texture, the wall surface
   * is a SEAMLESS tileSprite of that texture; otherwise it falls back to the
   * '__px' placeholder stretched + tinted. PHYSICS BODY IS UNCHANGED by the visual
   * path: the static collision body is always a staticSprite at (x,y) sized
   * width×height. GENERIC: a texture KEY, no theme.
   */
  createWall(
    x: number,
    y: number,
    width: number,
    height = 32,
    color = 0x4b5d78,
    textureKey?: string,
  ): Phaser.Physics.Arcade.Sprite | null {
    if (!(this.groundLayer instanceof Phaser.Physics.Arcade.StaticGroup)) {
      return null;
    }
    utils.ensurePlaceholderTexture(this, '__px', 8, 8, 'sprite');
    const wall = this.physics.add.staticSprite(x, y, '__px');
    wall.setDisplaySize(width, height);
    wall.refreshBody();
    this.groundLayer.add(wall);

    if (textureKey && this.textures.exists(textureKey)) {
      wall.setVisible(false);
      const tiled = this.add
        .tileSprite(x, y, width, height, textureKey)
        .setOrigin(0.5, 0.5)
        .setDepth(-1);
      (wall as any).__tileVisual = tiled;
    } else {
      wall.setTint(color);
    }
    return wall;
  }

  // ── camera / world bounds ──────────────────────────────────────────────────

  protected setupCamera(): void {
    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
    if (this.player) {
      const cfg = this.getCameraConfig();
      this.cameras.main.startFollow(this.player);
      this.cameras.main.setLerp(cfg.lerpX, cfg.lerpY);
      this.cameras.main.setZoom(cfg.zoom);
    }
  }

  protected setupWorldBounds(): void {
    // All four bounds solid (top-down: no fall-off-the-bottom death).
    this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
    if (this.player?.setCollideWorldBounds) {
      this.player.setCollideWorldBounds(true);
    }
    this.enemies.children.iterate((enemy: any) => {
      enemy?.setCollideWorldBounds?.(true);
      return true;
    });
  }

  /**
   * Setup input. Scene-OWNS input; entities read this state, never attach their own
   * listeners. Arrow keys AND WASD both drive movement so W5's arrow inputs and a
   * player's WASD both work.
   */
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
    this.spaceKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.shiftKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.eKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.qKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COLLISIONS
  // ══════════════════════════════════════════════════════════════════════════

  setupBaseCollisions(): void {
    this.setupWallCollisions();
    this.setupContactDamage();
    this.setupMeleeCollisions();
    this.setupBulletCollisions();
  }

  /**
   * Wall collisions: player + enemies vs the static wall group. Arcade `collide`
   * resolves per-axis so a diagonal move into a wall STOPS the blocked axis and
   * SLIDES along the free one (the §2.2 no-clip + wall-slide invariant), and the
   * player never enters a wall's AABB. Bullets are destroyed on a wall hit.
   */
  private setupWallCollisions(): void {
    if (!this.groundLayer) return;
    if (this.player) utils.addCollider(this, this.player, this.groundLayer);
    utils.addCollider(this, this.enemies, this.groundLayer);
    utils.addCollider(this, this.player, this.obstacles);
    utils.addCollider(this, this.enemies, this.obstacles);
    utils.addCollider(this, this.playerBullets, this.groundLayer, (bullet: any) =>
      this.destroyBullet(bullet),
    );
    utils.addCollider(this, this.enemyBullets, this.groundLayer, (bullet: any) =>
      this.destroyBullet(bullet),
    );
  }

  /** Contact damage: player touching enemy → 2D knockback + damage. */
  private setupContactDamage(): void {
    if (!this.player) return;
    utils.addOverlap(this, this.player, this.enemies, (player: any, enemy: any) => {
      if (player.isInvulnerable || player.isHurting || player.isDead) return;
      if (enemy.isDead) return;
      const knockback = 200;
      const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
      player.setVelocity?.(Math.cos(angle) * knockback, Math.sin(angle) * knockback);
      player.takeDamage?.(enemy.damage);
    });
  }

  /** Melee collisions: player melee ↔ enemies, enemy melee ↔ player. */
  private setupMeleeCollisions(): void {
    if (!this.player) return;
    const playerMeleeTrigger =
      this.player.meleeTrigger || this.player.melee?.meleeTrigger;
    if (playerMeleeTrigger) {
      utils.addOverlap(this, playerMeleeTrigger, this.enemies, (_t: any, enemy: any) => {
        if (!this.player.isAttacking) return;
        const targets =
          this.player.currentMeleeTargets || this.player.melee?.currentTargets;
        if (targets?.has(enemy)) return;
        if (enemy.isHurting || enemy.isDead) return;
        targets?.add(enemy);
        const knockback = 150;
        const angle = Phaser.Math.Angle.Between(
          this.player.x,
          this.player.y,
          enemy.x,
          enemy.y,
        );
        enemy.setVelocity?.(Math.cos(angle) * knockback, Math.sin(angle) * knockback);
        const damage = this.player.attackDamage || this.player.melee?.damage;
        enemy.takeDamage?.(damage);
        if (enemy.isDead) this.onEnemyKilled(enemy);
      });
    }

    utils.addOverlap(this, this.enemyMeleeTriggers, this.player, (trigger: any, player: any) => {
      const enemy = trigger.owner;
      if (!enemy?.isAttacking) return;
      const targets = enemy.currentMeleeTargets || enemy.melee?.currentTargets;
      if (targets?.has(player)) return;
      if (player.isInvulnerable || player.isHurting || player.isDead) return;
      targets?.add(player);
      const knockback = 300;
      const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, player.x, player.y);
      player.setVelocity?.(Math.cos(angle) * knockback, Math.sin(angle) * knockback);
      player.takeDamage?.(enemy.damage);
    });
  }

  /** Bullet-vs-entity collisions (bullet-vs-wall handled in setupWallCollisions). */
  private setupBulletCollisions(): void {
    utils.addOverlap(this, this.playerBullets, this.enemies, (bullet: any, enemy: any) => {
      if (enemy.isDead || enemy.isHurting) return;
      if (bullet.body?.velocity) {
        const knockback = 100;
        const angle = Math.atan2(bullet.body.velocity.y, bullet.body.velocity.x);
        enemy.setVelocity?.(Math.cos(angle) * knockback, Math.sin(angle) * knockback);
      }
      const damage = bullet.damage ?? this.player?.attackDamage ?? 10;
      enemy.takeDamage?.(damage);
      this.destroyBullet(bullet);
      if (enemy.isDead) this.onEnemyKilled(enemy);
    });

    if (this.player) {
      utils.addOverlap(this, this.player, this.enemyBullets, (player: any, bullet: any) => {
        if (player.isInvulnerable || player.isHurting || player.isDead) return;
        if (bullet.body?.velocity) {
          const knockback = 100;
          const angle = Math.atan2(bullet.body.velocity.y, bullet.body.velocity.x);
          player.setVelocity?.(Math.cos(angle) * knockback, Math.sin(angle) * knockback);
        }
        player.takeDamage?.(bullet.damage ?? 15);
        this.destroyBullet(bullet);
      });
    }
  }

  protected destroyBullet(bullet: any): void {
    if (typeof bullet.hit === 'function') bullet.hit();
    else bullet.destroy();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEMPLATE METHOD: UPDATE
  // ══════════════════════════════════════════════════════════════════════════

  baseUpdate(): void {
    // Stamp the current frame on the bus so every event logged this tick carries
    // a real frame number (the log's external consumers read it for ordering).
    this.eventBus.setFrame(this.game.loop.frame);

    // Latch ready on the first interactive frame (drives __GAME__.ready) BEFORE
    // the player-active guard, so ready flips true even on the frame the player
    // is being (re)created.
    this.markReady();
    // Publish a level.statusChanged if the normalized status moved (won/lost/
    // playing) outside the per-handler seams (e.g. a system flipping the win).
    this.publishStatus();

    if (!this.player?.active) {
      this.onPreUpdate();
      this.onPostUpdate();
      return;
    }

    this.onPreUpdate();

    try {
      this.player.update?.(
        this.wasdKeys,
        this.spaceKey,
        this.shiftKey,
        this.eKey,
        this.qKey,
        this.cursors,
      );
    } catch (error) {
      console.error('Error updating player:', error);
    }

    this.updateEnemies();
    this.updateBullets();
    this.updateYSort();
    this.checkWinCondition();

    this.onPostUpdate();
  }

  /**
   * Latch the registry `ready` flag once (first interactive frame).
   * window.__GAME__.ready reads registry.get('ready').
   */
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

  private updateBullets(): void {
    const destroyOffWorld = (bullet: any) => {
      if (!bullet?.active) return;
      if (bullet.update) bullet.update();
      if (
        bullet.x < -100 ||
        bullet.x > this.mapWidth + 100 ||
        bullet.y < -100 ||
        bullet.y > this.mapHeight + 100
      ) {
        this.destroyBullet(bullet);
      }
    };
    this.playerBullets.children.iterate((bullet: any) => {
      destroyOffWorld(bullet);
      return true;
    });
    this.enemyBullets.children.iterate((bullet: any) => {
      destroyOffWorld(bullet);
      return true;
    });
  }

  /**
   * Y-Sort: sort entities by foot position so lower-on-screen draws in front.
   * Auto-includes player, enemies, obstacles, ySortGroup. Excludes decorations
   * (ground-level props). Uses body.bottom (feet) if available, else sprite.y.
   */
  private updateYSort(): void {
    const sortables: any[] = [];
    if (this.player?.active) sortables.push(this.player);
    this.enemies.children.iterate((e: any) => {
      if (e?.active) sortables.push(e);
      return true;
    });
    this.obstacles.children.iterate((o: any) => {
      if (o?.active) sortables.push(o);
      return true;
    });
    this.ySortGroup.children.iterate((entity: any) => {
      if (entity?.active) sortables.push(entity);
      return true;
    });
    sortables.sort((a, b) => (a.body?.bottom ?? a.y) - (b.body?.bottom ?? b.y));
    for (let i = 0; i < sortables.length; i++) {
      sortables[i].setDepth(i + 1);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WIN / LOSE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Default win condition: all enemies defeated. Only fires when the level HAD at
   * least one enemy (a level with zero enemies relies on a kind=system goal — M2 —
   * or a custom[] gate). A subclass / system that owns the win calls
   * onLevelComplete() directly instead.
   */
  protected checkWinCondition(): void {
    if (this.gameCompleted) return;
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
    this.registry.set('status', 'won');
    // The standardized win-status event at the real completion moment.
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

  /** Called when an enemy is killed. Override for scoring / drops. */
  protected onEnemyKilled(enemy: any): void {
    // The standardized enemy-death event at the real kill moment. Emitted from the
    // base seam (the SDK calls onEnemyKilled at the point an enemy dies); a subclass
    // override fires it by calling super.onEnemyKilled(enemy).
    this.eventBus.emit('enemy.died', {
      id: enemy?.__id,
      x: enemy?.x ?? 0,
      y: enemy?.y ?? 0,
    });
  }

  /** Override to add player-decoration / system collisions (player exists). */
  protected setupCustomCollisions(): void {}

  // ── event-protocol publish seam (generic; emit on the shared bus) ───────────

  /**
   * Publish `level.statusChanged` whenever the NORMALIZED registry status moves
   * (booting→playing→won/lost). De-duped against the last published value so it
   * fires exactly once per real transition (called from markReady, the win/lose
   * hooks, and once per tick to catch any status set elsewhere — e.g. a system
   * flipping 'won' directly).
   */
  protected publishStatus(): void {
    const s = this.registry.get('status');
    const status = s === 'won' || s === 'lost' || s === 'playing' ? s : undefined;
    if (status === undefined || status === this._lastStatus) return;
    this._lastStatus = status;
    this.eventBus.emit('level.statusChanged', { status });
  }

  /** Override to customize camera follow. */
  protected getCameraConfig(): { lerpX: number; lerpY: number; zoom: number } {
    return { lerpX: 0.1, lerpY: 0.1, zoom: 1 };
  }

  // ── bullet creation hooks ────────────────────────────────────────────────

  protected createPlayerBullet(
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    textureKey: string = 'player_bullet',
  ): Phaser.Physics.Arcade.Sprite {
    const bullet = utils.createProjectileAtAngle(
      this,
      x,
      y,
      textureKey,
      angle,
      speed,
      undefined,
      damage,
    );
    this.playerBullets.add(bullet);
    return bullet;
  }

  protected createEnemyBullet(
    x: number,
    y: number,
    angle: number,
    speed: number,
    damage: number,
    textureKey: string = 'enemy_bullet',
  ): Phaser.Physics.Arcade.Sprite {
    const bullet = utils.createProjectileAtAngle(
      this,
      x,
      y,
      textureKey,
      angle,
      speed,
      undefined,
      damage,
    );
    this.enemyBullets.add(bullet);
    return bullet;
  }

  // ── dynamic player creation (character select integration) ────────────────

  protected getPlayerClasses(): PlayerClassMap {
    return {};
  }

  protected createPlayerByType(
    x: number,
    y: number,
    defaultClass: new (scene: Phaser.Scene, x: number, y: number) => any,
  ): any {
    const selected = this.registry.get('selectedCharacter') as string | undefined;
    const classes = this.getPlayerClasses();
    const PlayerClass =
      selected && classes[selected] ? classes[selected] : defaultClass;
    return new PlayerClass(this, x, y);
  }

  // ── component surface (the declared event set this scene publishes) ─────────

  /**
   * The uniform component surface for the top-down scene base. Declares the
   * SCENE-OWNED events this engine emits on the shared bus (the CLAIM the catalog/
   * gates read). The PLAYER owns its own moments (player.shot/damaged/dashed —
   * declared on BasePlayer.surface()); the scene declares the SCENE-LEVEL moments.
   * Observables stay on the existing __GAME__ adapter (core/src/hook.ts), so this
   * surface declares only the PUSH channel + no anchors. Each EventDecl is a TRUE
   * statement about a real emit site:
   *   - score.changed       ← utils.setScore (the score seam)            [core]
   *   - player.died          ← onPlayerDeath                              [core]
   *   - level.statusChanged  ← publishStatus (markReady/win/lose)         [core]
   *   - enemy.died           ← onEnemyKilled                              [base:2d]
   *   - reward.collected     ← DataTopDownScene.consumeReward (collect)   [base:2d]
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
          drivenBy: 'collect/score',
          expect: '__GAME__.score changes; score.changed logged',
        },
        {
          name: 'player.died',
          payload: '{x,y}',
          scope: 'core',
          drivenBy: 'death (health depleted)',
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
          drivenBy: 'enemy hp reaches 0 (melee/bullet)',
          expect: 'enemy leaves __GAME__.entities; enemy.died logged',
        },
        {
          name: 'reward.collected',
          payload: '{id,x,y}',
          scope: 'base:2d',
          drivenBy: 'player↔reward overlap (consumeReward)',
          expect: 'reward leaves __GAME__.entities; reward.collected logged',
        },
      ],
    };
  }

  // ── abstract methods (subclass MUST implement) ────────────────────────────

  /** Set this.mapWidth / this.mapHeight. */
  abstract setupMapSize(): void;
  /** Create the background (color and/or a TileSprite floor). */
  abstract createBackground(): void;
  /** Build wall collision. Default: programmatic walls in a StaticGroup. */
  abstract createWalls(): void;
  /** Create decorations / collectibles. WARNING: player does not exist yet. */
  abstract createDecorations(): void;
  /** Create the player. Must set this.player. */
  abstract createPlayer(): void;
  /** Create enemies. Add them to this.enemies; bump _spawnedEnemyCount. */
  abstract createEnemies(): void;
}
