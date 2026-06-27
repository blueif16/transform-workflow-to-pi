/**
 * BossPhases — a boss enemy whose attack/behavior pattern FLIPS as its HP fraction
 * crosses declared thresholds, so the fight escalates in stages and clearing the boss
 * is the run/room CAPSTONE (system, top_down — SHARED with top_down:dungeon, where it
 * is the metazelda/Boss-Keys boss-room fight that advances the dungeon). The depth a
 * single trash mob can never give: a multi-phase boss whose pressure RATCHETS as you
 * wear it down.
 *
 * The escalation (the contract, made observable):
 *   - The system binds ONE boss enemy (the `bossId` config, else the first enemy
 *     tagged role/kind 'boss'). Every hit on that boss arrives as the engine's
 *     standardized `enemy.damaged` ({id,x,y,health,damage}); from `health/maxHealth`
 *     the system re-derives the boss's live HP FRACTION each hit (1 → 0).
 *   - `phaseThresholds` are descending HP fractions (default [0.66, 0.33]). When the
 *     fraction crosses one DOWNWARD, the system advances to the next phase: it bumps
 *     `scene.bossPhase` (monotonic, 0..N) and SWAPS the boss's active behavior params
 *     for that phase's `phaseParams` set — e.g. a faster fire cadence (lower
 *     RangedAttack.cooldown), a faster chase (higher ChaseAI/Separation speed), or any
 *     numeric behavior field — so the boss MEASURABLY shifts. It emits
 *     `boss.phaseChanged` {phase,hpFraction} at this true threshold-cross seam.
 *   - When the boss's HP reaches 0 in its final phase the capstone is CLEARED: the boss
 *     leaves the world (its `kill()` removes it from scene.enemies / __GAME__.entities)
 *     and the system emits `boss.defeated` {bossId} — the moment a goal system reads to
 *     win/advance. `scene.bossPhase` holds its final value.
 *
 * It re-implements NOTHING the engine owns: the hit moment is the engine's own
 * `enemy.damaged` seam (BaseEnemy.takeDamage → eventBus.emit('enemy.damaged')); the
 * boss HP is the engine's `health`/`maxHealth` on the bound sprite; the kill is the
 * engine's `enemy.died` (BaseGameScene.onEnemyKilled) which we also subscribe to as a
 * second confirmation of removal. The boss id auto-derives from the bound sprite's
 * __id. The live phase is published on scene.bossPhase AND the registry 'bossPhase'
 * key so the __GAME__ hook can surface it.
 *
 * DRIVE SEAM (so Integrate can wire it + a unit test can fire it WITHOUT a full game):
 * attach() subscribes `advancePhase` to the scene's enemy.damaged; the public
 * `advancePhase(payload)` is also the direct verb — call it with an enemy.damaged-shaped
 * payload ({id,health}) for the bound boss to re-derive the fraction, flip params on a
 * downward threshold cross, and fire the events. (Mirrors ComboMultiplier.registerKill
 * as both the subscriber and the public drive verb.)
 *
 * GENERIC: no game/theme, no boss coordinate, no baked HP total — the thresholds + the
 * per-phase param sets are PARAMS, the fraction is DERIVED from the live health, and a
 * board with no boss (no matching enemy) is a clean no-op. Restart re-arms via reset().
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, never a baked game constant):
 *   bossId          the __id of the boss to bind; default undefined → the first enemy
 *                   whose __kind/__type/role is 'boss' (else the first enemy at all).
 *   phaseThresholds descending HP FRACTIONS that open each later phase (default
 *                   [0.66, 0.33]): below 0.66 → phase 1, below 0.33 → phase 2. Phase 0
 *                   is the opening phase before any cross.
 *   phaseParams     per-phase behavior-param overrides applied on entering that phase,
 *                   index-aligned to `phaseThresholds`. Each entry is
 *                   { behavior?: '<name>', set: { <field>: <number> } } applied to the
 *                   boss's matching bound behavior (by behavior class/instance name; when
 *                   `behavior` is omitted, applied to EVERY bound behavior that has the
 *                   field). Default [{ set: { cooldown: 0.6 } }, { set: { cooldown: 0.35 } }]
 *                   read as a MULTIPLIER on the captured base value (faster fire each phase).
 *   paramMode       'multiply' (default — phaseParams values scale the captured base) or
 *                   'absolute' (the value is assigned directly). Multiply keeps it
 *                   tuning-free (0.6 = 60% of base cadence = faster fire).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (registry/discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'BossPhases',
  intent:
    "Bind a boss enemy whose attack/behavior pattern flips as its HP fraction crosses declared thresholds: on each downward cross bump scene.bossPhase and swap the boss's active behavior params (faster fire / faster chase). Clearing the boss (HP 0) is the run/room capstone — emits boss.phaseChanged + boss.defeated.",
  attachesTo: 'scene',
  params: ['bossId', 'phaseThresholds', 'phaseParams', 'paramMode'],
  roles: ['enemy', 'boss'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** One per-phase behavior-param override applied on entering that phase. */
export interface BossPhaseParam {
  /** Bound-behavior name to target (class/instance name); omit → every behavior with the field. */
  behavior?: string;
  /** field → number applied (multiplier on the captured base, or absolute — see paramMode). */
  set: Record<string, number>;
}

export interface BossPhasesConfig {
  /** __id of the boss to bind; default → the first enemy tagged 'boss' (else the first enemy). */
  bossId?: string;
  /** Descending HP FRACTIONS that open each later phase (default [0.66, 0.33]). */
  phaseThresholds?: number[];
  /** Per-phase behavior-param overrides, index-aligned to phaseThresholds. */
  phaseParams?: BossPhaseParam[];
  /** 'multiply' (default — scale the captured base) | 'absolute' (assign directly). */
  paramMode?: 'multiply' | 'absolute';
}

export class BossPhases implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly bossId?: string;
  /** Thresholds sorted DESCENDING (0.66 before 0.33) so a deeper phase always wins. */
  private readonly thresholds: number[];
  private readonly phaseParams: BossPhaseParam[];
  private readonly paramMode: 'multiply' | 'absolute';

  /** The bound boss sprite (resolved lazily; null = no boss on this board → no-op). */
  private boss: any = null;
  /** The boss maxHealth captured at bind (the denominator of the HP fraction). */
  private maxHealth = 0;
  /** The highest phase ENTERED so far (0 = opening); monotonic — only ever increases. */
  private phase = 0;
  /** Captured base values of every behavior field we mutate, so multiply/reset are exact. */
  private baseFields = new Map<string, number>();
  /** Latched once boss.defeated has fired so it fires exactly once. */
  private defeated = false;
  /** Unsubscribe handles for the bus subscriptions (cleared on reset/onDetach). */
  private unsubs: Array<() => void> = [];

  constructor(params: BossPhasesConfig = {}) {
    this.bossId = params.bossId;
    // Sort DESCENDING + clamp to (0,1] so index 0 is the FIRST (shallowest) phase.
    const t = (params.phaseThresholds && params.phaseThresholds.length > 0
      ? params.phaseThresholds
      : [0.66, 0.33]
    )
      .map((n) => Math.min(1, Math.max(0, n)))
      .filter((n) => n > 0 && n < 1)
      .sort((a, b) => b - a);
    this.thresholds = t.length > 0 ? t : [0.66, 0.33];
    const defaults: BossPhaseParam[] = [{ set: { cooldown: 0.6 } }, { set: { cooldown: 0.35 } }];
    const pp = params.phaseParams && params.phaseParams.length > 0 ? params.phaseParams : defaults;
    // Index-align to thresholds: pad with the last entry if short, truncate if long.
    this.phaseParams = this.thresholds.map((_v, i) => pp[i] ?? pp[pp.length - 1] ?? { set: {} });
    this.paramMode = params.paramMode === 'absolute' ? 'absolute' : 'multiply';
  }

  /** Re-arm to phase 0 + restore every mutated base value so a restarted boss starts fresh. */
  reset(): void {
    this.restoreBaseFields();
    for (const off of this.unsubs) off();
    this.unsubs = [];
    this.boss = null;
    this.maxHealth = 0;
    this.phase = 0;
    this.baseFields.clear();
    this.defeated = false;
  }

  attach(scene: any): void {
    this.scene = scene;
    this.resolveBoss();
    // Publish phase 0 immediately so __GAME__/HUD read 0 from frame 0.
    this.publishPhase();
    const bus = scene?.eventBus;
    if (bus && typeof bus.on === 'function') {
      // Every standardized non-lethal hit re-derives the boss HP fraction + may flip a phase.
      this.unsubs.push(bus.on('enemy.damaged', (payload: any) => this.advancePhase(payload)));
      // The standardized kill seam is a second confirmation the boss left the world.
      this.unsubs.push(bus.on('enemy.died', (payload: any) => this.onEnemyDied(payload)));
    }
  }

  /** No overlaps to wire — phases are driven by the consumed hit events. */
  setupCollisions(): void {}

  /**
   * Per-frame: late-bind the boss if it spawned after attach, and catch the capstone
   * defensively if the boss died via a path that didn't route enemy.damaged (e.g. an
   * instant-kill). Cheap — a no-op once defeated or with no boss.
   */
  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted || this.defeated) return;
    if (!this.boss) this.resolveBoss();
    if (!this.boss) return;
    // If the bound boss is gone/dead but we never fired the capstone, fire it now.
    if (this.boss.isDead === true || this.boss.active === false) this.defeat();
  }

  /**
   * Register ONE hit on the boss — the public drive verb (also the enemy.damaged
   * subscriber). Re-derives the boss HP fraction from the payload health (or the live
   * sprite), advances every phase whose threshold the fraction has now crossed downward
   * (each emits boss.phaseChanged + swaps that phase's behavior params), and fires the
   * boss.defeated capstone when the fraction reaches 0. Ignores hits on non-boss enemies.
   *
   * @param payload the consumed enemy.damaged payload ({id,health,damage,…}).
   */
  public advancePhase(payload?: any): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted || this.defeated) return;
    if (!this.boss) this.resolveBoss();
    if (!this.boss) return;

    // Only the BOUND boss's hits drive phases. Match by the payload id when present.
    const hitId = payload && typeof payload === 'object' ? payload.id : payload;
    const bossId = this.boss.__id;
    if (hitId !== undefined && bossId !== undefined && hitId !== bossId) return;

    const fraction = this.hpFraction(payload);

    // Enter every phase whose threshold the fraction has now crossed downward, in order
    // (so a single big hit that skips a phase still fires each crossed phase's moment).
    let target = this.phaseFor(fraction);
    while (this.phase < target) {
      this.phase += 1;
      this.applyPhaseParams(this.phase);
      this.publishPhase();
      this.bus?.emit('boss.phaseChanged', {
        phase: this.phase,
        hpFraction: Number(fraction.toFixed(4)),
      });
    }

    // The capstone: HP reached 0 in the final phase → the boss is cleared.
    if (fraction <= 0) this.defeat();
  }

  /**
   * The enemy.died subscriber: if the BOUND boss is the one that died, fire the capstone
   * (the kill path that didn't necessarily route a final enemy.damaged). De-duped by the
   * `defeated` latch so boss.defeated fires exactly once.
   */
  private onEnemyDied(payload?: any): void {
    if (this.defeated || !this.boss) return;
    const diedId = payload && typeof payload === 'object' ? payload.id : payload;
    const bossId = this.boss.__id;
    if (diedId !== undefined && bossId !== undefined && diedId !== bossId) return;
    this.defeat();
  }

  /** Fire the boss.defeated capstone once (the goal system reads this to win/advance). */
  private defeat(): void {
    if (this.defeated) return;
    this.defeated = true;
    const bossId = this.boss?.__id ?? this.bossId ?? 'boss';
    this.bus?.emit('boss.defeated', { bossId });
    this.scene.fireEffect?.('boss.defeated', this.boss?.x, this.boss?.y);
  }

  // ── phase math + param swaps ─────────────────────────────────────────────────

  /**
   * The deepest phase the HP fraction has crossed: thresholds are DESCENDING, so
   * phase N = the count of thresholds the fraction is strictly BELOW. e.g.
   * thresholds [0.66,0.33], fraction 0.5 → phase 1; fraction 0.2 → phase 2; 0.8 → 0.
   */
  private phaseFor(fraction: number): number {
    let p = 0;
    for (const th of this.thresholds) {
      if (fraction < th) p += 1;
      else break;
    }
    return p;
  }

  /** Re-derive the boss HP fraction from the payload health (preferred) or the live sprite. */
  private hpFraction(payload?: any): number {
    const max = this.maxHealth > 0 ? this.maxHealth : Number(this.boss?.maxHealth) || 0;
    if (max <= 0) return 1;
    const h =
      payload && typeof payload === 'object' && typeof payload.health === 'number'
        ? payload.health
        : Number(this.boss?.health);
    if (!Number.isFinite(h)) return 1;
    return Math.min(1, Math.max(0, h / max));
  }

  /**
   * Apply phase `p`'s behavior-param overrides to the boss's bound behaviors. For each
   * { behavior?, set } entry, find the matching bound behavior(s) and set each field —
   * capturing the BASE value the first time so 'multiply' scales the original and reset()
   * can restore it. This is the MEASURABLE shift: e.g. RangedAttack.cooldown drops so the
   * boss fires faster, or a movement behavior's speed rises so it chases harder.
   */
  private applyPhaseParams(p: number): void {
    const spec = this.phaseParams[p - 1];
    if (!spec || !spec.set) return;
    const behaviors = this.bossBehaviors();
    for (const beh of behaviors) {
      if (!beh) continue;
      const name = beh.constructor?.name ?? '';
      if (spec.behavior && name !== spec.behavior) continue;
      for (const field of Object.keys(spec.set)) {
        if (typeof (beh as any)[field] !== 'number') continue; // only mutate real numeric fields
        const key = `${name}#${field}`;
        if (!this.baseFields.has(key)) this.baseFields.set(key, Number((beh as any)[field]));
        const base = this.baseFields.get(key) ?? Number((beh as any)[field]);
        const v = spec.set[field];
        (beh as any)[field] = this.paramMode === 'absolute' ? v : base * v;
      }
    }
  }

  /** Restore every captured base field on the boss's behaviors (reset path). */
  private restoreBaseFields(): void {
    const behaviors = this.bossBehaviors();
    for (const beh of behaviors) {
      const name = beh?.constructor?.name ?? '';
      for (const [key, base] of this.baseFields) {
        const [behName, field] = key.split('#');
        if (behName === name && typeof (beh as any)[field] === 'number') {
          (beh as any)[field] = base;
        }
      }
    }
  }

  // ── resolution + publishing (read the live world, generic) ───────────────────

  /**
   * Bind the boss: the enemy whose __id === bossId, else the first enemy tagged
   * role/kind 'boss' (__kind/__type/role/__role), else (no boss tag anywhere) the first
   * enemy. Captures its maxHealth. Idempotent — once bound it short-circuits.
   */
  private resolveBoss(): void {
    const group = this.scene?.enemies;
    if (!group || typeof group.getChildren !== 'function') return;
    const enemies = group.getChildren() as any[];
    let chosen: any = null;
    if (this.bossId) {
      chosen = enemies.find((e) => e && e.__id === this.bossId) ?? null;
    }
    if (!chosen) {
      chosen = enemies.find((e) => e && this.isBossTagged(e)) ?? null;
    }
    if (!chosen && !this.bossId) {
      chosen = enemies[0] ?? null; // single-enemy room: that enemy IS the boss.
    }
    if (chosen) {
      this.boss = chosen;
      this.maxHealth = Number(chosen.maxHealth) || Number(chosen.health) || 0;
    }
  }

  /** True when a sprite is tagged as the boss role across the engine's tag conventions. */
  private isBossTagged(e: any): boolean {
    const tags = [e.__kind, e.__type, e.role, e.__role];
    return tags.some((t) => typeof t === 'string' && t.toLowerCase() === 'boss');
  }

  /** The boss's bound behaviors (the BehaviorManager getAll), or [] if none. */
  private bossBehaviors(): any[] {
    const mgr = this.boss?.behaviors;
    if (mgr && typeof mgr.getAll === 'function') return mgr.getAll() as any[];
    return [];
  }

  /** Mirror the live phase onto the scene field + registry the __GAME__ hook reads. */
  private publishPhase(): void {
    this.scene.bossPhase = this.phase;
    this.scene.registry?.set?.('bossPhase', this.phase);
  }

  /** Tear the subscriptions down (engine seam; also covered by reset). */
  public onDetach(): void {
    for (const off of this.unsubs) off();
    this.unsubs = [];
  }

  // ── component surface (the declared PUSH-channel events this system emits) ────

  /**
   * The uniform component surface. Declares the TWO boss moments this system emits on
   * the shared bus — TRUE statements about the real emit sites:
   *   - boss.phaseChanged ← advancePhase (a hit drops the boss HP fraction below a
   *                         declared threshold; bossPhase bumps + behavior params swap).
   *   - boss.defeated     ← defeat (the boss HP reaches 0 in its final phase; the boss
   *                         leaves __GAME__.entities — the run/room capstone).
   * Observables stay on the existing __GAME__ entities/registry adapter (scene.bossPhase
   * is mirrored to the registry), so this surface declares only the PUSH channel.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'boss.phaseChanged',
          payload: '{phase,hpFraction}',
          scope: 'archetype',
          drivenBy: "shoot/attack — the boss's HP fraction crosses a declared threshold downward",
          expect:
            "scene.bossPhase increments and the boss's active attack params change (a measurable shift — e.g. faster fire cadence / a new behavior speed on the boss entity in __GAME__.entities); boss.phaseChanged logged",
        },
        {
          name: 'boss.defeated',
          payload: '{bossId}',
          scope: 'archetype',
          drivenBy: "shoot/attack — the boss's HP reaches 0 in its final phase",
          expect:
            'the boss leaves __GAME__.entities and scene.bossPhase reads its final value; the capstone is cleared (the goal system reads this to win/advance); boss.defeated logged',
        },
      ],
    };
  }
}
