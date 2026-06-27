/**
 * TrajectoryInterceptor — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/TrajectoryInterceptor.ts):
 *   - missile.launched     drivenBy "an incoming arc spawns (the spawn cadence elapsing, wave quota
 *                                    permitting)"
 *                          expect   "a missile enters __GAME__.entities (the active-missile / hazard
 *                                    count rises); missile.launched logged"
 *   - intercept.detonated  drivenBy "a defensive shot reaches its aim point (player fire / pointer
 *                                    tap, cooldown permitting)"
 *                          expect   "a blast clears every missile within the radius — they leave
 *                                    __GAME__.entities; intercept.detonated logged"
 *   - base.destroyed       drivenBy "a missile reaches a base"
 *                          expect   "the base leaves __GAME__.entities (bases remaining decreases);
 *                                    the last base falling sends the cannon a lethal blow; base.destroyed logged"
 *
 * REAL drive through the REAL seams:
 *   - LAUNCH: the spawn cadence elapsing — step the engine with a small spawnEveryMs until a
 *     missile spawns into scene.hazards (the active-missile count rises).
 *   - DETONATE: the player's defensive fire — set the real scene.spaceKey down-edge and step; the
 *     system's readFireIntent() detects the press and detonates at the aim point (above the
 *     cannon), clearing every missile within the blast radius.
 *   - DESTROY: a missile reaching a base — spawn a base and a fast missile aimed at it and step
 *     until impact; the base leaves scene.obstacles (basesRemaining falls).
 * A COUNTERFACTUAL: with NO bases the spawner is a clean no-op → no missile.launched.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/TrajectoryInterceptor.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// LAUNCH: the spawn cadence elapsing drops an arcing missile (missile.launched).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;

  const interceptor = world.mountSystem('TrajectoryInterceptor', {
    bases: [{ id: 'base_a', x: 216, y: 700 }],
    spawnEveryMs: 60,        // fast spawns so a step lands one quickly
    maxMissiles: 12,
    missileSpeed: 60,
  });
  check('resolveSystem returned a real TrajectoryInterceptor', interceptor.constructor.name === 'TrajectoryInterceptor', interceptor.constructor.name);
  check('attach published the scene.__trajectoryInterceptor seam', scene.__trajectoryInterceptor === interceptor, `seam=${scene.__trajectoryInterceptor?.constructor?.name}`);
  check('precondition: one base, zero in-flight missiles', interceptor.basesRemaining() === 1 && interceptor.activeMissileCount() === 0, `bases=${interceptor.basesRemaining()} missiles=${interceptor.activeMissileCount()}`);

  const cur = bus.cursor;
  // DRIVE: step until the spawn cadence elapses and a missile launches.
  for (let f = 0; f < 12 && interceptor.activeMissileCount() === 0; f++) world.step(1);
  const launched = bus.recent(cur).filter((e) => e.type === 'missile.launched');
  check('LAUNCH: a missile entered the active set (__GAME__.entities hazard +)', interceptor.activeMissileCount() >= 1, `missiles=${interceptor.activeMissileCount()}`);
  check('LAUNCH: missile.launched logged {id,targetId}', launched.length >= 1 && launched.at(-1)?.payload?.targetId === 'base_a', JSON.stringify(launched.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DETONATE: a defensive shot clears missiles within the blast (intercept.detonated).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const interceptor = world.mountSystem('TrajectoryInterceptor', {
    bases: [{ id: 'base_a', x: 216, y: 700 }],
    spawnEveryMs: 60,
    blastRadius: 80,
    detonateCooldownMs: 0,
    missileSpeed: 20,        // slow so the missile lingers near its spawn band
  });
  // Spawn a missile to clear.
  for (let f = 0; f < 12 && interceptor.activeMissileCount() === 0; f++) world.step(1);
  const missilesBefore = interceptor.activeMissileCount();
  check('DETONATE precondition: at least one in-flight missile to clear', missilesBefore >= 1, `missiles=${missilesBefore}`);

  // The player AIMS with the pointer: set the real activePointer world position (the aim the
  // system reads) and park a live missile at that exact aim point so the blast catches it.
  const aimX = 216;
  const aimY = 360;
  scene.input.activePointer.worldX = aimX;
  scene.input.activePointer.worldY = aimY;
  const live = scene.hazards.getChildren().find((m) => m.active);
  live.x = aimX;
  live.y = aimY;

  // DRIVE: the player presses fire — set the real spaceKey down-edge; the system detonates at
  // the pointer's aim point (cooldown 0) and clears every missile inside the blast radius.
  const cur = bus.cursor;
  scene.spaceKey.isDown = true; // the real key state readFireIntent() reads
  world.step(1);
  scene.spaceKey.isDown = false;
  const detonated = bus.recent(cur).filter((e) => e.type === 'intercept.detonated');
  check('DETONATE: intercept.detonated logged {x,y,radius,cleared}', detonated.length >= 1 && detonated.at(-1)?.payload?.cleared >= 1, JSON.stringify(detonated.at(-1)?.payload));
  check('DETONATE: the blast cleared the missile (active count fell)', interceptor.activeMissileCount() < missilesBefore, `before=${missilesBefore} after=${interceptor.activeMissileCount()}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DESTROY: a missile reaching a base destroys it (base.destroyed).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const interceptor = world.mountSystem('TrajectoryInterceptor', {
    bases: [{ id: 'base_a', x: 216, y: 300 }, { id: 'base_b', x: 100, y: 300 }],
    spawnEveryMs: 60,
    missileSpeed: 60,
    maxMissiles: 12,
  });
  const basesBefore = interceptor.basesRemaining();
  check('DESTROY precondition: two bases standing', basesBefore === 2, `bases=${basesBefore}`);

  // Spawn a real arcing missile, then position it ON its target base — the exact
  // "a missile reaches a base" condition update()/missileReachedBase() acts on (the
  // real verb, positioned deterministically the way the bunker test parks a real bullet ON a cell).
  for (let f = 0; f < 8 && interceptor.activeMissileCount() === 0; f++) world.step(1);
  const missile = scene.hazards.getChildren().find((m) => m.active);
  check('DESTROY: a real arcing missile is in flight to position', !!missile && !!missile.__targetBase, `missile=${!!missile}`);
  const target = missile.__targetBase;
  missile.x = target.x;
  missile.y = target.y;

  const cur = bus.cursor;
  world.step(1); // the missile is now at the base → update() registers the impact + destroys it
  const destroyed = bus.recent(cur).filter((e) => e.type === 'base.destroyed');
  check('DESTROY: the struck base left scene.obstacles (basesRemaining fell)', interceptor.basesRemaining() === basesBefore - 1, `before=${basesBefore} after=${interceptor.basesRemaining()}`);
  check('DESTROY: base.destroyed logged {id,remaining}', destroyed.length >= 1 && destroyed.at(-1)?.payload?.id === target.__id && destroyed.at(-1)?.payload?.remaining === basesBefore - 1, JSON.stringify(destroyed.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with NO bases the spawner is a clean
// no-op — no missile ever launches. If spawnMissile()/the emit fired regardless
// of bases, the LAUNCH assertions would not prove the spawn gate is real.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { bus } = world;
  const interceptor = world.mountSystem('TrajectoryInterceptor', { bases: [], spawnEveryMs: 30, maxMissiles: 12 });

  const cur = bus.cursor;
  world.step(30); // plenty of spawn windows — but there is nothing to defend
  const launched = bus.recent(cur).filter((e) => e.type === 'missile.launched');
  check('counterfactual: no bases → no missile entered the active set', interceptor.activeMissileCount() === 0, `missiles=${interceptor.activeMissileCount()}`);
  check('counterfactual: no missile.launched', launched.length === 0, `count=${launched.length}`);

  world.destroy();
}

console.log(`\n[oracle] TrajectoryInterceptor ok — ${passed} assertions: missile.launched (spawn cadence → hazard +) + intercept.detonated (real spaceKey fire clears the blast) + base.destroyed (missile reaches a base → basesRemaining -1); counterfactual (no bases → no launch) holds.`);
process.exit(0);
