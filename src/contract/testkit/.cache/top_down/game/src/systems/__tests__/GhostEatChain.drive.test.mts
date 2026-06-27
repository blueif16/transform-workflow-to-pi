/**
 * GhostEatChain — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the two surface() events actually FIRE at runtime by driving the REAL
 * verb on the REAL GhostEatChain class and asserting each declared `expect`
 * transition on the OBSERVABLE state — the same state the engine's __GAME__
 * adapter reads (scene.registry.get('score') for __GAME__.score; the live
 * scene.enemies children's x|y for __GAME__.entities), plus the recorded bus
 * emits on the PUSH channel.
 *
 * The verb is driven through the REAL overlap the component itself wires:
 * setupCollisions() registers a player<->enemies overlap callback; we invoke
 * THAT callback (the one physics.add.overlap captured) so the eat goes through
 * the component's own `if (!isFrightened()) return; eatGhost(ghost)` gate — not
 * a direct private call. The chain reset is driven through the component's own
 * update() fright-window EDGE detector (frightened -> not-frightened), exactly
 * as GhostModeController's timer-driven resume would flip scene.__ghostMode.
 *
 * Real objects: the system under test, real ghost sprites (real objects in a
 * real getChildren-backed enemies group, each tagged __id), a real registry
 * (the score source addScore writes through), and a real recording EventBus.
 * The scene is the harness boundary — a minimal Phaser-shaped host (headless
 * Phaser can't render) that owns NO logic under test: every eat/score/send-home
 * /chain/reset decision is the component's own code.
 *
 * Observable adapters mirror the real oracle:
 *   - scoreOf(scene)    = scene.registry.get('score')          (hook.ts __GAME__.score)
 *   - entitiesOf(scene) = scene.enemies.getChildren() -> {id,type,x,y}  (hook.ts collectEntities, enemies group, lines 136-152)
 * Neither reimplements component logic — they are the literal reads the oracle does.
 *
 * COUNTERFACTUAL (meaningfulness): stated per event below; each is exercised as
 * an explicit guard case that fails on a broken / no-op'd component.
 */
import assert from 'node:assert/strict';
// Dynamic import: the source module carries a type-only `@contract` import that
// trips tsx's static named-export resolution; `import()` loads the REAL class
// cleanly (same object, no aliasing).
const { GhostEatChain } = (await import('../GhostEatChain.ts')) as typeof import('../GhostEatChain.ts');

// ── observable adapter — the literal read __GAME__.score does ──
function scoreOf(scene: any): number {
  return scene.registry.get('score') ?? 0;
}

// ── observable adapter — the literal read __GAME__.entities does over `enemies` ──
function entitiesOf(scene: any): Array<{ id: string; type: string; x: number; y: number }> {
  const group = scene.enemies;
  const out: any[] = [];
  if (!group || typeof group.getChildren !== 'function') return out;
  for (const child of group.getChildren()) {
    if (!child || child.active === false) continue;
    out.push({ id: child.__id ?? 'ghost', type: child.__kind ?? 'enemy', x: child.x, y: child.y });
  }
  return out;
}

// ── a real getChildren-backed group (what scene.enemies is to the adapter) ──
function makeGroup(items: any[]) {
  return { getChildren: () => items.slice() };
}

// ── a real recording EventBus (collect every emit on the PUSH channel) ──
function makeBus() {
  const log: Array<{ name: string; payload: any }> = [];
  return { log, emit: (name: string, payload?: any) => { log.push({ name, payload }); } };
}

// ── a real registry (the single score source addScore reads/writes through) ──
function makeRegistry() {
  const store = new Map<string, any>();
  return { get: (k: string) => store.get(k), set: (k: string, v: any) => { store.set(k, v); } };
}

/**
 * A real ghost sprite: a plain object the component teleports via body.reset
 * (the same arcade seam the live game uses). x|y are the OBSERVED position the
 * entities adapter reads. __id is its identity; __kind tags its type.
 */
function makeGhost(id: string, x: number, y: number, kind = 'ghost') {
  return {
    __id: id, __kind: kind, x, y, active: true, isDead: false,
    body: { reset(nx: number, ny: number) { /* sync the body to the new pos */ } },
  };
}

/**
 * Build a minimal Phaser-shaped scene host carrying the REAL enemies group +
 * player + bus + registry. physics.add.overlap CAPTURES the callback the
 * component registers (so the test drives the component's OWN overlap path).
 * scene.game.events.emit is a no-op sink (the legacy HUD channel setScore also
 * pings — irrelevant to the observed surface).
 */
function makeScene(ghosts: any[], bus: ReturnType<typeof makeBus>) {
  let overlapCb: ((p: any, g: any) => void) | null = null;
  const scene: any = {
    player: { x: 0, y: 0, active: true },
    enemies: makeGroup(ghosts),
    eventBus: bus,
    registry: makeRegistry(),
    game: { events: { emit() {} } },
    physics: { add: { overlap: (_p: any, _g: any, cb: (p: any, g: any) => void) => { overlapCb = cb; } } },
    // expose the captured overlap callback so the test can fire the REAL eat path
    __fireOverlap: (player: any, ghost: any) => { if (overlapCb) overlapCb(player, ghost); },
  };
  return scene;
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT 1 — ghost.eaten (drivenBy: player overlaps a ghost while frightened)
//  expect: the ghost returns to its pen spawn in __GAME__.entities AND
//          __GAME__.score increases by the current chain value (200,400,800,
//          1600 within the window); ghost.eaten logged.
// ════════════════════════════════════════════════════════════════════════════
check('ghost.eaten — overlapping frightened ghosts escalates the chain (200/400/800/1600), sends each home, logs each event', () => {
  // four ghosts at their PEN spawns; then move them OUT (mid-maze) before the eat
  // so "returns to pen" is an observable jump back to the captured spawn.
  const pens = [
    { id: 'blinky', x: 100, y: 100 },
    { id: 'pinky',  x: 120, y: 100 },
    { id: 'inky',   x: 140, y: 100 },
    { id: 'clyde',  x: 160, y: 100 },
  ];
  const ghosts = pens.map((p) => makeGhost(p.id, p.x, p.y));
  const bus = makeBus();
  const scene = makeScene(ghosts, bus);
  const sys = new GhostEatChain(); // default ladder [200,400,800,1600], mode 'frightened'
  sys.attach(scene);          // captures each pen spawn from first-seen x|y
  sys.setupCollisions();      // registers the REAL player<->enemies eat overlap

  // enter the fright window (what a power pellet -> GhostModeController publishes).
  scene.__ghostMode = 'frightened';

  // move every ghost away from its pen (they are roaming the maze).
  ghosts.forEach((g, i) => { g.x = 300 + i * 20; g.y = 300; });

  assert.equal(scoreOf(scene), 0, 'score starts at 0');

  const expectedLadder = [200, 400, 800, 1600];
  let running = 0;
  for (let i = 0; i < ghosts.length; i++) {
    const ghost = ghosts[i];
    const pen = pens[i];

    // DRIVE the verb: fire the component's OWN captured overlap callback
    // (player overlaps this ghost) — goes through its isFrightened() gate + eatGhost.
    scene.__fireOverlap(scene.player, ghost);

    running += expectedLadder[i];

    // 1a OBSERVABLE: score increased by THIS step's chain value (escalating).
    assert.equal(scoreOf(scene), running, `score after eating ${pen.id} is the running chain total ${running}`);

    // 1b OBSERVABLE: the eaten ghost returned to its captured pen spawn in entities.
    const ent = entitiesOf(scene).find((e) => e.id === pen.id)!;
    assert.equal(ent.x, pen.x, `${pen.id} returned to pen x`);
    assert.equal(ent.y, pen.y, `${pen.id} returned to pen y`);

    // 1c OBSERVABLE: ghost.eaten logged with {ghostId,chainValue} for this step.
    const eaten = bus.log.filter((e) => e.name === 'ghost.eaten');
    assert.equal(eaten.length, i + 1, `ghost.eaten logged exactly ${i + 1} time(s)`);
    assert.equal(eaten[i].payload.ghostId, pen.id, 'event carries the eaten ghost id');
    assert.equal(eaten[i].payload.chainValue, expectedLadder[i], `event chainValue is ${expectedLadder[i]}`);
  }

  // the doubling chain summed to 200+400+800+1600 across the four ghosts.
  assert.equal(scoreOf(scene), 3000, 'full four-ghost Dossier chain scored 3000 in one fright window');
});

// COUNTERFACTUAL for event 1: NOT frightened -> the overlap is a clean no-op.
// The eat path is gated by isFrightened(); with the gate closed, nothing scores,
// no ghost moves, nothing is logged. This is the same observable that would fail
// if eatGhost() were no-op'd (or the gate were broken open into a guaranteed eat).
check('ghost.eaten — counterfactual: NOT frightened → overlap is a no-op (no score, no pen-return, no event)', () => {
  const ghost = makeGhost('blinky', 100, 100);
  const bus = makeBus();
  const scene = makeScene([ghost], bus);
  const sys = new GhostEatChain();
  sys.attach(scene);
  sys.setupCollisions();
  // scene.__ghostMode is undefined (chase mode) — the eat must NOT unlock.
  ghost.x = 300; ghost.y = 300; // roaming, away from pen
  scene.__fireOverlap(scene.player, ghost);
  assert.equal(scoreOf(scene), 0, 'no score when not frightened (base contact-damage owns the overlap)');
  assert.equal(entitiesOf(scene)[0].x, 300, 'ghost did NOT return to pen (no eat)');
  assert.equal(bus.log.filter((e) => e.name === 'ghost.eaten').length, 0, 'no ghost.eaten when the gate is closed');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT 2 — ghost.chainReset (drivenBy: the frightened window ends)
//  expect: the eat-chain step returns to its base — the next eaten ghost scores
//          200 again; ghost.chainReset logged.
// ════════════════════════════════════════════════════════════════════════════
check('ghost.chainReset — the fright window ending resets the chain so the next eat scores 200 again, and logs the event', () => {
  const ghosts = [makeGhost('blinky', 100, 100), makeGhost('pinky', 120, 100)];
  const bus = makeBus();
  const scene = makeScene(ghosts, bus);
  const sys = new GhostEatChain();
  sys.attach(scene);
  sys.setupCollisions();

  // Window A: frighten, eat ONE ghost (chain advances to step 1 → next would be 400).
  scene.__ghostMode = 'frightened';
  sys.update();                       // arm the edge detector (wasFrightened = true)
  ghosts[0].x = 300; ghosts[0].y = 300;
  scene.__fireOverlap(scene.player, ghosts[0]);
  assert.equal(scoreOf(scene), 200, 'first eat of window A scored 200');
  assert.equal(bus.log.filter((e) => e.name === 'ghost.chainReset').length, 0, 'no reset while the window is open');

  // DRIVE the verb: the fright window ENDS (GhostModeController timer resume flips
  // __ghostMode off 'frightened'); the component detects the edge in update().
  scene.__ghostMode = 'chase';
  sys.update();

  // 2a OBSERVABLE: ghost.chainReset logged exactly once, carrying the value the
  // chain stood at when the window ended.
  const resets = bus.log.filter((e) => e.name === 'ghost.chainReset');
  assert.equal(resets.length, 1, 'ghost.chainReset logged exactly once on the window-end edge');
  assert.equal(typeof resets[0].payload.atChainValue, 'number', 'reset event carries atChainValue');

  // 2b OBSERVABLE (the `expect` transition): the chain is back at base — the NEXT
  // eaten ghost in a fresh window scores 200 again, not 400.
  scene.__ghostMode = 'frightened';
  sys.update();                       // re-arm the edge for the new window
  ghosts[1].x = 320; ghosts[1].y = 300;
  const before = scoreOf(scene);
  scene.__fireOverlap(scene.player, ghosts[1]);
  assert.equal(scoreOf(scene) - before, 200, 'after reset the next eat scores the BASE 200 again (chain returned to base)');
});

// COUNTERFACTUAL for event 2: the window does NOT end (stays frightened) across
// an update() → no edge → NO reset event and the chain does NOT rewind. This is
// the observable that would fail if resetChain() fired unconditionally (the edge
// detector were broken) — it bites on a reset that does not depend on the edge.
check('ghost.chainReset — counterfactual: window stays frightened → no edge → no reset event, chain keeps escalating', () => {
  const ghosts = [makeGhost('blinky', 100, 100), makeGhost('pinky', 120, 100)];
  const bus = makeBus();
  const scene = makeScene(ghosts, bus);
  const sys = new GhostEatChain();
  sys.attach(scene);
  sys.setupCollisions();

  scene.__ghostMode = 'frightened';
  sys.update();                       // arm the edge
  ghosts[0].x = 300; ghosts[0].y = 300;
  scene.__fireOverlap(scene.player, ghosts[0]);   // eat #1 → 200
  sys.update();                       // STILL frightened — no edge
  const before = scoreOf(scene);
  ghosts[1].x = 320; ghosts[1].y = 300;
  scene.__fireOverlap(scene.player, ghosts[1]);   // eat #2 → 400 (chain NOT reset)
  assert.equal(bus.log.filter((e) => e.name === 'ghost.chainReset').length, 0, 'no reset while the window stays open');
  assert.equal(scoreOf(scene) - before, 400, 'chain kept escalating (eat #2 = 400, NOT a reset-to-200)');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
