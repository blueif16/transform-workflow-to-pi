/**
 * GhostHouseRelease — the maze-chase hunt-ESCALATION curve (BUILD — system;
 * top_down:maze-chase; the Pac-Man Dossier ghost-house release + GameInternals
 * "timers/counters reset whenever a life is lost"). The board OPENS with one
 * hunter (the lead ghost) loose and the rest PENNED; the pack thickens as the
 * player eats dots. Distinct from GhostModeController (the mode FSM all ghosts
 * read) and ElroySpeedup (one ghost's late-game speed): this owns the STRUCTURAL
 * release order — when each non-lead ghost first leaves the pen.
 *
 * The release rule (the Dossier's two-counter scheme):
 *   - Each non-lead ghost has a PERSONAL dot counter. While that ghost is still the
 *     "preferred" (next-in-line) penned ghost, every dot the player eats ticks ITS
 *     counter; when the counter crosses the ghost's personal threshold the ghost is
 *     RELEASED and the next penned ghost becomes preferred. Ghosts release strictly
 *     in `releaseOrder` (default pinky -> inky -> clyde — blinky is the lead, loose
 *     from the start).
 *   - After a LIFE LOSS (the scene's player.died), the personal counters are
 *     ABANDONED and a single GLOBAL dot counter takes over (GameInternals): the next
 *     penned ghost releases when the global counter crosses ITS global threshold
 *     (Dossier level-1: Pinky@7, Inky@17; Clyde releases when the rest are out).
 *
 * RELEASE = flipping the penned ghost's GhostTarget behavior from disabled to
 * enabled. A penned ghost ships with its GhostTarget `enabled = false` (it sits in
 * the pen, not hunting); releasing sets `enabled = true`, so it begins hunting under
 * the shared GhostModeController exactly like the lead ghost — its entity in
 * __GAME__.entities starts moving. We do NOT re-implement the brain; we only un-gate
 * the one already composed on the ghost (the same GhostTarget ElroySpeedup mutates).
 *
 * PUBLISHED ON THE SCENE (the read seam, generic by name):
 *   scene.ghostsReleased : number — count of ghosts loose (lead + every released
 *                          penned ghost). MONOTONICALLY rising, 0..(ghost count).
 *
 * Observable transitions (__GAME__):
 *   eating a dot ticks the active counter; on a crossing the named ghost's
 *   GhostTarget enables (its entity begins moving in __GAME__.entities) and
 *   scene.ghostsReleased increments; ghost.released logged {ghostId,ghostsReleased}.
 *
 * It re-implements NOTHING the engine owns: dot pickups arrive via the standardized
 * `reward.collected` bus event (the same seam BonusFruit/ElroySpeedup read); the life
 * loss arrives via the base `player.died` event; the ghosts + their GhostTarget are
 * the SAME maze hunters the loader already composed (we resolve them off scene.enemies
 * by GhostTarget.selector, exactly like ElroySpeedup). A board with no penned ghost is
 * a clean no-op (nothing to release).
 *
 * The released ghost id AUTO-DERIVES from the bound ghost entity's __id (matched
 * against `releaseOrder` of GhostTarget selectors) — NOT a config param. The per-ghost
 * personal thresholds + the post-death global thresholds ARE config params (Dossier
 * defaults below), never a baked game constant.
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, no game/theme/coordinate baked):
 *   leadSelector       the GhostTarget selector that is loose from the start, never
 *                      penned (default 'blinky' — the Dossier's lead hunter).
 *   releaseOrder       the GhostTarget selectors of the PENNED ghosts, in the order
 *                      they leave the pen (default ['pinky','inky','clyde']).
 *   personalThresholds personal dot-counter threshold per penned ghost, index-aligned
 *                      to releaseOrder (default [0, 30, 60] — Dossier level-1: Pinky
 *                      out immediately, Inky at 30 of its own dots, Clyde at 60).
 *   globalThresholds   the GLOBAL dot-counter threshold per penned ghost (used AFTER
 *                      a life loss), index-aligned to releaseOrder (default
 *                      [7, 17, 32] — Dossier post-death: Pinky@7, Inky@17, Clyde
 *                      when the rest are out).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs globs this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'GhostHouseRelease',
  intent:
    'The maze hunt-escalation curve: the board opens with one loose lead ghost and the rest penned; each dot eaten ticks the next penned ghost’s release counter, and on a crossing of its personal threshold (or, after a life loss, a global threshold) that ghost’s GhostTarget enables — it begins hunting and scene.ghostsReleased increments (monotonic, 0..n). Emits ghost.released at each release.',
  attachesTo: 'scene',
  params: ['leadSelector', 'releaseOrder', 'personalThresholds', 'globalThresholds'],
  roles: ['enemy', 'collectible'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface GhostHouseReleaseConfig {
  /** The GhostTarget selector loose from the start, never penned (default 'blinky'). */
  leadSelector?: string;
  /** Penned-ghost selectors in release order (default ['pinky','inky','clyde']). */
  releaseOrder?: string[];
  /** Personal dot-counter threshold per penned ghost (default [0, 30, 60]). */
  personalThresholds?: number[];
  /** Global dot-counter threshold per penned ghost, used after a life loss (default [7, 17, 32]). */
  globalThresholds?: number[];
}

/** The bound penned ghost: its GhostTarget behavior + owner sprite + its two thresholds. */
interface PennedGhost {
  /** The GhostTarget selector (the slot in releaseOrder). */
  selector: string;
  /** The resolved GhostTarget behavior (null until the ghost is found in scene.enemies). */
  behavior: any;
  /** The ghost owner sprite (carries __id, used to AUTO-DERIVE the payload ghostId). */
  sprite: any;
  /** This ghost's personal dot-counter threshold (pre-death). */
  personalThreshold: number;
  /** This ghost's global dot-counter threshold (post-death). */
  globalThreshold: number;
  /** True once released (its GhostTarget has been enabled). */
  released: boolean;
}

export class GhostHouseRelease implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly leadSelector: string;
  private readonly releaseOrder: string[];
  private readonly personalThresholds: number[];
  private readonly globalThresholds: number[];

  /** One slot per penned ghost, in release order (resolved lazily off scene.enemies). */
  private penned: PennedGhost[] = [];
  /** The personal dot counter for the CURRENT preferred (next-in-line) penned ghost. */
  private personalCounter = 0;
  /** The single global dot counter — only consulted AFTER a life loss. */
  private globalCounter = 0;
  /** True once a life has been lost: counters switch from personal to global (GameInternals). */
  private useGlobalCounter = false;
  /** Count of ghosts loose (lead + every released penned ghost); mirrored onto scene.ghostsReleased. */
  private releasedCount = 0;
  /** Unsubscribe handles for the bus listeners (cleared on reset). */
  private unsubs: Array<() => void> = [];

  constructor(params: GhostHouseReleaseConfig = {}) {
    this.leadSelector = params.leadSelector ?? 'blinky';
    this.releaseOrder =
      Array.isArray(params.releaseOrder) && params.releaseOrder.length > 0
        ? params.releaseOrder.slice()
        : ['pinky', 'inky', 'clyde'];
    this.personalThresholds = this.normalizeThresholds(params.personalThresholds, [0, 30, 60]);
    this.globalThresholds = this.normalizeThresholds(params.globalThresholds, [7, 17, 32]);
  }

  /** Coerce a threshold list to non-negative ints, falling back to a default per slot. */
  private normalizeThresholds(input: number[] | undefined, def: number[]): number[] {
    const src = Array.isArray(input) && input.length > 0 ? input : def;
    return this.releaseOrder.map((_s, i) =>
      Math.max(0, Math.floor(src[i] ?? def[i] ?? def[def.length - 1] ?? 0)),
    );
  }

  /** Re-arm cleanly on a level restart: drop every latch + the bus listeners. */
  reset(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.penned = [];
    this.personalCounter = 0;
    this.globalCounter = 0;
    this.useGlobalCounter = false;
    this.releasedCount = 0;
    if (this.scene) this.scene.ghostsReleased = 0;
  }

  attach(scene: any): void {
    this.scene = scene;
    // The lead ghost is loose from the start: ghostsReleased opens at 1 (or 0 if no
    // lead ghost is on this board). Penned ghosts are resolved lazily in update().
    this.releasedCount = 0;
    scene.ghostsReleased = 0;
    this.resolvePenned();
    this.openWithLead();

    // Every dot/pellet pickup funnels through reward.collected — tick the active
    // counter on each. Storing the unsubscribe keeps a restart clean.
    const onDot = scene.eventBus?.on('reward.collected', () => this.onDotEaten());
    if (onDot) this.unsubs.push(onDot);
    // A life loss switches the scheme from personal to global counters (GameInternals).
    const onDeath = scene.eventBus?.on('player.died', () => this.onLifeLost());
    if (onDeath) this.unsubs.push(onDeath);
  }

  /** No overlaps to wire — release is driven by the reward.collected / player.died bus. */
  setupCollisions(): void {}

  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    // Late-bind any penned ghost that spawned after attach (e.g. a WaveSpawner ghost),
    // and pen it (disable its GhostTarget) the first time we see it.
    this.resolvePenned();
  }

  // ── the release gate (driven by eating dots) ────────────────────────────────

  /**
   * Record one eaten dot and release the next penned ghost if its counter just
   * crossed the active threshold. PUBLIC so a unit test (or Integrate) can drive the
   * gate one dot at a time WITHOUT a full board; the attach() subscription calls it
   * for every real reward.collected. This is the true gameplay seam where eating a
   * dot thickens the pack.
   */
  public onDotEaten(): void {
    if (this.useGlobalCounter) this.globalCounter += 1;
    else this.personalCounter += 1;
    this.releaseReadyGhosts();
  }

  /**
   * Mark a life lost: abandon the personal counters and switch to the single global
   * counter from zero (the Dossier/GameInternals re-base). PUBLIC so the Test phase
   * can drive the post-death scheme directly; the attach() subscription calls it on
   * the base player.died event.
   */
  public onLifeLost(): void {
    this.useGlobalCounter = true;
    this.globalCounter = 0;
    // A life loss can immediately satisfy a zero global threshold for the next ghost.
    this.releaseReadyGhosts();
  }

  /**
   * Release every penned ghost (in order) whose ACTIVE counter has reached its active
   * threshold. Only the FRONT-of-line ghost is eligible (strict release order); once
   * it leaves, its counter re-bases so the next ghost's count starts fresh.
   */
  private releaseReadyGhosts(): void {
    for (let i = 0; i < this.penned.length; i++) {
      const g = this.penned[i];
      if (g.released) continue;
      // Strict order: only the front-most un-released ghost can leave next.
      const counter = this.useGlobalCounter ? this.globalCounter : this.personalCounter;
      const threshold = this.useGlobalCounter ? g.globalThreshold : g.personalThreshold;
      if (counter >= threshold) {
        this.release(g);
        // The next ghost's personal count starts fresh from this point (the personal
        // counter belongs to the CURRENT preferred ghost only).
        if (!this.useGlobalCounter) this.personalCounter = 0;
      }
      // Stop at the first ghost not yet ready — ghosts leave strictly in order.
      break;
    }
  }

  /**
   * Release one penned ghost: enable its GhostTarget so it begins hunting (its entity
   * starts moving in __GAME__.entities under the shared mode FSM), bump
   * scene.ghostsReleased, and emit ghost.released. The ghostId AUTO-DERIVES from the
   * ghost entity's __id (falling back to its selector). The true escalation seam.
   */
  private release(g: PennedGhost): void {
    g.released = true;
    // RELEASE = un-gate the brain already composed on the ghost; it now hunts exactly
    // like the lead ghost. A behavior that was never penned (no behavior resolved) is
    // a safe no-op — we still count + emit so the curve is observable.
    if (g.behavior) g.behavior.enabled = true;
    this.bumpReleased();

    const ghostId = (g.sprite?.__id as string | undefined) ?? g.selector;
    // ghost.released — a dot pickup (or the post-death global counter) crossed this
    // ghost's threshold; it just left the pen and started hunting.
    this.bus?.emit('ghost.released', { ghostId, ghostsReleased: this.releasedCount });
    this.scene.fireEffect?.('ghost.released', g.sprite?.x, g.sprite?.y);
  }

  // ── ghost resolution + pen state (read the live world, generic) ──────────────

  /**
   * Open the board: the lead ghost is loose from the start, so it counts toward
   * ghostsReleased immediately (if present on this board).
   */
  private openWithLead(): void {
    const lead = this.findGhostBySelector(this.leadSelector);
    if (lead) {
      // Ensure the lead is actively hunting (its GhostTarget enabled) from t=0.
      if (lead.behavior) lead.behavior.enabled = true;
      this.bumpReleased();
    }
  }

  /**
   * Resolve + PEN each releaseOrder ghost the first time it is seen in scene.enemies:
   * disable its GhostTarget so it sits in the pen (not hunting) until released.
   * Idempotent — an already-resolved slot is skipped. A board missing a ghost simply
   * never fills that slot (a clean no-op).
   */
  private resolvePenned(): void {
    this.releaseOrder.forEach((selector, i) => {
      // Already have a resolved behavior for this slot → nothing to do.
      if (this.penned[i]?.behavior) return;
      const found = this.findGhostBySelector(selector);
      if (!found) return;
      const slot: PennedGhost = {
        selector,
        behavior: found.behavior,
        sprite: found.sprite,
        personalThreshold: this.personalThresholds[i] ?? 0,
        globalThreshold: this.globalThresholds[i] ?? 0,
        released: this.penned[i]?.released ?? false,
      };
      // PEN it: disable the brain so it waits in the house (unless already released
      // on a re-resolve after a late spawn).
      if (found.behavior && !slot.released) found.behavior.enabled = false;
      this.penned[i] = slot;
    });
  }

  /**
   * Find a ghost (its GhostTarget behavior + owner sprite) by GhostTarget selector —
   * the same resolution ElroySpeedup uses. Returns null when no such ghost is on the
   * board (so every caller degrades to a clean no-op).
   */
  private findGhostBySelector(selector: string): { behavior: any; sprite: any } | null {
    const group = this.scene?.enemies;
    if (!group || typeof group.getChildren !== 'function') return null;
    for (const e of group.getChildren() as any[]) {
      if (!e || !e.behaviors || typeof e.behaviors.getAll !== 'function') continue;
      for (const beh of e.behaviors.getAll() as any[]) {
        if (beh && beh.constructor?.name === 'GhostTarget' && beh.selector === selector) {
          return { behavior: beh, sprite: e };
        }
      }
    }
    return null;
  }

  /** Increment the loose-ghost count and mirror it onto the scene (monotonic). */
  private bumpReleased(): void {
    this.releasedCount += 1;
    this.scene.ghostsReleased = this.releasedCount;
  }

  // ── component surface (the declared PUSH channel) ────────────────────────────

  /**
   * The uniform component surface. Declares the ONE release moment this system emits
   * on the shared bus — a TRUE statement about the real emit site in release():
   *   - ghost.released ← release() (a dot tick crossed a penned ghost's threshold).
   * scene.ghostsReleased is the live observable (it rises as ghosts leave the pen);
   * the released ghost's movement is visible on the existing __GAME__ entities adapter,
   * so this surface declares only the PUSH channel + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'ghost.released',
          payload: '{ghostId,ghostsReleased}',
          scope: 'archetype',
          drivenBy:
            'collect — eating a dot ticks the next penned ghost’s dot counter past its release threshold (or, after a life loss, its global threshold)',
          expect:
            'the named ghost leaves the pen and begins hunting (its GhostTarget enables so its entity starts moving in __GAME__.entities under the mode FSM) and scene.ghostsReleased increments (monotonic, 0..n); ghost.released logged',
        },
      ],
    };
  }
}
