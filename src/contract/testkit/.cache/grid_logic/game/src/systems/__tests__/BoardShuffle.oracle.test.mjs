/**
 * BoardShuffle — ORACLE drive test (deadlock-recovery system, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts BoardShuffle through the ENGINE'S OWN
 * resolver (world.mountSystem), which attaches it into the real scene. We DRIVE the real
 * verb — recompose() (the PUBLIC recovery seam the scene's onMove calls) — over a board
 * fixture that is genuinely DEADLOCKED (full, no orthogonally-adjacent equal pair), and
 * assert the declared event + its observable board transition. The test never imports
 * the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/systems/BoardShuffle.ts):
 *   - board.shuffled  drivenBy "no legal move remains (the board is deadlocked) after a move"
 *                     expect __GAME__ the board is recomposed into a layout with a legal move
 *
 *   node templates/modules/grid_logic/src/systems/__tests__/BoardShuffle.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// A board is deadlocked iff it is FULL and no two orthogonally-adjacent cells are equal.
// The 2/4 checkerboard below is full and has no adjacent (up/down/left/right) equal pair,
// so it is genuinely game-over — but its multiset {eight 2s, eight 4s} CAN be re-laid into
// a layout with a legal move (e.g. two equal tiles side by side), so recompose recovers it.
const DEADLOCK = [
  [2, 4, 2, 4],
  [4, 2, 4, 2],
  [2, 4, 2, 4],
  [4, 2, 4, 2],
];
const hasAdjacentEqual = (g) => {
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) {
    if (c + 1 < g[r].length && g[r][c] === g[r][c + 1]) return true;
    if (r + 1 < g.length && g[r][c] === g[r + 1][c]) return true;
  }
  return false;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a deadlocked board -> recompose() recovers it into a layout with a legal move.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;

  const sys = world.mountSystem('BoardShuffle', { maxTries: 64 });
  check('resolveSystem returned a real BoardShuffle', sys.constructor.name === 'BoardShuffle', sys.constructor.name);

  scene.board.setGrid(DEADLOCK);
  check('precondition: the fixture is deadlocked (full, no adjacent equal pair)', !hasAdjacentEqual(DEADLOCK) && DEADLOCK.flat().every((v) => v !== 0), 'deadlock fixture');
  const shuffleBefore = sys.shuffleCount;

  const cur = bus.cursor;
  sys.recompose(); // the REAL recovery seam

  const ev = bus.recent(cur).filter((e) => e.type === 'board.shuffled');
  check('board.shuffled logged', ev.length === 1, `count=${ev.length}`);
  check('board.shuffled payload reports a recovery (recovered:true)', ev[0].payload?.recovered === true, JSON.stringify(ev[0]?.payload));
  check('OBSERVABLE: shuffleCount incremented', sys.shuffleCount === shuffleBefore + 1, `${shuffleBefore}->${sys.shuffleCount}`);

  // OBSERVABLE: the recomposed board now HAS a legal move (an adjacent equal pair exists),
  // so play can continue — the recovery actually changed the board into a non-deadlocked one.
  const after = scene.board.snapshot();
  check('OBSERVABLE: the recomposed board has a legal move (an adjacent equal pair)', hasAdjacentEqual(after), JSON.stringify(after));
  // The multiset of tile values is preserved (recompose re-lays the SAME tiles).
  const sum = (g) => g.flat().reduce((a, b) => a + b, 0);
  check('OBSERVABLE: the same tiles were re-laid (value sum preserved)', sum(after) === sum(DEADLOCK), `${sum(after)} vs ${sum(DEADLOCK)}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): on a board that is NOT deadlocked (a legal move
// remains), recompose() is a no-op — board.shuffled does NOT fire and the board is
// unchanged. If recompose shuffled unconditionally this goes red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const sys = world.mountSystem('BoardShuffle', {});

  // A board with an empty cell -> a legal move exists -> NOT deadlocked.
  const live = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]];
  scene.board.setGrid(live);
  const cur = bus.cursor;
  sys.recompose();
  const fired = bus.recent(cur).filter((e) => e.type === 'board.shuffled');
  check('counterfactual: a non-deadlocked board fires no board.shuffled', fired.length === 0, `count=${fired.length}`);
  check('counterfactual: the board is unchanged', scene.board.snapshot().flat().every((v, i) => v === live.flat()[i]), 'unchanged');
  check('counterfactual: shuffleCount stays 0', sys.shuffleCount === 0, `shuffleCount=${sys.shuffleCount}`);

  world.destroy();
}

console.log(`\n[oracle] BoardShuffle ok — ${passed} assertions: a deadlocked board recomposes into a layout with a legal move (board.shuffled + same tiles); a non-deadlocked board is a silent no-op.`);
process.exit(0);
