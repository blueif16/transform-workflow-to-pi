/**
 * EntrySpline — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/EntrySpline.ts):
 *   - enemy.entered  drivenBy "an enemy finishing its entry spline (it reaches its rack slot)"
 *                    expect   "the member stops flying, pins to its rack slot, becomes collidable,
 *                              and joins the formation; enemy.entered logged"
 *   - ship.captured  drivenBy "a captor beam reaching the player (the player sits under the captor column)"
 *                    expect   "__GAME__ registry 'shipCaptured' becomes true; the player's mover input
 *                              is frozen; ship.captured logged"
 *   - ship.rescued   drivenBy "the captor being destroyed while a ship is captured"
 *                    expect   "the captured flag clears; __GAME__.player.health increases (a regained
 *                              second ship); ship.rescued logged"
 *
 * REAL drive through the REAL seam: on attach EntrySpline re-parks each scene.enemies member at an
 * off-screen origin and flies it along a spline back to its built slot each update(); on arrival it
 * emits enemy.entered. Once settled it designates a CAPTOR that fires a beam down its column on a
 * cadence; a player in that x-band below it is captured (ship.captured); destroying the captor while
 * captured rescues the ship (ship.rescued). We isolate the level, build a clean 1-member rack so the
 * captor is known, and STEP: the member flies its spline in (enemy.entered); we then park the player
 * directly under the captor and STEP past the beam cadence (ship.captured); finally we KILL the captor
 * (the real bullet-kill condition) and STEP (ship.rescued). A COUNTERFACTUAL keeps the player OUT of
 * the captor's column → the beam never captures it.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/EntrySpline.oracle.test.mjs
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
/** One known .__formation member at a built slot (the entry target + the captor). */
const buildMember = (scene, x, y) => {
  const s = scene.physics.add.sprite(x, y, '__px');
  s.setDisplaySize(28, 22);
  s.body.setAllowGravity(false);
  s.__type = 'enemy';
  s.__formation = true;
  s.__row = 0;
  s.__col = 0;
  s.__id = 'captor_m';
  s.isDead = false;
  s.maxHealth = 1;
  s.health = 1;
  s.kill = () => { if (s.isDead) return; s.isDead = true; s.setActive(false); if (s.body) s.body.enable = false; };
  scene.enemies.add(s);
  return s;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: the member flies its spline IN (enemy.entered), is captured (ship.captured),
// then rescued (ship.rescued).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene);
  const member = buildMember(scene, 200, 140); // its rack slot

  const spline = world.mountSystem('EntrySpline', { entryMs: 60, entryStaggerMs: 0, captorBeamMs: 30, beamBandPx: 30, rescueBonus: 1 });
  check('resolveSystem returned a real EntrySpline', spline.constructor.name === 'EntrySpline', spline.constructor.name);
  check('attach published the scene.__entrySpline seam + shipCaptured=false', scene.__entrySpline === spline && scene.shipCaptured === false, `seam=${scene.__entrySpline?.constructor?.name} captured=${scene.shipCaptured}`);
  // On attach the member was re-parked OFF-SCREEN (entering) — not at its slot anymore.
  check('precondition: the member is flagged entering (re-parked off-screen)', member.__entering === true, `entering=${member.__entering}`);

  // DRIVE (entered): step until the entry spline completes → the member pins to its slot.
  let cur = bus.cursor;
  for (let f = 0; f < 12 && bus.recent(cur).filter((e) => e.type === 'enemy.entered').length === 0; f++) world.step(1);
  const entered = bus.recent(cur).filter((e) => e.type === 'enemy.entered');
  check('ENTERED: enemy.entered logged {id} at the rack slot', entered.length === 1 && entered.at(-1)?.payload?.id === 'captor_m', JSON.stringify(entered.at(-1)?.payload));
  check('ENTERED: the member stopped entering + pinned to its slot (200,140)', member.__entering === false && Math.round(member.x) === 200 && Math.round(member.y) === 140, `entering=${member.__entering} pos=${Math.round(member.x)},${Math.round(member.y)}`);
  check('ENTERED: the member became collidable (body enabled)', member.body?.enable === true, `enable=${member.body?.enable}`);

  // DRIVE (captured): park the player directly UNDER the settled captor's column, then step past
  // the beam cadence so the captor beam reaches it.
  scene.player.x = member.x;     // same x-band as the captor column
  scene.player.y = member.y + 200; // below the captor
  cur = bus.cursor;
  for (let f = 0; f < 6 && !scene.shipCaptured; f++) world.step(1);
  const captured = bus.recent(cur).filter((e) => e.type === 'ship.captured');
  check('CAPTURED: the registry shipCaptured flag became true', scene.shipCaptured === true && scene.registry.get('shipCaptured') === true, `captured=${scene.shipCaptured}`);
  check('CAPTURED: ship.captured logged {captorId}', captured.length >= 1 && captured.at(-1)?.payload?.captorId === 'captor_m', JSON.stringify(captured.at(-1)?.payload));

  // DRIVE (rescued): destroy the captor while the ship is held → the ship is rescued.
  const healthBefore = scene.player.health ?? 0;
  scene.player.maxHealth = scene.player.maxHealth ?? 1;
  cur = bus.cursor;
  member.kill(); // the real bullet-kill condition on the captor
  world.step(2);
  const rescued = bus.recent(cur).filter((e) => e.type === 'ship.rescued');
  check('RESCUED: the captured flag cleared', scene.shipCaptured === false, `captured=${scene.shipCaptured}`);
  check('RESCUED: the player regained a second ship (health increased)', (scene.player.health ?? 0) > healthBefore, `${healthBefore} → ${scene.player.health}`);
  check('RESCUED: ship.rescued logged {health}', rescued.length === 1 && typeof rescued.at(-1)?.payload?.health === 'number', JSON.stringify(rescued.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with the player OUT of the captor's column
// the beam never reaches it — shipCaptured stays false and ship.captured never
// fires. If tickCaptor() captured regardless of the player's x-band, the CAPTURED
// assertion would not prove the column geometry is real.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene);
  const member = buildMember(scene, 200, 140);
  world.mountSystem('EntrySpline', { entryMs: 60, entryStaggerMs: 0, captorBeamMs: 30, beamBandPx: 20 });
  // Park the player FAR from the captor column (outside the beam band) BEFORE any beam can fire,
  // so the capture never happens — not even while the entries settle.
  scene.player.x = member.x + 200;
  scene.player.y = member.y + 200;
  // settle the member (the player is already off-column the whole time)
  for (let f = 0; f < 12; f++) world.step(1);

  const cur = bus.cursor;
  world.step(10); // plenty of beam pulses, but the player is not under the column
  const captured = bus.recent(cur).filter((e) => e.type === 'ship.captured');
  check('counterfactual: player off-column → shipCaptured stays false', scene.shipCaptured === false, `captured=${scene.shipCaptured}`);
  check('counterfactual: no ship.captured', captured.length === 0, `count=${captured.length}`);

  world.destroy();
}

console.log(`\n[oracle] EntrySpline ok — ${passed} assertions: enemy.entered (the spline completes → the member pins to its slot + becomes collidable) + ship.captured (the captor beam in-column captures the player: shipCaptured true) + ship.rescued (killing the captor regains a second ship); counterfactual (player off-column → no capture) holds.`);
process.exit(0);
