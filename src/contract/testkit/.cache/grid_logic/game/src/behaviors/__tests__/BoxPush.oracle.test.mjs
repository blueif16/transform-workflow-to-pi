/**
 * BoxPush — ORACLE drive test (sokoban board rule, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts the BoxPush board rule through the
 * ENGINE'S OWN resolver (world.mountBehavior), wired to the scene's REAL EventBus via
 * attach(scene) (the {ref,params} owner seam). We DRIVE the real verb — resolve(grid,
 * intent), the exact call DataGridScene.applyMove makes — over a sokoban-tagged board
 * fixture, and assert each declared event + its observable board/status transition. The
 * test never imports the component.
 *
 * Cell tags: FLOOR 0 · WALL 1 · BOX 2 · PLAYER 3 · GOAL 4 · BOX_ON_GOAL 5 · PLAYER_ON_GOAL 6.
 *
 * surface() contract under test (templates/modules/grid_logic/src/behaviors/BoxPush.ts):
 *   - box.pushed    drivenBy "the player moves into a box on free floor" expect the box cell advances one tile
 *   - puzzle.solved drivenBy "the last box reaches a goal"               expect __GAME__.status becomes 'won'
 *
 *   node templates/modules/grid_logic/src/behaviors/__tests__/BoxPush.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

const FLOOR = 0, BOX = 2, PLAYER = 3, GOAL = 4, BOX_ON_GOAL = 5;

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 1: the player steps into a box on free floor -> the box advances (box.pushed).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('BoxPush', {}, scene);
  check('resolveBehavior returned a real BoxPush', beh.constructor.name === 'BoxPush', beh.constructor.name);
  beh.attach(scene); // wires the real bus

  // Player (0,0), box (0,1), free floor (0,2). A 'right' move pushes the box to (0,2).
  scene.board.setGrid([[PLAYER, BOX, FLOOR, FLOOR], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), 'right'); // the REAL move seam
  check('the push was a real move (changed:true)', res.changed === true, `changed=${res.changed}`);
  scene.board.setGrid(res.grid); // the scene applies the resolved grid

  const pushed = bus.recent(cur).filter((e) => e.type === 'box.pushed');
  check('box.pushed logged with from/to cells', pushed.length === 1 && pushed[0].payload?.to?.col === 2, JSON.stringify(pushed[0]?.payload));

  // OBSERVABLE: the box advanced exactly one cell — (0,1) is now the player, (0,2) the box.
  const after = scene.board.snapshot();
  check('OBSERVABLE: the box cell advanced one tile (0,1)->(0,2)', after[0][2] === BOX && after[0][1] === PLAYER, JSON.stringify(after[0]));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 2: pushing the last box onto the last goal solves the puzzle (puzzle.solved).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('BoxPush', {}, scene);
  beh.attach(scene);

  // Player (0,0), box (0,1), GOAL (0,2). A 'right' move pushes the box ONTO the goal ->
  // every goal covered -> puzzle.solved.
  scene.board.setGrid([[PLAYER, BOX, GOAL, FLOOR], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), 'right');
  scene.board.setGrid(res.grid);

  const pushed = bus.recent(cur).filter((e) => e.type === 'box.pushed');
  const solved = bus.recent(cur).filter((e) => e.type === 'puzzle.solved');
  check('box.pushed onGoal logged', pushed.length === 1 && pushed[0].payload?.onGoal === true, JSON.stringify(pushed[0]?.payload));
  check('puzzle.solved logged with boxes >= 1', solved.length === 1 && solved[0].payload?.boxes >= 1, JSON.stringify(solved[0]?.payload));

  // OBSERVABLE: the box landed on the goal cell (BOX_ON_GOAL) — every goal now covered.
  const after = scene.board.snapshot();
  check('OBSERVABLE: the box sits on the goal (BOX_ON_GOAL at (0,2))', after[0][2] === BOX_ON_GOAL, JSON.stringify(after[0]));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): pushing a box backed by a WALL is blocked —
// changed:false, the board is unchanged, and neither event fires. If the push/emit were
// unguarded, box.pushed would log here.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('BoxPush', {}, scene);
  beh.attach(scene);

  // Player (0,0), box (0,1), WALL (0,2): the box cannot advance (a second cell blocked).
  const grid = [[PLAYER, BOX, 1 /*WALL*/, FLOOR], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  scene.board.setGrid(grid);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), 'right');
  const fired = bus.recent(cur).filter((e) => e.type === 'box.pushed' || e.type === 'puzzle.solved');
  check('counterfactual: a wall-backed push is a no-op (changed:false)', res.changed === false, `changed=${res.changed}`);
  check('counterfactual: a blocked push fires neither event', fired.length === 0, `count=${fired.length}`);
  check('counterfactual: the board is unchanged', res.grid[0].every((v, i) => v === grid[0][i]), JSON.stringify(res.grid[0]));

  world.destroy();
}

console.log(`\n[oracle] BoxPush ok — ${passed} assertions: a push advances the box (box.pushed); the last box onto a goal solves (puzzle.solved + BOX_ON_GOAL); a wall-backed push is a silent no-op.`);
process.exit(0);
