/**
 * BeatFlap — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the behavior through
 * the ENGINE'S OWN resolver (world.mountBehavior) onto a REAL arcade owner — the test never
 * imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/behaviors/BeatFlap.ts):
 *   - beat.struck     drivenBy "a non-portal beat of the seeded track lands on its cadence"
 *                     expect   "beat.struck logged on the deterministic beat frame"
 *   - portal.flipped  drivenBy "the avatar reaches a gravity-flip portal on the seeded beat track"
 *                     expect   "__GAME__.player.gravitySign inverts (+1↔-1) and the avatar's vy
 *                               under gravity reverses direction; portal.flipped logged"
 *
 * REAL drive through the REAL seam: the beat track is the deterministic spine BeatFlap runs
 * itself in update() — a `beatPeriodFrames` cadence over a `beatSeed`, with a gravity-flip
 * portal every `portalEveryBeats` beats. We mount onto a fresh real owner and STEP the real
 * engine across the seeded cadence: a non-portal beat fires beat.struck; the portal beat
 * INVERTS owner.gravitySign (the __GAME__.player.gravitySign surface) and fires portal.flipped.
 * We then assert the OBSERVABLE consequence: under the inverted sign the gravity integration
 * drives vy the OPPOSITE direction. A COUNTERFACTUAL steps FEWER than one beat period → no
 * beat lands, so neither event fires and the sign stays +1.
 *
 *   node templates/modules/endless_runner/src/behaviors/__tests__/BeatFlap.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: step the seeded beat clock — a non-portal beat fires beat.struck, and the
// portal beat inverts gravitySign + fires portal.flipped + reverses the vy direction.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { bus } = world;

  // period 5, portal every 2 beats → beat 1 (frame 5) is non-portal (beat.struck),
  // beat 2 (frame 10) is the gravity-flip portal (portal.flipped).
  const owner = world.spawnEnemy({ x: 120, y: 300 });
  const beh = world.mountBehavior('BeatFlap', { beatPeriodFrames: 5, portalEveryBeats: 2, gravity: 1400 }, owner);
  check('resolveBehavior returned a real BeatFlap', beh.constructor.name === 'BeatFlap', beh.constructor.name);
  check('precondition: gravitySign seeded +1 (gravity pulls down)', owner.gravitySign === 1, `sign=${owner.gravitySign}`);

  // BEAT: step one full period → beat index 1 lands (a non-portal beat) → beat.struck.
  let cur = bus.cursor;
  world.step(5);
  const beats = bus.recent(cur).filter((e) => e.type === 'beat.struck');
  check('BEAT: beat.struck logged on the deterministic beat frame', beats.length >= 1, `count=${beats.length}`);
  check('BEAT: beat.struck payload {beat,seed}', typeof beats.at(-1)?.payload?.beat === 'number' && typeof beats.at(-1)?.payload?.seed === 'number', JSON.stringify(beats.at(-1)?.payload));
  check('BEAT: a non-portal beat did NOT flip the sign', owner.gravitySign === 1, `sign=${owner.gravitySign}`);

  // PORTAL: step another period → beat index 2 is a gravity-flip portal → sign inverts.
  cur = bus.cursor;
  world.step(5);
  const flips = bus.recent(cur).filter((e) => e.type === 'portal.flipped');
  check('PORTAL: portal.flipped logged on the real bus', flips.length === 1, `count=${flips.length}`);
  check('PORTAL: __GAME__.player.gravitySign inverted +1 → -1', owner.gravitySign === -1, `sign=${owner.gravitySign}`);
  check('PORTAL: portal.flipped payload {sign:-1}', flips.at(-1)?.payload?.sign === -1, JSON.stringify(flips.at(-1)?.payload));

  // OBSERVABLE consequence: under the inverted sign, gravity now drives vy NEGATIVE (up),
  // the OPPOSITE direction. Step a few frames with no flap and confirm vy is heading up.
  const vyBefore = owner.body.velocity.y;
  world.step(4);
  check('PORTAL: with gravity inverted, vy now trends NEGATIVE (reversed direction)', owner.body.velocity.y < vyBefore, `${vyBefore}→${owner.body.velocity.y}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): step FEWER frames than one beat period —
// no beat lands, so neither beat.struck nor portal.flipped fires and the gravity
// sign stays +1. If the beat clock / flip-emit were vacuous the DRIVE block would
// over-fire; this proves the events fire only when a beat actually lands.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { bus } = world;
  const owner = world.spawnEnemy({ x: 140, y: 300 });
  world.mountBehavior('BeatFlap', { beatPeriodFrames: 30, portalEveryBeats: 2 }, owner);

  const cur = bus.cursor;
  world.step(4); // far short of one 30-frame beat period → no beat yet
  const beats = bus.recent(cur).filter((e) => e.type === 'beat.struck');
  const flips = bus.recent(cur).filter((e) => e.type === 'portal.flipped');
  check('counterfactual: before the first beat → no beat.struck', beats.length === 0, `count=${beats.length}`);
  check('counterfactual: before any portal → no portal.flipped', flips.length === 0, `count=${flips.length}`);
  check('counterfactual: gravitySign still +1 (never flipped)', owner.gravitySign === 1, `sign=${owner.gravitySign}`);

  world.destroy();
}

console.log(`\n[oracle] BeatFlap ok — ${passed} assertions: beat.struck on a seeded non-portal beat + portal.flipped on the portal beat (__GAME__.player.gravitySign inverts +1→-1 and the vy-under-gravity direction reverses); counterfactual (before a beat → no events, sign stays +1) holds.`);
process.exit(0);
