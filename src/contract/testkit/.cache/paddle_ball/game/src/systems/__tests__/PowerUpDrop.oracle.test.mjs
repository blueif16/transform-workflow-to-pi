/**
 * PowerUpDrop — ORACLE drive test (event-protocol conformance, paddle_ball).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (ScoreCombo.oracle.test.mjs): boots the REAL paddle_ball
 * engine via bootHeadlessGame({archetype}) and mounts the system through the ENGINE'S OWN
 * resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/paddle_ball/src/systems/PowerUpDrop.ts):
 *   - powerup.dropped  drivenBy "a brick carrying a drop is cleared (...), or spawnDrop() is called"
 *                      expect   "a falling power-up spawns — __GAME__.entities gains an entry of
 *                                type 'powerup'; powerup.dropped logged"
 *   - powerup.caught   drivenBy "the paddle overlaps a falling power-up (catches it on the way down)"
 *                      expect   "the power-up effect applies — the drop leaves __GAME__.entities and
 *                                (default effect) __GAME__.lives increases by one; powerup.caught logged"
 *
 * REAL drive through the REAL seams:
 *   - DROP: the bus-trigger path is RANDOM (Math.random()>=dropChance), so the deterministic real
 *     verb is the public `scene.powerUpDrop.spawnDrop(x,y)` (explicitly named in `drivenBy` — the
 *     exact seam a $custom effect / verify driver calls, NOT the private emit). A capsule sprite
 *     tagged __type='powerup' enters scene.entities (the __GAME__.entities source).
 *   - CATCH: spawn the drop ABOVE the real paddle, then STEP the real engine — update() falls the
 *     drop, the paddle overlap fires the real catch → default effect grants one life
 *     (scene.lives == __GAME__.lives +1) and the drop leaves __GAME__.entities. This is the real
 *     paddle-overlap verb (the fixture is positioned the way bootHeadless.oracle positions a coin).
 * Plus a COUNTERFACTUAL: no spawn → no powerup.dropped, entities unchanged.
 *
 *   node templates/modules/paddle_ball/src/systems/__tests__/PowerUpDrop.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
const powerupEntities = (scene) =>
  (scene.entities?.getChildren?.() ?? []).filter((c) => c?.active !== false && c.__type === 'powerup').length;

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: spawn a drop (DROP), then catch it with the paddle (CATCH).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;

  const drop = world.mountSystem('PowerUpDrop', { effectKind: 'extraLife', fallSpeed: 600 });
  check('resolveSystem returned a real PowerUpDrop', drop.constructor.name === 'PowerUpDrop', drop.constructor.name);
  check('attach published the scene.powerUpDrop seam', scene.powerUpDrop === drop, `seam=${scene.powerUpDrop?.constructor?.name}`);

  const paddle = scene.paddle;
  const dropsBefore = powerupEntities(scene);

  // DRIVE (drop): release a capsule just ABOVE the paddle via the real public seam.
  let cur = bus.cursor;
  const spawnX = paddle.x;
  const spawnY = paddle.y - 60; // a little above the paddle so it falls onto it
  const id = scene.powerUpDrop.spawnDrop(spawnX, spawnY);
  const dropped = bus.recent(cur).filter((e) => e.type === 'powerup.dropped');
  check('DROP: spawnDrop returned a real id', typeof id === 'string' && id.length > 0, `id=${id}`);
  check("DROP: __GAME__.entities gained a 'powerup' entry", powerupEntities(scene) === dropsBefore + 1, `before=${dropsBefore} after=${powerupEntities(scene)}`);
  check('DROP: powerup.dropped logged on the real bus', dropped.length === 1, `count=${dropped.length}`);
  check('DROP: powerup.dropped payload {id,kind:extraLife}', dropped.at(-1)?.payload?.id === id && dropped.at(-1)?.payload?.kind === 'extraLife', JSON.stringify(dropped.at(-1)?.payload));

  // DRIVE (catch): step the real engine — the drop falls onto the paddle → the catch fires.
  const livesBefore = scene.lives;
  cur = bus.cursor;
  world.step(12); // enough frames for the fast drop to reach the paddle
  const caught = bus.recent(cur).filter((e) => e.type === 'powerup.caught');
  check('CATCH: powerup.caught logged on the real bus', caught.length === 1, `count=${caught.length}`);
  check('CATCH: default extraLife effect granted one life (__GAME__.lives +1)', scene.lives === livesBefore + 1, `before=${livesBefore} after=${scene.lives}`);
  check('CATCH: the drop left __GAME__.entities', powerupEntities(scene) === dropsBefore, `count=${powerupEntities(scene)}`);
  check('CATCH: powerup.caught payload {id,lives}', caught.at(-1)?.payload?.id === id && caught.at(-1)?.payload?.lives === scene.lives, JSON.stringify(caught.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): NOT spawning a drop leaves the entity
// count unchanged and fires no powerup.dropped/powerup.caught. If spawnDrop()'s
// spawn/emit were a no-op the DROP assertions would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'paddle_ball' });
  const { scene, bus } = world;
  world.mountSystem('PowerUpDrop', { effectKind: 'extraLife' });
  const dropsBefore = powerupEntities(scene);
  const livesBefore = scene.lives;

  const cur = bus.cursor;
  world.step(20); // run the engine, but never spawn a drop
  const dropped = bus.recent(cur).filter((e) => e.type === 'powerup.dropped');
  const caught = bus.recent(cur).filter((e) => e.type === 'powerup.caught');
  check('counterfactual: no spawn → no powerup entities', powerupEntities(scene) === dropsBefore, `count=${powerupEntities(scene)}`);
  check('counterfactual: no spawn → no powerup.dropped/caught', dropped.length === 0 && caught.length === 0, `dropped=${dropped.length} caught=${caught.length}`);
  check('counterfactual: lives unchanged with no catch', scene.lives === livesBefore, `before=${livesBefore} after=${scene.lives}`);

  world.destroy();
}

console.log(`\n[oracle] PowerUpDrop ok — ${passed} assertions: powerup.dropped ('powerup' enters __GAME__.entities via the real spawnDrop() seam) + powerup.caught (real paddle-overlap catch → __GAME__.lives +1, drop leaves entities); counterfactual holds.`);
process.exit(0);
