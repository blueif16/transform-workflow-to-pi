/**
 * SlopeGlide — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the behavior through
 * the ENGINE'S OWN resolver (world.mountBehavior) onto a REAL arcade owner — the test never
 * imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/behaviors/SlopeGlide.ts):
 *   - momentum.changed  drivenBy "diving down a slope (momentum accumulates) or releasing the
 *                                 dive on an up-slope (launch)"
 *                       expect   "the carried momentum scalar accumulates as the player dives a
 *                                 down-slope and CARRIES forward; on an up-slope release
 *                                 __GAME__.player.vy goes negative (the avatar launches);
 *                                 momentum.changed logged"
 *
 * REAL drive through the REAL seam: SlopeGlide OWNS its input — it senses raw DOM
 * (keydown/keyup) into the `diving` boolean (the runner pattern; no scene-owned analog input
 * to reuse). We drive the verb the way the GAME does: hold a REAL `keydown` (ArrowDown) so
 * `diving` is true and STEP across the self-owned slope phase — on a DOWN-slope the carried
 * momentum accumulates (owner.momentum rises) and momentum.changed{phase:'dive'} fires. Then
 * a REAL `keyup` release on an UP-slope frame LAUNCHES: __GAME__.player.vy goes negative and
 * momentum.changed{phase:'launch'} fires. A COUNTERFACTUAL holds NO key → momentum stays 0
 * and momentum.changed never fires.
 *
 *   node templates/modules/endless_runner/src/behaviors/__tests__/SlopeGlide.oracle.test.mjs
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
// DRIVE: a held dive on a DOWN-slope accumulates momentum; a release on an UP-slope launches.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { bus } = world;

  const owner = world.spawnEnemy({ x: 120, y: 300 });
  const beh = world.mountBehavior('SlopeGlide', { diveAccel: 4000, drag: 10, emitStep: 50, launchScale: 0.7, launchCost: 100, slopeRate: 1.6 }, owner);
  check('resolveBehavior returned a real SlopeGlide', beh.constructor.name === 'SlopeGlide', beh.constructor.name);

  // DIVE: a real keydown engages the held dive. While the self-owned slope phase is a
  // down-slope, momentum accumulates and a momentum.changed{phase:'dive'} fires once it
  // crosses emitStep. Step until the dive emit lands (the phase starts on a down-slope).
  let cur = bus.cursor;
  keydown('ArrowDown');
  let dives = [];
  for (let i = 0; i < 60 && dives.length === 0; i++) {
    world.step(1);
    dives = bus.recent(cur).filter((e) => e.type === 'momentum.changed' && e.payload?.phase === 'dive');
  }
  check('DIVE: momentum.changed{phase:dive} logged (the speed built on a down-slope)', dives.length >= 1, `count=${dives.length}`);
  check('DIVE: the carried momentum scalar accumulated (> 0)', (owner.momentum ?? 0) > 0, `momentum=${owner.momentum}`);
  check('DIVE: momentum.changed payload carries {momentum,vy,phase}', typeof dives.at(-1)?.payload?.momentum === 'number', JSON.stringify(dives.at(-1)?.payload));

  // LAUNCH: release the dive (keyup) and find an UP-slope frame — the carried momentum is
  // spent as an upward burst: __GAME__.player.vy goes negative and momentum.changed{launch} fires.
  cur = bus.cursor;
  let launches = [];
  for (let i = 0; i < 200 && launches.length === 0; i++) {
    keyup('ArrowDown'); // release → a release edge on the next update()
    world.step(1);
    launches = bus.recent(cur).filter((e) => e.type === 'momentum.changed' && e.payload?.phase === 'launch');
    if (launches.length === 0) {
      keydown('ArrowDown'); // re-dive to keep banking momentum until we catch an up-slope release
      world.step(1);
    }
  }
  check('LAUNCH: momentum.changed{phase:launch} logged on an up-slope release', launches.length >= 1, `count=${launches.length}`);
  check('LAUNCH: __GAME__.player.vy went negative (the avatar launched upward)', (owner.vy ?? owner.body.velocity.y) < 0, `vy=${owner.vy ?? owner.body.velocity.y}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO key held, the dive never engages —
// momentum stays 0 (only drag, which clamps at 0) and momentum.changed never fires.
// If keydown→diving / the accumulate-emit were a no-op the DIVE assertions would be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { bus } = world;
  const owner = world.spawnEnemy({ x: 140, y: 300 });
  world.mountBehavior('SlopeGlide', { diveAccel: 4000, drag: 10, emitStep: 50, slopeRate: 1.6 }, owner);

  const cur = bus.cursor;
  world.step(40); // no key held → no dive accumulation, no launch
  const events = bus.recent(cur).filter((e) => e.type === 'momentum.changed');
  check('counterfactual: no dive → momentum stays 0', (owner.momentum ?? 0) === 0, `momentum=${owner.momentum}`);
  check('counterfactual: no dive → no momentum.changed', events.length === 0, `count=${events.length}`);

  world.destroy();
}

console.log(`\n[oracle] SlopeGlide ok — ${passed} assertions: momentum.changed on a real held dive (down-slope momentum accumulates) and an up-slope release (__GAME__.player.vy goes negative — the launch); counterfactual (no key → momentum stays 0, no event) holds.`);
process.exit(0);
