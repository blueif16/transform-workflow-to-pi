/**
 * MergeSlide — ORACLE drive test (NO-EVENT board-rule, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine via bootHeadlessGame({archetype}) and drives the
 * board's bound move RULE the exact way the GAME does — a real direction move through
 * DataGridScene.applyMove(), which routes the intent through the bound MergeSlide.resolve()
 * and applies the resolved grid to the live board. The test never imports the component;
 * the rule is the default-bound board rule the engine resolved.
 *
 * surface() contract under test (templates/modules/grid_logic/src/behaviors/MergeSlide.ts):
 *   - NO events declared. The observable transition is the BOARD MOVEMENT: a left/right/
 *     up/down move slides + merges equal tiles, changing board.snapshot() (and the
 *     __GAME__.score on a merge). We assert that observable board/score transition, plus
 *     a COUNTERFACTUAL: a move into a packed wall (no-op) leaves the board unchanged.
 *
 *   node templates/modules/grid_logic/src/behaviors/__tests__/MergeSlide.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const rowEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a real 'left' move slides + merges the two equal tiles in row 0.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene } = world;
  scene.rng = () => 0; // deterministic spawn: the post-merge tile lands on the first empty cell as a 2.

  // Fixture: two equal tiles (2,2) at the LEFT of row 0; the rest empty. A 'left' move
  // slides them together and merges into a single 4 at (0,0). A changed move ALSO spawns
  // exactly one new tile (INV-3) — with rng()=0 that spawn is a deterministic 2 at the
  // first empty cell (0,1) — so the resolved row 0 is exactly [4,2,0,0].
  scene.board.setGrid([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  scene.refreshCursor?.();
  const scoreBefore = scene.registry.get('score');
  const moveCountBefore = scene.moveCount;
  const tilesBefore = scene.board.snapshot().flat().filter((v) => v !== 0).length; // 2 tiles

  // DRIVE the REAL verb: the scene's own move seam (the same path a keydown calls).
  scene.applyMove('left');

  const after = scene.board.snapshot();
  const tilesAfter = after.flat().filter((v) => v !== 0).length;
  check('MOVE: the two 2s merged into a single 4 at (0,0)', after[0][0] === 4, JSON.stringify(after[0]));
  check('MOVE: row 0 resolved to the deterministic [4,2,0,0] (merge + INV-3 spawn-2)', rowEq(after[0], [4, 2, 0, 0]), JSON.stringify(after[0]));
  // 2 tiles merged into 1, then 1 tile spawned (INV-3) -> 2 tiles total.
  check('MOVE: the merge collapsed two tiles into one + spawned exactly one (INV-3)', tilesAfter === tilesBefore, `${tilesBefore}->${tilesAfter}`);
  check('MOVE: __GAME__.score rose by exactly the merge value (4)', scene.registry.get('score') === scoreBefore + 4, `${scoreBefore}->${scene.registry.get('score')}`);
  check('MOVE: the move counter advanced (a changed move resolved)', scene.moveCount === moveCountBefore + 1, `${moveCountBefore}->${scene.moveCount}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a move into a packed wall changes NOTHING.
// A board fully packed against the LEFT wall with no mergeable neighbours cannot
// slide left — applyMove returns early (changed:false), so the board + score + move
// counter are all unchanged. If MergeSlide.resolve() always reported `changed`, the
// board would mutate (spawn a tile) and this would go red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene } = world;

  // Already packed left, no adjacent equals in any row -> a 'left' move is a no-op.
  const packed = [[2, 4, 8, 16], [4, 8, 16, 32], [8, 16, 32, 64], [16, 32, 64, 128]];
  scene.board.setGrid(packed);
  scene.refreshCursor?.();
  const scoreBefore = scene.registry.get('score');
  const moveCountBefore = scene.moveCount;

  scene.applyMove('left'); // no-op: nothing can slide/merge left

  const after = scene.board.snapshot();
  check('counterfactual: a no-op move leaves the board cell-for-cell unchanged', after.every((row, r) => rowEq(row, packed[r])), JSON.stringify(after));
  check('counterfactual: score unchanged on a no-op move', scene.registry.get('score') === scoreBefore, `${scoreBefore}->${scene.registry.get('score')}`);
  check('counterfactual: move counter unchanged on a no-op move', scene.moveCount === moveCountBefore, `${moveCountBefore}->${scene.moveCount}`);

  world.destroy();
}

console.log(`\n[oracle] MergeSlide ok — ${passed} assertions: a real 'left' move merges [2,2]->[4] (board + __GAME__.score transition); a no-op move into a packed wall changes nothing.`);
process.exit(0);
