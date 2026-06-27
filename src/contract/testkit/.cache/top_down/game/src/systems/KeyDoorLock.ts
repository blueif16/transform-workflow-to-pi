/**
 * KeyDoorLock — keys-and-doors: the defining Zelda dungeon mechanic that makes the
 * map NON-LINEAR (system, top_down). The key is off the critical path; finding it
 * is what UNLOCKS the door that gates a previously-blocked region.
 *
 * Two seams over the genre's standard sets (it re-implements NOTHING the engine owns):
 *   - COLLECT (the key pickup) — the player overlaps a reward tagged as a key
 *     (`__kind === keyKind`). The key is consumed through the SAME seam every
 *     collectathon uses (`scene.consumeReward` → removes it from rewardsById, disables
 *     its body, destroys it → the key LEAVES `__GAME__.entities`) AND `scene.keyCount`
 *     increments by one. We emit `key.collected` at this true gameplay moment. The key
 *     count is the component's OWN live value, surfaced as the `scene.keyCount`
 *     observable (the PULL channel), so the win/HUD/verify witness can read it without
 *     this component editing the engine hook.
 *   - MOVE INTO A LOCKED DOOR — the player touches a door entity (`__kind === doorKind`)
 *     while `scene.keyCount > 0`. The matching key (or any key, for a generic small
 *     key) is SPENT: `scene.keyCount` decrements by one, the door becomes NON-SOLID
 *     (its body is disabled + it is removed from the solid set + destroyed → the door
 *     LEAVES `__GAME__.entities`, so the region it blocked is now reachable). We emit
 *     `door.unlocked` at this true moment. A locked door the player touches with NO
 *     key stays solid (no key, no open) — the gate that forces the detour to find one.
 *
 * It owns the door collider (so a door is SOLID until unlocked) + the overlap that
 * detects the touch — both wired in setupCollisions over the SAME `decorations` group
 * the rewards live in (where key + door entities are spawned). The collider is the
 * solid-blocking; the overlap is the unlock trigger. A board with no key/door entities
 * is a clean no-op (the mechanic safely degrades to nothing).
 *
 * ID-SOURCE (the required clause): a door's `id` and its `requiredKey`, and each key
 * pickup's `id`, are AUTO-DERIVED from the live entity's own `__id` / `__kind` /
 * `__requiredKey` tags (surfaced onto the sprite by the data loader from each entity's
 * declared params). A generic small key (no `__requiredKey` on the door) opens ANY door
 * with a spare key; a MATCHED door (`__requiredKey` set) opens only when a key with the
 * matching `__keyId` has been collected. Nothing is fabricated.
 *
 * Params (all OPTIONAL — sensible DECLARED defaults, no game/theme/coordinate baked):
 *   keyKind     the reward `__kind` that marks a KEY pickup (default 'key').
 *   doorKind    the entity `__kind` that marks a LOCKED DOOR (default 'locked_door').
 *   matchKeys   when true, a door tagged `__requiredKey` only opens with a collected key
 *               whose `__keyId` matches; when false ALL keys are interchangeable small
 *               keys (default false — the generic small-key rule, the common case).
 */
import type { ISceneSystem } from '../scenes/topdown-data';
import { type ComponentSurface, type EventBus } from '@contract/component-surface';

/** CAPABILITY sidecar (registry/discover.mjs globs this — mirrors the sibling systems). */
export const CAPABILITY = {
  kind: 'system',
  id: 'KeyDoorLock',
  intent:
    'Keys-and-doors (the Zelda dungeon non-linearity): collecting a key reward increments scene.keyCount; touching a locked door with keyCount>0 spends a key — the door becomes non-solid (its blocked region is now reachable) and keyCount decrements.',
  attachesTo: 'scene',
  params: ['keyKind', 'doorKind', 'matchKeys'],
  roles: ['player', 'key', 'door'],
} as const;

export const SYSTEM_CAPABILITIES = [CAPABILITY] as const;

export interface KeyDoorLockConfig {
  keyKind?: string;
  doorKind?: string;
  matchKeys?: boolean;
}

export class KeyDoorLock implements ISceneSystem {
  private scene: any;

  private get bus(): EventBus | undefined {
    return (this.scene as any)?.eventBus;
  }

  private readonly keyKind: string;
  private readonly doorKind: string;
  private readonly matchKeys: boolean;

  /** The component's OWN live key count (surfaced as the scene.keyCount observable). */
  private keyCount = 0;
  /** The ids of every distinct key collected (for the matched-key rule). */
  private readonly collectedKeyIds = new Set<string>();
  /** The door collider we own (so doors are SOLID until unlocked). */
  private doorCollider: any = null;

  constructor(params: KeyDoorLockConfig = {}) {
    this.keyKind = params.keyKind ?? 'key';
    this.doorKind = params.doorKind ?? 'locked_door';
    this.matchKeys = params.matchKeys ?? false;
  }

  /** Re-arm cleanly on a level restart: zero the count + drop every latch. */
  reset(): void {
    this.keyCount = 0;
    this.collectedKeyIds.clear();
    this.doorCollider = null;
  }

  attach(scene: any): void {
    this.scene = scene;
    // Expose the count on the live scene as the conventional archetype-extra field the
    // engine hook reads defensively (s?.keyCount), so scene.keyCount surfaces into
    // __GAME__ without this component editing core/hook.ts.
    this.scene.keyCount = 0;
  }

  /**
   * Wire BOTH seams over the decorations group (where keys + doors are spawned, by
   * setupCollisions the player + entities exist — like CollectGoal / WeaponPickup):
   *   - a COLLIDER player<->doors so a LOCKED door BLOCKS the player (solid);
   *   - an OVERLAP player<->decorations so touching a key collects it and touching a
   *     locked door (with a key) unlocks it.
   * The collider's processCallback gates collision to LOCKED doors only, so once a door
   * is unlocked it stops blocking (the region becomes reachable) even before destroy.
   */
  setupCollisions(): void {
    const scene = this.scene;
    const player = scene?.player;
    const group = scene?.decorations;
    if (!player || !group) return;

    // Door solidity: collide the player with doors, but ONLY while a door is a LOCKED,
    // un-opened door (process callback). An unlocked/opened door is non-solid.
    this.doorCollider = scene.physics.add.collider(
      player,
      group,
      undefined,
      (_p: any, ent: any) => this.isLockedDoor(ent) && !ent.__opened,
      this,
    );

    // The interaction trigger: overlap detects a key pickup OR a door touch.
    scene.physics.add.overlap(player, group, (_p: any, ent: any) => {
      this.touch(ent);
    });
  }

  /** No per-frame work — both seams are contact-driven (collect + move-into-door). */
  update(): void {}

  // ── the drive seams (the collect + move-into-door verbs) ────────────────────

  /**
   * The contact router (the seam the overlap routes to). A KEY pickup is collected; a
   * LOCKED DOOR the player touches is unlocked iff a usable key is held. Drivable
   * WITHOUT a full game: call touch(entity) with a real key/door sprite.
   */
  touch(ent: any): void {
    if (!ent || ent.__consumed) return;
    if (ent.__kind === this.keyKind) {
      this.collectKey(ent);
    } else if (this.isLockedDoor(ent) && !ent.__opened) {
      this.tryUnlock(ent);
    }
  }

  /**
   * The COLLECT verb (public drive seam). Consume a key pickup through the standard
   * collection seam, bump scene.keyCount, and emit key.collected at the true moment.
   * The key id is AUTO-DERIVED from the entity's own `__keyId`/`__id`.
   */
  collectKey(key: any): void {
    if (!key || key.__consumed || key.__kind !== this.keyKind) return;
    const keyId = this.keyIdOf(key);

    this.consume(key); // standard seam: removes from rewardsById, disables body, destroys
    this.keyCount += 1;
    this.collectedKeyIds.add(keyId);
    this.syncKeyCount();

    // key.collected — the key has left __GAME__.entities (consumed) and scene.keyCount
    // rose by one at this real pickup moment.
    this.bus?.emit('key.collected', {
      keyId,
      keyCount: this.keyCount,
    });
    this.scene.fireEffect?.('key.collected', key.x, key.y);
  }

  /**
   * The MOVE-INTO-A-LOCKED-DOOR verb (public drive seam). If the player has a usable
   * key for this door, SPEND it: decrement scene.keyCount, make the door non-solid
   * (disable its body + remove it from the solid set + destroy → it leaves
   * __GAME__.entities), and emit door.unlocked. With no usable key the door stays solid
   * (the gate that forces the detour). The door id + its requiredKey are AUTO-DERIVED.
   */
  tryUnlock(door: any): void {
    if (!door || door.__opened || !this.isLockedDoor(door)) return;
    if (this.keyCount <= 0) return; // no key → the door stays locked (no open)
    if (!this.hasUsableKeyFor(door)) return; // matched-key rule: wrong key → stays locked

    const doorId = this.doorIdOf(door);
    door.__opened = true;
    this.keyCount -= 1;
    this.syncKeyCount();
    this.openDoor(door); // non-solid: disable body + remove from the solid group + destroy

    // door.unlocked — the door is now non-solid (its region reachable in
    // __GAME__.entities) and scene.keyCount decremented by one at this real moment.
    this.bus?.emit('door.unlocked', {
      doorId,
      keyCount: this.keyCount,
    });
    this.scene.fireEffect?.('door.unlocked', door.x, door.y);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** True when the entity is a LOCKED door of the configured kind. */
  private isLockedDoor(ent: any): boolean {
    return !!ent && ent.__kind === this.doorKind;
  }

  /**
   * Whether a held key can open THIS door. With matchKeys off, ANY spare key is a
   * generic small key (keyCount>0 is enough). With matchKeys on, a door tagged
   * `__requiredKey` opens only when a key with the matching `__keyId` was collected; an
   * untagged door still opens with any spare key.
   */
  private hasUsableKeyFor(door: any): boolean {
    if (!this.matchKeys) return true;
    const required = door?.__requiredKey;
    if (typeof required !== 'string' || required.length === 0) return true;
    return this.collectedKeyIds.has(required);
  }

  /** Make the door non-solid: disable its body, drop it from the solid set, destroy. */
  private openDoor(door: any): void {
    const body = door.body as { enable?: boolean; checkCollision?: { none?: boolean } } | undefined;
    if (body) {
      body.enable = false; // no physics body → no collision (non-solid)
      if (body.checkCollision) body.checkCollision.none = true;
    }
    door.__consumed = true;
    const id = door.__id as string | undefined;
    if (id && this.scene?.rewardsById?.[id]) delete this.scene.rewardsById[id];
    this.scene?.decorations?.remove?.(door, false, false); // leave the solid group
    door.destroy?.(); // leaves __GAME__.entities → the blocked region is now reachable
  }

  /** Consume a key reward via the standard scene seam (also fires base reward.collected). */
  private consume(key: any): void {
    if (typeof this.scene?.consumeReward === 'function') {
      this.scene.consumeReward(key);
    } else {
      key.__consumed = true;
      const id = key.__id as string | undefined;
      if (id && this.scene?.rewardsById?.[id]) delete this.scene.rewardsById[id];
      key.destroy?.();
    }
  }

  /** Mirror the OWN count onto the live scene field the engine hook reads (s?.keyCount). */
  private syncKeyCount(): void {
    if (this.scene) this.scene.keyCount = this.keyCount;
  }

  /** The key id: AUTO-DERIVED from the entity's `__keyId` or `__id` (never fabricated). */
  private keyIdOf(key: any): string {
    const id = key?.__keyId ?? key?.__id;
    return typeof id === 'string' && id.length > 0 ? id : 'key';
  }

  /** The door id: AUTO-DERIVED from the entity's `__id` (never fabricated). */
  private doorIdOf(door: any): string {
    const id = door?.__id;
    return typeof id === 'string' && id.length > 0 ? id : 'door';
  }

  // ── component surface (the declared PUSH channel + the keyCount PULL observable) ──

  /**
   * The uniform component surface. Declares the count this system OWNS as the
   * scene.keyCount observable (a live thunk over its real value) AND the two
   * keys-and-doors moments it emits — each a TRUE statement about a real emit site:
   *   - key.collected ← collectKey (collect verb: the key leaves entities, keyCount++)
   *   - door.unlocked ← tryUnlock  (move verb: the door becomes non-solid, keyCount--)
   */
  surface(): ComponentSurface {
    return {
      observables: {
        'scene.keyCount': () => this.keyCount,
      },
      anchors: [],
      events: [
        {
          name: 'key.collected',
          payload: '{keyId,keyCount}',
          scope: 'archetype',
          drivenBy: 'player↔reward overlap (consumeReward)',
          expect:
            'the key leaves __GAME__.entities and scene.keyCount increments by one; key.collected logged',
        },
        {
          name: 'door.unlocked',
          payload: '{doorId,keyCount}',
          scope: 'archetype',
          drivenBy: 'move — the player touches a locked door while scene.keyCount > 0',
          expect:
            'the door entity becomes non-solid (its blocked region is now reachable in __GAME__.entities) and scene.keyCount decrements by one; door.unlocked logged',
        },
      ],
    };
  }
}
