/**
 * SwitchGate — switch-opens-a-path: a floor switch the player activates (steps on
 * or hits) TOGGLES a bound barrier, opening a blocked passage — and, the bolder
 * form, opening one path while closing another (system, top_down:dungeon).
 *
 * The Zelda/A-Link-to-the-Past gimmick ("pressing switches opens some paths but
 * closes others", GMTK), as ONE scene-level system over the shared maze + the
 * obstacle group. A switch and its bound barriers are real, already-spawned
 * sprites tagged by `__id` in the scene (the switch in scene.obstacles/decorations,
 * each barrier a solid sprite in scene.obstacles with the standard player collider).
 * On the activate verb — the player's grid cell reaches the switch cell (step-on),
 * OR the public activate(switchId) seam is called (hit) — the system:
 *   - makes every bound 'opens' barrier NON-SOLID: disables its physics body (the
 *     group collider skips a disabled body, so the player walks through) and
 *     deactivates the sprite, so it LEAVES __GAME__.entities → the previously-blocked
 *     passage becomes reachable;
 *   - makes every bound 'closes' barrier SOLID: re-enables its body + reactivates
 *     the sprite, so it RE-APPEARS in __GAME__.entities and blocks again.
 * The reachable region in __GAME__.entities is exactly what changes — the observable
 * the contract names.
 *
 * It re-implements NOTHING the engine owns: the barrier is a real obstacle sprite
 * (the player<->obstacles collider is the scene's, wired once by BaseGameScene); a
 * non-solid barrier is the standard disabled-body + inactive-sprite seam (the same
 * one BombPlacement uses to retire a bomb), so it drops out of the hook's
 * collectEntities scan (which skips active === false). Step-on detection reuses
 * scene.__maze (worldToCell) — no second copy of the geometry.
 *
 * Observable transitions (__GAME__):
 *   activate (step on / hit the switch) → each 'opens' barrier leaves
 *     __GAME__.entities and its passage becomes walkable; each 'closes' barrier
 *     re-joins __GAME__.entities and re-blocks its passage.
 *
 * Params (all OPTIONAL — sensible declared defaults, never a baked game constant):
 *   switches    the switch manifest: [{ id, opens?, closes? }] — `id` is the switch
 *               sprite's __id (config param, the $custom config.id pattern); `opens`
 *               / `closes` are arrays of bound barrier __id strings (a string is
 *               accepted as a one-element array). Default [] → a clean no-op.
 *   reArmable   true ⇒ a switch can fire again after the player LEAVES its cell
 *               (a re-triggerable plate); false ⇒ it latches after the first
 *               activation (a one-shot switch). Default false.
 *
 * GENERIC: no game/theme, no coordinate, no count is baked — which switches exist
 * and what they bind comes from the DATA (params.switches[]); a board with no maze
 * grid, or no matching sprites, is a clean no-op.
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'SwitchGate',
  intent:
    'Switch-opens-a-path: the player activates a floor switch (steps on or hits it) to toggle a bound barrier — making each bound opens-barrier non-solid (it leaves __GAME__.entities, the passage becomes reachable) and, the bolder form, re-solidifying a paired closes-barrier. The Zelda dungeon "open one path, close another" gimmick over the shared maze + obstacle group.',
  attachesTo: 'scene',
  params: ['switches', 'reArmable'],
  roles: ['player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** One switch binding: its sprite __id + the barrier __ids it opens / closes. */
export interface SwitchBinding {
  id: string;
  /** barrier __ids made NON-SOLID when this switch activates. */
  opens?: string | string[];
  /** barrier __ids made SOLID when this switch activates (the bolder form). */
  closes?: string | string[];
}

export interface SwitchGateConfig {
  switches?: SwitchBinding[];
  reArmable?: boolean;
}

/** A resolved switch tracked by the system. */
interface LiveSwitch {
  id: string;
  opens: string[];
  closes: string[];
  /** true once activated (latch for a one-shot; cleared on cell-leave when reArmable). */
  activated: boolean;
  /** true while the player is standing on the cell (edge-detect step-on). */
  onCell: boolean;
}

export class SwitchGate implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly defs: SwitchBinding[];
  private readonly reArmable: boolean;

  /** Resolved switches by id (built in reset/attach). */
  private switches = new Map<string, LiveSwitch>();

  constructor(params: SwitchGateConfig = {}) {
    this.defs = Array.isArray(params.switches) ? params.switches : [];
    this.reArmable = params.reArmable ?? false;
  }

  /** Re-arm cleanly on a level restart: rebuild the switch latches from the DATA. */
  reset(): void {
    this.switches.clear();
    for (const def of this.defs) {
      if (!def || typeof def.id !== 'string') continue;
      this.switches.set(def.id, {
        id: def.id,
        opens: this.asArray(def.opens),
        closes: this.asArray(def.closes),
        activated: false,
        onCell: false,
      });
    }
  }

  attach(scene: any): void {
    this.scene = scene;
    if (this.switches.size === 0) this.reset(); // attach may run without a prior reset
  }

  /** No overlaps to wire — activation resolves by GRID cell (step-on) each tick. */
  setupCollisions(): void {}

  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    const grid = scene.__maze;
    const player = scene.player;
    if (!grid || !player || player.isDead) return; // no grid → can't step-on detect (no-op)

    const pc = grid.worldToCell(player.x, player.y);

    for (const sw of this.switches.values()) {
      const swSprite = this.findById(sw.id);
      if (!swSprite) continue; // switch not on this board → skip (no-op)
      const sc = grid.worldToCell(swSprite.x, swSprite.y);
      const onCell = pc.col === sc.col && pc.row === sc.row;

      // STEP-ON: fire on the press edge (player entered the cell), once per entry.
      if (onCell && !sw.onCell && !sw.activated) this.activateSwitch(sw);

      // A re-triggerable plate re-arms once the player leaves the cell.
      if (!onCell && sw.onCell && this.reArmable) sw.activated = false;

      sw.onCell = onCell;
    }
  }

  // ── the activate verb (public seam: step-on routes here; a "hit" calls it) ──

  /**
   * PUBLIC DRIVE SEAM — activate a switch by id (the "hit the switch" form, and the
   * unit seam a driver fires WITHOUT a full game). Idempotent for a non-reArmable
   * switch (the latch guards a re-fire). Unknown id → no-op (false). Returns true
   * iff this call performed the toggle.
   */
  activate(switchId: string): boolean {
    const sw = this.switches.get(switchId);
    if (!sw) return false;
    if (sw.activated && !this.reArmable) return false; // one-shot already fired
    this.activateSwitch(sw);
    return true;
  }

  /** Toggle the bound barriers + emit the switch.activated moment. */
  private activateSwitch(sw: LiveSwitch): void {
    sw.activated = true;

    const opened: string[] = [];
    const closed: string[] = [];

    for (const barrierId of sw.opens) {
      if (this.setBarrierSolid(barrierId, false)) opened.push(barrierId);
    }
    for (const barrierId of sw.closes) {
      if (this.setBarrierSolid(barrierId, true)) closed.push(barrierId);
    }

    // switch.activated — the bound 'opens' barriers are now non-solid (gone from
    // __GAME__.entities, their passages reachable) and any 'closes' barriers are
    // solid again (back in __GAME__.entities); the reachable region has changed.
    this.bus?.emit('switch.activated', {
      switchId: sw.id,
      opened,
      closed,
    });
    const swSprite = this.findById(sw.id);
    if (swSprite) this.scene.fireEffect?.('switch.activated', swSprite.x, swSprite.y);
  }

  // ── barrier solidity (the observable region change in __GAME__.entities) ────

  /**
   * Make a bound barrier sprite SOLID or NON-SOLID. NON-SOLID = disable its physics
   * body (the scene's player<->obstacles collider skips a disabled body, so the
   * player walks through) + deactivate the sprite (so it leaves __GAME__.entities,
   * which skips active === false). SOLID = the inverse. Returns true iff a matching
   * barrier sprite was found (so a board missing the barrier is a clean no-op).
   */
  private setBarrierSolid(barrierId: string, solid: boolean): boolean {
    const sprite = this.findById(barrierId);
    if (!sprite) return false;

    const body = sprite.body;
    if (body) {
      // enable/disable BOTH the collider participation and the body's update.
      if (typeof body.enable === 'boolean') body.enable = solid;
      if (typeof sprite.enableBody === 'function' && solid) {
        sprite.enableBody(false, sprite.x, sprite.y, true, true);
      }
    }
    // Active/visible drives __GAME__.entities membership (collectEntities skips
    // active === false) AND the rendered passage.
    sprite.setActive?.(solid);
    sprite.setVisible?.(solid);

    return true;
  }

  // ── small helpers ──────────────────────────────────────────────────────────

  /** Normalize an opens/closes field (string | string[] | undefined) to string[]. */
  private asArray(v: string | string[] | undefined): string[] {
    if (Array.isArray(v)) return v.filter((s) => typeof s === 'string');
    if (typeof v === 'string') return [v];
    return [];
  }

  /**
   * Find a tagged sprite by its __id across the scene groups the hook reads (the
   * switch lives in obstacles/decorations; a barrier is a solid obstacle). Searches
   * the standing groups generically — no game/theme, no coordinate.
   */
  private findById(id: string): any {
    const scene = this.scene;
    const groupNames = ['obstacles', 'decorations', 'collectibles', 'hazards', 'enemies'];
    for (const gname of groupNames) {
      const group = scene?.[gname];
      if (!group || typeof group.getChildren !== 'function') continue;
      for (const child of group.getChildren()) {
        if (child && child.__id === id) return child;
      }
    }
    return undefined;
  }

  // ── component surface (the declared PUSH-channel events this system emits) ──

  /**
   * The uniform component surface. Declares the one switch-gate moment this system
   * emits on the shared bus — a TRUE statement about the real emit site in this file:
   *   - switch.activated ← activateSwitch (the bound barriers are toggled: each
   *                        'opens' barrier goes non-solid + leaves __GAME__.entities,
   *                        each 'closes' barrier goes solid + re-joins it).
   * Observables stay on the existing __GAME__ entities adapter (the barrier sprites
   * are tagged + flip active), so this surface declares only the PUSH channel + no
   * anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'switch.activated',
          payload: '{switchId,opened,closed}',
          scope: 'archetype',
          drivenBy: 'use/interact — the player steps on (or hits) the switch',
          expect:
            "the bound 'opens' barriers become non-solid and leave __GAME__.entities (their passages reachable) and any 'closes' barriers become solid and re-join __GAME__.entities; switch.activated logged",
        },
      ],
    };
  }
}
