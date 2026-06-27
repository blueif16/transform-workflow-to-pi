/**
 * TurnDuel — ORACLE drive test (alternating-turn duel system, grid_logic).
 * ============================================================================
 *
 * Boots the REAL grid_logic engine and mounts TurnDuel through the ENGINE'S OWN resolver
 * (world.mountSystem), which attaches it into the real scene (wiring the scene's REAL
 * EventBus + board geometry + win seam). We DRIVE the real verb — the PUBLIC placeAt(row,
 * col,side) seam (the exact method the scene's pointerdown handler calls) — and assert
 * each declared event + its observable board/status transition. The test never imports
 * the component.
 *
 * surface() contract under test (templates/modules/grid_logic/src/systems/TurnDuel.ts):
 *   - mark.placed drivenBy "a player marks an empty cell"  expect __GAME__ board shows the mark + the turn flips
 *   - line.won    drivenBy "an N-in-a-row forms"           expect __GAME__.status becomes 'won' with the winner
 *
 *   node templates/modules/grid_logic/src/systems/__tests__/TurnDuel.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

const MARK_HUMAN = 1;

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 1 (mark.placed): a human marks an empty cell -> the mark is written to the board
// and the turn flips. (Default humanFirst; the AI replies, so two mark.placed land.)
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;

  const sys = world.mountSystem('TurnDuel', { winLength: 3, humanFirst: true, aiDepth: 1 });
  check('resolveSystem returned a real TurnDuel', sys.constructor.name === 'TurnDuel', sys.constructor.name);

  // Empty board so the placement + the AI reply are unambiguous.
  scene.board.setGrid([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  sys.placeAt(0, 0, MARK_HUMAN); // the REAL placement seam

  const placed = bus.recent(cur).filter((e) => e.type === 'mark.placed');
  // The human places, then the AI replies -> 2 mark.placed events.
  check('mark.placed logged for the human placement', placed.length >= 1 && placed[0].payload?.side === MARK_HUMAN && placed[0].payload?.row === 0 && placed[0].payload?.col === 0, JSON.stringify(placed[0]?.payload));
  check('mark.placed payload flips the turn (next != side)', placed[0].payload?.next !== placed[0].payload?.side, JSON.stringify(placed[0]?.payload));
  // OBSERVABLE: the human mark is written into the live board.
  check('OBSERVABLE: the human mark sits at (0,0) on the real board', scene.board.get(0, 0) === MARK_HUMAN, `board(0,0)=${scene.board.get(0, 0)}`);
  // OBSERVABLE: the AI replied (a second mark landed on a different cell).
  check('OBSERVABLE: the AI replied — a second mark.placed landed', placed.length === 2 && placed[1].payload?.side !== MARK_HUMAN, JSON.stringify(placed[1]?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 2 (line.won): a human mark that completes a 3-in-a-row wins -> line.won + status->'won'.
// Pre-place two human marks in a row, then drive the third (the AI cannot pre-empt it).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const sys = world.mountSystem('TurnDuel', { winLength: 3, humanFirst: true, aiDepth: 1 });

  // Two human marks already at (0,0),(0,1); the winning cell (0,2) is empty. It is the
  // human's turn (humanFirst). Driving placeAt(0,2,human) completes the top row.
  scene.board.setGrid([
    [MARK_HUMAN, MARK_HUMAN, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  sys.placeAt(0, 2, MARK_HUMAN); // completes the 3-in-a-row

  const placed = bus.recent(cur).filter((e) => e.type === 'mark.placed');
  const won = bus.recent(cur).filter((e) => e.type === 'line.won');
  check('mark.placed logged for the winning mark', placed.some((e) => e.payload?.row === 0 && e.payload?.col === 2), JSON.stringify(placed.map((e) => e.payload)));
  check('line.won logged with the human winner', won.length === 1 && won[0].payload?.winner === 'human' && won[0].payload?.side === MARK_HUMAN, JSON.stringify(won[0]?.payload));
  // OBSERVABLE: __GAME__.status flipped to 'won'.
  check('OBSERVABLE: __GAME__.status became "won"', scene.registry.get('status') === 'won' && world.snapshot().status === 'won', `status=${scene.registry.get('status')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a placement on an OCCUPIED cell (or wrong turn)
// is a no-op — no mark.placed, no board change. If placeAt wrote/emitted without the
// empty-cell + turn guards this goes red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'grid_logic' });
  const { scene, bus } = world;
  const sys = world.mountSystem('TurnDuel', { winLength: 3, humanFirst: true, aiDepth: 1 });

  // (0,0) is already occupied by an AI mark; the cell is not empty -> placeAt is a no-op.
  scene.board.setGrid([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  scene.refreshCursor?.();

  const cur = bus.cursor;
  sys.placeAt(0, 0, MARK_HUMAN); // occupied cell -> rejected
  const placed = bus.recent(cur).filter((e) => e.type === 'mark.placed');
  check('counterfactual: a placement on an occupied cell fires no mark.placed', placed.length === 0, `count=${placed.length}`);
  check('counterfactual: the occupied cell is unchanged', scene.board.get(0, 0) === 2, `board(0,0)=${scene.board.get(0, 0)}`);

  world.destroy();
}

console.log(`\n[oracle] TurnDuel ok — ${passed} assertions: a human mark writes the board + flips the turn (mark.placed, AI replies); completing a line wins (line.won + status "won"); an occupied-cell placement is a silent no-op.`);
process.exit(0);
