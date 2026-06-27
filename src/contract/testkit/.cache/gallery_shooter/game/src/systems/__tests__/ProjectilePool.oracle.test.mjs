/**
 * ProjectilePool — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/ProjectilePool.ts):
 *   - player.shot  drivenBy "fire input (the cannon fires, cooldown + pool permitting)"
 *                  expect   "a pooled bullet enters __GAME__.entities and travels up; it returns to
 *                            the pool on exit/hit (in-use count never leaks); player.shot logged"
 *
 * REAL drive through the REAL seam: the scene's fire driver requests a shot via the public
 * pool.fire(muzzleX,muzzleY) — the SAME seam DataShooterScene.driveControlScheme() calls on a
 * Space press (NOT the private emit). We mount a fresh pool, call fire() from the player muzzle,
 * and assert the OBSERVABLE transition: a bullet leaves the free list and enters the in-use set
 * (the __GAME__.entities projectile count rises) with an upward velocity, and player.shot logs
 * {x,y}. Stepping the engine flies the bullet off the top → it RETURNS to the pool (no leak:
 * free+inUse stays == poolSize). A COUNTERFACTUAL never fires → in-use stays 0, no player.shot.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/ProjectilePool.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: fire() launches a pooled bullet upward (player.shot), then it returns.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;

  const pool = world.mountSystem('ProjectilePool', { poolSize: 6, bulletSpeed: 520, cooldownMs: 0, bulletHeight: 16 });
  check('resolveSystem returned a real ProjectilePool', pool.constructor.name === 'ProjectilePool', pool.constructor.name);
  check('attach published the scene.__projectilePool seam', scene.__projectilePool === pool, `seam=${scene.__projectilePool?.constructor?.name}`);

  const inUseBefore = pool.inUseCount();
  const poolTotal = pool.inUseCount() + pool.freeCount();
  check('precondition: no in-use bullets, full free pool', inUseBefore === 0 && poolTotal === 6, `inUse=${inUseBefore} total=${poolTotal}`);

  // DRIVE: request a shot from the muzzle (the player position) via the real public seam.
  const mx = scene.player.x;
  const my = scene.player.y;
  let cur = bus.cursor;
  const ok = pool.fire(mx, my);
  const shots = bus.recent(cur).filter((e) => e.type === 'player.shot');
  check('SHOT: fire() reported a launch', ok === true, `ok=${ok}`);
  check('SHOT: a bullet entered the in-use set (__GAME__.entities projectile +1)', pool.inUseCount() === inUseBefore + 1, `inUse=${pool.inUseCount()}`);
  check('SHOT: no-leak — free + inUse still == poolSize', pool.inUseCount() + pool.freeCount() === 6, `total=${pool.inUseCount() + pool.freeCount()}`);
  check('SHOT: player.shot logged on the real bus', shots.length === 1, `count=${shots.length}`);
  check('SHOT: player.shot payload {x,y} at the muzzle', shots.at(-1)?.payload?.x === mx && shots.at(-1)?.payload?.y === my, JSON.stringify(shots.at(-1)?.payload));

  // The bullet travels UP (negative y velocity) — find the live in-use bullet and check it.
  const live = scene.playerBullets.getChildren().find((b) => b.active && b.body?.enable);
  check('SHOT: the bullet has an upward (negative-y) velocity', live && live.body.velocity.y < 0, `vy=${live?.body?.velocity?.y}`);

  // DRIVE (return): step enough frames for the fast bullet to exit the top → it RETURNS.
  // (muzzle y≈712, ~7.8px/frame at 520px/s·15ms → ~95 frames to clear y<-16; give margin.)
  world.step(140);
  check('RETURN: the bullet left the in-use set (returned to the pool, no leak)', pool.inUseCount() === 0, `inUse=${pool.inUseCount()}`);
  check('RETURN: free + inUse back to poolSize', pool.freeCount() === 6, `free=${pool.freeCount()}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): never calling fire() leaves the in-use
// count at 0 and fires no player.shot. If fire()'s launch/emit were a no-op the
// SHOT assertions above would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const pool = world.mountSystem('ProjectilePool', { poolSize: 6, cooldownMs: 0 });

  const cur = bus.cursor;
  world.step(20); // run the engine, but never request a shot
  const shots = bus.recent(cur).filter((e) => e.type === 'player.shot');
  check('counterfactual: no fire → no in-use bullets', pool.inUseCount() === 0, `inUse=${pool.inUseCount()}`);
  check('counterfactual: no fire → no player.shot', shots.length === 0, `count=${shots.length}`);

  world.destroy();
}

console.log(`\n[oracle] ProjectilePool ok — ${passed} assertions: player.shot (real fire() launches a pooled upward bullet → in-use +1, no leak; it returns on exit) + payload {x,y}; counterfactual holds.`);
process.exit(0);
