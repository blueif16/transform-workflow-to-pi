/**
 * ConnectGravityDrop — ORACLE drive test (Connect-Four turn-duel board rule, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts the ConnectGravityDrop board rule through
 * the ENGINE'S OWN resolver (world.mountBehavior), wired to the scene's REAL EventBus +
 * board + status seams via attach(scene). We DRIVE the real verb — resolve(grid,'drop'),
 * the exact call DataGridScene.applyMove makes — and assert each declared event + its
 * observable board/status transition. The test never imports the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/behaviors/ConnectGravityDrop.ts):
 *   - disc.dropped drivenBy "drop a disc in a column"          expect the disc lands at the lowest empty cell + the turn flips
 *   - board.drawn  drivenBy "the board fills with no winner"   expect __GAME__.status becomes a draw
 *
 *   node templates/modules/grid_logic/src/behaviors/__tests__/ConnectGravityDrop.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 1: drop a disc into the (empty) center column -> it lands at the lowest cell
// and the turn flips (disc.dropped). Hot-seat duel (autoOpponent off) so one drop = one move.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  scene.board.setGrid([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);

  const beh = world.mountBehavior('ConnectGravityDrop', { winLength: 4, autoOpponent: false }, scene);
  check('resolveBehavior returned a real ConnectGravityDrop', beh.constructor.name === 'ConnectGravityDrop', beh.constructor.name);
  beh.attach(scene); // cursor starts at the center column (floor(cols/2)=2)

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), 'drop'); // the REAL drop verb
  check('the drop was a real move (changed:true)', res.changed === true, `changed=${res.changed}`);

  const dropped = bus.recent(cur).filter((e) => e.type === 'disc.dropped');
  check('disc.dropped logged with col/row/side/next', dropped.length === 1, `count=${dropped.length}`);
  const d = dropped[0].payload;
  // OBSERVABLE: the disc lands at the LOWEST empty row of the center column (row 3 on an empty board).
  check('disc.dropped landed at the lowest empty cell (row 3, col 2)', d?.row === 3 && d?.col === 2, JSON.stringify(d));
  check('OBSERVABLE: the live board gained side-1 disc at that cell', scene.board.get(3, 2) === d.side && d.side === 1, `board(3,2)=${scene.board.get(3, 2)}`);
  // OBSERVABLE: the turn FLIPPED to the other side (payload next).
  check('OBSERVABLE: the turn flipped to the other side (next != side)', d?.next === 2 && d?.next !== d?.side, JSON.stringify(d));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 2: the final disc fills the board with no winner -> board.drawn + a terminal
// status. winLength=5 (> the max 4-in-a-row possible on a 4x4) guarantees NO line ever
// forms, so the full board is a guaranteed DRAW.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  // 15 cells placed (no 5-in-a-row possible); the only empty is the center column (3,2).
  scene.board.setGrid([
    [1, 2, 1, 2],
    [2, 1, 2, 1],
    [1, 2, 1, 2],
    [2, 1, 0, 1], // empty at (3,2) — the center column the cursor targets
  ]);
  const beh = world.mountBehavior('ConnectGravityDrop', { winLength: 5, autoOpponent: false }, scene);
  beh.attach(scene);

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), 'drop'); // drop the final disc into the center
  if (res.changed) scene.board.setGrid(res.grid);

  const dropped = bus.recent(cur).filter((e) => e.type === 'disc.dropped');
  const drawn = bus.recent(cur).filter((e) => e.type === 'board.drawn');
  check('the final drop logged disc.dropped', dropped.length === 1, `count=${dropped.length}`);
  check('board.drawn logged with no winner', drawn.length === 1 && drawn[0].payload?.winner === null && drawn[0].payload?.totalCells === 16, JSON.stringify(drawn[0]?.payload));

  // OBSERVABLE: the board is now full, and the game has terminated (status left 'playing').
  check('OBSERVABLE: the board is full', scene.board.snapshot().flat().every((v) => v !== 0), 'board full');
  check('OBSERVABLE: __GAME__.status left "playing" (the draw terminated the game)', world.snapshot().status !== 'playing', `status=${world.snapshot().status}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): dropping into a FULL column is a no-op —
// changed:false and neither event fires. If dropInto wrote/emitted unconditionally a
// full-column drop would log disc.dropped.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  // The center column (col 2) is entirely full; everything else has room.
  scene.board.setGrid([
    [0, 0, 1, 0],
    [0, 0, 2, 0],
    [0, 0, 1, 0],
    [0, 0, 2, 0],
  ]);
  const beh = world.mountBehavior('ConnectGravityDrop', { winLength: 4, autoOpponent: false }, scene);
  beh.attach(scene); // cursor at center (col 2) — the full column

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), 'drop');
  const fired = bus.recent(cur).filter((e) => e.type === 'disc.dropped' || e.type === 'board.drawn');
  check('counterfactual: a drop into a full column is a no-op (changed:false)', res.changed === false, `changed=${res.changed}`);
  check('counterfactual: a full-column drop fires neither event', fired.length === 0, `count=${fired.length}`);

  world.destroy();
}

console.log(`\n[oracle] ConnectGravityDrop ok — ${passed} assertions: a drop lands at the lowest cell + flips the turn (disc.dropped); a full no-winner board draws (board.drawn + terminal status); a full-column drop is a silent no-op.`);
process.exit(0);
