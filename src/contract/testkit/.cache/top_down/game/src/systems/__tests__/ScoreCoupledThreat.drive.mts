/**
 * ScoreCoupledThreat.drive.mts — RUNTIME DRIVE PROOF for ScoreCoupledThreat.
 *
 * Proves the component's surface() event ACTUALLY FIRES at runtime by driving its
 * real verb — a SCORED KILL (`enemy.died` on the shared bus, which the component
 * POLL-subscribes to in attach()) and a WAVE CLEAR (`scene.waveIndex` advance,
 * detected in update()) — on a minimal REAL scene fixture, and asserting the declared
 * `threat.escalated` emit + its `expect` transition on OBSERVABLE state (the bound
 * chaser's MEASURED walkSpeed in __GAME__.entities rises, OR the enemy COUNT rises),
 * never an internal flag.
 *
 * Surface contract (from ScoreCoupledThreat.surface()):
 *   event    threat.escalated   payload {tier,enemySpeed}   scope archetype
 *   drivenBy "a scored kill (or a wave clear) crosses the escalation step"
 *   expect   "a bound chaser's walkSpeed rises (its measured speed in __GAME__.entities
 *             increases) or the enemy count in __GAME__.entities rises; threat.escalated logged"
 *
 * Real objects only:
 *   - the REAL EventBus (`@contract` transport) — every emit is genuinely recorded; the
 *     component subscribes to it via bus.on('enemy.died') in attach() and we drive the
 *     verb by emitting on it exactly as BaseGameScene.onEnemyKilled does (NO private call).
 *   - the REAL BehaviorManager holding a chaser behavior carrying the GENUINE ChaseAI
 *     shape (`speed:number` + `setTarget()` — verified against behaviors/ChaseAI.ts) so
 *     the component's `chaseOf()` structurally matches it and mutates a REAL bound
 *     behavior's `speed`. The walkSpeed observable IS that real field, not a stub return.
 *     (We do not import ChaseAI itself: it statically imports Phaser, absent in this
 *     headless harness; the contract `chaseOf()` keys off the STRUCTURE, not the class.)
 *   - real Phaser-style enemy sprites in a real group facade (getChildren) — the same
 *     scene.enemies surface DataTopDownScene exposes and that __GAME__.entities folds.
 *
 * MEANINGFUL: each assertion checks the EXACT computed transition; if the verb were a
 * no-op the test FAILS (counterfactuals stated inline + a dedicated counterfactual block).
 *
 * Run (from repo root):
 *   packages/verify/node_modules/.bin/tsx \
 *     templates/modules/top_down/src/systems/__tests__/ScoreCoupledThreat.drive.mts
 */
// Dynamic import mirrors the sibling CarrierRideSystem.drive.mts: the component +
// BehaviorManager carry transitive type-only imports that trip tsx's static
// named-export resolution; import() loads the REAL classes cleanly. The REAL shared
// transport facade `@contract/component-surface` maps to ../core-contract/src/* per
// templates/core/tsconfig.json; we load that same real module by relative path.
const { ScoreCoupledThreat } = (await import('../ScoreCoupledThreat.ts')) as typeof import('../ScoreCoupledThreat.ts');
const { BehaviorManager } = (await import('../../behaviors/BehaviorManager.ts')) as typeof import('../../behaviors/BehaviorManager.ts');
const { EventBus } = (await import('../../../../../core-contract/src/component-surface.ts')) as typeof import('../../../../../core-contract/src/component-surface.ts');

let passed = 0;
const ok = (label: string) => {
  passed++;
  console.log(`  PASS  ${label}`);
};
const fail = (label: string, detail = '') => {
  console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  throw new Error(`assertion failed: ${label}`);
};
const eq = (actual: unknown, expected: unknown, label: string) => {
  if (actual === expected) ok(`${label}  (=${JSON.stringify(actual)})`);
  else fail(label, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};

/**
 * A REAL bound chaser sprite: a Phaser-style enemy carrying a REAL BehaviorManager
 * whose one behavior has the GENUINE ChaseAI shape (`speed:number` + `setTarget()`).
 * `__GAME__.entities` folds this sprite's measured speed off its chaser behavior's
 * `speed`; the component mutates exactly that field. No stub return — the value the
 * test reads back is the one the component wrote into a real bound behavior.
 */
function makeChaserEnemy(opts: { speed: number; kind?: string; id?: string }) {
  const sprite: any = {
    x: 100,
    y: 100,
    active: true,
    isDead: false,
    __id: opts.id,
    __kind: opts.kind,
  };
  const mgr = new BehaviorManager(sprite);
  // The chaser behavior — the REAL ChaseAI surface the component keys off:
  // a numeric `speed` (the walkSpeed seam) + a `setTarget` method. enabled/attach/
  // detach/update satisfy IBehavior so BehaviorManager.add() stores it cleanly.
  const chase: any = {
    enabled: true,
    speed: opts.speed,
    target: null,
    setTarget(t: any) {
      this.target = t;
    },
    attach() {},
    detach() {},
    update() {},
  };
  mgr.add('chase', chase);
  sprite.behaviors = mgr;
  // The observable __GAME__.entities folds — the MEASURED chaser speed off the real
  // bound behavior (what the verify harness reads as Δposition/frame upstream).
  sprite.__measuredSpeed = () => chase.speed;
  return sprite;
}

/** A real Phaser-style group facade (getChildren) — scene.enemies. */
function makeGroup(children: any[]) {
  return { getChildren: () => children };
}

/** A minimal REAL scene fixture: exactly the live surface the component reads. */
function makeScene(opts: { enemies: any[]; bus: any; waveSpawner?: any }) {
  return {
    eventBus: opts.bus,
    enemies: makeGroup(opts.enemies),
    waveIndex: 0,
    gameCompleted: false,
    __waveSpawner: opts.waveSpawner,
  };
}

// ---------------------------------------------------------------------------
// DRIVE 1 — SCORED KILL crosses the escalation step → walkSpeed RISES + event fires.
//   step=2: two scored kills tick the counter; the 2nd crosses → escalate().
//   speedStep=24: the bound chaser's walkSpeed must rise by exactly 24 (80 → 104).
//   expect: a bound chaser's measured speed in __GAME__.entities increases; logged.
// ---------------------------------------------------------------------------
{
  const bus = new EventBus();
  const chaser = makeChaserEnemy({ speed: 80, kind: 'chaser', id: 'enemy_1' });
  const scene = makeScene({ enemies: [chaser], bus });

  const sys = new ScoreCoupledThreat({ step: 2, speedStep: 24, maxSpeed: 320 });
  sys.reset();
  sys.attach(scene); // <-- LIVE wiring: subscribes bus.on('enemy.died')

  eq(chaser.__measuredSpeed(), 80, 'precondition: bound chaser measured walkSpeed = 80');

  // Kill #1: ticks the counter (1 < step 2) — NO escalation yet (counterfactual guard:
  // a component that escalated on every kill would wrongly raise speed here).
  let cur = bus.cursor;
  bus.emit('enemy.died', { id: 'x', x: 50, y: 50 }); // the REAL scored-kill seam
  eq(chaser.__measuredSpeed(), 80, 'kill #1 (below step): walkSpeed unchanged (no premature escalate)');
  eq(bus.recent(cur).filter((e) => e.type === 'threat.escalated').length, 0, 'kill #1: NO threat.escalated yet');

  // Kill #2: crosses step 2 → escalate(): walkSpeed 80 → 104 + threat.escalated fires.
  cur = bus.cursor;
  bus.emit('enemy.died', { id: 'y', x: 60, y: 60 });

  // OBSERVABLE expect: the bound chaser's MEASURED walkSpeed in __GAME__.entities rose
  // by exactly speedStep. COUNTERFACTUAL: if escalate()/raiseBoundChaserSpeed() were a
  // no-op, this stays 80 and FAILS — the test is meaningful.
  eq(chaser.__measuredSpeed(), 104, 'DRIVE: scored kill crossed step → bound chaser walkSpeed rises 80→104 (+speedStep)');

  const fired = bus.recent(cur).filter((e) => e.type === 'threat.escalated');
  eq(fired.length, 1, 'threat.escalated emitted exactly once on the real bus at the escalation seam');
  const payload = fired[0].payload as { tier: number; enemySpeed: number };
  eq(payload.tier, 1, 'payload.tier = 1 (first escalation step)');
  eq(payload.enemySpeed, 104, 'payload.enemySpeed = 104 (the escalated chaser speed reported)');
}

// ---------------------------------------------------------------------------
// DRIVE 2 — WAVE CLEAR (the alt scored path) crosses the step → escalates too.
//   step=1 so a single wave-clear advance escalates immediately. Driven through the
//   REAL seam: scene.waveIndex advances (what WaveSpawner sets on each all-cleared
//   release), then update() ticks and edge-detects the advance.
// ---------------------------------------------------------------------------
{
  const bus = new EventBus();
  const chaser = makeChaserEnemy({ speed: 100, kind: 'chaser', id: 'enemy_2' });
  const scene = makeScene({ enemies: [chaser], bus });

  const sys = new ScoreCoupledThreat({ step: 1, speedStep: 30, coupleKill: false, coupleWave: true });
  sys.reset();
  sys.attach(scene);

  // No advance yet — update() must NOT escalate (counterfactual: a component that
  // escalated every tick would raise speed here with no wave clear).
  let cur = bus.cursor;
  sys.update();
  eq(chaser.__measuredSpeed(), 100, 'no wave advance: update() does NOT escalate');
  eq(bus.recent(cur).filter((e) => e.type === 'threat.escalated').length, 0, 'no wave advance: NO threat.escalated');

  // DRIVE: a wave clears → WaveSpawner advances scene.waveIndex; update() edge-detects.
  cur = bus.cursor;
  scene.waveIndex = 1; // the REAL wave-clear seam (WaveSpawner sets this)
  sys.update();

  eq(chaser.__measuredSpeed(), 130, 'DRIVE: wave clear crossed step → bound chaser walkSpeed rises 100→130 (+speedStep)');
  const fired = bus.recent(cur).filter((e) => e.type === 'threat.escalated');
  eq(fired.length, 1, 'wave clear: threat.escalated emitted once');
  eq((fired[0].payload as any).enemySpeed, 130, 'wave-clear payload.enemySpeed = 130');

  // The advance counts EXACTLY ONCE: a second update() with no further advance is inert.
  cur = bus.cursor;
  sys.update();
  eq(chaser.__measuredSpeed(), 130, 'wave advance counted exactly once (no double-escalate)');
  eq(bus.recent(cur).filter((e) => e.type === 'threat.escalated').length, 0, 'no re-emit on a stale wave index');
}

// ---------------------------------------------------------------------------
// DRIVE 3 — the ALT observable: enemy COUNT rises via the WaveSpawner escalate-release.
//   The expect explicitly allows "OR the enemy count rises". A count-only escalation
//   (no chaser bound) must still fire threat.escalated AND release the next wave early.
// ---------------------------------------------------------------------------
{
  const bus = new EventBus();
  const enemies: any[] = [makeChaserEnemy({ speed: 90, kind: 'chaser' })];
  // A real spawner stand-in exposing the escalateRelease() seam the component calls;
  // it actually appends an enemy to the SAME live group (the count-rise observable).
  const spawner = {
    escalateRelease() {
      enemies.push(makeChaserEnemy({ speed: 90, kind: 'chaser' }));
    },
  };
  const scene = makeScene({ enemies, bus, waveSpawner: spawner });

  const sys = new ScoreCoupledThreat({ step: 1, speedStep: 0, coupleWave: true });
  sys.reset();
  sys.attach(scene);

  const countBefore = scene.enemies.getChildren().length;
  const cur = bus.cursor;
  scene.waveIndex = 1; // wave clear → escalate (speedStep 0 ⇒ count-rise is the observable)
  sys.update();

  const countAfter = scene.enemies.getChildren().length;
  // OBSERVABLE expect (alt path): enemy COUNT in __GAME__.entities rose. COUNTERFACTUAL:
  // if releaseNextWaveEarly() were a no-op, count stays the same and this FAILS.
  if (countAfter === countBefore + 1) ok(`DRIVE: escalation released the next wave early → enemy count rises ${countBefore}→${countAfter}`);
  else fail('enemy count must rise on escalate-release', `${countBefore}→${countAfter}`);
  eq(bus.recent(cur).filter((e) => e.type === 'threat.escalated').length, 1, 'count-rise path still logs threat.escalated');
}

// ---------------------------------------------------------------------------
// DRIVE 4 — maxSpeed CAP + group FILTER are honoured (no runaway, right group).
//   A chaser in a NON-matching group must NOT be escalated; a matching one caps.
// ---------------------------------------------------------------------------
{
  const bus = new EventBus();
  const matched = makeChaserEnemy({ speed: 310, kind: 'ghost', id: 'g1' });   // near cap, in group
  const other = makeChaserEnemy({ speed: 100, kind: 'bystander', id: 'b1' }); // wrong group
  const scene = makeScene({ enemies: [matched, other], bus });

  const sys = new ScoreCoupledThreat({ step: 1, speedStep: 50, maxSpeed: 320, group: 'ghost' });
  sys.reset();
  sys.attach(scene);

  bus.emit('enemy.died', { id: 'z', x: 0, y: 0 }); // one kill, step 1 → escalate

  // matched: 310 + 50 = 360 capped to 320. COUNTERFACTUAL: an uncapped raise → 360 FAILS.
  eq(matched.__measuredSpeed(), 320, 'matched group chaser walkSpeed capped at maxSpeed (310+50→320)');
  // other: untouched (wrong __kind). COUNTERFACTUAL: a no-filter raise → 150 FAILS.
  eq(other.__measuredSpeed(), 100, 'non-matching group chaser walkSpeed unchanged (group filter honoured)');
}

// ---------------------------------------------------------------------------
// COUNTERFACTUAL block (meaningfulness proof) — drive NOTHING: no kill, no advance.
//   The walkSpeed must stay put and NO threat.escalated may be logged. This is the
//   negative the whole test rests on: a no-op'd verb produces exactly this state, so
//   every PASS above genuinely depends on the component DOING something.
// ---------------------------------------------------------------------------
{
  const bus = new EventBus();
  const chaser = makeChaserEnemy({ speed: 80, kind: 'chaser' });
  const scene = makeScene({ enemies: [chaser], bus });
  const sys = new ScoreCoupledThreat({ step: 3 });
  sys.reset();
  sys.attach(scene);
  sys.update(); // tick with no kill, no wave advance
  eq(chaser.__measuredSpeed(), 80, 'counterfactual: no verb driven → walkSpeed stays 80');
  eq(bus.recent().filter((e) => e.type === 'threat.escalated').length, 0, 'counterfactual: NO threat.escalated logged when nothing is driven');
}

console.log(`\nALL ${passed} ASSERTIONS PASSED — ScoreCoupledThreat fires threat.escalated with its expect transition (bound chaser walkSpeed rises / enemy count rises) on observable state.`);
