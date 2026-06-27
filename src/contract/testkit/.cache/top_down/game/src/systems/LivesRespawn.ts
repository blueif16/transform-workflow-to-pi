/**
 * LivesRespawn — the arcade attrition loop: intercept the player-death seam so a
 * lethal hit RESPAWNS the player (at its spawn point, lives−1) instead of an instant
 * game-over, and only flip the terminal status:'lost' when the LAST life is spent
 * (system, top_down; SHARED with the maze-chase genre — the Pac-Man Dossier
 * "life lost → reset positions, keep the board" rule).
 *
 * The seam it binds (the REAL engine death pipeline, NOT a new one):
 *   lethal damage → BasePlayer.kill() → PlayerFSM 'dying' → on death-anim-complete
 *   → scene.onPlayerDeath() (BaseGameScene:548 — sets status:'lost' + emits
 *   player.died). This system WRAPS scene.onPlayerDeath at attach (captures the
 *   original bound method, installs its own), so the engine's own death path routes
 *   into the respawn decision with ZERO change to the FSM / damage / collision code.
 *   The terminal branch DELEGATES to the captured original (the canonical lost path,
 *   status + player.died + GameOverUIScene) — it re-implements nothing.
 *
 * The decision (one place, the public takeHit() seam):
 *   - lives still remain (after this hit) → REVIVE the player, snap it to
 *     scene._spawnPoint (the engine's recorded create-time spawn), restore health,
 *     decrement scene.lives by 1, bump registry 'respawnCount' by 1, keep status
 *     'playing' — and emit player.respawned. The arcade "you get another go".
 *   - this hit spends the LAST life (lives reaches 0) → run the captured original
 *     onPlayerDeath (terminal status:'lost' + player.died) and emit lives.depleted.
 *
 * Source-of-truth contract (so __GAME__ reflects it WITHOUT any per-game glue):
 *   - __GAME__.lives        ← scene.lives           (core/hook.ts:288-292 reads s.lives)
 *   - __GAME__.respawnCount ← registry 'respawnCount' (core/hook.ts:328-333)
 *   - __GAME__.status       ← registry 'status'      (core/hook.ts:243-246)
 * This system OWNS scene.lives (monotonically falling) + the 'respawnCount' counter;
 * BaseGameScene has no respawn of its own (the platformer's respawnAtSpawn analog).
 *
 * Reset (a level RESTART re-runs reset()): lives back to maxLives, respawnCount
 * cleared, scene.lives republished, the wrap re-armed — a clean re-arm every run.
 *
 * Params (all OPTIONAL — sensible declared defaults, never a baked game constant):
 *   maxLives  the starting (and reset) life count (default 3 — the arcade standard).
 *
 * GENERIC: no game/theme, no coordinate, no count is baked — the spawn point is the
 * engine's recorded scene._spawnPoint, the life count is config, and the revive is a
 * reposition of the LIVE player the scene already owns. A scene with no player (or no
 * recorded spawn) degrades to the terminal path (a clean, honest no-respawn).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'LivesRespawn',
  intent:
    'Intercept the player-death seam: a lethal hit respawns the player at its spawn point (lives−1, respawnCount+1, status stays playing) instead of an instant game-over, and flips the terminal status:lost ONLY when the last life is spent. Owns scene.lives (monotonically falling) + the recoverable-reset counter; the arcade attrition loop.',
  attachesTo: 'scene',
  params: ['maxLives'],
  roles: ['player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface LivesRespawnConfig {
  maxLives?: number;
}

export class LivesRespawn implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly maxLives: number;
  /** Lives remaining (monotonically falling within a run; reset() re-arms to maxLives). */
  private lives: number;
  /** The captured original scene.onPlayerDeath (the canonical terminal-lost path). */
  private originalOnPlayerDeath: (() => void) | null = null;

  constructor(params: LivesRespawnConfig = {}) {
    this.maxLives = positiveIntOr(params.maxLives, 3);
    this.lives = this.maxLives;
  }

  /** A level RESTART re-runs reset(): lives back to max, respawnCount cleared, republished. */
  reset(): void {
    this.lives = this.maxLives;
    // Re-capture on the next attach (the scene is rebuilt on restart).
    this.originalOnPlayerDeath = null;
    if (this.scene) {
      this.scene.lives = this.lives;
      this.scene.registry?.set('respawnCount', 0);
    }
  }

  attach(scene: any): void {
    this.scene = scene;

    // Publish the initial life count + clear the recoverable-reset counter so
    // __GAME__.lives / __GAME__.respawnCount read real values from frame one.
    scene.lives = this.lives;
    scene.registry?.set('respawnCount', 0);

    // WRAP the engine death seam: capture the original bound onPlayerDeath (the
    // canonical terminal-lost path) and install our decision in its place. The FSM
    // calls scene.onPlayerDeath() at the real death moment (PlayerFSM:445) → it now
    // routes into takeHit(). Idempotent: re-wrapping our own install is a no-op.
    if (typeof scene.onPlayerDeath === 'function' && !(scene.onPlayerDeath as any).__livesRespawn) {
      this.originalOnPlayerDeath = scene.onPlayerDeath.bind(scene);
      const wrapped = () => this.takeHit();
      (wrapped as any).__livesRespawn = true;
      scene.onPlayerDeath = wrapped;
    }
  }

  /** No per-frame work — the respawn is event-driven (the death seam fires takeHit). */
  update(): void {}

  // ── the drive seam (the death verb: a lethal hit) ───────────────────────────

  /**
   * The lethal-hit verb. Drivable WITHOUT a full game: call takeHit() (the wrapped
   * scene.onPlayerDeath routes here on a real death) and the respawn-or-lose decision
   * runs immediately. Integrate/Test fires THIS directly to witness the transition.
   *
   * Decrement first, then branch on the remaining count:
   *   - lives remain  → revive + reposition the player, bump respawnCount, keep
   *                     status 'playing', emit player.respawned.
   *   - last life      → delegate to the captured original onPlayerDeath (terminal
   *                     status:'lost' + player.died), emit lives.depleted.
   */
  takeHit(): void {
    const scene = this.scene;
    if (!scene) return;

    // Already terminal (a prior depletion) → no double-count; defer to the engine.
    if (scene.registry?.get('status') === 'lost') {
      this.originalOnPlayerDeath?.();
      return;
    }

    this.lives = Math.max(0, this.lives - 1);
    scene.lives = this.lives; // __GAME__.lives reflects the new (lower) count.

    if (this.lives > 0) {
      this.respawn();
      return;
    }

    // Last life spent → the now-terminal game-over. The captured original is the
    // canonical lost path (status:'lost' + the standard player.died + GameOverUIScene);
    // delegate to it rather than re-implementing the death.
    if (this.originalOnPlayerDeath) {
      this.originalOnPlayerDeath();
    } else {
      // No captured original (defensive: attached before any onPlayerDeath existed) —
      // flip the terminal registry status directly so the lose still resolves.
      scene.registry?.set('status', 'lost');
    }

    // lives.depleted — the last life is gone and the run is terminally lost.
    this.bus?.emit('lives.depleted', {});
  }

  // ── the respawn (a non-terminal recoverable reset) ──────────────────────────

  /**
   * Return the player to its spawn for another go (lives still remain): revive the
   * LIVE player, snap it to the engine's recorded scene._spawnPoint, restore health,
   * keep status 'playing', and bump the recoverable-reset counter. The Pac-Man
   * "reset positions, keep the board" beat.
   */
  private respawn(): void {
    const scene = this.scene;

    // Bump the monotone recoverable-reset counter (__GAME__.respawnCount reads it).
    const prior = numOr(scene.registry?.get('respawnCount'), 0);
    const respawnCount = prior + 1;
    scene.registry?.set('respawnCount', respawnCount);

    // Keep the run alive — the respawn is explicitly NON-terminal.
    if (scene.registry?.get('status') !== 'won') {
      scene.registry?.set('status', 'playing');
    }

    // Revive + reposition the live player at the recorded spawn (the engine's
    // create-time position, BaseGameScene:159-161). Defensive across each seam so a
    // game whose player lacks a field still respawns positionally.
    const player = scene.player;
    const spawn = scene._spawnPoint;
    if (player) {
      player.isDead = false;
      if (typeof player.maxHealth === 'number') player.health = player.maxHealth;
      player.setActive?.(true);
      player.setVisible?.(true);
      if (spawn && typeof player.setPosition === 'function') {
        player.setPosition(spawn.x, spawn.y);
        player.body?.reset?.(spawn.x, spawn.y);
      }
      player.setVelocity?.(0, 0);
      // Re-arm the FSM to a live, controllable state (out of 'dying').
      player.fsm?.goto?.('idle');
    }

    // Let the maze (or any host) re-pen its hunters / re-base its mode timer on a
    // respawn — the shared "reset positions" hook. A host with none is a clean no-op.
    scene.onPlayerRespawn?.();

    // player.respawned — the player is back at spawn, a life spent, the run still live.
    this.bus?.emit('player.respawned', {
      livesRemaining: this.lives,
      respawnCount,
    });
    scene.fireEffect?.('player.respawned', player?.x, player?.y);
  }

  // ── read seam (diagnostics) ─────────────────────────────────────────────────
  public get livesRemaining(): number {
    return this.lives;
  }

  // ── component surface (the declared PUSH-channel events this system emits) ───

  /**
   * The uniform component surface. Declares the two attrition moments this system
   * emits on the shared bus — TRUE statements about the real emit sites in this file:
   *   - player.respawned ← move (a lethal hit while lives remain → respawn at spawn)
   *   - lives.depleted   ← move (a lethal hit with the LAST life → terminal lost)
   * The lives/respawnCount/status changes are observable through __GAME__.lives,
   * __GAME__.respawnCount, and __GAME__.status (the hook reads scene.lives + the
   * registry), so this surface declares only the PUSH channel + the 'spawn' anchor.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: ['spawn'],
      events: [
        {
          name: 'player.respawned',
          payload: '{livesRemaining,respawnCount}',
          scope: 'archetype',
          drivenBy: 'move — the player takes a lethal hit while lives remain (the player.died seam)',
          expect:
            "the player position resets to its spawn, scene.lives decrements by 1, __GAME__.respawnCount increments by 1, and __GAME__.status stays 'playing'; player.respawned logged",
        },
        {
          name: 'lives.depleted',
          payload: '{}',
          scope: 'archetype',
          drivenBy: 'move — the player takes a lethal hit with the LAST life (lives reaches 0)',
          expect:
            "__GAME__.status flips to 'lost' (the now-terminal game-over) and scene.lives reads 0; lives.depleted logged",
        },
      ],
    };
  }
}

/** Coerce to a positive integer or fall back to a sensible default (never a baked constant). */
function positiveIntOr(v: number | undefined, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Coerce to a finite number or fall back (defensive over a possibly-undefined registry value). */
function numOr(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
