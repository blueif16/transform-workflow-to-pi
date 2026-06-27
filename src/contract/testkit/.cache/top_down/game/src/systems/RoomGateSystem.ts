/**
 * RoomGateSystem — room-clear gating: lock a room's exit until its enemies are
 * cleared, then open it (system, top_down:dungeon).
 *
 * The GMTK "Boss Keys" clear-it-to-proceed spine, as ONE scene-level system. It
 * turns a single arena into a SEQUENCE of contested rooms: each room declares its
 * id, its enemy set, an exit-DOOR rect, and a region rect (params.rooms[]). At
 * attach it spawns every room's door as a SOLID static sprite in scene.obstacles
 * (the group the player + enemies collide with — BaseGameScene.setupWallCollisions),
 * so the door physically BLOCKS the passage and shows in __GAME__.entities. While a
 * room still holds a living enemy its door stays solid; once the room's LAST enemy
 * dies the door OPENS (removed from obstacles + destroyed → it leaves
 * __GAME__.entities, the cell is passable) and scene.roomsCleared increments.
 *
 * The two driving verbs, at their true seams:
 *   - attack → an enemy dies → the engine emits 'enemy.died' (BaseGameScene
 *     onEnemyKilled). We CONSUME that, re-derive the current room's living-enemy
 *     count, and when it hits zero OPEN the door + emit 'room.cleared'.
 *   - move → the player crosses into a new room's region rect → scene.currentRoom
 *     updates + 'room.entered' is emitted; if the entered room still holds enemies
 *     its (already-open?) door stays/relocks solid.
 *
 * It re-implements NOTHING the engine owns: the door is a real arcade static
 * sprite in scene.obstacles (the existing solid + __GAME__.entities path, exactly
 * like DestructibleGrid's bricks); enemy deaths arrive on the shared scene.eventBus
 * ('enemy.died', the standardized base seam); the living-enemy set is scene.enemies.
 * A room's enemies are matched by their __id against the room's declared enemyIds[]
 * (an empty/unmatched set = an already-clear room, so its door opens at attach).
 *
 * Observable transitions (__GAME__):
 *   while a room holds a living enemy → its door entity is solid + present in
 *       __GAME__.entities (it blocks the player)
 *   the room's last enemy dies (attack) → the door leaves __GAME__.entities (player
 *       can pass) + roomsCleared increments + room.cleared logged
 *   the player crosses a region boundary (move) → currentRoom updates + room.entered
 *       logged
 *
 * Params (all OPTIONAL — sensible declared defaults, never a baked game constant):
 *   rooms              the room manifest: each
 *                        { id, enemyIds:[ '<threatId>', … ], door:{x,y,width,height},
 *                          region:{x,y,width,height} }
 *                      where door x/y is the TOP-LEFT corner (the layout/wall
 *                      convention) and region is the AABB that defines "inside this
 *                      room" for currentRoom tracking. Default [] (a no-op system).
 *   doorThickness      fallback door height/width when a room omits door dims (32).
 *   doorColor          door tint when no door texture slot resolves (0x6b4f2a).
 *   doorSlot           door sprite texture key (placeholder rect when absent).
 *   clearedEffectEvent cosmetic effect fired via scene.fireEffect on a clear
 *                      ('room.cleared').
 *
 * GENERIC: no game/theme, no coordinate, no count is baked — the rooms are the DATA
 * (params.rooms[]), the current room is DERIVED from the player position each frame,
 * and a board with no rooms is a clean no-op.
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (the registry discover.mjs reads this — mirrors the other system files). */
export const CAPABILITY = {
  kind: 'system',
  id: 'RoomGateSystem',
  intent:
    "Room-clear gating: lock each room's exit (a solid door entity in scene.obstacles) until that room's enemies are cleared, then open it and increment scene.roomsCleared. Tracks scene.currentRoom from the player position; consumes the engine's enemy.died. The clear-it-to-proceed dungeon spine.",
  attachesTo: 'scene',
  params: ['rooms', 'doorThickness', 'doorColor', 'doorSlot', 'clearedEffectEvent'],
  roles: ['player', 'enemy'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

/** An axis-aligned rect (door = TOP-LEFT corner; region = TOP-LEFT corner). */
export interface RoomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One room in the manifest: its id, enemy set, exit-door rect, and region rect. */
export interface RoomSpec {
  id: string;
  /** the __id of each threat that belongs to this room (matched against scene.enemies). */
  enemyIds?: string[];
  /** the exit-door blocking rect (TOP-LEFT x/y). */
  door?: Partial<RoomRect>;
  /** the AABB that defines "the player is inside this room" (TOP-LEFT x/y). */
  region?: RoomRect;
}

export interface RoomGateSystemConfig {
  rooms?: RoomSpec[];
  doorThickness?: number;
  doorColor?: number;
  doorSlot?: string;
  clearedEffectEvent?: string;
}

/** Runtime state for one room (its spec + live door sprite + cleared latch). */
interface LiveRoom {
  spec: RoomSpec;
  /** the on-board solid door sprite (in scene.obstacles); null once opened. */
  door: any;
  /** true once this room has been cleared (one-shot — never re-counts). */
  cleared: boolean;
}

export class RoomGateSystem implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly roomsSpec: RoomSpec[];
  private readonly doorThickness: number;
  private readonly doorColor: number;
  private readonly doorSlot?: string;
  private readonly clearedEffectEvent: string;

  /** Live rooms in declared order (door sprite + cleared latch). */
  private rooms: LiveRoom[] = [];
  /** The active room id (null before the player enters any region). */
  private current: string | null = null;
  /** Bound enemy.died handler (kept so reset can detach it cleanly). */
  private onEnemyDied = (_p?: unknown): void => this.recheckClears();

  constructor(params: RoomGateSystemConfig = {}) {
    this.roomsSpec = Array.isArray(params.rooms) ? params.rooms : [];
    this.doorThickness = Math.max(4, params.doorThickness ?? 32);
    this.doorColor = params.doorColor ?? 0x6b4f2a;
    this.doorSlot = params.doorSlot;
    this.clearedEffectEvent = params.clearedEffectEvent ?? 'room.cleared';
  }

  /** Re-arm cleanly on a level restart: drop the bus listener + every door sprite. */
  reset(): void {
    if (this.scene?.eventBus?.off) this.scene.eventBus.off('enemy.died', this.onEnemyDied);
    for (const r of this.rooms) this.removeDoor(r);
    this.rooms = [];
    this.current = null;
    if (this.scene) {
      this.scene.roomsCleared = 0;
      this.scene.currentRoom = null;
    }
  }

  attach(scene: any): void {
    this.scene = scene;
    // Expose the observed scene fields read into __GAME__ (count + active id).
    scene.roomsCleared = 0;
    scene.currentRoom = null;

    // Materialize every room: spawn its solid door (unless it has no enemies, in
    // which case it is already clear → door opens / never spawns).
    for (const spec of this.roomsSpec) {
      const room: LiveRoom = { spec, door: null, cleared: false };
      if (this.livingEnemyCount(spec) > 0) {
        room.door = this.spawnDoor(spec);
      } else {
        room.cleared = true;
        scene.roomsCleared += 1;
      }
      this.rooms.push(room);
    }

    // Consume the standardized enemy-death event (the attack seam): every kill
    // re-derives clears, so the LAST enemy of a room opens its door.
    scene.eventBus?.on?.('enemy.died', this.onEnemyDied);
  }

  /** Make the doors solid: they already live in scene.obstacles, collided in setupWallCollisions. */
  setupCollisions(): void {}

  update(): void {
    const scene = this.scene;
    if (!scene || scene.gameCompleted) return;
    // move-driven: re-derive the room the player stands in; emit room.entered on a change.
    this.trackPlayerRoom();
    // Defensive backstop: re-derive clears each frame even if a kill arrived without
    // a bus event (idempotent — recheckClears only OPENS, never re-counts).
    this.recheckClears();
  }

  // ── move: current-room tracking (the room.entered seam) ──────────────────────

  /**
   * Re-derive which room the player is inside from its position, and on a CHANGE
   * update scene.currentRoom + emit 'room.entered'. The room.entered seam: crossing
   * a region boundary (a move) is the gameplay moment.
   */
  private trackPlayerRoom(): void {
    const scene = this.scene;
    const player = scene?.player;
    if (!player) return;
    const inside = this.roomAt(player.x, player.y);
    if (inside === this.current) return; // no boundary crossed this frame
    this.current = inside;
    scene.currentRoom = inside;
    if (inside !== null) {
      this.enterRoom(inside);
    }
  }

  /**
   * Enter a room by id (the drivable verb seam — also called directly by the test
   * driver to fire room.entered without a full traversal). Sets currentRoom, fires
   * 'room.entered', and RE-LOCKS the room's door if it still holds living enemies
   * (re-entering an uncleared room finds its exit solid).
   */
  enterRoom(roomId: string): void {
    const scene = this.scene;
    if (!scene) return;
    this.current = roomId;
    scene.currentRoom = roomId;
    const room = this.roomById(roomId);
    if (room && !room.cleared && !room.door && this.livingEnemyCount(room.spec) > 0) {
      room.door = this.spawnDoor(room.spec);
    }
    // room.entered — the player crossed into this room's region.
    this.bus?.emit('room.entered', { roomId });
  }

  // ── attack: clear detection (the room.cleared seam) ──────────────────────────

  /**
   * Re-derive every uncleared room's living-enemy count; OPEN (and count) any room
   * whose enemies are now all dead. Idempotent — a cleared room is skipped, so a
   * frame-tick backstop never double-counts. Each newly-cleared room opens its door
   * and fires 'room.cleared'.
   */
  private recheckClears(): void {
    const scene = this.scene;
    if (!scene) return;
    for (const room of this.rooms) {
      if (room.cleared) continue;
      if (this.livingEnemyCount(room.spec) > 0) continue;
      this.clearRoom(room);
    }
  }

  /**
   * Clear a room by id (the drivable verb seam — also called directly by the test
   * driver to force a clear without killing every sprite). Opens the door + counts +
   * fires the event. A no-op if the room is unknown or already cleared.
   */
  clearRoom(roomId: string): void;
  clearRoom(room: LiveRoom): void;
  clearRoom(arg: string | LiveRoom): void {
    const scene = this.scene;
    if (!scene) return;
    const room = typeof arg === 'string' ? this.roomById(arg) : arg;
    if (!room || room.cleared) return;
    room.cleared = true;
    this.removeDoor(room); // door leaves __GAME__.entities → the player can pass
    scene.roomsCleared = (scene.roomsCleared ?? 0) + 1;
    scene.fireEffect?.(this.clearedEffectEvent, scene.player?.x, scene.player?.y);
    // room.cleared — the room's last enemy died; the exit is now open.
    this.bus?.emit('room.cleared', {
      roomId: room.spec.id,
      roomsCleared: scene.roomsCleared,
    });
  }

  // ── doors (solid static sprites in scene.obstacles) ──────────────────────────

  /**
   * Spawn a room's exit-door as a SOLID arcade static sprite in scene.obstacles
   * (the group the player + enemies already collide with), tagged so it shows in
   * __GAME__.entities as type 'door' with the room's id. A texture key tiles when it
   * resolves; else a tinted placeholder rect. Mirrors DestructibleGrid's brick spawn.
   */
  private spawnDoor(spec: RoomSpec): any {
    const scene = this.scene;
    const d = spec.door ?? {};
    const w = Math.max(4, d.width ?? this.doorThickness);
    const h = Math.max(4, d.height ?? this.doorThickness);
    const cx = (d.x ?? 0) + w / 2;
    const cy = (d.y ?? 0) + h / 2;
    const hasTex = !!this.doorSlot && scene.textures?.exists?.(this.doorSlot);
    const door = scene.physics.add.staticSprite(cx, cy, hasTex ? this.doorSlot : '__px');
    door.setDisplaySize?.(w, h);
    if (!hasTex) {
      if (!scene.textures?.exists?.('__px')) {
        scene.textures?.generate?.('__px', { data: ['1'], pixelWidth: 8 });
      }
      door.setTexture?.('__px');
      door.setTint?.(this.doorColor);
    }
    door.refreshBody?.();
    door.__type = 'door';
    door.__id = `door_${spec.id}`;
    // Surface it in scene.obstacles so it is SOLID (collided in setupWallCollisions)
    // and counted in __GAME__.entities; opening the room removes it from here.
    scene.obstacles?.add?.(door);
    return door;
  }

  /** Open/destroy a room's door so it leaves scene.obstacles + __GAME__.entities. */
  private removeDoor(room: LiveRoom): void {
    const door = room?.door;
    if (!door) return;
    const body = door.body;
    if (body) body.enable = false;
    this.scene?.obstacles?.remove?.(door, false, false);
    door.destroy?.();
    room.door = null;
  }

  // ── small helpers ────────────────────────────────────────────────────────────

  /** The room whose region rect contains (x,y), or null (the player is in no room). */
  private roomAt(x: number, y: number): string | null {
    for (const room of this.rooms) {
      const r = room.spec.region;
      if (!r) continue;
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
        return room.spec.id;
      }
    }
    return null;
  }

  /** Count the room's declared enemies still alive on the board (by __id match). */
  private livingEnemyCount(spec: RoomSpec): number {
    const ids = spec.enemyIds;
    if (!ids || ids.length === 0) return 0; // a room with no enemy set is already clear
    const grp = this.scene?.enemies;
    if (!grp || typeof grp.getChildren !== 'function') return 0;
    const wanted = new Set(ids);
    let n = 0;
    for (const e of grp.getChildren()) {
      if (!e || e.active === false || e.isDead) continue;
      if (wanted.has(e.__id)) n += 1;
    }
    return n;
  }

  private roomById(id: string): LiveRoom | undefined {
    return this.rooms.find((r) => r.spec.id === id);
  }

  // ── component surface (the declared PUSH-channel events this system emits) ────

  /**
   * The uniform component surface. Declares the two dungeon-gating moments this
   * system emits on the shared bus — each a TRUE statement about a real emit site in
   * this file:
   *   - room.cleared ← clearRoom   (the room's last enemy died via the attack/
   *                                 enemy.died seam: the door leaves __GAME__.entities
   *                                 + roomsCleared increments)
   *   - room.entered ← enterRoom   (the player crossed into a new region via move:
   *                                 currentRoom updates)
   * The door-solidity transition is observable on the existing __GAME__.entities
   * adapter (the door is a tagged sprite in scene.obstacles), so this surface
   * declares only the PUSH channel + no anchors.
   */
  surface(): ComponentSurface {
    return {
      observables: {},
      anchors: [],
      events: [
        {
          name: 'room.cleared',
          payload: '{roomId,roomsCleared}',
          scope: 'archetype',
          drivenBy: "attack — the current room's last enemy dies (enemy.died)",
          expect:
            "the room's exit-door entity leaves __GAME__.entities (the player can pass it) and scene.roomsCleared increments; room.cleared logged",
        },
        {
          name: 'room.entered',
          payload: '{roomId}',
          scope: 'archetype',
          drivenBy: 'move — the player crosses into a new room region',
          expect:
            "scene.currentRoom updates to the entered room id (and its exit re-locks if it still holds enemies); room.entered logged",
        },
      ],
    };
  }
}
