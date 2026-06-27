/**
 * ComboMultiplier — ORACLE drive test (match-3 cascade multiplier system, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts ComboMultiplier through the ENGINE'S OWN
 * resolver (world.mountSystem), which attaches it into the real scene (it subscribes to
 * the SwapMatch cascade trace on the scene's REAL EventBus in attach()). We DRIVE the
 * real verb by emitting the UPSTREAM bus seams the bound rule fires — match.cleared (per
 * cascade pass) and cascade.resolved — on the SAME scene bus (exactly as SwapMatch does),
 * and assert each declared event + its observable comboMultiplier transition. The test
 * never imports the component and never calls its private emitter.
 *
 * surface() contract under test (templates/modules/grid_logic/src/systems/ComboMultiplier.ts):
 *   - combo.increased drivenBy "a cascade chains another clear"          expect comboMultiplier > 1
 *   - combo.reset     drivenBy "the cascade settles with no further match" expect comboMultiplier === 1
 *
 *   node templates/modules/grid_logic/src/systems/__tests__/ComboMultiplier.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: emit the real cascade trace — pass-1 clear (the swap, no combo), then a pass-2
// clear (a cascade chaining another clear) -> the multiplier RISES (combo.increased);
// then cascade.resolved -> the multiplier RESETS (combo.reset).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;

  const sys = world.mountSystem('ComboMultiplier', { step: 0.5, maxMultiplier: 8 });
  check('resolveSystem returned a real ComboMultiplier', sys.constructor.name === 'ComboMultiplier', sys.constructor.name);
  check('precondition: comboMultiplier seeded to 1', sys.comboMultiplier === 1, `mult=${sys.comboMultiplier}`);

  // RISE: pass 1 is the swap itself (multiplier stays 1, no event); pass 2 chains a clear ->
  // multiplier steps to 1 + 1*0.5 = 1.5 and combo.increased fires.
  let cur = bus.cursor;
  bus.emit('match.cleared', { count: 3, gained: 30, pass: 1 }); // the swap clear (no combo)
  check('after the pass-1 clear: multiplier stays 1', sys.comboMultiplier === 1, `mult=${sys.comboMultiplier}`);
  check('after the pass-1 clear: no combo.increased', bus.recent(cur).filter((e) => e.type === 'combo.increased').length === 0, 'pass1');

  cur = bus.cursor;
  bus.emit('match.cleared', { count: 3, gained: 30, pass: 2 }); // a cascade chains another clear
  const rose = bus.recent(cur).filter((e) => e.type === 'combo.increased');
  check('RISE: combo.increased logged', rose.length === 1, `count=${rose.length}`);
  check('RISE: OBSERVABLE comboMultiplier rose above 1', sys.comboMultiplier > 1 && Math.abs(sys.comboMultiplier - 1.5) < 1e-9, `mult=${sys.comboMultiplier}`);
  check('RISE: combo.increased payload {multiplier:1.5, depth:2}', rose[0].payload?.multiplier === sys.comboMultiplier && rose[0].payload?.depth === 2, JSON.stringify(rose[0]?.payload));

  // RESET: the board settles (no further match) -> the multiplier drops back to 1.
  cur = bus.cursor;
  bus.emit('cascade.resolved', { passes: 2, cleared: 6, scoreDelta: 60 });
  const reset = bus.recent(cur).filter((e) => e.type === 'combo.reset');
  check('RESET: combo.reset logged', reset.length === 1 && reset[0].payload?.multiplier === 1, JSON.stringify(reset[0]?.payload));
  check('RESET: OBSERVABLE comboMultiplier back to 1', sys.comboMultiplier === 1, `mult=${sys.comboMultiplier}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a SINGLE pass-1 clear (a swap with no cascade)
// followed by cascade.resolved never raises the multiplier — combo.increased never
// fires and combo.reset does NOT fire (the multiplier was already 1). If onClear stepped
// the multiplier on the first clear this goes red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const sys = world.mountSystem('ComboMultiplier', { step: 0.5 });

  const cur = bus.cursor;
  bus.emit('match.cleared', { count: 3, gained: 30, pass: 1 }); // one clear, no cascade
  bus.emit('cascade.resolved', { passes: 1, cleared: 3, scoreDelta: 30 });
  const rose = bus.recent(cur).filter((e) => e.type === 'combo.increased');
  const reset = bus.recent(cur).filter((e) => e.type === 'combo.reset');
  check('counterfactual: a single clear never raises the multiplier', sys.comboMultiplier === 1, `mult=${sys.comboMultiplier}`);
  check('counterfactual: no combo.increased fired', rose.length === 0, `count=${rose.length}`);
  check('counterfactual: no combo.reset fired (multiplier was already 1)', reset.length === 0, `count=${reset.length}`);

  world.destroy();
}

console.log(`\n[oracle] ComboMultiplier ok — ${passed} assertions: a chained cascade clear raises comboMultiplier (combo.increased), settling resets it (combo.reset); a single swap clear never raises it.`);
process.exit(0);
