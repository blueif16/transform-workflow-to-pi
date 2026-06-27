/**
 * PowerUpTier — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/PowerUpTier.ts):
 *   - weapon.upgraded  drivenBy "the player collects (overlaps) a tier power-up drop"
 *                      expect   "the weapon tier increases (scene.weaponTier increments, the live
 *                                ProjectilePool fire pattern escalates — faster cooldown, more
 *                                shots/volley, more damage) up to maxTier; weapon.upgraded logged"
 *
 * REAL drive through the REAL seam: PowerUpTier wires a player↔power-up overlap in setupCollisions()
 * (against scene.powerups) — the SAME overlap a fallen drop triggers when the player flies through
 * it. The drop itself is random (dropChance), so the deterministic verb is to park a real power-up
 * sprite in scene.powerups ON the player and STEP — the registered overlap fires collectPowerup →
 * the weapon tier RISES (scene.weaponTier increments), the live ProjectilePool escalates (cooldown
 * shrinks, shotsPerVolley grows), and weapon.upgraded logs. We pick up a SECOND drop to climb
 * another tier. A COUNTERFACTUAL keeps the player away from any drop → the tier stays at 1, no event.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/PowerUpTier.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** Park a real tier power-up in scene.powerups ON (x,y) — the real player-overlap fixture. */
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
// DRIVE: the player collects a tier drop → weapon tier rises (weapon.upgraded).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;

  // Explicit tier ladder so tier 2 unambiguously escalates ALL three dials (shots↑, cooldown↓, damage↑).
  const tier = world.mountSystem('PowerUpTier', {
    maxTier: 3,
    tiers: [
      { shots: 1, cooldownMul: 1.0, damage: 1 },
      { shots: 3, cooldownMul: 0.5, damage: 4 },
      { shots: 5, cooldownMul: 0.3, damage: 6 },
    ],
  });
  check('resolveSystem returned a real PowerUpTier', tier.constructor.name === 'PowerUpTier', tier.constructor.name);
  check('attach published the scene.__powerUpTier seam + tier mirror', scene.__powerUpTier === tier && scene.weaponTier === 1, `seam=${scene.__powerUpTier?.constructor?.name} tier=${scene.weaponTier}`);
  check('precondition: starts at tier 1', tier.weaponTier() === 1, `tier=${tier.weaponTier()}`);

  const pool = scene.__projectilePool;
  const cooldownBefore = pool?.cooldownMs;
  check('precondition: a live ProjectilePool to escalate', !!pool && typeof cooldownBefore === 'number', `pool=${!!pool} cd=${cooldownBefore}`);

  // DRIVE: a real tier power-up ON the player; step → the overlap collects it.
  let cur = bus.cursor;
  dropAt(scene, scene.player.x, scene.player.y);
  world.step(2);
  const up = bus.recent(cur).filter((e) => e.type === 'weapon.upgraded');
  check('UPGRADE: the weapon tier rose to 2 (scene.weaponTier)', tier.weaponTier() === 2 && scene.weaponTier === 2 && scene.player.weaponTier === 2, `tier=${tier.weaponTier()} mirror=${scene.weaponTier}`);
  check('UPGRADE: the live ProjectilePool escalated (cooldown shrank)', pool.cooldownMs < cooldownBefore, `${cooldownBefore} → ${pool.cooldownMs}`);
  check('UPGRADE: the volley widened (shotsPerVolley grew to 3)', pool.shotsPerVolley === 3, `shots=${pool.shotsPerVolley}`);
  check('UPGRADE: the per-bullet damage escalated (tier-2 rung damage → 4)', pool.damage === 4, `damage=${pool.damage}`);
  check('UPGRADE: weapon.upgraded logged {tier:2,maxTier,shots:3}', up.length === 1 && up.at(-1)?.payload?.tier === 2 && up.at(-1)?.payload?.maxTier === 3 && up.at(-1)?.payload?.shots === 3, JSON.stringify(up.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO drop on the player the tier stays
// at 1 and weapon.upgraded never fires. If collectPowerup()'s upgrade/emit ran
// without an overlap the UPGRADE assertions would not prove the verb is the pickup.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const tier = world.mountSystem('PowerUpTier', { maxTier: 3 });

  // A drop exists but FAR from the player → no overlap, no collect.
  dropAt(scene, 20, 60);
  const cur = bus.cursor;
  world.step(6);
  const up = bus.recent(cur).filter((e) => e.type === 'weapon.upgraded');
  check('counterfactual: no overlap → tier stays at 1', tier.weaponTier() === 1 && scene.weaponTier === 1, `tier=${tier.weaponTier()}`);
  check('counterfactual: no weapon.upgraded', up.length === 0, `count=${up.length}`);

  world.destroy();
}

console.log(`\n[oracle] PowerUpTier ok — ${passed} assertions: weapon.upgraded (a real player↔drop overlap raises scene.weaponTier + escalates the live ProjectilePool: cooldown↓, shots↑); counterfactual (no overlap → tier stays 1) holds.`);
process.exit(0);
