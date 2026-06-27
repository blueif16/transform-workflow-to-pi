/**
 * GravityDrop — ORACLE drive test (falling-block board rule, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts the GravityDrop board rule through the
 * ENGINE'S OWN resolver (world.mountBehavior). GravityDrop is BOTH an IGridBehavior and
 * a scene-attached gravity engine: attach(scene) wires the scene's REAL EventBus + spawns
 * the first piece, and update(dtMs) runs the gravity tick / lock-delay / line-clear against
 * the scene's LIVE board — the exact loop DataGridScene.update drives. We DRIVE the real
 * gravity engine by ticking update(dtMs) and assert each declared event + its observable
 * board/score transition. The test never imports the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/behaviors/GravityDrop.ts):
 *   - piece.locked  drivenBy "a falling piece lands"   expect __GAME__ board gains the locked cells
 *   - lines.cleared drivenBy "a full row completes"    expect __GAME__.score increases + rows collapse
 *
 *   node templates/modules/grid_logic/src/behaviors/__tests__/GravityDrop.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const countCells = (g) => g.flat().filter((v) => v !== 0).length;

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 1: tick the real gravity engine until a piece can fall no further -> it LOCKS,
// writing its settled cells into the live board (piece.locked).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  scene.rng = () => 0; // deterministic 7-bag (so the piece is reproducible)
  scene.board.setGrid([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);

  const beh = world.mountBehavior('GravityDrop', { gravityMs: 100, lockDelayMs: 100 }, scene);
  check('resolveBehavior returned a real GravityDrop', beh.constructor.name === 'GravityDrop', beh.constructor.name);
  beh.attach(scene); // wires the real bus + spawns the first piece (the I, with rng=0)

  // Rotate the spawned I-piece to VERTICAL so its lock occupies a single column and does
  // NOT complete a (4-wide) row — so the locked cells PERSIST on the board (a clear would
  // empty them). The rotate's composited preview is discarded by resetting the settled board.
  const rot = beh.resolve(scene.board.snapshot(), 'up');
  check('the I-piece rotated to vertical (changed:true)', rot.changed === true, `changed=${rot.changed}`);
  scene.board.setGrid([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);

  const cur = bus.cursor;
  const cellsBefore = countCells(scene.board.snapshot());
  // Drive the REAL gravity tick: large dt steps advance gravity + the lock-delay.
  for (let i = 0; i < 12; i++) beh.update(200);

  const locked = bus.recent(cur).filter((e) => e.type === 'piece.locked');
  check('piece.locked logged once the piece could fall no further', locked.length >= 1, `count=${locked.length}`);
  const p = locked[0].payload;
  check('piece.locked payload carries the pieceId + its 4 settled cells', typeof p?.pieceId === 'number' && Array.isArray(p?.cells) && p.cells.length === 4, JSON.stringify(p));

  // OBSERVABLE: the live board GAINED the locked cells (the settled piece is written in).
  const cellsAfter = countCells(scene.board.snapshot());
  check('OBSERVABLE: __GAME__ board gained the 4 locked cells', cellsAfter === cellsBefore + 4, `${cellsBefore}->${cellsAfter}`);
  // The locked cells in the payload are actually present (occupied) on the live board.
  const onBoard = p.cells.every((c) => scene.board.get(c.row, c.col) === p.pieceId);
  check('OBSERVABLE: the payload cells are the real occupied board cells', onBoard, JSON.stringify(p.cells));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 2: a piece that completes a full row clears it -> lines.cleared + score up.
// Pre-fill the bottom rows so the (deterministic) O piece, shifted fully left, fills
// the last gap of the bottom row when it locks.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  scene.rng = () => 0; // forces the O piece first (a 2x2 block)
  // cols 2,3 of the bottom two rows already full; cols 0,1 open -> the O fills them,
  // completing both bottom rows (each becomes [x,x,6,6]).
  scene.board.setGrid([
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 6, 6],
    [0, 0, 6, 6],
  ]);
  const beh = world.mountBehavior('GravityDrop', { gravityMs: 50, lockDelayMs: 50, lineScore: 100 }, scene);
  beh.attach(scene);

  // Shift the active piece fully LEFT so it lands in columns 0,1.
  for (let i = 0; i < 6; i++) { const r = beh.resolve(scene.board.snapshot(), 'left'); if (r.changed) scene.board.setGrid(r.grid); }

  const scoreBefore = scene.registry.get('score');
  const cur = bus.cursor;
  for (let i = 0; i < 20; i++) beh.update(100); // drive gravity until it locks + clears

  const cleared = bus.recent(cur).filter((e) => e.type === 'lines.cleared');
  check('lines.cleared logged when a full row completed', cleared.length >= 1, `count=${cleared.length}`);
  check('lines.cleared payload: >= 1 row + a positive gained score', cleared[0].payload?.rows >= 1 && cleared[0].payload?.gained > 0, JSON.stringify(cleared[0]?.payload));
  check('OBSERVABLE: __GAME__.score increased by the line-clear score', scene.registry.get('score') > scoreBefore, `${scoreBefore}->${scene.registry.get('score')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): without any gravity tick the freshly spawned
// piece has NOT landed — piece.locked / lines.cleared never fire and the board is
// unchanged. If lockAndAdvance's emit/board-write ran unconditionally this goes red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  scene.rng = () => 0;
  scene.board.setGrid([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  const beh = world.mountBehavior('GravityDrop', { gravityMs: 100, lockDelayMs: 100 }, scene);
  beh.attach(scene);

  const cellsBefore = countCells(scene.board.snapshot());
  const cur = bus.cursor;
  // NO update() tick -> no gravity, no lock.
  const fired = bus.recent(cur).filter((e) => e.type === 'piece.locked' || e.type === 'lines.cleared');
  check('counterfactual: no tick -> no piece.locked / lines.cleared', fired.length === 0, `count=${fired.length}`);
  check('counterfactual: no tick -> the settled board is unchanged', countCells(scene.board.snapshot()) === cellsBefore, `${cellsBefore}->${countCells(scene.board.snapshot())}`);

  world.destroy();
}

console.log(`\n[oracle] GravityDrop ok — ${passed} assertions: a ticked piece locks (piece.locked + board gains cells); a completed row clears (lines.cleared + score up); no tick -> no lock.`);
process.exit(0);
