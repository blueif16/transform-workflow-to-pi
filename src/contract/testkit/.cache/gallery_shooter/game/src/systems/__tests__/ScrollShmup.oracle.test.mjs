/**
 * ScrollShmup — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/ScrollShmup.ts):
 *   - pattern.fired       drivenBy "an enemy emits a bullet pattern (the volley cadence elapsing)"
 *                         expect   "one or more enemy bullets enter scene.enemyBullets ⇒ __GAME__
 *                                   active enemy-bullet count increases; pattern.fired logged"
 *   - powerup.collected   drivenBy "the player overlaps a power-up drop"
 *                         expect   "the weapon tier rises (scene.weaponTier increments, the live
 *                                   cannon speeds up) up to maxTier; powerup.collected logged"
 *   - boss.damaged        drivenBy "a player shot hits the boss"
 *                         expect   "__GAME__.enemyHP (the boss HP-bar value) decreases; on reaching 0
 *                                   the boss dies and __GAME__.status becomes 'won'; boss.damaged logged"
 *
 * REAL drive through the REAL seams (one world per event for clean determinism):
 *   - FIRED: the volley cadence elapsing — with a live formation present (the default rack), step
 *     until the enemy fire timer fires an aimed pattern into scene.enemyBullets.
 *   - COLLECTED: the player↔power-up overlap ScrollShmup wires — park a real power-up in
 *     scene.powerups ON the player and step; the overlap raises the weapon tier.
 *   - DAMAGED: a player shot hitting the boss — with the formation cleared the boss spawns; drive the
 *     engine-wired boss .takeDamage(n) seam (what ProjectilePool's bullet↔boss overlap calls) → HP
 *     falls (boss.damaged); to 0 → win.
 * A COUNTERFACTUAL keeps the player off any power-up → no powerup.collected.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/ScrollShmup.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const isolate = (scene) => {
  if (Array.isArray(scene.systems)) scene.systems.length = 0;
  for (const e of [...scene.enemies.getChildren()]) e.destroy?.();
  scene.enemies.clear(true, true);
};
const dropAt = (scene, x, y) => {
  const p = scene.physics.add.sprite(x, y, '__px');
  p.setDisplaySize(16, 16);
  p.body.setAllowGravity(false);
  p.__type = 'collectible';
  p.__kind = 'powerup';
  p.setActive(true);
  p.setVisible(true);
  scene.powerups.add(p);
  return p;
};

// ════════════════════════════════════════════════════════════════════════════
// FIRED: an enemy emits a bullet pattern on cadence (pattern.fired).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  // The default formation (18 members) is present → a live shooter for the volley.
  const shmup = world.mountSystem('ScrollShmup', { fireEveryMs: 15, pattern: 'aimed', enemyBulletCap: 48 });
  check('resolveSystem returned a real ScrollShmup', shmup.constructor.name === 'ScrollShmup', shmup.constructor.name);
  check('attach published the scene.__scrollShmup seam + enemyBullets group', scene.__scrollShmup === shmup && !!scene.enemyBullets, `seam=${scene.__scrollShmup?.constructor?.name}`);
  check('precondition: no enemy bullets yet', shmup.enemyBulletCount() === 0, `bullets=${shmup.enemyBulletCount()}`);

  const cur = bus.cursor;
  // DRIVE: step until the fire cadence elapses → an aimed pattern enters scene.enemyBullets.
  for (let f = 0; f < 4 && bus.recent(cur).filter((e) => e.type === 'pattern.fired').length === 0; f++) world.step(1);
  const fired = bus.recent(cur).filter((e) => e.type === 'pattern.fired');
  check('FIRED: the active enemy-bullet count rose (bullets entered scene.enemyBullets)', shmup.enemyBulletCount() >= 1, `bullets=${shmup.enemyBulletCount()}`);
  check('FIRED: pattern.fired logged {pattern:aimed,count}', fired.length >= 1 && fired.at(-1)?.payload?.pattern === 'aimed' && fired.at(-1)?.payload?.count >= 1, JSON.stringify(fired.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COLLECTED: the player overlaps a power-up → weapon tier rises (powerup.collected).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const shmup = world.mountSystem('ScrollShmup', { fireEveryMs: 999999, maxTier: 3 });
  check('COLLECT precondition: starts at weapon tier 1', shmup.weaponTier() === 1 && scene.weaponTier === 1, `tier=${shmup.weaponTier()}`);

  const cur = bus.cursor;
  dropAt(scene, scene.player.x, scene.player.y);
  world.step(2);
  const collected = bus.recent(cur).filter((e) => e.type === 'powerup.collected');
  check('COLLECT: the weapon tier rose to 2 (scene.weaponTier)', shmup.weaponTier() === 2 && scene.weaponTier === 2, `tier=${shmup.weaponTier()}`);
  check('COLLECT: powerup.collected logged {tier:2}', collected.length === 1 && collected.at(-1)?.payload?.tier === 2, JSON.stringify(collected.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DAMAGED: a player shot hits the boss → HP falls (boss.damaged), to 0 → win.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene); // empty formation → the boss spawns
  const shmup = world.mountSystem('ScrollShmup', { fireEveryMs: 999999, bossHp: 8, bossDamage: 1 });
  world.step(1); // formation cleared → boss spawns
  const boss = scene.enemies.getChildren().find((e) => e.__kind === 'boss' && e.active !== false);
  check('DAMAGE precondition: the boss spawned (HP mirrored to scene.enemyHP)', !!boss && scene.enemyHP === 8 && shmup.bossHP() === 8, `boss=${!!boss} enemyHP=${scene.enemyHP}`);

  // DRIVE: a player shot deals damage via the engine-wired .takeDamage seam.
  let cur = bus.cursor;
  boss.takeDamage(3); // what ProjectilePool's bullet↔enemies overlap calls on the boss
  const dmg = bus.recent(cur).filter((e) => e.type === 'boss.damaged');
  check('DAMAGE: __GAME__.enemyHP (the boss HP bar) fell to 5', scene.enemyHP === 5 && shmup.bossHP() === 5, `enemyHP=${scene.enemyHP}`);
  check('DAMAGE: boss.damaged logged {hp:5,maxHp:8}', dmg.length >= 1 && dmg.at(-1)?.payload?.hp === 5 && dmg.at(-1)?.payload?.maxHp === 8, JSON.stringify(dmg.at(-1)?.payload));

  // Finish the boss → its death is the win.
  boss.takeDamage(5);
  check("DAMAGE: the boss death won the level → __GAME__.status 'won'", scene.registry.get('status') === 'won', `status=${scene.registry.get('status')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO power-up on the player the weapon
// tier stays at 1 and powerup.collected never fires. If collectPowerup()'s
// upgrade/emit ran without an overlap the COLLECT assertions would not prove the verb.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const shmup = world.mountSystem('ScrollShmup', { fireEveryMs: 999999, maxTier: 3 });
  dropAt(scene, 20, 60); // a drop, but FAR from the player

  const cur = bus.cursor;
  world.step(6);
  const collected = bus.recent(cur).filter((e) => e.type === 'powerup.collected');
  check('counterfactual: no overlap → weapon tier stays 1', shmup.weaponTier() === 1, `tier=${shmup.weaponTier()}`);
  check('counterfactual: no powerup.collected', collected.length === 0, `count=${collected.length}`);

  world.destroy();
}

console.log(`\n[oracle] ScrollShmup ok — ${passed} assertions: pattern.fired (the volley cadence emits enemy bullets into scene.enemyBullets) + powerup.collected (a real player↔drop overlap raises scene.weaponTier) + boss.damaged (a player shot drops __GAME__.enemyHP, to 0 → status 'won'); counterfactual (no overlap → tier stays 1) holds.`);
process.exit(0);
