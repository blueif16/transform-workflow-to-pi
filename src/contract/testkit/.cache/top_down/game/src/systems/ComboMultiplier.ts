/**
 * ComboMultiplier — the kill-chain scoring depth add (twin-stick SIGNATURE per
 * DR §6 bounded+win-tied score / DR §3 contested target selection; the Geometry
 * Wars / DonPachi chain). ADDED beyond the seeds: the catalog has WaveSpawner +
 * KillAllGoal but NO kill-chain scoring — a kill scored nothing until this system.
 *
 * The chain (the upside) and the decay (the downside it trades against):
 *   - On each enemy KILL inside the live decay window (scene.time.now within
 *     `decayMs` of the previous kill) the multiplier rises ONE step, so the chain
 *     deepens the longer you keep killing. The kill is then scored at the CURRENT
 *     multiplier: __GAME__.score bumps by `basePoints * multiplier`. We emit
 *     `combo.extended` at this true kill seam.
 *   - When the decay window LAPSES with no kill (timer-driven, the cost of the
 *     chain) the multiplier collapses back to 1 so the next kill scores only
 *     basePoints. We emit `combo.reset` at this lapse seam.
 *
 * It re-implements NOTHING the engine owns: the kill moment is the scene's own
 * `enemy.died` seam (BaseGameScene.onEnemyKilled → eventBus.emit('enemy.died'));
 * the score source is the single registry 'score' key the __GAME__ adapter reads
 * (core/src/hook.ts get score). The killed-enemy id, when carried, AUTO-DERIVES
 * from the dying entity's __id on the consumed enemy.died payload — never a config
 * param. The live multiplier is published on scene.comboMultiplier AND the registry
 * 'comboMultiplier' key so the hook can surface it.
 *
 * DRIVE SEAM (so Integrate can wire it + a unit test can fire it WITHOUT a full
 * game): attach() subscribes `registerKill` to the scene's enemy.died; the public
 * `registerKill(enemy?)` is also the direct verb — call it to register one kill
 * (raise + score + emit). Advance scene.time.now past `decayMs` and tick update()
 * to drive the lapse → combo.reset.
 *
 * GENERIC: no game/theme, no entity coordinate. Restart re-arms to 1 via reset().
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, nothing baked):
 *   basePoints   score awarded per kill at multiplier 1 (default 100). The kill
 *                scores basePoints * the current multiplier.
 *   decayMs      the chain window in ms: a kill within decayMs of the previous one
 *                extends the chain; a gap longer than decayMs lapses it (default
 *                2000 — ~2s).
 *   maxMultiplier  cap so the chain stays bounded + win-tied (DR §6); default 8.
 *   step         how much one extending kill raises the multiplier (default 1).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (registry/discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'ComboMultiplier',
  intent:
    'Maintain a live kill-chain multiplier: each enemy kill inside a decay window raises a multiplier that scales every subsequent kill score (basePoints*multiplier); letting the window lapse resets it to 1.',
  attachesTo: 'scene',
  params: ['basePoints', 'decayMs', 'maxMultiplier', 'step'],
  roles: ['enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface ComboMultiplierConfig {
  /** Score per kill at multiplier 1 (default 100). */
  basePoints?: number;
  /** Chain window in ms — a kill within this of the previous extends it (default 2000). */
  decayMs?: number;
  /** Cap so the chain stays bounded + win-tied (default 8). */
  maxMultiplier?: number;
  /** Multiplier raise per extending kill (default 1). */
  step?: number;
}

export class ComboMultiplier implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly basePoints: number;
  private readonly decayMs: number;
  private readonly maxMultiplier: number;
  private readonly step: number;

  /** The live multiplier (1 = no chain). Mirrored to scene.comboMultiplier + registry. */
  private multiplier = 1;
  /** Total kills in the CURRENT chain (the combo.extended payload's `kills`). */
  private chainKills = 0;
  /** scene.time.now (ms) of the last kill; -1 before any kill this run. */
  private lastKillAt = -1;
  /** Unsubscribe handle for the enemy.died subscription (cleared on reset). */
  private offDied: (() => void) | null = null;

  constructor(params: ComboMultiplierConfig = {}) {
    this.basePoints = Math.max(0, params.basePoints ?? 100);
    this.decayMs = Math.max(1, params.decayMs ?? 2000);
    this.maxMultiplier = Math.max(1, Math.floor(params.maxMultiplier ?? 8));
    this.step = Math.max(1, Math.floor(params.step ?? 1));
  }

  /** Re-arm to a fresh chain so a restarted level scores from multiplier 1. */
  reset(): void {
    this.multiplier = 1;
    this.chainKills = 0;
    this.lastKillAt = -1;
    // Drop any prior subscription so a re-attach does not double-count kills.
    this.offDied?.();
    this.offDied = null;
  }

  attach(scene: any): void {
    this.scene = scene;
    // Publish the armed multiplier immediately so __GAME__/HUD read 1 from frame 0.
    this.publishMultiplier();
    // Wire the chain to the scene's own kill seam: every standardized enemy.died
    // (BaseGameScene.onEnemyKilled) registers one kill. The unsubscribe is kept so
    // reset()/onDetach can tear it down (no double-count on re-attach).
    const bus = scene?.eventBus;
    if (bus && typeof bus.on === 'function') {
      this.offDied = bus.on('enemy.died', (payload: any) => this.registerKill(payload));
    }
  }

  /**
   * Per-frame: collapse the chain when its decay window has LAPSED with no kill.
   * Timer-driven off the scene clock so a paused/restarted level re-bases cleanly.
   */
  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    if (this.multiplier <= 1 || this.lastKillAt < 0) return; // no live chain to lapse.
    const now = this.now();
    if (now - this.lastKillAt > this.decayMs) this.resetChain();
  }

  /**
   * Register ONE kill — the public drive verb (also the enemy.died subscriber).
   * If the chain is still live (within decayMs of the last kill) the multiplier
   * rises one step; otherwise this kill OPENS a fresh chain at multiplier 1. The
   * kill then scores basePoints * the current multiplier, and combo.extended fires
   * at this true kill seam. The killed-enemy id auto-derives from the payload __id.
   *
   * @param payload the consumed enemy.died payload ({id,x,y}); accepts a raw id too.
   */
  public registerKill(payload?: any): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    const now = this.now();

    // Extend an open chain, else open a fresh one at multiplier 1.
    const chainOpen = this.lastKillAt >= 0 && now - this.lastKillAt <= this.decayMs;
    if (chainOpen) {
      this.multiplier = Math.min(this.maxMultiplier, this.multiplier + this.step);
    } else {
      this.multiplier = 1;
      this.chainKills = 0;
    }
    this.lastKillAt = now;
    this.chainKills += 1;
    this.publishMultiplier();

    // Score the kill at the CURRENT multiplier (the depth payoff): __GAME__.score
    // jumps by basePoints * multiplier (more than the base whenever a chain is live).
    this.addScore(this.basePoints * this.multiplier);

    const enemyId =
      (payload && typeof payload === 'object' ? payload.id : payload) ?? undefined;
    this.bus?.emit('combo.extended', {
      multiplier: this.multiplier,
      kills: this.chainKills,
      ...(enemyId !== undefined ? { enemyId } : {}),
    });
  }

  /** Collapse the chain to 1 and fire combo.reset (the lapse downside). */
  private resetChain(): void {
    const atMultiplier = this.multiplier;
    this.multiplier = 1;
    this.chainKills = 0;
    this.lastKillAt = -1;
    this.publishMultiplier();
    this.bus?.emit('combo.reset', { atMultiplier });
  }

  /** Mirror the live multiplier onto the scene field + registry the hook reads. */
  private publishMultiplier(): void {
    this.scene.comboMultiplier = this.multiplier;
    this.scene.registry?.set?.('comboMultiplier', this.multiplier);
  }

  /** Add to the single score source (the registry 'score'), generic — mirrors CollectGoal. */
  private addScore(points: number): void {
    const reg = this.scene?.registry;
    if (!reg) return;
    const cur = Number(reg.get('score') ?? 0);
    reg.set('score', cur + points);
  }

  /** The scene clock (ms) — the same read every cooldown system uses (DashAbility, GhostMode). */
  private now(): number {
    return this.scene?.time?.now ?? 0;
  }

  /** Tear the subscription down (engine seam; also covered by reset). */
  public onDetach(): void {
    this.offDied?.();
    this.offDied = null;
  }

  /** The PUSH-channel surface: declares + really fires combo.extended / combo.reset. */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'combo.extended',
          payload: '{multiplier,kills}',
          scope: 'archetype',
          drivenBy: 'shoot — an enemy is killed while the combo window is still open',
          expect:
            'scene.comboMultiplier rises one step and the kill scores basePoints*multiplier so __GAME__.score jumps by more than the base value; combo.extended logged',
        },
        {
          name: 'combo.reset',
          payload: '{atMultiplier}',
          scope: 'archetype',
          drivenBy: 'the decay window lapses with no kill (timer-driven, the downside of the chain)',
          expect:
            'scene.comboMultiplier returns to 1 so the next kill scores only basePoints; combo.reset logged',
        },
      ],
    };
  }
}
