/**
 * HazardField — a NON-ENEMY threat-on-path (DR §3): a declared set of damaging
 * tile-regions (spike-trap / lava-pit floor) that hurt the player on OVERLAP,
 * independent of any enemy (system, top_down:maze-chase — SHARED with
 * top_down:dungeon, which binds it as the spike-trap/lava-pit floor).
 *
 * The Ryan Beattie "Hazards" spine (spike traps / lava pits) + the gamedeveloper
 * rising-lava on/off decision, as ONE scene-level system. The board declares its
 * danger cells as DATA (params.hazards[] — each {x,y,width,height,cycleMs?,damage?}):
 *   - a STATIC danger cell (no cycleMs) is permanently active — standing in it hurts.
 *   - a SWEEPING region (cycleMs > 0) toggles ACTIVE↔SAFE on its own timer, so the
 *     deadly window opens and closes (the rising-lava beat) — a player must time the
 *     crossing.
 *
 * It materializes each region exactly like RoomGateSystem's door + DestructibleGrid's
 * bricks: a static sprite tagged for __GAME__.entities (type 'hazard', id 'hazard_<i>'),
 * surfaced in the scene's `hazards` group — the SAME group the core hook scans
 * (templates/core/src/hook.ts collectEntities groupNames) — so a player (or the
 * harness) can READ the active hazard regions and route around them. Toggling a
 * region OFF disables its body + dims the sprite + drops its `active` flag, so an
 * inactive region neither strikes nor reads as a live threat.
 *
 * It re-implements NOTHING the engine owns: damage flows through the player's own
 * `takeDamage(damage)` seam (the same path BaseGameScene.setupContactDamage uses for
 * enemy contact), so the player's i-frames (isInvulnerable/isHurting) naturally TICK
 * the hurt rather than annihilate per-frame, and a LETHAL hazard runs the player's
 * `kill()` → the death/respawn seam (player.damaged on a non-lethal hit; player.died
 * via the scene on a lethal one — both already declared on the player surface). The
 * overlap is wired in setupCollisions() (the player exists by then) via the
 * order-guaranteeing utils.addOverlap, exactly like the contact-damage path.
 *
 * The two driving moments, at their true seams:
 *   - move → the player walks onto an ACTIVE hazard region (the overlap fires) →
 *     player.takeDamage(damage) + 'hazard.struck' {hazardId,damage}.
 *   - the cycle timer advances → a sweeping region flips active↔safe →
 *     'hazard.toggled' {hazardId,active}.
 *
 * Observable transitions (__GAME__):
 *   an ACTIVE hazard region is present in __GAME__.entities as type 'hazard' (the
 *       player can read + route around it); standing in it (move) drops
 *       __GAME__.player.health (or fires the death/respawn seam on a lethal hazard)
 *       and logs hazard.struck.
 *   a sweeping region's timer crosses cycleMs → its `active` flips; an OFF region
 *       has its body disabled (it no longer strikes); hazard.toggled logged.
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, never a baked game constant):
 *   hazards       the hazard manifest: each
 *                   { x, y, width, height, cycleMs?, damage? } — x/y is the TOP-LEFT
 *                 corner (the layout/wall convention), cycleMs is the on/off half-period
 *                 in ms (omit/0 → a permanently-active static cell), damage overrides the
 *                 default hurt for that region. Default [] (a clean no-op system).
 *   damage        default hurt applied per strike when a region omits its own (default 20).
 *   startActive   whether a sweeping region starts in its ACTIVE phase (default true).
 *   hazardColor   region tint when no hazard texture slot resolves (default 0xc0392b — lava red).
 *   hazardSlot    region sprite texture key (placeholder tinted rect when absent).
 *   inactiveAlpha sprite alpha while a region is toggled OFF (default 0.25 — telegraph the safe window).
 *
 * GENERIC: no game/theme, no coordinate, no count is baked — the hazards are the DATA
 * (params.hazards[]), each region id auto-derives from its INDEX in that manifest, and
 * a board with no hazards is a clean no-op.
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';
import * as utils from '../utils';

/** CAPABILITY sidecar (the registry discover.mjs reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'HazardField',
  intent:
    "A non-enemy threat-on-path (DR §3): materialize a declared set of damaging tile-regions (static danger cells and/or a region with a sweeping on/off cycle) that hurt the player on overlap independent of any enemy, applying the player's takeDamage/death seam while it stands in an ACTIVE region. Exposes the active hazard regions in __GAME__.entities (type 'hazard') so a player can route around them.",
  attachesTo: 'scene',
  params: ['hazards', 'damage', 'startActive', 'hazardColor', 'hazardSlot', 'inactiveAlpha'],
  roles: ['player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** One hazard region in the manifest: its rect (TOP-LEFT x/y), optional cycle + damage. */
export interface HazardSpec {
  /** TOP-LEFT x of the region (the layout/wall convention). */
  x: number;
  /** TOP-LEFT y of the region. */
  y: number;
  width: number;
  height: number;
  /** on/off half-period in ms; omit or 0 → a permanently-active static cell. */
  cycleMs?: number;
  /** hurt applied per strike for this region (falls back to the system `damage` default). */
  damage?: number;
}

export interface HazardFieldConfig {
  hazards?: HazardSpec[];
  damage?: number;
  startActive?: boolean;
  hazardColor?: number;
  hazardSlot?: string;
  inactiveAlpha?: number;
}

/** Runtime state for one materialized region (its spec + live sprite + cycle clock). */
interface LiveHazard {
  /** stable id auto-derived from the manifest index ('hazard_<i>'). */
  id: string;
  spec: HazardSpec;
  /** the on-board static sprite (in scene.hazards), tagged type 'hazard'. */
  sprite: any;
  /** the resolved per-region hurt. */
  damage: number;
  /** the on/off half-period in ms (0 → static, never toggles). */
  cycleMs: number;
  /** whether this region is CURRENTLY active (a deadly cell). */
  active: boolean;
  /** ms accumulated toward the next toggle (cyclic regions only). */
  elapsed: number;
}

export class HazardField implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly hazardsSpec: HazardSpec[];
  private readonly defaultDamage: number;
  private readonly startActive: boolean;
  private readonly hazardColor: number;
  private readonly hazardSlot?: string;
  private readonly inactiveAlpha: number;

  /** Live regions in declared order (sprite + cycle clock + active latch). */
  private hazards: LiveHazard[] = [];
  /** The static-group of hazard sprites (the group the core hook scans → type 'hazard'). */
  private hazardGroup: any = null;

  constructor(params: HazardFieldConfig = {}) {
    this.hazardsSpec = Array.isArray(params.hazards) ? params.hazards : [];
    this.defaultDamage = Math.max(0, params.damage ?? 20);
    this.startActive = params.startActive ?? true;
    this.hazardColor = params.hazardColor ?? 0xc0392b;
    this.hazardSlot = params.hazardSlot;
    this.inactiveAlpha = Math.min(1, Math.max(0, params.inactiveAlpha ?? 0.25));
  }

  /** Re-arm cleanly on a level restart: drop every hazard sprite + the group. */
  reset(): void {
    for (const h of this.hazards) h.sprite?.destroy?.();
    this.hazards = [];
    if (this.hazardGroup?.clear) this.hazardGroup.clear(true, true);
    this.hazardGroup = null;
  }

  attach(scene: any): void {
    this.scene = scene;

    // The group the core hook (collectEntities) scans for type-'hazard' entities, so
    // every active region shows in __GAME__.entities the moment it is materialized.
    this.hazardGroup = scene.physics.add.staticGroup();
    scene.hazards = this.hazardGroup;

    // Materialize every declared region as a tagged static sprite + its cycle clock.
    this.hazardsSpec.forEach((spec, i) => {
      const id = `hazard_${i}`;
      const cycleMs = Math.max(0, spec.cycleMs ?? 0);
      const hz: LiveHazard = {
        id,
        spec,
        sprite: this.spawnHazard(id, spec),
        damage: Math.max(0, spec.damage ?? this.defaultDamage),
        cycleMs,
        // a cyclic region starts in the configured phase; a static one is always active.
        active: cycleMs > 0 ? this.startActive : true,
        elapsed: 0,
      };
      this.applyActiveVisual(hz);
      this.hazards.push(hz);
    });
  }

  /** Wire the player→hazard overlap (the move-driven strike seam; player exists now). */
  setupCollisions(): void {
    const scene = this.scene;
    if (!scene || !scene.player || !this.hazardGroup) return;
    // Order-guaranteed overlap: the callback always gets (player, hazardSprite). The
    // SAME seam BaseGameScene.setupContactDamage uses for enemy contact.
    utils.addOverlap(scene, scene.player, this.hazardGroup, (_player: any, sprite: any) => {
      this.onPlayerOverlap(sprite);
    });
  }

  /** Per-frame: advance each sweeping region's on/off cycle (the toggle seam). */
  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    const dt = scene.game?.loop?.delta ?? 16;
    for (const hz of this.hazards) {
      if (hz.cycleMs <= 0) continue; // a static cell never toggles
      hz.elapsed += dt;
      if (hz.elapsed >= hz.cycleMs) {
        hz.elapsed -= hz.cycleMs;
        this.toggle(hz.id);
      }
    }
  }

  // ── move: the strike seam (hazard.struck) ────────────────────────────────────

  /**
   * The player overlapped a hazard sprite this frame. If the region is ACTIVE, hurt
   * the player (the takeDamage seam — its i-frames tick the damage / a lethal hazard
   * runs kill() → death/respawn) and fire 'hazard.struck'. An inactive region is a
   * clean no-op (the safe window).
   */
  private onPlayerOverlap(sprite: any): void {
    const hz = this.hazardById(sprite?.__id);
    if (!hz) return;
    this.strike(hz.id);
  }

  /**
   * Strike the player with a hazard region by id (the drivable verb seam — also called
   * directly by the test driver to fire hazard.struck WITHOUT a full traversal). Applies
   * the region's hurt through the player's own takeDamage (lethal → kill/respawn) and
   * fires the event. A no-op if the region is unknown, inactive, or there is no hurtable
   * player. The player's i-frames (isInvulnerable/isHurting) gate repeat ticks, so a
   * player standing in the region is hurt on a cadence, not annihilated per-frame.
   */
  strike(hazardId: string): void {
    const scene = this.scene;
    const hz = this.hazardById(hazardId);
    if (!scene || !hz || !hz.active) return;
    const player = scene.player;
    if (!player || player.isInvulnerable || player.isDead || player.isHurting) return;
    player.takeDamage?.(hz.damage); // drops player.health (or kill() → death/respawn on a lethal hazard)
    // hazard.struck — the player walked onto an active damaging region.
    this.bus?.emit('hazard.struck', { hazardId: hz.id, damage: hz.damage });
  }

  // ── cycle: the toggle seam (hazard.toggled) ──────────────────────────────────

  /**
   * Toggle (or set) a region's active state by id (the drivable verb seam — also called
   * from the per-frame cycle AND directly by the test driver to flip a region without
   * waiting a full cycleMs). Flips the `active` latch (or forces it when `active` is
   * given), enables/disables the body + dims the sprite to match, and fires
   * 'hazard.toggled'. A no-op if the region is unknown.
   */
  toggle(hazardId: string, active?: boolean): void {
    const scene = this.scene;
    const hz = this.hazardById(hazardId);
    if (!scene || !hz) return;
    hz.active = typeof active === 'boolean' ? active : !hz.active;
    this.applyActiveVisual(hz);
    // hazard.toggled — the region's on/off cycle flipped its deadly window.
    this.bus?.emit('hazard.toggled', { hazardId: hz.id, active: hz.active });
  }

  // ── hazard sprites (tagged static sprites in scene.hazards) ──────────────────

  /**
   * Spawn one region as a static sprite tagged so it shows in __GAME__.entities as
   * type 'hazard' with its auto-derived id. A texture key tiles when it resolves; else
   * a tinted placeholder rect. Mirrors RoomGateSystem.spawnDoor / DestructibleGrid.
   */
  private spawnHazard(id: string, spec: HazardSpec): any {
    const scene = this.scene;
    const w = Math.max(4, spec.width ?? 32);
    const h = Math.max(4, spec.height ?? 32);
    const cx = (spec.x ?? 0) + w / 2;
    const cy = (spec.y ?? 0) + h / 2;
    const hasTex = !!this.hazardSlot && scene.textures?.exists?.(this.hazardSlot);
    const sprite = scene.physics.add.staticSprite(cx, cy, hasTex ? this.hazardSlot : '__px');
    sprite.setDisplaySize?.(w, h);
    if (!hasTex) {
      if (!scene.textures?.exists?.('__px')) {
        scene.textures?.generate?.('__px', { data: ['1'], pixelWidth: 8 });
      }
      sprite.setTexture?.('__px');
      sprite.setTint?.(this.hazardColor);
    }
    sprite.refreshBody?.();
    sprite.__type = 'hazard';
    sprite.__id = id;
    this.hazardGroup?.add?.(sprite);
    return sprite;
  }

  /**
   * Reflect a region's active state on its sprite + body: an ACTIVE region is solid +
   * full-alpha (a live threat read in __GAME__.entities); an OFF region has its body
   * disabled (it no longer strikes the overlap) + is dimmed to telegraph the safe window.
   */
  private applyActiveVisual(hz: LiveHazard): void {
    const sprite = hz.sprite;
    if (!sprite) return;
    if (sprite.body) sprite.body.enable = hz.active;
    sprite.setAlpha?.(hz.active ? 1 : this.inactiveAlpha);
  }

  /** The live region with this id, or undefined. */
  private hazardById(id: unknown): LiveHazard | undefined {
    if (typeof id !== 'string') return undefined;
    return this.hazards.find((h) => h.id === id);
  }

  // ── component surface (the declared PUSH-channel events this system emits) ────

  /**
   * The uniform component surface. Declares the two hazard moments this system emits
   * on the shared bus — each a TRUE statement about a real emit site in this file:
   *   - hazard.struck  ← strike   (the player walked onto an active region via the
   *                                move/overlap seam: player.health drops or the
   *                                death/respawn seam fires)
   *   - hazard.toggled ← toggle   (the on/off cycle advanced: a region's active state
   *                                flipped, changing whether a player in it is struck)
   * The active-region presence is observable on the existing __GAME__.entities adapter
   * (each region is a tagged sprite in scene.hazards), so this surface declares only
   * the PUSH channel + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'hazard.struck',
          payload: '{hazardId,damage}',
          scope: 'archetype',
          drivenBy: 'move — the player walks onto an active hazard tile-region',
          expect:
            "the player takes the hazard's damage (__GAME__.player.health drops, or the death/respawn seam fires on a lethal hazard) at the frame of overlap; hazard.struck logged",
        },
        {
          name: 'hazard.toggled',
          payload: '{hazardId,active}',
          scope: 'archetype',
          drivenBy: "the hazard's on/off cycle advances (a sweeping region activates or deactivates)",
          expect:
            "the region's active state flips (an active region becomes safe or vice-versa, changing whether a player standing in it is struck); hazard.toggled logged",
        },
      ],
    };
  }
}
