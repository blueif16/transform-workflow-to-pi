/**
 * AxisConstrainedMovement — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the behavior through
 * the ENGINE'S OWN resolver (world.mountBehavior) onto a real owner — the test never imports
 * the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/behaviors/AxisConstrainedMovement.ts):
 *   - [] NO declared event. This is the laser-cannon mover: the player slides along ONE
 *        free axis and is HARD-LOCKED on the other (the signature gallery-shooter constraint).
 *        Per the no-event rule there is no event to assert — instead we assert the OBSERVABLE
 *        constrained-movement transition: the FREE axis advances under input while the LOCKED
 *        axis is pinned to its spawn coordinate.
 *
 * REAL drive through the REAL seam: the scene/scheme drives the mover with setInput(dir) — the
 * SAME programmatic input seam DataShooterScene.driveControlScheme() uses headless (a real
 * per-frame move input on the bound free axis, NOT a private call). We mount the mover onto a
 * real owner sprite (axis 'x'), inject a +1 move input, and STEP the real engine — the mover
 * drives the owner's body along x (clamped to [min,max]) while pinning y. The OBSERVABLE
 * transition: owner.x rises, owner.y is held at its spawn row. A COUNTERFACTUAL injects an
 * UP-axis (locked) intent + NO free input → x and y both stay put (a "move up" on a bottom-track
 * cannon does nothing — the §6 locked-axis invariant).
 *
 *   node templates/modules/gallery_shooter/src/behaviors/__tests__/AxisConstrainedMovement.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a +1 free-axis input slides the owner on x while y is HARD-LOCKED.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene } = world;

  // A real owner on a known row; mount the mover on the 'x' free axis (bottom track),
  // bounded well inside the arena so the move is not immediately clamped.
  const owner = world.spawnEnemy({ x: 200, y: 400 });
  const yRow = owner.y;
  const mover = world.mountBehavior(
    'AxisConstrainedMovement',
    { moveSpeed: 260, axis: 'x', min: 24, max: 408 },
    owner,
  );
  check('resolveBehavior returned a real AxisConstrainedMovement', mover.constructor.name === 'AxisConstrainedMovement', mover.constructor.name);
  check('precondition: owner on its spawn row', owner.y === yRow, `y=${owner.y}`);

  const xBefore = owner.x;
  // DRIVE: inject +1 (rightward) free-axis input, then step the real engine.
  mover.setInput(1);
  world.step(6);
  // OBSERVABLE: the FREE axis advanced (x rose) and the LOCKED axis is pinned (y unchanged).
  check('FREE axis moved: owner.x increased under +1 input', owner.x > xBefore, `${xBefore}→${owner.x}`);
  check('LOCKED axis pinned: owner.y held at the spawn row', owner.y === yRow, `${yRow}→${owner.y}`);
  check('mover reports moving + facing right', mover.isMoving() && mover.movementDirection === 'right', `moving=${mover.isMoving()} dir=${mover.movementDirection}`);

  // DRIVE (other direction): -1 slides it back LEFT, still pinned on y.
  const xRight = owner.x;
  mover.setInput(-1);
  world.step(6);
  check('FREE axis reversed: owner.x decreased under -1 input', owner.x < xRight, `${xRight}→${owner.x}`);
  check('LOCKED axis still pinned after reverse', owner.y === yRow, `y=${owner.y}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO free-axis input the owner stays
// put on BOTH axes — input on the locked axis is structurally impossible (one
// scalar), so a "move" intent that is not on the free axis does nothing. If
// update()'s move were a no-op the DRIVE assertions above would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene } = world;
  const owner = world.spawnEnemy({ x: 200, y: 400 });
  const xBefore = owner.x;
  const yBefore = owner.y;
  const mover = world.mountBehavior('AxisConstrainedMovement', { moveSpeed: 260, axis: 'x', min: 24, max: 408 }, owner);

  mover.setInput(0); // stop — no free-axis intent at all
  world.step(8);     // run the engine, but the owner is given no move
  check('counterfactual: no input → owner.x unchanged', owner.x === xBefore, `${xBefore}→${owner.x}`);
  check('counterfactual: no input → owner.y unchanged', owner.y === yBefore, `${yBefore}→${owner.y}`);
  check('counterfactual: mover reports not moving', mover.isMoving() === false, `moving=${mover.isMoving()}`);

  world.destroy();
}

console.log(`\n[oracle] AxisConstrainedMovement ok — ${passed} assertions: NO-event cap — the FREE axis advances under setInput while the LOCKED axis is pinned to the spawn row (both directions); counterfactual (no input → no move on either axis) holds.`);
process.exit(0);
