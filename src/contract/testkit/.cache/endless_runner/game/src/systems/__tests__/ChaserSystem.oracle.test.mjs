/**
 * ChaserSystem — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/systems/ChaserSystem.ts):
 *   - chaser.caught  drivenBy "the pursuer closing the gap to zero (sustained slowdowns/mistakes)"
 *                    expect   "the avatar takes the engine lose seam and __GAME__.status becomes
 *                              'lost'; chaser.caught logged"
 *
 * REAL drive through the REAL seam: the pursuer's gap closes whenever the avatar SLOWS DOWN —
 * a frame its vertical velocity is in the slowdown band (0 ≤ vy < slowVy). That signal IS the
 * avatar's real body.velocity.y, which a harness drives directly (the same body the movement
 * verb writes). We clear the level's DEFAULT systems (so the default scroller's lose seam can't
 * confound), mount the pursuer with a small startGap, hold the real avatar's vy in the slowdown
 * band, and STEP the engine — the gap closes each slowdown frame until it hits zero: chaser.caught
 * fires and the engine lose seam takes the avatar (__GAME__.status 'lost'). A COUNTERFACTUAL holds
 * the avatar's vy CLIMBING (clean forward play, vy strongly negative) → the gap recovers, the
 * pursuer never catches, and chaser.caught never fires.
 *
 *   node templates/modules/endless_runner/src/systems/__tests__/ChaserSystem.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: hold the avatar in the slowdown band → the gap closes to zero → catch + lose.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];

  const sys = world.mountSystem('ChaserSystem', { startGap: 20, slowVy: 120, closeRate: 6, recoverRate: 0.5, pursuerId: 'chaser' });
  check('resolveSystem returned a real ChaserSystem', sys.constructor.name === 'ChaserSystem', sys.constructor.name);
  check('precondition: status starts playing', scene.registry.get('status') === 'playing', `status=${scene.registry.get('status')}`);
  check('precondition: the gap is published on scene.chaserGap', scene.chaserGap === 20, `gap=${scene.chaserGap}`);

  // DRIVE: each frame, force the avatar's vy into the slowdown band (0 ≤ vy < slowVy) — a
  // coasting/sinking mistake the pursuer feeds on — then step (the system reads the live vy).
  const cur = bus.cursor;
  let caught = [];
  for (let i = 0; i < 20 && caught.length === 0; i++) {
    scene.player.body.velocity.y = 10; // a slow sink, inside the slowdown band
    scene.player.vy = 10;
    world.step(1);
    caught = bus.recent(cur).filter((e) => e.type === 'chaser.caught');
  }
  check('CATCH: chaser.caught logged on the real bus', caught.length === 1, `count=${caught.length}`);
  check('CATCH: chaser.caught payload {id:chaser}', caught.at(-1)?.payload?.id === 'chaser', JSON.stringify(caught.at(-1)?.payload));
  check("CATCH: __GAME__.status became 'lost' (the engine lose seam)", scene.registry.get('status') === 'lost', `status=${scene.registry.get('status')}`);
  check('CATCH: the published gap closed to zero', scene.chaserGap === 0, `gap=${scene.chaserGap}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): clean forward play — the avatar's vy held
// strongly NEGATIVE (climbing) every frame — recovers the gap, so the pursuer never
// catches and chaser.caught never fires; status stays 'playing'. If fireCatch()/the
// emit fired regardless of the gap the CATCH assertions would be vacuously true.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];
  world.mountSystem('ChaserSystem', { startGap: 20, slowVy: 120, closeRate: 6, recoverRate: 4, pursuerId: 'chaser' });

  const cur = bus.cursor;
  for (let i = 0; i < 20; i++) {
    scene.player.body.velocity.y = -300; // climbing hard — clean forward play, the gap recovers
    scene.player.vy = -300;
    world.step(1);
  }
  const caught = bus.recent(cur).filter((e) => e.type === 'chaser.caught');
  check('counterfactual: clean forward play → no chaser.caught', caught.length === 0, `count=${caught.length}`);
  check("counterfactual: status stays 'playing'", scene.registry.get('status') === 'playing', `status=${scene.registry.get('status')}`);
  check('counterfactual: the gap recovered above zero', scene.chaserGap > 0, `gap=${scene.chaserGap}`);

  world.destroy();
}

console.log(`\n[oracle] ChaserSystem ok — ${passed} assertions: chaser.caught (sustained slowdown closes the gap to zero → the engine lose seam, __GAME__.status 'lost'); counterfactual (clean climbing play recovers the gap → no catch, status 'playing') holds.`);
process.exit(0);
