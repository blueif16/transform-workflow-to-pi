/**
 * MultiBall — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the system through the ENGINE'S OWN
 * resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/systems/MultiBall.ts):
 *   - ball.split  drivenBy "a multiball power-up triggers (a bound bus event fires a split, or
 *                           triggerSplit() is called)"
 *                 expect   "the active ball count increases — __GAME__.entities gains `spawned`
 *                           more entries of type 'ball'; ball.split logged"
 *
 * REAL drive through the REAL seam: the bus trigger path is RANDOM (Math.random()<splitChance),
 * so the deterministic real verb is the public power-up seam `triggerSplit()` (explicitly named
 * in `drivenBy` — the exact seam a $custom power-up effect / a verify driver calls — NOT the
 * private bus.emit). triggerSplit() forks the live engine ball (scene.ball) into N extra ball
 * sprites added to scene.entities tagged __type='ball', so the OBSERVABLE __GAME__.entities ball
 * count rises by `spawned`. We assert that real entities transition + the ball.split event, plus
 * a COUNTERFACTUAL: no trigger → no extra balls, no ball.split.
 *
 *   node templates/modules/paddle_ball/src/systems/__tests__/MultiBall.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** Count entities of __type='ball' in the scene entities group (the __GAME__.entities source). */
const ballEntities = (scene) =>
  (scene.entities?.getChildren?.() ?? []).filter((c) => c?.active !== false && c.__type === 'ball').length;

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: trigger a multiball split via the public power-up seam.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  const multi = world.mountSystem('MultiBall', { splitCount: 3, maxBalls: 8 });
  check('resolveSystem returned a real MultiBall', multi.constructor.name === 'MultiBall', multi.constructor.name);
  check('precondition: a live engine ball to split', !!scene.ball, `ball=${!!scene.ball}`);

  const ballsBefore = ballEntities(scene);

  // DRIVE: the multiball power-up triggers (the public seam — deterministic, no RNG).
  const cur = bus.cursor;
  const spawned = multi.triggerSplit();
  const splits = bus.recent(cur).filter((e) => e.type === 'ball.split');
  // EXPECT: exactly splitCount(3) extra balls spawned (independently justified by the param).
  check('SPLIT: triggerSplit spawned splitCount extra balls', spawned === 3, `spawned=${spawned}`);
  check("SPLIT: __GAME__.entities gained `spawned` more 'ball' entries", ballEntities(scene) === ballsBefore + 3, `before=${ballsBefore} after=${ballEntities(scene)}`);
  check('SPLIT: ball.split logged on the real bus', splits.length === 1, `count=${splits.length}`);
  check('SPLIT: ball.split payload {spawned:3}', splits.at(-1)?.payload?.spawned === 3, JSON.stringify(splits.at(-1)?.payload));
  check('SPLIT: ball.split payload active count reflects the extras', splits.at(-1)?.payload?.active === multi.activeBallCount(), JSON.stringify(splits.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): NOT triggering a split leaves the ball
// count unchanged and fires no ball.split. If triggerSplit()'s spawn/emit were a
// no-op the SPLIT assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  world.mountSystem('MultiBall', { splitCount: 3 });
  const ballsBefore = ballEntities(scene);

  const cur = bus.cursor;
  world.step(10); // run the engine, but never trigger a split
  const fired = bus.recent(cur).filter((e) => e.type === 'ball.split');
  check('counterfactual: no trigger → ball entity count unchanged', ballEntities(scene) === ballsBefore, `before=${ballsBefore} after=${ballEntities(scene)}`);
  check('counterfactual: no trigger → no ball.split', fired.length === 0, `count=${fired.length}`);

  world.destroy();
}

console.log(`\n[oracle] MultiBall ok — ${passed} assertions: ball.split (splitCount extra 'ball' entries enter __GAME__.entities via the real triggerSplit() power-up seam); counterfactual holds.`);
process.exit(0);
