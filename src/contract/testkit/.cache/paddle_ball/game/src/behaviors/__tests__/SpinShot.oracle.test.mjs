/**
 * SpinShot — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the behavior through the ENGINE'S OWN
 * resolver (world.mountBehavior) onto a real owner — the test never imports the component.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/behaviors/SpinShot.ts):
 *   - spin.applied  drivenBy "hit the ball while the paddle is moving"
 *                   expect   "the ball's lateral velocity reflects the spin (its horizontal velocity
 *                             gains in the paddle's swing direction); spin.applied logged"
 *
 * REAL drive through the REAL seams (the verb has TWO real halves — both driven):
 *   1. "the paddle is MOVING": SpinShot.update() measures its owner's swing velocity each frame
 *      (Δposition / dt). We move the real owner sprite between real ticks so the measured swing is a
 *      large positive (rightward) velocity — the genuine swing the game produces, not a private setter.
 *   2. "hit the ball": SpinShot subscribes in onAttach() to the scene's real `ball.bounced` seam
 *      (off:'paddle'); the BasePaddleScene emits exactly that on a real paddle contact. We drive the
 *      hit by emitting that real gameplay seam on the SAME bus (as the engine does) AFTER setting a
 *      known live scene.ballVel — NEVER calling onBallBounced()/the private emit.
 *   The OBSERVABLE transition is scene.ballVel (the velocity the engine integrator reads) gaining
 *   lateral (x) velocity in the swing direction. A COUNTERFACTUAL keeps the paddle STILL (swing in
 *   the deadzone) → the bounce imparts NO spin and spin.applied does NOT fire.
 *
 * The owner is a real spawned sprite (mounted-owner-ticked exactly once per world.step, so the
 * single-frame swing measurement is clean — the bound paddle is double-ticked by the engine).
 *
 *   node templates/modules/paddle_ball/src/behaviors/__tests__/SpinShot.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a MOVING paddle hits the ball → lateral spin added to the live ballVel.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  // A real owner sprite acting as the swinging paddle (single mounted-owner tick per step).
  const owner = world.spawnEnemy({ x: 200, y: 700 });
  const spin = world.mountBehavior('SpinShot', { spinFactor: 0.5, maxSpinSpeed: 400, preserveSpeed: false, spinDeadzone: 24 }, owner);
  check('resolveBehavior returned a real SpinShot', spin.constructor.name === 'SpinShot', spin.constructor.name);

  // Establish the previous-position baseline (update() runs once, lastPaddleX := owner.x).
  world.step(1);

  // SWING the paddle right by a large delta, then tick ONCE so update() measures a big +x swing.
  owner.x += 60; // a brisk rightward swipe in one frame
  world.step(1);

  // Set a known live ball velocity heading straight up (no lateral component yet).
  scene.ballVel.x = 0;
  scene.ballVel.y = -320;
  const vxBefore = scene.ballVel.x;

  // DRIVE the HIT: emit the real paddle-contact seam (exactly as BasePaddleScene.maybePaddleBounce).
  const cur = bus.cursor;
  bus.emit('ball.bounced', { off: 'paddle', vx: 0, vy: -320 });
  const applied = bus.recent(cur).filter((e) => e.type === 'spin.applied');
  // EXPECT: the ball gained POSITIVE lateral velocity (the rightward swing direction).
  check('SPIN: the live scene.ballVel.x gained in the swing (+x) direction', scene.ballVel.x > vxBefore && scene.ballVel.x > 0, `vx ${vxBefore}→${scene.ballVel.x}`);
  check('SPIN: spin.applied logged on the real bus', applied.length === 1, `count=${applied.length}`);
  check('SPIN: spin.applied payload dir = +1 (swing right)', applied.at(-1)?.payload?.dir === 1, JSON.stringify(applied.at(-1)?.payload));
  check('SPIN: spin.applied payload vx matches the new lateral velocity', applied.at(-1)?.payload?.vx === Math.round(scene.ballVel.x), JSON.stringify(applied.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a STILL paddle (swing inside the deadzone)
// imparts NO spin — the ball's lateral velocity is unchanged and spin.applied does
// not fire. If onBallBounced()'s spin/emit were unconditional the SPIN assertions
// above would also fire here (red), proving they depend on the real swing.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  const owner = world.spawnEnemy({ x: 200, y: 700 });
  world.mountBehavior('SpinShot', { spinFactor: 0.5, maxSpinSpeed: 400, preserveSpeed: false, spinDeadzone: 24 }, owner);

  // Establish baseline, then DO NOT move the owner (swing stays ~0, inside the deadzone).
  world.step(1);
  world.step(1);

  scene.ballVel.x = 0;
  scene.ballVel.y = -320;
  const vxBefore = scene.ballVel.x;
  const cur = bus.cursor;
  bus.emit('ball.bounced', { off: 'paddle', vx: 0, vy: -320 });
  const applied = bus.recent(cur).filter((e) => e.type === 'spin.applied');
  check('counterfactual: a still paddle imparts no lateral spin', scene.ballVel.x === vxBefore, `vx=${scene.ballVel.x}`);
  check('counterfactual: a still paddle → no spin.applied', applied.length === 0, `count=${applied.length}`);

  world.destroy();
}

console.log(`\n[oracle] SpinShot ok — ${passed} assertions: spin.applied (a real swinging owner + a real ball.bounced{off:paddle} adds lateral velocity to the live scene.ballVel in the swing direction); counterfactual (still paddle → no spin) holds.`);
process.exit(0);
