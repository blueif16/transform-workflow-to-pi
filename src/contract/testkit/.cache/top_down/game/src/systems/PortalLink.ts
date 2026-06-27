/**
 * PortalLink — paired board-teleport portals for a dungeon (BUILD — system;
 * top_down:dungeon). A focused, player-only sibling of WarpTunnel: it materializes
 * declared PORTAL PAIRS and, when the player steps onto a portal mouth, teleports
 * them across the board to the PAIRED portal's mouth — so the dungeon's rooms
 * interconnect into a non-linear graph instead of a corridor chain (metazelda's
 * "graphify" phase: randomly links neighbouring rooms so the graph is not a simple
 * tree; the Zelda warp-tile).
 *
 * ONE mechanic, driven by the MOVE verb (the player's center crossing onto a
 * declared portal mouth):
 *
 *  PAIRED TELEPORT. The board declares portal PAIRS (params.portals[]). Each pair is
 *  two mouths {a:{x,y}, b:{x,y}} (world px). Stepping onto mouth a teleports the
 *  player to mouth b (and b → a) — player.x/player.y JUMPS across the board (a
 *  measurable position discontinuity surfaced on __GAME__.player.x|y). The two
 *  mouths are spawned as tagged sprites in scene.decorations, so the pair shows in
 *  __GAME__.entities as type 'portal' (id portal_<pairIndex>_a / portal_<pairIndex>_b).
 *
 *  RE-ENTRY GUARD. After a teleport the player lands ON the destination mouth; a
 *  per-pair guard (params.guardMs, scene-clock ms) suppresses any further teleport
 *  for that window, so the player does not ping-pong between the two mouths. The
 *  guard re-arms once it lapses (the player can use the portal again).
 *
 * Observable transitions (__GAME__):
 *   the player steps onto a portal mouth → player.x|y jumps to the paired mouth's
 *     coordinates (a board-spanning discontinuity); entity.teleported logged with
 *     {portalId, toX, toY}; an immediate bounce-back is suppressed for guardMs.
 *
 * The portalId in the payload is AUTO-DERIVED from the crossed mouth's index in the
 * declared portals[] manifest (portal_<pairIndex>_<a|b>); guardMs IS a config param.
 *
 * It owns NO win and NO score; it only repositions the player and spawns the two
 * marker sprites. A board that declares no portals is a clean no-op. Composes with
 * RoomGateSystem / KeyDoorLock — a portal mouth may sit behind a gated room (the
 * gate blocks the cell until cleared; PortalLink only acts on the player's live
 * position, so a still-blocked mouth is simply never reached).
 *
 * Params (all OPTIONAL — sensible declared defaults, no baked game/theme/coordinate):
 *   portals   the declared portal PAIRS. Each pair is {a:{x,y}, b:{x,y}} — two mouth
 *             CENTERS in world px. Default [] → no portals (clean no-op).
 *   radius    the mouth trigger radius (world px): the player teleports when its
 *             center is within `radius` of a mouth center (default 28 — roughly a
 *             half-tile forgiving step-on radius). Clamped to >= 1.
 *   guardMs   the re-entry guard window (scene-clock ms) after a teleport, during
 *             which that pair will not teleport again — prevents the ping-pong
 *             bounce-back (default 600). Clamped to >= 0.
 *   slot      the optional texture slot for the portal marker sprites (default
 *             undefined → a tinted placeholder rect).
 *   tint      the placeholder tint when no slot resolves (default 0x6a3df0 — a
 *             portal violet).
 *   size      the marker display size in px (default 28).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** A single portal mouth: a CENTER point in world px. */
export interface PortalMouth {
  /** Mouth center X (world px). */
  x: number;
  /** Mouth center Y (world px). */
  y: number;
}

/** A paired portal: stepping onto `a` teleports to `b`, and onto `b` teleports to `a`. */
export interface PortalPair {
  a: PortalMouth;
  b: PortalMouth;
}

export interface PortalLinkConfig {
  /** The declared portal mouth PAIRS (default [] → no portals). */
  portals?: PortalPair[];
  /** Mouth trigger radius in world px (default 28; clamped to >= 1). */
  radius?: number;
  /** Re-entry guard window in scene-clock ms after a teleport (default 600; clamped to >= 0). */
  guardMs?: number;
  /** Optional texture slot for the portal marker sprites (default undefined → placeholder). */
  slot?: string;
  /** Placeholder tint when no slot resolves (default 0x6a3df0). */
  tint?: number;
  /** Marker display size in px (default 28). */
  size?: number;
}

/** CAPABILITY sidecar (the registry's discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'PortalLink',
  intent:
    'Paired board-teleport portals for a dungeon: stepping onto portal A teleports the player to portal B mouth (and B→A), with a re-entry guard so the player does not ping-pong. Materializes the portal pair as tagged sprites in __GAME__.entities (type "portal") and interconnects the rooms into a non-linear graph; emits entity.teleported at the crossing seam. A focused player-only sibling of WarpTunnel.',
  attachesTo: 'scene',
  params: ['portals', 'radius', 'guardMs', 'slot', 'tint', 'size'],
  roles: ['player'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** A live portal mouth resolved from the declared pair: its world center + a stable id. */
interface LiveMouth {
  /** Mouth center X (world px). */
  x: number;
  /** Mouth center Y (world px). */
  y: number;
  /** Auto-derived id: portal_<pairIndex>_<a|b>. */
  id: string;
  /** Index of the pair this mouth belongs to (the guard is keyed per pair). */
  pairIndex: number;
  /** The PAIRED mouth (where the player lands when it steps on THIS one). */
  dest: PortalMouth;
}

export class PortalLink implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly portals: PortalPair[];
  private readonly radius: number;
  private readonly guardMs: number;
  private readonly slot: string | undefined;
  private readonly tint: number;
  private readonly size: number;

  /** The flattened mouths (two per declared pair), resolved once at attach. */
  private readonly mouths: LiveMouth[] = [];
  /** The spawned marker sprites (kept so reset() can clear them on a restart). */
  private readonly markers: any[] = [];
  /**
   * Per-pair re-entry guard: the scene-clock ms (scene.time.now) UNTIL which that pair
   * will not teleport again. Suppresses the immediate bounce-back after a teleport.
   */
  private readonly guardUntil = new Map<number, number>();

  constructor(params: PortalLinkConfig = {}) {
    this.portals = Array.isArray(params.portals) ? params.portals.filter(isPair) : [];
    const r = Number(params.radius);
    this.radius = Number.isFinite(r) && r >= 1 ? r : 28;
    const g = Number(params.guardMs);
    this.guardMs = Number.isFinite(g) && g >= 0 ? g : 600;
    this.slot = typeof params.slot === 'string' && params.slot ? params.slot : undefined;
    const t = Number(params.tint);
    this.tint = Number.isFinite(t) ? t : 0x6a3df0;
    const s = Number(params.size);
    this.size = Number.isFinite(s) && s > 0 ? s : 28;
  }

  /** Re-arm cleanly on a level restart: drop every guard + the resolved/spawned mouths. */
  reset(): void {
    this.guardUntil.clear();
    for (const m of this.markers) m?.destroy?.();
    this.markers.length = 0;
    this.mouths.length = 0;
  }

  /**
   * Resolve the declared pairs into flat live mouths and SPAWN the two marker sprites
   * per pair (tagged type 'portal' in scene.decorations → visible in __GAME__.entities).
   */
  attach(scene: any): void {
    this.scene = scene;
    this.mouths.length = 0;
    for (let i = 0; i < this.portals.length; i++) {
      const { a, b } = this.portals[i];
      this.mouths.push({ x: a.x, y: a.y, id: `portal_${i}_a`, pairIndex: i, dest: b });
      this.mouths.push({ x: b.x, y: b.y, id: `portal_${i}_b`, pairIndex: i, dest: a });
      this.spawnMarker(a.x, a.y, `portal_${i}_a`);
      this.spawnMarker(b.x, b.y, `portal_${i}_b`);
    }
  }

  /** No overlaps to wire — the step-on test is recomputed from the live player each tick. */
  setupCollisions(): void {}

  /** Per-frame tick: re-run the portal step-on check against the live player. */
  update(): void {
    this.move();
  }

  // ── the player teleport (driven by the MOVE verb) ────────────────────────────

  /**
   * The MOVE-verb seam — the drivable unit seam. Test/Integrate relocate the player
   * (player.x/player.y) and call move() to apply one step of the portal check WITHOUT
   * a full game loop. If the player's center is on a portal mouth (within `radius`)
   * and that pair is not guarded, TELEPORT the player to the paired mouth and emit
   * entity.teleported (the true crossing seam). Returns the portalId stepped on, or
   * null if no teleport occurred this step.
   */
  move(): string | null {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return null;
    if (this.mouths.length === 0) return null; // no portals declared → clean no-op

    const player = scene.player;
    if (!player || player.active === false) return null;

    const mouth = this.mouthAt(player.x, player.y);
    if (!mouth) return null; // not on any mouth

    // The re-entry guard: a freshly-used pair is suppressed until guardUntil lapses,
    // so the player landing on the destination mouth does not bounce straight back.
    const now = this.nowMs();
    const until = this.guardUntil.get(mouth.pairIndex) ?? 0;
    if (now < until) return null;

    return this.teleport(player, mouth, now);
  }

  /**
   * Teleport the player to the mouth's PAIRED mouth and emit the crossing event.
   * Arms the per-pair guard for guardMs so the landing does not immediately bounce
   * back. player.x/player.y JUMPS to the destination — a board-spanning discontinuity
   * observable on __GAME__.player.x|y.
   */
  private teleport(player: any, mouth: LiveMouth, now: number): string {
    const toX = mouth.dest.x;
    const toY = mouth.dest.y;
    this.reposition(player, toX, toY);
    this.guardUntil.set(mouth.pairIndex, now + this.guardMs);

    // The step-on is the true gameplay seam: the player's x|y just JUMPED across the
    // board to the paired portal mouth. Surfaces on __GAME__.player.x|y; logged on the bus.
    this.bus?.emit('entity.teleported', { portalId: mouth.id, toX, toY });
    this.scene.fireEffect?.('entity.teleported', toX, toY);
    return mouth.id;
  }

  // ── geometry + spawn (read/write the live world, generic) ────────────────────

  /**
   * The portal mouth (if any) whose center is within `radius` of the world point
   * (x,y). Returns the FIRST match, else null. A radial step-on test on the mouth
   * center (the player steps ONTO the mouth, so a center-distance test, not an AABB).
   */
  private mouthAt(x: number, y: number): LiveMouth | null {
    const r2 = this.radius * this.radius;
    for (const m of this.mouths) {
      const dx = x - m.x;
      const dy = y - m.y;
      if (dx * dx + dy * dy <= r2) return m;
    }
    return null;
  }

  /**
   * Spawn one portal-mouth marker as a tagged sprite in scene.decorations — a scanned
   * group, so it shows in __GAME__.entities as type 'portal' with the auto-derived id.
   * A texture slot tiles when it resolves; else a tinted placeholder rect (mirrors
   * RoomGateSystem's door spawn). The marker is non-solid: the player steps ONTO it.
   */
  private spawnMarker(x: number, y: number, id: string): void {
    const scene = this.scene;
    const hasTex = !!this.slot && scene.textures?.exists?.(this.slot);
    const sprite = scene.physics?.add?.sprite(x, y, hasTex ? this.slot : '__px');
    if (!sprite) return;
    sprite.setDisplaySize?.(this.size, this.size);
    if (!hasTex) {
      if (!scene.textures?.exists?.('__px')) {
        scene.textures?.generate?.('__px', { data: ['1'], pixelWidth: 8 });
      }
      sprite.setTexture?.('__px');
      sprite.setTint?.(this.tint);
    }
    const body = sprite.body;
    body?.setAllowGravity?.(false);
    body?.setImmovable?.(true);
    sprite.__type = 'portal';
    sprite.__id = id;
    scene.decorations?.add?.(sprite);
    this.markers.push(sprite);
  }

  /** Move the player (keep the arcade body in sync — setPosition alone desyncs it). */
  private reposition(sprite: any, x: number, y: number): void {
    if (sprite.body?.reset) sprite.body.reset(x, y);
    else sprite.setPosition?.(x, y);
    // Mirror onto the plain fields so a headless host (no arcade body) still moves.
    sprite.x = x;
    sprite.y = y;
  }

  /** The scene clock now (ms); 0-safe before attach (mirrors BombPlacement.nowMs). */
  private nowMs(): number {
    return this.scene?.time?.now ?? 0;
  }

  // ── component surface (the declared PUSH channel) ────────────────────────────

  /**
   * The one event this system publishes on the shared bus. A TRUE statement about the
   * real emit site in teleport(): the player stepped onto a portal mouth and jumped to
   * the paired mouth. The matching .emit() is
   * `this.scene.eventBus.emit('entity.teleported', { portalId, toX, toY })`.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'entity.teleported',
          payload: '{portalId,toX,toY}',
          scope: 'archetype',
          drivenBy: 'move — the player steps onto a declared portal mouth',
          expect:
            'player.x|y jumps to the paired portal mouth coordinates in __GAME__.player.x|y (a board-spanning position discontinuity), a re-entry guard prevents an immediate bounce-back, and the portal pair shows in __GAME__.entities as type "portal"; entity.teleported logged',
        },
      ],
    };
  }
}

/** A declared pair is valid only if both mouths carry a numeric center. */
function isPair(p: any): p is PortalPair {
  return !!p && isMouth(p.a) && isMouth(p.b);
}

function isMouth(m: any): m is PortalMouth {
  return !!m && Number.isFinite(m.x) && Number.isFinite(m.y);
}
