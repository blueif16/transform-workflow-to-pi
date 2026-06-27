/**
 * FormationMarch — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/FormationMarch.ts):
 *   - formation.stepped  drivenBy "the count-scaled step timer elapsing (one march step)"
 *                        expect   "every live formation member advances one step (or reverses +
 *                                  drops at an edge); the step interval shrinks as alive count
 *                                  falls; formation.stepped logged"
 *   - formation.landed   drivenBy "the descending rack reaching the player row"
 *                        expect   "the player takes a lethal blow; __GAME__.status becomes 'lost';
 *                                  formation.landed logged"
 *
 * REAL drive through the REAL seam: FormationMarch reads scene.enemies (the .__formation members)
 * and step-marches them on a count-scaled fixed-step timer in update() — the SAME tick the engine
 * runs each frame. We isolate the system (remove the default level's bound systems so our mounted
 * marcher is the sole driver), build a clean known formation, and STEP the engine until the step
 * timer elapses → formation.stepped logs and every member ADVANCES one stepPx. For formation.landed
 * we place the rack at the player's row so a step lands it: the player takes the lethal blow and
 * __GAME__.status flips to 'lost'. A COUNTERFACTUAL steps fewer ms than the step interval → no step.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/FormationMarch.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** Remove the default level's bound scene systems + clear its formation, for a clean isolated drive. */
const isolate = (scene) => {
  if (Array.isArray(scene.systems)) scene.systems.length = 0; // drop the default FormationMarch/ProjectilePool/WaveLoop
  for (const e of [...scene.enemies.getChildren()]) e.destroy?.();
  scene.enemies.clear(true, true);
};
/** Build a clean known formation of .__formation members into scene.enemies. */
const buildRack = (scene, opts = {}) => {
  const cols = opts.cols ?? 4;
  const x0 = opts.x0 ?? 120;
  const y = opts.y ?? 160;
  const gap = opts.gap ?? 40;
  const made = [];
  for (let c = 0; c < cols; c++) {
    const s = scene.physics.add.sprite(x0 + c * gap, y, '__px');
    s.setDisplaySize(28, 22);
    s.body.setAllowGravity(false);
    s.body.setImmovable(true);
    s.__type = 'enemy';
    s.__formation = true;
    s.__id = `m_${c}`;
    s.isDead = false;
    s.takeDamage = (n) => { s.health = (s.health ?? 1) - n; if (s.health <= 0) { s.isDead = true; s.setActive(false); if (s.body) s.body.enable = false; } };
    scene.enemies.add(s);
    made.push(s);
  }
  return made;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: the step timer elapses → the rack advances one step (formation.stepped).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene);
  const rack = buildRack(scene, { y: 160 });

  // baseStepMs small so a few frames elapse one step; stepPx known.
  const march = world.mountSystem('FormationMarch', { baseStepMs: 30, floorMs: 30, stepPx: 14, dropPx: 24, edgeMargin: 8 });
  check('resolveSystem returned a real FormationMarch', march.constructor.name === 'FormationMarch', march.constructor.name);
  check('attach published the scene.__formationMarch seam', scene.__formationMarch === march, `seam=${scene.__formationMarch?.constructor?.name}`);
  check('precondition: the marcher sees the clean rack', march.aliveCount() === rack.length, `alive=${march.aliveCount()}`);

  const xBefore = rack.map((m) => m.x);
  const cur = bus.cursor;
  // DRIVE: step until the timer elapses (baseStepMs 30 ≈ 2 frames at 15ms) → one march step.
  for (let f = 0; f < 6 && bus.recent(cur).filter((e) => e.type === 'formation.stepped').length === 0; f++) world.step(1);
  const stepped = bus.recent(cur).filter((e) => e.type === 'formation.stepped');
  check('STEP: formation.stepped logged {alive,dir}', stepped.length >= 1 && stepped.at(-1)?.payload?.alive === rack.length && Math.abs(stepped.at(-1)?.payload?.dir) === 1, JSON.stringify(stepped.at(-1)?.payload));
  // OBSERVABLE: every member advanced along x (the rack moved as one body).
  const advanced = rack.every((m, i) => m.x !== xBefore[i]);
  check('STEP: every formation member advanced (the rack moved as one body)', advanced, `${xBefore} → ${rack.map((m) => m.x)}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: the rack reaching the player row LANDS (formation.landed → status 'lost').
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene);
  // Spawn the rack right AT the player's row so the very next step lands it. Place it ALSO
  // near the right edge so the step reverses+drops (the drop is what checks landing).
  const playerTop = scene.player.y - (scene.player.displayHeight ?? 32) / 2;
  const rack = buildRack(scene, { x0: 360, y: playerTop - 2, gap: 20 });

  const march = world.mountSystem('FormationMarch', { baseStepMs: 30, floorMs: 30, stepPx: 14, dropPx: 24, edgeMargin: 8, landDamage: 9999 });
  check('LAND precondition: status is playing before the landing', scene.registry.get('status') === 'playing', `status=${scene.registry.get('status')}`);

  const cur = bus.cursor;
  // DRIVE: step until the rack reaches an edge → reverse+drop → it crosses the player row.
  for (let f = 0; f < 30 && scene.registry.get('status') !== 'lost'; f++) world.step(1);
  const landed = bus.recent(cur).filter((e) => e.type === 'formation.landed');
  check('LAND: formation.landed logged {alive}', landed.length >= 1 && typeof landed.at(-1)?.payload?.alive === 'number', JSON.stringify(landed.at(-1)?.payload));
  check("LAND: the player took a lethal blow → __GAME__.status became 'lost'", scene.registry.get('status') === 'lost', `status=${scene.registry.get('status')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with a step interval far larger than the
// stepped window, the timer never elapses — the rack does NOT move and
// formation.stepped never fires. If stepRack()/the emit ran every frame the STEP
// assertions would not prove the event is gated on the step timer.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene);
  const rack = buildRack(scene, { y: 160 });
  world.mountSystem('FormationMarch', { baseStepMs: 999999, floorMs: 999999, stepPx: 14 });

  const xBefore = rack.map((m) => m.x);
  const cur = bus.cursor;
  world.step(20); // ~300ms — far below the 999999ms step interval
  const stepped = bus.recent(cur).filter((e) => e.type === 'formation.stepped');
  check('counterfactual: timer not elapsed → no formation.stepped', stepped.length === 0, `count=${stepped.length}`);
  check('counterfactual: the rack did not move', rack.every((m, i) => m.x === xBefore[i]), `${xBefore} → ${rack.map((m) => m.x)}`);

  world.destroy();
}

console.log(`\n[oracle] FormationMarch ok — ${passed} assertions: formation.stepped (the step timer elapsing advances the whole rack) + formation.landed (the rack reaching the player row → status 'lost'); counterfactual (interval not elapsed → no step, no move) holds.`);
process.exit(0);
