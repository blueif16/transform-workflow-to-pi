/**
 * ShieldPickup — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/systems/ShieldPickup.ts):
 *   - shield.gained  drivenBy "the avatar overlapping a shield power-up orb"
 *                    expect   "the orb despawns and the run gains a one-hit shield
 *                              (scene.shielded becomes true); shield.gained logged"
 *   - shield.broken  drivenBy "a lethal hit landing while the avatar is shielded"
 *                    expect   "the shield is consumed (scene.shielded becomes false) and the
 *                              avatar SURVIVES — __GAME__.status stays 'playing'; shield.broken logged"
 *
 * REAL drive through the REAL seam: ShieldPickup spawns shield orbs into scene.shieldPickups,
 * wires the avatar↔orb overlap, and WRAPS the avatar's single death seam (takeDamage) in
 * attach(). We clear the level's DEFAULT systems, mount the system (its setupCollisions wires
 * the REAL overlap + installs the absorb wrap), STEP to spawn an orb (scrollSpeed 0 so it holds),
 * MOVE the real avatar ONTO the orb to gain the shield via the real overlap sweep, then drive a
 * LETHAL avatar.takeDamage(9999) — the WRAPPED real death seam the scroller/chaser call. The
 * shield absorbs it: scene.shielded flips false, the avatar SURVIVES (status stays 'playing'),
 * shield.broken logged. A COUNTERFACTUAL drives the SAME lethal hit with NO shield held → the
 * avatar dies (status 'lost') and shield.broken does NOT fire.
 *
 *   node templates/modules/endless_runner/src/systems/__tests__/ShieldPickup.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: collect an orb (shield.gained) then absorb a lethal hit (shield.broken, survive).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];

  const sys = world.mountSystem('ShieldPickup', { spawnEveryPx: 50, scrollSpeed: 0 });
  check('resolveSystem returned a real ShieldPickup', sys.constructor.name === 'ShieldPickup', sys.constructor.name);
  check('precondition: scene.shielded starts false', scene.shielded === false, `shielded=${scene.shielded}`);

  world.step(1); // attach armed sinceSpawn = spawnEveryPx → an orb spawns frame 1
  const orbs = scene.shieldPickups.getChildren();
  check('precondition: a shield orb spawned into scene.shieldPickups', orbs.length >= 1, `orbs=${orbs.length}`);
  const orb = orbs[0];
  const orbId = orb.__id;

  // GAIN: place the real avatar ON the orb; the overlap sweep grants the shield.
  scene.player.body.reset(orb.x, orb.y);
  let cur = bus.cursor;
  world.step(2);
  const gained = bus.recent(cur).filter((e) => e.type === 'shield.gained');
  check('GAIN: shield.gained logged on the real bus', gained.length >= 1, `count=${gained.length}`);
  check('GAIN: scene.shielded became true (a one-hit charge)', scene.shielded === true, `shielded=${scene.shielded}`);
  check('GAIN: shield.gained payload names the orb id', gained.at(-1)?.payload?.id === orbId, JSON.stringify(gained.at(-1)?.payload));
  check('GAIN: the collected orb despawned', orb.active === false || !scene.shieldPickups.getChildren().includes(orb), `active=${orb.active}`);

  // ABSORB: a lethal hit on the WRAPPED real death seam is absorbed — survive, shield consumed.
  cur = bus.cursor;
  scene.player.takeDamage(9999);
  const broken = bus.recent(cur).filter((e) => e.type === 'shield.broken');
  check('ABSORB: shield.broken logged on the real bus', broken.length === 1, `count=${broken.length}`);
  check('ABSORB: scene.shielded consumed back to false', scene.shielded === false, `shielded=${scene.shielded}`);
  check("ABSORB: the avatar SURVIVED — __GAME__.status stays 'playing'", scene.registry.get('status') === 'playing', `status=${scene.registry.get('status')}`);
  check('ABSORB: the avatar is not dead', scene.player.isDead !== true, `isDead=${scene.player.isDead}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): the SAME lethal hit with NO shield held —
// the wrap is transparent, so the original death seam runs: __GAME__.status becomes
// 'lost' and shield.broken does NOT fire. If breakShield()/the emit ran unconditionally
// the ABSORB assertions would be vacuously true; this proves they require a held shield.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];
  world.mountSystem('ShieldPickup', { spawnEveryPx: 99999, scrollSpeed: 0 }); // no orb to collect → no shield
  world.step(1);
  check('precondition: no shield held', scene.shielded === false, `shielded=${scene.shielded}`);

  const cur = bus.cursor;
  scene.player.takeDamage(9999); // lethal, unshielded → the original death seam runs
  const broken = bus.recent(cur).filter((e) => e.type === 'shield.broken');
  check('counterfactual: unshielded lethal hit → no shield.broken', broken.length === 0, `count=${broken.length}`);
  check("counterfactual: the avatar DIED — __GAME__.status became 'lost'", scene.registry.get('status') === 'lost', `status=${scene.registry.get('status')}`);

  world.destroy();
}

console.log(`\n[oracle] ShieldPickup ok — ${passed} assertions: shield.gained (a real avatar↔orb overlap → scene.shielded true, orb despawns) + shield.broken (a lethal takeDamage is absorbed → scene.shielded false, avatar SURVIVES status 'playing'); counterfactual (unshielded lethal hit → status 'lost', no shield.broken) holds.`);
process.exit(0);
