/**
 * KeyDoorLock — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the two surface() events actually FIRE at runtime by driving the REAL
 * verb on the REAL KeyDoorLock class and asserting each declared `expect`
 * transition on the OBSERVABLE state — the same state the engine's __GAME__
 * adapter reads:
 *   - __GAME__.entities    ← collectEntities() over the scene's `decorations`
 *                            group (hook.ts lines 121-153: walk getChildren(),
 *                            drop active===false). Keys + locked doors are spawned
 *                            into `decorations`.
 *   - scene.keyCount       ← the surface() observable thunk (() => this.keyCount),
 *                            mirrored by the SUT onto the live scene field
 *                            (attach()/syncKeyCount()) — the PULL channel the
 *                            win/HUD/verify witness reads.
 *   - the PUSH event log    ← the EventBus the SUT emits on (key.collected /
 *                            door.unlocked), the same bus __GAME__.events.recent taps.
 *
 * The verbs are driven through the system's OWN wiring, never a back-door:
 *   - COLLECT (a key)        — invoke the REAL physics.add.overlap callback the SUT
 *                              registers in setupCollisions(), passing the live key
 *                              sprite the engine would hand it on a player↔key overlap.
 *   - MOVE (into a locked door) — invoke that SAME registered overlap callback with
 *                              the live door sprite the engine would hand it when the
 *                              player touches the door (the door is a member of the
 *                              decorations group the overlap watches).
 *
 * Real objects: the system under test, a real getChildren-backed `decorations`
 * group (so consumeReward/openDoor actually remove the sprite and __GAME__ sees it
 * leave), the recording EventBus, a real rewardsById map, and a real consumeReward
 * seam mirrored from DataTopDownScene (emits reward.collected, deletes from
 * rewardsById, removes from decorations, disables body, destroys). The scene is the
 * harness boundary — a minimal Phaser-shaped host; it owns NO logic under test:
 * every count/spend/solidity/emit decision is the component's own code.
 *
 * COUNTERFACTUAL (meaningfulness):
 *   - key.collected: if collectKey() is no-op'd, the key never leaves decorations,
 *     scene.keyCount stays 0, and no 'key.collected' is recorded → 1a/1b/1c fail.
 *     Exercised directly via a non-key sprite: touching a non-key entity changes
 *     nothing (the same observable a broken collect would show).
 *   - door.unlocked: if tryUnlock() is no-op'd, the door stays in decorations,
 *     keyCount is not spent, and no 'door.unlocked' is recorded → 2a/2b/2c fail.
 *     Exercised directly via the no-key guard: touching a locked door with
 *     keyCount===0 leaves the door solid + present and logs nothing.
 */
import assert from 'node:assert/strict';
// Dynamic import: the source carries a type-only `@contract` import that trips
// tsx's static named-export resolution; import() loads the REAL class cleanly.
const { KeyDoorLock } = (await import('../KeyDoorLock.ts')) as typeof import('../KeyDoorLock.ts');

// ── observable adapter — the literal read __GAME__.entities does over a group ──
// Mirrors templates/core/src/hook.ts collectEntities() for the `decorations` group
// (lines 121-153). NOT reimplemented logic — the literal read the real oracle does.
function entitiesOf(scene: any): Array<{ kind: string; id: string; x: number; y: number }> {
  const group = scene.decorations;
  const out: any[] = [];
  if (!group || typeof group.getChildren !== 'function') return out;
  for (const child of group.getChildren()) {
    if (!child || child.active === false) continue; // hook drops active===false
    out.push({
      kind: child.__kind ?? 'entity',
      id: child.__id ?? 'entity',
      x: child.x ?? 0,
      y: child.y ?? 0,
    });
  }
  return out;
}

// scene.keyCount — the surface() observable (() => this.keyCount), mirrored onto
// the live scene field; the verify/HUD witness reads scene.keyCount.
function keyCountOf(scene: any): number {
  return (scene.keyCount as number) ?? 0;
}

// ── a real getChildren-backed Phaser group (what scene.decorations is to the adapter) ──
function makeGroup() {
  const items: any[] = [];
  return {
    add: (o: any) => { if (!items.includes(o)) items.push(o); },
    remove: (o: any, _a?: boolean, _b?: boolean) => { const i = items.indexOf(o); if (i >= 0) items.splice(i, 1); },
    getChildren: () => items.slice(),
  };
}

// ── a real recording EventBus that ALSO dispatches. Every emit is logged AND
//    delivered to any registered listener — a real bus, not a stub. ──
function makeBus() {
  const log: Array<{ name: string; payload: any }> = [];
  const listeners = new Map<string, Array<(p?: any) => void>>();
  return {
    log,
    on(name: string, cb: (p?: any) => void) {
      const arr = listeners.get(name) ?? [];
      arr.push(cb);
      listeners.set(name, arr);
      return () => { const a = listeners.get(name); if (a) a.splice(a.indexOf(cb), 1); };
    },
    emit(name: string, payload?: any) {
      log.push({ name, payload });
      for (const cb of listeners.get(name)?.slice() ?? []) cb(payload);
    },
  };
}

/**
 * Build a minimal Phaser-shaped scene host carrying the REAL bus + decorations
 * group + rewardsById + a REAL consumeReward seam mirrored verbatim from
 * DataTopDownScene.consumeReward (the standard collection seam the SUT calls for a
 * key): emit reward.collected, delete from rewardsById, disable body, remove from
 * decorations, destroy. physics.add.collider/overlap RECORD their (a, b, cb) so the
 * test can drive the REAL callbacks the SUT registers. No logic under test lives here.
 */
function makeScene(player: any, bus: ReturnType<typeof makeBus>) {
  const overlaps: Array<{ a: any; b: any; cb: (p: any, o: any) => void }> = [];
  const colliders: Array<{ a: any; b: any; collideCb: any; processCb: any }> = [];
  const decorations = makeGroup();
  const rewardsById: Record<string, any> = {};
  const scene: any = {
    __overlaps: overlaps,
    __colliders: colliders,
    player,
    decorations,
    rewardsById,
    eventBus: bus,
    fireEffect: (_n: string, _x: number, _y: number) => {},
    // The standard collection seam, mirrored from DataTopDownScene.consumeReward.
    consumeReward(sprite: any) {
      if (!sprite || sprite.__consumed) return;
      sprite.__consumed = true;
      const id = sprite.__id as string | undefined;
      bus.emit('reward.collected', { id, x: sprite.x ?? 0, y: sprite.y ?? 0 });
      if (id && rewardsById[id]) delete rewardsById[id];
      const body = sprite.body;
      if (body) body.enable = false;
      decorations.remove(sprite, false, false);
      sprite.destroy();
    },
    physics: {
      add: {
        collider: (a: any, b: any, collideCb: any, processCb: any) => {
          const c = { a, b, collideCb, processCb };
          colliders.push(c);
          return c;
        },
        overlap: (a: any, b: any, cb: (p: any, o: any) => void) => { overlaps.push({ a, b, cb }); },
      },
    },
  };
  return scene;
}

// A live entity sprite (a key or a door) — a real object the data loader would mint
// into the decorations group, carrying its declared __kind/__id tags.
function makeEntity(group: any, rewardsById: Record<string, any>, kind: string, id: string, x: number, y: number, extra: Record<string, any> = {}) {
  const sprite: any = {
    x, y, active: true,
    __kind: kind, __id: id,
    body: { enable: true, checkCollision: { none: false } },
    destroy() { this.active = false; },
    ...extra,
  };
  group.add(sprite);
  rewardsById[id] = sprite;
  return sprite;
}

function makePlayer(x: number, y: number) {
  return { x, y, active: true };
}

// Drive a player↔entity overlap through the REAL callback the SUT registered.
function driveOverlap(scene: any, sprite: any) {
  for (const o of scene.__overlaps) o.cb(scene.player, sprite);
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT 1 — key.collected (drivenBy: collect — player overlaps a key pickup)
//  expect: the key leaves __GAME__.entities and scene.keyCount increments by one;
//          key.collected logged.
// ════════════════════════════════════════════════════════════════════════════
check('key.collected — overlapping a key consumes it (leaves entities), bumps scene.keyCount, and logs the event', () => {
  const player = makePlayer(100, 100);
  const bus = makeBus();
  const scene = makeScene(player, bus);
  const sys = new KeyDoorLock({}); // defaults: keyKind 'key', doorKind 'locked_door'
  sys.attach(scene);
  sys.setupCollisions(); // wires the REAL player↔decorations overlap callback

  const key = makeEntity(scene.decorations, scene.rewardsById, 'key', 'key_1', 50, 60, { __keyId: 'key_1' });

  // precondition: the key is on the board, keyCount is 0.
  assert.equal(entitiesOf(scene).filter((e) => e.kind === 'key').length, 1, 'the key is on the board before collect');
  assert.equal(keyCountOf(scene), 0, 'scene.keyCount is 0 before collect');

  // DRIVE the collect verb through the REAL overlap callback (what the engine
  // invokes on a player↔key overlap), handing it the live key sprite.
  driveOverlap(scene, key);

  // 1a OBSERVABLE: the key LEFT __GAME__.entities (consumed → removed + destroyed).
  assert.equal(entitiesOf(scene).filter((e) => e.kind === 'key').length, 0, 'the key left __GAME__.entities on collect');
  assert.equal(scene.rewardsById['key_1'], undefined, 'the key left the interactable set (rewardsById)');

  // 1b OBSERVABLE: scene.keyCount rose by exactly one.
  assert.equal(keyCountOf(scene), 1, 'scene.keyCount incremented by one on collect');

  // 1c OBSERVABLE: key.collected logged once with {keyId,keyCount}.
  const collected = bus.log.filter((e) => e.name === 'key.collected');
  assert.equal(collected.length, 1, 'key.collected logged exactly once');
  assert.equal(collected[0].payload.keyId, 'key_1', 'key.collected carries the auto-derived keyId');
  assert.equal(collected[0].payload.keyCount, 1, 'key.collected carries the new keyCount');
});

// COUNTERFACTUAL guard for event 1: overlapping a NON-key entity changes nothing —
// the same observable a no-op'd collectKey() would show (proves the assertion bites).
check('key.collected — counterfactual: overlapping a non-key entity does NOT collect, count stays 0, no event', () => {
  const bus = makeBus();
  const scene = makeScene(makePlayer(0, 0), bus);
  const sys = new KeyDoorLock({});
  sys.attach(scene);
  sys.setupCollisions();

  const wall = makeEntity(scene.decorations, scene.rewardsById, 'wall', 'wall_1', 10, 10);
  driveOverlap(scene, wall);

  assert.equal(keyCountOf(scene), 0, 'scene.keyCount stays 0 when no key is collected');
  assert.equal(entitiesOf(scene).filter((e) => e.kind === 'wall').length, 1, 'the non-key entity is untouched');
  assert.equal(bus.log.filter((e) => e.name === 'key.collected').length, 0, 'no key.collected when no key is collected');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT 2 — door.unlocked (drivenBy: move — player touches a locked door while
//            scene.keyCount > 0)
//  expect: the door entity becomes non-solid (its blocked region is now reachable
//          in __GAME__.entities) and scene.keyCount decrements by one;
//          door.unlocked logged.
// ════════════════════════════════════════════════════════════════════════════
check('door.unlocked — touching a locked door with a key spends it, makes the door non-solid (leaves entities), and logs the event', () => {
  const player = makePlayer(200, 200);
  const bus = makeBus();
  const scene = makeScene(player, bus);
  const sys = new KeyDoorLock({});
  sys.attach(scene);
  sys.setupCollisions();

  // First COLLECT a key (the real precondition — keyCount>0 via the real verb).
  const key = makeEntity(scene.decorations, scene.rewardsById, 'key', 'key_1', 50, 60, { __keyId: 'key_1' });
  driveOverlap(scene, key);
  assert.equal(keyCountOf(scene), 1, 'precondition: a key was collected (keyCount === 1)');

  // Spawn the LOCKED door.
  const door = makeEntity(scene.decorations, scene.rewardsById, 'locked_door', 'door_1', 300, 300);
  assert.equal(entitiesOf(scene).filter((e) => e.kind === 'locked_door').length, 1, 'the locked door is on the board (solid, blocking)');

  // Sanity: the door collider's processCallback reports the door as SOLID while locked.
  const col = scene.__colliders[0];
  assert.ok(col, 'a door collider was registered (the door is solid until unlocked)');
  assert.equal(col.processCb(player, door), true, 'the locked door is solid (collider processCallback allows the collision)');

  // DRIVE the move-into-door verb through the REAL overlap callback (what the engine
  // invokes when the player touches the door), handing it the live door sprite.
  driveOverlap(scene, door);

  // 2a OBSERVABLE: the door became NON-SOLID + LEFT __GAME__.entities (region reachable).
  assert.equal(entitiesOf(scene).filter((e) => e.kind === 'locked_door').length, 0, 'the door left __GAME__.entities (the blocked region is now reachable)');
  assert.equal(door.body.enable, false, 'the door body is disabled (non-solid)');
  assert.equal(col.processCb(player, door), false, 'the now-opened door is non-solid (collider processCallback rejects)');

  // 2b OBSERVABLE: scene.keyCount decremented by one (the key was spent).
  assert.equal(keyCountOf(scene), 0, 'scene.keyCount decremented by one on unlock (the key was spent)');

  // 2c OBSERVABLE: door.unlocked logged once with {doorId,keyCount}.
  const unlocked = bus.log.filter((e) => e.name === 'door.unlocked');
  assert.equal(unlocked.length, 1, 'door.unlocked logged exactly once');
  assert.equal(unlocked[0].payload.doorId, 'door_1', 'door.unlocked carries the auto-derived doorId');
  assert.equal(unlocked[0].payload.keyCount, 0, 'door.unlocked carries the decremented keyCount');
});

// COUNTERFACTUAL guard for event 2: touching a locked door with NO key leaves it
// SOLID + present and logs nothing — the same observable a no-op'd tryUnlock() shows.
check('door.unlocked — counterfactual: touching a locked door with no key leaves it solid + present, no event', () => {
  const player = makePlayer(200, 200);
  const bus = makeBus();
  const scene = makeScene(player, bus);
  const sys = new KeyDoorLock({});
  sys.attach(scene);
  sys.setupCollisions();

  const door = makeEntity(scene.decorations, scene.rewardsById, 'locked_door', 'door_1', 300, 300);
  assert.equal(keyCountOf(scene), 0, 'no key held');

  driveOverlap(scene, door); // touch with keyCount===0 — must NOT open

  assert.equal(entitiesOf(scene).filter((e) => e.kind === 'locked_door').length, 1, 'the door stays present (still blocking) with no key');
  assert.equal(door.body.enable, true, 'the door stays solid (body enabled) with no key');
  assert.equal(bus.log.filter((e) => e.name === 'door.unlocked').length, 0, 'no door.unlocked when there is no key to spend');
});

// EVENT 2 (the matched-key rule, supports the `expect`'s usable-key clause) — with
// matchKeys on, a door tagged __requiredKey opens ONLY when the matching key was
// collected; the WRONG key leaves it solid (no spend, no emit), the RIGHT key opens it.
check('door.unlocked — matched-key rule: the wrong key leaves the door locked; the right key opens it', () => {
  const player = makePlayer(200, 200);
  const bus = makeBus();
  const scene = makeScene(player, bus);
  const sys = new KeyDoorLock({ matchKeys: true });
  sys.attach(scene);
  sys.setupCollisions();

  // Collect a key whose id is 'bronze'.
  const bronze = makeEntity(scene.decorations, scene.rewardsById, 'key', 'bronze', 50, 60, { __keyId: 'bronze' });
  driveOverlap(scene, bronze);
  assert.equal(keyCountOf(scene), 1, 'the bronze key was collected');

  // A door requiring 'gold' — the bronze key must NOT open it.
  const goldDoor = makeEntity(scene.decorations, scene.rewardsById, 'locked_door', 'gold_door', 300, 300, { __requiredKey: 'gold' });
  driveOverlap(scene, goldDoor);
  assert.equal(entitiesOf(scene).filter((e) => e.id === 'gold_door').length, 1, 'the gold door stays locked for a bronze key');
  assert.equal(keyCountOf(scene), 1, 'no key spent on the wrong door');
  assert.equal(bus.log.filter((e) => e.name === 'door.unlocked').length, 0, 'no door.unlocked for the wrong key');

  // A door requiring 'bronze' — the held bronze key DOES open it.
  const bronzeDoor = makeEntity(scene.decorations, scene.rewardsById, 'locked_door', 'bronze_door', 400, 400, { __requiredKey: 'bronze' });
  driveOverlap(scene, bronzeDoor);
  assert.equal(entitiesOf(scene).filter((e) => e.id === 'bronze_door').length, 0, 'the bronze door opened for the matching key (left entities)');
  assert.equal(keyCountOf(scene), 0, 'the bronze key was spent on the matching door');
  assert.equal(bus.log.filter((e) => e.name === 'door.unlocked').length, 1, 'door.unlocked fired once for the matching key');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
