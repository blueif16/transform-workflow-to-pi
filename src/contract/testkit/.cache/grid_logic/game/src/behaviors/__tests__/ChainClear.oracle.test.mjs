/**
 * ChainClear — ORACLE drive test (SameGame chain-clear board rule, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts the ChainClear board rule through the
 * ENGINE'S OWN resolver (world.mountBehavior), wired to the scene's REAL EventBus via
 * attach(scene). We DRIVE the real verb — resolve(grid, 'row,col') (a clicked cell), the
 * exact call DataGridScene.applyMove makes for a click intent — over fixtures that clear
 * a colour group and (separately) collapse an emptied column, asserting each declared
 * event + its observable board/score transition. The test never imports the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/behaviors/ChainClear.ts):
 *   - group.cleared     drivenBy "player clicks a same-colour group of >= minGroup cells"
 *                       expect __GAME__.score increases; the group cells empty
 *   - columns.collapsed drivenBy "a clear leaves a fully-empty column"
 *                       expect __GAME__ columns shift left to fill the gap
 *
 *   node templates/modules/grid_logic/src/behaviors/__tests__/ChainClear.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 1: click a 2-cell colour group -> group.cleared + the cells empty + score up.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('ChainClear', { minGroup: 2 }, scene);
  check('resolveBehavior returned a real ChainClear', beh.constructor.name === 'ChainClear', beh.constructor.name);
  beh.attach(scene);

  // A connected pair of value-5 cells at (0,0),(0,1); the rest distinct so nothing else clears.
  scene.board.setGrid([
    [5, 5, 3, 4],
    [1, 2, 3, 4],
    [2, 3, 1, 2],
    [3, 4, 2, 1],
  ]);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), '0,0'); // click the group's origin
  check('the click cleared a group (changed:true)', res.changed === true, `changed=${res.changed}`);
  check('the group score is n*(n-1) = 2 for a pair', res.scoreDelta === 2, `scoreDelta=${res.scoreDelta}`);

  const groupEv = bus.recent(cur).filter((e) => e.type === 'group.cleared');
  check('group.cleared logged with size 2 + the origin', groupEv.length === 1 && groupEv[0].payload?.size === 2 && groupEv[0].payload?.value === 5, JSON.stringify(groupEv[0]?.payload));

  // OBSERVABLE: after applying gravity, NO 5s remain anywhere (the colour group is gone).
  scene.board.setGrid(res.grid);
  const fives = res.grid.flat().filter((v) => v === 5).length;
  check('OBSERVABLE: the value-5 group cells were emptied (gravity-settled)', fives === 0, `remaining 5s=${fives}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 2: clearing a whole column collapses it leftward (columns.collapsed).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('ChainClear', { minGroup: 2 }, scene);
  beh.attach(scene);

  // Column 0 is ENTIRELY value 5 (a 4-cell connected group). Clicking it empties col 0
  // completely -> the remaining columns shift LEFT to fill the gap.
  scene.board.setGrid([
    [5, 1, 2, 3],
    [5, 2, 3, 4],
    [5, 3, 4, 1],
    [5, 4, 1, 2],
  ]);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), '0,0');
  scene.board.setGrid(res.grid);

  const groupEv = bus.recent(cur).filter((e) => e.type === 'group.cleared');
  const collapseEv = bus.recent(cur).filter((e) => e.type === 'columns.collapsed');
  check('group.cleared logged for the 4-cell column', groupEv.length === 1 && groupEv[0].payload?.size === 4, JSON.stringify(groupEv[0]?.payload));
  check('columns.collapsed logged when the emptied column shifted left', collapseEv.length === 1, `count=${collapseEv.length}`);

  // OBSERVABLE: the former column-1 contents now occupy column 0 (everything shifted left);
  // the rightmost column is now empty.
  const after = res.grid;
  const lastColEmpty = after.every((row) => row[3] === 0);
  check('OBSERVABLE: the rightmost column is now empty (columns shifted left)', lastColEmpty, JSON.stringify(after.map((r) => r[3])));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): clicking a LONE tile (sub-threshold group)
// clears nothing — changed:false, and neither event fires. If the clear/emit were
// unguarded, group.cleared would log here.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('ChainClear', { minGroup: 2 }, scene);
  beh.attach(scene);

  // (0,0)=9 is an isolated tile (no equal neighbour) -> a lone-tile click is a no-op.
  const grid = [[9, 1, 2, 3], [1, 2, 3, 4], [2, 3, 4, 1], [3, 4, 1, 2]];
  scene.board.setGrid(grid);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), '0,0');
  const fired = bus.recent(cur).filter((e) => e.type === 'group.cleared' || e.type === 'columns.collapsed');
  check('counterfactual: a lone-tile click is a no-op (changed:false)', res.changed === false, `changed=${res.changed}`);
  check('counterfactual: a sub-threshold click fires neither event', fired.length === 0, `count=${fired.length}`);
  check('counterfactual: the board is unchanged', res.grid[0][0] === 9, JSON.stringify(res.grid[0]));

  world.destroy();
}

console.log(`\n[oracle] ChainClear ok — ${passed} assertions: a group click clears + scores (group.cleared); a whole-column clear shifts columns (columns.collapsed); a lone-tile click is a silent no-op.`);
process.exit(0);
