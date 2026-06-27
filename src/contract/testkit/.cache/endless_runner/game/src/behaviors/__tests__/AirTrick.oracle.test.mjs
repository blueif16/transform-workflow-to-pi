/**
 * AirTrick — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the behavior through
 * the ENGINE'S OWN resolver (world.mountBehavior) onto a REAL arcade owner — the test never
 * imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/behaviors/AirTrick.ts):
 *   - trick.landed  drivenBy "landing cleanly after a big slope launch (enough air time + a
 *                             controlled, non-slammed descent)"
 *                   expect   "__GAME__.score jumps by the trick scoreBonus and the carried
 *                             momentum is boosted on a clean landing (a crash landing applies
 *                             neither); trick.landed logged"
 *
 * REAL drive through the REAL seam: AirTrick reads ONLY the avatar's own vy — the launch burst
 * (a strong negative vy) is its trigger and the descent past landThreshold is the touchdown.
 * The verb is "what the body does after a launch", so a harness drives it by setting the real
 * body velocity.y — exactly as SlopeGlide's launch (or a driven vy) would. We mount onto a
 * fresh real owner (whose .scene IS the real scene, so getScore/setScore + the bus are real),
 * drive a big launch (vy strongly negative) then a CONTROLLED descent crossing landThreshold,
 * and assert __GAME__.score jumps by scoreBonus + owner.momentum is boosted + trick.landed
 * logged. A CRASH COUNTERFACTUAL: a SLAMMED descent (too fast) lands but applies NO reward and
 * fires NO event.
 *
 *   node templates/modules/endless_runner/src/behaviors/__tests__/AirTrick.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

const PARAMS = { launchThreshold: 420, landThreshold: 120, minCleanAir: 0.1, maxCleanFall: 520, boost: 200, scoreBonus: 5 };

/** Drive the owner's real body vy for one frame, then tick the behavior via the engine step. */
const driveVy = (world, owner, vy) => { owner.body.velocity.y = vy; world.step(1); };

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a big launch + a CONTROLLED descent → a clean landing scores + boosts.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;

  const owner = world.spawnEnemy({ x: 120, y: 300 });
  const beh = world.mountBehavior('AirTrick', PARAMS, owner);
  check('resolveBehavior returned a real AirTrick', beh.constructor.name === 'AirTrick', beh.constructor.name);

  const scoreBefore = scene.getScore();
  const cur = bus.cursor;

  // LAUNCH: a strong upward burst (vy < -launchThreshold) starts the trick + the air clock.
  driveVy(world, owner, -500);
  // AIR + CLEAN DESCENT: climb back up through 0 and past landThreshold with a CONTROLLED speed
  // (≤ maxCleanFall) over enough frames to bank > minCleanAir of air time.
  for (let i = 0; i < 10; i++) driveVy(world, owner, -100 + i * 40); // ...,-60,-20,20,...,260 (crosses 120 controlled)

  const landed = bus.recent(cur).filter((e) => e.type === 'trick.landed');
  check('CLEAN: trick.landed logged on the real bus', landed.length === 1, `count=${landed.length}`);
  check('CLEAN: __GAME__.score jumped by the trick scoreBonus (+5)', scene.getScore() === scoreBefore + 5, `${scoreBefore}→${scene.getScore()}`);
  check('CLEAN: the carried momentum was boosted', (owner.momentum ?? 0) === 200, `momentum=${owner.momentum}`);
  check('CLEAN: trick.landed payload {airTime,boost,score}', landed.at(-1)?.payload?.boost === 200 && landed.at(-1)?.payload?.score === scoreBefore + 5, JSON.stringify(landed.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a SLAMMED landing (descent speed far above
// maxCleanFall) is a CRASH — the trick is canceled: NO score jump, NO momentum boost,
// NO trick.landed. If the clean-judge / reward-emit were vacuous, this would over-fire.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  const owner = world.spawnEnemy({ x: 140, y: 300 });
  world.mountBehavior('AirTrick', PARAMS, owner);

  const scoreBefore = scene.getScore();
  const cur = bus.cursor;

  // LAUNCH then a SLAMMED descent: cross landThreshold at a speed well above maxCleanFall (520)
  // → judged a crash. Drive vy from a launch straight to a hard slam.
  driveVy(world, owner, -500);
  driveVy(world, owner, -200);
  driveVy(world, owner, 900); // descent crosses 120 but at 900 >> maxCleanFall → CRASH

  const landed = bus.recent(cur).filter((e) => e.type === 'trick.landed');
  check('counterfactual: a slammed (crash) landing → no trick.landed', landed.length === 0, `count=${landed.length}`);
  check('counterfactual: crash → __GAME__.score unchanged', scene.getScore() === scoreBefore, `score=${scene.getScore()}`);
  check('counterfactual: crash → momentum not boosted', (owner.momentum ?? 0) === 0, `momentum=${owner.momentum}`);

  world.destroy();
}

console.log(`\n[oracle] AirTrick ok — ${passed} assertions: trick.landed on a clean landing (__GAME__.score +5 + momentum boosted) after a big driven launch; counterfactual (a slammed crash landing → no reward, no event) holds.`);
process.exit(0);
