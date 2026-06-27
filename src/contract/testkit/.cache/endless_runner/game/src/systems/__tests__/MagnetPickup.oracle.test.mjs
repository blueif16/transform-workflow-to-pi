/**
 * MagnetPickup — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/systems/MagnetPickup.ts):
 *   - magnet.activated  drivenBy "the avatar overlapping a magnet power-up icon"
 *                       expect   "__GAME__ magnet window becomes active (scene.magnet.active true
 *                                 with a positive msLeft countdown) and, for that window, live coins
 *                                 in __GAME__.entities move toward __GAME__.player each frame; logged"
 *   - observable magnetActive / magnetMsLeft
 *
 * REAL drive through the REAL seam: MagnetPickup streams magnet icons into scene.magnets, wires
 * the avatar↔icon overlap, and while its window is active draws every live coin on scene.coins
 * toward the avatar. We clear the level's DEFAULT systems, seed a real coin sprite on scene.coins
 * (the live pool the magnet borrows), mount the system, STEP until an icon spawns, then MOVE the
 * real avatar ONTO the icon — the overlap sweep ACTIVATES the timed window (the system's own
 * handler, not the private emit). The OBSERVABLE transition: scene.magnet.active true with a
 * positive msLeft, the magnetActive observable true, and the seeded coin visibly converging on the
 * avatar each frame. A COUNTERFACTUAL keeps the avatar away from the icon → no activation, the
 * window stays closed, the coin keeps its normal drift, and magnet.activated never fires.
 *
 *   node templates/modules/endless_runner/src/systems/__tests__/MagnetPickup.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** Seed a real, gravity-off coin sprite onto a fresh scene.coins group (the pool the magnet pulls). */
const seedCoin = (scene, x, y) => {
  const group = scene.physics.add.group();
  const coin = scene.physics.add.sprite(x, y, '__px');
  coin.body.setAllowGravity(false);
  group.add(coin);
  scene.coins = group;
  return coin;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: the avatar collects a magnet icon → the timed window opens + coins pull in.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];

  const coin = seedCoin(scene, 300, 100); // a live coin far from the avatar (so a pull is visible)
  const sys = world.mountSystem('MagnetPickup', { spawnEveryPx: 40, scrollSpeed: 300, magnetDurationMs: 2000, pullSpeed: 600 });
  check('resolveSystem returned a real MagnetPickup', sys.constructor.name === 'MagnetPickup', sys.constructor.name);
  check('precondition: the magnet window starts inactive', sys.surface().observables.magnetActive() === false, `active=${sys.surface().observables.magnetActive()}`);

  // STEP until a magnet icon has streamed in (sinceSpawn grows at scrollSpeed*dt).
  let icons = [];
  for (let i = 0; i < 40 && icons.length === 0; i++) { world.step(1); icons = scene.magnets.getChildren(); }
  check('precondition: a magnet icon spawned into scene.magnets', icons.length >= 1, `icons=${icons.length}`);
  const icon = icons[0];

  // DRIVE: place the real avatar ON the icon → the overlap sweep activates the timed window.
  scene.player.body.reset(icon.x, icon.y);
  const coinDistBefore = Math.hypot(scene.player.x - coin.x, scene.player.y - coin.y);
  const cur = bus.cursor;
  world.step(3);
  const activated = bus.recent(cur).filter((e) => e.type === 'magnet.activated');
  check('ACTIVATE: magnet.activated logged on the real bus', activated.length >= 1, `count=${activated.length}`);
  check('ACTIVATE: magnet.activated payload {id,durationMs,activations}', activated.at(-1)?.payload?.durationMs === 2000 && typeof activated.at(-1)?.payload?.activations === 'number', JSON.stringify(activated.at(-1)?.payload));
  check('ACTIVATE: the magnetActive observable became true', sys.surface().observables.magnetActive() === true, `active=${sys.surface().observables.magnetActive()}`);
  check('ACTIVATE: scene.magnet.active true with a positive msLeft countdown', scene.magnet?.active === true && scene.magnet?.msLeft > 0, JSON.stringify(scene.magnet));
  const coinDistAfter = Math.hypot(scene.player.x - coin.x, scene.player.y - coin.y);
  check('PULL: the live coin converged on the avatar during the window', coinDistAfter < coinDistBefore, `dist ${Math.round(coinDistBefore)}→${Math.round(coinDistAfter)}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with the avatar kept far from the icon, no
// magnet is collected — the window stays CLOSED (magnetActive false), the coin keeps
// its normal leftward drift (does NOT converge on the avatar), and magnet.activated
// never fires. If activate()/the pull ran unconditionally the DRIVE block would over-fire.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];
  const coin = seedCoin(scene, 300, 100);
  const sys = world.mountSystem('MagnetPickup', { spawnEveryPx: 40, scrollSpeed: 300, magnetDurationMs: 2000, pullSpeed: 600 });

  scene.player.body.reset(10, 700); // keep the avatar far from any streamed icon
  const cur = bus.cursor;
  for (let i = 0; i < 30; i++) world.step(1);
  const activated = bus.recent(cur).filter((e) => e.type === 'magnet.activated');
  check('counterfactual: avatar away → no magnet.activated', activated.length === 0, `count=${activated.length}`);
  check('counterfactual: the magnet window stays inactive', sys.surface().observables.magnetActive() === false, `active=${sys.surface().observables.magnetActive()}`);
  check('counterfactual: the coin did NOT converge on the (far) avatar', Math.hypot(scene.player.x - coin.x, scene.player.y - coin.y) > 100, `dist=${Math.round(Math.hypot(scene.player.x - coin.x, scene.player.y - coin.y))}`);

  world.destroy();
}

console.log(`\n[oracle] MagnetPickup ok — ${passed} assertions: magnet.activated (a real avatar↔icon overlap opens the timed window — magnetActive true, scene.magnet.active with msLeft>0 — and live coins converge on __GAME__.player); counterfactual (avatar away → no activation, window closed, no pull) holds.`);
process.exit(0);
