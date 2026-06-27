/**
 * BrickGrid — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the system through the ENGINE'S OWN
 * resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/systems/BrickGrid.ts):
 *   - brick.cleared  drivenBy "the ball overlaps a breakable brick and depletes its hp"
 *                    expect   "the brick leaves __GAME__.entities (bricksRemaining -1); when the
 *                              last breakable brick clears status becomes won; brick.cleared logged"
 *
 * REAL drive through the REAL seam: BrickGrid publishes scene.brickGrid = this in attach() and
 * the ball↔brick collision verb IS the seam the scene's real sub-step ball loop calls every
 * sub-step — `scene.brickGrid.hitBrickAt(ballAABB, vel)`. We drive that exact seam with a ball
 * AABB positioned ON a real brick (built by the mounted grid from levelData.bricks) and a real
 * velocity — exactly as BasePaddleScene.stepBall() drives it — NEVER calling clearBrick()/the
 * private emit. The hit depletes the brick's hp, clears it, and the OBSERVABLE transition is the
 * breakable count dropping by one + score rising. We also drive the FINAL brick to assert the
 * clear-all WIN (status->won). Plus a COUNTERFACTUAL: a hit on EMPTY space clears nothing.
 *
 *   node templates/modules/paddle_ball/src/systems/__tests__/BrickGrid.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** A ball AABB (center cx,cy + half extents) — the shape the scene's ball loop passes. */
const ballAABB = (cx, cy, size = 14) => ({ cx, cy, halfW: size / 2, halfH: size / 2 });

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: break ONE real brick via the real hitBrickAt collision seam.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  // Mount a fresh BrickGrid; attach() builds the bricks from levelData.bricks and publishes
  // scene.brickGrid. Use a small explicit two-brick field so the clear-all win is reachable.
  scene.levelData.bricks = [
    { id: 'oracle_b0', x: 120, y: 120, width: 48, height: 20, hp: 1, points: 25 },
    { id: 'oracle_b1', x: 220, y: 120, width: 48, height: 20, hp: 1, points: 25 },
  ];
  const grid = world.mountSystem('BrickGrid', { brickPoints: 10 });
  check('resolveSystem returned a real BrickGrid', grid.constructor.name === 'BrickGrid', grid.constructor.name);
  check('attach published the scene.brickGrid seam', scene.brickGrid === grid, `seam=${scene.brickGrid?.constructor?.name}`);

  const breakableBefore = grid.breakableRemaining();
  const scoreBefore = Number(scene.registry.get('score') ?? 0);
  check('precondition: two breakable bricks built from data', breakableBefore === 2, `remaining=${breakableBefore}`);

  // DRIVE: the ball collides with the FIRST brick — call the exact seam the scene's loop calls.
  let cur = bus.cursor;
  const vel = { x: 0, y: -300 }; // a real ascending velocity, like a served ball
  const hit = scene.brickGrid.hitBrickAt(ballAABB(120, 120), vel);
  const cleared = bus.recent(cur).filter((e) => e.type === 'brick.cleared');
  check('CLEAR: hitBrickAt reported a hit on the brick', hit === true, `hit=${hit}`);
  check('CLEAR: the brick left the world (breakableRemaining -1)', grid.breakableRemaining() === breakableBefore - 1, `before=${breakableBefore} after=${grid.breakableRemaining()}`);
  check('CLEAR: score rose by the brick points (25)', Number(scene.registry.get('score')) === scoreBefore + 25, `score=${scene.registry.get('score')}`);
  check('CLEAR: brick.cleared logged on the real bus', cleared.length === 1, `count=${cleared.length}`);
  check('CLEAR: brick.cleared payload {id:oracle_b0}', cleared.at(-1)?.payload?.id === 'oracle_b0', JSON.stringify(cleared.at(-1)?.payload));
  check('CLEAR: the velocity reflected off the brick (vy flipped)', vel.y > 0, `vy=${vel.y}`);

  // DRIVE (win): break the LAST breakable brick → the clear-all WIN (status->won).
  cur = bus.cursor;
  scene.brickGrid.hitBrickAt(ballAABB(220, 120), { x: 0, y: -300 });
  world.step(2); // BrickGrid.update() runs the clear-all win check
  check('WIN: breakable count reached 0', grid.breakableRemaining() === 0, `remaining=${grid.breakableRemaining()}`);
  check("WIN: __GAME__.status became 'won' on the last clear", scene.registry.get('status') === 'won', `status=${scene.registry.get('status')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a hit on EMPTY space (no brick) clears
// nothing — the count is unchanged and no brick.cleared fires. If clearBrick()/the
// emit were a no-op the CLEAR assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  scene.levelData.bricks = [{ id: 'cf_b0', x: 120, y: 120, width: 48, height: 20, hp: 1, points: 25 }];
  const grid = world.mountSystem('BrickGrid', {});
  const breakableBefore = grid.breakableRemaining();

  const cur = bus.cursor;
  const vel = { x: 0, y: -300 };
  const hit = scene.brickGrid.hitBrickAt(ballAABB(400, 600), vel); // far from the one brick
  const cleared = bus.recent(cur).filter((e) => e.type === 'brick.cleared');
  check('counterfactual: a hit on empty space reported no hit', hit === false, `hit=${hit}`);
  check('counterfactual: breakable count unchanged', grid.breakableRemaining() === breakableBefore, `before=${breakableBefore} after=${grid.breakableRemaining()}`);
  check('counterfactual: no brick.cleared', cleared.length === 0, `count=${cleared.length}`);

  world.destroy();
}

console.log(`\n[oracle] BrickGrid ok — ${passed} assertions: brick.cleared (real ball↔brick hitBrickAt seam: breakable count -1 + score up + clear-all WIN status->won); counterfactual holds.`);
process.exit(0);
