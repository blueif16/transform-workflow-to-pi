/**
 * SwitchGate — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the one surface() event (switch.activated) actually FIRES at runtime by
 * driving the REAL verb (use/interact — step on the switch via update(), AND the
 * "hit" form via the public activate() seam) on the REAL SwitchGate class over the
 * REAL MazeGrid, and asserting the declared `expect` transition on the OBSERVABLE
 * state — the same state the engine's __GAME__.entities adapter reads
 * (scene.obstacles.getChildren(), drop active===false), the recorded bus emits.
 *
 * Real objects: the system under test, the real maze geometry (worldToCell /
 * cellCenter), the switch + barrier sprites (real tagged objects in a real
 * obstacles group), the recording EventBus, a real player. The scene is the
 * harness boundary — a minimal Phaser-shaped host (headless Phaser can't render),
 * but it owns NO logic under test: every step-on/cell-match/toggle/emit decision
 * is the component's own code.
 *
 * Observable adapter (`entitiesOf`) mirrors templates/core/src/hook.ts
 * collectEntities() (lines 135-153): walk group.getChildren(), drop active===false,
 * read __id/__type. NOT reimplemented logic — it is the literal read the oracle
 * does. setBarrierSolid(id,false) calls sprite.setActive(false), so the barrier
 * DROPS out of this read; setBarrierSolid(id,true) calls setActive(true), so it
 * RE-JOINS — exactly the reachable-region change the contract names.
 *
 * COUNTERFACTUAL (meaningfulness): if activateSwitch() is no-op'd, the 'opens'
 * barrier stays solid (stays in __GAME__.entities), the 'closes' barrier stays
 * non-solid (stays out), and no 'switch.activated' is recorded → every assertion
 * below fails. The explicit guard cases (a board with no maze; an unknown switch
 * id) exercise the same no-transition → no-event → no-region-change observable.
 */
import assert from 'node:assert/strict';
// Dynamic import: the source modules carry a type-only `@contract` import that
// trips tsx's static named-export resolution; `import()` loads the REAL classes
// cleanly (same objects, no aliasing). SwitchGate + MazeGrid pull in ZERO phaser
// (their only imports are type-only), so no headless stub is needed.
const { SwitchGate } = (await import('../SwitchGate.ts')) as typeof import('../SwitchGate.ts');
const { MazeGrid } = (await import('../../scenes/maze-grid.ts')) as typeof import('../../scenes/maze-grid.ts');

// ── observable adapter — the literal read __GAME__.entities does over obstacles ──
// (templates/core/src/hook.ts collectEntities: getChildren → drop active===false).
function entitiesOf(scene: any): Array<{ id: string; type: string }> {
  const group = scene.obstacles;
  const out: any[] = [];
  if (!group || typeof group.getChildren !== 'function') return out;
  for (const child of group.getChildren()) {
    if (!child || child.active === false) continue;
    out.push({ id: child.__id ?? child.__type ?? 'obstacle', type: child.__type ?? 'obstacle' });
  }
  return out;
}

/** A barrier id is REACHABLE-BLOCKING iff it is present (solid) in __GAME__.entities. */
function inEntities(scene: any, id: string): boolean {
  return entitiesOf(scene).some((e) => e.id === id);
}

// ── a real getChildren-backed group (what scene.obstacles is to the adapter) ──
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

/**
 * A real barrier sprite: a tagged obstacle with a real physics body and the
 * standard setActive/setVisible/body.enable seam SwitchGate flips. `active`
 * mirrors what setActive sets — exactly what the entities adapter reads.
 */
function makeBarrier(id: string, x: number, y: number) {
  return {
    __id: id,
    __type: 'barrier',
    x, y,
    active: true,
    visible: true,
    body: { enable: true } as { enable: boolean },
    setActive(v: boolean) { this.active = v; return this; },
    setVisible(v: boolean) { this.visible = v; return this; },
  };
}

/** A real switch sprite: a tagged obstacle at a known cell center (the step-on target). */
function makeSwitch(id: string, x: number, y: number) {
  return { __id: id, __type: 'switch', x, y, active: true };
}

/** A real player at a world position (drives worldToCell for step-on detection). */
function makePlayer(x: number, y: number) {
  return { x, y, isDead: false };
}

/** A minimal Phaser-shaped scene host carrying the REAL maze + obstacles + bus. */
function makeScene(grid: MazeGrid, player: any, bus: ReturnType<typeof makeBus>) {
  return {
    __maze: grid,
    player,
    obstacles: makeGroup(),
    eventBus: bus,
    gameCompleted: false,
    fireEffect: (_n: string, _x: number, _y: number) => {},
  };
}

// A 5x5 maze: a '#' ring + an open interior (cells (1..3,1..3) walkable).
function makeGrid() {
  return new MazeGrid({
    tileSize: 32, originX: 0, originY: 0,
    grid: ['#####', '#...#', '#...#', '#...#', '#####'],
  } as any);
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — switch.activated, STEP-ON form (drivenBy: the player enters the switch
//  cell; update() detects the press edge)
//  expect: the bound 'opens' barrier becomes non-solid and LEAVES __GAME__.entities
//          (its passage reachable); switch.activated logged.
// ════════════════════════════════════════════════════════════════════════════
check('switch.activated — STEP-ON opens the bound barrier (leaves __GAME__.entities) + logs the event', () => {
  const grid = makeGrid();
  const swCell = grid.cellCenter(1, 1);     // switch sits at cell (1,1)
  const barCell = grid.cellCenter(3, 3);    // the bound 'opens' barrier at (3,3)
  const bus = makeBus();
  // player starts OFF the switch cell (at (2,2)) so the first tick has no edge.
  const player = makePlayer(grid.cellCenter(2, 2).x, grid.cellCenter(2, 2).y);
  const scene = makeScene(grid, player, bus);
  const sw = makeSwitch('sw1', swCell.x, swCell.y);
  const barrier = makeBarrier('bar1', barCell.x, barCell.y);
  scene.obstacles.add(sw);
  scene.obstacles.add(barrier);

  const sys = new SwitchGate({ switches: [{ id: 'sw1', opens: 'bar1' }] });
  sys.attach(scene);

  // precondition: the 'opens' barrier IS in entities (solid, blocking).
  assert.equal(inEntities(scene, 'bar1'), true, 'opens-barrier is solid before activation');
  sys.update(); // player off the cell → NO activation
  assert.equal(inEntities(scene, 'bar1'), true, 'no activation while player is off the switch cell');
  assert.equal(bus.log.filter((e) => e.name === 'switch.activated').length, 0, 'no event before step-on');

  // DRIVE the verb: walk the player ONTO the switch cell, tick (press edge).
  player.x = swCell.x; player.y = swCell.y;
  sys.update();

  // OBSERVABLE 1: the 'opens' barrier became non-solid → LEFT __GAME__.entities.
  assert.equal(inEntities(scene, 'bar1'), false, "opens-barrier left __GAME__.entities (passage now reachable)");
  assert.equal(barrier.active, false, 'barrier sprite deactivated (the entities-membership seam)');
  assert.equal(barrier.body.enable, false, 'barrier physics body disabled (non-solid: collider skips it)');

  // OBSERVABLE 2: switch.activated logged once with {switchId,opened,closed}.
  const fired = bus.log.filter((e) => e.name === 'switch.activated');
  assert.equal(fired.length, 1, 'switch.activated logged exactly once');
  assert.equal(fired[0].payload.switchId, 'sw1');
  assert.deepEqual(fired[0].payload.opened, ['bar1'], 'payload.opened names the toggled barrier');
  assert.deepEqual(fired[0].payload.closed, [], 'nothing closed in the simple form');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — switch.activated, HIT form (drivenBy: the public activate() seam) with
//  the BOLDER form: opens one path while CLOSING another.
//  expect: the 'opens' barrier leaves __GAME__.entities AND the 'closes' barrier
//          re-joins it — the reachable region changes both ways; switch.activated logged.
// ════════════════════════════════════════════════════════════════════════════
check('switch.activated — HIT (activate seam) opens one barrier + CLOSES another (region changes both ways)', () => {
  const grid = makeGrid();
  const bus = makeBus();
  const player = makePlayer(grid.cellCenter(2, 2).x, grid.cellCenter(2, 2).y);
  const scene = makeScene(grid, player, bus);
  const sw = makeSwitch('sw1', grid.cellCenter(1, 1).x, grid.cellCenter(1, 1).y);
  const opensBar = makeBarrier('open1', grid.cellCenter(3, 1).x, grid.cellCenter(3, 1).y);
  // the 'closes' barrier starts NON-SOLID (its passage open) — already out of entities.
  const closesBar = makeBarrier('close1', grid.cellCenter(1, 3).x, grid.cellCenter(1, 3).y);
  closesBar.setActive(false); closesBar.setVisible(false); closesBar.body.enable = false;
  scene.obstacles.add(sw);
  scene.obstacles.add(opensBar);
  scene.obstacles.add(closesBar);

  const sys = new SwitchGate({ switches: [{ id: 'sw1', opens: ['open1'], closes: ['close1'] }] });
  sys.attach(scene);

  // preconditions: open1 solid (in entities); close1 already non-solid (out).
  assert.equal(inEntities(scene, 'open1'), true, 'opens-barrier solid before');
  assert.equal(inEntities(scene, 'close1'), false, 'closes-barrier non-solid before');

  // DRIVE the verb: the public "hit the switch" seam.
  const did = sys.activate('sw1');
  assert.equal(did, true, 'activate() reports it performed the toggle');

  // OBSERVABLE: the reachable region changed BOTH ways.
  assert.equal(inEntities(scene, 'open1'), false, "opens-barrier left __GAME__.entities (path opened)");
  assert.equal(inEntities(scene, 'close1'), true, "closes-barrier re-joined __GAME__.entities (path closed)");
  assert.equal(closesBar.body.enable, true, 'closes-barrier body re-enabled (solid again)');

  // OBSERVABLE: switch.activated logged with both toggled ids.
  const fired = bus.log.filter((e) => e.name === 'switch.activated');
  assert.equal(fired.length, 1, 'switch.activated logged exactly once on the hit');
  assert.deepEqual(fired[0].payload.opened, ['open1']);
  assert.deepEqual(fired[0].payload.closed, ['close1']);
});

// ── COUNTERFACTUAL A: no maze witness → step-on cannot resolve → clean no-op.
//    Same observable that would fail if activateSwitch() were no-op'd: barrier
//    stays in entities, no event. (drives the update() short-circuit at line 129).
check('switch.activated — counterfactual: no maze → step-on is a no-op (barrier stays solid, no event)', () => {
  const grid = makeGrid();
  const bus = makeBus();
  const swCell = grid.cellCenter(1, 1);
  const player = makePlayer(swCell.x, swCell.y); // player standing ON the switch cell
  const scene = makeScene(grid, player, bus);
  (scene as any).__maze = undefined; // remove the witness → update() short-circuits
  const sw = makeSwitch('sw1', swCell.x, swCell.y);
  const barrier = makeBarrier('bar1', grid.cellCenter(3, 3).x, grid.cellCenter(3, 3).y);
  scene.obstacles.add(sw);
  scene.obstacles.add(barrier);
  const sys = new SwitchGate({ switches: [{ id: 'sw1', opens: 'bar1' }] });
  sys.attach(scene);

  sys.update();
  assert.equal(inEntities(scene, 'bar1'), true, 'barrier still solid when step-on cannot resolve');
  assert.equal(bus.log.filter((e) => e.name === 'switch.activated').length, 0, 'no event on a no-op tick');
});

// ── COUNTERFACTUAL B: a one-shot switch LATCHES — a second hit does NOT re-fire,
//    and the region does not change a second time (the latch guard at line 160).
check('switch.activated — one-shot LATCHES: second activate() is a no-op (no second event, no re-toggle)', () => {
  const grid = makeGrid();
  const bus = makeBus();
  const player = makePlayer(grid.cellCenter(2, 2).x, grid.cellCenter(2, 2).y);
  const scene = makeScene(grid, player, bus);
  const sw = makeSwitch('sw1', grid.cellCenter(1, 1).x, grid.cellCenter(1, 1).y);
  const barrier = makeBarrier('bar1', grid.cellCenter(3, 3).x, grid.cellCenter(3, 3).y);
  scene.obstacles.add(sw);
  scene.obstacles.add(barrier);
  const sys = new SwitchGate({ switches: [{ id: 'sw1', opens: 'bar1' }], reArmable: false });
  sys.attach(scene);

  assert.equal(sys.activate('sw1'), true, 'first hit toggles');
  assert.equal(inEntities(scene, 'bar1'), false, 'barrier opened by the first hit');
  assert.equal(sys.activate('sw1'), false, 'one-shot: second hit does NOT re-fire');
  assert.equal(bus.log.filter((e) => e.name === 'switch.activated').length, 1, 'only ONE switch.activated for a latched switch');
});

// ── COUNTERFACTUAL C: an unknown switch id → activate() is a clean no-op (false),
//    no barrier toggles, no event.
check('switch.activated — unknown id: activate() returns false, no toggle, no event', () => {
  const grid = makeGrid();
  const bus = makeBus();
  const player = makePlayer(grid.cellCenter(2, 2).x, grid.cellCenter(2, 2).y);
  const scene = makeScene(grid, player, bus);
  const barrier = makeBarrier('bar1', grid.cellCenter(3, 3).x, grid.cellCenter(3, 3).y);
  scene.obstacles.add(barrier);
  const sys = new SwitchGate({ switches: [{ id: 'sw1', opens: 'bar1' }] });
  sys.attach(scene);

  assert.equal(sys.activate('ghost'), false, 'unknown switch id → false');
  assert.equal(inEntities(scene, 'bar1'), true, 'barrier untouched on an unknown-id call');
  assert.equal(bus.log.filter((e) => e.name === 'switch.activated').length, 0, 'no event on an unknown-id call');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
