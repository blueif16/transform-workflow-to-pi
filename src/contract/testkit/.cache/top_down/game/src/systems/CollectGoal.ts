/**
 * CollectGoal — win when every dot/pellet is collected (BUILD — system, M5;
 * mirrors platformer's ScoreGateGoal / the maze clear-all-dots win).
 *
 * The maze-chase win (and any "collect them all" top-down genre): wire the
 * player<->reward overlap, consume each reward on touch (bump score, fire a
 * pickup effect, and — for a power pellet — call scene.frighten()), and set
 * status -> 'won' once NO collectible reward remains. It re-implements NOTHING the
 * engine owns: collection uses scene.consumeReward(), the win seam is
 * scene.onLevelComplete() (status:'won'), the reward set is scene.rewardsById.
 *
 * Drives ONE observable each tick by re-deriving from the LIVE world (not latched
 * until it actually fires) so a level RESTART re-arms cleanly:
 *   __GAME__.status -> 'won'  (when the last dot is gone)
 *   __GAME__.score  += per-dot points (via scene score helpers, generic)
 *
 * The power-pellet flip is GENERIC: a reward tagged entityKind === pelletKind
 * (default 'power_pellet') calls scene.frighten?.() (the GhostModeController hook)
 * on pickup; a maze with no controller is a clean no-op. No game/theme, no count,
 * no coordinate is baked — which rewards exist comes from the DATA.
 *
 * Params (all OPTIONAL):
 *   pelletKind    entityKind that triggers scene.frighten() (default 'power_pellet').
 *   dotPoints     score per ordinary dot (default 10).
 *   pelletPoints  score per power pellet (default 50).
 *   requireAtLeastOne  never auto-win on an EMPTY reward set (default true).
 *   pickupEffectEvent  event fired via scene.fireEffect on each pickup (default 'dot.collected').
 *   winEffectEvent     event fired via scene.fireEffect on the win (default 'level.won').
 */
import type { ISceneSystem } from '../scenes/topdown-data';

/** CAPABILITY sidecar (M3 registry reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'CollectGoal',
  intent:
    'Win (status->won) once every dot/pellet collectible is collected; wires the player<->reward pickup overlap, scores each, and flips ghosts to frightened on a power pellet (scene.frighten). The clear-all-dots maze win.',
  attachesTo: 'scene',
  params: [
    'pelletKind',
    'dotPoints',
    'pelletPoints',
    'requireAtLeastOne',
    'pickupEffectEvent',
    'winEffectEvent',
  ],
  roles: ['player', 'collectible'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface CollectGoalConfig {
  pelletKind?: string;
  dotPoints?: number;
  pelletPoints?: number;
  requireAtLeastOne?: boolean;
  pickupEffectEvent?: string;
  winEffectEvent?: string;
}

export class CollectGoal implements ISceneSystem {
  private scene: any;
  private won = false;
  private everHadReward = false;
  private readonly pelletKind: string;
  private readonly dotPoints: number;
  private readonly pelletPoints: number;
  private readonly requireAtLeastOne: boolean;
  private readonly pickupEffectEvent: string;
  private readonly winEffectEvent: string;

  constructor(params: CollectGoalConfig = {}) {
    this.pelletKind = params.pelletKind ?? 'power_pellet';
    this.dotPoints = params.dotPoints ?? 10;
    this.pelletPoints = params.pelletPoints ?? 50;
    this.requireAtLeastOne = params.requireAtLeastOne ?? true;
    this.pickupEffectEvent = params.pickupEffectEvent ?? 'dot.collected';
    this.winEffectEvent = params.winEffectEvent ?? 'level.won';
  }

  reset(): void {
    this.won = false;
    this.everHadReward = false;
  }

  attach(scene: any): void {
    this.scene = scene;
    // A collect-win never relies on the all-enemies-dead default.
    scene.suppressDefaultWin = true;
    if (this.remainingRewardCount() > 0) this.everHadReward = true;
  }

  /** Wire the player<->reward pickup overlap (player exists by setupCollisions). */
  setupCollisions(): void {
    const scene = this.scene;
    const player = scene?.player;
    const group = scene?.decorations;
    if (!player || !group) return;
    scene.physics.add.overlap(player, group, (_p: any, reward: any) => {
      this.collect(reward);
    });
  }

  update(): void {
    const scene = this.scene;
    if (!scene || this.won || scene.gameCompleted) return;
    const remaining = this.remainingRewardCount();
    if (remaining > 0) {
      this.everHadReward = true;
      return;
    }
    // An arena that never held a collectible is not "all collected".
    if (this.requireAtLeastOne && !this.everHadReward) return;
    this.win();
  }

  /** Consume one reward: score, fire pickup juice, and flip on a power pellet. */
  private collect(reward: any): void {
    if (!reward || reward.__consumed) return;
    const isPellet = reward.__kind === this.pelletKind;
    const points = isPellet ? this.pelletPoints : this.dotPoints;
    this.addScore(points);
    this.scene.fireEffect?.(this.pickupEffectEvent, reward.x, reward.y);
    this.scene.consumeReward?.(reward); // removes it from rewardsById + destroys
    if (isPellet) this.scene.frighten?.(); // GhostModeController hook (no-op if absent)
  }

  /** Count rewards still on the board (collectible kinds, not yet consumed). */
  private remainingRewardCount(): number {
    const map = this.scene?.rewardsById ?? {};
    let n = 0;
    for (const id of Object.keys(map)) {
      const r = map[id];
      if (r && r.active !== false && !r.__consumed) n += 1;
    }
    return n;
  }

  /** Add to the single score source (the registry 'score'), generic. */
  private addScore(points: number): void {
    const reg = this.scene?.registry;
    if (!reg) return;
    const cur = Number(reg.get('score') ?? 0);
    reg.set('score', cur + points);
  }

  /** One-shot win. Idempotent (the engine gameCompleted guard backs it up). */
  private win(): void {
    const scene = this.scene;
    if (this.won || scene.gameCompleted) return;
    this.won = true;
    scene.gameCompleted = true;
    scene.fireEffect?.(this.winEffectEvent, scene.player?.x, scene.player?.y);
    scene.onLevelComplete();
  }
}
