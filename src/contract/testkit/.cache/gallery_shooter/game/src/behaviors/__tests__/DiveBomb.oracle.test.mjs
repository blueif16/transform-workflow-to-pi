/**
 * DiveBomb — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the behavior through
 * the ENGINE'S OWN resolver (world.mountBehavior) onto a real formation-member owner — the
 * test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/behaviors/DiveBomb.ts):
 *   - enemy.dived  drivenBy "a settled formation member becoming due to dive (its jittered dive
 *                            clock elapses)"
 *                  expect   "the member clears its __formation tag (FormationMarch stops marching
 *                            it) and flies a curved attack path toward the player's position;
 *                            enemy.dived logged"
 *
 * REAL drive through the REAL seam: DiveBomb is a per-member behavior that counts down its idle
 * dive clock on each update() (the engine ticks an owner's behaviors every frame). We mount it
 * onto a real formation member (a spawned enemy sprite, tagged .__formation, with .scene + the
 * scene's .player as the dive target) with diveDelayMs:0/diveJitterMs:0/diveChance:1 so the very
 * first tick makes it DUE → it peels off, emitting enemy.dived. The OBSERVABLE transition: the
 * member's .__formation tag clears (FormationMarch releases it), .__diving latches, and the member
 * begins flying down toward the player. A COUNTERFACTUAL uses a long dive delay so within the
 * stepped window the member is never due → no enemy.dived and __formation stays set.
 *
 *   node templates/modules/gallery_shooter/src/behaviors/__tests__/DiveBomb.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a member becomes due to dive on the first tick → peels off (enemy.dived).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;

  // A real member settled in the rack (above the player), tagged like a formation enemy.
  const member = world.spawnEnemy({ x: 180, y: 160 });
  member.__formation = true;
  member.__id = 'inv_diver';
  // No entry-spline in flight (DiveBomb only dives a SETTLED member).
  member.__entering = false;

  // diveDelay/jitter 0 + chance 1 ⇒ DUE on the first tick; exitOnPass keeps it deterministic.
  const dive = world.mountBehavior(
    'DiveBomb',
    { diveDelayMs: 0, diveJitterMs: 0, diveMs: 1400, diveChance: 1, bowPx: 60 },
    member,
  );
  check('resolveBehavior returned a real DiveBomb', dive.constructor.name === 'DiveBomb', dive.constructor.name);
  check('precondition: member is in the rack (__formation set)', member.__formation === true, `tag=${member.__formation}`);

  const yBefore = member.y;
  const cur = bus.cursor;
  // DRIVE: step the real engine — the idle clock elapses (delay 0), the member peels off.
  world.step(3);
  const dived = bus.recent(cur).filter((e) => e.type === 'enemy.dived');
  // OBSERVABLE: the member left the rack (cleared __formation), flagged __diving, and is descending.
  check('PEEL: the member cleared its __formation tag (FormationMarch releases it)', member.__formation === false, `tag=${member.__formation}`);
  check('PEEL: the member latched __diving (on its own attack path)', member.__diving === true, `diving=${member.__diving}`);
  check('PEEL: the member is descending toward the player (y increased)', member.y > yBefore, `${yBefore}→${member.y}`);
  check('PEEL: enemy.dived logged on the real bus', dived.length >= 1, `count=${dived.length}`);
  check('PEEL: enemy.dived payload {id,targetX,targetY} aims at the player', dived.at(-1)?.payload?.id === 'inv_diver' && Math.abs((dived.at(-1)?.payload?.targetX ?? NaN) - scene.player.x) < 1e-6, JSON.stringify(dived.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a member with a long dive delay is never
// due within the stepped window — it stays in the rack (__formation set) and
// enemy.dived never fires. If peelOff()/the emit were a no-op the PEEL assertions
// above would already be red.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { bus } = world;
  const member = world.spawnEnemy({ x: 180, y: 160 });
  member.__formation = true;
  member.__entering = false;
  world.mountBehavior('DiveBomb', { diveDelayMs: 999999, diveJitterMs: 0, diveChance: 1 }, member);

  const cur = bus.cursor;
  world.step(20); // ~300ms of real time — far below the 999999ms dive delay
  const dived = bus.recent(cur).filter((e) => e.type === 'enemy.dived');
  check('counterfactual: not yet due → __formation still set (still in the rack)', member.__formation === true, `tag=${member.__formation}`);
  check('counterfactual: not yet due → not diving', !member.__diving, `diving=${member.__diving}`);
  check('counterfactual: no enemy.dived', dived.length === 0, `count=${dived.length}`);

  world.destroy();
}

console.log(`\n[oracle] DiveBomb ok — ${passed} assertions: enemy.dived (the dive clock elapses → the member peels off the rack: __formation cleared, __diving set, descending toward the player); counterfactual (long delay → never due, no event) holds.`);
process.exit(0);
