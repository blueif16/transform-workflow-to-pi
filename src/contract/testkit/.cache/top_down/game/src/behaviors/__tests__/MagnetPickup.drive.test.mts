/**
 * MagnetPickup — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the TWO surface() events ('pickup.magnetized', 'pickup.collected')
 * actually FIRE at runtime by driving the REAL verb (`move` — the player closes
 * within the magnet radius) on the REAL MagnetPickup behavior, attached to a REAL
 * collectible owner sitting in a REAL `decorations` group, and asserting each
 * declared `expect` transition on OBSERVABLE state:
 *
 *  - pickup.magnetized: once the player enters magnetRadius the pickup STARTS
 *    drifting — its x/y (the values __GAME__.entities reads off the decorations
 *    group) moves toward the player each step instead of staying static; the
 *    event is logged once on the scene's shared bus with {pickupId}.
 *  - pickup.collected: the drifting pickup reaches the player and is auto-collected
 *    — it LEAVES __GAME__.entities (removed from the decorations group + destroyed)
 *    and its value is credited to __GAME__.score (registry 'score') EXACTLY once;
 *    the event is logged once with {pickupId,value}.
 *
 * Real objects under the harness: the behavior under test, a real recording
 * EventBus, a real Map-backed registry (the single 'score' source the __GAME__
 * adapter reads), a real `decorations` group whose getChildren()/remove() mirror
 * Phaser's, and a real `consumeReward(sprite)` that mirrors DataTopDownScene's
 * seam (latch via __consumed, drop from rewardsById + the group, disable the body,
 * destroy → the sprite leaves __GAME__.entities). The scene is only the harness
 * boundary — it owns NO logic under test: every range / arm / drift / contact /
 * score-credit / emit decision is the component's own code.
 *
 * __GAME__.entities is modeled with `entityRows(scene)`, the LITERAL read
 * collectEntities (templates/core/src/hook.ts:103) does over the decorations group:
 * skip child.active === false, otherwise project {id,x,y}. A consumed pickup leaves
 * that list because consumeReward removes it from the group AND destroy() sets
 * active=false — exactly the two ways collectEntities drops a child.
 *
 * The DRIVE is the `move` verb's two real moments at the component's own seams:
 *   - pullStep(dt) — arm-if-in-range + one drift step (what update() calls each
 *     frame with the scene delta). We tick it repeatedly to simulate the player
 *     closing distance; the FIRST in-range step arms (pickup.magnetized).
 *   - the same loop carries the pickup to contact, where it auto-collects
 *     (pickup.collected). We also assert update() (the per-frame entry) drives the
 *     identical effect via the scene's game.loop.delta.
 *
 * COUNTERFACTUAL (meaningfulness): if pullStep()/collect() were no-op'd, the pickup
 * would never drift (x/y stay static, no pickup.magnetized) and never collect (it
 * would stay in __GAME__.entities, score unchanged, no pickup.collected) → the
 * magnetize + collect assertions all fail. The OUTSIDE-RADIUS case is the built-in
 * inverse guard: with the player beyond magnetRadius, the SAME drive must leave the
 * pickup put and emit NOTHING — a test that "passed regardless" would pass the
 * in-range and out-of-range cases identically; they diverge ONLY because the real
 * range/arm logic runs. The single-fire latch is the third bite (exactly-once score
 * + event).
 */
import assert from 'node:assert/strict';
// Dynamic import: the source module carries a type-only `@contract` import that
// trips tsx's static named-export resolution; `import()` loads the REAL class
// cleanly (same object, no aliasing) — same approach as PushBlock.drive.test.mts.
const { MagnetPickup } = (await import('../MagnetPickup.ts')) as typeof import('../MagnetPickup.ts');

// ── a real recording EventBus (collect every emit on the PUSH channel) ──
function makeBus() {
  const log: Array<{ name: string; payload: any }> = [];
  return { log, emit: (name: string, payload?: any) => { log.push({ name, payload }); } };
}

// ── a real Map-backed registry — the single 'score' source the adapter reads ──
function makeRegistry(seed = 0) {
  const m = new Map<string, any>([['score', seed]]);
  return { get: (k: string) => m.get(k), set: (k: string, v: any) => { m.set(k, v); } };
}

// ── a real getChildren()/remove()-backed group (what scene.decorations is) ──
function makeGroup(items: any[] = []) {
  return {
    add: (o: any) => { if (!items.includes(o)) items.push(o); },
    getChildren: () => items.slice(),
    remove: (o: any) => { const i = items.indexOf(o); if (i >= 0) items.splice(i, 1); },
  };
}

// A real collectible owner sprite at (x,y): the shape __GAME__ + the behavior read
// (x/y, __id, __value override, a body whose reset() the drift calls, active flag,
// destroy() that drops it from __GAME__.entities). scene wired below.
function makePickup(x: number, y: number, id = 'shardA', value?: number) {
  const sprite: any = {
    __id: id, __type: 'collectible', active: true,
    ...(typeof value === 'number' ? { __value: value } : {}),
    x, y,
    body: { enable: true, reset(_x: number, _y: number) {} },
    scene: null as any,
    destroy() { this.active = false; this.__destroyed = true; },
  };
  return sprite;
}

// A real player at (x,y), active. The behavior reads scene.player.x/y each step.
function makePlayer(x: number, y: number) {
  return { x, y, active: true };
}

// Minimal Phaser-shaped scene host: the REAL bus, registry, decorations group,
// player, and a consumeReward seam that MIRRORS DataTopDownScene.consumeReward
// (the canonical collection seam — latch, fire reward.collected, drop from
// rewardsById + the group, disable the body, destroy). game.loop.delta drives the
// per-frame update() path.
function makeScene(player: any, bus: ReturnType<typeof makeBus>, registry: ReturnType<typeof makeRegistry>, decorations: any[] = [], deltaMs = 16.7) {
  const group = makeGroup(decorations);
  const rewardsById: Record<string, any> = {};
  for (const d of decorations) if (d.__id) rewardsById[d.__id] = d;
  return {
    player, eventBus: bus, registry,
    decorations: group, rewardsById,
    game: { loop: { delta: deltaMs } },
    consumeReward(sprite: any) {
      if (!sprite || sprite.__consumed) return;
      sprite.__consumed = true;
      const id = sprite.__id as string | undefined;
      bus.emit('reward.collected', { id, x: sprite.x ?? 0, y: sprite.y ?? 0 });
      if (id && rewardsById[id]) delete rewardsById[id];
      if (sprite.body) sprite.body.enable = false;
      group.remove(sprite);
      sprite.destroy();
    },
  };
}

// ── the literal __GAME__.entities read (collectEntities over decorations) ──
// Skip child.active === false (a destroyed/removed sprite); project the entity row.
function entityRows(scene: any): Array<{ id: string; x: number; y: number }> {
  const rows: Array<{ id: string; x: number; y: number }> = [];
  const p = scene.player;
  if (p && p.active !== false) rows.push({ id: 'player', x: p.x, y: p.y });
  for (const child of scene.decorations.getChildren()) {
    if (!child || child.active === false) continue;
    rows.push({ id: child.__id ?? 'pickup', x: child.x, y: child.y });
  }
  return rows;
}
const score = (scene: any): number => Number(scene.registry.get('score') ?? 0);

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — pickup.magnetized (drivenBy: move — the player enters the magnet radius)
//  expect: the pickup begins drifting toward the player (its x/y in __GAME__.entities
//          moves toward the player each step instead of staying static); logged once.
// ════════════════════════════════════════════════════════════════════════════
check('pickup.magnetized — player inside magnetRadius arms the pull: pickup drifts toward player + logs once', () => {
  // Player at origin; pickup 100px to the right — inside the default magnetRadius
  // (140), outside collectRadius (18). One pullStep should ARM + take one drift step.
  const player = makePlayer(0, 0);
  const pickup = makePickup(100, 0, 'shardA');
  const bus = makeBus();
  const registry = makeRegistry(0);
  const scene = makeScene(player, bus, registry, [pickup]);
  pickup.scene = scene;

  const magnet = new MagnetPickup({ magnetRadius: 140, pullSpeed: 40, pullAccel: 320, collectRadius: 18 });
  magnet.attach(pickup);

  // precondition: pickup is static in __GAME__.entities, nothing logged, not armed.
  assert.equal(bus.log.length, 0, 'no events before the drive');
  assert.equal(magnet.isMagnetized(), false, 'not armed before the player is in range');
  const beforeX = pickup.x;
  const inRowsBefore = entityRows(scene).some((r) => r.id === 'shardA');
  assert.equal(inRowsBefore, true, 'pickup present in __GAME__.entities before the drive');

  // DRIVE the `move` verb: one drift step with the player already in range.
  magnet.pullStep(0.1); // 0.1s step

  // 1a OBSERVABLE: the pickup STARTED drifting toward the player — its x in
  // __GAME__.entities decreased toward the player (player at x=0), not static.
  const afterX = entityRows(scene).find((r) => r.id === 'shardA')!.x;
  assert.ok(afterX < beforeX, `pickup x drifted toward the player (${beforeX} → ${afterX})`);
  assert.equal(pickup.y, 0, 'pickup y unchanged on a horizontal pull');

  // 1b OBSERVABLE: pickup.magnetized logged exactly once with {pickupId}.
  const mag = bus.log.filter((e) => e.name === 'pickup.magnetized');
  assert.equal(mag.length, 1, 'pickup.magnetized logged exactly once on arm');
  assert.equal(mag[0].payload.pickupId, 'shardA', 'payload carries the pickup id');

  // 1c: not yet collected (still outside collectRadius after one small step).
  assert.equal(bus.log.filter((e) => e.name === 'pickup.collected').length, 0, 'not collected after one short step');
  assert.equal(magnet.isMagnetized(), true, 'pull armed');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — pickup.magnetized OUTSIDE-RADIUS inverse (the `expect` clause: "stays
//  static when outside the radius"). Same drive, but the player is BEYOND
//  magnetRadius → NO drift, NO arm, NO event. The meaningful counterfactual: a test
//  that passed regardless would pass this identically to the in-range case above.
// ════════════════════════════════════════════════════════════════════════════
check('pickup.magnetized — player OUTSIDE magnetRadius: pickup stays put, NO arm, NO event', () => {
  const player = makePlayer(0, 0);
  const pickup = makePickup(300, 0, 'shardB'); // 300px > magnetRadius 140
  const bus = makeBus();
  const registry = makeRegistry(0);
  const scene = makeScene(player, bus, registry, [pickup]);
  pickup.scene = scene;

  const magnet = new MagnetPickup({ magnetRadius: 140, pullSpeed: 40, pullAccel: 320, collectRadius: 18 });
  magnet.attach(pickup);
  const before = entityRows(scene).find((r) => r.id === 'shardB')!;

  // DRIVE the same verb from out of range, several frames.
  magnet.pullStep(0.1);
  magnet.pullStep(0.1);
  magnet.pullStep(0.1);

  const after = entityRows(scene).find((r) => r.id === 'shardB')!;
  // OBSERVABLE: pickup stayed exactly put (x/y unchanged), not armed, no event.
  assert.equal(after.x, before.x, 'out-of-range: pickup x unchanged');
  assert.equal(after.y, before.y, 'out-of-range: pickup y unchanged');
  assert.equal(magnet.isMagnetized(), false, 'out-of-range: not armed');
  assert.equal(bus.log.filter((e) => e.name === 'pickup.magnetized').length, 0, 'out-of-range: NO pickup.magnetized');
  assert.equal(bus.log.filter((e) => e.name === 'pickup.collected').length, 0, 'out-of-range: NO pickup.collected');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — pickup.collected (drivenBy: move — the magnetized pickup reaches the
//  player and is auto-collected).
//  expect: the pickup LEAVES __GAME__.entities; its value is credited to
//          __GAME__.score exactly once; pickup.collected logged.
// ════════════════════════════════════════════════════════════════════════════
check('pickup.collected — drifting pickup reaches the player: leaves __GAME__.entities + credits score once + logs', () => {
  // Player at origin; pickup 100px away, value 50. We tick the drift to completion;
  // the accelerating ramp + the per-step contact check auto-collect it.
  const player = makePlayer(0, 0);
  const pickup = makePickup(100, 0, 'shardC', 50); // __value=50 per-entity override
  const bus = makeBus();
  const registry = makeRegistry(10); // start score 10 → expect 60 after a single +50
  const scene = makeScene(player, bus, registry, [pickup]);
  pickup.scene = scene;

  const magnet = new MagnetPickup({ magnetRadius: 140, pullSpeed: 40, pullAccel: 320, collectRadius: 18 });
  magnet.attach(pickup);

  assert.equal(score(scene), 10, 'score starts at the seeded 10');
  assert.equal(entityRows(scene).some((r) => r.id === 'shardC'), true, 'pickup present in entities before collect');

  // DRIVE: step the drift each frame (0.1s) until collected or a safety cap.
  let steps = 0;
  while (!magnet.isCollected() && steps < 200) { magnet.pullStep(0.1); steps += 1; }

  // OBSERVABLE 1: it collected (the verb completed within the step budget).
  assert.equal(magnet.isCollected(), true, `pickup auto-collected after ${steps} drift steps`);

  // OBSERVABLE 2: the pickup LEFT __GAME__.entities (removed from decorations +
  // active=false via destroy → collectEntities drops it).
  assert.equal(entityRows(scene).some((r) => r.id === 'shardC'), false, 'pickup left __GAME__.entities after collect');
  assert.equal(pickup.active, false, 'pickup sprite deactivated (destroy)');
  assert.equal(scene.rewardsById['shardC'], undefined, 'pickup removed from rewardsById');

  // OBSERVABLE 3: value credited to __GAME__.score EXACTLY once (10 + 50 = 60).
  assert.equal(score(scene), 60, 'score credited the pickup value exactly once (10 → 60)');

  // OBSERVABLE 4: pickup.collected logged once with {pickupId,value}.
  const col = bus.log.filter((e) => e.name === 'pickup.collected');
  assert.equal(col.length, 1, 'pickup.collected logged exactly once');
  assert.equal(col[0].payload.pickupId, 'shardC', 'payload carries the pickup id');
  assert.equal(col[0].payload.value, 50, 'payload carries the credited value');

  // Sanity: the magnetize fired before the collect (the player did cross the radius).
  assert.equal(bus.log.filter((e) => e.name === 'pickup.magnetized').length, 1, 'magnetize fired exactly once en route');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — pickup.collected EXACTLY-ONCE latch (the `expect` clause "credited
//  exactly once"). After collect, ticking again (or calling collect() again) must
//  NOT re-credit the score or re-emit. The third meaningful bite.
// ════════════════════════════════════════════════════════════════════════════
check('pickup.collected — idempotent latch: a second drive after collect does NOT re-credit or re-emit', () => {
  const player = makePlayer(0, 0);
  const pickup = makePickup(40, 0, 'shardD'); // close — collects fast
  const bus = makeBus();
  const registry = makeRegistry(0);
  const scene = makeScene(player, bus, registry, [pickup]);
  pickup.scene = scene;

  const magnet = new MagnetPickup({ magnetRadius: 140, pullSpeed: 40, pullAccel: 320, collectRadius: 18, value: 25 });
  magnet.attach(pickup);

  let steps = 0;
  while (!magnet.isCollected() && steps < 200) { magnet.pullStep(0.1); steps += 1; }
  assert.equal(magnet.isCollected(), true, 'collected');
  const scoreAfterCollect = score(scene);
  const collectedCount = bus.log.filter((e) => e.name === 'pickup.collected').length;
  assert.equal(collectedCount, 1, 'collected once');

  // DRIVE AGAIN: more steps + a direct collect() — both must be clean no-ops.
  magnet.pullStep(0.1);
  magnet.pullStep(0.1);
  magnet.collect();

  assert.equal(score(scene), scoreAfterCollect, 'latch: score NOT re-credited on a second drive');
  assert.equal(bus.log.filter((e) => e.name === 'pickup.collected').length, 1, 'latch: pickup.collected NOT re-emitted');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — the per-frame update() entry drives the identical effect (the real
//  in-game tick path: boundBehaviorOwners → owner.behaviors.update(), reading the
//  scene's game.loop.delta). Proves the move verb fires through update(), not only
//  the bare pullStep seam.
// ════════════════════════════════════════════════════════════════════════════
check('update() — the per-frame tick (game.loop.delta) magnetizes then collects, end to end', () => {
  const player = makePlayer(0, 0);
  const pickup = makePickup(90, 0, 'shardE', 30);
  const bus = makeBus();
  const registry = makeRegistry(0);
  // Big delta (200ms/frame) so the accelerating drift covers 90px within the cap.
  const scene = makeScene(player, bus, registry, [pickup], 200);
  pickup.scene = scene;

  const magnet = new MagnetPickup({ magnetRadius: 140, pullSpeed: 40, pullAccel: 320, collectRadius: 18 });
  magnet.attach(pickup);

  let frames = 0;
  while (!magnet.isCollected() && frames < 500) { magnet.update(); frames += 1; }

  assert.equal(magnet.isCollected(), true, `collected via update() after ${frames} frames`);
  assert.equal(entityRows(scene).some((r) => r.id === 'shardE'), false, 'pickup left __GAME__.entities (via update path)');
  assert.equal(score(scene), 30, 'value credited via update() exactly once');
  assert.equal(bus.log.filter((e) => e.name === 'pickup.magnetized').length, 1, 'update(): magnetize fired once');
  assert.equal(bus.log.filter((e) => e.name === 'pickup.collected').length, 1, 'update(): collected fired once');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
