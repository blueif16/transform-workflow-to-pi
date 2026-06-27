/**
 * BulletHellEmitter — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/BulletHellEmitter.ts):
 *   - pattern.emitted  drivenBy "an emitter fires a pattern (the curtain cadence elapsing)"
 *                      expect   "one or more enemy bullets enter scene.enemyBullets ⇒ __GAME__ active
 *                                enemy-bullet count increases; pattern.emitted logged"
 *   - graze.scored     drivenBy "the player grazes a bullet without being hit (inside the graze ring,
 *                                outside the hit ring)"
 *                      expect   "__GAME__.score increases by grazePoints (the graze count rises) with
 *                                NO player damage; graze.scored logged"
 *
 * REAL drive through the REAL seams:
 *   - EMITTED: the curtain cadence elapsing — even with no formation a fixed top turret fires; step
 *     until the cadence emits a dense radial pattern into scene.enemyBullets (the active count rises).
 *   - GRAZE: the per-frame near-miss test — position a real live enemy bullet at GRAZE distance from
 *     the player (inside grazeRadius, outside hitRadius, and clear of the player's body so the hit
 *     overlap never fires) and STEP ONE frame; scoreGrazes() awards grazePoints (the real
 *     utils.addScore seam raises __GAME__.score) with no damage, and graze.scored logs.
 * A COUNTERFACTUAL keeps every bullet OUTSIDE the graze ring → no graze, score unchanged.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/BulletHellEmitter.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** Park a real LIVE enemy bullet at (x,y) in scene.enemyBullets — the real graze fixture. */
const enemyBulletAt = (scene, x, y) => {
  const b = scene.physics.add.sprite(x, y, '__px');
  b.setDisplaySize(8, 8);
  b.body.setAllowGravity(false);
  b.setVelocity(0, 0);
  b.__type = 'projectile';
  b.__kind = 'enemyBullet';
  b.__grazed = false;
  b.setActive(true);
  b.setVisible(true);
  scene.enemyBullets.add(b);
  return b;
};

// ════════════════════════════════════════════════════════════════════════════
// EMITTED: the curtain cadence fires a dense pattern (pattern.emitted).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const hell = world.mountSystem('BulletHellEmitter', { fireEveryMs: 15, pattern: 'radial', bulletsPerRing: 6, enemyBulletCap: 96 });
  check('resolveSystem returned a real BulletHellEmitter', hell.constructor.name === 'BulletHellEmitter', hell.constructor.name);
  check('attach published the scene.__bulletHellEmitter seam + enemyBullets group', scene.__bulletHellEmitter === hell && !!scene.enemyBullets, `seam=${scene.__bulletHellEmitter?.constructor?.name}`);
  check('precondition: no enemy bullets yet', hell.enemyBulletCount() === 0, `bullets=${hell.enemyBulletCount()}`);

  const cur = bus.cursor;
  // DRIVE: step until the curtain cadence elapses → a radial ring enters scene.enemyBullets.
  for (let f = 0; f < 4 && bus.recent(cur).filter((e) => e.type === 'pattern.emitted').length === 0; f++) world.step(1);
  const emitted = bus.recent(cur).filter((e) => e.type === 'pattern.emitted');
  check('EMITTED: the active enemy-bullet count rose (a ring entered scene.enemyBullets)', hell.enemyBulletCount() >= 1, `bullets=${hell.enemyBulletCount()}`);
  check('EMITTED: pattern.emitted logged {pattern:radial,count}', emitted.length >= 1 && emitted.at(-1)?.payload?.pattern === 'radial' && emitted.at(-1)?.payload?.count >= 1, JSON.stringify(emitted.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// GRAZE: a near-miss raises the score without a hit (graze.scored).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  // Don't auto-fire a curtain (avoid other bullets); grazeRadius 28, hitRadius 12.
  const hell = world.mountSystem('BulletHellEmitter', { fireEveryMs: 999999, grazeRadius: 28, hitRadius: 12, grazePoints: 5 });

  const scoreBefore = Number(scene.registry.get('score') ?? 0);
  const grazesBefore = hell.grazes();
  const healthBefore = scene.player.health ?? scene.player.maxHealth ?? 999;

  // DRIVE: a real enemy bullet at GRAZE distance (20px BELOW the player center) — inside the graze
  // ring (28), outside the hit ring (12), and clear of the player body so the hit overlap never fires.
  let cur = bus.cursor;
  const bullet = enemyBulletAt(scene, scene.player.x, scene.player.y + 20);
  world.step(1);
  const grazed = bus.recent(cur).filter((e) => e.type === 'graze.scored');
  check('GRAZE: __GAME__.score rose by grazePoints (5)', Number(scene.registry.get('score')) === scoreBefore + 5, `${scoreBefore} → ${scene.registry.get('score')}`);
  check('GRAZE: the live graze count rose by one', hell.grazes() === grazesBefore + 1, `${grazesBefore} → ${hell.grazes()}`);
  check('GRAZE: NO player damage (a graze is a near-miss, not a hit)', (scene.player.health ?? scene.player.maxHealth ?? 999) === healthBefore, `health=${scene.player.health}`);
  check('GRAZE: graze.scored logged {points:5,grazes}', grazed.length === 1 && grazed.at(-1)?.payload?.points === 5 && grazed.at(-1)?.payload?.grazes === hell.grazes(), JSON.stringify(grazed.at(-1)?.payload));
  check('GRAZE: the bullet latched __grazed (one graze per bullet)', bullet.__grazed === true, `grazed=${bullet.__grazed}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a bullet kept OUTSIDE the graze ring is no
// near-miss — the score does NOT rise and graze.scored never fires. If scoreGrazes()
// awarded any nearby bullet the GRAZE assertions would not prove the ring geometry.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const hell = world.mountSystem('BulletHellEmitter', { fireEveryMs: 999999, grazeRadius: 28, hitRadius: 12, grazePoints: 5 });
  const scoreBefore = Number(scene.registry.get('score') ?? 0);

  const cur = bus.cursor;
  enemyBulletAt(scene, scene.player.x, scene.player.y + 200); // far OUTSIDE the 28px graze ring
  world.step(2);
  const grazed = bus.recent(cur).filter((e) => e.type === 'graze.scored');
  check('counterfactual: bullet outside the graze ring → score unchanged', Number(scene.registry.get('score')) === scoreBefore, `score=${scene.registry.get('score')}`);
  check('counterfactual: no graze.scored, graze count stays 0', grazed.length === 0 && hell.grazes() === 0, `grazed=${grazed.length} count=${hell.grazes()}`);

  world.destroy();
}

console.log(`\n[oracle] BulletHellEmitter ok — ${passed} assertions: pattern.emitted (the curtain cadence emits a dense ring into scene.enemyBullets) + graze.scored (a real near-miss raises __GAME__.score by grazePoints with no damage); counterfactual (bullet outside the graze ring → no score) holds.`);
process.exit(0);
