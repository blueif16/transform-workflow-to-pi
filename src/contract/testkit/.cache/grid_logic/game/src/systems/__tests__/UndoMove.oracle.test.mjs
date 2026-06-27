/**
 * UndoMove — ORACLE drive test (sokoban move-history undo system, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts UndoMove through the ENGINE'S OWN resolver
 * (world.mountSystem), which attaches it into the real scene (seeding the initial board
 * snapshot + wiring the scene's REAL EventBus, board, and re-derive seams). We DRIVE the
 * real verbs the GAME uses: onMove(info) (the scene's post-move push that records a
 * snapshot) to build a takeable-back move, then the PUBLIC undo() seam (the exact method
 * the undo-key handler calls). We assert the declared event + its observable board
 * transition. The test never imports the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/systems/UndoMove.ts):
 *   - move.undone drivenBy "the player presses undo"
 *                 expect __GAME__ board (board.snapshot) reverts to the prior state
 *
 *   node templates/modules/grid_logic/src/systems/__tests__/UndoMove.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const flat = (g) => g.flat();
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: record a resolved move (onMove pushes the new snapshot), then undo() -> the
// board reverts cell-for-cell to the prior state.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;

  const initial = [[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  scene.board.setGrid(initial); // the base position before the system attaches

  const sys = world.mountSystem('UndoMove', {}); // attach() seeds the base snapshot from this board
  check('resolveSystem returned a real UndoMove', sys.constructor.name === 'UndoMove', sys.constructor.name);

  // Simulate a resolved move the scene's applyMove would do: change the board + bump the
  // move counter + notify the system (onMove records the NEW snapshot).
  const moved = [[0, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  scene.board.setGrid(moved);
  scene.moveCount = (scene.moveCount ?? 0) + 1;
  const moveCountBeforeUndo = scene.moveCount;
  sys.onMove({ changed: true, scoreDelta: 0, intent: 'right' }); // push the post-move snapshot

  const cur = bus.cursor;
  sys.undo(); // the REAL undo seam — pop the current snapshot, restore the prior board

  const undone = bus.recent(cur).filter((e) => e.type === 'move.undone');
  check('move.undone logged', undone.length === 1, `count=${undone.length}`);
  check('move.undone payload carries the rolled-back move count', undone[0].payload?.moveCount === moveCountBeforeUndo - 1, JSON.stringify(undone[0]?.payload));

  // OBSERVABLE: the board reverted cell-for-cell to the PRIOR (initial) state.
  check('OBSERVABLE: board.snapshot reverted to the prior state', eq(flat(scene.board.snapshot()), flat(initial)), JSON.stringify(scene.board.snapshot()));
  check('OBSERVABLE: the tile slid back (2 is at (0,0) again, not (0,3))', scene.board.get(0, 0) === 2 && scene.board.get(0, 3) === 0, 'tile reverted');
  check('OBSERVABLE: the move counter rolled back by one', scene.moveCount === moveCountBeforeUndo - 1, `${moveCountBeforeUndo}->${scene.moveCount}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO recorded move (only the base snapshot on
// the stack), undo() is a no-op — move.undone does NOT fire and the board is unchanged.
// If undo() popped/emitted regardless of stack depth this goes red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const base = [[4, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  scene.board.setGrid(base);
  const sys = world.mountSystem('UndoMove', {}); // base snapshot only; no move recorded

  const cur = bus.cursor;
  sys.undo(); // nothing to undo
  const fired = bus.recent(cur).filter((e) => e.type === 'move.undone');
  check('counterfactual: undo with only the base snapshot fires no move.undone', fired.length === 0, `count=${fired.length}`);
  check('counterfactual: the board is unchanged', eq(flat(scene.board.snapshot()), flat(base)), JSON.stringify(scene.board.snapshot()));

  world.destroy();
}

console.log(`\n[oracle] UndoMove ok — ${passed} assertions: undo reverts the board cell-for-cell to the prior move (move.undone + tile slides back + move counter rolls back); undo with no recorded move is a silent no-op.`);
process.exit(0);
