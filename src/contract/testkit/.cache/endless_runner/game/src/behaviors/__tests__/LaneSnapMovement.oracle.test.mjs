/**
 * LaneSnapMovement — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the behavior through
 * the ENGINE'S OWN resolver (world.mountBehavior) onto a REAL arcade owner — the test never
 * imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/behaviors/LaneSnapMovement.ts):
 *   - lane.changed  drivenBy "a press to an adjacent lane"
 *                   expect   "__GAME__.player.x eases toward the new lane centre (the avatar
 *                             snaps to the new lane index); lane.changed logged"
 *
 * REAL drive through the REAL seam: LaneSnapMovement.moveLeft()/moveRight() are the lateral
 * verbs the control scheme calls on a real keydown/swipe; the harness's per-frame behavior
 * tick runs update() each step exactly as the runner scene drives the avatar. We mount onto a
 * fresh real owner with explicit lane centres, call the real moveLeft() verb, and assert the
 * lane index moved (lane.changed{lane}) + the owner's x eases toward the new lane centre. An
 * EDGE COUNTERFACTUAL: a moveLeft() while already in the leftmost lane moves the index NOWHERE
 * (clamped, no wrap) → lane.changed does NOT fire.
 *
 *   node templates/modules/endless_runner/src/behaviors/__tests__/LaneSnapMovement.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

const LANES = [108, 216, 324]; // left, centre, right

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a real moveLeft() from the centre lane → lane.changed{lane:0} + x eases left.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { bus } = world;

  const owner = world.spawnEnemy({ x: LANES[1], y: 300 });
  const beh = world.mountBehavior('LaneSnapMovement', { lanes: LANES, startLane: 1, snapSpeed: 900 }, owner);
  check('resolveBehavior returned a real LaneSnapMovement', beh.constructor.name === 'LaneSnapMovement', beh.constructor.name);
  check('precondition: avatar starts in the centre lane x', Math.round(owner.x) === LANES[1], `x=${owner.x}`);

  // DRIVE (snap left): the next update() decrements the lane index and begins easing x.
  const cur = bus.cursor;
  beh.moveLeft();
  world.step(1);
  const laneEvents = bus.recent(cur).filter((e) => e.type === 'lane.changed');
  check('SNAP: lane.changed logged on the real bus', laneEvents.length === 1, `count=${laneEvents.length}`);
  check('SNAP: lane.changed payload {lane:0} (moved to the adjacent left lane)', laneEvents.at(-1)?.payload?.lane === 0, JSON.stringify(laneEvents.at(-1)?.payload));
  check('SNAP: owner.x began easing LEFT toward the new lane centre', owner.x < LANES[1], `x=${owner.x}`);

  // Step until settled: x reaches the left lane centre exactly (the clean snap).
  world.step(30);
  check('SETTLE: owner.x snapped cleanly to the left lane centre', Math.round(owner.x) === LANES[0], `x=${owner.x}`);
  check('SETTLE: runnerState exposes the grounded state', owner.runnerState === 'grounded', `state=${owner.runnerState}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a moveLeft() while ALREADY in the leftmost
// lane is clamped (no wrap) — the index does not move, x does not change, and
// lane.changed never fires. If moveLeft()/emitLaneChanged() ignored the clamp the
// SNAP assertions would over-fire; this proves lane.changed fires only on a real move.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { bus } = world;
  const owner = world.spawnEnemy({ x: LANES[0], y: 300 });
  const beh = world.mountBehavior('LaneSnapMovement', { lanes: LANES, startLane: 0, snapSpeed: 900 }, owner);

  const xBefore = owner.x;
  const cur = bus.cursor;
  beh.moveLeft(); // already at lane 0 → clamped, no move
  world.step(2);
  const laneEvents = bus.recent(cur).filter((e) => e.type === 'lane.changed');
  check('counterfactual: moveLeft at the left edge → no lane.changed (clamped, no wrap)', laneEvents.length === 0, `count=${laneEvents.length}`);
  check('counterfactual: owner.x unchanged at the edge lane', Math.round(owner.x) === Math.round(xBefore), `${xBefore}→${owner.x}`);

  world.destroy();
}

console.log(`\n[oracle] LaneSnapMovement ok — ${passed} assertions: lane.changed (a real moveLeft() moves the lane index and eases __GAME__.player.x to the new lane centre); counterfactual (move at the edge → clamped, no move, no event) holds.`);
process.exit(0);
