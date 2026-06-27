/**
 * WarpTunnel.drive.mts — RUNTIME DRIVE PROOF for WarpTunnel (event-protocol conformance).
 *
 * Proves the single surface() event ('entity.warped') ACTUALLY FIRES at runtime by
 * driving its REAL verb — the per-frame `update()` tick over a body that has MOVED
 * onto a declared tunnel-edge region — on the REAL WarpTunnel class, and asserting
 * each declared `expect` transition on OBSERVABLE state, never an internal flag.
 *
 * Surface contract (from WarpTunnel.surface()):
 *   event    entity.warped   payload {id,fromTunnel,toTunnel}
 *   drivenBy "move — a body (the player or a ghost) crosses a declared tunnel-edge region"
 *   expect   "the body x|y jumps to the paired tunnel mouth in __GAME__.player.x|y /
 *             entities[*].x|y, and a ghost inside a tunnel region has reduced measured
 *             speed in entities[]; entity.warped logged"
 *
 * Real objects only:
 *   - the system under test (the REAL WarpTunnel),
 *   - a REAL GhostTarget behavior (the genuine maze-ghost brain) on a real enemy
 *     sprite in a real getChildren()-backed group — the SAME object the engine's
 *     __GAME__.entities adapter reads,
 *   - a recording EventBus (collects every emit on the PUSH channel — what the
 *     real bus log is to the verify harness),
 *   - a minimal Phaser-shaped scene host that owns NO logic under test (the warp
 *     reposition + the speed scale are entirely the component's code).
 *
 * Observable speed read (`measuredSpeed`): the ghost's measured Δposition/frame is
 * GhostTarget.applyVelocity() writing body.velocity from its public `speed`; that
 * velocity is what __GAME__.entities surfaces as entities[*].vx|vy (hook.ts L210-211).
 * We tick the REAL GhostTarget.update() so the body velocity is the genuine
 * component-computed value — no stub returns it.
 *
 * COUNTERFACTUAL (meaningfulness): if warp() were no-op'd, the player's x|y would
 * stay at the region it stepped on and no 'entity.warped' would be recorded →
 * assertions W1a/W1b/W1c fail. If applyGhostSlow() were no-op'd, the ghost's
 * GhostTarget.speed (and thus its measured body velocity) would NOT drop inside the
 * region → assertion G1 fails. Both counterfactuals are exercised as explicit guard
 * cases below.
 *
 * Run (from repo root):
 *   packages/verify/node_modules/.bin/tsx \
 *     templates/modules/top_down/src/systems/__tests__/WarpTunnel.drive.mts
 */
import assert from 'node:assert/strict';
// Dynamic import: the source modules carry a type-only `@contract` import that trips
// tsx's static named-export resolution; `import()` loads the REAL classes cleanly
// (same objects, no aliasing). Resolved once at startup below.
const { WarpTunnel } = (await import('../WarpTunnel.ts')) as typeof import('../WarpTunnel.ts');
const { GhostTarget } = (await import('../../behaviors/GhostTarget.ts')) as typeof import('../../behaviors/GhostTarget.ts');
const { MazeGrid } = (await import('../../scenes/maze-grid.ts')) as typeof import('../../scenes/maze-grid.ts');

// ── observable adapter — the literal x|y read __GAME__.entities does over a group ──
function entitiesOf(scene: any, gname = 'enemies'): Array<{ id: string; x: number; y: number; vx: number; vy: number }> {
  const group = scene[gname];
  const out: any[] = [];
  if (!group || typeof group.getChildren !== 'function') return out;
  for (const child of group.getChildren()) {
    if (!child || child.active === false) continue;
    out.push({
      id: child.__id ?? child.name ?? 'entity',
      x: child.x,
      y: child.y,
      vx: child.body?.velocity?.x ?? 0, // the measured Δposition/frame __GAME__ surfaces
      vy: child.body?.velocity?.y ?? 0,
    });
  }
  return out;
}

/** The measured speed magnitude in entities[] (sqrt(vx^2+vy^2)) — the escape-valve read. */
function measuredSpeed(e: { vx: number; vy: number }): number {
  return Math.hypot(e.vx, e.vy);
}

// ── a real getChildren-backed group (what scene.enemies is to the adapter) ──
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

// A real arcade-shaped body whose reset(x,y) repositions (what WarpTunnel.reposition uses).
function makeBody() {
  return {
    velocity: { x: 0, y: 0 },
    reset(x: number, y: number) { (this as any).__x = x; (this as any).__y = y; },
  };
}

/**
 * A real enemy sprite carrying a REAL GhostTarget behavior, shaped like the live
 * world WarpTunnel + the GhostTarget reads. behaviors.getAll() returns the real
 * behavior (the scan WarpTunnel.ghostBehaviorOf does, mirroring ElroySpeedup).
 */
function makeGhostSprite(scene: any, x: number, y: number, speed: number, name = 'blinky') {
  const sprite: any = {
    x, y, name, active: true,
    body: makeBody(),
    scene,
    facingDirection: 'left',
    setPosition(nx: number, ny: number) { this.x = nx; this.y = ny; },
  };
  const ghost = new GhostTarget({ selector: name as any, speed });
  ghost.attach(sprite);
  sprite.behaviors = { getAll: () => [ghost] };
  sprite.__ghost = ghost; // test handle to read the public speed
  return sprite;
}

/** Build a minimal Phaser-shaped scene host carrying the real player + enemies + bus. */
function makeScene(player: any, enemies: ReturnType<typeof makeGroup>, bus: ReturnType<typeof makeBus>, maze?: any) {
  return {
    player,
    enemies,
    eventBus: bus,
    gameCompleted: false,
    __maze: maze,
    __ghostMode: 'scatter',
    fireEffect: (_n: string, _x: number, _y: number) => {},
  };
}

// A real player with an arcade-shaped body (so WarpTunnel.reposition uses body.reset).
function makePlayer(x: number, y: number) {
  return { x, y, active: true, body: makeBody(), setPosition(nx: number, ny: number) { this.x = nx; this.y = ny; } };
}

// A 7x7 maze with open interior — gives the GhostTarget a walkable grid to drive on.
function makeGrid() {
  return new MazeGrid({
    tileSize: 32, originX: 0, originY: 0,
    grid: ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######'],
  } as any);
}

// Two paired tunnel regions far apart, each with its own mouth.
//   region a: AABB at (0,100) 20x20.   region b: AABB at (480,280) 20x20.
// Per the contract, a region's `mouth` is where a body LANDS after crossing the
// PAIRED region: crossing region a deposits at b.mouth; crossing b deposits at a.mouth.
// So b.mouth is the FAR landing for an a-crossing (500,300); a.mouth the far landing
// for a b-crossing (10,110).
const TUNNELS = [
  {
    a: { x: 0, y: 100, w: 20, h: 20, mouthX: 10, mouthY: 110 },
    b: { x: 480, y: 280, w: 20, h: 20, mouthX: 500, mouthY: 300 },
  },
];

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — entity.warped (drivenBy: move — the player crosses a declared region)
//  expect: player.x|y JUMPS to the paired tunnel mouth; entity.warped logged
//          with {id,fromTunnel,toTunnel}.
// ════════════════════════════════════════════════════════════════════════════
check('entity.warped — player crossing region a jumps to b.mouth in __GAME__.player.x|y + logs the event', () => {
  const player = makePlayer(10, 110); // CENTER inside region a's AABB (0..20, 100..120)
  const enemies = makeGroup();
  const bus = makeBus();
  const scene = makeScene(player, enemies, bus);
  const sys = new WarpTunnel({ tunnels: TUNNELS });
  sys.attach(scene);

  // precondition: player is at the region-a edge, NOT yet warped, no event logged.
  assert.equal(player.x, 10, 'player at the region-a edge pre-warp');
  assert.equal(player.y, 110, 'player at the region-a edge pre-warp');
  assert.equal(bus.log.length, 0, 'no event before the move-cross verb runs');

  // DRIVE the verb: a frame tick with the player standing in region a (a crossing).
  sys.update();

  // W1a OBSERVABLE: player.x|y JUMPED to the PAIRED region b's mouth (500,300).
  assert.equal(player.x, 500, 'player.x jumped to the paired b.mouth (500)');
  assert.equal(player.y, 300, 'player.y jumped to the paired b.mouth (300)');

  // W1b OBSERVABLE: entity.warped logged exactly once with the player id.
  const warped = bus.log.filter((e) => e.name === 'entity.warped');
  assert.equal(warped.length, 1, 'entity.warped logged exactly once');
  assert.equal(warped[0].payload.id, 'player', 'id auto-derived as the player');

  // W1c OBSERVABLE: the payload names the crossed tunnel (a = pair0 side0 = key 0)
  //                 and the destination (b = pair0 side1 = key 1).
  assert.equal(warped[0].payload.fromTunnel, 0, 'fromTunnel = region a key (0)');
  assert.equal(warped[0].payload.toTunnel, 1, 'toTunnel = region b key (1)');
});

// Symmetry — crossing region b warps to a.mouth (the toroidal pairing both ways).
check('entity.warped — crossing region b warps to a.mouth (toroidal, both directions)', () => {
  const player = makePlayer(490, 290); // CENTER inside region b's AABB (480..500, 280..300)
  const bus = makeBus();
  const scene = makeScene(player, makeGroup(), bus);
  const sys = new WarpTunnel({ tunnels: TUNNELS });
  sys.attach(scene);

  sys.update();

  assert.equal(player.x, 10, 'player.x jumped to a.mouth (10)');
  assert.equal(player.y, 110, 'player.y jumped to a.mouth (110)');
  const warped = bus.log.filter((e) => e.name === 'entity.warped');
  assert.equal(warped.length, 1, 'entity.warped logged once');
  assert.equal(warped[0].payload.fromTunnel, 1, 'fromTunnel = region b key (1)');
  assert.equal(warped[0].payload.toTunnel, 0, 'toTunnel = region a key (0)');
});

// COUNTERFACTUAL guard: a body OUTSIDE every region does not cross → no warp, no
// event. This is the same observable that fails if warp() were no-op'd while a body
// IS inside (i.e. it proves the assertion bites on the transition, not on presence).
check('entity.warped — counterfactual: a body outside every region does NOT warp and logs nothing', () => {
  const player = makePlayer(200, 200); // open interior — inside NO tunnel region
  const bus = makeBus();
  const scene = makeScene(player, makeGroup(), bus);
  const sys = new WarpTunnel({ tunnels: TUNNELS });
  sys.attach(scene);

  sys.update();

  assert.equal(player.x, 200, 'player did NOT move (no region crossed)');
  assert.equal(player.y, 200, 'player did NOT move (no region crossed)');
  assert.equal(bus.log.filter((e) => e.name === 'entity.warped').length, 0, 'no entity.warped when no region is crossed');
});

// The latch — a body landing ON the destination mouth's trigger does NOT ping-pong
// back (one warp per crossing). If the latch were broken the body would warp every
// tick (and emit every tick); we assert exactly one warp across two ticks.
check('entity.warped — the warp latch prevents an immediate re-warp (no ping-pong)', () => {
  // Crossing region a lands at b.mouth. Put b.mouth (490,290) INSIDE region b's own
  // AABB (480..500, 280..300) so the body lands ON a trigger and the latch must hold.
  const tunnels = [{
    a: { x: 0, y: 100, w: 20, h: 20, mouthX: 10, mouthY: 110 },   // a.mouth: b-crossing lands here
    b: { x: 480, y: 280, w: 20, h: 20, mouthX: 490, mouthY: 290 }, // b.mouth: a-crossing lands here, inside b's trigger
  }];
  const player = makePlayer(10, 110); // start inside region a (10 in 0..20, 110 in 100..120)
  const bus = makeBus();
  const scene = makeScene(player, makeGroup(), bus);
  const sys = new WarpTunnel({ tunnels });
  sys.attach(scene);

  sys.update(); // warp a -> b.mouth(490,290) which is INSIDE region b's trigger
  const afterFirst = bus.log.filter((e) => e.name === 'entity.warped').length;
  assert.equal(afterFirst, 1, 'exactly one warp on the crossing tick');
  assert.equal(player.x, 490, 'landed on b.mouth');
  assert.equal(player.y, 290, 'landed on b.mouth');

  sys.update(); // same position, still latched on region b -> MUST NOT warp again
  assert.equal(bus.log.filter((e) => e.name === 'entity.warped').length, 1, 'latch held: no re-warp while sitting on the destination trigger');
  assert.equal(player.x, 490, 'still on b.mouth (no ping-pong back)');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT (second observable in `expect`) — GHOST SLOW (the escape valve)
//  expect: a ghost inside a tunnel region has REDUCED measured speed in entities[].
//  Driven by the REAL GhostTarget (its applyVelocity writes body.velocity from
//  its public speed, the value WarpTunnel scales).
// ════════════════════════════════════════════════════════════════════════════
check('ghost slow — a ghost inside a tunnel region has reduced measured speed in entities[]; restored on exit', () => {
  const maze = makeGrid();
  const player = makePlayer(maze.cellCenter(3, 3).x, maze.cellCenter(3, 3).y); // far from tunnels
  const enemies = makeGroup();
  const bus = makeBus();
  const scene = makeScene(player, enemies, bus, maze);

  // A real ghost INSIDE region a (10,110), base speed 90. (region a AABB 0..20,100..120)
  const ghost = makeGhostSprite(scene, 10, 110, 90, 'blinky');
  enemies.add(ghost);

  // BASELINE: tick the GhostTarget alone (NO WarpTunnel) → measured speed at base.
  // Snap the ghost to a cell center first so applyVelocity drives a full-speed move.
  ghost.x = maze.cellCenter(2, 2).x; ghost.y = maze.cellCenter(2, 2).y;
  ghost.__ghost.update();
  const baseMeasured = measuredSpeed(entitiesOf(scene)[0]);
  assert.ok(baseMeasured > 0, `ghost moves at its base speed before the tunnel (measured ${baseMeasured})`);
  assert.equal(Math.round(baseMeasured), 90, 'base measured speed = the GhostTarget base (90)');

  // DRIVE the slow verb: move the ghost INTO region a, then run WarpTunnel.update().
  ghost.x = 10; ghost.y = 110; // CENTER inside region a
  const sys = new WarpTunnel({ tunnels: TUNNELS, ghostSlowFactor: 0.5 });
  sys.attach(scene);
  sys.update(); // scales GhostTarget.speed 90 -> ~45 while inside the region

  // The ghost gets repositioned by the warp too; that's expected — but the SLOW is the
  // assertion here. Re-drive the ghost from a cell center to read its measured speed
  // at the (now scaled) public speed.
  ghost.x = maze.cellCenter(2, 2).x; ghost.y = maze.cellCenter(2, 2).y;
  ghost.__ghost.update();
  const slowMeasured = measuredSpeed(entitiesOf(scene)[0]);

  // G1 OBSERVABLE: the ghost's measured Δposition/frame DROPPED to ~slowFactor× base.
  assert.ok(
    slowMeasured < baseMeasured,
    `slowed measured speed (${slowMeasured}) is below the base (${baseMeasured}) — the escape valve`,
  );
  assert.equal(Math.round(slowMeasured), 45, 'measured speed scaled to ~0.5x base (45) while inside the tunnel');

  // RESTORE: move the ghost OUT of every region and re-run WarpTunnel.update().
  ghost.x = maze.cellCenter(3, 3).x; ghost.y = maze.cellCenter(3, 3).y; // open interior, no region
  sys.update(); // restores GhostTarget.speed back to base
  ghost.x = maze.cellCenter(2, 2).x; ghost.y = maze.cellCenter(2, 2).y;
  ghost.__ghost.update();
  const restoredMeasured = measuredSpeed(entitiesOf(scene)[0]);
  assert.equal(Math.round(restoredMeasured), 90, 'measured speed restored to base (90) on leaving the tunnel');
});

// COUNTERFACTUAL guard for the slow: with the slow DISABLED (ghostSlowFactor >= 1)
// the ghost inside the region keeps its full measured speed — proves the assertion
// reads the real scaled value, not a constant.
check('ghost slow — counterfactual: factor>=1 disables the slow → measured speed stays at base inside the region', () => {
  const maze = makeGrid();
  const scene = makeScene(makePlayer(maze.cellCenter(3, 3).x, maze.cellCenter(3, 3).y), makeGroup(), makeBus(), maze);
  const ghost = makeGhostSprite(scene, 10, 110, 90, 'blinky'); // inside region a
  (scene.enemies as any).add(ghost);
  const sys = new WarpTunnel({ tunnels: TUNNELS, ghostSlowFactor: 1 }); // slow disabled
  sys.attach(scene);
  sys.update();
  ghost.x = maze.cellCenter(2, 2).x; ghost.y = maze.cellCenter(2, 2).y;
  ghost.__ghost.update();
  assert.equal(Math.round(measuredSpeed(entitiesOf(scene)[0])), 90, 'full speed retained when the slow is disabled');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
