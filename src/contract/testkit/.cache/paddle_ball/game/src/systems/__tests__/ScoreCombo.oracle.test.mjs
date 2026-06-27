/**
 * ScoreCombo — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * The Phase-3 EXEMPLAR for the 4 oracle-only 2D archetypes. Unlike the platformer
 * light-kit `*.drive.test.ts` (a hand-rolled arcade shell), this drives the REAL
 * paddle_ball engine booted headless by `bootHeadlessGame({archetype})` and mounts
 * the component through the ENGINE'S OWN resolver (`world.mountSystem`) — so the test
 * never imports the component; a failure here is the COMPONENT's fault, not a shell's.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/systems/ScoreCombo.ts):
 *   - combo.changed  drivenBy "clear bricks in quick succession (within the window) to raise
 *                              the multiplier, or return the ball to the paddle to reset it"
 *                    expect   "__GAME__ comboMultiplier changes (rises on a quick-succession
 *                              clear, resets to 1 on a paddle return / lapsed window);
 *                              combo.changed logged"
 *
 * REAL drive through the REAL seam: ScoreCombo subscribes to `brick.cleared` + `ball.bounced`
 * on the scene's real EventBus in attach(); we drive the verb by emitting those real gameplay
 * seams on the SAME bus (exactly as BrickGrid / BasePaddleScene would) and assert the declared
 * combo.changed event + its `comboMultiplier` registry transition. Both drivenBy branches
 * (quick-succession RISE, paddle-return RESET) are exercised, plus a COUNTERFACTUAL that goes
 * red on a no-op (a single clear must NOT raise the multiplier or log combo.changed).
 *
 *   node templates/modules/paddle_ball/src/systems/__tests__/ScoreCombo.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// BOTH drivenBy branches in one real boot: quick-succession RISE, then paddle RESET.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  // windowMs large so two back-to-back emits (same scene clock) count as "quick succession".
  const combo = world.mountSystem('ScoreCombo', { windowMs: 1200, maxMultiplier: 8, basePoints: 10 });
  check('resolveSystem returned a real ScoreCombo', combo.constructor.name === 'ScoreCombo', combo.constructor.name);
  check('precondition: comboMultiplier seeded to 1', scene.registry.get('comboMultiplier') === 1, `reg=${scene.registry.get('comboMultiplier')}`);

  // DRIVE (rise): two real brick.cleared emits within the window. The 1st starts the window
  // (stays ×1, no event); the 2nd bumps ×1→×2 — emitting combo.changed + writing the registry.
  let cur = bus.cursor;
  bus.emit('brick.cleared', { id: 'b1' });
  bus.emit('brick.cleared', { id: 'b2' });
  let rises = bus.recent(cur).filter((e) => e.type === 'combo.changed');
  check('RISE: comboMultiplier rose to 2 in the real registry', scene.registry.get('comboMultiplier') === 2, `reg=${scene.registry.get('comboMultiplier')}`);
  check('RISE: combo.changed logged on the real bus', rises.length >= 1, `count=${rises.length}`);
  check('RISE: combo.changed payload {multiplier:2}', rises.at(-1)?.payload?.multiplier === 2, JSON.stringify(rises.at(-1)?.payload));

  // DRIVE (reset): the ball returns to the PADDLE → the rally chain ends → multiplier resets to 1.
  cur = bus.cursor;
  bus.emit('ball.bounced', { off: 'paddle' });
  let resets = bus.recent(cur).filter((e) => e.type === 'combo.changed');
  check('RESET: paddle return drops comboMultiplier to 1', scene.registry.get('comboMultiplier') === 1, `reg=${scene.registry.get('comboMultiplier')}`);
  check('RESET: combo.changed {multiplier:1} logged', resets.some((e) => e.payload?.multiplier === 1), JSON.stringify(resets.map((e) => e.payload)));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a SINGLE brick.cleared is NOT quick
// succession — the multiplier must stay at 1 and combo.changed must NOT fire. If
// onBrickCleared()/setMultiplier()'s emit were a no-op, the RISE assertions above
// would already be red; this proves they are not vacuously always-true.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  world.mountSystem('ScoreCombo', { windowMs: 1200 });

  const cur = bus.cursor;
  bus.emit('brick.cleared', { id: 'only' }); // one clear → starts a window, no rise
  const fired = bus.recent(cur).filter((e) => e.type === 'combo.changed');
  check('counterfactual: single clear → comboMultiplier stays 1', scene.registry.get('comboMultiplier') === 1, `reg=${scene.registry.get('comboMultiplier')}`);
  check('counterfactual: single clear → no combo.changed logged', fired.length === 0, `count=${fired.length}`);

  world.destroy();
}

console.log(`\n[oracle] ScoreCombo ok — ${passed} assertions: combo.changed RISE (×1→×2 on quick-succession clear) + RESET (×→1 on paddle return) on real comboMultiplier; counterfactual holds.`);
process.exit(0);
