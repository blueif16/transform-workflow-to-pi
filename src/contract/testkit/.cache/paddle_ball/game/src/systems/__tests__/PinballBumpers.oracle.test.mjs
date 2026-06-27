/**
 * PinballBumpers — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the system through the ENGINE'S OWN
 * resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/systems/PinballBumpers.ts):
 *   - target.hit      drivenBy "the ball hits a scoring target/bumper on the pinball field"
 *                     expect   "__GAME__.score increases by the element points and the ball deflects
 *                               (its velocity reflects, a bumper also kicks it); target.hit logged"
 *   - ramp.completed  drivenBy "the ball enters a ramp mouth and then reaches that ramp exit"
 *                     expect   "__GAME__.score increases by the ramp bonus; ramp.completed logged"
 *
 * REAL fixtures + REAL drive: PinballBumpers builds an explicit scoring field from `params`. We
 * configure ONE bumper + ONE ramp at KNOWN coordinates (so the test asserts independently-justified
 * positions/points, not the function's echo). The drive verb is the REAL ball: we position the live
 * scene.ball ON the field element + give it a real velocity, then STEP the real engine — the system's
 * update() reads scene.ball + scene.ballVel (the same world-read the real game uses) and resolves the
 * field, NEVER calling scoreTarget()/completeRamp() directly. A bumper contact raises __GAME__.score
 * by its points and reflects the ball; a ramp completes (mouth→exit) and adds its bonus. A
 * COUNTERFACTUAL keeps the ball far from the field → no target.hit/ramp.completed, score unchanged.
 *
 *   node templates/modules/paddle_ball/src/systems/__tests__/PinballBumpers.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const score = (scene) => Number(scene.registry.get('score') ?? 0);

// A known field: one pop-bumper + one ramp at explicit coordinates (so the asserted points /
// positions are ours, not the component's defaults). Placed in the CLEAR mid-field band
// (y∈[300,640]) — below the default level's brick grid (y≲232) and above the paddle (y≈712) —
// so the only scorer the live ball can touch is OUR field (no stray brick clears).
const BUMPER = { id: 'bx', x: 120, y: 400, radius: 24, points: 70, kick: 80 };
const RAMP = {
  id: 'rx',
  mouth: { x: 320, y: 600, width: 40, height: 40 },
  exit: { x: 320, y: 360, width: 40, height: 40 },
  bonus: 250,
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: the ball hits a bumper (TARGET.HIT), then completes a ramp (RAMP.COMPLETED).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  const field = world.mountSystem('PinballBumpers', { bumpers: [BUMPER], ramps: [RAMP], hitCooldownMs: 0 });
  check('resolveSystem returned a real PinballBumpers', field.constructor.name === 'PinballBumpers', field.constructor.name);
  check('attach published the scene.pinballBumpers seam', scene.pinballBumpers === field, `seam=${scene.pinballBumpers?.constructor?.name}`);

  // ── TARGET.HIT: place the live ball ON the bumper, moving INTO it, then step the engine. ──
  let scoreBefore = score(scene);
  let cur = bus.cursor;
  scene.ball.x = BUMPER.x;
  scene.ball.y = BUMPER.y;
  scene.ballVel.x = 60; // a slow real velocity so stepBall barely moves it before the field reads it
  scene.ballVel.y = 60;
  const velYBefore = scene.ballVel.y;
  world.step(1); // the real engine frame, then PinballBumpers.update() resolves the field
  const hits = bus.recent(cur).filter((e) => e.type === 'target.hit');
  check('TARGET.HIT: __GAME__.score rose by the bumper points (70)', score(scene) === scoreBefore + 70, `before=${scoreBefore} after=${score(scene)}`);
  check('TARGET.HIT: target.hit logged on the real bus', hits.length === 1, `count=${hits.length}`);
  check('TARGET.HIT: payload {id:bx,kind:bumper,points:70}', hits.at(-1)?.payload?.id === 'bx' && hits.at(-1)?.payload?.kind === 'bumper' && hits.at(-1)?.payload?.points === 70, JSON.stringify(hits.at(-1)?.payload));
  check('TARGET.HIT: the ball deflected (a velocity component reflected)', scene.ballVel.x < 0 || scene.ballVel.y < 0 || scene.ballVel.y !== velYBefore, `vel=(${scene.ballVel.x},${scene.ballVel.y})`);

  // ── RAMP.COMPLETED: enter the mouth (latch), then reach the exit (complete). ──
  scoreBefore = score(scene);
  cur = bus.cursor;
  // Move the ball into the ramp MOUTH and step → latches onRamp (no bonus yet).
  scene.ball.x = RAMP.mouth.x;
  scene.ball.y = RAMP.mouth.y;
  scene.ballVel.x = 0;
  scene.ballVel.y = 0;
  world.step(1);
  const afterMouth = bus.recent(cur).filter((e) => e.type === 'ramp.completed');
  check('RAMP: entering the mouth alone does NOT complete the ramp', afterMouth.length === 0 && score(scene) === scoreBefore, `count=${afterMouth.length} score=${score(scene)}`);
  // Now move the ball to the ramp EXIT and step → completes the ramp + awards the bonus.
  scene.ball.x = RAMP.exit.x;
  scene.ball.y = RAMP.exit.y;
  world.step(1);
  const completed = bus.recent(cur).filter((e) => e.type === 'ramp.completed');
  check('RAMP.COMPLETED: __GAME__.score rose by the ramp bonus (250)', score(scene) === scoreBefore + 250, `before=${scoreBefore} after=${score(scene)}`);
  check('RAMP.COMPLETED: ramp.completed logged on the real bus', completed.length === 1, `count=${completed.length}`);
  check('RAMP.COMPLETED: payload {id:rx,bonus:250}', completed.at(-1)?.payload?.id === 'rx' && completed.at(-1)?.payload?.bonus === 250, JSON.stringify(completed.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): the ball kept FAR from every field element
// scores nothing — no target.hit / ramp.completed, score unchanged. If scoreTarget()/
// completeRamp()/the emits were a no-op the DRIVE assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  world.mountSystem('PinballBumpers', { bumpers: [BUMPER], ramps: [RAMP], hitCooldownMs: 0 });

  const scoreBefore = score(scene);
  const cur = bus.cursor;
  // Park the ball in a corner far from the bumper(200,200) and the ramp(300,150..500).
  scene.ball.x = 10;
  scene.ball.y = 10;
  scene.ballVel.x = 0;
  scene.ballVel.y = 0;
  world.step(3);
  const hits = bus.recent(cur).filter((e) => e.type === 'target.hit');
  const completed = bus.recent(cur).filter((e) => e.type === 'ramp.completed');
  check('counterfactual: ball far from the field → no target.hit', hits.length === 0, `count=${hits.length}`);
  check('counterfactual: ball never on a ramp → no ramp.completed', completed.length === 0, `count=${completed.length}`);
  check('counterfactual: score unchanged', score(scene) === scoreBefore, `before=${scoreBefore} after=${score(scene)}`);

  world.destroy();
}

console.log(`\n[oracle] PinballBumpers ok — ${passed} assertions: target.hit (real ball-on-bumper: __GAME__.score +points + ball deflects) + ramp.completed (real mouth→exit route: __GAME__.score +bonus); counterfactual holds.`);
process.exit(0);
