/**
 * NearMissStreak — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/systems/NearMissStreak.ts):
 *   - streak.changed  drivenBy "the avatar threading an obstacle gap (a tight near-miss pass) or
 *                               breaking the streak on a wide pass / a hit"
 *                     expect   "the __GAME__ streak counter changes — +1 on a near-miss pass (and
 *                               adds a streak-scaled score bonus) and drops to zero on a wide pass
 *                               or a hit; streak.changed logged"
 *   - observable streak ← the live near-miss streak
 *
 * REAL drive through the REAL seam: NearMissStreak reads the SAME live obstacle pairs the scroller
 * publishes on scene.obstaclePairs and judges each pass exactly once by the avatar's vertical
 * distance to the pair's gap CENTER as it clears the trailing edge. We clear the level's DEFAULT
 * systems (so the default scroller can't overwrite our fixture), then PLACE a real pair fixture
 * with its gapCenterY at the avatar's y (a TIGHT pass) whose trailing edge is past the avatar —
 * exactly the thread geometry the scroller produces — and STEP: the streak observable rises, a
 * streak-scaled bonus lands on __GAME__.score, streak.changed{near-miss} logged. Then a WIDE pair
 * (gap center far from the avatar) BREAKS the streak to zero (streak.changed{wide}). A
 * COUNTERFACTUAL places a pair AHEAD of the avatar (not threaded) → the streak is untouched, no event.
 *
 *   node templates/modules/endless_runner/src/systems/__tests__/NearMissStreak.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** A passed-pair fixture: trailing edge (topX + displayWidth/2) past the avatar, with a gap center. */
const pair = (id, topX, gapCenterY, displayWidth = 40) => ({ id, gapCenterY, top: { x: topX, displayWidth } });

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a TIGHT pass grows the streak (+ a score bonus); a WIDE pass breaks it to 0.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];

  const sys = world.mountSystem('NearMissStreak', { nearMissBand: 60, bonusPerStreak: 2, maxBonus: 10 });
  check('resolveSystem returned a real NearMissStreak', sys.constructor.name === 'NearMissStreak', sys.constructor.name);
  check('precondition: the streak observable starts at 0', sys.surface().observables.streak() === 0, `streak=${sys.surface().observables.streak()}`);

  scene.player.body.reset(120, 300);
  const avatarX = scene.player.x;
  const scoreBefore = Number(scene.registry.get('score') ?? 0);

  // NEAR-MISS: gap center == avatar.y (offset 0 < nearMissBand) and trailing edge past the avatar.
  scene.obstaclePairs = [pair('obstacle_0', avatarX - 100, scene.player.y)];
  let cur = bus.cursor;
  world.step(1);
  let changes = bus.recent(cur).filter((e) => e.type === 'streak.changed');
  check('NEAR-MISS: streak.changed logged on the real bus', changes.length === 1, `count=${changes.length}`);
  check('NEAR-MISS: the streak observable rose to 1', sys.surface().observables.streak() === 1, `streak=${sys.surface().observables.streak()}`);
  check('NEAR-MISS: payload {reason:near-miss, streak:1}', changes.at(-1)?.payload?.reason === 'near-miss' && changes.at(-1)?.payload?.streak === 1, JSON.stringify(changes.at(-1)?.payload));
  check('NEAR-MISS: a streak-scaled score bonus landed on __GAME__.score', Number(scene.registry.get('score')) === scoreBefore + 2, `${scoreBefore}→${scene.registry.get('score')}`);

  // WIDE PASS: a new pair whose gap center is far from the avatar (offset > band) breaks the streak.
  scene.obstaclePairs = [pair('obstacle_1', avatarX - 100, 50)];
  cur = bus.cursor;
  world.step(1);
  changes = bus.recent(cur).filter((e) => e.type === 'streak.changed');
  check('WIDE: streak.changed logged for the break', changes.length === 1, `count=${changes.length}`);
  check('WIDE: the streak observable dropped to 0', sys.surface().observables.streak() === 0, `streak=${sys.surface().observables.streak()}`);
  check('WIDE: payload {reason:wide, streak:0}', changes.at(-1)?.payload?.reason === 'wide' && changes.at(-1)?.payload?.streak === 0, JSON.stringify(changes.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a pair AHEAD of the avatar (trailing edge
// RIGHT of avatar.x — not threaded yet) is never judged — the streak is untouched
// and streak.changed never fires. If nearMiss()/the emit fired on any pair the DRIVE
// assertions would be vacuously true; this proves judging is gated on a real thread.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];
  const sys = world.mountSystem('NearMissStreak', { nearMissBand: 60, bonusPerStreak: 2 });

  scene.player.body.reset(120, 300);
  const scoreBefore = Number(scene.registry.get('score') ?? 0);
  scene.obstaclePairs = [pair('obstacle_ahead', scene.player.x + 100, scene.player.y)]; // ahead → not threaded
  const cur = bus.cursor;
  world.step(3);
  const changes = bus.recent(cur).filter((e) => e.type === 'streak.changed');
  check('counterfactual: an un-threaded pair → no streak.changed', changes.length === 0, `count=${changes.length}`);
  check('counterfactual: the streak observable stays 0', sys.surface().observables.streak() === 0, `streak=${sys.surface().observables.streak()}`);
  check('counterfactual: score unchanged (no bonus awarded)', Number(scene.registry.get('score')) === scoreBefore, `score=${scene.registry.get('score')}`);

  world.destroy();
}

console.log(`\n[oracle] NearMissStreak ok — ${passed} assertions: streak.changed (a tight near-miss pass raises the streak observable +1 and adds a streak-scaled __GAME__.score bonus; a wide pass breaks it to 0); counterfactual (an un-threaded pair → streak untouched, no event) holds.`);
process.exit(0);
