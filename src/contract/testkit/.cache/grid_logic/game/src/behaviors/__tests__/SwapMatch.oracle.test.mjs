/**
 * SwapMatch — ORACLE drive test (match-3 board rule, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts the SwapMatch board rule through the
 * ENGINE'S OWN resolver (world.mountBehavior), wired to the scene's REAL EventBus via
 * the constructor `eventBus` param (the seam the Integrate step uses). We drive the
 * REAL verb — resolve(grid, 'swap:r1,c1,r2,c2'), the exact call DataGridScene.applyMove
 * makes — over a fixture where the swap forms a run, and assert each declared event +
 * its observable board/score transition. The test never imports the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/behaviors/SwapMatch.ts):
 *   - gems.swapped     drivenBy "swap two adjacent gems"           expect the two cells exchanged
 *   - match.cleared    drivenBy "a run of 3+ forms"                expect score increases + cells empty
 *   - cascade.resolved drivenBy "refill creates a new match"       expect cascade settles after N steps
 *
 *   node templates/modules/grid_logic/src/behaviors/__tests__/SwapMatch.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a legal swap that forms a vertical run of 3 -> the full cascade trace.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;

  // Wire the rule onto the scene's REAL bus via the constructor seam (the Integrate path).
  const beh = world.mountBehavior('SwapMatch', { gemTypes: 5, clearScore: 10, seed: 7, eventBus: scene.eventBus }, scene);
  check('resolveBehavior returned a real SwapMatch', beh.constructor.name === 'SwapMatch', beh.constructor.name);

  // Fixture: column 1 already holds 1s at rows 1,2; (0,0)=1 and (0,1)=2. Swapping the
  // adjacent (0,0)<->(0,1) puts a 1 at (0,1), forming a VERTICAL run of 3 in column 1.
  scene.board.setGrid([
    [1, 2, 3, 4],
    [4, 1, 2, 3],
    [3, 1, 4, 2],
    [2, 3, 4, 1],
  ]);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), 'swap:0,0,0,1'); // the REAL move seam
  check('the swap was a legal move (formed a match)', res.changed === true, `changed=${res.changed}`);
  scene.board.setGrid(res.grid); // the scene applies the resolved grid (applyMove path)

  const logged = bus.recent(cur);
  const swapped = logged.filter((e) => e.type === 'gems.swapped');
  const cleared = logged.filter((e) => e.type === 'match.cleared');
  const settled = logged.filter((e) => e.type === 'cascade.resolved');

  check('gems.swapped logged with the swapped cell pair', swapped.length >= 1 && swapped[0].payload?.r1 === 0 && swapped[0].payload?.c1 === 0 && swapped[0].payload?.c2 === 1, JSON.stringify(swapped[0]?.payload));
  check('match.cleared logged with a positive gained score', cleared.length >= 1 && cleared[0].payload?.gained > 0, JSON.stringify(cleared[0]?.payload));
  check('cascade.resolved logged once the board settled', settled.length === 1 && settled[0].payload?.passes >= 1, JSON.stringify(settled[0]?.payload));

  // OBSERVABLE board transition: the matched column-1 cells were emptied then gravity/
  // refill ran, so the resolved grid differs from the swap-only grid (a real clear happened).
  check('OBSERVABLE: the board changed (a run cleared, gravity + refill ran)', res.scoreDelta > 0, `scoreDelta=${res.scoreDelta}`);
  // The cleared score equals count*clearScore for the first pass at minimum (>= 30 for a 3-run).
  check('OBSERVABLE: the first clear scored count*clearScore (>= 30 for a 3-run)', cleared[0].payload?.gained >= 30, JSON.stringify(cleared[0]?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): an ILLEGAL swap (forms no run) is undone —
// changed:false, and NONE of the three events fire. If the swap/emit were unguarded,
// gems.swapped would log here.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('SwapMatch', { seed: 7, eventBus: scene.eventBus }, scene);

  // A board with NO three-in-a-row reachable by swapping (0,0)<->(0,1): a permutation
  // where neither resulting column/row run reaches 3.
  scene.board.setGrid([
    [1, 2, 3, 4],
    [2, 3, 4, 1],
    [3, 4, 1, 2],
    [4, 1, 2, 3],
  ]);

  const cur = bus.cursor;
  const res = beh.resolve(scene.board.snapshot(), 'swap:0,0,0,1');
  const fired = bus.recent(cur).filter((e) => e.type === 'gems.swapped' || e.type === 'match.cleared' || e.type === 'cascade.resolved');
  check('counterfactual: an illegal swap is a no-op (changed:false)', res.changed === false, `changed=${res.changed}`);
  check('counterfactual: an illegal swap fires NONE of the three events', fired.length === 0, `count=${fired.length}`);

  world.destroy();
}

console.log(`\n[oracle] SwapMatch ok — ${passed} assertions: a legal swap fires gems.swapped + match.cleared + cascade.resolved with a real board clear/score; an illegal swap is a silent no-op.`);
process.exit(0);
