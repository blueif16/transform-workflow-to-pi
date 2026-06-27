/**
 * DestructibleBunker — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/DestructibleBunker.ts):
 *   - bunker.damaged    drivenBy "a shot (player bullet or enemy bullet) hits a bunker cell"
 *                       expect   "that bunker cell is removed from scene.obstacles ⇒ __GAME__.entities
 *                                 obstacle count falls (the bunker erodes); bunker.damaged logged"
 *   - bunker.destroyed  drivenBy "a bunker's last cell is eroded"
 *                       expect   "the live bunkers-remaining count (scene.bunkersRemaining) decreases;
 *                                 bunker.destroyed logged"
 *
 * REAL drive through the REAL seam: the system OWNS its bunker cells (each a static obstacle in
 * scene.obstacles) and wires the player-bullet↔cell overlap in setupCollisions() — the SAME
 * overlap a fired ProjectilePool bullet triggers. We drive that exact verb: place a real player
 * bullet (in scene.playerBullets, the group ProjectilePool fills) ON a live cell and STEP — the
 * registered overlap fires erodeCell → that cell leaves scene.obstacles (the obstacle count
 * falls) and bunker.damaged logs. We use a 1x1-cell bunker so the FIRST hit is also the LAST,
 * driving bunker.destroyed + the bunkersRemaining drop in the same swing. A COUNTERFACTUAL places
 * a bullet far from any cell → nothing erodes, no events.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/DestructibleBunker.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** Live bunker cells in scene.obstacles (the obstacle-count signal __GAME__ surfaces). */
const liveCells = (scene) =>
  (scene.obstacles?.getChildren?.() ?? []).filter((c) => c?.active !== false && c.__bunkerCell).length;
/** Park a real player bullet ON (x,y) in the playerBullets group — the real overlap fixture. */
const bulletAt = (scene, x, y) => {
  const b = scene.physics.add.sprite(x, y, '__px');
  b.setDisplaySize(6, 16);
  b.body.setAllowGravity(false);
  b.__type = 'projectile';
  b.setActive(true);
  b.setVisible(true);
  scene.playerBullets.add(b);
  return b;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a player bullet hits the lone cell of a 1-cell bunker → damaged + destroyed.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;

  // One bunker of exactly ONE cell at a known point → the first hit is the last (destroy).
  const bunker = world.mountSystem('DestructibleBunker', {
    bunkers: [{ id: 'oracle_bunker', x: 216, y: 500 }],
    cols: 1,
    rows: 1,
    cellSize: 12,
    damagePerHit: 1,
  });
  check('resolveSystem returned a real DestructibleBunker', bunker.constructor.name === 'DestructibleBunker', bunker.constructor.name);
  check('attach published the scene.__destructibleBunker seam', scene.__destructibleBunker === bunker, `seam=${scene.__destructibleBunker?.constructor?.name}`);

  const cellsBefore = liveCells(scene);
  check('precondition: one bunker cell built + bunkersRemaining 1', bunker.cellsRemaining() === 1 && bunker.bunkersRemaining() === 1 && cellsBefore >= 1, `cells=${bunker.cellsRemaining()} bunkers=${bunker.bunkersRemaining()} live=${cellsBefore}`);

  // DRIVE: a real player bullet ON the lone cell; step → the overlap erodes it.
  let cur = bus.cursor;
  bulletAt(scene, 216, 500);
  world.step(3);
  const damaged = bus.recent(cur).filter((e) => e.type === 'bunker.damaged');
  const destroyed = bus.recent(cur).filter((e) => e.type === 'bunker.destroyed');
  check('DAMAGE: the struck cell left scene.obstacles (cellsRemaining 0)', bunker.cellsRemaining() === 0, `cells=${bunker.cellsRemaining()}`);
  check('DAMAGE: __GAME__.entities obstacle (cell) count fell', liveCells(scene) === cellsBefore - 1, `before=${cellsBefore} after=${liveCells(scene)}`);
  check('DAMAGE: bunker.damaged logged {bunkerId,remaining}', damaged.length === 1 && damaged.at(-1)?.payload?.bunkerId === 'oracle_bunker' && damaged.at(-1)?.payload?.remaining === 0, JSON.stringify(damaged.at(-1)?.payload));
  check('DESTROY: bunkersRemaining decreased to 0', bunker.bunkersRemaining() === 0 && scene.bunkersRemaining === 0, `bunkers=${bunker.bunkersRemaining()} mirror=${scene.bunkersRemaining}`);
  check('DESTROY: bunker.destroyed logged {bunkerId,remaining:0}', destroyed.length === 1 && destroyed.at(-1)?.payload?.bunkerId === 'oracle_bunker' && destroyed.at(-1)?.payload?.remaining === 0, JSON.stringify(destroyed.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a bullet placed FAR from any cell erodes
// nothing — the cell count is unchanged and no bunker.* fires. If erodeCell()/the
// emit were a no-op the DAMAGE assertions above would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const bunker = world.mountSystem('DestructibleBunker', { bunkers: [{ id: 'cf', x: 216, y: 500 }], cols: 1, rows: 1, cellSize: 12 });
  const cellsBefore = bunker.cellsRemaining();

  const cur = bus.cursor;
  bulletAt(scene, 40, 80); // nowhere near the cell at (216,500)
  world.step(3);
  const damaged = bus.recent(cur).filter((e) => e.type === 'bunker.damaged');
  const destroyed = bus.recent(cur).filter((e) => e.type === 'bunker.destroyed');
  check('counterfactual: far bullet → cell count unchanged', bunker.cellsRemaining() === cellsBefore, `before=${cellsBefore} after=${bunker.cellsRemaining()}`);
  check('counterfactual: no bunker.damaged/destroyed', damaged.length === 0 && destroyed.length === 0, `damaged=${damaged.length} destroyed=${destroyed.length}`);
  check('counterfactual: bunkersRemaining unchanged', bunker.bunkersRemaining() === 1, `bunkers=${bunker.bunkersRemaining()}`);

  world.destroy();
}

console.log(`\n[oracle] DestructibleBunker ok — ${passed} assertions: bunker.damaged (real player-bullet↔cell overlap erodes the cell → obstacle count falls) + bunker.destroyed (last cell → bunkersRemaining -1); counterfactual holds.`);
process.exit(0);
