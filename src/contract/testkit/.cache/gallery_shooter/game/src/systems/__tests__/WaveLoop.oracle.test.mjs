/**
 * WaveLoop — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/WaveLoop.ts):
 *   - wave.cleared  drivenBy "the on-screen formation alive count reaching 0"
 *                   expect   "either the next (harder) formation spawns or — on the final wave —
 *                             __GAME__.status becomes 'won'; wave.cleared logged"
 *   - wave.started  drivenBy "a fresh formation spawning after the prior was cleared"
 *                   expect   "new formation members enter __GAME__.entities; __GAME__.waveIndex
 *                             increments; wave.started logged"
 *
 * REAL drive through the REAL seam: WaveLoop watches the formation alive count each update(): once
 * it has SEEN a formation and the count falls to 0 it fires wave.cleared, then either spawns the
 * next wave (scene.spawnFormation → wave.started, waveIndex++) or wins. We isolate the system (drop
 * the default level's bound systems so our WaveLoop is the sole driver), build a clean formation so
 * it latches "seen", then KILL every member (the real "alive count reaches 0" condition a bullet
 * sweep produces) and STEP. With maxWaves:1 the clear is the WIN (status 'won'); with maxWaves:2 the
 * clear spawns a fresh wave (wave.started + waveIndex increments). A COUNTERFACTUAL keeps the
 * formation alive → no clear, no win.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/WaveLoop.oracle.test.mjs
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
  if (Array.isArray(scene.systems)) scene.systems.length = 0;
  for (const e of [...scene.enemies.getChildren()]) e.destroy?.();
  scene.enemies.clear(true, true);
};
const buildRack = (scene, cols = 3) => {
  const made = [];
  for (let c = 0; c < cols; c++) {
    const s = scene.physics.add.sprite(120 + c * 40, 160, '__px');
    s.setDisplaySize(28, 22);
    s.body.setAllowGravity(false);
    s.__type = 'enemy';
    s.__formation = true;
    s.__id = `m_${c}`;
    s.isDead = false;
    s.kill = () => { if (s.isDead) return; s.isDead = true; s.setActive(false); if (s.body) s.body.enable = false; };
    scene.enemies.add(s);
    made.push(s);
  }
  return made;
};
const aliveFormation = (scene) =>
  scene.enemies.getChildren().filter((e) => e.__formation && e.active !== false && !e.isDead).length;

// ════════════════════════════════════════════════════════════════════════════
// DRIVE (win): clearing the final wave wins (wave.cleared → status 'won').
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene);
  const rack = buildRack(scene, 3);

  const wave = world.mountSystem('WaveLoop', { maxWaves: 1 });
  check('resolveSystem returned a real WaveLoop', wave.constructor.name === 'WaveLoop', wave.constructor.name);
  check('WaveLoop took ownership of the win (suppressDefaultWin)', scene.suppressDefaultWin === true, `suppress=${scene.suppressDefaultWin}`);

  // Let it SEE the formation (so a later alive==0 is a genuine clear, not the pre-build frame).
  world.step(2);
  check('precondition: a live formation seen', aliveFormation(scene) === 3, `alive=${aliveFormation(scene)}`);

  // DRIVE: kill every member — the real "alive count reaches 0" condition (a bullet sweep).
  for (const m of rack) m.kill();
  const cur = bus.cursor;
  world.step(2);
  const cleared = bus.recent(cur).filter((e) => e.type === 'wave.cleared');
  check('WIN: wave.cleared logged {wave:1}', cleared.length === 1 && cleared.at(-1)?.payload?.wave === 1, JSON.stringify(cleared.at(-1)?.payload));
  check("WIN: the final wave cleared → __GAME__.status became 'won'", scene.registry.get('status') === 'won', `status=${scene.registry.get('status')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// DRIVE (next wave): clearing wave 1 of 2 spawns the next (wave.started, waveIndex++).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene);
  const rack = buildRack(scene, 3);

  const wave = world.mountSystem('WaveLoop', { maxWaves: 2, addRowsPerWave: 1 });
  world.step(2); // see the formation
  check('NEXT precondition: waveIndex starts at 1', scene.waveIndex === 1, `waveIndex=${scene.waveIndex}`);

  // DRIVE: clear wave 1 → WaveLoop spawns the next wave via scene.spawnFormation (the real seam).
  for (const m of rack) m.kill();
  const cur = bus.cursor;
  world.step(2);
  const cleared = bus.recent(cur).filter((e) => e.type === 'wave.cleared');
  const started = bus.recent(cur).filter((e) => e.type === 'wave.started');
  check('NEXT: wave.cleared {wave:1} logged', cleared.length >= 1 && cleared.at(-1)?.payload?.wave === 1, JSON.stringify(cleared.at(-1)?.payload));
  check('NEXT: wave.started {wave:2} logged', started.length === 1 && started.at(-1)?.payload?.wave === 2, JSON.stringify(started.at(-1)?.payload));
  check('NEXT: __GAME__.waveIndex incremented to 2', scene.waveIndex === 2, `waveIndex=${scene.waveIndex}`);
  check('NEXT: fresh formation members entered __GAME__.entities', aliveFormation(scene) > 0, `alive=${aliveFormation(scene)}`);
  check('NEXT: the level did NOT win (more waves remain)', scene.registry.get('status') !== 'won', `status=${scene.registry.get('status')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): while the formation stays ALIVE the wave
// never clears — no wave.cleared/started and no win. If update() fired the clear
// regardless of the alive count, the DRIVE assertions would not prove the gate.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene);
  buildRack(scene, 3); // a live formation, never killed

  world.mountSystem('WaveLoop', { maxWaves: 1 });
  const cur = bus.cursor;
  world.step(10); // run, but the formation stays alive
  const cleared = bus.recent(cur).filter((e) => e.type === 'wave.cleared');
  const started = bus.recent(cur).filter((e) => e.type === 'wave.started');
  check('counterfactual: formation alive → no wave.cleared/started', cleared.length === 0 && started.length === 0, `cleared=${cleared.length} started=${started.length}`);
  check('counterfactual: no win while the formation lives', scene.registry.get('status') !== 'won', `status=${scene.registry.get('status')}`);

  world.destroy();
}

console.log(`\n[oracle] WaveLoop ok — ${passed} assertions: wave.cleared (alive→0 wins on the final wave: status 'won') + wave.started (a mid-quota clear spawns the next wave: waveIndex++, new members); counterfactual (formation alive → no clear) holds.`);
process.exit(0);
