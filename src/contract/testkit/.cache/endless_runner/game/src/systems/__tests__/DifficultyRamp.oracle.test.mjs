/**
 * DifficultyRamp — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/systems/DifficultyRamp.ts):
 *   - difficulty.increased  drivenBy "the scrolled distance crossing the next difficulty threshold"
 *                           expect   "the live scroll speed increases (every obstacle in
 *                                     __GAME__.entities advances left faster) and the spawn spacing
 *                                     shortens (new pairs enter more often); logged with the new level"
 *
 * REAL drive through the REAL seam: DifficultyRamp accumulates DISTANCE from the LIVE scroller's
 * scroll speed each frame and, on crossing a threshold, MUTATES the live scroller's own tunables
 * (scrollSpeed up, spawnEveryPx down) in place. It reaches the running scroller through the live
 * scene.systems — exactly the ObstacleScrollSystem the data loader constructed. So here we KEEP
 * the level's DEFAULT systems (which already include a live ObstacleScrollSystem in scene.systems),
 * mount the ramp, and STEP the real engine: the distance meter advances at the world's real scroll
 * rate, crosses the threshold, and the OBSERVABLE transition is the live scroller's scrollSpeed
 * RISING + spawnEveryPx FALLING, with difficulty.increased logged carrying the new level. A
 * COUNTERFACTUAL steps FAR SHORT of one threshold → no ramp, scroller tunables unchanged, no event.
 *
 *   node templates/modules/endless_runner/src/systems/__tests__/DifficultyRamp.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** The live ObstacleScrollSystem the ramp borrows from scene.systems (the one with the tunables). */
const liveScroller = (scene) => (scene.systems ?? []).find((s) => s?.cfg && typeof s.cfg.scrollSpeed === 'number' && typeof s.cfg.spawnEveryPx === 'number');

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: the distance meter crosses a threshold → the live scroller ramps up.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  // KEEP the default scene.systems — the ramp borrows the live ObstacleScrollSystem there.

  const ramp = world.mountSystem('DifficultyRamp', { stepEveryPx: 100, speedMul: 1.5, spawnMul: 0.8, maxScrollSpeed: 600, minSpawnEveryPx: 50 });
  check('resolveSystem returned a real DifficultyRamp', ramp.constructor.name === 'DifficultyRamp', ramp.constructor.name);

  const scroller = liveScroller(scene);
  check('precondition: a live ObstacleScrollSystem is in scene.systems', !!scroller, `scroller=${scroller?.constructor?.name}`);
  const speedBefore = scroller.cfg.scrollSpeed;
  const spawnBefore = scroller.cfg.spawnEveryPx;
  check('precondition: difficulty published on scene.difficulty at level 0', scene.difficulty?.level === 0, JSON.stringify(scene.difficulty));

  // DRIVE: step until the distance meter (distance += scrollSpeed*dt each frame) crosses stepEveryPx.
  const cur = bus.cursor;
  let ramps = [];
  for (let i = 0; i < 120 && ramps.length === 0; i++) {
    world.step(1);
    ramps = bus.recent(cur).filter((e) => e.type === 'difficulty.increased');
  }
  check('RAMP: difficulty.increased logged on the real bus', ramps.length >= 1, `count=${ramps.length}`);
  check('RAMP: difficulty.increased payload carries the new level (1)', ramps.at(0)?.payload?.level === 1, JSON.stringify(ramps.at(0)?.payload));
  check('RAMP: the live scroll speed INCREASED (obstacles advance faster)', scroller.cfg.scrollSpeed > speedBefore, `${speedBefore}→${scroller.cfg.scrollSpeed}`);
  check('RAMP: the live spawn spacing SHORTENED (pairs arrive sooner)', scroller.cfg.spawnEveryPx < spawnBefore, `${spawnBefore}→${scroller.cfg.spawnEveryPx}`);
  check('RAMP: scene.difficulty.level stepped to 1', scene.difficulty?.level === 1, JSON.stringify(scene.difficulty));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): step FAR SHORT of one threshold — the
// distance meter never crosses it, so the scroller's tunables are UNCHANGED and
// difficulty.increased never fires. If applyRamp()/the emit ran unconditionally
// the RAMP assertions would be vacuously true; this proves the ramp is gated on distance.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  world.mountSystem('DifficultyRamp', { stepEveryPx: 100000, speedMul: 1.5, spawnMul: 0.8 }); // huge threshold

  const scroller = liveScroller(scene);
  const speedBefore = scroller.cfg.scrollSpeed;
  const spawnBefore = scroller.cfg.spawnEveryPx;
  const cur = bus.cursor;
  world.step(20); // nowhere near 100000px of distance
  const ramps = bus.recent(cur).filter((e) => e.type === 'difficulty.increased');
  check('counterfactual: short of the threshold → no difficulty.increased', ramps.length === 0, `count=${ramps.length}`);
  check('counterfactual: the live scroll speed is unchanged', scroller.cfg.scrollSpeed === speedBefore, `${speedBefore}→${scroller.cfg.scrollSpeed}`);
  check('counterfactual: the live spawn spacing is unchanged', scroller.cfg.spawnEveryPx === spawnBefore, `${spawnBefore}→${scroller.cfg.spawnEveryPx}`);

  world.destroy();
}

console.log(`\n[oracle] DifficultyRamp ok — ${passed} assertions: difficulty.increased (the distance meter crosses a threshold → the live scroller's scrollSpeed RISES + spawnEveryPx FALLS in place, level→1); counterfactual (short of the threshold → tunables unchanged, no event) holds.`);
process.exit(0);
