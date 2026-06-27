/**
 * BossPhase — ORACLE drive test (event-protocol conformance, gallery_shooter).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * gallery_shooter engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/gallery_shooter/src/systems/BossPhase.ts):
 *   - boss.phaseChanged  drivenBy "the boss HP crosses a phase threshold (a downward HP-band boundary)"
 *                        expect   "the boss phase index increments (scene.bossPhase ⇒ __GAME__ boss
 *                                  phase rises) and the boss escalates to a wider/faster attack;
 *                                  boss.phaseChanged logged"
 *   - boss.defeated      drivenBy "the boss HP reaches 0"
 *                        expect   "the boss dies and scene.onLevelComplete() fires ⇒ __GAME__.status
 *                                  becomes 'won'; boss.defeated logged"
 *
 * REAL drive through the REAL seam: BossPhase spawns the boss the frame the formation is cleared,
 * adds it to scene.enemies with a .takeDamage(n) seam, and ProjectilePool's playerBullets↔enemies
 * overlap calls THAT seam on a hit. We isolate the level (drop its bound systems + formation) so
 * the boss spawns on the first tick, then DRIVE the exact verb a player shot invokes — the boss
 * sprite's .takeDamage(n) (the engine-wired bullet→boss damage seam). Damaging across an HP band
 * boundary escalates the phase (scene.bossPhase rises ⇒ boss.phaseChanged); damaging to 0 defeats
 * the boss ⇒ scene.onLevelComplete flips __GAME__.status to 'won' (boss.defeated). A COUNTERFACTUAL
 * damages the boss only WITHIN one band → its HP falls but the phase does NOT change, no event.
 *
 *   node templates/modules/gallery_shooter/src/systems/__tests__/BossPhase.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};
/** Drop the default level's systems + formation so the boss-phase gate (formation cleared) is open. */
const isolate = (scene) => {
  if (Array.isArray(scene.systems)) scene.systems.length = 0;
  for (const e of [...scene.enemies.getChildren()]) e.destroy?.();
  scene.enemies.clear(true, true);
};
const findBoss = (scene) => scene.enemies.getChildren().find((e) => e.__isBoss && e.active !== false);

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: damage the boss across a band → phase++ (boss.phaseChanged), then to 0 (boss.defeated).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene);

  // bossHp 10, 2 phases → HP band boundary at 5 (frac 0.5). Damage 5 crosses into phase 2.
  const boss = world.mountSystem('BossPhase', { bossHp: 10, phaseCount: 2, bossDamage: 1, baseFireMs: 999999 });
  check('resolveSystem returned a real BossPhase', boss.constructor.name === 'BossPhase', boss.constructor.name);
  check('attach published the scene.__bossPhase seam + phase mirror', scene.__bossPhase === boss && scene.bossPhase === 1, `seam=${scene.__bossPhase?.constructor?.name} phase=${scene.bossPhase}`);

  // Step once: the formation is cleared (empty) → the boss spawns.
  world.step(1);
  const bossSprite = findBoss(scene);
  check('SPAWN: the boss spawned into scene.enemies (HP mirrored to scene.enemyHP)', !!bossSprite && scene.enemyHP === 10 && boss.bossHP() === 10, `boss=${!!bossSprite} enemyHP=${scene.enemyHP}`);
  check('SPAWN: starts at phase 1', boss.bossPhaseIndex() === 1, `phase=${boss.bossPhaseIndex()}`);

  // DRIVE (phase change): a player shot deals 5 damage via the engine-wired .takeDamage seam.
  let cur = bus.cursor;
  bossSprite.takeDamage(5); // the exact seam ProjectilePool's bullet↔enemies overlap calls
  const phaseEvents = bus.recent(cur).filter((e) => e.type === 'boss.phaseChanged');
  check('PHASE: the boss HP fell (scene.enemyHP) to 5', scene.enemyHP === 5 && boss.bossHP() === 5, `enemyHP=${scene.enemyHP}`);
  check('PHASE: the phase index incremented (scene.bossPhase ⇒ phase 2)', boss.bossPhaseIndex() === 2 && scene.bossPhase === 2, `phase=${boss.bossPhaseIndex()} mirror=${scene.bossPhase}`);
  check('PHASE: boss.phaseChanged logged {phase:2,hp}', phaseEvents.length >= 1 && phaseEvents.at(-1)?.payload?.phase === 2 && phaseEvents.at(-1)?.payload?.hp === 5, JSON.stringify(phaseEvents.at(-1)?.payload));

  // DRIVE (defeat): finish the boss — HP to 0 → it dies and the level is WON.
  cur = bus.cursor;
  bossSprite.takeDamage(5);
  const defeated = bus.recent(cur).filter((e) => e.type === 'boss.defeated');
  check('DEFEAT: boss.defeated logged {id,maxHp}', defeated.length === 1 && defeated.at(-1)?.payload?.maxHp === 10, JSON.stringify(defeated.at(-1)?.payload));
  check("DEFEAT: the boss death won the level → __GAME__.status 'won'", scene.registry.get('status') === 'won', `status=${scene.registry.get('status')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): damage that stays WITHIN one HP band drops
// the boss HP but does NOT cross a threshold — the phase stays put and
// boss.phaseChanged does NOT fire. If damageBoss() escalated on any hit, the PHASE
// assertion would not prove the event is gated on a band crossing.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'gallery_shooter' });
  const { scene, bus } = world;
  isolate(scene);
  const boss = world.mountSystem('BossPhase', { bossHp: 10, phaseCount: 2, bossDamage: 1, baseFireMs: 999999 });
  world.step(1);
  const bossSprite = findBoss(scene);

  const cur = bus.cursor;
  bossSprite.takeDamage(2); // 10→8, still in band 1 (boundary is at 5) — no crossing
  const phaseEvents = bus.recent(cur).filter((e) => e.type === 'boss.phaseChanged');
  const defeated = bus.recent(cur).filter((e) => e.type === 'boss.defeated');
  check('counterfactual: HP fell (10→8) but stayed in band 1', scene.enemyHP === 8, `enemyHP=${scene.enemyHP}`);
  check('counterfactual: phase unchanged (still 1)', boss.bossPhaseIndex() === 1 && scene.bossPhase === 1, `phase=${boss.bossPhaseIndex()}`);
  check('counterfactual: no boss.phaseChanged / boss.defeated', phaseEvents.length === 0 && defeated.length === 0, `phase=${phaseEvents.length} defeated=${defeated.length}`);
  check('counterfactual: not won (boss alive)', scene.registry.get('status') !== 'won', `status=${scene.registry.get('status')}`);

  world.destroy();
}

console.log(`\n[oracle] BossPhase ok — ${passed} assertions: boss.phaseChanged (a player shot crossing an HP band escalates scene.bossPhase) + boss.defeated (HP→0 wins: status 'won'); counterfactual (in-band damage → no phase change) holds.`);
process.exit(0);
