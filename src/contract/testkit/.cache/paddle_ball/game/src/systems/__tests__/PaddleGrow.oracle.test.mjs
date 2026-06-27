/**
 * PaddleGrow — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the system through the ENGINE'S OWN
 * resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/systems/PaddleGrow.ts):
 *   - powerup.activated  drivenBy "a paddle-grow power-up is collected (scene.paddleGrow.activate())"
 *                        expect   "__GAME__.player display width increases for a timed window then
 *                                  reverts to the base width; powerup.activated logged"
 *
 * REAL drive through the REAL seam: PaddleGrow PUBLISHES scene.paddleGrow = this in attach()
 * and the COLLECTION verb IS the public `scene.paddleGrow.activate()` (the exact seam a pickup
 * overlap / the runtime check-exposes driver calls — explicitly named in `drivenBy`, NOT the
 * private bus.emit). We collect via that seam and assert the OBSERVABLE transition the engine
 * exposes: scene.player.displayWidth (== __GAME__.player width) rises to base*growFactor, then
 * after the timed window (driven by stepping the real engine clock past durationMs) reverts to
 * the base. Plus a COUNTERFACTUAL: no collect → width unchanged, no powerup.activated.
 *
 *   node templates/modules/paddle_ball/src/systems/__tests__/PaddleGrow.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: collect a grow power-up (GROW), then let the window lapse (REVERT).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  // A short window so the timed revert is reachable by stepping the real scene clock.
  const grow = world.mountSystem('PaddleGrow', { growFactor: 2, durationMs: 200 });
  check('resolveSystem returned a real PaddleGrow', grow.constructor.name === 'PaddleGrow', grow.constructor.name);
  check('attach published the scene.paddleGrow collect seam', scene.paddleGrow === grow, `seam=${scene.paddleGrow?.constructor?.name}`);

  const baseWidth = scene.player.displayWidth; // the paddle IS __GAME__.player
  check('precondition: paddle has a real base width', baseWidth > 0, `base=${baseWidth}`);

  // DRIVE (grow): collect the power-up via the real public seam.
  let cur = bus.cursor;
  scene.paddleGrow.activate();
  const grown = bus.recent(cur).filter((e) => e.type === 'powerup.activated');
  // EXPECT: width rose to base*growFactor (independently justified: base*2, not the fn echo).
  const want = baseWidth * 2;
  check('GROW: scene.player displayWidth rose to base*growFactor', Math.abs(scene.player.displayWidth - want) < 1e-3, `width=${scene.player.displayWidth} want=${want}`);
  check('GROW: powerup.activated logged on the real bus', grown.length === 1, `count=${grown.length}`);
  check('GROW: powerup.activated payload {kind:paddleGrow}', grown.at(-1)?.payload?.kind === 'paddleGrow', JSON.stringify(grown.at(-1)?.payload));
  check('GROW: payload width === the grown width', Math.abs((grown.at(-1)?.payload?.width ?? 0) - want) < 1e-3, JSON.stringify(grown.at(-1)?.payload));

  // DRIVE (revert): step the real engine past the window; update() reverts the width.
  world.step(30); // 30 frames @ 60fps ≈ 500ms > durationMs(200)
  check('REVERT: width reverted to the base after the window lapsed', Math.abs(scene.player.displayWidth - baseWidth) < 1e-3, `width=${scene.player.displayWidth} base=${baseWidth}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): NOT collecting the power-up leaves the
// paddle at its base width and fires no powerup.activated. If activate()'s
// resize/emit were a no-op the GROW assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  world.mountSystem('PaddleGrow', { growFactor: 2, durationMs: 200 });
  const baseWidth = scene.player.displayWidth;

  const cur = bus.cursor;
  world.step(10); // run the engine, but DON'T collect
  const fired = bus.recent(cur).filter((e) => e.type === 'powerup.activated');
  check('counterfactual: no collect → width stays at base', Math.abs(scene.player.displayWidth - baseWidth) < 1e-3, `width=${scene.player.displayWidth} base=${baseWidth}`);
  check('counterfactual: no collect → no powerup.activated', fired.length === 0, `count=${fired.length}`);

  world.destroy();
}

console.log(`\n[oracle] PaddleGrow ok — ${passed} assertions: powerup.activated GROW (player displayWidth ×growFactor via the real scene.paddleGrow.activate() seam) + timed REVERT to base; counterfactual holds.`);
process.exit(0);
