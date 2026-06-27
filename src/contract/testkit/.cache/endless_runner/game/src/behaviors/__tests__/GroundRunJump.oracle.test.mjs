/**
 * GroundRunJump — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the behavior through
 * the ENGINE'S OWN resolver (world.mountBehavior) onto a REAL arcade owner — the test never
 * imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/behaviors/GroundRunJump.ts):
 *   - jump.performed  drivenBy "a tap while grounded"
 *                     expect   "__GAME__.player.vy goes negative (the avatar starts rising);
 *                               jump.performed logged"
 *
 * REAL drive through the REAL seam: GroundRunJump.flap() (aliased jump()) is the one-button
 * verb the shared GravityFlapScheme calls on a real keydown; the harness's per-frame behavior
 * tick runs update() each step exactly as the runner scene drives the avatar. We mount onto a
 * fresh real owner (so THIS behavior solely owns vy), call the real flap() verb while grounded,
 * and assert the body's vy goes negative (rising) + jump.performed logged. A COUNTERFACTUAL
 * steps with NO tap → vy never goes negative and jump.performed never fires; an AIR-PRESS
 * counterfactual (a second flap while still airborne) proves the grounded-gate (no double-jump).
 *
 *   node templates/modules/endless_runner/src/behaviors/__tests__/GroundRunJump.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a real grounded flap() sets vy negative → jump.performed fires once.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { bus } = world;

  const owner = world.spawnEnemy({ x: 120, y: 300 });
  const beh = world.mountBehavior('GroundRunJump', { jumpImpulse: 620, groundY: 700 }, owner);
  check('resolveBehavior returned a real GroundRunJump', beh.constructor.name === 'GroundRunJump', beh.constructor.name);

  const vyBefore = owner.body.velocity.y;
  let cur = bus.cursor;
  beh.flap(); // a grounded tap
  world.step(1);
  const vyAfter = owner.body.velocity.y;
  const jumps = bus.recent(cur).filter((e) => e.type === 'jump.performed');
  check('JUMP: vy went negative (the avatar leaves the ground rising)', vyAfter < 0, `${vyBefore}→${vyAfter}`);
  check('JUMP: jump.performed logged on the real bus', jumps.length === 1, `count=${jumps.length}`);
  check('JUMP: jump.performed payload {y}', typeof jumps.at(-1)?.payload?.y === 'number', JSON.stringify(jumps.at(-1)?.payload));

  // AIR-PRESS guard (grounded-gate / no double-jump): a flap while still airborne is ignored —
  // it neither re-fires jump.performed nor re-launches vy.
  cur = bus.cursor;
  beh.flap();
  world.step(1);
  const airJumps = bus.recent(cur).filter((e) => e.type === 'jump.performed');
  check('AIR-PRESS: a press while airborne fires NO second jump.performed (grounded gate)', airJumps.length === 0, `count=${airJumps.length}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO tap the avatar stays pinned to
// the ground band (vy 0, never negative) and jump.performed never fires. If
// flap()/emitJump() were a no-op the JUMP assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { bus } = world;
  const owner = world.spawnEnemy({ x: 120, y: 690 });
  world.mountBehavior('GroundRunJump', { jumpImpulse: 620, groundY: 700 }, owner);

  const cur = bus.cursor;
  world.step(4); // step with NO tap → grounded, vy pinned to 0
  const vy = owner.body.velocity.y;
  const jumps = bus.recent(cur).filter((e) => e.type === 'jump.performed');
  check('counterfactual: no tap → vy never goes negative', vy >= 0, `vy=${vy}`);
  check('counterfactual: no tap → no jump.performed', jumps.length === 0, `count=${jumps.length}`);

  world.destroy();
}

console.log(`\n[oracle] GroundRunJump ok — ${passed} assertions: jump.performed (a grounded flap() sets __GAME__.player.vy negative) + grounded-gate (no air double-jump); counterfactual (no tap → no rise, no event) holds.`);
process.exit(0);
