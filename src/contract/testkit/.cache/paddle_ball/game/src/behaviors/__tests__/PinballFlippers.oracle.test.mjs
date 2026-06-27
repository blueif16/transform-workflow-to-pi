/**
 * PinballFlippers — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the behavior through the ENGINE'S OWN
 * resolver (world.mountBehavior) onto the REAL paddle — the test never imports the component.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/behaviors/PinballFlippers.ts):
 *   - flipper.flicked  drivenBy "press the flip key (default SPACE)"
 *                      expect   "both flippers rotate UP from rest then ease back; a raised flipper
 *                                kicks the ball upward; flipper.flicked logged"
 *   - bumper.hit       drivenBy "the ball strikes a bumper"
 *                      expect   "__GAME__.score increases by the bumper points and the ball deflects
 *                                (velocity reflects off the bumper); bumper.hit logged"
 *
 * REAL drive through the REAL seams:
 *   - flipper.flicked: the behavior reads Phaser.Input.Keyboard.JustDown(its flip Key). We drive a
 *     REAL key press by calling `key.onDown({})` on the SAME scene-keyboard Key the behavior holds
 *     (re-fetched via scene.input.keyboard.addKey('SPACE') — the exact method Phaser's keyboard
 *     plugin calls on a physical keydown, NOT the private bus.emit). Stepping the engine then raises
 *     the flippers; a raised flipper that a descending ball touches kicks it UPWARD (scene.ballVel.y<0)
 *     — both observable transitions the `expect` names. flipper.flicked logs with a rising tilt.
 *   - bumper.hit: configure ONE bumper at a known position, drive the live ball onto it + step the
 *     real engine → score rises by the bumper points and the ball deflects.
 *   - COUNTERFACTUAL: no key press → flippers stay at rest, no kick, no flipper.flicked.
 *
 *   node templates/modules/paddle_ball/src/behaviors/__tests__/PinballFlippers.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const score = (scene) => Number(scene.registry.get('score') ?? 0);

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 1 — FLIPPER.FLICKED: a real SPACE press raises the flippers + kicks the ball.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  // Pin the left flipper at a known pivot so the kick box is deterministic.
  const leftPivot = { x: 150, y: 600 };
  const flippers = world.mountBehavior(
    'PinballFlippers',
    { flipKey: 'SPACE', leftPivot, rightPivot: { x: 282, y: 600 }, bumpers: [], kickSpeed: 500 },
    scene.paddle,
  );
  check('resolveBehavior returned a real PinballFlippers', flippers.constructor.name === 'PinballFlippers', flippers.constructor.name);

  // The REAL flip Key the behavior is reading (same code → same Key instance on the scene keyboard).
  const flipKey = scene.input.keyboard.addKey('SPACE');

  // DRIVE: a real key DOWN (the method Phaser's keyboard plugin calls on a physical keydown).
  let cur = bus.cursor;
  flipKey.onDown({}); // isDown=true + _justDown=true → JustDown() reads the press next update
  world.step(1);      // the behavior's update() sees JustDown → raises the flippers + emits
  const flicked = bus.recent(cur).filter((e) => e.type === 'flipper.flicked');
  check('FLICK: flipper.flicked logged on the real bus', flicked.length === 1, `count=${flicked.length}`);
  check('FLICK: flipper.flicked payload {tilt:1}', flicked.at(-1)?.payload?.tilt === 1, JSON.stringify(flicked.at(-1)?.payload));
  check('FLICK: not yet tilt-locked at the first flick', flicked.at(-1)?.payload?.locked === false, JSON.stringify(flicked.at(-1)?.payload));

  // Hold the key + step so the left flipper finishes raising (flipUpRate 900 deg/s).
  world.step(6); // ~100ms of raise — past restAngle+flipAngle while the key stays down

  // The raised flipper KICKS a descending ball: place the ball in the left flipper's reach box,
  // moving DOWN, then step → the kick sets scene.ballVel.y negative (upward).
  // reach = flipperLength(92)*0.8 = 73.6; box center cx = pivot.x + side(-1)*reach*0.5 ≈ 150-36.8 = 113.
  scene.ball.x = 113;
  scene.ball.y = leftPivot.y; // at the flipper's y
  scene.ballVel.x = 0;
  scene.ballVel.y = 200; // descending onto the raised flipper
  world.step(1);
  check('KICK: a raised flipper kicked the ball UPWARD (ballVel.y < 0)', scene.ballVel.y < 0, `vy=${scene.ballVel.y}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 2 — BUMPER.HIT: the ball strikes a scoring bumper → score up + deflect.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  // A known bumper in the clear mid-field band (below the default brick grid y≲232, above the paddle).
  const BUMPER = { x: 120, y: 420, points: 90 };
  world.mountBehavior(
    'PinballFlippers',
    { bumpers: [BUMPER], bumperRadius: 26, bumperPoints: 90, leftPivot: { x: 150, y: 600 }, rightPivot: { x: 282, y: 600 } },
    scene.paddle,
  );

  const scoreBefore = score(scene);
  const cur = bus.cursor;
  scene.ball.x = BUMPER.x;
  scene.ball.y = BUMPER.y;
  scene.ballVel.x = 40; // a slow real velocity moving into the bumper
  scene.ballVel.y = 40;
  world.step(1);
  const hits = bus.recent(cur).filter((e) => e.type === 'bumper.hit');
  check('BUMPER.HIT: __GAME__.score rose by the bumper points (90)', score(scene) === scoreBefore + 90, `before=${scoreBefore} after=${score(scene)}`);
  check('BUMPER.HIT: bumper.hit logged on the real bus', hits.length === 1, `count=${hits.length}`);
  check('BUMPER.HIT: payload {points:90}', hits.at(-1)?.payload?.points === 90, JSON.stringify(hits.at(-1)?.payload));
  check('BUMPER.HIT: the ball deflected (a velocity component reflected)', scene.ballVel.x < 0 || scene.ballVel.y < 0, `vel=(${scene.ballVel.x},${scene.ballVel.y})`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO key press the flippers stay at
// rest, a descending ball is NOT kicked, and flipper.flicked never fires. If the
// JustDown→raise→emit path were a no-op the FLICK assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  world.mountBehavior(
    'PinballFlippers',
    { flipKey: 'SPACE', leftPivot: { x: 150, y: 600 }, rightPivot: { x: 282, y: 600 }, bumpers: [] },
    scene.paddle,
  );

  const cur = bus.cursor;
  world.step(6); // step the real engine, but NEVER press the flip key
  // A descending ball over the (un-raised) left flipper must NOT be kicked upward.
  scene.ball.x = 113;
  scene.ball.y = 600;
  scene.ballVel.x = 0;
  scene.ballVel.y = 200;
  world.step(1);
  const flicked = bus.recent(cur).filter((e) => e.type === 'flipper.flicked');
  check('counterfactual: no key press → no flipper.flicked', flicked.length === 0, `count=${flicked.length}`);
  check('counterfactual: a resting flipper does NOT kick the ball up (vy stays > 0)', scene.ballVel.y > 0, `vy=${scene.ballVel.y}`);

  world.destroy();
}

console.log(`\n[oracle] PinballFlippers ok — ${passed} assertions: flipper.flicked (a real SPACE onDown raises the flippers → a raised flipper kicks the ball upward) + bumper.hit (real ball-on-bumper: __GAME__.score +points + deflect); counterfactual holds.`);
process.exit(0);
