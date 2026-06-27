/**
 * BonusFruit — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the two surface() events actually FIRE at runtime by driving the REAL
 * verb on the REAL BonusFruit class and asserting each declared `expect`
 * transition on the OBSERVABLE state — the same state the engine's __GAME__
 * adapter reads:
 *   - __GAME__.entities  ← scene.entities.getChildren() (hook.ts collectEntities,
 *                          lines 136-153: walk getChildren(), drop active===false,
 *                          read __id/__type).
 *   - __GAME__.score     ← scene.registry.get('score') (hook.ts line 261; the
 *                          single source addScore/setScore writes via score.ts).
 *
 * The verb is driven through the system's OWN wiring, never a back-door:
 *   - the spawn gate is driven by emitting the standardized `reward.collected`
 *     bus event the SUT subscribes to in attach() (the real dot-clear seam) —
 *     crossing the declared threshold;
 *   - collect is driven by invoking the REAL physics.add.overlap callback the SUT
 *     registers in setupCollisions(), passing the live fruit sprite the engine
 *     would hand it on a player↔fruit overlap.
 *
 * Real objects: the system under test, a real getChildren-backed entities group,
 * the recording EventBus that ALSO dispatches (.on/.emit) so the real
 * reward.collected→notifyDotCleared subscription fires, a real registry-backed
 * score host (score.ts addScore writes through it), and a settable scene clock for
 * the bounded window. The scene is the harness boundary — a minimal Phaser-shaped
 * host (headless Phaser can't render), but it owns NO logic under test: every
 * count/threshold/spawn/score/window decision is the component's own code.
 *
 * COUNTERFACTUAL (meaningfulness):
 *   - fruit.spawned: if spawnFruit() (or the maybeSpawnForCount gate) is no-op'd,
 *     NO sprite enters scene.entities and NO 'fruit.spawned' is recorded →
 *     assertions 1a/1b fail. Exercised directly as a guard: a sub-threshold dot
 *     count drives the gate but does NOT cross, so nothing spawns/logs — the same
 *     observable a broken spawn would show.
 *   - fruit.collected: if collect() is no-op'd, the fruit never leaves entities,
 *     the score never bumps, and no 'fruit.collected' is recorded → 2a/2b/2c
 *     fail. Idempotence is exercised: a second overlap must NOT double-score.
 */
import assert from 'node:assert/strict';
// Dynamic import: the source carries a type-only `@contract` import that trips
// tsx's static named-export resolution; import() loads the REAL class cleanly.
const { BonusFruit } = (await import('../BonusFruit.ts')) as typeof import('../BonusFruit.ts');

// ── observable adapter — the literal read __GAME__.entities does over a group ──
// Mirrors templates/core/src/hook.ts collectEntities() for the `entities` group
// (lines 136-153). NOT reimplemented logic — the literal read the real oracle does.
function entitiesOf(scene: any): Array<{ id: string; type: string; x: number; y: number }> {
  const group = scene.entities;
  const out: any[] = [];
  if (!group || typeof group.getChildren !== 'function') return out;
  for (const child of group.getChildren()) {
    if (!child || child.active === false) continue;
    out.push({
      id: child.__id ?? child.__type ?? 'entity',
      type: child.__type ?? 'entity',
      x: child.x ?? 0,
      y: child.y ?? 0,
    });
  }
  return out;
}

// __GAME__.score — the literal read hook.ts does: scene.registry.get('score').
function scoreOf(scene: any): number {
  return (scene.registry.get('score') as number) ?? 0;
}

// ── a real getChildren-backed Phaser group (what scene.entities is to the adapter) ──
function makeGroup() {
  const items: any[] = [];
  return {
    add: (o: any) => { if (!items.includes(o)) items.push(o); },
    remove: (o: any, _a?: boolean, _b?: boolean) => { const i = items.indexOf(o); if (i >= 0) items.splice(i, 1); },
    getChildren: () => items.slice(),
  };
}

// ── a real recording EventBus that ALSO dispatches (so the SUT's own
//    reward.collected subscription actually fires). Every emit is logged AND
//    delivered to registered listeners — a real bus, not a stub. ──
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

// ── a real registry-backed score host (score.ts addScore reads/writes here) ──
function makeRegistry() {
  const store = new Map<string, unknown>();
  return { get: (k: string) => store.get(k), set: (k: string, v: unknown) => { store.set(k, v); } };
}

/**
 * Build a minimal Phaser-shaped scene host carrying the REAL bus + entities group
 * + registry + a settable clock. physics.add.sprite mints a plain real object (no
 * rendering); physics.add.overlap RECORDS the (player, group, cb) so the test can
 * drive the REAL collide callback the SUT registers. game.events is the
 * score.ts/setScore emit sink. time.now is a settable clock for the window.
 */
function makeScene(player: any, bus: ReturnType<typeof makeBus>) {
  const clock = { now: 1000 };
  const overlaps: Array<{ a: any; b: any; cb: (p: any, o: any) => void }> = [];
  const registry = makeRegistry();
  const mkBody = () => ({ enable: true, setAllowGravity() {}, setImmovable() {} });
  return {
    __overlaps: overlaps,
    __clock: clock,
    player,
    entities: makeGroup(),
    eventBus: bus,
    registry,
    game: { events: { emit: (_e: string, ..._a: unknown[]) => {} } },
    gameCompleted: false,
    mapWidth: 432,
    mapHeight: 768,
    time: { get now() { return clock.now; } },
    textures: { exists: (_k: string) => false }, // force the '__px' placeholder path (headless)
    add: {},
    physics: {
      add: {
        group: () => makeGroup(),
        sprite: (x: number, y: number, _key?: string) => ({
          x, y, body: mkBody(), active: true,
          setDisplaySize(_w: number, _h: number) {},
          destroy() { this.active = false; },
        }),
        overlap: (a: any, b: any, cb: (p: any, o: any) => void) => { overlaps.push({ a, b, cb }); },
      },
    },
    fireEffect: (_n: string, _x: number, _y: number) => {},
  };
}

// A real player object (position only — the overlap is engine-detected; here we
// drive the recorded callback directly with the fruit sprite, as the engine would).
function makePlayer(x: number, y: number) {
  return { x, y, active: true };
}

// Drive a player↔fruit overlap through the REAL callback the SUT registered.
function driveOverlap(scene: any, fruitSprite: any) {
  for (const o of scene.__overlaps) o.cb(scene.player, fruitSprite);
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT 1 — fruit.spawned (drivenBy: cleared-dot count crosses a threshold)
//  expect: a high-value fruit entity appears at the declared cell in
//          __GAME__.entities for the bounded window; fruit.spawned logged.
// ════════════════════════════════════════════════════════════════════════════
check('fruit.spawned — crossing the dot threshold (via real reward.collected) spawns a fruit into entities + logs the event', () => {
  const player = makePlayer(100, 100);
  const bus = makeBus();
  const scene = makeScene(player, bus);
  // threshold 3: a tiny declared value so we drive the gate with 3 real dot-clears.
  const sys = new BonusFruit({ thresholds: [3], value: 500, spawnCell: { x: 200, y: 300 } });
  sys.attach(scene);

  // precondition: no fruit on the board.
  assert.equal(entitiesOf(scene).filter((e) => e.type === 'collectible').length, 0, 'no fruit before the threshold');

  // DRIVE the spawn gate through the SUT's OWN subscription: emit the standardized
  // reward.collected bus event for each dot eaten. Two clears stay BELOW the
  // threshold (must NOT spawn); the third CROSSES it (must spawn exactly one).
  bus.emit('reward.collected', {});
  bus.emit('reward.collected', {});
  assert.equal(entitiesOf(scene).filter((e) => e.type === 'collectible').length, 0, 'no fruit below the threshold (2 < 3)');
  assert.equal(bus.log.filter((e) => e.name === 'fruit.spawned').length, 0, 'no fruit.spawned below the threshold');

  bus.emit('reward.collected', {}); // 3rd dot — crosses the threshold

  // 1a OBSERVABLE: exactly one fruit entity now exists at the declared cell.
  const fruits = entitiesOf(scene).filter((e) => e.type === 'collectible');
  assert.equal(fruits.length, 1, 'exactly one fruit entered __GAME__.entities at the threshold');
  assert.equal(fruits[0].x, 200, 'fruit spawned at the declared cell x');
  assert.equal(fruits[0].y, 300, 'fruit spawned at the declared cell y');

  // 1b OBSERVABLE: fruit.spawned logged once with {fruitId,value}.
  const spawned = bus.log.filter((e) => e.name === 'fruit.spawned');
  assert.equal(spawned.length, 1, 'fruit.spawned logged exactly once');
  assert.equal(spawned[0].payload.value, 500, 'fruit.spawned carries the declared bonus value');
  assert.equal(typeof spawned[0].payload.fruitId, 'string', 'fruit.spawned carries a fruitId');
});

// COUNTERFACTUAL guard for event 1: a sub-threshold count drives the gate but does
// NOT cross → NOTHING enters entities and NOTHING is logged. This is the same
// observable a no-op'd spawnFruit() would show (proves the assertion bites).
check('fruit.spawned — counterfactual: below the threshold → no entity, no event (proves the assertion bites)', () => {
  const bus = makeBus();
  const scene = makeScene(makePlayer(0, 0), bus);
  const sys = new BonusFruit({ thresholds: [5], value: 100 });
  sys.attach(scene);
  bus.emit('reward.collected', {});
  bus.emit('reward.collected', {}); // 2 dots, threshold is 5 — no crossing
  assert.equal(entitiesOf(scene).filter((e) => e.type === 'collectible').length, 0, 'no fruit when the threshold is not crossed');
  assert.equal(bus.log.filter((e) => e.name === 'fruit.spawned').length, 0, 'no fruit.spawned when the gate does not fire');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT 2 — fruit.collected (drivenBy: player overlaps the fruit in-window)
//  expect: the fruit leaves __GAME__.entities and __GAME__.score increases by the
//          bonus value exactly once (idempotent across respawn); fruit.collected
//          logged.
// ════════════════════════════════════════════════════════════════════════════
check('fruit.collected — overlapping the live fruit bumps score by the bonus, removes it from entities, and logs the event', () => {
  const player = makePlayer(200, 300);
  const bus = makeBus();
  const scene = makeScene(player, bus);
  const sys = new BonusFruit({ thresholds: [1], value: 500, spawnCell: { x: 200, y: 300 } });
  sys.attach(scene);
  sys.setupCollisions(); // wires the REAL player↔fruit overlap callback

  // spawn the fruit by driving the gate (1 dot crosses threshold 1).
  bus.emit('reward.collected', {});
  const before = entitiesOf(scene).filter((e) => e.type === 'collectible');
  assert.equal(before.length, 1, 'fruit is on the board (precondition for collect)');
  const fruitSprite = scene.entities.getChildren().find((c: any) => c.__type === 'collectible');
  assert.equal(scoreOf(scene), 0, 'score is 0 before collect');

  // DRIVE the collect verb through the REAL overlap callback (what the engine
  // invokes on a player↔fruit overlap), handing it the live fruit sprite.
  driveOverlap(scene, fruitSprite);

  // 2a OBSERVABLE: the fruit LEFT __GAME__.entities.
  assert.equal(entitiesOf(scene).filter((e) => e.type === 'collectible').length, 0, 'fruit left __GAME__.entities on collect');

  // 2b OBSERVABLE: __GAME__.score rose by exactly the bonus value.
  assert.equal(scoreOf(scene), 500, '__GAME__.score increased by the bonus value');

  // 2c OBSERVABLE: fruit.collected logged once with {fruitId,value}.
  const collected = bus.log.filter((e) => e.name === 'fruit.collected');
  assert.equal(collected.length, 1, 'fruit.collected logged exactly once');
  assert.equal(collected[0].payload.value, 500, 'fruit.collected carries the bonus value');
  assert.equal(typeof collected[0].payload.fruitId, 'string', 'fruit.collected carries a fruitId');

  // 2d IDEMPOTENT: a SECOND overlap of the (now removed) fruit must NOT re-score
  // or re-log — the per-fruit one-shot latch. (The fruit is gone, so the callback
  // guards on sprite !== this.fruit.sprite; even forcing it, collect() latches.)
  driveOverlap(scene, fruitSprite);
  assert.equal(scoreOf(scene), 500, 'a second overlap does NOT double-score (one-shot latch)');
  assert.equal(bus.log.filter((e) => e.name === 'fruit.collected').length, 1, 'fruit.collected logged exactly once across a double overlap');
});

// EVENT 2 — the score-once latch is PER-FRUIT, so a RESPAWN scores again (the
// `expect` clause "idempotent across respawn"). A second threshold spawns a fresh
// fruit; collecting it adds the bonus a second time.
check('fruit.collected — a respawned fruit scores AGAIN (the latch is per-fruit, not global)', () => {
  const player = makePlayer(200, 300);
  const bus = makeBus();
  const scene = makeScene(player, bus);
  const sys = new BonusFruit({ thresholds: [1, 2], value: 300, spawnCell: { x: 200, y: 300 } });
  sys.attach(scene);
  sys.setupCollisions();

  bus.emit('reward.collected', {}); // dot 1 → fruit A (threshold 1)
  const fruitA = scene.entities.getChildren().find((c: any) => c.__type === 'collectible');
  driveOverlap(scene, fruitA);
  assert.equal(scoreOf(scene), 300, 'fruit A scored once');

  bus.emit('reward.collected', {}); // dot 2 → fruit B (threshold 2) — a FRESH fruit
  assert.equal(entitiesOf(scene).filter((e) => e.type === 'collectible').length, 1, 'a fresh fruit B is on the board');
  const fruitB = scene.entities.getChildren().find((c: any) => c.__type === 'collectible');
  assert.notEqual(fruitB, fruitA, 'fruit B is a distinct sprite from A');
  driveOverlap(scene, fruitB);

  // OBSERVABLE: the respawned fruit scored AGAIN (total = 2 * value) and is gone.
  assert.equal(scoreOf(scene), 600, 'the respawned fruit scored again (per-fruit latch)');
  assert.equal(entitiesOf(scene).filter((e) => e.type === 'collectible').length, 0, 'fruit B left entities on its own collect');
  assert.equal(bus.log.filter((e) => e.name === 'fruit.collected').length, 2, 'two distinct fruit.collected emits across two fruits');
});

// EVENT (lifecycle, supports event 1's `expect` "for the bounded window") — the
// fruit AUTO-REMOVES when the window lapses untaken, leaving __GAME__.entities
// with NO fruit.collected (a lapse is not a player collect — no emit). Drives the
// real update() clock path.
check('window lapse — an untaken fruit auto-removes after windowMs (no fruit.collected, no score)', () => {
  const bus = makeBus();
  const scene = makeScene(makePlayer(0, 0), bus);
  const sys = new BonusFruit({ thresholds: [1], value: 200, windowMs: 1000, spawnCell: { x: 50, y: 50 } });
  sys.attach(scene);
  bus.emit('reward.collected', {}); // spawn at clock now=1000 → expires at 2000
  assert.equal(entitiesOf(scene).filter((e) => e.type === 'collectible').length, 1, 'fruit is on the board');

  scene.__clock.now += 1500; // advance past expiresAt (1000 + 1000 = 2000)
  sys.update();

  assert.equal(entitiesOf(scene).filter((e) => e.type === 'collectible').length, 0, 'the untaken fruit left __GAME__.entities on lapse');
  assert.equal(scoreOf(scene), 0, 'a lapse does NOT score');
  assert.equal(bus.log.filter((e) => e.name === 'fruit.collected').length, 0, 'a lapse emits NO fruit.collected (not a player collect)');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
