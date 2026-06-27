import Phaser from 'phaser';
import { BaseBehavior } from './IBehavior';
import type { ComponentSurface } from '@contract/component-surface';

/**
 * CAPABILITY sidecar (kept consistent with the other behaviors' sidecar shape;
 * mirrors InertialThrustController). The top_down BEHAVIOR registry discovers
 * behaviors via the authored taxonomy in `registry/discover.mjs`, not via this
 * const — so this is inert-but-documenting metadata, never read by the drift
 * gate. The Integrate step adds the real BEHAVIOR_TAXONOMY row + the barrel
 * export (see the report).
 */
export const CAPABILITY = {
  kind: 'behavior',
  id: 'SplitterEnemy',
  intent:
    'Enemy variety as a kill-order decision: on its OWN death the carrier enemy spawns N smaller chaser children at its position (each bound an inherited ChaseAI), so killing the parent ADDS threat unless the player has space/multiplier to clear the brood. The brood raises __GAME__.entities enemy-count by N before falling.',
  roles: ['enemy'],
  params: ['splitCount', 'childScale', 'childSpeed', 'childHealth', 'spreadRadius'],
} as const;

/**
 * SplitterEnemy configuration. Every number is a DECLARED default — none is baked
 * from a specific game; a design node tunes these via the capability params.
 */
export interface SplitterEnemyConfig {
  /** How many children to spawn on death (the split count N). Default 2. */
  splitCount?: number;
  /** Size factor for each child relative to the parent body (0..1). Default 0.6. */
  childScale?: number;
  /** Chase speed for each spawned child in px/s. Default 90. */
  childSpeed?: number;
  /** Max health for each spawned child. Default 10 (children are fragile). */
  childHealth?: number;
  /** Radius (px) the brood is scattered over so children don't perfectly stack. Default 16. */
  spreadRadius?: number;
}

/**
 * SplitterEnemy — the canonical twin-stick VARIETY enemy for the `top_down`
 * arena/shooter genres. It ATTACHES to an enemy and turns that enemy's death into
 * a kill-order DECISION:
 *
 *  - On the carrier's OWN death (the player shoots it to 0 hp), it spawns
 *    `splitCount` SMALLER chaser children at the carrier's position — each one a
 *    bare enemy bound an inherited `ChaseAI` (via the scene's generic
 *    `spawnEnemyAt({ behaviors:[{ ref:'ChaseAI', … }] })` seam, the SAME path
 *    WaveSpawner uses) so the brood immediately chases the player.
 *  - The children join `scene.enemies`, so `__GAME__.entities` enemy-count RISES
 *    by N at the split moment, then falls again as the brood is cleared — the
 *    OBSERVABLE the contract asserts. Killing the parent therefore ADDS threat.
 *
 * THE DEATH SEAM (why this is wired, not polled). The scene only ticks a bound
 * behavior's `update()` while its owner is `active` (DataTopDownScene.update) and
 * BaseEnemy.update early-returns once `isDead` — so by the frame AFTER death this
 * behavior would never run again; a poll-for-death `update()` would MISS the death
 * frame. Instead, on attach this behavior DECORATES the owner's own death method
 * (`kill` for a data-spawned enemy, `die` for a BaseEnemy): when ANY damage path
 * kills the owner, the wrapper fires FIRST — at the true death moment, with the
 * owner's position still valid — runs the split, emits `enemy.split`, then calls
 * through to the original death method. A latch makes the split fire exactly once.
 *
 * DRIVE SEAM (for Integrate/Test). `split()` is a public verb that runs the split
 * directly (spawn N children + emit), so the responsiveness driver / a unit test
 * can fire the moment headless WITHOUT routing a full bullet→collision→kill chain.
 * The driving verb in-game is `shoot` (kill the splitter); `split()` is the same
 * effect, invoked at the seam.
 *
 * GENERIC: no game/theme, no baked coordinate. The split count, child size/speed/
 * health and spread are PARAMS; children inherit a plain ChaseAI pointed at the
 * player by the scene's spawn path. A scene without `spawnEnemyAt`/`eventBus` is a
 * clean no-op (the wrapper still calls the original death so death never breaks).
 *
 * Usage (bound to an enemy from the blueprint):
 *   enemy.behaviors.add('split', new SplitterEnemy({ splitCount: 3, childSpeed: 110 }));
 */
export class SplitterEnemy extends BaseBehavior {
  // Configuration (declared defaults — never a game-specific constant)
  public splitCount: number;
  public childScale: number;
  public childSpeed: number;
  public childHealth: number;
  public spreadRadius: number;

  /** Latches true once the split has run, so it fires exactly once per carrier. */
  private hasSplit = false;

  /** The owner's original death method we wrapped (restored on detach). */
  private originalDeath: ((...args: any[]) => any) | null = null;
  /** The name of the death method we wrapped ('kill' | 'die'), for restore. */
  private deathMethod: 'kill' | 'die' | null = null;

  constructor(config: SplitterEnemyConfig = {}) {
    super();
    this.splitCount = Math.max(1, Math.floor(config.splitCount ?? 2));
    this.childScale = config.childScale ?? 0.6;
    this.childSpeed = config.childSpeed ?? 90;
    this.childHealth = config.childHealth ?? 10;
    this.spreadRadius = config.spreadRadius ?? 16;
  }

  /**
   * Decorate the owner's death method so the split fires at the TRUE death moment.
   * We wrap whichever death seam the owner exposes: `kill` (a data-spawned enemy
   * from spawnEnemyAt) or `die` (a BaseEnemy). The wrapper runs the split BEFORE
   * delegating to the original death (so the owner's position is still valid and
   * the carrier is still in the group when the brood is computed).
   */
  protected onAttach(): void {
    const owner = this.getOwner<any>();
    const method: 'kill' | 'die' | null =
      typeof owner.kill === 'function'
        ? 'kill'
        : typeof owner.die === 'function'
          ? 'die'
          : null;
    if (!method) return; // no death seam to hook — split() can still be driven directly.

    this.deathMethod = method;
    this.originalDeath = owner[method].bind(owner);
    const self = this;
    owner[method] = function wrappedDeath(this: any, ...args: any[]) {
      // Split at the death moment (idempotent via the latch), then die for real.
      self.split();
      return self.originalDeath ? self.originalDeath(...args) : undefined;
    };
  }

  /** Restore the owner's original death method when this behavior is removed. */
  protected onDetach(): void {
    const owner = this.owner as any;
    if (owner && this.deathMethod && this.originalDeath) {
      owner[this.deathMethod] = this.originalDeath;
    }
    this.originalDeath = null;
    this.deathMethod = null;
  }

  /**
   * Per-frame: nothing to do while alive — the split is driven by the death seam
   * (the wrapper installed in onAttach) or by an explicit split() call. Kept as a
   * no-op so the behavior satisfies the IBehavior update() contract.
   */
  update(): void {
    /* split is event-driven (death seam) — no per-frame work while alive */
  }

  /**
   * The split VERB (the drive seam): spawn `splitCount` smaller chaser children at
   * the carrier's position, each bound an inherited ChaseAI, raising the live
   * enemy-count by N — then emit `enemy.split`. Idempotent: a second call after the
   * carrier has already split is a no-op (the latch). Public so Integrate can wire
   * it and the responsiveness driver / a unit test can fire the moment headless.
   */
  split(): void {
    if (this.hasSplit) return;
    this.hasSplit = true;

    const owner = this.getOwner<any>();
    const scene = owner.scene as any;
    if (!scene || typeof scene.spawnEnemyAt !== 'function') return;

    const px = owner.x ?? 0;
    const py = owner.y ?? 0;
    // Carrier footprint → child footprint (childScale of the parent display size,
    // with a sane floor so a child is never zero-sized). Generic, no baked number.
    const baseW = owner.displayWidth ?? owner.width ?? 40;
    const baseH = owner.displayHeight ?? owner.height ?? 40;
    const childW = Math.max(12, Math.round(baseW * this.childScale));
    const childH = Math.max(12, Math.round(baseH * this.childScale));
    const parentId = owner.__id ?? owner.name ?? 'splitter';

    let spawned = 0;
    for (let i = 0; i < this.splitCount; i += 1) {
      // Scatter the brood evenly on a small ring so children don't perfectly stack.
      const a = (i / this.splitCount) * Math.PI * 2;
      const x = px + Math.cos(a) * this.spreadRadius;
      const y = py + Math.sin(a) * this.spreadRadius;
      const child = scene.spawnEnemyAt({
        x,
        y,
        id: `${parentId}_child${i}`,
        behaviors: [{ ref: 'ChaseAI', params: { speed: this.childSpeed } }],
        assetSlot: owner.texture?.key,
        width: childW,
        height: childH,
        damage: owner.damage,
        health: this.childHealth,
      });
      if (child) spawned += 1;
    }

    // enemy.split — fired at the real split moment (the carrier's death seam, after
    // the brood has been added to scene.enemies so __GAME__.entities already shows
    // the +N). Reach the scene's shared bus the way the other components do; a scene
    // without a bus is a clean no-op. Declared in this component's surface().
    this.bus?.emit('enemy.split', {
      parentId,
      childCount: spawned,
    });
  }

  /** Whether this carrier has already split (read seam for diagnostics/tests). */
  hasAlreadySplit(): boolean {
    return this.hasSplit;
  }

  /**
   * The uniform component surface — the PUSH channel this behavior owns. Declares
   * `enemy.split` (emitted from the real death/split seam in split()). The child
   * enemies flow into the existing __GAME__.entities adapter (scene.enemies), so
   * this surface declares only the event + no observables/anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'enemy.split',
          payload: '{parentId,childCount}',
          scope: 'archetype',
          drivenBy: 'shoot — the splitter enemy is killed (its death seam)',
          expect:
            'the splitter leaves __GAME__.entities and N smaller chaser children appear at its position, raising the enemy-count (before it falls as the brood is cleared); enemy.split logged',
        },
      ],
    };
  }
}
