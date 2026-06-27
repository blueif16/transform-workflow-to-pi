/**
 * PaddleDuelAI — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the system through the ENGINE'S OWN
 * resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/systems/PaddleDuelAI.ts):
 *   - ball.served    drivenBy "a point starts (the first serve, or a re-serve after a score)"
 *                    expect   "the ball re-centers and launches toward a side (__GAME__ ball velocity
 *                              points to that side); ball.served logged"
 *   - volley.scored  drivenBy "the ball passes a paddle (a missed return at a duel goal)"
 *                    expect   "that side's score increments (the player side raises __GAME__.score);
 *                              at first-to-N __GAME__.status resolves; volley.scored logged"
 *
 * REAL drive through the REAL seams:
 *   - ball.served fires inside attach() (the first point auto-serves), so we capture the bus cursor
 *     BEFORE mounting and assert the event + the real ball-velocity-toward-a-side transition right
 *     after mount. (The verb "a point starts" IS the mount/serve — the engine path, not a private call.)
 *   - volley.scored is driven by the REAL per-frame update(): we position the live scene.ball PAST a
 *     duel goal (the exact geometry the scene's ball loop produces) and STEP the real engine — update()
 *     reads the ball, detects the missed return, and scores the opposing side. With aiPaddleSide='left'
 *     the LEFT-goal exit credits the PLAYER, so the registry 'score' (== __GAME__.score) increments.
 *     We never call score()/the private emit. A COUNTERFACTUAL parks the ball at center (no goal
 *     crossed) → no new volley.scored, player score unchanged.
 *
 *   node templates/modules/paddle_ball/src/systems/__tests__/PaddleDuelAI.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const score = (scene) => Number(scene.registry.get('score') ?? 0);

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: the first serve (BALL.SERVED at mount), then a goal exit (VOLLEY.SCORED).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  // Capture the cursor BEFORE mount — attach() serves the first point (ball.served fires there).
  // wallInset=40 puts the duel goal OUTSIDE the base scene's reflective wall (_wallInset=16) so a
  // ball driven into the goal band reaches the goal plane instead of being mirrored by the wall.
  const cur0 = bus.cursor;
  const duel = world.mountSystem('PaddleDuelAI', { aiPaddleSide: 'left', targetScore: 5, wallInset: 40 });
  check('resolveSystem returned a real PaddleDuelAI', duel.constructor.name === 'PaddleDuelAI', duel.constructor.name);

  // BALL.SERVED: the first point auto-served on attach → the ball has a real velocity toward a side.
  const served = bus.recent(cur0).filter((e) => e.type === 'ball.served');
  check('SERVED: ball.served logged on the first serve', served.length >= 1, `count=${served.length}`);
  check("SERVED: served toward the player side ('right' opposite the left AI)", served.at(-1)?.payload?.toward === 'right', JSON.stringify(served.at(-1)?.payload));
  check('SERVED: the real ball velocity points toward that side (vx>0 = right)', scene.ballVel.x > 0, `vx=${scene.ballVel.x}`);

  // VOLLEY.SCORED: drive the ball PAST the LEFT goal → the player (right side) scores.
  const playerBefore = score(scene);
  const cur1 = bus.cursor;
  // Place the ball just INSIDE the duel goal band (x past the goal plane at wallInset=40) but
  // OUTSIDE the base wall (16) so the engine wall-reflect does not catch it first.
  scene.ball.x = 30;                     // ball.x - ballHalf ≈ 23 ≤ leftGoal(40), and > base wall(16)
  scene.ball.y = scene.mapHeight * 0.75; // away from the AI bat band so the reflect branch is moot
  scene.ballVel.x = -200;                // heading further left (a missed return)
  scene.ballVel.y = 0;
  world.step(1); // PaddleDuelAI.update() reads the ball, sees the left-goal exit, scores the player
  const scored = bus.recent(cur1).filter((e) => e.type === 'volley.scored');
  check('VOLLEY.SCORED: the player score incremented by one (__GAME__.score +1)', score(scene) === playerBefore + 1, `before=${playerBefore} after=${score(scene)}`);
  check('VOLLEY.SCORED: volley.scored logged on the real bus', scored.length >= 1, `count=${scored.length}`);
  check("VOLLEY.SCORED: payload {side:'player'}", scored.some((e) => e.payload?.side === 'player'), JSON.stringify(scored.map((e) => e.payload)));
  // The score triggered a RE-SERVE (a fresh point starts) → another ball.served in the same window.
  const reServe = bus.recent(cur1).filter((e) => e.type === 'ball.served');
  check('VOLLEY.SCORED: the conceding side re-served (a fresh ball.served followed)', reServe.length >= 1, `count=${reServe.length}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): the ball parked at CENTER (past no goal)
// scores nothing — no NEW volley.scored, player score unchanged. If score()/the emit
// were a no-op the VOLLEY.SCORED assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  world.mountSystem('PaddleDuelAI', { aiPaddleSide: 'left', targetScore: 5, wallInset: 40 });

  const playerBefore = score(scene);
  scene.ball.x = scene.mapWidth / 2; // dead center — past neither goal
  scene.ball.y = scene.mapHeight / 2;
  scene.ballVel.x = 0;
  scene.ballVel.y = 0;
  const cur = bus.cursor;
  world.step(1);
  const scored = bus.recent(cur).filter((e) => e.type === 'volley.scored');
  check('counterfactual: ball past no goal → no volley.scored', scored.length === 0, `count=${scored.length}`);
  check('counterfactual: player score unchanged', score(scene) === playerBefore, `before=${playerBefore} after=${score(scene)}`);

  world.destroy();
}

console.log(`\n[oracle] PaddleDuelAI ok — ${passed} assertions: ball.served (first serve at mount → real ball velocity toward a side) + volley.scored (real left-goal exit → __GAME__.score +1 + re-serve); counterfactual holds.`);
process.exit(0);
