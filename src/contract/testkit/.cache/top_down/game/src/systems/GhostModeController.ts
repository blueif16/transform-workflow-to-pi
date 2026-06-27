/**
 * GhostModeController — the SHARED timed maze ghost-mode FSM (BUILD — system, M5;
 * RB §2.3 / the Pac-Man Dossier).
 *
 * The maze-chase genre's spine: ONE mode all hunters read, flipped on a timer —
 *   SCATTER (default 7s) -> CHASE (default 20s) -> SCATTER -> ... (repeating),
 * with FRIGHTENED entered on a power-pellet pickup for a bounded window then
 * RESUMING the scatter/chase schedule where it left off. On EVERY mode transition
 * the controller signals "reverse now" — the genre's signature: all ghosts flip
 * direction at each transition (RB §2.3). It DRIVES no entity itself; it only
 * publishes the shared mode + reverse epoch that GhostTarget reads, exactly like
 * KillAllGoal/WaveSpawner own a single concern.
 *
 * PUBLISHED ON THE SCENE (the read seam for every maze ghost — generic, by name):
 *   scene.__ghostMode        : 'scatter' | 'chase' | 'frightened'  (the shared mode)
 *   scene.__ghostReverseEpoch : number  — bumped on each transition; a ghost that
 *                               last reversed at an older epoch reverses + records it
 *                               (an epoch is restart-safe vs a one-shot boolean).
 *   scene.frighten()         : () => void — a power-pellet pickup calls this (the
 *                               CollectGoal/pellet path) to enter FRIGHTENED.
 *
 * GATING: a maze does not use the all-enemies-dead win (ghosts are never killed) —
 * CollectGoal owns the win; this controller sets scene.suppressDefaultWin = true so
 * the engine default never fires on an empty (never-populated) enemy kill check.
 *
 * Params (all OPTIONAL, all tunable — never a baked constant per RB):
 *   scatterMs    scatter phase length in ms (default 7000 — the level-1 value).
 *   chaseMs      chase phase length in ms (default 20000).
 *   frightenedMs frightened window in ms after a pellet (default 6000).
 *   startMode    'scatter' | 'chase' the run opens in (default 'scatter').
 *
 * Time uses the scene clock (scene.time.now) so a paused/restarted level re-bases
 * cleanly (reset() re-anchors). GENERIC: no game/theme, no entity coordinate.
 */
import type { ISceneSystem } from '../scenes/topdown-data';

/** CAPABILITY sidecar (M3 registry reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'GhostModeController',
  intent:
    'The shared maze ghost-mode FSM: flip scatter(7s)<->chase(20s) on a repeating timer, enter frightened on a power-pellet, and signal "reverse now" on every transition so all ghosts flip direction. Publishes scene.__ghostMode + a reverse epoch the GhostTarget behaviors read.',
  attachesTo: 'scene',
  params: ['scatterMs', 'chaseMs', 'frightenedMs', 'startMode'],
  roles: ['enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export type GhostMode = 'scatter' | 'chase' | 'frightened';

export interface GhostModeControllerConfig {
  scatterMs?: number;
  chaseMs?: number;
  frightenedMs?: number;
  startMode?: GhostMode;
}

export class GhostModeController implements ISceneSystem {
  private scene: any;
  private readonly scatterMs: number;
  private readonly chaseMs: number;
  private readonly frightenedMs: number;
  private readonly startMode: GhostMode;

  /** The scatter/chase phase the run is currently in (the base schedule). */
  private scheduledMode: GhostMode = 'scatter';
  /** ms timestamp (scene clock) the current scheduled phase began. */
  private phaseStartedAt = 0;
  /** When in FRIGHTENED, the ms timestamp it ends; 0 = not frightened. */
  private frightenedUntil = 0;
  /** Bumped on every published transition (the reverse epoch ghosts read). */
  private reverseEpoch = 0;
  /** The last mode published to the scene (to detect a transition). */
  private lastPublished: GhostMode | null = null;

  constructor(params: GhostModeControllerConfig = {}) {
    this.scatterMs = Math.max(1, params.scatterMs ?? 7000);
    this.chaseMs = Math.max(1, params.chaseMs ?? 20000);
    this.frightenedMs = Math.max(1, params.frightenedMs ?? 6000);
    this.startMode = params.startMode ?? 'scatter';
  }

  reset(): void {
    // Re-anchor every latch so a restarted level re-runs the schedule from t=0.
    this.scheduledMode = this.startMode;
    this.phaseStartedAt = 0;
    this.frightenedUntil = 0;
    this.reverseEpoch = 0;
    this.lastPublished = null;
  }

  attach(scene: any): void {
    this.scene = scene;
    // A maze is won by clearing dots, never by killing ghosts — own the win gate.
    scene.suppressDefaultWin = true;
    this.phaseStartedAt = this.now();
    // Expose the pellet hook so the dot/pellet path can flip ghosts to frightened.
    scene.frighten = () => this.enterFrightened();
    this.publish(this.startMode, /*forceReverse*/ false);
  }

  update(): void {
    if (!this.scene) return;
    const t = this.now();

    // FRIGHTENED takes precedence until its window elapses, then resume schedule.
    if (this.frightenedUntil > 0) {
      if (t < this.frightenedUntil) {
        this.publish('frightened', false);
        return;
      }
      // Frightened ended — resume the scheduled phase (re-anchored so the next
      // scatter/chase flip is measured from now), and REVERSE on the resume.
      this.frightenedUntil = 0;
      this.phaseStartedAt = t;
      this.publish(this.scheduledMode, /*forceReverse*/ true);
      return;
    }

    // Scatter/chase schedule: flip when the current phase's window elapses.
    const dur = this.scheduledMode === 'scatter' ? this.scatterMs : this.chaseMs;
    if (t - this.phaseStartedAt >= dur) {
      this.scheduledMode = this.scheduledMode === 'scatter' ? 'chase' : 'scatter';
      this.phaseStartedAt = t;
    }
    this.publish(this.scheduledMode, false);
  }

  /** Enter FRIGHTENED for the configured window (a power-pellet pickup). */
  private enterFrightened(): void {
    this.frightenedUntil = this.now() + this.frightenedMs;
    this.publish('frightened', /*forceReverse*/ true);
  }

  /**
   * Publish the shared mode to the scene; on a CHANGE (or a forced reverse) bump
   * the reverse epoch so every ghost flips direction at the transition (RB §2.3).
   */
  private publish(mode: GhostMode, forceReverse: boolean): void {
    const changed = mode !== this.lastPublished;
    this.scene.__ghostMode = mode;
    if (changed || forceReverse) {
      this.reverseEpoch += 1;
      this.scene.__ghostReverseEpoch = this.reverseEpoch;
    }
    this.lastPublished = mode;
  }

  /** The scene clock now (ms); 0-safe before attach. */
  private now(): number {
    return this.scene?.time?.now ?? 0;
  }

  // ── read seams (diagnostics / GhostTarget) ────────────────────────────────
  public get mode(): GhostMode {
    return (this.scene?.__ghostMode as GhostMode) ?? this.startMode;
  }
}
