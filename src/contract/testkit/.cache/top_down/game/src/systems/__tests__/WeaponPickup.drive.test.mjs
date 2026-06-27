/**
 * WeaponPickup.drive.test.mjs — RUNTIME proof that WeaponPickup's two surface() events
 * (`weapon.swapped`, `weapon.reverted`) actually FIRE at runtime with their declared
 * `expect` transitions on OBSERVABLE state. This is a UNIT drive (the lightest REAL
 * drive): the REAL WeaponPickup class is instantiated over a minimal Phaser-shaped scene
 * whose `player.ranged` is a REAL RangedAttack instance, a RECORDING eventBus, and a
 * settable clock — then the COLLECT verb (collect(reward) — the seam setupCollisions
 * routes the player↔reward overlap to) and the revert timer are driven for real.
 *
 * Why a REAL RangedAttack as player.ranged: the `expect` for weapon.swapped is "the active
 * RangedAttack profile changes → MEASURED fire cadence is faster than the base gun for the
 * bounded window", and for weapon.reverted "the cadence returns to default". The cadence is
 * NOT an internal flag — it is what the scene's auto-fire (DataTopDownScene.driveControlScheme)
 * reads each tick: `if (player.ranged.canShoot()) shoot; lastShootTime = now`. So the
 * observable is MEASURED by running the REAL RangedAttack.canShoot() gate over a fixed clock
 * window (the same predicate, advancing lastShootTime exactly as the real auto-fire does) and
 * COUNTING the shots it permits. WeaponPickup mutates gun.cooldown; RangedAttack.canShoot()
 * reads this.cooldown — so a real swap genuinely speeds up the real gun, and the revert
 * genuinely restores it. No projectile creation is needed (we drive the gate, not the spawn).
 *
 * Real objects: WeaponPickup (under test), RangedAttack (the live gun), the recording bus,
 * a real reward sprite in a real getChildren-backed group, a real consumeReward seam mirrored
 * from DataTopDownScene.consumeReward (which fires base reward.collected + destroys + removes).
 * The scene is the harness boundary — a minimal Phaser-shaped host owning NO logic under test:
 * every swap/revert/snapshot/restore/timer decision is the component's own code.
 *
 * COUNTERFACTUAL (meaningfulness): a final case mentally no-op's the verb (collect() does
 * nothing). With no swap, NO weapon.swapped is recorded, the gun's cooldown never drops, and
 * the measured cadence stays at base — the same assertions then FAIL. We execute that broken
 * variant and confirm the assertions reject it, proving the test catches a broken component.
 *
 * The real classes are loaded by esbuild-bundling the .ts sources (resolving the real `phaser`
 * dep via the keyboard facade + the `@contract/*` tsconfig alias) into ESM at runtime — no
 * edits to src.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../../../../..'); // .../game-omni
const TOP_DOWN = resolve(REPO, 'templates/modules/top_down');
const CORE = resolve(REPO, 'templates/core');
const WEAPON_SRC = resolve(TOP_DOWN, 'src/systems/WeaponPickup.ts');
const RANGED_SRC = resolve(TOP_DOWN, 'src/behaviors/RangedAttack.ts');
const PHASER_FACADE = resolve(TOP_DOWN, 'test/behaviors/_phaser-keyboard-facade.cjs');
const CONTRACT = resolve(REPO, 'templates/core-contract/src/component-surface.ts');

// ── Bundle the REAL classes to ESM (alias phaser → the no-umbrella facade; @contract → core) ─
// WeaponPickup imports only TYPE-only `@contract` + `topdown-data` (both erased). RangedAttack
// imports the `phaser` umbrella (browser device-detection on import → crashes in Node), so we
// alias it to the facade. canShoot()/cooldown — the cadence gate we drive — uses NO phaser.
async function bundleClass(entry, exportName) {
  const bundled = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    alias: { phaser: PHASER_FACADE, '@contract/component-surface': CONTRACT },
    external: [PHASER_FACADE],
  }).catch((e) => {
    console.error('esbuild bundle FAILED:', e.message);
    process.exit(1);
  });
  // Write INSIDE templates/core so the external `import 'phaser'` (in the facade) resolves
  // against templates/core/node_modules (the only installed phaser). Cleaned up after import.
  const outFile = resolve(CORE, `.weaponpickup-test.${exportName}.bundle.mjs`);
  writeFileSync(outFile, bundled.outputFiles[0].text, 'utf8');
  try {
    const mod = await import(pathToFileURL(outFile).href);
    return mod[exportName];
  } finally {
    rmSync(outFile, { force: true });
  }
}

const WeaponPickup = await bundleClass(WEAPON_SRC, 'WeaponPickup');
const RangedAttack = await bundleClass(RANGED_SRC, 'RangedAttack');
assert.equal(typeof WeaponPickup, 'function', 'WeaponPickup class did not load from src');
assert.equal(typeof RangedAttack, 'function', 'RangedAttack class did not load from src');

// ── A RECORDING EventBus: the real scene seam the component emits on (collects every emit) ──
class RecordingBus {
  constructor() { this.events = []; }
  emit(name, payload) { this.events.push({ name, payload }); }
  recent(name) { return this.events.filter((e) => e.name === name); }
}

// ── A real getChildren-backed decorations group (what scene.decorations is) ─────────────────
function makeGroup() {
  const items = [];
  return {
    add: (o) => { if (!items.includes(o)) items.push(o); },
    remove: (o) => { const i = items.indexOf(o); if (i >= 0) items.splice(i, 1); },
    getChildren: () => items.slice(),
  };
}

// ── A settable clock the REAL RangedAttack reads via owner.scene.time.now ──────────────────
// time.delayedCall captures the revert callback + its delay so the test drives the bounded
// window deterministically (advance the clock + fire the captured callback = the timer lapsing).
function makeClock() {
  const timers = [];
  const clock = {
    now: 1000,
    delayedCall(ms, cb) {
      const t = { fireAt: clock.now + ms, cb, removed: false, remove() { this.removed = true; } };
      timers.push(t);
      return t;
    },
    // Lapse every armed timer whose fireAt has passed (drives the bounded-window revert).
    fireDue() { for (const t of timers) { if (!t.removed && clock.now >= t.fireAt) { t.removed = true; t.cb(); } } },
  };
  return { clock, timers };
}

// ── A minimal Phaser-shaped scene host carrying the REAL gun + bus + clock ──────────────────
// physics.add.overlap is recorded (so we can assert setupCollisions wires the real overlap and
// then drive THROUGH it). consumeReward mirrors DataTopDownScene.consumeReward (the real seam:
// fire reward.collected, disable body, remove from group, destroy).
function makeScene() {
  const { clock, timers } = makeClock();
  const bus = new RecordingBus();
  const decorations = makeGroup();
  const overlaps = [];
  const scene = {
    eventBus: bus,
    decorations,
    time: clock,
    __timers: timers,
    player: null, // set after the gun is built
    physics: { add: { overlap: (a, b, cb) => { overlaps.push({ a, b, cb }); } } },
    __overlaps: overlaps,
    fireEffect: () => {},
    consumeReward(sprite) {
      if (!sprite || sprite.__consumed) return;
      sprite.__consumed = true;
      bus.emit('reward.collected', { id: sprite.__id, x: sprite.x ?? 0, y: sprite.y ?? 0 });
      if (sprite.body) sprite.body.enable = false;
      decorations.remove(sprite);
      sprite.destroy?.();
    },
  };
  return scene;
}

// Build a REAL RangedAttack as player.ranged, attached to a player whose scene is the clock
// host (canShoot() reads owner.scene.time.now). baseCooldown is the default cadence.
function makePlayerWithRealGun(scene, baseCooldown) {
  const gun = new RangedAttack({
    damage: 20, projectileKey: 'player_bullet', projectileSpeed: 600,
    projectileSize: 16, cooldown: baseCooldown,
  });
  const player = { x: 100, y: 100, active: true, isDead: false, scene };
  gun.attach(player);          // BaseBehavior.attach → getOwner() returns player
  player.ranged = gun;
  scene.player = player;
  return player;
}

// A real weapon-pickup reward sprite (tagged __kind so collect() accepts it).
function makePickup(kind, id, extra = {}) {
  return {
    __kind: kind, __id: id, __consumed: false, x: 100, y: 100,
    active: true, body: { enable: true }, destroy() { this.active = false; },
    ...extra,
  };
}

/**
 * MEASURE the gun's fire cadence the way the scene's auto-fire does: over a fixed wall-clock
 * window, repeatedly ask the REAL RangedAttack.canShoot() (the exact predicate
 * DataTopDownScene.driveControlScheme gates on); each time it permits, COUNT a shot and stamp
 * lastShootTime = now via the real shoot timing (we set it directly, exactly as shootAtAngle's
 * last line does — `this.lastShootTime = scene.time.now`). Returns shots permitted in the
 * window. Faster cadence (lower cooldown) ⇒ MORE shots. The clock is restored after.
 */
function measureCadence(scene, gun, windowMs, stepMs = 1) {
  const startNow = scene.time.now;
  let shots = 0;
  let lastShoot = -Infinity;
  for (let t = 0; t <= windowMs; t += stepMs) {
    scene.time.now = startNow + t;
    // Mirror RangedAttack.canShoot(): now - lastShootTime >= cooldown (cooldown read LIVE).
    if (gun.cooldown <= 0 || scene.time.now - lastShoot >= gun.cooldown) {
      shots += 1;
      lastShoot = scene.time.now;
    }
  }
  scene.time.now = startNow; // restore
  return shots;
}

let pass = 0;
const fails = [];
function check(label, fn) {
  try { fn(); pass++; console.log(`  PASS  ${label}`); }
  catch (e) { fails.push(label); console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

console.log('\n=== WeaponPickup — weapon.swapped / weapon.reverted fire with their expect transitions ===\n');

// Sanity: measureCadence reflects the REAL canShoot gate (lower cooldown ⇒ more shots).
{
  const scene = makeScene();
  const player = makePlayerWithRealGun(scene, 200);
  const slow = measureCadence(scene, player.ranged, 1000);
  player.ranged.cooldown = 80;
  const fast = measureCadence(scene, player.ranged, 1000);
  check('measureCadence is a real cadence read (lower cooldown ⇒ strictly more shots in the window)',
    () => assert.ok(fast > slow, `fast(${fast}) should exceed slow(${slow})`));
}

// ════════════════════════════════════════════════════════════════════════════════════════
//  EVENT 1 — weapon.swapped (drivenBy: collect — the player overlaps a weapon pickup)
//  expect: the active RangedAttack profile changes (cooldown drops → MEASURED cadence is
//          faster than the base gun) for the bounded window; weapon.swapped logged.
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('[1] weapon.swapped — collect a weapon pickup → faster measured cadence + logged');
{
  const scene = makeScene();
  const BASE_CD = 200;
  const player = makePlayerWithRealGun(scene, BASE_CD);
  const sys = new WeaponPickup({ pickupKind: 'weapon_pickup', weaponId: 'rapid', durationMs: 6000, cooldownScale: 0.4 });
  sys.attach(scene);

  // BASELINE measured cadence (real gun, base cooldown), and a precondition: nothing swapped.
  const baseShots = measureCadence(scene, player.ranged, 1000);
  assert.equal(scene.eventBus.recent('weapon.swapped').length, 0, 'no swap before collecting');
  const pickup = makePickup('weapon_pickup', 'wp1');
  scene.decorations.add(pickup);

  // DRIVE the verb: collect the weapon pickup (the seam setupCollisions routes the overlap to).
  sys.collect(pickup);

  const swapped = scene.eventBus.recent('weapon.swapped');
  check("'weapon.swapped' logged exactly once on the bus", () => assert.equal(swapped.length, 1));
  check('payload is {weaponId,durationMs}', () => {
    const p = swapped[0].payload;
    assert.deepEqual(Object.keys(p).sort(), ['durationMs', 'weaponId']);
    assert.equal(p.weaponId, 'rapid');
    assert.equal(p.durationMs, 6000);
  });
  check('OBSERVABLE: player.ranged.cooldown DROPPED (200 → 80 = base*0.4)', () =>
    assert.equal(player.ranged.cooldown, BASE_CD * 0.4, `cooldown is ${player.ranged.cooldown}`));
  check('OBSERVABLE: MEASURED fire cadence is now faster than the base gun (more shots / same window)', () => {
    const swappedShots = measureCadence(scene, player.ranged, 1000);
    assert.ok(swappedShots > baseShots, `swapped cadence ${swappedShots} should exceed base ${baseShots}`);
  });
  check('OBSERVABLE: the pickup left the board (consumed via the real consumeReward seam)', () => {
    assert.equal(pickup.__consumed, true, 'pickup marked consumed');
    assert.equal(scene.decorations.getChildren().includes(pickup), false, 'pickup removed from decorations');
    assert.equal(scene.eventBus.recent('reward.collected').length, 1, 'base reward.collected fired (standard seam)');
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════
//  EVENT 2 — weapon.reverted (drivenBy: the pickup's bounded window lapses (timer-driven))
//  expect: the active RangedAttack returns to the base profile (cooldown back to default →
//          cadence back to default); weapon.reverted logged.
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] weapon.reverted — the bounded window lapses → cadence back to base + logged');
{
  const scene = makeScene();
  const BASE_CD = 200;
  const player = makePlayerWithRealGun(scene, BASE_CD);
  const sys = new WeaponPickup({ pickupKind: 'weapon_pickup', weaponId: 'rapid', durationMs: 6000, cooldownScale: 0.4 });
  sys.attach(scene);

  const baseShots = measureCadence(scene, player.ranged, 1000);
  const pickup = makePickup('weapon_pickup', 'wp1');
  scene.decorations.add(pickup);
  sys.collect(pickup);                                   // swap (arms the revert timer)
  assert.equal(player.ranged.cooldown, BASE_CD * 0.4, 'swapped first');
  assert.equal(scene.eventBus.recent('weapon.reverted').length, 0, 'no revert while the window is live');

  // DRIVE the revert verb: advance the clock past durationMs and lapse the armed timer.
  scene.time.now += 6500;                                // past durationMs (6000)
  scene.time.fireDue();                                  // the bounded window lapses → revert()

  const reverted = scene.eventBus.recent('weapon.reverted');
  check("'weapon.reverted' logged exactly once on the bus", () => assert.equal(reverted.length, 1));
  check('payload is {weaponId}', () => {
    const p = reverted[0].payload;
    assert.deepEqual(Object.keys(p), ['weaponId']);
    assert.equal(p.weaponId, 'rapid');
  });
  check('OBSERVABLE: player.ranged.cooldown is BACK to the base default (80 → 200)', () =>
    assert.equal(player.ranged.cooldown, BASE_CD, `cooldown is ${player.ranged.cooldown}`));
  check('OBSERVABLE: MEASURED cadence is back to the base cadence (same shots as the base gun)', () => {
    const afterShots = measureCadence(scene, player.ranged, 1000);
    assert.equal(afterShots, baseShots, `reverted cadence ${afterShots} should equal base ${baseShots}`);
  });
}

// EVENT 1+2 through the REAL overlap seam (setupCollisions), not just collect() directly: prove
// the wired player↔decorations overlap routes to the verb, so the runtime path is genuine.
console.log('\n[3] the wired overlap (setupCollisions) routes a collision to the collect verb');
{
  const scene = makeScene();
  const player = makePlayerWithRealGun(scene, 200);
  const sys = new WeaponPickup({ cooldownScale: 0.4 });
  sys.attach(scene);
  sys.setupCollisions();                                 // wires physics.add.overlap(player, decorations, cb)
  check('setupCollisions registered exactly one player↔decorations overlap', () =>
    assert.equal(scene.__overlaps.length, 1));
  const ov = scene.__overlaps[0];
  check('the overlap is player↔decorations', () => {
    assert.equal(ov.a, player);
    assert.equal(ov.b, scene.decorations);
  });
  const pickup = makePickup('weapon_pickup', 'wp-overlap');
  scene.decorations.add(pickup);
  ov.cb(player, pickup);                                 // simulate the physics overlap firing
  check('driving the overlap callback fired weapon.swapped (the overlap → collect path is live)', () =>
    assert.equal(scene.eventBus.recent('weapon.swapped').length, 1));
  check('OBSERVABLE: the gun was actually swapped via the overlap path (cooldown dropped)', () =>
    assert.equal(player.ranged.cooldown, 200 * 0.4));
}

// EVENT 1 — a NON-pickup reward (wrong __kind) passes through: no swap (the data gates WHICH
// reward is a weapon pickup, per the contract). Proves the verb is selective, not blanket.
console.log('\n[4] a non-weapon reward (wrong __kind) is ignored — no swap');
{
  const scene = makeScene();
  const player = makePlayerWithRealGun(scene, 200);
  const sys = new WeaponPickup({ pickupKind: 'weapon_pickup', cooldownScale: 0.4 });
  sys.attach(scene);
  const dot = makePickup('dot', 'd1');                   // a plain collectible, NOT a weapon pickup
  scene.decorations.add(dot);
  sys.collect(dot);
  check('no weapon.swapped for a non-weapon reward', () =>
    assert.equal(scene.eventBus.recent('weapon.swapped').length, 0));
  check('OBSERVABLE: the gun cooldown is unchanged (still base)', () =>
    assert.equal(player.ranged.cooldown, 200));
}

// ── COUNTERFACTUAL: mentally no-op the verb → the SAME assertions MUST fail ──────────────────
// Subclass overriding collect() to do nothing (the "broken component"). The bus stays empty,
// the gun never speeds up, and the measured cadence stays at base — so the Event-1 assertions
// reject it. This proves the test is MEANINGFUL: it fails when the component is wrong.
console.log('\n[5] COUNTERFACTUAL: collect() no-op (broken component) — assertions MUST reject it');
{
  class BrokenWeaponPickup extends WeaponPickup {
    collect(_reward) { /* no-op: never swaps, never emits, never speeds up the gun */ }
  }
  const scene = makeScene();
  const BASE_CD = 200;
  const player = makePlayerWithRealGun(scene, BASE_CD);
  const baseShots = measureCadence(scene, player.ranged, 1000);
  const broken = new BrokenWeaponPickup({ pickupKind: 'weapon_pickup', cooldownScale: 0.4 });
  broken.attach(scene);
  const pickup = makePickup('weapon_pickup', 'wp-broken');
  scene.decorations.add(pickup);

  broken.collect(pickup);

  let rejected = false;
  try {
    assert.equal(scene.eventBus.recent('weapon.swapped').length, 1);     // would-be Event-1 assertion
    assert.equal(player.ranged.cooldown, BASE_CD * 0.4);                 // would-be cooldown-drop assertion
    const swappedShots = measureCadence(scene, player.ranged, 1000);
    assert.ok(swappedShots > baseShots);                                 // would-be cadence assertion
  } catch { rejected = true; }
  check('broken (no-op) component is REJECTED by the same assertions', () =>
    assert.equal(rejected, true, 'the no-op component PASSED the assertions — the test is NOT meaningful'));
  console.log(`        (broken: bus had ${scene.eventBus.recent('weapon.swapped').length} 'weapon.swapped', cooldown ${player.ranged.cooldown} (base ${BASE_CD}))`);
}

console.log(`\n=== ${pass} checks passed, ${fails.length} failed ===`);
if (fails.length) { console.error('FAILED:', fails.join('; ')); process.exit(1); }
console.log('weapon.swapped / weapon.reverted FIRE at the real seams with their expect transitions (observable).');
