/**
 * ChordReveal — ORACLE drive test (deduction-grid chord behavior, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts the ChordReveal behavior through the
 * ENGINE'S OWN resolver (world.mountBehavior), wired to the scene's REAL EventBus +
 * board geometry via attach(scene). We DRIVE the real player verbs — the PUBLIC seams
 * revealAt / toggleFlagAt / chordAt (the exact methods the scene's input layer calls) —
 * and assert the declared event + its observable revealedCount transition. The mine
 * layout is made DETERMINISTIC by stubbing Math.random during placement, so the chord
 * scenario is reasoned-out exactly. The test never imports the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/behaviors/ChordReveal.ts):
 *   - chord.revealed  drivenBy "player chords a revealed number whose flags are satisfied"
 *                     expect __GAME__ adjacent unflagged cells reveal (revealedCount jumps)
 *
 *   node templates/modules/grid_logic/src/behaviors/__tests__/ChordReveal.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// Deterministic field (Math.random=0, mineCount 8, first reveal at (3,3) on a 4x4):
//   mines:  (0,1)(0,2)(0,3)(1,0)(1,1)(1,2)(1,3)(2,0)
//   safe hidden non-mine: (0,0) and (3,0)
//   revealed by the first click: (2,1)(2,2)(2,3)(3,1)(3,2)(3,3)
// (2,1) is a revealed "4": its mine-neighbours are (1,0)(1,1)(1,2)(2,0); its only HIDDEN
// non-mine neighbour is (3,0). Flagging the 4 mines satisfies the number; chording it
// then opens (3,0) -> revealedCount jumps by 1.
async function layField(beh, scene) {
  const orig = Math.random;
  Math.random = () => 0;
  beh.revealAt(3, 3); // lays the deterministic field + floods the bottom region
  Math.random = orig;
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: flag the 4 mine-neighbours of the revealed "4" at (2,1), then CHORD it ->
// it is satisfied and reveals the remaining hidden non-mine neighbour (3,0).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('ChordReveal', { mineCount: 8, rows: 4, cols: 4 }, scene);
  check('resolveBehavior returned a real ChordReveal', beh.constructor.name === 'ChordReveal', beh.constructor.name);
  beh.attach(scene);

  await layField(beh, scene);
  const revealedAfterClick = beh.revealedCount;
  check('precondition: the opening reveal opened the bottom region', revealedAfterClick === 6, `revealedCount=${revealedAfterClick}`);

  // Flag the 4 mine-neighbours of (2,1) so the number is satisfied.
  for (const [r, c] of [[1, 0], [1, 1], [1, 2], [2, 0]]) beh.toggleFlagAt(r, c);
  check('precondition: 4 flags placed (the number is satisfiable)', beh.flagCount === 4, `flagCount=${beh.flagCount}`);

  const cur = bus.cursor;
  beh.chordAt(2, 1); // the REAL chord verb on the satisfied "4"

  const chord = bus.recent(cur).filter((e) => e.type === 'chord.revealed');
  check('chord.revealed logged', chord.length === 1, `count=${chord.length}`);
  check('chord.revealed: the number was satisfied (flags == adjacent mines)', chord[0].payload?.satisfied === true && chord[0].payload?.number === 4, JSON.stringify(chord[0]?.payload));
  check('chord.revealed: opened >= 1 cell (the fast-clear fired)', chord[0].payload?.opened >= 1, JSON.stringify(chord[0]?.payload));

  // OBSERVABLE: revealedCount JUMPED (the hidden non-mine neighbour (3,0) opened); no mine hit.
  check('OBSERVABLE: revealedCount jumped after the chord', beh.revealedCount > revealedAfterClick, `${revealedAfterClick}->${beh.revealedCount}`);
  check('OBSERVABLE: the run is not lost (a satisfied chord hit no mine)', scene.registry.get('status') !== 'lost', `status=${scene.registry.get('status')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): chording the SAME "4" with NO flags placed is
// UNSATISFIED — it opens NOTHING. revealedCount does not change beyond the opening
// reveal, and the chord.revealed payload reports satisfied:false / opened:0. If chordAt
// opened cells regardless of the flag count this goes red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const beh = world.mountBehavior('ChordReveal', { mineCount: 8, rows: 4, cols: 4 }, scene);
  beh.attach(scene);
  await layField(beh, scene);
  const before = beh.revealedCount;

  const cur = bus.cursor;
  beh.chordAt(2, 1); // chord WITHOUT flagging -> unsatisfied -> opens nothing
  const chord = bus.recent(cur).filter((e) => e.type === 'chord.revealed');
  check('counterfactual: an unsatisfied chord reports satisfied:false, opened:0', chord.length === 1 && chord[0].payload?.satisfied === false && chord[0].payload?.opened === 0, JSON.stringify(chord[0]?.payload));
  check('counterfactual: revealedCount is unchanged (nothing opened)', beh.revealedCount === before, `${before}->${beh.revealedCount}`);

  world.destroy();
}

console.log(`\n[oracle] ChordReveal ok — ${passed} assertions: a satisfied chord opens hidden cells (chord.revealed + revealedCount jump); an unsatisfied chord opens nothing.`);
process.exit(0);
