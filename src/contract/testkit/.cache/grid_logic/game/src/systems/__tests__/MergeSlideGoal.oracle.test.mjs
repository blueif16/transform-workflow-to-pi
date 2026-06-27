/**
 * MergeSlideGoal — ORACLE drive test (NO-EVENT win/lose system, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts MergeSlideGoal through the ENGINE'S OWN
 * resolver (world.mountSystem), which attaches it into the real scene. We DRIVE the real
 * verb — onMove(info) (the post-move re-derive the scene calls after every resolved move)
 * — over a board fixture that satisfies the win (INV-4) / lose (INV-5) condition, and
 * assert the observable __GAME__.status transition (the system declares NO events; its
 * observable is the win/lose status it drives via scene.win()/scene.lose()). The test
 * never imports the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/systems/MergeSlideGoal.ts):
 *   - NO events declared. Observable: it drives __GAME__.status -> 'won' (a tile reaches
 *     winTarget, INV-4) or -> 'lost' (the board is exactly game-over, INV-5).
 *
 *   node templates/modules/grid_logic/src/systems/__tests__/MergeSlideGoal.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 1 (WIN, INV-4): a board holding a tile at the winTarget -> onMove drives status->'won'.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene } = world;

  const sys = world.mountSystem('MergeSlideGoal', { winTarget: 8 });
  check('resolveSystem returned a real MergeSlideGoal', sys.constructor.name === 'MergeSlideGoal', sys.constructor.name);

  // A board with an 8 present (== winTarget) -> the win is re-derived on the next move.
  scene.board.setGrid([[8, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  check('precondition: status is "playing" before the winning move', scene.registry.get('status') === 'playing', `status=${scene.registry.get('status')}`);

  sys.onMove({ changed: true, scoreDelta: 0, intent: 'left' }); // the REAL post-move re-derive

  // OBSERVABLE: __GAME__.status flipped to 'won'.
  check('OBSERVABLE: __GAME__.status became "won" (INV-4)', scene.registry.get('status') === 'won', `status=${scene.registry.get('status')}`);
  check('OBSERVABLE: the snapshot surface reports status "won"', world.snapshot().status === 'won', `snapshot.status=${world.snapshot().status}`);
  check('OBSERVABLE: the scene latched gameCompleted', scene.gameCompleted === true, `gameCompleted=${scene.gameCompleted}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 2 (LOSE, INV-5): a board that is EXACTLY game-over (full, no adjacent equal pair)
// -> onMove drives status->'lost'.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene } = world;
  const sys = world.mountSystem('MergeSlideGoal', { winTarget: 2048 });

  // Full board, all orthogonally-adjacent cells distinct -> no merge possible -> game over.
  scene.board.setGrid([
    [2, 4, 8, 16],
    [4, 8, 16, 32],
    [8, 16, 32, 64],
    [16, 32, 64, 128],
  ]);
  sys.onMove({ changed: true, scoreDelta: 0, intent: 'left' });

  check('OBSERVABLE: __GAME__.status became "lost" (INV-5)', scene.registry.get('status') === 'lost', `status=${scene.registry.get('status')}`);
  check('OBSERVABLE: the player is marked dead on a loss', scene.player.isDead === true, `isDead=${scene.player.isDead}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a mid-game board (no winTarget tile, an empty
// cell remains) re-derives to NEITHER win nor lose — onMove leaves status 'playing'. If
// MergeSlideGoal latched win/lose unconditionally this goes red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene } = world;
  const sys = world.mountSystem('MergeSlideGoal', { winTarget: 2048 });

  // No 2048 tile + an empty cell -> a legal move remains -> neither win nor lose.
  scene.board.setGrid([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]]);
  sys.onMove({ changed: true, scoreDelta: 0, intent: 'left' });

  check('counterfactual: a mid-game board stays "playing"', scene.registry.get('status') === 'playing', `status=${scene.registry.get('status')}`);
  check('counterfactual: the game did not complete', scene.gameCompleted === false, `gameCompleted=${scene.gameCompleted}`);

  world.destroy();
}

console.log(`\n[oracle] MergeSlideGoal ok — ${passed} assertions: a winTarget tile drives status->"won" (INV-4); a game-over board drives status->"lost" (INV-5); a mid-game board stays "playing".`);
process.exit(0);
