/**
 * PaddleController — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the behavior through the ENGINE'S OWN
 * resolver (world.mountBehavior) onto the REAL paddle — the test never imports the component.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/behaviors/PaddleController.ts):
 *   - paddle.moved  drivenBy "move input (Left/Right or A/D key, or pointer) on the paddle axis"
 *                   expect   "__GAME__.player.x (or .y) changes this frame; paddle.moved logged"
 *
 * REAL drive through the REAL seam: PaddleController exposes `setInput(dir)` — the SAME programmatic
 * input-override seam the scene/FSM/responsiveness driver uses to drive the paddle headless (a real
 * per-frame move input on the bound axis, NOT the private emit). We mount the controller onto the
 * REAL scene.paddle (which IS __GAME__.player), inject a +1 move input, and STEP the real engine —
 * the controller slides the paddle along its axis (clamped) and emits paddle.moved at the real move
 * moment. The OBSERVABLE transition is scene.player.x rising this frame. A COUNTERFACTUAL injects NO
 * input (dir 0) → the paddle does not move and paddle.moved does not fire.
 *
 *   node templates/modules/paddle_ball/src/behaviors/__tests__/PaddleController.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a +1 move input slides the real paddle on its axis → paddle.moved.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  // Mount onto the REAL paddle (axis 'x' — the default bottom bat; the paddle IS __GAME__.player).
  const ctrl = world.mountBehavior('PaddleController', { speed: 400, axis: 'x', source: 'keys' }, scene.paddle);
  check('resolveBehavior returned a real PaddleController', ctrl.constructor.name === 'PaddleController', ctrl.constructor.name);
  check('mounted onto the real scene.paddle (== __GAME__.player)', scene.player === scene.paddle, 'player aliases paddle');

  const xBefore = scene.player.x;

  // DRIVE: inject a +1 (rightward) move input for the next frame, then step the real engine.
  let cur = bus.cursor;
  ctrl.setInput(1);
  world.step(1);
  const moved = bus.recent(cur).filter((e) => e.type === 'paddle.moved');
  const xAfter = scene.player.x;
  // EXPECT: the paddle slid RIGHT (x increased) and paddle.moved logged with the new {x,y}.
  check('MOVE: __GAME__.player.x increased (the paddle slid right)', xAfter > xBefore, `${xBefore}→${xAfter}`);
  check('MOVE: paddle.moved logged on the real bus', moved.length >= 1, `count=${moved.length}`);
  check('MOVE: paddle.moved payload {x,y} matches the live paddle', Math.abs((moved.at(-1)?.payload?.x ?? NaN) - scene.player.x) < 1e-6, JSON.stringify(moved.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO move input the paddle stays put
// and paddle.moved never fires. If update()'s move/emit were a no-op the MOVE
// assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  world.mountBehavior('PaddleController', { speed: 400, axis: 'x', source: 'keys' }, scene.paddle);

  const xBefore = scene.player.x;
  const cur = bus.cursor;
  world.step(3); // step the real engine, but inject NO move input (no keys down headless, dir 0)
  const moved = bus.recent(cur).filter((e) => e.type === 'paddle.moved');
  check('counterfactual: no input → paddle x unchanged', scene.player.x === xBefore, `${xBefore}→${scene.player.x}`);
  check('counterfactual: no input → no paddle.moved', moved.length === 0, `count=${moved.length}`);

  world.destroy();
}

console.log(`\n[oracle] PaddleController ok — ${passed} assertions: paddle.moved (a real setInput move slides __GAME__.player.x on its axis); counterfactual (no input → no move, no event) holds.`);
process.exit(0);
