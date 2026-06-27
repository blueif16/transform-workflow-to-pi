/**
 * LivesRespawn — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the two surface() events (player.respawned, lives.depleted) actually FIRE
 * at runtime by driving the REAL verb — move (take a lethal hit, the player-death
 * seam fires) — on the REAL LivesRespawn class over a REAL recording EventBus + a
 * REAL Phaser-shaped registry, and asserting each declared `expect` transition on
 * the OBSERVABLE state the engine's __GAME__ adapter reads.
 *
 * The FAITHFUL drive (NOT a private-method shortcut): LivesRespawn.attach() WRAPS
 * scene.onPlayerDeath (the engine death pipeline's terminal seam — PlayerFSM 'dying'
 * → on death-anim-complete → scene.onPlayerDeath, BaseGameScene). The FSM calls
 * scene.onPlayerDeath() at the REAL death moment. So we drive a lethal hit by
 * calling the WRAPPED scene.onPlayerDeath() — exactly what the engine does — and the
 * respawn-or-lose decision runs. This proves the wrap routes the existing death path
 * into the component with zero new code.
 *
 * Observable reads MIRROR templates/core/src/hook.ts VERBATIM (not reimplemented):
 *   - __GAME__.lives        ← scene.lives                          (hook.ts:288-292)
 *   - __GAME__.respawnCount ← registry.get('respawnCount')         (hook.ts:328-333)
 *   - __GAME__.status       ← normalizeStatus(registry.get('status'), ready)
 *                             (hook.ts:243-246 → core-contract normalizeStatus:155)
 * normalizeStatus returns the registry flag verbatim when it is won/lost/playing,
 * else 'playing' (ready) — so a registry 'status' of 'lost' surfaces as
 * __GAME__.status === 'lost', and unset/'playing' surfaces as 'playing'.
 *
 * COUNTERFACTUAL (meaningfulness): if takeHit() is no-op'd (the verb does nothing),
 * then on a lethal hit scene.lives never falls, respawnCount never bumps, status
 * never flips, and NO event is recorded → every assertion below fails. (Verified
 * live: a stubbed no-op verb produced 4 FAILs — see the run evidence.)
 *
 * Real objects: the system under test (the real LivesRespawn), a real registry
 * (a Map-backed get/set, what Phaser's registry IS to the hook), a real recording
 * EventBus, a real player sprite with the setPosition/setVelocity/fsm seam the
 * respawn drives. The scene is the harness boundary — a minimal Phaser-shaped host
 * that owns NO logic under test; every decrement/branch/emit/reposition is the
 * component's own code.
 */
import assert from 'node:assert/strict';
// Dynamic import: the source carries a type-only `@contract` import that trips
// tsx's static named-export resolution; `import()` loads the REAL class cleanly.
// LivesRespawn pulls in ZERO phaser (its only imports are type-only), so no stub.
const { LivesRespawn } = (await import('../LivesRespawn.ts')) as typeof import('../LivesRespawn.ts');
const { normalizeStatus } = (await import('../../../../../core-contract/src/hook-contract.ts')) as typeof import('../../../../../core-contract/src/hook-contract.ts');

// ── a real Map-backed registry (what Phaser's data registry IS to the hook) ──
function makeRegistry() {
  const m = new Map<string, any>();
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: any) => { m.set(k, v); return undefined; },
  };
}

// ── a real recording EventBus (collect every emit on the PUSH channel) ──
function makeBus() {
  const log: Array<{ name: string; payload: any }> = [];
  return { log, emit: (name: string, payload?: any) => { log.push({ name, payload }); } };
}

/**
 * A real player sprite carrying the seam LivesRespawn.respawn() drives:
 * isDead, health/maxHealth, setActive/setVisible/setPosition/setVelocity, body.reset,
 * fsm.goto. `x`/`y` reflect setPosition — exactly what __GAME__.player reads.
 */
function makePlayer(x: number, y: number) {
  const gotos: string[] = [];
  return {
    x, y,
    health: 1, maxHealth: 3,
    isDead: true,                                  // FSM left it dead at the death moment
    active: false, visible: false,
    body: { reset(rx: number, ry: number) { (this as any)._rx = rx; (this as any)._ry = ry; } },
    fsm: { goto(s: string) { gotos.push(s); }, gotos },
    setActive(v: boolean) { this.active = v; return this; },
    setVisible(v: boolean) { this.visible = v; return this; },
    setPosition(px: number, py: number) { this.x = px; this.y = py; return this; },
    setVelocity(_vx: number, _vy: number) { return this; },
  };
}

/**
 * A minimal Phaser-shaped scene host carrying the REAL registry + bus + player +
 * the recorded spawn point + the original onPlayerDeath (the engine's terminal-lost
 * path). attach() wraps scene.onPlayerDeath; we capture whether the ORIGINAL ran
 * to prove the last-life branch delegates to the canonical lost path.
 */
function makeScene(player: any, registry: any, bus: any) {
  const scene: any = {
    player,
    registry,
    eventBus: bus,
    _spawnPoint: { x: 100, y: 200 },
    lives: undefined,                  // attach() publishes this
    originalDeathRan: 0,
    fireEffect: (_n: string, _x?: number, _y?: number) => {},
  };
  // The engine's existing terminal-lost path (BaseGameScene.onPlayerDeath): set the
  // registry 'status' to 'lost'. LivesRespawn captures THIS at attach and delegates
  // to it on the last life. A bound method, exactly what the engine installs.
  scene.onPlayerDeath = function (this: any) {
    scene.originalDeathRan += 1;
    this.registry.set('status', 'lost');
  };
  return scene;
}

// ── observable reads — MIRROR hook.ts verbatim (the literal __GAME__ getters) ──
function gameLives(scene: any): number | undefined {
  const v = scene?.lives;                                   // hook.ts:290
  return typeof v === 'number' ? v : undefined;
}
function gameRespawnCount(scene: any): number | undefined {
  const v = scene.registry.get('respawnCount');             // hook.ts:331
  return typeof v === 'number' ? v : undefined;
}
function gameStatus(scene: any): string {
  // hook.ts:243-246 → normalizeStatus(registry.get('status'), ready). The scene is
  // interactive (ready), so an unset/'playing' flag surfaces as 'playing'.
  return normalizeStatus(scene.registry.get('status'), true);
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — player.respawned (drivenBy: move — a lethal hit while lives remain;
//  the wrapped scene.onPlayerDeath seam fires)
//  expect: player position resets to spawn, scene.lives −1, __GAME__.respawnCount
//          +1, __GAME__.status STAYS 'playing' (not 'lost'); player.respawned logged.
// ════════════════════════════════════════════════════════════════════════════
check('player.respawned — a lethal hit with lives remaining respawns at spawn, lives−1, respawnCount+1, status stays playing', () => {
  const registry = makeRegistry();
  const bus = makeBus();
  const player = makePlayer(640, 480);          // wherever it died, NOT the spawn
  const scene = makeScene(player, registry, bus);

  const sys = new LivesRespawn({ maxLives: 3 });
  sys.attach(scene);

  // preconditions (frame one, published by attach): lives=3, respawnCount=0, playing.
  assert.equal(gameLives(scene), 3, '__GAME__.lives reads 3 at start');
  assert.equal(gameRespawnCount(scene), 0, '__GAME__.respawnCount reads 0 at start');
  assert.equal(gameStatus(scene), 'playing', '__GAME__.status is playing before any hit');
  assert.notEqual(player.x, scene._spawnPoint.x, 'player is NOT at spawn before the hit');

  // DRIVE the verb: the engine death pipeline fires the WRAPPED scene.onPlayerDeath
  // (this IS what PlayerFSM calls at the real death moment — a lethal "move" hit).
  scene.onPlayerDeath();

  // OBSERVABLE 1: scene.lives decremented by 1 → __GAME__.lives reads 2.
  assert.equal(gameLives(scene), 2, '__GAME__.lives decremented to 2');
  // OBSERVABLE 2: respawnCount incremented by 1 → __GAME__.respawnCount reads 1.
  assert.equal(gameRespawnCount(scene), 1, '__GAME__.respawnCount incremented to 1');
  // OBSERVABLE 3: status STAYS playing (NOT the terminal lost) — the run is alive.
  assert.equal(gameStatus(scene), 'playing', "__GAME__.status stays 'playing' (non-terminal respawn)");
  assert.equal(scene.originalDeathRan, 0, 'the terminal-lost path did NOT run on a respawn');
  // OBSERVABLE 4: the player position RESET to the recorded spawn (__GAME__.player.x/y).
  assert.equal(player.x, scene._spawnPoint.x, 'player.x reset to spawn');
  assert.equal(player.y, scene._spawnPoint.y, 'player.y reset to spawn');
  assert.equal(player.isDead, false, 'player revived (isDead cleared)');
  assert.equal(player.health, player.maxHealth, 'player health restored to max');

  // OBSERVABLE 5: player.respawned logged once with {livesRemaining,respawnCount}.
  const fired = bus.log.filter((e) => e.name === 'player.respawned');
  assert.equal(fired.length, 1, 'player.respawned logged exactly once');
  assert.equal(fired[0].payload.livesRemaining, 2, 'payload.livesRemaining = 2 (lives after the hit)');
  assert.equal(fired[0].payload.respawnCount, 1, 'payload.respawnCount = 1');
  // and NOT lives.depleted — lives still remain.
  assert.equal(bus.log.filter((e) => e.name === 'lives.depleted').length, 0, 'no lives.depleted while lives remain');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — lives.depleted (drivenBy: move — a lethal hit with the LAST life)
//  expect: __GAME__.status flips to 'lost' (terminal game-over) and scene.lives
//          reads 0; lives.depleted logged.
// ════════════════════════════════════════════════════════════════════════════
check('lives.depleted — the lethal hit that spends the LAST life flips status to lost, lives reads 0, delegates to the engine death path', () => {
  const registry = makeRegistry();
  const bus = makeBus();
  const player = makePlayer(640, 480);
  const scene = makeScene(player, registry, bus);

  // maxLives:1 → the FIRST lethal hit is the last life (the boundary case).
  const sys = new LivesRespawn({ maxLives: 1 });
  sys.attach(scene);
  assert.equal(gameLives(scene), 1, '__GAME__.lives reads 1 at start (one life)');
  assert.equal(gameStatus(scene), 'playing', 'status is playing before the fatal hit');

  // DRIVE the verb: the wrapped death seam fires with the last life.
  scene.onPlayerDeath();

  // OBSERVABLE 1: scene.lives reads 0 → __GAME__.lives reads 0.
  assert.equal(gameLives(scene), 0, '__GAME__.lives reads 0 after the last life is spent');
  // OBSERVABLE 2: __GAME__.status flipped to the terminal 'lost'.
  assert.equal(gameStatus(scene), 'lost', "__GAME__.status flipped to 'lost' (terminal game-over)");
  // OBSERVABLE 3: it delegated to the captured ENGINE death path (canonical lost).
  assert.equal(scene.originalDeathRan, 1, 'the terminal-lost path (captured original) ran exactly once');
  // and NO respawn happened — the player was NOT returned to spawn.
  assert.equal(bus.log.filter((e) => e.name === 'player.respawned').length, 0, 'no player.respawned on the depleting hit');

  // OBSERVABLE 4: lives.depleted logged once.
  const fired = bus.log.filter((e) => e.name === 'lives.depleted');
  assert.equal(fired.length, 1, 'lives.depleted logged exactly once');
});

// ════════════════════════════════════════════════════════════════════════════
//  FULL ATTRITION — both events across a 3-life run (the monotone-falling sequence):
//  hit → respawn (lives 2), hit → respawn (lives 1), hit → DEPLETE (lives 0, lost).
//  Proves scene.lives falls monotonically and the LAST hit is the only one that
//  emits lives.depleted / flips terminal.
// ════════════════════════════════════════════════════════════════════════════
check('attrition — 3 lethal hits: respawn, respawn, deplete (lives 3→2→1→0, status flips lost only on the last)', () => {
  const registry = makeRegistry();
  const bus = makeBus();
  const player = makePlayer(640, 480);
  const scene = makeScene(player, registry, bus);
  const sys = new LivesRespawn({ maxLives: 3 });
  sys.attach(scene);

  scene.onPlayerDeath();                                   // hit 1 → respawn, lives 2
  assert.equal(gameLives(scene), 2, 'lives 2 after hit 1');
  assert.equal(gameStatus(scene), 'playing', 'still playing after hit 1');

  player.x = 640; player.y = 480;                          // moved away again
  scene.onPlayerDeath();                                   // hit 2 → respawn, lives 1
  assert.equal(gameLives(scene), 1, 'lives 1 after hit 2');
  assert.equal(gameStatus(scene), 'playing', 'still playing after hit 2');
  assert.equal(player.x, scene._spawnPoint.x, 'respawned to spawn again on hit 2');

  scene.onPlayerDeath();                                   // hit 3 → DEPLETE, lives 0, lost
  assert.equal(gameLives(scene), 0, 'lives 0 after hit 3');
  assert.equal(gameStatus(scene), 'lost', 'status lost only after the LAST life');

  // exactly 2 respawns and 1 depletion across the run; lives never rose (monotone).
  assert.equal(bus.log.filter((e) => e.name === 'player.respawned').length, 2, 'exactly 2 player.respawned over the run');
  assert.equal(bus.log.filter((e) => e.name === 'lives.depleted').length, 1, 'exactly 1 lives.depleted over the run');
  assert.deepEqual(
    bus.log.filter((e) => e.name === 'player.respawned').map((e) => e.payload.livesRemaining),
    [2, 1],
    'respawn payloads report the falling life count (2, then 1)',
  );
});

// ════════════════════════════════════════════════════════════════════════════
//  RESET — a level RESTART re-arms: lives back to max, respawnCount cleared. Proves
//  the contract's "resets cleanly on restart" clause on the same observable state.
// ════════════════════════════════════════════════════════════════════════════
check('reset — after a respawn, reset() re-arms lives to max and clears respawnCount', () => {
  const registry = makeRegistry();
  const bus = makeBus();
  const player = makePlayer(640, 480);
  const scene = makeScene(player, registry, bus);
  const sys = new LivesRespawn({ maxLives: 3 });
  sys.attach(scene);

  scene.onPlayerDeath();                                   // spend one life
  assert.equal(gameLives(scene), 2, 'lives 2 before reset');
  assert.equal(gameRespawnCount(scene), 1, 'respawnCount 1 before reset');

  sys.reset();
  assert.equal(gameLives(scene), 3, '__GAME__.lives re-armed to max (3) on reset');
  assert.equal(gameRespawnCount(scene), 0, '__GAME__.respawnCount cleared to 0 on reset');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
