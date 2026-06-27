/**
 * MushroomField — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/MushroomField.ts):
 *   - mushroom.cleared  drivenBy "a player bullet hits a mushroom enough times to take its last hit"
 *                       expect   "that mushroom is removed from scene.obstacles ⇒ __GAME__.entities
 *                                 obstacle count falls and the live mushroom count
 *                                 (scene.mushroomsRemaining) decreases; mushroom.cleared logged"
 *
 * REAL drive through the REAL seam: the system grows field mushrooms as static obstacles in
 * scene.obstacles and wires the player-bullet↔mushroom overlap in setupCollisions() — the SAME
 * overlap a fired bullet triggers. We drive that exact verb: with hitsToClear:1 (the last hit is
 * the first), place a real player bullet (in scene.playerBullets) ON a live field mushroom and
 * STEP — the overlap erodes it to zero hits → it leaves scene.obstacles (the obstacle count
 * falls), scene.mushroomsRemaining decreases, and mushroom.cleared logs. A 2-hit mushroom proves
 * the WHITTLE: one hit leaves it standing (no event), a second clears it. A COUNTERFACTUAL places
 * a bullet far from the field → nothing clears, no event.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/MushroomField.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** Live field mushrooms in scene.obstacles (the obstacle-count signal __GAME__ surfaces). */
const liveMushrooms = (scene) =>
  (scene.obstacles?.getChildren?.() ?? []).filter((c) => c?.active !== false && c.__mushroomField).length;
/**
 * Land EXACTLY ONE player-bullet hit on (x,y): park a real bullet in scene.playerBullets,
 * step ONE frame so the registered overlap fires once, then retire the bullet (mirroring how
 * ProjectilePool consumes a real pooled bullet after one bite, so it does not re-hit next frame).
 */
const oneHit = (world, scene, x, y) => {
  const b = scene.physics.add.sprite(x, y, '__px');
  b.setDisplaySize(6, 16);
  b.body.setAllowGravity(false);
  b.__type = 'projectile';
  b.setActive(true);
  b.setVisible(true);
  scene.playerBullets.add(b);
  world.step(1);
  b.setActive(false);
  if (b.body) b.body.enable = false;
  b.destroy();
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: bullets whittle a mushroom — last hit clears it (mushroom.cleared).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;

  // Two explicit field mushrooms at known points: one 1-hit (instant clear), one 2-hit (whittle).
  const field = world.mountSystem('MushroomField', {
    cells: [{ x: 120, y: 300 }, { x: 300, y: 300 }],
    cellPx: 20,
    hitsToClear: 1,
  });
  check('resolveSystem returned a real MushroomField', field.constructor.name === 'MushroomField', field.constructor.name);
  check('attach published the scene.__mushroomField seam', scene.__mushroomField === field, `seam=${scene.__mushroomField?.constructor?.name}`);

  const mushBefore = field.mushroomCount();
  check('precondition: two field mushrooms grown + mirrored', mushBefore === 2 && scene.mushroomsRemaining === 2 && liveMushrooms(scene) === 2, `count=${mushBefore} mirror=${scene.mushroomsRemaining} live=${liveMushrooms(scene)}`);

  // DRIVE (1-hit clear): a single real player-bullet hit ON the first mushroom clears it.
  let cur = bus.cursor;
  oneHit(world, scene, 120, 300);
  const cleared = bus.recent(cur).filter((e) => e.type === 'mushroom.cleared');
  check('CLEAR: the struck mushroom left scene.obstacles', liveMushrooms(scene) === mushBefore - 1, `before=${mushBefore} after=${liveMushrooms(scene)}`);
  check('CLEAR: the live mushroom count decreased (scene.mushroomsRemaining)', field.mushroomCount() === mushBefore - 1 && scene.mushroomsRemaining === mushBefore - 1, `count=${field.mushroomCount()} mirror=${scene.mushroomsRemaining}`);
  check('CLEAR: mushroom.cleared logged {id,remaining}', cleared.length === 1 && cleared.at(-1)?.payload?.id === 'mush_6_15' && cleared.at(-1)?.payload?.remaining === 1, JSON.stringify(cleared.at(-1)?.payload));

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// WHITTLE: a 2-hit mushroom stays standing on the FIRST hit (no event), clears on the SECOND.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const field = world.mountSystem('MushroomField', { cells: [{ x: 150, y: 280 }], cellPx: 20, hitsToClear: 2 });
  const before = field.mushroomCount();

  // First hit: erodes ONE stage but the mushroom stands — NO mushroom.cleared yet.
  let cur = bus.cursor;
  oneHit(world, scene, 150, 280);
  let cleared = bus.recent(cur).filter((e) => e.type === 'mushroom.cleared');
  check('WHITTLE: first hit leaves the mushroom standing (still in obstacles)', field.mushroomCount() === before && liveMushrooms(scene) === before, `count=${field.mushroomCount()}`);
  check('WHITTLE: first hit fires NO mushroom.cleared', cleared.length === 0, `count=${cleared.length}`);

  // Second hit: the last stage → the mushroom clears (mushroom.cleared).
  cur = bus.cursor;
  oneHit(world, scene, 150, 280);
  cleared = bus.recent(cur).filter((e) => e.type === 'mushroom.cleared');
  check('WHITTLE: second hit clears the mushroom (count -1)', field.mushroomCount() === before - 1, `count=${field.mushroomCount()}`);
  check('WHITTLE: second hit fires mushroom.cleared', cleared.length === 1, `count=${cleared.length}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a bullet far from any mushroom clears
// nothing — the field count is unchanged and no mushroom.cleared fires.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  const field = world.mountSystem('MushroomField', { cells: [{ x: 150, y: 280 }], cellPx: 20, hitsToClear: 1 });
  const before = field.mushroomCount();

  const cur = bus.cursor;
  oneHit(world, scene, 40, 700); // nowhere near the mushroom at (150,280)
  const cleared = bus.recent(cur).filter((e) => e.type === 'mushroom.cleared');
  check('counterfactual: far bullet → field count unchanged', field.mushroomCount() === before, `before=${before} after=${field.mushroomCount()}`);
  check('counterfactual: no mushroom.cleared', cleared.length === 0, `count=${cleared.length}`);

  world.destroy();
}

console.log(`\n[oracle] MushroomField ok — ${passed} assertions: mushroom.cleared (real player-bullet↔mushroom overlap whittles it: 1-hit instant + 2-hit whittle → obstacle count + scene.mushroomsRemaining fall); counterfactual holds.`);
process.exit(0);
