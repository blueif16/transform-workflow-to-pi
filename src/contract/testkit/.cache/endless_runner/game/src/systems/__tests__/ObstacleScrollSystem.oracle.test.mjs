/**
 * ObstacleScrollSystem — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/systems/ObstacleScrollSystem.ts):
 *   - obstacle.spawned  drivenBy "the scroll cadence reaching the spawn interval"
 *                       expect   "a new obstacle pair appears in __GAME__.entities at the right
 *                                 edge with a passable gap and advances left each frame; logged"
 *   - hazard.activated  drivenBy "the avatar overlapping an obstacle, or touching the floor/ceiling"
 *                       expect   "the avatar takes the lose seam and __GAME__.status becomes
 *                                 'lost'; hazard.activated logged"
 *
 * REAL drive through the REAL seam: this system IS the auto-scroll engine — its update()
 * streams obstacle pairs in on the scroll cadence and culls them, and its floor/ceiling check
 * fires the lose seam. We clear the level's DEFAULT systems first (so only the system-under-test
 * drives the world), then STEP the real engine: the scroll cadence spawns a pair into the real
 * scene.obstacles group (a __GAME__.entities member) and emits obstacle.spawned; the pair then
 * advances LEFT each frame. To drive hazard.activated we place the real avatar AT the floor band
 * and step — the lose seam fires (status → 'lost'). A COUNTERFACTUAL boots a separate run with
 * scrollSpeed 0 → only the ONE initial pair spawns and the cadence never re-fires (no per-frame
 * spam); and a healthy avatar safely in mid-air → no hazard.activated, status stays 'playing'.
 *
 *   node templates/modules/endless_runner/src/systems/__tests__/ObstacleScrollSystem.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 1: the scroll cadence spawns a pair into __GAME__.entities → obstacle.spawned;
// the pair then advances left each frame.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = []; // silence the level's default scroller — only the SUT drives the world.

  const sys = world.mountSystem('ObstacleScrollSystem', { scrollSpeed: 600, spawnEveryPx: 120, floorY: 744 });
  check('resolveSystem returned a real ObstacleScrollSystem', sys.constructor.name === 'ObstacleScrollSystem', sys.constructor.name);

  const cur = bus.cursor;
  world.step(3); // dx=10px/frame → sinceSpawn crosses spawnEveryPx within a few frames
  const spawned = bus.recent(cur).filter((e) => e.type === 'obstacle.spawned');
  check('SPAWN: obstacle.spawned logged on the real bus', spawned.length >= 1, `count=${spawned.length}`);
  check('SPAWN: obstacle.spawned payload {id}', typeof spawned.at(-1)?.payload?.id === 'string', JSON.stringify(spawned.at(-1)?.payload));
  const children = scene.obstacles.getChildren();
  check('SPAWN: an obstacle entered scene.obstacles (a __GAME__.entities member)', children.length >= 2, `children=${children.length}`);

  // ADVANCE: the spawned pair advances LEFT each frame (the auto-scroll).
  const xBefore = children[0].x;
  world.step(2);
  check('ADVANCE: the obstacle advanced LEFT under the scroll', scene.obstacles.getChildren()[0].x < xBefore, `${xBefore}→${scene.obstacles.getChildren()[0].x}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE 2: the avatar at the floor band → hazard.activated + __GAME__.status 'lost'.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];

  const sys = world.mountSystem('ObstacleScrollSystem', { scrollSpeed: 0, spawnEveryPx: 99999, floorY: 400 });
  check('precondition: status starts playing', scene.registry.get('status') === 'playing', `status=${scene.registry.get('status')}`);

  // Place the real avatar AT the floor band (avatar.y + half >= floorY) → the lose seam fires.
  scene.player.body.reset(120, 399);
  const cur = bus.cursor;
  world.step(1);
  const hazards = bus.recent(cur).filter((e) => e.type === 'hazard.activated');
  check('HAZARD: hazard.activated logged on the real bus', hazards.length >= 1, `count=${hazards.length}`);
  check("HAZARD: __GAME__.status became 'lost' (the engine lose seam)", scene.registry.get('status') === 'lost', `status=${scene.registry.get('status')}`);
  check('HAZARD: hazard.activated payload {id}', typeof hazards.at(-1)?.payload?.id === 'string', JSON.stringify(hazards.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with scrollSpeed 0 only the ONE initial pair
// spawns (the run starts with a target) and the cadence NEVER re-fires — obstacle.spawned
// is NOT a per-frame emit. And a healthy avatar safely in mid-air → no hazard.activated,
// status stays 'playing'. If spawnPair()/fireLose() emitted unconditionally per frame this
// would over-fire; this proves both emits are gated on a real cadence / a real band contact.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];
  world.mountSystem('ObstacleScrollSystem', { scrollSpeed: 0, spawnEveryPx: 99999, floorY: 700 });

  scene.player.body.reset(120, 300); // safely mid-air, well above floorY and below ceiling
  const cur = bus.cursor;
  world.step(5); // scrollSpeed 0 → only the initial pair; the cadence is never reached again
  const spawned = bus.recent(cur).filter((e) => e.type === 'obstacle.spawned');
  const hazards = bus.recent(cur).filter((e) => e.type === 'hazard.activated');
  check('counterfactual: scrollSpeed 0 → exactly the ONE initial spawn (not a per-frame emit)', spawned.length === 1, `count=${spawned.length}`);
  check('counterfactual: safe avatar → no hazard.activated', hazards.length === 0, `count=${hazards.length}`);
  check("counterfactual: status stays 'playing'", scene.registry.get('status') === 'playing', `status=${scene.registry.get('status')}`);

  world.destroy();
}

console.log(`\n[oracle] ObstacleScrollSystem ok — ${passed} assertions: obstacle.spawned (the scroll cadence streams a pair into __GAME__.entities, advancing left) + hazard.activated (avatar at the floor → __GAME__.status 'lost'); counterfactual (scrollSpeed 0 → only the one initial spawn, safe avatar → no hazard) holds.`);
process.exit(0);
