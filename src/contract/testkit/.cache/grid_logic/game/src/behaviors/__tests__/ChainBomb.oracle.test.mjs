/**
 * ChainBomb — ORACLE drive test (chain-clear bomb board rule, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts the ChainBomb board rule through the
 * ENGINE'S OWN resolver (world.mountBehavior), wired to the scene's REAL EventBus via
 * attach(scene). We DRIVE the real verb — resolve(grid,'row,col') (a clicked cell), the
 * exact call DataGridScene.applyMove makes for a click intent — over a fixture where a
 * popped colour group touches a BOMB tile (board value === bombValue), and assert the
 * declared event + its observable board/score transition. The test never imports the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/behaviors/ChainBomb.ts):
 *   - bomb.triggered  drivenBy "player pops a colour group that touches a bomb tile"
 *                     expect an extra cross/area of cells clears beyond the connected region; score jumps
 *
 *   node templates/modules/grid_logic/src/behaviors/__tests__/ChainBomb.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

const BOMB = 99;

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: pop a 2-cell colour group adjacent to a bomb -> the bomb detonates, clearing
// an extra cross beyond the colour region (bomb.triggered), and the score jumps by the
// SameGame group score (n*(n-1)=2) + the flat bombBonus (50) = 52.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('ChainBomb', { minGroup: 2, bombValue: BOMB, blastRadius: 2, bombBonus: 50 }, scene);
  check('resolveBehavior returned a real ChainBomb', beh.constructor.name === 'ChainBomb', beh.constructor.name);
  beh.attach(scene);

  // A connected pair of value-5 cells at (0,0),(0,1); a BOMB at (0,2) is 4-adjacent to the
  // group. Clicking (0,0) pops the pair AND detonates the bomb's cross.
  scene.board.setGrid([
    [5, 5, BOMB, 4],
    [1, 2, 3, 4],
    [2, 3, 1, 2],
    [3, 4, 2, 1],
  ]);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), '0,0'); // the REAL pop verb
  check('the pop was a real move (changed:true)', res.changed === true, `changed=${res.changed}`);
  // scoreDelta = group score n*(n-1)=2 + bombBonus 50 = 52.
  check('the score jumped by group + bomb bonus (2 + 50 = 52)', res.scoreDelta === 52, `scoreDelta=${res.scoreDelta}`);

  const bombEv = bus.recent(cur).filter((e) => e.type === 'bomb.triggered');
  check('bomb.triggered logged with the origin + bomb count', bombEv.length === 1 && bombEv[0].payload?.bombs >= 1 && bombEv[0].payload?.origin?.row === 0, JSON.stringify(bombEv[0]?.payload));
  // OBSERVABLE: cells cleared BEYOND the colour region (the bomb cleared extra cells).
  check('OBSERVABLE: the detonation cleared cells beyond the colour group', bombEv[0].payload?.extraCleared >= 1, JSON.stringify(bombEv[0]?.payload));

  // OBSERVABLE: no bomb tile remains where it detonated (the bomb cell itself cleared).
  scene.board.setGrid(res.grid);
  const bombsLeft = res.grid.flat().filter((v) => v === BOMB).length;
  check('OBSERVABLE: the detonated bomb tile is gone from the board', bombsLeft === 0, `bombs remaining=${bombsLeft}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): popping a colour group with NO adjacent bomb
// clears only the colour region — bomb.triggered does NOT fire and the score is just the
// SameGame group score (2), with no bomb bonus. If detonateChain ran regardless of an
// adjacent bomb this goes red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('ChainBomb', { minGroup: 2, bombValue: BOMB, bombBonus: 50 }, scene);
  beh.attach(scene);

  // A value-5 pair at (0,0),(0,1) with NO bomb anywhere near it (bomb tucked far away,
  // not 4-adjacent to the group).
  scene.board.setGrid([
    [5, 5, 3, 4],
    [1, 2, 3, 4],
    [2, 3, 1, 2],
    [3, 4, 2, BOMB],
  ]);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), '0,0');
  const fired = bus.recent(cur).filter((e) => e.type === 'bomb.triggered');
  check('counterfactual: a bomb-free pop fires no bomb.triggered', fired.length === 0, `count=${fired.length}`);
  check('counterfactual: the score is just the group score (2), no bomb bonus', res.scoreDelta === 2, `scoreDelta=${res.scoreDelta}`);

  world.destroy();
}

console.log(`\n[oracle] ChainBomb ok — ${passed} assertions: a pop touching a bomb detonates it (bomb.triggered + extra cells cleared + score jump of 52); a bomb-free pop fires no bomb.triggered (score 2).`);
process.exit(0);
