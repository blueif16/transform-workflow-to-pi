/**
 * MineReveal — ORACLE drive test (Minesweeper deduction system, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts MineReveal through the ENGINE'S OWN
 * resolver (world.mountSystem), which attaches it into the real scene (wiring the scene's
 * REAL EventBus + board geometry). We DRIVE the real player verbs — the PUBLIC seams
 * revealAt(row,col) / toggleFlagAt(row,col) (the exact methods the scene's pointerdown
 * handler calls) — and assert each declared event + its observable count transition. The
 * mine layout is made DETERMINISTIC by stubbing Math.random during placement. The test
 * never imports the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/systems/MineReveal.ts):
 *   - cell.revealed drivenBy "player reveals a safe cell" expect revealed count increases (flood-fill expands)
 *   - mine.flagged  drivenBy "player flags a cell"        expect flag count toggles
 *
 *   node templates/modules/grid_logic/src/systems/__tests__/MineReveal.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 1 (reveal): a first-click-safe reveal opens a safe pocket -> cell.revealed +
// revealedCount increases.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;

  const sys = world.mountSystem('MineReveal', { mineCount: 1, rows: 4, cols: 4 });
  check('resolveSystem returned a real MineReveal', sys.constructor.name === 'MineReveal', sys.constructor.name);
  check('precondition: revealedCount starts at 0', sys.revealedCount === 0, `revealedCount=${sys.revealedCount}`);

  const orig = Math.random;
  Math.random = () => 0; // deterministic first-click-safe placement (mine lands away from (0,0))
  const cur = bus.cursor;
  sys.revealAt(0, 0); // the REAL reveal seam — lays the field, then flood-fills
  Math.random = orig;

  const revealed = bus.recent(cur).filter((e) => e.type === 'cell.revealed');
  check('cell.revealed logged', revealed.length === 1, `count=${revealed.length}`);
  check('cell.revealed: opened >= 1 + not a mine (first-click-safe)', revealed[0].payload?.opened >= 1 && revealed[0].payload?.mine === false, JSON.stringify(revealed[0]?.payload));
  // OBSERVABLE: revealedCount jumped (the flood-fill expanded the safe region).
  check('OBSERVABLE: revealedCount increased from 0', sys.revealedCount >= 1 && sys.revealedCount === revealed[0].payload?.opened, `revealedCount=${sys.revealedCount}`);
  check('OBSERVABLE: the run is not lost (a safe first click)', scene.registry.get('status') !== 'lost', `status=${scene.registry.get('status')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 2 (flag): toggling a flag on a hidden cell -> mine.flagged + flagCount toggles.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const sys = world.mountSystem('MineReveal', { mineCount: 1, rows: 4, cols: 4 });

  const orig = Math.random;
  Math.random = () => 0;
  sys.revealAt(0, 0); // lay the field; with Math.random=0 the single mine is at (0,3)
  Math.random = orig;

  // Flag ON the still-hidden cell (0,3).
  let cur = bus.cursor;
  sys.toggleFlagAt(0, 3); // the REAL flag seam
  const flagOn = bus.recent(cur).filter((e) => e.type === 'mine.flagged');
  check('mine.flagged logged on flag', flagOn.length === 1 && flagOn[0].payload?.flagged === true, JSON.stringify(flagOn[0]?.payload));
  check('OBSERVABLE: flagCount toggled up to 1', sys.flagCount === 1, `flagCount=${sys.flagCount}`);

  // Flag OFF (un-flag the same cell) -> the count toggles back down.
  cur = bus.cursor;
  sys.toggleFlagAt(0, 3);
  const flagOff = bus.recent(cur).filter((e) => e.type === 'mine.flagged');
  check('mine.flagged logged on unflag (flagged:false)', flagOff.length === 1 && flagOff[0].payload?.flagged === false, JSON.stringify(flagOff[0]?.payload));
  check('OBSERVABLE: flagCount toggled back down to 0', sys.flagCount === 0, `flagCount=${sys.flagCount}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO reveal/flag driven, neither event fires
// and both counts stay 0. If revealAt/toggleFlagAt emitted on construction this goes red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const sys = world.mountSystem('MineReveal', { mineCount: 1, rows: 4, cols: 4 });

  const cur = bus.cursor;
  // drive nothing
  const fired = bus.recent(cur).filter((e) => e.type === 'cell.revealed' || e.type === 'mine.flagged');
  check('counterfactual: no reveal/flag -> neither event fires', fired.length === 0, `count=${fired.length}`);
  check('counterfactual: revealedCount + flagCount stay 0', sys.revealedCount === 0 && sys.flagCount === 0, `revealed=${sys.revealedCount} flag=${sys.flagCount}`);

  world.destroy();
}

console.log(`\n[oracle] MineReveal ok — ${passed} assertions: a safe reveal opens cells (cell.revealed + revealedCount up); a flag toggles the count both ways (mine.flagged); no input -> no events.`);
process.exit(0);
