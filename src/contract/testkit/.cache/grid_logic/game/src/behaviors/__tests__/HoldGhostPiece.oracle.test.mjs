/**
 * HoldGhostPiece — ORACLE drive test (falling-block hold + hard-drop rule, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts the HoldGhostPiece board rule through the
 * ENGINE'S OWN resolver (world.mountBehavior). attach(scene) wires the scene's REAL
 * EventBus + spawns the first piece. We DRIVE the real player verbs — resolve(grid,'hold')
 * and resolve(grid,'harddrop'), the exact calls DataGridScene.applyMove makes — and assert
 * each declared event + its observable transition. The test never imports the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/behaviors/HoldGhostPiece.ts):
 *   - piece.held        drivenBy "press hold"       expect __GAME__ active and held piece swap
 *   - piece.hardDropped drivenBy "press hard-drop"  expect the piece locks at the ghost position
 *
 *   node templates/modules/grid_logic/src/behaviors/__tests__/HoldGhostPiece.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 1: a 'hold' intent swaps the active piece into the hold slot (piece.held).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  scene.rng = () => 0; // deterministic 7-bag
  scene.board.setGrid([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);

  const beh = world.mountBehavior('HoldGhostPiece', {}, scene);
  check('resolveBehavior returned a real HoldGhostPiece', beh.constructor.name === 'HoldGhostPiece', beh.constructor.name);
  beh.attach(scene); // spawns the first piece

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), 'hold'); // the REAL hold verb
  check('the first hold succeeded (changed:true)', res.changed === true, `changed=${res.changed}`);

  const held = bus.recent(cur).filter((e) => e.type === 'piece.held');
  check('piece.held logged with the swapped piece ids', held.length === 1 && typeof held[0].payload?.heldId === 'number' && typeof held[0].payload?.activeId === 'number', JSON.stringify(held[0]?.payload));
  // OBSERVABLE: the active piece and the held piece are DIFFERENT pieces (a real swap).
  check('OBSERVABLE: active != held after the swap (the stash happened)', held[0].payload?.activeId !== held[0].payload?.heldId, JSON.stringify(held[0]?.payload));
  check('OBSERVABLE: swapped flag is true (the incoming piece placed)', held[0].payload?.swapped === true, JSON.stringify(held[0]?.payload));

  // A SECOND hold this drop is the once-per-drop no-op (no second piece.held).
  const cur2 = bus.cursor;
  const res2 = beh.resolve(scene.board.snapshot(), 'hold');
  check('once-per-drop: a second hold is a no-op (changed:false)', res2.changed === false, `changed=${res2.changed}`);
  check('once-per-drop: no second piece.held logged', bus.recent(cur2).filter((e) => e.type === 'piece.held').length === 0, 'second hold');

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 2: a 'harddrop' slams the active piece to the ghost row + locks (piece.hardDropped).
// On the 4-wide board the deterministic I-piece falls 2 cells and completes a row, so the
// observable is the real fall (cellsFell>0) AND the banked line-clear score.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  scene.rng = () => 0; // first piece = I (4-wide)
  scene.board.setGrid([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);

  const beh = world.mountBehavior('HoldGhostPiece', { lineScore: 100, hardDropScore: 2 }, scene);
  beh.attach(scene);

  const scoreBefore = scene.registry.get('score');
  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), 'harddrop'); // the REAL hard-drop verb
  check('the hard-drop is a real move (changed:true)', res.changed === true, `changed=${res.changed}`);
  scene.board.setGrid(res.grid); // the scene applies the resolved grid

  const hd = bus.recent(cur).filter((e) => e.type === 'piece.hardDropped');
  check('piece.hardDropped logged with the landing row + fall distance', hd.length === 1 && typeof hd[0].payload?.landingRow === 'number', JSON.stringify(hd[0]?.payload));
  // OBSERVABLE: the piece actually fell to its ghost row (a non-zero drop) — the slam happened.
  check('OBSERVABLE: the piece fell to the ghost row (cellsFell > 0)', hd[0].payload?.cellsFell > 0, JSON.stringify(hd[0]?.payload));
  // OBSERVABLE: locking completed a full row on the 4-wide board -> __GAME__.score banked the line.
  check('OBSERVABLE: __GAME__.score increased (the locked piece completed a line)', scene.registry.get('score') > scoreBefore, `${scoreBefore}->${scene.registry.get('score')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a plain 'left' shift fires NEITHER piece.held
// nor piece.hardDropped (only hold/harddrop do). If those emits were unguarded a shift
// would log them.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  scene.rng = () => 0;
  scene.board.setGrid([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  const beh = world.mountBehavior('HoldGhostPiece', {}, scene);
  beh.attach(scene);

  const cur = bus.cursor;
  beh.resolve(scene.board.snapshot(), 'left'); // a non-hold, non-harddrop move
  const fired = bus.recent(cur).filter((e) => e.type === 'piece.held' || e.type === 'piece.hardDropped');
  check('counterfactual: a shift fires neither piece.held nor piece.hardDropped', fired.length === 0, `count=${fired.length}`);

  world.destroy();
}

console.log(`\n[oracle] HoldGhostPiece ok — ${passed} assertions: hold swaps active<->held (piece.held, once per drop); hard-drop slams to the ghost row + locks (piece.hardDropped + real fall + score); a shift fires neither.`);
process.exit(0);
