/**
 * PickupHeart.drive.test.mjs — RUNTIME proof that PickupHeart's surface() event
 * (`health.restored`) actually FIRES at runtime with its declared `expect` transition on
 * OBSERVABLE state. This is a UNIT drive (the lightest REAL drive): the REAL PickupHeart
 * class is instantiated over a minimal Phaser-shaped scene whose `player` carries the REAL
 * BasePlayer.heal clamp, a RECORDING eventBus, and a real getChildren-backed decorations
 * group — then the COLLECT verb (collect(reward) — the seam setupCollisions routes the
 * player↔reward overlap to) is driven for real.
 *
 * Why the assertion is genuinely on __GAME__: the surface() `expect` is "__GAME__.player.health
 * increases by the heal amount, clamped at player.maxHealth; the heart leaves __GAME__.entities;
 * health.restored logged". The production hook (templates/core/src/hook.ts) builds those two
 * observables by reading, VERBATIM, `health: num(player.health)` / `maxHealth: num(player.maxHealth)`
 * (buildPlayer) and the children of the scene's `decorations` group (collectEntities). So this
 * test re-derives __GAME__ with `gameView(scene)` — the EXACT same field reads — and asserts the
 * transition THROUGH that __GAME__ view (player.health rose by the clamped delta; the heart is no
 * longer in entities[]). The health is NOT an internal flag: it is `player.health`, the very field
 * the hook surfaces; the entities list is the live decorations children, exactly what the hook
 * collects. No projectile/render is needed.
 *
 * Why the player's heal is REAL, not a stub returning the expected value: PickupHeart
 * "re-implements NOTHING the engine owns — the clamp-at-maxHealth is BasePlayer.heal()
 * (`this.health = Math.min(this.health + amount, this.maxHealth)`)". The harness player's
 * heal() IS that exact clamp formula (a genuine player behavior the engine owns), so a real heal
 * raises health by the clamped delta and a full-health player's heal is a real 0-delta no-op —
 * the clamp lives in the player, the consume+emit decision lives in PickupHeart (under test).
 *
 * Real objects: PickupHeart (under test), the recording bus, a real reward sprite in a real
 * getChildren-backed decorations group, a real consumeReward seam mirrored from
 * DataTopDownScene.consumeReward (latch __consumed → fire base reward.collected → remove from
 * decorations → destroy). The scene is the harness boundary — it owns NO logic under test: every
 * heal-or-not / consume / emit / kind-gate decision is PickupHeart's own code.
 *
 * COUNTERFACTUAL (meaningfulness): the final case mentally no-op's the verb (collect() does
 * nothing). With no heal, NO health.restored is recorded, __GAME__.player.health stays flat, and
 * the heart stays in __GAME__.entities — the same Event-1 assertions then FAIL. We execute that
 * broken variant and confirm the assertions reject it, proving the test catches a broken component.
 *
 * The real class is loaded by esbuild-bundling the .ts source (TYPE-only `@contract`/`topdown-data`
 * imports are erased; no phaser umbrella is touched at runtime) into ESM — no edits to src.
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
const HEART_SRC = resolve(TOP_DOWN, 'src/systems/PickupHeart.ts');
const PHASER_FACADE = resolve(TOP_DOWN, 'test/behaviors/_phaser-keyboard-facade.cjs');
const CONTRACT = resolve(REPO, 'templates/core-contract/src/component-surface.ts');

// ── Bundle the REAL PickupHeart class to ESM ────────────────────────────────────────────────
// PickupHeart imports only TYPE-only `@contract/component-surface` + `topdown-data` (both erased
// at bundle). It touches NO phaser at module scope, but we alias `phaser` → the no-umbrella
// keyboard facade anyway (defensive; the umbrella boots browser device-detection on import).
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
  // Write INSIDE templates/core so any external `import 'phaser'` (in the facade) resolves
  // against templates/core/node_modules (the only installed phaser). Cleaned up after import.
  const outFile = resolve(CORE, `.pickupheart-test.${exportName}.bundle.mjs`);
  writeFileSync(outFile, bundled.outputFiles[0].text, 'utf8');
  try {
    const mod = await import(pathToFileURL(outFile).href);
    return mod[exportName];
  } finally {
    rmSync(outFile, { force: true });
  }
}

const PickupHeart = await bundleClass(HEART_SRC, 'PickupHeart');
assert.equal(typeof PickupHeart, 'function', 'PickupHeart class did not load from src');

// ── A RECORDING EventBus: the real scene seam the component emits on (collects every emit) ──
class RecordingBus {
  constructor() { this.events = []; }
  emit(name, payload) { this.events.push({ name, payload }); }
  recent(name) { return this.events.filter((e) => e.name === name); }
}

// ── A real getChildren-backed decorations group (what scene.decorations is; the group the
//    production hook's collectEntities reads to build __GAME__.entities) ─────────────────────
function makeGroup() {
  const items = [];
  return {
    add: (o) => { if (!items.includes(o)) items.push(o); },
    remove: (o) => { const i = items.indexOf(o); if (i >= 0) items.splice(i, 1); },
    getChildren: () => items.slice(),
  };
}

// ── The REAL __GAME__ view, re-derived with the production hook's EXACT field reads ──────────
// buildPlayer (hook.ts:204): health = num(player.health); maxHealth = num(player.maxHealth,...).
// collectEntities (hook.ts:103): the player is entity #0, then each ACTIVE child of the
// `decorations` group (active===false is skipped). num() coerces to a finite number or 0. This
// is the OBSERVED surface a W5/verify run reads — so asserting through gameView() is asserting
// through __GAME__, not through an internal component flag.
function num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function gameView(scene) {
  const player = scene.player;
  const entities = [];
  if (player && player.active !== false) entities.push({ id: 'player', type: 'player', x: num(player.x), y: num(player.y) });
  let idx = 0;
  for (const child of scene.decorations.getChildren()) {
    if (!child || child.active === false) continue;
    idx += 1;
    entities.push({ id: child.__id ?? `entity_${idx}`, type: child.__type ?? 'obstacle', x: num(child.x), y: num(child.y) });
  }
  return {
    player: player ? { x: num(player.x), y: num(player.y), health: num(player.health), maxHealth: num(player.maxHealth, num(player.health)) } : null,
    entities,
  };
}

// ── A minimal Phaser-shaped scene host carrying the REAL bus + decorations + consumeReward ──
// physics.add.overlap is recorded (so we can assert setupCollisions wires the real overlap and
// then drive THROUGH it). consumeReward mirrors DataTopDownScene.consumeReward (DataTopDownScene.ts:456):
// guard __consumed → fire reward.collected → disable body → remove from decorations → destroy.
function makeScene() {
  const bus = new RecordingBus();
  const decorations = makeGroup();
  const overlaps = [];
  const scene = {
    eventBus: bus,
    decorations,
    player: null, // set by makePlayer
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

// A REAL player carrying the engine-owned heal clamp (BasePlayer.heal, BasePlayer.ts:803) —
// `this.health = Math.min(this.health + amount, this.maxHealth)`. This is a genuine player
// behavior (the clamp PickupHeart's contract says it re-uses, never re-implements), NOT a stub
// returning the test's expected value: a heal past max really saturates at maxHealth.
function makePlayer(scene, health, maxHealth) {
  const player = {
    x: 100, y: 100, active: true, isDead: false,
    health, maxHealth,
    heal(amount) { this.health = Math.min(this.health + amount, this.maxHealth); },
  };
  scene.player = player;
  return player;
}

// A real heart-pickup reward sprite (tagged __kind so collect() accepts it).
function makeHeart(kind, id, extra = {}) {
  return {
    __kind: kind, __id: id, __consumed: false, x: 100, y: 100,
    active: true, body: { enable: true }, destroy() { this.active = false; },
    ...extra,
  };
}

let pass = 0;
const fails = [];
function check(label, fn) {
  try { fn(); pass++; console.log(`  PASS  ${label}`); }
  catch (e) { fails.push(label); console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

console.log('\n=== PickupHeart — health.restored fires with its expect transition (observable __GAME__) ===\n');

// Sanity: the REAL heal clamp the harness player carries genuinely clamps at maxHealth.
{
  const scene = makeScene();
  const player = makePlayer(scene, 3, 5);
  player.heal(1); // 3 → 4 (under max)
  check('the harness player.heal is the real BasePlayer clamp (raises under max)', () => assert.equal(player.health, 4));
  player.heal(10); // 4 → 5 (saturates, never overshoots)
  check('the harness player.heal clamps at maxHealth (never overshoots)', () => assert.equal(player.health, 5));
}

// ════════════════════════════════════════════════════════════════════════════════════════
//  EVENT 1 — health.restored (drivenBy: collect — the player overlaps a heart pickup)
//  expect: __GAME__.player.health increases by the heal amount, clamped at player.maxHealth;
//          the heart leaves __GAME__.entities; health.restored logged.
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('[1] health.restored — collect a heart at partial health → __GAME__.player.health rises + heart leaves entities + logged');
{
  const scene = makeScene();
  const player = makePlayer(scene, 2, 5);          // hurt player (2 / 5)
  const sys = new PickupHeart({ pickupKind: 'heart', healAmount: 2 });
  sys.attach(scene);

  // PRECONDITION via the OBSERVED __GAME__ surface: health is 2, the heart is present in entities.
  const before = gameView(scene);
  assert.equal(before.player.health, 2, 'health starts at 2 in __GAME__');
  assert.equal(scene.eventBus.recent('health.restored').length, 0, 'no restore before collecting');
  const heart = makeHeart('heart', 'h1');
  scene.decorations.add(heart);
  const beforeWithHeart = gameView(scene);
  assert.equal(beforeWithHeart.entities.some((e) => e.id === 'h1'), true, 'the heart is in __GAME__.entities before collect');

  // DRIVE the verb: collect the heart (the seam setupCollisions routes the overlap to).
  sys.collect(heart);

  const restored = scene.eventBus.recent('health.restored');
  const after = gameView(scene);
  check("'health.restored' logged exactly once on the bus", () => assert.equal(restored.length, 1));
  check('payload is {healAmount,health}', () => {
    const p = restored[0].payload;
    assert.deepEqual(Object.keys(p).sort(), ['healAmount', 'health']);
    assert.equal(p.healAmount, 2);
    assert.equal(p.health, 4); // the clamped new health (2 + 2)
  });
  check('OBSERVABLE: __GAME__.player.health INCREASED by the heal amount (2 → 4)', () =>
    assert.equal(after.player.health, before.player.health + 2, `health is ${after.player.health}`));
  check('OBSERVABLE: __GAME__.player.health never above player.maxHealth (4 ≤ 5)', () =>
    assert.ok(after.player.health <= after.player.maxHealth, `${after.player.health} > ${after.player.maxHealth}`));
  check('OBSERVABLE: the heart LEFT __GAME__.entities (removed via the real consumeReward seam)', () => {
    assert.equal(after.entities.some((e) => e.id === 'h1'), false, 'heart still in __GAME__.entities');
    assert.equal(heart.__consumed, true, 'heart marked consumed');
    assert.equal(scene.eventBus.recent('reward.collected').length, 1, 'base reward.collected fired (standard seam)');
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════
//  EVENT 1 (clamp) — heal CLAMPS at maxHealth: a near-full player taking a big heart saturates
//  exactly at maxHealth, and the logged `health` payload equals the clamped value.
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] health.restored CLAMPS — a near-full player + big heart saturates at maxHealth (no overshoot)');
{
  const scene = makeScene();
  const player = makePlayer(scene, 4, 5);          // 4 / 5
  const sys = new PickupHeart({ pickupKind: 'heart', healAmount: 10 }); // way over the gap
  sys.attach(scene);
  const heart = makeHeart('heart', 'h-clamp');
  scene.decorations.add(heart);

  sys.collect(heart);

  const after = gameView(scene);
  const restored = scene.eventBus.recent('health.restored');
  check('OBSERVABLE: __GAME__.player.health saturated EXACTLY at maxHealth (4 +10 → 5, not 14)', () =>
    assert.equal(after.player.health, 5, `health is ${after.player.health}`));
  check('the logged `health` payload equals the clamped new health (5)', () =>
    assert.equal(restored[0].payload.health, 5));
  check('OBSERVABLE: the heart still left __GAME__.entities (consumed)', () =>
    assert.equal(after.entities.some((e) => e.id === 'h-clamp'), false));
}

// ── EVENT 1 through the REAL overlap seam (setupCollisions), not just collect() directly ─────
console.log('\n[3] the wired overlap (setupCollisions) routes a collision to the collect verb');
{
  const scene = makeScene();
  const player = makePlayer(scene, 1, 5);
  const sys = new PickupHeart({ pickupKind: 'heart', healAmount: 1 });
  sys.attach(scene);
  sys.setupCollisions();                            // wires physics.add.overlap(player, decorations, cb)
  check('setupCollisions registered exactly one player↔decorations overlap', () =>
    assert.equal(scene.__overlaps.length, 1));
  const ov = scene.__overlaps[0];
  check('the overlap is player↔decorations', () => {
    assert.equal(ov.a, player);
    assert.equal(ov.b, scene.decorations);
  });
  const heart = makeHeart('heart', 'h-overlap');
  scene.decorations.add(heart);
  ov.cb(player, heart);                             // simulate the physics overlap firing
  const after = gameView(scene);
  check('driving the overlap callback fired health.restored (the overlap → collect path is live)', () =>
    assert.equal(scene.eventBus.recent('health.restored').length, 1));
  check('OBSERVABLE: __GAME__.player.health rose via the overlap path (1 → 2)', () =>
    assert.equal(after.player.health, 2));
}

// ── EVENT 1 selectivity — a non-heart reward (wrong __kind) passes through: no heal, no event,
//    heart-or-not is gated by the DATA (reward __kind), per the contract ───────────────────────
console.log('\n[4] a non-heart reward (wrong __kind) is ignored — no heal, no event');
{
  const scene = makeScene();
  const player = makePlayer(scene, 2, 5);
  const sys = new PickupHeart({ pickupKind: 'heart', healAmount: 2 });
  sys.attach(scene);
  const dot = makeHeart('dot', 'd1');               // a plain collectible, NOT a heart
  scene.decorations.add(dot);
  sys.collect(dot);
  const after = gameView(scene);
  check('no health.restored for a non-heart reward', () =>
    assert.equal(scene.eventBus.recent('health.restored').length, 0));
  check('OBSERVABLE: __GAME__.player.health is unchanged (still 2)', () =>
    assert.equal(after.player.health, 2));
  check('OBSERVABLE: the non-heart reward is still in __GAME__.entities (not consumed)', () =>
    assert.equal(after.entities.some((e) => e.id === 'd1'), true));
}

// ── COUNTERFACTUAL: mentally no-op the verb → the SAME Event-1 assertions MUST fail ──────────
// Subclass overriding collect() to do nothing (the "broken component"). The bus stays empty,
// health stays flat, and the heart stays in __GAME__.entities — so the Event-1 assertions reject
// it. This proves the test is MEANINGFUL: it fails when the component is wrong.
console.log('\n[5] COUNTERFACTUAL: collect() no-op (broken component) — Event-1 assertions MUST reject it');
{
  class BrokenPickupHeart extends PickupHeart {
    collect(_reward) { /* no-op: never heals, never emits, never consumes the heart */ }
  }
  const scene = makeScene();
  const player = makePlayer(scene, 2, 5);
  const broken = new BrokenPickupHeart({ pickupKind: 'heart', healAmount: 2 });
  broken.attach(scene);
  const heart = makeHeart('heart', 'h-broken');
  scene.decorations.add(heart);
  const before = gameView(scene);

  broken.collect(heart);

  const after = gameView(scene);
  let rejected = false;
  try {
    assert.equal(scene.eventBus.recent('health.restored').length, 1);            // would-be Event-1 emit assertion
    assert.equal(after.player.health, before.player.health + 2);                 // would-be health-rose assertion
    assert.equal(after.entities.some((e) => e.id === 'h-broken'), false);        // would-be heart-left-entities assertion
  } catch { rejected = true; }
  check('broken (no-op) component is REJECTED by the same assertions', () =>
    assert.equal(rejected, true, 'the no-op component PASSED the assertions — the test is NOT meaningful'));
  console.log(`        (broken: bus had ${scene.eventBus.recent('health.restored').length} 'health.restored', health ${after.player.health} (was ${before.player.health}), heart still in entities: ${after.entities.some((e) => e.id === 'h-broken')})`);
}

console.log(`\n=== ${pass} checks passed, ${fails.length} failed ===`);
if (fails.length) { console.error('FAILED:', fails.join('; ')); process.exit(1); }
console.log('health.restored FIRES at the real collect seam with its expect transition (observable __GAME__).');
