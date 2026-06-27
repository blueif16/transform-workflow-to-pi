/**
 * SmartBomb — the LIMITED-STOCK SCREEN-CLEARING SMART BOMB system (BUILD —
 * gallery-shooter engine piece, the `point-defense` genre). The classic panic
 * button: the player holds a small STOCK of smart bombs, and detonating one
 * instantly CLEARS every on-screen threat — all alive formation members AND every
 * live enemy bullet — then decrements the stock. When the stock runs out, the bomb
 * is spent and the key does nothing (the scarce, high-value resource that turns a
 * cornered moment around).
 *
 * It is a SELF-CONTAINED kind=system that mirrors the sibling systems' exact shape
 * (PowerUpTier / DestructibleBunker): an ISceneSystem with reset()/attach()/
 * setupCollisions()/update(), reaching the shared bus via this.scene.eventBus. It
 * OWNS no firing and no enemy movement — on a detonation it walks the engine's KNOWN
 * groups and clears them through the SAME kill path the rest of the engine uses:
 *   - every alive scene.enemies member → kill() + route scene.onEnemyKilled(enemy)
 *     (so the kill is SCORED and fires the standard enemy.died, exactly like a bullet
 *     kill) ⇒ the member leaves __GAME__.entities;
 *   - every live scene.enemyBullets sprite (when a shmup layer is bound) → released
 *     ⇒ the active enemy-bullet count returns to 0.
 *
 * THE STOCK (the id source): a limited reserve of bombs. Per the spec's
 * ID-SOURCE convention this is a CONFIG PARAM (`stock`, default 3) — declared in
 * CAPABILITY.params with a sensible default, never fabricated. It is mirrored onto
 * scene.smartBombStock so it is observable from the first frame and decremented on
 * each real detonation; at 0 the bomb refuses to fire.
 *
 * THE TRIGGER (the verb "use a smart bomb"): a DEDICATED key the system binds itself
 * (default 'B', so it does not collide with Space = fire). update() detects the key's
 * DOWN-EDGE and detonates once per press. detonate() is also PUBLIC so the scene or a
 * verify driver can trigger the verb headlessly with no new event path.
 *
 * OBSERVABLE (the contract — what a verify run polls):
 *   - on a detonation the on-screen threats are CLEARED — alive scene.enemies members
 *     leave __GAME__.entities and any live scene.enemyBullets are gone;
 *   - the bomb stock (scene.smartBombStock) DECREMENTS by one (and is floored at 0).
 *
 * GENERIC: no game/theme, no baked coordinate. The starting stock and the trigger key
 * are DATA via params with declared defaults. A level that never detonates is a clean
 * no-op at full stock.
 *
 * EVENT (the PUSH channel): smartbomb.detonated ← detonate (a bomb was used — threats
 * cleared, stock decremented).
 *
 * Params (from blueprint.systems[].params, all OPTIONAL — sensible defaults):
 *   stock        starting smart-bomb reserve (default 3). The id source for the bomb.
 *   triggerKey   keyboard key that detonates a bomb (default 'B'; Space stays = fire).
 *   clearBullets whether a detonation also clears live enemy bullets (default true).
 */
import Phaser from 'phaser';
import type { ISceneSystem } from '../scenes/shooter-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this). */
export const CAPABILITY = {
  kind: 'system',
  id: 'SmartBomb',
  intent:
    "A limited-stock screen-clearing smart bomb: the player holds a small reserve of bombs and detonating one instantly clears every on-screen threat — all alive formation members (scored through the normal kill path) and every live enemy bullet — then decrements the stock; at 0 the bomb is spent. The gallery-shooter panic-button system.",
  attachesTo: 'scene',
  params: ['stock', 'triggerKey', 'clearBullets'],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface SmartBombConfig {
  /** Starting smart-bomb reserve (the id source for the bomb; default 3). */
  stock?: number;
  /** Keyboard key that detonates a bomb (default 'B'). */
  triggerKey?: string;
  /** Whether a detonation also clears live enemy bullets (default true). */
  clearBullets?: boolean;
}

export class SmartBomb implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }
  private readonly startStock: number;
  private readonly triggerKey: string;
  private readonly clearBullets: boolean;

  /** The live remaining bomb stock (mirrored onto scene.smartBombStock). */
  private stock = 0;
  /** The bound trigger key (so update() can detect its down-edge). */
  private key: any;
  /** Monotonic id for each detonation (the payload id source — auto-derived). */
  private _detonationSeq = 0;

  constructor(params: SmartBombConfig = {}) {
    this.startStock = Math.max(0, Math.floor(params.stock ?? 3));
    this.triggerKey = (params.triggerKey ?? 'B').toUpperCase();
    this.clearBullets = params.clearBullets !== false;
  }

  reset(): void {
    this.stock = this.startStock;
    this.key = undefined;
    this._detonationSeq = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    this.stock = this.startStock;
    // Bind a DEDICATED detonate key (default 'B') so it does not collide with Space=fire.
    const kb = scene.input?.keyboard;
    if (kb && typeof kb.addKey === 'function') {
      const code = (Phaser.Input.Keyboard.KeyCodes as Record<string, number>)[this.triggerKey];
      // addKey also accepts the key NAME string directly (Phaser maps 'B' → KeyCodes.B).
      this.key = kb.addKey(code ?? this.triggerKey);
    }
    // Mirror the stock so it is observable from the first frame + expose self for the
    // scene / diagnostics / the verify driver to trigger the verb headlessly.
    scene.smartBombStock = this.stock;
    scene.__smartBomb = this;
  }

  /** No overlaps to wire — the bomb clears threats directly on detonation. */
  setupCollisions(): void {}

  update(): void {
    if (!this.scene || !this.key) return;
    // Detonate once per key DOWN-EDGE (Phaser's JustDown latches a single press).
    if (Phaser.Input.Keyboard.JustDown(this.key)) this.detonate();
  }

  // ── the detonation (the heart) ────────────────────────────────────────────────

  /**
   * DETONATE one smart bomb: if stock remains, clear every on-screen threat and
   * decrement the stock. PUBLIC so the scene / a verify driver can trigger the verb.
   * A detonation at 0 stock is a no-op (the bomb is spent) and emits nothing.
   */
  public detonate(): boolean {
    const scene = this.scene;
    if (!scene || this.stock <= 0) return false;

    const cleared = this.clearThreats();

    // Spend the bomb (floored at 0) and mirror the live stock.
    this.stock = Math.max(0, this.stock - 1);
    scene.smartBombStock = this.stock;

    // The PUSH seam: a bomb was used — threats cleared, stock decremented.
    this.bus?.emit('smartbomb.detonated', {
      id: `bomb_${this._detonationSeq++}`,
      cleared,
      stock: this.stock,
    });
    return true;
  }

  /**
   * Clear every on-screen threat and return how many were cleared:
   *   - alive formation members → kill() through the engine path + scene.onEnemyKilled
   *     (so the kill is SCORED and fires enemy.died, exactly like a bullet kill);
   *   - live enemy bullets (when a shmup layer is bound + clearBullets) → released.
   */
  private clearThreats(): number {
    const scene = this.scene;
    let cleared = 0;

    // 1) Alive formation members (the primary threat).
    const enemies = scene.enemies;
    if (enemies && typeof enemies.getChildren === 'function') {
      for (const e of [...enemies.getChildren()]) {
        if (!e || e.active === false || e.isDead) continue;
        // Drive damage so any multi-hp member dies in one bomb, then route the kill.
        if (typeof e.takeDamage === 'function') e.takeDamage(e.maxHealth ?? e.health ?? 1);
        else if (typeof e.kill === 'function') e.kill();
        if (e.isDead) scene.onEnemyKilled?.(e);
        cleared += 1;
      }
    }

    // 2) Live enemy bullets (only when a shmup layer created the group).
    if (this.clearBullets) {
      const bullets = scene.enemyBullets;
      if (bullets && typeof bullets.getChildren === 'function') {
        for (const b of [...bullets.getChildren()]) {
          if (!b || b.active === false) continue;
          b.setActive?.(false);
          b.setVisible?.(false);
          if (b.body) b.body.enable = false;
          b.destroy?.();
          cleared += 1;
        }
      }
    }

    return cleared;
  }

  // ── diagnostics (EXPOSED for the observable proofs) ─────────────────────────────

  /** The live remaining bomb stock (the smartbomb.detonated observable). */
  public stockRemaining(): number {
    return this.stock;
  }

  /**
   * The PUSH channel this system publishes (the CLAIM the catalog/gates read). One
   * true statement per real emit site:
   *   - smartbomb.detonated ← detonate (a bomb was used: threats cleared + stock −1) [archetype]
   */
  surface(): ComponentSurface {
    return {
      observables: {
        'smartBombStock': () => this.stockRemaining(),
      },
      anchors: [],
      events: [
        {
          name: 'smartbomb.detonated',
          payload: '{id,cleared,stock}',
          scope: 'archetype',
          drivenBy: 'the player uses a smart bomb (presses the detonate key) while stock remains',
          expect:
            "every alive scene.enemies member leaves __GAME__.entities and live scene.enemyBullets are cleared; the bomb stock (scene.smartBombStock) decrements by one; smartbomb.detonated logged",
        },
      ],
    };
  }
}
