/**
 * BallSpeedRamp — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the system through the ENGINE'S OWN
 * resolver (world.mountSystem) — the test never imports the component, so a failure is the
 * COMPONENT's fault, not a shell's.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/systems/BallSpeedRamp.ts):
 *   - ball.speedChanged  drivenBy "the rally length (bricks cleared without losing the ball)
 *                                  crosses a bricksPerStep boundary"
 *                        expect   "__GAME__ ball speed increases (speedOf(scene.ballVel) and
 *                                  scene.ballSpeed go up); a lost ball reverts to the base
 *                                  speed; ball.speedChanged logged"
 *
 * REAL drive through the REAL seam: BallSpeedRamp.attach() subscribes to `brick.cleared`
 * (extends the rally) + `life.lost` (resets) on the scene's real EventBus. We drive the verb
 * by emitting those real gameplay seams on the SAME bus (exactly as BrickGrid / BasePaddleScene
 * do) — NEVER calling crossStep()/the private emit directly. With bricksPerStep=3 the 3rd
 * brick.cleared crosses the first step → the engine ballSpeed AND the live ballVel magnitude
 * rise; a life.lost reverts to the captured base. Plus a COUNTERFACTUAL: fewer than
 * bricksPerStep clears must NOT raise the speed or log ball.speedChanged.
 *
 *   node templates/modules/paddle_ball/src/systems/__tests__/BallSpeedRamp.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const speedOf = (v) => Math.hypot(v.x, v.y);

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: cross a rally step (RISE), then a lost ball (REVERT) — one real boot.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  // bricksPerStep=3 so the 3rd real brick.cleared crosses the first step deterministically.
  const ramp = world.mountSystem('BallSpeedRamp', { bricksPerStep: 3, stepFactor: 1.5, maxSteps: 5 });
  check('resolveSystem returned a real BallSpeedRamp', ramp.constructor.name === 'BallSpeedRamp', ramp.constructor.name);

  // The base speed is captured on attach from the live served ball (speed 320 in level1.json).
  const baseSpeed = scene.ballSpeed;
  check('precondition: ball is in play with a real velocity', speedOf(scene.ballVel) > 1, `|vel|=${speedOf(scene.ballVel)}`);
  check('precondition: ballSpeed seeded (~base)', baseSpeed > 0, `base=${baseSpeed}`);

  // DRIVE (rise): two clears do NOT cross the step (rally 1,2 < 3); the third crosses it.
  let cur = bus.cursor;
  bus.emit('brick.cleared', { id: 'b1' });
  bus.emit('brick.cleared', { id: 'b2' });
  check('two clears (rally<bricksPerStep) did NOT raise the speed yet', scene.ballSpeed === baseSpeed, `speed=${scene.ballSpeed} base=${baseSpeed}`);
  let preThird = bus.recent(cur).filter((e) => e.type === 'ball.speedChanged');
  check('two clears → no ball.speedChanged yet', preThird.length === 0, `count=${preThird.length}`);

  bus.emit('brick.cleared', { id: 'b3' }); // crosses the first step (rally 3 / 3 = 1 step)
  const rises = bus.recent(cur).filter((e) => e.type === 'ball.speedChanged');
  // EXPECT: scene.ballSpeed rose by exactly stepFactor (1.5×) and the live velocity magnitude
  // was rescaled to the new speed (justified independently: base*1.5, not the function's echo).
  const want = baseSpeed * 1.5;
  check('RISE: scene.ballSpeed rose to base*stepFactor', Math.abs(scene.ballSpeed - want) < 1e-6, `speed=${scene.ballSpeed} want=${want}`);
  check('RISE: the live ballVel magnitude rescaled UP to the new speed', Math.abs(speedOf(scene.ballVel) - want) < 1e-3, `|vel|=${speedOf(scene.ballVel)} want=${want}`);
  check('RISE: ball.speedChanged logged on the real bus', rises.length === 1, `count=${rises.length}`);
  check('RISE: ball.speedChanged payload {step:1}', rises.at(-1)?.payload?.step === 1, JSON.stringify(rises.at(-1)?.payload));
  check('RISE: ball.speedChanged payload speed === base*stepFactor', Math.abs((rises.at(-1)?.payload?.speed ?? 0) - want) < 1e-6, JSON.stringify(rises.at(-1)?.payload));

  // DRIVE (revert): a lost ball resets the rally + reverts the speed to the captured base.
  cur = bus.cursor;
  bus.emit('life.lost', { lives: 2 });
  check('REVERT: life.lost reverted scene.ballSpeed to the base', Math.abs(scene.ballSpeed - baseSpeed) < 1e-6, `speed=${scene.ballSpeed} base=${baseSpeed}`);
  check('REVERT: the live ballVel magnitude returned to base', Math.abs(speedOf(scene.ballVel) - baseSpeed) < 1e-3, `|vel|=${speedOf(scene.ballVel)} base=${baseSpeed}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): fewer than bricksPerStep clears NEVER
// cross a step — the speed must stay at base and ball.speedChanged must NOT fire.
// If crossStep()'s emit/speed-write were a no-op the RISE assertions would already
// be red; this proves they are not vacuously always-true.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  world.mountSystem('BallSpeedRamp', { bricksPerStep: 3, stepFactor: 1.5 });
  const baseSpeed = scene.ballSpeed;

  const cur = bus.cursor;
  bus.emit('brick.cleared', { id: 'c1' });
  bus.emit('brick.cleared', { id: 'c2' }); // only 2 of 3 → no step crossed
  const fired = bus.recent(cur).filter((e) => e.type === 'ball.speedChanged');
  check('counterfactual: <bricksPerStep clears → ballSpeed stays at base', scene.ballSpeed === baseSpeed, `speed=${scene.ballSpeed} base=${baseSpeed}`);
  check('counterfactual: <bricksPerStep clears → no ball.speedChanged', fired.length === 0, `count=${fired.length}`);

  world.destroy();
}

console.log(`\n[oracle] BallSpeedRamp ok — ${passed} assertions: ball.speedChanged RISE (×stepFactor on the rally-step crossing, real scene.ballSpeed + live ballVel) + REVERT (→base on life.lost); counterfactual holds.`);
process.exit(0);
