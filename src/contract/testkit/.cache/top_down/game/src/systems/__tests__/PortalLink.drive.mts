/**
 * PortalLink.drive.mts — RUNTIME DRIVE PROOF for PortalLink (event-protocol conformance).
 *
 * Proves the single surface() event ('entity.teleported') ACTUALLY FIRES at runtime by
 * driving its REAL verb — the per-frame `update()` tick (→ move()) over a player that has
 * STEPPED onto a declared portal mouth — on the REAL PortalLink class, and asserting each
 * declared `expect` transition on OBSERVABLE state, never an internal flag.
 *
 * Surface contract (from PortalLink.surface()):
 *   event    entity.teleported   payload {portalId,toX,toY}
 *   drivenBy "move — the player steps onto a declared portal mouth"
 *   expect   "player.x|y jumps to the paired portal mouth coordinates in __GAME__.player.x|y
 *             (a board-spanning position discontinuity), a re-entry guard prevents an
 *             immediate bounce-back, and the portal pair shows in __GAME__.entities as
 *             type 'portal'; entity.teleported logged"
 *
 * Real objects only:
 *   - the system under test (the REAL PortalLink),
 *   - a REAL getChildren()-backed decorations group — the SAME object the engine's
 *     __GAME__.entities adapter (templates/core/src/hook.ts collectEntities) reads,
 *   - a recording EventBus (collects every emit on the PUSH channel — what the real bus
 *     log is to the verify harness),
 *   - a minimal Phaser-shaped scene host that owns NO logic under test (the teleport
 *     reposition + the per-pair guard are entirely the component's code).
 *
 * Observable entity read (`entitiesOf`): a LITERAL re-implementation of the engine's
 * collectEntities() decorations scan — getChildren() → {id: __id, type: __type, x, y}.
 * PortalLink.spawnMarker() tags each marker sprite (__type='portal', __id='portal_<i>_<a|b>')
 * and adds it to scene.decorations, so the pair surfaces in __GAME__.entities as type 'portal'.
 *
 * COUNTERFACTUAL (meaningfulness): if move()/teleport() were no-op'd, the player's x|y would
 * stay on the mouth it stepped on and no 'entity.teleported' would be recorded → assertions
 * T1a/T1b/T1c fail. If the per-pair re-entry guard were no-op'd, the player landing ON the
 * destination mouth would teleport AGAIN every tick (ping-pong) → assertion T3 (exactly one
 * teleport across two ticks) fails. The "player off every mouth" case (T-counter) is the same
 * observable that fails if teleport fired without a real step-on. All three counterfactuals
 * are exercised as explicit cases below.
 *
 * Run (from repo root):
 *   packages/verify/node_modules/.bin/tsx \
 *     templates/modules/top_down/src/systems/__tests__/PortalLink.drive.mts
 */
import assert from 'node:assert/strict';
// Dynamic import: the source module carries a type-only `@contract` import that trips
// tsx's static named-export resolution; `import()` loads the REAL class cleanly.
const { PortalLink } = (await import('../PortalLink.ts')) as typeof import('../PortalLink.ts');

// ── observable adapter — the literal scan __GAME__.entities does over decorations ──
// Mirrors templates/core/src/hook.ts collectEntities(): getChildren() → {id,type,x,y}
// with type = child.__type, id = child.__id.
function entitiesOf(scene: any, gname = 'decorations'): Array<{ id: string; type: string; x: number; y: number }> {
  const group = scene[gname];
  const out: any[] = [];
  if (!group || typeof group.getChildren !== 'function') return out;
  for (const child of group.getChildren()) {
    if (!child || child.active === false) continue;
    out.push({
      id: child.__id ?? child.name ?? 'entity',
      type: child.__type ?? 'obstacle', // the engine's entityType(): explicit __type tag wins
      x: child.x,
      y: child.y,
    });
  }
  return out;
}

// ── a real getChildren-backed group (what scene.decorations is to the adapter) ──
function makeGroup() {
  const items: any[] = [];
  return {
    add: (o: any) => { if (!items.includes(o)) items.push(o); },
    getChildren: () => items.slice(),
  };
}

// ── a real recording EventBus (collect every emit on the PUSH channel) ──
function makeBus() {
  const log: Array<{ name: string; payload: any }> = [];
  return { log, emit: (name: string, payload?: any) => { log.push({ name, payload }); } };
}

// A real arcade-shaped body whose reset(x,y) repositions (what PortalLink.reposition uses).
function makeBody() {
  return {
    setAllowGravity(_v: boolean) {},
    setImmovable(_v: boolean) {},
    reset(x: number, y: number) { (this as any).__x = x; (this as any).__y = y; },
  };
}

// A real player with an arcade-shaped body (so PortalLink.reposition uses body.reset).
function makePlayer(x: number, y: number) {
  return { x, y, active: true, body: makeBody(), setPosition(nx: number, ny: number) { this.x = nx; this.y = ny; } };
}

/**
 * Build a minimal Phaser-shaped scene host carrying the real player + decorations + bus +
 * the physics/textures stubs PortalLink.spawnMarker reaches for. `time.now` is a mutable
 * scene clock so the re-entry-guard window can be advanced like the real scene loop.
 */
function makeScene(player: any, decorations: ReturnType<typeof makeGroup>, bus: ReturnType<typeof makeBus>) {
  const clock = { now: 0 };
  return {
    player,
    decorations,
    eventBus: bus,
    gameCompleted: false,
    time: clock,
    // physics.add.sprite returns a real marker shaped like the live arcade sprite.
    physics: {
      add: {
        sprite: (x: number, y: number, _key: string) => ({
          x, y, body: makeBody(),
          setDisplaySize(_w: number, _h: number) {}, setTexture(_k: string) {}, setTint(_t: number) {},
          destroy() {},
        }),
      },
    },
    textures: { exists: (_k: string) => false, generate: (_k: string, _c: any) => {} },
    fireEffect: (_n: string, _x: number, _y: number) => {},
  };
}

// One declared portal PAIR, two mouths far apart on the board.
//   mouth a at (60,60).   mouth b at (520,360).
// Stepping onto a teleports to b; stepping onto b teleports to a.
const PORTALS = [{ a: { x: 60, y: 60 }, b: { x: 520, y: 360 } }];

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  SPAWN — the pair surfaces in __GAME__.entities as type 'portal' (the expect's
//  entities clause). Driven by attach() → spawnMarker() into scene.decorations.
// ════════════════════════════════════════════════════════════════════════════
check("entity surface — attach spawns the portal pair into __GAME__.entities as type 'portal'", () => {
  const decorations = makeGroup();
  const scene = makeScene(makePlayer(200, 200), decorations, makeBus());
  const sys = new PortalLink({ portals: PORTALS });
  sys.attach(scene);

  const portals = entitiesOf(scene).filter((e) => e.type === 'portal');
  assert.equal(portals.length, 2, "both mouths surface as type 'portal' in __GAME__.entities");
  const ids = portals.map((p) => p.id).sort();
  assert.deepEqual(ids, ['portal_0_a', 'portal_0_b'], 'mouth ids auto-derived from the pair index');
  // The mouths surface at their declared world centers (observable on entities[*].x|y).
  const a = portals.find((p) => p.id === 'portal_0_a')!;
  const b = portals.find((p) => p.id === 'portal_0_b')!;
  assert.equal(a.x, 60); assert.equal(a.y, 60);
  assert.equal(b.x, 520); assert.equal(b.y, 360);
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — entity.teleported (drivenBy: move — the player steps onto a mouth)
//  expect: player.x|y JUMPS to the paired portal mouth; entity.teleported logged
//          with {portalId,toX,toY}.
// ════════════════════════════════════════════════════════════════════════════
check('entity.teleported — stepping onto mouth a jumps the player to b in __GAME__.player.x|y + logs the event', () => {
  const player = makePlayer(60, 60); // CENTER on mouth a (within radius 28)
  const bus = makeBus();
  const scene = makeScene(player, makeGroup(), bus);
  const sys = new PortalLink({ portals: PORTALS });
  sys.attach(scene);

  // precondition: player ON mouth a, NOT yet teleported, no event logged.
  assert.equal(player.x, 60, 'player on mouth a pre-teleport');
  assert.equal(player.y, 60, 'player on mouth a pre-teleport');
  assert.equal(bus.log.length, 0, 'no event before the move verb runs');

  // DRIVE the verb: a frame tick with the player standing on mouth a (a step-on).
  sys.update();

  // T1a OBSERVABLE: player.x|y JUMPED to the PAIRED mouth b (520,360) — board discontinuity.
  assert.equal(player.x, 520, 'player.x jumped to the paired mouth b (520)');
  assert.equal(player.y, 360, 'player.y jumped to the paired mouth b (360)');

  // T1b OBSERVABLE: entity.teleported logged exactly once with the crossed mouth id.
  const tp = bus.log.filter((e) => e.name === 'entity.teleported');
  assert.equal(tp.length, 1, 'entity.teleported logged exactly once');
  assert.equal(tp[0].payload.portalId, 'portal_0_a', 'portalId = the mouth stepped onto (a)');

  // T1c OBSERVABLE: payload toX/toY name the destination (b's coordinates).
  assert.equal(tp[0].payload.toX, 520, 'toX = paired mouth b x');
  assert.equal(tp[0].payload.toY, 360, 'toY = paired mouth b y');
});

// Symmetry — stepping onto mouth b teleports to mouth a (the pairing both ways).
check('entity.teleported — stepping onto mouth b teleports to mouth a (paired, both directions)', () => {
  const player = makePlayer(520, 360); // CENTER on mouth b
  const bus = makeBus();
  const scene = makeScene(player, makeGroup(), bus);
  const sys = new PortalLink({ portals: PORTALS });
  sys.attach(scene);

  sys.update();

  assert.equal(player.x, 60, 'player.x jumped to mouth a (60)');
  assert.equal(player.y, 60, 'player.y jumped to mouth a (60)');
  const tp = bus.log.filter((e) => e.name === 'entity.teleported');
  assert.equal(tp.length, 1, 'entity.teleported logged once');
  assert.equal(tp[0].payload.portalId, 'portal_0_b', 'portalId = mouth b');
  assert.equal(tp[0].payload.toX, 60, 'toX = mouth a x');
  assert.equal(tp[0].payload.toY, 60, 'toY = mouth a y');
});

// COUNTERFACTUAL guard: a player OFF every mouth does not step on → no teleport, no
// event. This is the same observable that fails if teleport() fired without a real
// step-on (i.e. it proves the assertion bites on the transition, not on presence).
check('entity.teleported — counterfactual: a player off every mouth does NOT teleport and logs nothing', () => {
  const player = makePlayer(300, 200); // far from both mouths (> radius 28 from each)
  const bus = makeBus();
  const scene = makeScene(player, makeGroup(), bus);
  const sys = new PortalLink({ portals: PORTALS });
  sys.attach(scene);

  sys.update();

  assert.equal(player.x, 300, 'player did NOT move (no mouth stepped on)');
  assert.equal(player.y, 200, 'player did NOT move (no mouth stepped on)');
  assert.equal(bus.log.filter((e) => e.name === 'entity.teleported').length, 0, 'no entity.teleported when no mouth is stepped on');
});

// ════════════════════════════════════════════════════════════════════════════
//  THE RE-ENTRY GUARD (the second observable in `expect`): after a teleport the
//  player lands ON the destination mouth; a per-pair guard suppresses an immediate
//  bounce-back. If the guard were broken the player would teleport every tick.
// ════════════════════════════════════════════════════════════════════════════
check('entity.teleported — the re-entry guard prevents an immediate bounce-back (no ping-pong)', () => {
  const player = makePlayer(60, 60); // start ON mouth a
  const bus = makeBus();
  const scene = makeScene(player, makeGroup(), bus);
  const sys = new PortalLink({ portals: PORTALS, guardMs: 600 });
  sys.attach(scene);

  // tick 1 @ t=0: step-on a → teleport to b (520,360); player now lands ON mouth b.
  sys.update();
  assert.equal(bus.log.filter((e) => e.name === 'entity.teleported').length, 1, 'exactly one teleport on the step-on tick');
  assert.equal(player.x, 520, 'landed on mouth b');
  assert.equal(player.y, 360, 'landed on mouth b');

  // tick 2 @ t=100 (< guardMs 600): still ON mouth b but the pair is GUARDED → MUST NOT
  // teleport back. (Same pairIndex guarded after the a→b teleport.)
  scene.time.now = 100;
  sys.update();
  assert.equal(bus.log.filter((e) => e.name === 'entity.teleported').length, 1, 'guard held: no re-teleport while sitting on the destination mouth');
  assert.equal(player.x, 520, 'still on mouth b (no ping-pong back to a)');
  assert.equal(player.y, 360, 'still on mouth b (no ping-pong back to a)');

  // tick 3 @ t=700 (> guardMs 600): the guard has lapsed → the portal re-arms and the
  // player (still on mouth b) teleports back to a. Proves the guard is a WINDOW, not a latch.
  scene.time.now = 700;
  sys.update();
  assert.equal(bus.log.filter((e) => e.name === 'entity.teleported').length, 2, 'guard re-arms after guardMs: a second teleport once it lapses');
  assert.equal(player.x, 60, 'teleported back to mouth a after the guard window');
  assert.equal(player.y, 60, 'teleported back to mouth a after the guard window');
});

// COUNTERFACTUAL guard for the no-op: an empty portals[] is a clean no-op — driving the
// verb on a board with no portals never teleports and never emits (the declared no-op).
check('entity.teleported — counterfactual: no declared portals → clean no-op (no teleport, no event)', () => {
  const player = makePlayer(60, 60);
  const bus = makeBus();
  const scene = makeScene(player, makeGroup(), bus);
  const sys = new PortalLink({ portals: [] }); // no portals declared
  sys.attach(scene);

  sys.update();

  assert.equal(player.x, 60, 'player did NOT move (no portals declared)');
  assert.equal(player.y, 60, 'player did NOT move (no portals declared)');
  assert.equal(bus.log.filter((e) => e.name === 'entity.teleported').length, 0, 'no event for a board with no portals');
  assert.equal(entitiesOf(scene).filter((e) => e.type === 'portal').length, 0, 'no portal markers spawned');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
