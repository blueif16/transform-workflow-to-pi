/**
 * BrickTypes — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the systems through the ENGINE'S OWN
 * resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/systems/BrickTypes.ts):
 *   - brick.cracked  drivenBy "a multi-hit brick (hp>1) is hit by the ball but not destroyed
 *                              (scene.brickTypes.crack() also drives it)"
 *                    expect   "that brick's remaining hit-count decreases by one while the brick
 *                              STAYS in __GAME__.entities (a crack, not a clear); brick.cracked logged"
 *
 * REAL fixtures + REAL drive: BrickTypes is a COMPANION that WRAPS the BrickGrid collision seam,
 * so the boot needs a multi-hit brick (hp>1) in the data and BrickGrid mounted first. We inject a
 * real hp=3 brick into scene.levelData.bricks (the way bootHeadless.oracle injects a reward sprite),
 * mount BrickGrid (builds it + owns scene.brickGrid.hitBrickAt), then mount BrickTypes (wraps that
 * seam). The CRACK verb is the REAL ball↔brick contact: we call the wrapped scene.brickGrid.hitBrickAt
 * with a ball AABB ON the multi-hit brick — exactly as the scene's sub-step loop does. The brick
 * SURVIVES (3→2 hp), so it CRACKS: hitsRemaining drops by one while the brick stays in the world.
 * A COUNTERFACTUAL hits a ONE-hit brick (clears, never cracks) → no brick.cracked.
 *
 *   node templates/modules/paddle_ball/src/systems/__tests__/BrickTypes.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const ballAABB = (cx, cy, size = 14) => ({ cx, cy, halfW: size / 2, halfH: size / 2 });

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: crack a real multi-hit brick via the real (wrapped) hitBrickAt seam.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  // A multi-hit brick (hp=3) + a one-hit brick — the real fixtures the boot lacked.
  scene.levelData.bricks = [
    { id: 'multi', x: 120, y: 120, width: 48, height: 20, hp: 3, points: 30 },
    { id: 'single', x: 220, y: 120, width: 48, height: 20, hp: 1, points: 10 },
  ];
  const grid = world.mountSystem('BrickGrid', {});       // owns scene.brickGrid.hitBrickAt
  const types = world.mountSystem('BrickTypes', {});      // WRAPS that seam
  check('resolveSystem returned a real BrickTypes', types.constructor.name === 'BrickTypes', types.constructor.name);
  check('attach published the scene.brickTypes seam', scene.brickTypes === types, `seam=${scene.brickTypes?.constructor?.name}`);
  check('the BrickGrid seam is wrapped by BrickTypes', scene.brickGrid?.__brickTypesWrapped === true, `wrapped=${scene.brickGrid?.__brickTypesWrapped}`);
  check('precondition: the multi-hit brick is tracked at hp=3', types.hitsRemaining('multi') === 3, `hits=${types.hitsRemaining('multi')}`);

  const breakableBefore = grid.breakableRemaining();

  // DRIVE: the ball contacts the multi-hit brick — the wrapped seam runs the real collision.
  const cur = bus.cursor;
  const hit = scene.brickGrid.hitBrickAt(ballAABB(120, 120), { x: 0, y: -300 });
  const cracked = bus.recent(cur).filter((e) => e.type === 'brick.cracked');
  check('CRACK: the wrapped hitBrickAt reported a hit', hit === true, `hit=${hit}`);
  // EXPECT: the brick's hit-count dropped by one (3→2) while it STAYS in the world (a crack).
  check('CRACK: multi-hit brick hitsRemaining decreased 3→2', types.hitsRemaining('multi') === 2, `hits=${types.hitsRemaining('multi')}`);
  check('CRACK: the brick STAYED in the world (breakable count unchanged)', grid.breakableRemaining() === breakableBefore, `before=${breakableBefore} after=${grid.breakableRemaining()}`);
  check('CRACK: brick.cracked logged on the real bus', cracked.length === 1, `count=${cracked.length}`);
  check('CRACK: brick.cracked payload {id:multi,hitsRemaining:2}', cracked.at(-1)?.payload?.id === 'multi' && cracked.at(-1)?.payload?.hitsRemaining === 2, JSON.stringify(cracked.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a ONE-hit brick CLEARS on contact (never
// cracks) — so a hit on it fires NO brick.cracked, while the multi-hit count above
// proves the crack path is real. If onMultiHit()/the emit were a no-op the CRACK
// assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  scene.levelData.bricks = [
    { id: 'multi', x: 120, y: 120, width: 48, height: 20, hp: 3, points: 30 },
    { id: 'single', x: 220, y: 120, width: 48, height: 20, hp: 1, points: 10 },
  ];
  world.mountSystem('BrickGrid', {});
  const types = world.mountSystem('BrickTypes', {});

  const cur = bus.cursor;
  // Hit the ONE-hit brick → it clears straight away; a one-hit brick is never tracked → no crack.
  const hit = scene.brickGrid.hitBrickAt(ballAABB(220, 120), { x: 0, y: -300 });
  const cracked = bus.recent(cur).filter((e) => e.type === 'brick.cracked');
  check('counterfactual: the one-hit brick was hit', hit === true, `hit=${hit}`);
  check('counterfactual: a one-hit brick clears, never cracks → no brick.cracked', cracked.length === 0, `count=${cracked.length}`);
  check('counterfactual: the multi-hit brick is untouched (still hp=3)', types.hitsRemaining('multi') === 3, `hits=${types.hitsRemaining('multi')}`);

  world.destroy();
}

console.log(`\n[oracle] BrickTypes ok — ${passed} assertions: brick.cracked (real wrapped ball↔brick hit: multi-hit hitsRemaining 3→2 while the brick STAYS in __GAME__.entities); counterfactual (one-hit clears, never cracks) holds.`);
process.exit(0);
