/**
 * GhostEatChain — the OFFENSIVE turn of the maze chase (BUILD — system;
 * top_down:maze-chase, the Pac-Man Dossier doubling chain; DR §12 H5 inversion at
 * pellet scale). The genuinely-new half split out of the dropped PowerPelletState
 * seed: the frighten FLIP already ships in CollectGoal/GhostModeController (a power
 * pellet calls scene.frighten()); this system owns the EAT that the fright window
 * unlocks. Pairs with GhostModeController's frightened state.
 *
 * The inversion (same player<->ghost overlap as contact-damage, OPPOSITE
 * consequence while frightened): the base scene's player<->enemy overlap is LETHAL
 * to the player; here, ONLY while scene.__ghostMode === 'frightened', overlapping a
 * ghost EATS it —
 *   - the eaten ghost is sent HOME to its pen spawn (its captured spawn x|y in the
 *     live enemies group → it APPEARS back at the pen in __GAME__.entities), and
 *   - the next chain value is scored: 200 -> 400 -> 800 -> 1600 across the four
 *     ghosts eaten within ONE fright window (the Dossier doubling). We emit
 *     `ghost.eaten` at this true seam.
 * The chain RESETS when the fright window ends — the moment scene.__ghostMode
 * leaves 'frightened' (GhostModeController's timer-driven resume), the next eaten
 * ghost scores 200 again. We emit `ghost.chainReset` at that edge.
 *
 * It owns NO win and NO frighten flip — only the eat + the chain bookkeeping. The
 * eaten ghost's id is AUTO-DERIVED from the overlapped ghost entity's `__id` in the
 * live world (NOT a config param); the chain step is internal state, not a payload
 * id. Score flows through the single registry score source (utils.addScore — also
 * fires the standard score.changed). The pen spawn is captured from each ghost's
 * own first-seen position (no baked coordinate); a non-frightened overlap is a clean
 * no-op (the base contact-damage path is unchanged).
 *
 * Observable (__GAME__): during fright, overlapping a ghost adds the escalating
 * chain value to __GAME__.score and the eaten ghost returns to its pen spawn in
 * __GAME__.entities[]; when the fright window ends the chain step returns to base.
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, no game/theme/coordinate baked):
 *   chainValues?   the eat-chain score ladder across one fright window
 *                  (default [200,400,800,1600] — the four-ghost Dossier doubling).
 *                  Eating beyond the ladder length holds at the last value.
 *   frightenedMode? the scene.__ghostMode string that unlocks the eat
 *                  (default 'frightened' — GhostModeController's published value).
 *   ghostKind?     only enemies whose `__kind` equals this count as eatable ghosts.
 *                  Absent => any active enemy sprite is an eatable ghost (the maze
 *                  populates the enemies group only with ghosts).
 *   overlapPad     forgiving half-extent added to the eat AABB so the eat is not
 *                  pixel-brittle (default 6px).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';
import { addScore } from '../utils';

/** CAPABILITY sidecar (registry/discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'GhostEatChain',
  intent:
    'The offensive turn of the maze chase: while scene.__ghostMode is frightened, a player<->ghost overlap EATS the ghost — sends it home to its pen spawn and scores the next chain value (200/400/800/1600 across the four ghosts in one fright window); the chain resets when the fright window ends. Pairs with GhostModeController frightened state.',
  attachesTo: 'scene',
  params: ['chainValues', 'frightenedMode', 'ghostKind', 'overlapPad'],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface GhostEatChainConfig {
  chainValues?: number[];
  frightenedMode?: string;
  ghostKind?: string;
  overlapPad?: number;
}

/** The default Pac-Man Dossier eat-chain ladder across one fright window. */
const DEFAULT_CHAIN_VALUES = [200, 400, 800, 1600] as const;

export class GhostEatChain implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly chainValues: number[];
  private readonly frightenedMode: string;
  private readonly ghostKind?: string;
  private readonly overlapPad: number;

  /** How many ghosts have been eaten in the CURRENT fright window (the chain step). */
  private chainStep = 0;
  /** Whether scene.__ghostMode was frightened on the previous tick (edge detect). */
  private wasFrightened = false;
  /** Pen-spawn x|y captured per ghost id the first time we see it (no baked coord). */
  private penById: Record<string, { x: number; y: number }> = {};

  constructor(params: GhostEatChainConfig = {}) {
    this.chainValues =
      Array.isArray(params.chainValues) && params.chainValues.length > 0
        ? params.chainValues.slice()
        : [...DEFAULT_CHAIN_VALUES];
    this.frightenedMode = params.frightenedMode ?? 'frightened';
    this.ghostKind = params.ghostKind;
    this.overlapPad = params.overlapPad ?? 6;
  }

  reset(): void {
    // Re-arm every latch so a restarted level eats from a fresh chain at the pen.
    this.chainStep = 0;
    this.wasFrightened = false;
    this.penById = {};
  }

  attach(scene: any): void {
    this.scene = scene;
    // Capture each ghost's pen spawn from its first-seen position (no baked coord).
    this.captureUnseenPens();
  }

  /** Wire the player<->ghost EAT overlap (player + enemies exist by setupCollisions). */
  setupCollisions(): void {
    const scene = this.scene;
    const player = scene?.player;
    const group = scene?.enemies;
    if (!player || !group?.getChildren) return;
    scene.physics.add.overlap(player, group, (_p: any, ghost: any) => {
      // Only the frightened window unlocks the eat; otherwise the base scene's
      // contact-damage overlap owns this contact (we no-op, do not interfere).
      if (!this.isFrightened()) return;
      this.eatGhost(ghost);
    });
  }

  update(): void {
    const scene = this.scene;
    if (!scene) return;
    // New ghosts may stream in after attach — keep capturing unseen pens.
    this.captureUnseenPens();

    // Detect the fright-window EDGE. When __ghostMode leaves 'frightened' (the
    // GhostModeController timer-driven resume), reset the eat-chain to its base so
    // the next eaten ghost scores the first ladder value (200) again.
    const frightened = this.isFrightened();
    if (this.wasFrightened && !frightened) this.resetChain();
    this.wasFrightened = frightened;
  }

  /**
   * EAT one frightened ghost (the true gameplay seam — also the public drive verb):
   * score the next chain value, send the ghost HOME to its captured pen spawn, and
   * emit `ghost.eaten`. The ghost id is AUTO-DERIVED from its `__id`. Safe to call
   * directly (the overlap callback and the Test phase both drive it).
   */
  eatGhost(ghost: any): void {
    const scene = this.scene;
    if (!scene || !ghost || ghost.active === false || ghost.isDead) return;
    if (this.ghostKind && ghost.__kind !== this.ghostKind) return;

    // The next chain value (holds at the last ladder value once exhausted).
    const idx = Math.min(this.chainStep, this.chainValues.length - 1);
    const chainValue = this.chainValues[idx];
    this.chainStep += 1;

    // Score the eat through the single registry score source (also fires score.changed).
    addScore(scene, chainValue);

    // Send the ghost HOME to its pen spawn — it reappears at the pen in
    // __GAME__.entities (the enemies group sprite's x|y just jumped to the pen).
    const ghostId = (ghost.__id as string | undefined) ?? 'ghost';
    const pen = this.penById[ghostId];
    if (pen) this.sendToPen(ghost, pen.x, pen.y);

    this.bus?.emit('ghost.eaten', { ghostId, chainValue });
  }

  /**
   * Reset the eat-chain to its base (the public seam the fright-window end drives;
   * also directly drivable by the Test phase). The next eaten ghost scores the first
   * ladder value again. Emits `ghost.chainReset` with the value the chain stood at.
   */
  resetChain(): void {
    const atChainValue =
      this.chainValues[Math.min(this.chainStep, this.chainValues.length - 1)] ??
      this.chainValues[0];
    this.chainStep = 0;
    this.bus?.emit('ghost.chainReset', { atChainValue });
  }

  // ── pen + mode helpers ───────────────────────────────────────────────────────

  /** True while the shared maze mode is the frightened window. */
  private isFrightened(): boolean {
    return this.scene?.__ghostMode === this.frightenedMode;
  }

  /** Capture the pen spawn of any ghost we have not recorded yet (first-seen x|y). */
  private captureUnseenPens(): void {
    for (const ghost of this.ghosts()) {
      const id = (ghost.__id as string | undefined) ?? undefined;
      if (!id || this.penById[id]) continue;
      this.penById[id] = { x: ghost.x, y: ghost.y };
    }
  }

  /** Every active enemy sprite (the maze populates enemies only with ghosts). */
  private ghosts(): any[] {
    const group = this.scene?.enemies;
    if (!group?.getChildren) return [];
    return group.getChildren().filter((g: any) => g && g.active !== false);
  }

  /** Teleport an eaten ghost back to its pen spawn (keep the arcade body in sync). */
  private sendToPen(ghost: any, x: number, y: number): void {
    if (ghost.body?.reset) ghost.body.reset(x, y);
    else ghost.setPosition?.(x, y);
    ghost.x = x;
    ghost.y = y;
  }

  // ── component surface (the declared PUSH channel) ────────────────────────────

  /**
   * The two events this system publishes on the shared bus:
   *   - ghost.eaten     ← eatGhost()  (a frightened ghost is overlapped → home + score)
   *   - ghost.chainReset ← resetChain() (the fright window ended → chain back to base)
   * Each name has a real .emit() at its true seam above.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'ghost.eaten',
          payload: '{ghostId,chainValue}',
          scope: 'archetype',
          drivenBy:
            "evade — the player overlaps a ghost while scene.__ghostMode is 'frightened'",
          expect:
            'the ghost returns to its pen spawn in __GAME__.entities and __GAME__.score increases by the current chain value (200 then 400 then 800 then 1600 within the window); ghost.eaten logged',
        },
        {
          name: 'ghost.chainReset',
          payload: '{atChainValue}',
          scope: 'archetype',
          drivenBy: 'the frightened window ends (timer-driven, GhostModeController resume)',
          expect:
            'the eat-chain step returns to its base (the next eaten ghost scores 200 again); ghost.chainReset logged',
        },
      ],
    };
  }
}
