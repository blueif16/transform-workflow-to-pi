/**
 * HoldThrust — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the behavior through
 * the ENGINE'S OWN resolver (world.mountBehavior) onto a REAL arcade owner — the test never
 * imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/behaviors/HoldThrust.ts):
 *   - thrust.changed  drivenBy "holding or releasing the thrust button"
 *                     expect   "the player's thrust state toggles and __GAME__.player.vy responds
 *                               (negative/rising while held, positive/falling on release);
 *                               thrust.changed logged"
 *
 * REAL drive through the REAL seam: HoldThrust OWNS its input — it senses raw DOM
 * (keydown/keyup) into the `thrusting` boolean (the runner pattern; there is no scene-owned
 * analog input to reuse). We drive the verb the way the GAME does: dispatch a REAL `keydown`
 * (Space) on window → thrusting=true → update() pushes vy NEGATIVE (rising) and fires
 * thrust.changed{thrusting:true}; then a REAL `keyup` → thrusting=false → vy goes POSITIVE
 * (falling) and fires thrust.changed{thrusting:false}. A COUNTERFACTUAL steps with NO key
 * pressed → vy only falls (gravity) and thrust.changed never fires.
 *
 *   node templates/modules/endless_runner/src/behaviors/__tests__/HoldThrust.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const keydown = (key) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key }));
const keyup = (key) => window.dispatchEvent(new window.KeyboardEvent('keyup', { key }));

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a real HELD key rises (vy negative) → thrust.changed{true}; RELEASE falls
// (vy positive) → thrust.changed{false}.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { bus } = world;

  const owner = world.spawnEnemy({ x: 120, y: 300 });
  const beh = world.mountBehavior('HoldThrust', { thrustAccel: 2200, gravity: 1200, maxRiseSpeed: 420 }, owner);
  check('resolveBehavior returned a real HoldThrust', beh.constructor.name === 'HoldThrust', beh.constructor.name);

  // HOLD: a real keydown engages the sustained thrust; net force is up (thrustAccel > gravity).
  let cur = bus.cursor;
  keydown(' ');
  world.step(3); // thrust integrates vy negative (rising)
  const vyHeld = owner.body.velocity.y;
  const onEvents = bus.recent(cur).filter((e) => e.type === 'thrust.changed');
  check('HOLD: vy went negative (the avatar rises under thrust)', vyHeld < 0, `vy=${vyHeld}`);
  check('HOLD: thrust.changed{thrusting:true} logged', onEvents.some((e) => e.payload?.thrusting === true), JSON.stringify(onEvents.map((e) => e.payload)));
  check('HOLD: thrust.changed payload carries the live vy', typeof onEvents.at(-1)?.payload?.vy === 'number', JSON.stringify(onEvents.at(-1)?.payload));

  // RELEASE: a real keyup drops thrust; gravity wins → vy climbs back positive (falling).
  cur = bus.cursor;
  keyup(' ');
  world.step(6); // gravity integrates vy positive (falling)
  const vyReleased = owner.body.velocity.y;
  const offEvents = bus.recent(cur).filter((e) => e.type === 'thrust.changed');
  check('RELEASE: vy responds (climbs back up toward falling vs the held rise)', vyReleased > vyHeld, `${vyHeld}→${vyReleased}`);
  check('RELEASE: thrust.changed{thrusting:false} logged', offEvents.some((e) => e.payload?.thrusting === false), JSON.stringify(offEvents.map((e) => e.payload)));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO key pressed, thrust never engages
// — vy only grows POSITIVE (gravity, never negative) and thrust.changed never fires.
// If keydown→thrusting / the toggle-emit were a no-op the HOLD assertions would be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { bus } = world;
  const owner = world.spawnEnemy({ x: 140, y: 300 });
  world.mountBehavior('HoldThrust', { thrustAccel: 2200, gravity: 1200 }, owner);

  const cur = bus.cursor;
  world.step(5); // no key down → only gravity acts
  const vy = owner.body.velocity.y;
  const events = bus.recent(cur).filter((e) => e.type === 'thrust.changed');
  check('counterfactual: no thrust → vy never goes negative (only gravity)', vy > 0, `vy=${vy}`);
  check('counterfactual: no thrust → no thrust.changed', events.length === 0, `count=${events.length}`);

  world.destroy();
}

console.log(`\n[oracle] HoldThrust ok — ${passed} assertions: thrust.changed on a real keydown (held → __GAME__.player.vy negative/rising) and keyup (released → vy positive/falling); counterfactual (no key → vy only falls, no event) holds.`);
process.exit(0);
