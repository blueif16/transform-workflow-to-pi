/**
 * GravityFlapMovement — ORACLE drive test (NO-EVENT movement behavior, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the behavior through
 * the ENGINE'S OWN resolver (world.mountBehavior) onto a REAL arcade owner — the test never
 * imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/behaviors/GravityFlapMovement.ts):
 *   - NO surface() — this movement behavior declares NO events. The contract is the OBSERVABLE
 *     vertical-velocity transition: a flap() SETS vy to a FIXED upward impulse (-flapImpulse),
 *     and between flaps constant gravity integrates vy downward (clamped to maxFallSpeed).
 *
 * REAL drive through the REAL seam: GravityFlapMovement.flap() is the one-button verb the
 * shared GravityFlapScheme calls on a real keydown; the harness's per-frame behavior tick
 * (mountedBehaviorOwners) runs update() each step exactly as the runner scene drives the
 * avatar's bound movement. We mount onto a fresh real owner (gravity-off body, like the
 * runner avatar — so THIS behavior solely owns vy, not the level's default movement), call
 * the real flap() verb, and assert the body's velocity transition. A COUNTERFACTUAL steps
 * with NO flap → vy only grows MORE positive (gravity), never jumps negative.
 *
 *   node templates/modules/endless_runner/src/behaviors/__tests__/GravityFlapMovement.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a real flap() SETS vy to the fixed upward impulse; gravity then pulls back.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene } = world;

  const owner = world.spawnEnemy({ x: 120, y: 300 });
  const beh = world.mountBehavior('GravityFlapMovement', { gravity: 1400, flapImpulse: 420, maxFallSpeed: 520 }, owner);
  check('resolveBehavior returned a real GravityFlapMovement', beh.constructor.name === 'GravityFlapMovement', beh.constructor.name);

  const vyBefore = owner.body.velocity.y;
  check('precondition: vy seeded at 0', vyBefore === 0, `vy=${vyBefore}`);

  // DRIVE (flap): the next update() SETS vy = -flapImpulse exactly (deterministic apex).
  beh.flap();
  world.step(1);
  const vyAfterFlap = owner.body.velocity.y;
  check('FLAP: vy is SET to the fixed -flapImpulse (rising)', vyAfterFlap === -420, `vy=${vyAfterFlap}`);
  check('FLAP: owner.vy mirror tracks the body (the __GAME__.player.vy surface)', owner.vy === vyAfterFlap, `mirror=${owner.vy}`);

  // After the flap, constant gravity integrates vy back DOWN over the next frames.
  world.step(6);
  const vyFalling = owner.body.velocity.y;
  check('GRAVITY: vy climbs back up toward falling after the flap', vyFalling > vyAfterFlap, `${vyAfterFlap}→${vyFalling}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO flap, vy only grows MORE positive
// (gravity) and NEVER jumps negative. If flap()/the SET were a no-op the FLAP
// assertion (vy === -420) would already be red — this proves it is not vacuous.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const owner = world.spawnEnemy({ x: 140, y: 300 });
  world.mountBehavior('GravityFlapMovement', { gravity: 1400, flapImpulse: 420 }, owner);

  const vyBefore = owner.body.velocity.y;
  world.step(4); // step with NO flap → only gravity acts
  const vyAfter = owner.body.velocity.y;
  check('counterfactual: no flap → vy never goes negative (no impulse)', vyAfter >= vyBefore && vyAfter > 0, `${vyBefore}→${vyAfter}`);

  world.destroy();
}

console.log(`\n[oracle] GravityFlapMovement ok — ${passed} assertions: flap() SETS vy to the fixed -420 impulse (rising) then gravity integrates it back down; counterfactual (no flap → vy stays positive, never jumps negative) holds. NO-EVENT behavior: observable vy transition asserted.`);
process.exit(0);
