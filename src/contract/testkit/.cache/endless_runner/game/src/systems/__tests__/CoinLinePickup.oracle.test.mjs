/**
 * CoinLinePickup — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/systems/CoinLinePickup.ts):
 *   - coin.collected  drivenBy "the avatar overlapping a coin"
 *                     expect   "the collected coin despawns; __GAME__ coin count increases by one
 *                               and __GAME__.score increases by coinValue; coin.collected logged"
 *   - observable coinCount ← the live running coin count
 *
 * REAL drive through the REAL seam: CoinLinePickup spawns its own coin lines into scene.coins
 * and wires the avatar↔coin overlap in setupCollisions(). We clear the level's DEFAULT systems,
 * mount the system (its setupCollisions wires the REAL physics overlap), STEP once to spawn a
 * coin line (scrollSpeed 0 so coins hold position), then MOVE the real avatar ONTO a real coin
 * sprite and STEP — the engine's per-frame overlap sweep COLLECTS it through the system's own
 * handler (never the private emit). The OBSERVABLE transition: the coin sprite despawns, the
 * coinCount observable + __GAME__.score both rise, coin.collected logged. A COUNTERFACTUAL keeps
 * the avatar away from every coin → no collection, no event, score unchanged.
 *
 *   node templates/modules/endless_runner/src/systems/__tests__/CoinLinePickup.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: the avatar overlaps a real spawned coin → collect (count + score up, despawn).
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];

  const sys = world.mountSystem('CoinLinePickup', { spawnEveryPx: 50, scrollSpeed: 0, coinValue: 5 });
  check('resolveSystem returned a real CoinLinePickup', sys.constructor.name === 'CoinLinePickup', sys.constructor.name);

  world.step(1); // attach armed sinceSpawn = spawnEveryPx → a coin line spawns frame 1
  const coins = scene.coins.getChildren();
  check('precondition: a coin line spawned into scene.coins (a __GAME__.entities member)', coins.length >= 1, `coins=${coins.length}`);

  const coin = coins[0];
  const coinId = coin.__id;
  const scoreBefore = Number(scene.registry.get('score') ?? 0);
  check('precondition: coinCount observable starts at 0', sys.surface().observables.coinCount() === 0, `coinCount=${sys.surface().observables.coinCount()}`);

  // DRIVE: place the real avatar ON the coin; the per-frame overlap sweep collects it.
  scene.player.body.reset(coin.x, coin.y);
  const cur = bus.cursor;
  world.step(2);
  const collected = bus.recent(cur).filter((e) => e.type === 'coin.collected');
  check('COLLECT: coin.collected logged on the real bus', collected.length >= 1, `count=${collected.length}`);
  check('COLLECT: coin.collected payload names the collected coin id', collected.at(-1)?.payload?.id === coinId, JSON.stringify(collected.at(-1)?.payload));
  check('COLLECT: the coinCount observable increased by one', sys.surface().observables.coinCount() === 1, `coinCount=${sys.surface().observables.coinCount()}`);
  check('COLLECT: __GAME__.score increased by coinValue (+5)', Number(scene.registry.get('score')) === scoreBefore + 5, `${scoreBefore}→${scene.registry.get('score')}`);
  check('COLLECT: the collected coin despawned (left the world)', coin.active === false || !scene.coins.getChildren().includes(coin), `active=${coin.active}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): with the avatar kept far from every coin,
// nothing is collected — the coinCount stays 0, score is unchanged, and coin.collected
// never fires. If collect()/the emit fired unconditionally the DRIVE block would over-fire.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];
  const sys = world.mountSystem('CoinLinePickup', { spawnEveryPx: 50, scrollSpeed: 0, coinValue: 5 });
  world.step(1);

  // Keep the avatar far from the spawned coin line (top-left corner, away from the right edge).
  scene.player.body.reset(10, 10);
  const scoreBefore = Number(scene.registry.get('score') ?? 0);
  const cur = bus.cursor;
  world.step(3);
  const collected = bus.recent(cur).filter((e) => e.type === 'coin.collected');
  check('counterfactual: avatar away → no coin.collected', collected.length === 0, `count=${collected.length}`);
  check('counterfactual: coinCount stays 0', sys.surface().observables.coinCount() === 0, `coinCount=${sys.surface().observables.coinCount()}`);
  check('counterfactual: score unchanged', Number(scene.registry.get('score')) === scoreBefore, `score=${scene.registry.get('score')}`);

  world.destroy();
}

console.log(`\n[oracle] CoinLinePickup ok — ${passed} assertions: coin.collected (a real avatar↔coin overlap despawns the coin, raises the coinCount observable + __GAME__.score by coinValue); counterfactual (avatar away → no collect, no event) holds.`);
process.exit(0);
