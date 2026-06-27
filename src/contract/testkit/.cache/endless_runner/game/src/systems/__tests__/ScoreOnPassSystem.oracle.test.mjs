/**
 * ScoreOnPassSystem — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/systems/ScoreOnPassSystem.ts):
 *   - score.changed  drivenBy "the avatar passing an obstacle pair trailing edge"
 *                    expect   "__GAME__.score increases by exactly one per passed obstacle
 *                              (never double-counts); score.changed logged"
 *
 * REAL drive through the REAL seam: ScoreOnPassSystem reads the live obstacle pairs the scroller
 * publishes on scene.obstaclePairs (the single source of truth) and scores each pass exactly once
 * via a per-pair `scored` latch. We clear the level's DEFAULT systems first (so the default
 * scroller does not overwrite our fixture), then PLACE a real obstacle-pair fixture on
 * scene.obstaclePairs whose trailing edge is LEFT of the avatar's x — exactly the pass geometry
 * the scroller produces — and STEP the engine. The OBSERVABLE transition is __GAME__.score +1 +
 * score.changed logged. Stepping again proves the score-once latch (no double-count). A
 * COUNTERFACTUAL places a pair AHEAD of the avatar (not yet passed) → no score, no event.
 *
 *   node templates/modules/endless_runner/src/systems/__tests__/ScoreOnPassSystem.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** A pass-geometry fixture pair: trailing edge = top.x + displayWidth/2. */
const pair = (id, topX, displayWidth = 40) => ({ id, top: { x: topX, displayWidth }, scored: false });

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: an obstacle pair whose trailing edge is past the avatar → score +1, once.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = []; // silence the default scroller so it can't overwrite our obstaclePairs fixture.

  const sys = world.mountSystem('ScoreOnPassSystem', { valuePerPass: 1 });
  check('resolveSystem returned a real ScoreOnPassSystem', sys.constructor.name === 'ScoreOnPassSystem', sys.constructor.name);

  const avatarX = scene.player.x;
  const scoreBefore = Number(scene.registry.get('score') ?? 0);
  // Fixture: a pair whose trailing edge (topX + 20) is LEFT of the avatar → already passed.
  scene.obstaclePairs = [pair('obstacle_0', avatarX - 100)];

  let cur = bus.cursor;
  world.step(1);
  const changes = bus.recent(cur).filter((e) => e.type === 'score.changed');
  check('PASS: __GAME__.score increased by exactly one', Number(scene.registry.get('score')) === scoreBefore + 1, `${scoreBefore}→${scene.registry.get('score')}`);
  check('PASS: score.changed logged on the real bus', changes.length === 1, `count=${changes.length}`);
  check('PASS: score.changed payload {score}', changes.at(-1)?.payload?.score === scoreBefore + 1, JSON.stringify(changes.at(-1)?.payload));

  // SCORE-ONCE: stepping again does NOT re-score the same pair (the per-pair latch).
  cur = bus.cursor;
  world.step(2);
  const again = bus.recent(cur).filter((e) => e.type === 'score.changed');
  check('SCORE-ONCE: the same pair never double-counts', again.length === 0 && Number(scene.registry.get('score')) === scoreBefore + 1, `extra=${again.length} score=${scene.registry.get('score')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a pair AHEAD of the avatar (trailing edge
// RIGHT of avatar.x — not yet threaded) scores nothing and fires no score.changed.
// If the pass test / emit were vacuous the PASS assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];
  world.mountSystem('ScoreOnPassSystem', { valuePerPass: 1 });

  const avatarX = scene.player.x;
  const scoreBefore = Number(scene.registry.get('score') ?? 0);
  scene.obstaclePairs = [pair('obstacle_ahead', avatarX + 100)]; // ahead → not passed yet

  const cur = bus.cursor;
  world.step(3);
  const changes = bus.recent(cur).filter((e) => e.type === 'score.changed');
  check('counterfactual: an un-passed pair → score unchanged', Number(scene.registry.get('score')) === scoreBefore, `score=${scene.registry.get('score')}`);
  check('counterfactual: an un-passed pair → no score.changed', changes.length === 0, `count=${changes.length}`);

  world.destroy();
}

console.log(`\n[oracle] ScoreOnPassSystem ok — ${passed} assertions: score.changed (a passed obstacle pair raises __GAME__.score by exactly one) + the score-once latch (no double-count); counterfactual (an un-passed pair → no score, no event) holds.`);
process.exit(0);
