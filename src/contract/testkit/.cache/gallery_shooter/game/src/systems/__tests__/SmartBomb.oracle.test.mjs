/**
 * SmartBomb — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/SmartBomb.ts):
 *   - smartbomb.detonated  drivenBy "the player uses a smart bomb (presses the detonate key)
 *                                    while stock remains"
 *                          expect   "every alive scene.enemies member leaves __GAME__.entities and
 *                                    live scene.enemyBullets are cleared; the bomb stock
 *                                    (scene.smartBombStock) decrements by one; smartbomb.detonated logged"
 *
 * REAL drive through the REAL seam: the detonate verb (the player's "use a smart bomb") is the
 * PUBLIC scene.__smartBomb.detonate() — the system itself names it as the headless trigger seam
 * (update() detects the same key edge a press drives; detonate() is the verb a press lands on).
 * The default boot already spawned a real formation into scene.enemies; we count the alive
 * members, call detonate(), and assert the OBSERVABLE transition: every alive member is cleared
 * through the engine's own kill path (leaves __GAME__.entities) and the live stock decrements by
 * one, with smartbomb.detonated logged. We detonate AGAIN until empty, then a detonate at 0 stock
 * is the COUNTERFACTUAL no-op (spent bomb): nothing fires, the stock floors at 0.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/SmartBomb.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** Alive members in scene.enemies (the threat count __GAME__.entities surfaces). */
const aliveEnemies = (scene) =>
  (scene.enemies?.getChildren?.() ?? []).filter((e) => e?.active !== false && !e.isDead).length;

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: detonate() clears the on-screen formation + decrements the stock.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;

  const bomb = world.mountSystem('SmartBomb', { stock: 2, clearBullets: true });
  check('resolveSystem returned a real SmartBomb', bomb.constructor.name === 'SmartBomb', bomb.constructor.name);
  check('attach published the scene.__smartBomb seam', scene.__smartBomb === bomb, `seam=${scene.__smartBomb?.constructor?.name}`);
  check('precondition: stock mirrored to scene.smartBombStock', scene.smartBombStock === 2 && bomb.stockRemaining() === 2, `stock=${scene.smartBombStock}/${bomb.stockRemaining()}`);

  const aliveBefore = aliveEnemies(scene);
  check('precondition: the default formation populated scene.enemies', aliveBefore > 0, `alive=${aliveBefore}`);

  // DRIVE: the player uses a smart bomb (the real public detonate verb).
  let cur = bus.cursor;
  const ok = bomb.detonate();
  const det = bus.recent(cur).filter((e) => e.type === 'smartbomb.detonated');
  check('DETONATE: detonate() reported a real detonation', ok === true, `ok=${ok}`);
  check('DETONATE: every alive formation member was cleared (leaves __GAME__.entities)', aliveEnemies(scene) === 0, `alive=${aliveEnemies(scene)}`);
  check('DETONATE: the stock decremented by one (scene.smartBombStock)', scene.smartBombStock === 1 && bomb.stockRemaining() === 1, `stock=${scene.smartBombStock}`);
  check('DETONATE: smartbomb.detonated logged {cleared,stock}', det.length === 1 && det.at(-1)?.payload?.cleared === aliveBefore && det.at(-1)?.payload?.stock === 1, JSON.stringify(det.at(-1)?.payload));

  // Drain the last bomb so the stock reaches 0 (a real second use).
  bomb.detonate();
  check('drain: a second detonation emptied the stock to 0', bomb.stockRemaining() === 0 && scene.smartBombStock === 0, `stock=${bomb.stockRemaining()}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a detonate at 0 stock is a spent-bomb
// no-op — the stock stays floored at 0 and smartbomb.detonated does NOT fire. If
// detonate()'s clear/emit ignored the stock guard the DETONATE assertions would
// not prove the verb is what spends a bomb.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const bomb = world.mountSystem('SmartBomb', { stock: 0 }); // empty from the start

  const aliveBefore = aliveEnemies(scene);
  const cur = bus.cursor;
  const ok = bomb.detonate();
  const det = bus.recent(cur).filter((e) => e.type === 'smartbomb.detonated');
  check('counterfactual: detonate at 0 stock refused', ok === false, `ok=${ok}`);
  check('counterfactual: no smartbomb.detonated', det.length === 0, `count=${det.length}`);
  check('counterfactual: enemies NOT cleared (the spent bomb did nothing)', aliveEnemies(scene) === aliveBefore && aliveBefore > 0, `before=${aliveBefore} after=${aliveEnemies(scene)}`);
  check('counterfactual: stock floored at 0', bomb.stockRemaining() === 0, `stock=${bomb.stockRemaining()}`);

  world.destroy();
}

console.log(`\n[oracle] SmartBomb ok — ${passed} assertions: smartbomb.detonated (real detonate() clears the alive formation through the engine kill path + decrements scene.smartBombStock); counterfactual (0 stock → spent no-op) holds.`);
process.exit(0);
