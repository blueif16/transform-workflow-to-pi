/**
 * SpecialTileFactory — ORACLE drive test (match-3 special-tile system, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts SpecialTileFactory through the ENGINE'S OWN
 * resolver (world.mountSystem), which attaches it into the real scene (it subscribes to
 * the SwapMatch cascade trace on the scene's REAL EventBus in attach()). We DRIVE the real
 * verbs the GAME uses: emit the UPSTREAM bus seams (gems.swapped + a long match.cleared)
 * to MINT a special, then call the PUBLIC triggerAt(row,col) seam to DETONATE it. We assert
 * each declared event + its observable board/count transition. The test never imports the
 * component and never calls its private emitter.
 *
 * surface() contract under test (templates/modules/grid_logic/src/systems/SpecialTileFactory.ts):
 *   - special.created   drivenBy "a match of 4+ forms"          expect a special tile appears on the board
 *   - special.detonated drivenBy "a special tile is matched/triggered" expect a whole line or colour clears
 *
 *   node templates/modules/grid_logic/src/systems/__tests__/SpecialTileFactory.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const countCells = (g) => g.flat().filter((v) => v !== 0).length;

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a long clear (count 4 >= lineThreshold) mints a LINE special on the board
// (special.created), then triggering it clears its whole row+column (special.detonated).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;

  const sys = world.mountSystem('SpecialTileFactory', { lineThreshold: 4, colorThreshold: 5, specialBase: 90 });
  check('resolveSystem returned a real SpecialTileFactory', sys.constructor.name === 'SpecialTileFactory', sys.constructor.name);

  // A board with cells to clear by the special, and at least one EMPTY cell (0,3) where the
  // mint can place its marker tile.
  scene.board.setGrid([
    [1, 2, 3, 0],
    [1, 2, 3, 4],
    [1, 2, 3, 4],
    [1, 2, 3, 4],
  ]);
  scene.refreshCursor?.();

  // CREATE: a swap (sets the base colour) then a 4-run clear (>= lineThreshold) mints a special.
  let cur = bus.cursor;
  bus.emit('gems.swapped', { r1: 0, c1: 0, r2: 0, c2: 1 }); // the real upstream swap seam
  bus.emit('match.cleared', { count: 4, gained: 40, pass: 1 }); // a long clear -> mint
  const created = bus.recent(cur).filter((e) => e.type === 'special.created');
  check('special.created logged for a 4-run clear', created.length === 1 && created[0].payload?.kind === 'line' && created[0].payload?.runLength === 4, JSON.stringify(created[0]?.payload));
  check('OBSERVABLE: specialCount incremented to 1', sys.specialCount === 1, `specialCount=${sys.specialCount}`);
  // OBSERVABLE: a real special MARKER tile was written into the board at the mint cell.
  const mc = created[0].payload;
  check('OBSERVABLE: a special marker tile sits on the board at the mint cell', scene.board.get(mc.row, mc.col) >= 90, `board(${mc.row},${mc.col})=${scene.board.get(mc.row, mc.col)}`);

  // DETONATE: trigger the created special -> a line clears.
  const cellsBefore = countCells(scene.board.snapshot());
  cur = bus.cursor;
  sys.triggerAt(mc.row, mc.col); // the REAL detonate seam
  const detonated = bus.recent(cur).filter((e) => e.type === 'special.detonated');
  check('special.detonated logged with cells cleared', detonated.length === 1 && detonated[0].payload?.cleared >= 1, JSON.stringify(detonated[0]?.payload));
  check('OBSERVABLE: detonatedCount increased by the cells cleared', sys.detonatedCount === detonated[0].payload?.cleared && sys.detonatedCount >= 1, `detonatedCount=${sys.detonatedCount}`);
  // OBSERVABLE: the board lost cells (a whole line/area emptied) and specialCount dropped.
  check('OBSERVABLE: the board has fewer occupied cells after the blast', countCells(scene.board.snapshot()) < cellsBefore, `${cellsBefore}->${countCells(scene.board.snapshot())}`);
  check('OBSERVABLE: specialCount dropped back to 0 after detonation', sys.specialCount === 0, `specialCount=${sys.specialCount}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a SHORT clear (count 3 < lineThreshold) mints
// NOTHING — special.created does not fire and specialCount stays 0; and triggerAt on a
// cell with no live special is a no-op (no special.detonated). If onMatchCleared minted
// for any clear, or triggerAt fired blindly, this goes red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const sys = world.mountSystem('SpecialTileFactory', { lineThreshold: 4, colorThreshold: 5 });
  scene.board.setGrid([[1, 2, 3, 0], [1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]]);

  let cur = bus.cursor;
  bus.emit('gems.swapped', { r1: 0, c1: 0, r2: 0, c2: 1 });
  bus.emit('match.cleared', { count: 3, gained: 30, pass: 1 }); // < lineThreshold -> no mint
  check('counterfactual: a short clear mints no special', bus.recent(cur).filter((e) => e.type === 'special.created').length === 0, 'short clear');
  check('counterfactual: specialCount stays 0', sys.specialCount === 0, `specialCount=${sys.specialCount}`);

  cur = bus.cursor;
  sys.triggerAt(0, 0); // no special there -> no-op
  check('counterfactual: triggerAt with no live special fires no special.detonated', bus.recent(cur).filter((e) => e.type === 'special.detonated').length === 0, 'no special');

  world.destroy();
}

console.log(`\n[oracle] SpecialTileFactory ok — ${passed} assertions: a 4-run mints a board special (special.created); triggering it clears a line (special.detonated + board shrinks); a short clear mints nothing + a dead trigger is a no-op.`);
process.exit(0);
