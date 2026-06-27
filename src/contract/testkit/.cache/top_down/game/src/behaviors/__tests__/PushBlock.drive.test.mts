/**
 * PushBlock — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the ONE surface() event ('block.pushed') actually FIRES at runtime by
 * driving the REAL verb (`move` — the player walks INTO the block's cell) on the
 * REAL PushBlock behavior, attached to a REAL block owner, over a REAL MazeGrid,
 * and asserting the declared `expect` transition on OBSERVABLE state:
 *   - the block entity's position translates by ONE cell — owner.x/owner.y AND
 *     owner.gridX/owner.gridY (the values __GAME__.entities reads + mirrors) —
 *     in the push direction,
 *   - 'block.pushed' is logged on the scene's shared bus with {blockId,toGridX,toGridY},
 *   - a WALL-blocked push leaves the block exactly in place and emits NOTHING.
 *
 * Real objects: the behavior under test, the maze geometry, a real block sprite
 * (the owner — a plain object carrying x/y, exactly the shape __GAME__ reads), a
 * real recording EventBus, a real player object carrying the BasePlayer facing
 * seam. The scene is the harness boundary — a minimal Phaser-shaped host (headless
 * Phaser can't render) that owns NO logic under test: every cell-math / solid-cell
 * / commit / emit decision is the component's own code.
 *
 * The DRIVE is `update()` itself — the per-frame verb. We position the player ON
 * the block's cell facing a direction, tick update() (which detects the walk-in
 * and calls tryPush internally), and read the OBSERVABLE result. update() is the
 * `move` verb's real effect on the block; we do not call tryPush() directly so the
 * walk-in detection path is exercised end to end.
 *
 * COUNTERFACTUAL (meaningfulness): if update()/tryPush() were no-op'd, the block
 * would never translate (owner.x/y + gridX/gridY stay put) and 'block.pushed'
 * would never be recorded → assertions 1a/1b/1c fail. The wall-blocked case is the
 * built-in inverse guard: it proves the assertion BITES on the no-move/no-event
 * branch (a test that "passes" no matter what would pass both the push and the
 * wall case identically — these two diverge only because the real logic runs).
 */
import assert from 'node:assert/strict';
// Dynamic import: the source modules carry a type-only `@contract` import that
// trips tsx's static named-export resolution; `import()` loads the REAL classes
// cleanly (same objects, no aliasing).
const { PushBlock } = (await import('../PushBlock.ts')) as typeof import('../PushBlock.ts');
const { MazeGrid } = (await import('../../scenes/maze-grid.ts')) as typeof import('../../scenes/maze-grid.ts');

// ── observable adapter — the literal read __GAME__.entities does over a block ──
// __GAME__'s collectEntities reads each entity's x/y and mirrors gridX/gridY. The
// block owner IS that entity row; we read the same fields off the owner directly.
function entityRow(owner: any): { x: number; y: number; gridX: number; gridY: number } {
  return { x: owner.x, y: owner.y, gridX: owner.gridX, gridY: owner.gridY };
}

// ── a real getChildren-backed group (what scene.obstacles is to isSolidCell) ──
function makeGroup(items: any[] = []) {
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

// A 5x5 maze: a '#' ring + open interior (cells col/row 1..3 are walkable corridor).
function makeGrid() {
  return new MazeGrid({
    tileSize: 32, originX: 0, originY: 0,
    grid: ['#####', '#...#', '#...#', '#...#', '#####'],
  } as any);
}

// A real block owner sprite at a given cell center (the shape __GAME__ + the
// behavior read: x/y, plus a body whose reset() the commit calls). active true.
function makeBlock(grid: MazeGrid, col: number, row: number, id = 'blockA') {
  const c = grid.cellCenter(col, row);
  return {
    __id: id, __type: 'block', active: true,
    x: c.x, y: c.y,
    gridX: undefined as number | undefined, gridY: undefined as number | undefined,
    body: { reset(_x: number, _y: number) {} },
    scene: null as any, // wired below to the host scene
  };
}

// A real player carrying the BasePlayer facing seam (movement.movementDirection).
function makePlayer(grid: MazeGrid, col: number, row: number, facing: string) {
  const c = grid.cellCenter(col, row);
  return { x: c.x, y: c.y, active: true, movement: { movementDirection: facing } };
}

// Minimal Phaser-shaped scene host: the REAL maze, player, bus, obstacles group.
function makeScene(grid: MazeGrid, player: any, bus: ReturnType<typeof makeBus>, obstacles: any[] = []) {
  return { __maze: grid, player, eventBus: bus, obstacles: makeGroup(obstacles) };
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — block.pushed (drivenBy: move — the player walks into the block, target free)
//  expect: the block translates ONE cell in the push direction in __GAME__.entities;
//          block.pushed logged. (No emit when the target cell is solid.)
// ════════════════════════════════════════════════════════════════════════════
check('block.pushed — walking into the block (target free) shoves it one cell + logs the event', () => {
  const grid = makeGrid();
  // Block at interior cell (2,2). Player walks in from the LEFT facing 'right' →
  // the player stands ON (2,2); the block is shoved right to (3,2) (open corridor).
  const block = makeBlock(grid, 2, 2);
  const player = makePlayer(grid, 2, 2, 'right'); // player on the block's cell, facing right
  const bus = makeBus();
  const scene = makeScene(grid, player, bus, [block]);
  block.scene = scene;

  const push = new PushBlock();
  push.attach(block);

  // precondition: block sits at cell (2,2), nothing logged yet.
  assert.equal(push.gridX, 2, 'block derived start col 2 on attach');
  assert.equal(push.gridY, 2, 'block derived start row 2 on attach');
  assert.equal(bus.log.length, 0, 'no events before the push');
  const before = entityRow(block);

  // DRIVE the `move` verb: the player occupies the block's cell facing right →
  // update() detects the walk-in and shoves the block one cell.
  push.update();

  // 1a OBSERVABLE: the block's grid coords advanced one cell to (3,2).
  const after = entityRow(block);
  assert.equal(after.gridX, 3, 'block.gridX advanced one cell (2→3) — the __GAME__.entities col');
  assert.equal(after.gridY, 2, 'block.gridY unchanged on a right push');

  // 1b OBSERVABLE: the block's WORLD position translated one tile to the right
  // (the x/y __GAME__.entities reads), exactly one tileSize, y unchanged.
  assert.equal(after.x - before.x, grid.tileSize, 'block.x translated exactly one tile right');
  assert.equal(after.y, before.y, 'block.y unchanged on a horizontal push');
  assert.equal(after.x, grid.cellCenter(3, 2).x, 'block.x snapped to the (3,2) cell center');

  // 1c OBSERVABLE: block.pushed logged once with {blockId,toGridX,toGridY}.
  const pushed = bus.log.filter((e) => e.name === 'block.pushed');
  assert.equal(pushed.length, 1, 'block.pushed logged exactly once');
  assert.equal(pushed[0].payload.blockId, 'blockA', 'payload carries the block id');
  assert.equal(pushed[0].payload.toGridX, 3, 'payload toGridX = the new cell col');
  assert.equal(pushed[0].payload.toGridY, 2, 'payload toGridY = the new cell row');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — block.pushed WALL-BLOCKED inverse (the `expect` clause: "no emit when
//  the target cell is solid"). This is the meaningful counterfactual: same drive,
//  same code path, but the target cell is a wall → NO translation, NO event.
//  A test that passed regardless would pass this identically to the push above —
//  they diverge ONLY because the real isSolidCell/commit logic runs.
// ════════════════════════════════════════════════════════════════════════════
check('block.pushed — wall-blocked push: target cell is a wall → block stays put, NO event', () => {
  const grid = makeGrid();
  // Block hard against the RIGHT wall at (3,2); col 4 is the '#' ring. Player walks
  // in from the left facing 'right' → target cell (4,2) is a wall → blocked.
  const block = makeBlock(grid, 3, 2);
  const player = makePlayer(grid, 3, 2, 'right'); // on the block, facing into the wall
  const bus = makeBus();
  const scene = makeScene(grid, player, bus, [block]);
  block.scene = scene;

  const push = new PushBlock();
  push.attach(block);
  assert.equal(grid.isWall(4, 2), true, 'sanity: the target cell (4,2) IS a wall');
  const before = entityRow(block);

  // DRIVE the same verb into a wall.
  push.update();

  const after = entityRow(block);
  // OBSERVABLE: nothing moved — same world AND grid coords.
  assert.equal(after.gridX, before.gridX, 'wall-blocked: block.gridX unchanged');
  assert.equal(after.gridY, before.gridY, 'wall-blocked: block.gridY unchanged');
  assert.equal(after.x, before.x, 'wall-blocked: block.x unchanged');
  assert.equal(after.y, before.y, 'wall-blocked: block.y unchanged');
  // OBSERVABLE: NO event on the bus.
  assert.equal(bus.log.filter((e) => e.name === 'block.pushed').length, 0, 'wall-blocked: NO block.pushed emitted');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — block.pushed BLOCKED BY ANOTHER BLOCK (the second solid-cell branch:
//  "another block in scene.obstacles occupying the target cell blocks the push").
//  Two blocks in a row; pushing the first into the second is a no-op, no event.
// ════════════════════════════════════════════════════════════════════════════
check('block.pushed — blocked by a second block in the target cell → stays put, NO event', () => {
  const grid = makeGrid();
  const blockA = makeBlock(grid, 1, 2, 'blockA'); // pushed candidate
  const blockB = makeBlock(grid, 2, 2, 'blockB'); // sits in A's target cell
  const player = makePlayer(grid, 1, 2, 'right');  // on A, facing toward B
  const bus = makeBus();
  const scene = makeScene(grid, player, bus, [blockA, blockB]);
  blockA.scene = scene; blockB.scene = scene;

  const push = new PushBlock();
  push.attach(blockA);
  const before = entityRow(blockA);

  // DRIVE: push A right, but B occupies (2,2) → blocked.
  push.update();

  const after = entityRow(blockA);
  assert.equal(after.gridX, before.gridX, 'block-blocked: A.gridX unchanged');
  assert.equal(after.x, before.x, 'block-blocked: A.x unchanged');
  assert.equal(bus.log.filter((e) => e.name === 'block.pushed').length, 0, 'block-blocked: NO block.pushed emitted');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — block.pushed NOT TRIGGERED when the player is NOT on the block's cell
//  (the walk-in guard). The verb only fires on the actual walk-in; otherwise no-op.
// ════════════════════════════════════════════════════════════════════════════
check('block.pushed — player NOT on the block cell → no push, no event (the walk-in guard)', () => {
  const grid = makeGrid();
  const block = makeBlock(grid, 2, 2);
  const player = makePlayer(grid, 1, 2, 'right'); // adjacent cell, NOT on the block
  const bus = makeBus();
  const scene = makeScene(grid, player, bus, [block]);
  block.scene = scene;

  const push = new PushBlock();
  push.attach(block);
  const before = entityRow(block);
  push.update();
  const after = entityRow(block);
  assert.equal(after.gridX, before.gridX, 'no walk-in: block.gridX unchanged');
  assert.equal(after.x, before.x, 'no walk-in: block.x unchanged');
  assert.equal(bus.log.filter((e) => e.name === 'block.pushed').length, 0, 'no walk-in: NO block.pushed emitted');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
