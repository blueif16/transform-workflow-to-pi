/**
 * ShrinkingArena.drive.mts — RUNTIME DRIVE PROOF for ShrinkingArena.
 *
 * Proves the component's one surface() event ACTUALLY FIRES at runtime by driving
 * its REAL in-game verb — `move (survive into the next wave) / clear a wave` — on a
 * minimal REAL scene fixture, and asserting the declared `arena.contracted` emit +
 * its `expect` transition on OBSERVABLE state (the same scene scalars the
 * __GAME__.scene-scalar adapter publishes: scene.arenaRadius + scene.arenaBounds),
 * never an internal flag.
 *
 * Surface contract (from ShrinkingArena.surface()):
 *   event    arena.contracted   payload {arenaRadius,step}
 *   drivenBy "a wave is cleared (the enemy set empties at the wave gate while
 *             surviving into the next wave)"
 *   expect   "scene.arenaRadius decreases and scene.arenaBounds shrinks to a strictly
 *             smaller inner rect; the player is clamped inside the closed walls;
 *             arena.contracted logged"
 *
 * The verb is driven the REAL way the live game drives it: through `update()` and the
 * wave-clear EDGE — a wave with live enemies, then the enemy set emptied — exactly the
 * gate KillAllGoal/WaveSpawner use. (We do NOT call the public onWaveCleared() seam;
 * that would bypass the gate the contract names. The seam is used only as a
 * cross-check at the end.) A coordinating WaveSpawner's advancing scene.waveIndex
 * re-arms the gate so EACH cleared wave contracts once.
 *
 * Real objects only: the REAL ShrinkingArena class, the REAL EventBus (records every
 * emit), and a real getChildren-backed enemy group + a real player whose position the
 * closing wall actually clamps. No stub returns the expected value — the component
 * does all the radius/bounds/clamp math.
 *
 * Run (from repo root):
 *   packages/verify/node_modules/.bin/tsx \
 *     templates/modules/top_down/src/systems/__tests__/ShrinkingArena.drive.mts
 */
import assert from 'node:assert/strict';
// Dynamic import: the source modules carry a type-only `@contract` import that trips
// tsx's static named-export resolution; `import()` loads the REAL classes/bus cleanly
// (same objects, no aliasing). The real shared transport facade lives at
// ../../../../../core-contract/src/component-surface.ts (the alias @contract maps to
// per templates/core/tsconfig.json); we load it by relative path so tsx needs no alias.
const { ShrinkingArena } = (await import('../ShrinkingArena.ts')) as typeof import('../ShrinkingArena.ts');
const { EventBus } = (await import('../../../../../core-contract/src/component-surface.ts')) as typeof import('../../../../../core-contract/src/component-surface.ts');

let passed = 0;
let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); passed += 1; console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

/** A real getChildren-backed enemy group (what scene.enemies is to the wave gate). */
function makeEnemyGroup(children: any[]) {
  return { getChildren: () => children.slice() };
}

/** A real alive enemy the component counts (active, not flagged dead). */
function makeEnemy() {
  return { active: true, isDead: false };
}

/** A real player whose position the closing wall actually clamps. */
function makePlayer(x: number, y: number) {
  return { x, y, active: true, isDead: false, body: null as any };
}

/**
 * A minimal REAL scene fixture: the live world surface the component reads. The
 * enemies group + waveIndex are the wave-clear gate; the eventBus is the REAL bus so
 * arena.contracted is genuinely recorded; arenaRadius/arenaBounds are the OBSERVABLE
 * scene scalars the __GAME__ adapter publishes.
 */
function makeScene(opts: { player: any; enemies: any[]; waveIndex?: number; mapWidth?: number; mapHeight?: number }) {
  return {
    player: opts.player,
    enemies: makeEnemyGroup(opts.enemies),
    waveIndex: opts.waveIndex ?? 0,
    mapWidth: opts.mapWidth ?? 600,
    mapHeight: opts.mapHeight ?? 800,
    eventBus: new EventBus(),
    gameCompleted: false,
    // no add.graphics / fireEffect → the cosmetic wall + effect are clean no-ops (headless).
  } as any;
}

// ════════════════════════════════════════════════════════════════════════════
//  DRIVE 1 — clear a wave through the REAL update() gate: enemies present, then
//  the set empties → arena.contracted fires; arenaRadius falls; arenaBounds shrinks
//  to a strictly smaller inner rect.
// ════════════════════════════════════════════════════════════════════════════
check('arena.contracted — clearing a wave via update() shrinks the arena + logs the event', () => {
  const player = makePlayer(300, 400); // map 600x800 → center (300,400), well inside
  const enemies = [makeEnemy(), makeEnemy()];
  const scene = makeScene({ player, enemies });
  const sys = new ShrinkingArena({ step: 0.15, minRadius: 0.25, margin: 8 });
  sys.attach(scene);

  // Precondition: opening footprint published, no contraction yet.
  // startRadius = min(600,800)/2 - 8 = 300 - 8 = 292.
  assert.equal(scene.arenaRadius, 292, 'opening radius derived from world span (min(W,H)/2 - margin)');
  const openBounds = { ...(scene.arenaBounds) };
  assert.deepEqual(openBounds, { x: 8, y: 108, width: 584, height: 584 }, 'opening inner rect square, inset by the radius');
  const sinceSeq = scene.eventBus.cursor;

  // Tick with enemies ALIVE → arms the wave-cleared gate; no contraction.
  sys.update();
  assert.equal(scene.arenaRadius, 292, 'no contraction while the wave still has live enemies');
  assert.equal(scene.eventBus.recent(sinceSeq).filter((e) => e.type === 'arena.contracted').length, 0, 'no event while enemies alive');

  // DRIVE the verb: clear the wave — the live enemy set empties at the gate.
  scene.enemies = makeEnemyGroup([]);
  sys.update(); // <-- the REAL in-game verb (wave-clear EDGE through update())

  // (a) OBSERVABLE: arena.contracted fired exactly once on the REAL bus.
  const fired = scene.eventBus.recent(sinceSeq).filter((e) => e.type === 'arena.contracted');
  assert.equal(fired.length, 1, 'arena.contracted fired exactly once on clearing the wave');

  // (b) the payload is {arenaRadius,step} = round(292*0.85)=248, step 1.
  const payload = fired[0].payload as { arenaRadius: number; step: number };
  assert.equal(payload.step, 1, 'step = 1 (first contraction)');
  assert.equal(payload.arenaRadius, 248, 'arenaRadius payload = round(292 * (1-0.15)) = 248');

  // (c) OBSERVABLE: scene.arenaRadius DECREASED (monotone fall). 292*0.85 = 248.2.
  assert.ok(scene.arenaRadius < 292, `scene.arenaRadius fell (292 → ${scene.arenaRadius})`);
  assert.ok(Math.abs(scene.arenaRadius - 248.2) < 1e-6, 'radius = 292 * 0.85 = 248.2');

  // (d) OBSERVABLE: scene.arenaBounds shrank to a STRICTLY smaller inner rect.
  const b = scene.arenaBounds;
  assert.ok(b.width < openBounds.width, `arenaBounds width shrank (${openBounds.width} → ${b.width})`);
  assert.ok(b.height < openBounds.height, `arenaBounds height shrank (${openBounds.height} → ${b.height})`);
  // reachable non-wall AREA strictly shrinks.
  assert.ok(b.width * b.height < openBounds.width * openBounds.height, 'reachable area strictly shrank');
});

// ════════════════════════════════════════════════════════════════════════════
//  DRIVE 2 — the closing wall has TEETH: a player left OUTSIDE the freshly-closed
//  footprint is clamped back to the boundary (the `expect` "player is clamped
//  inside the closed walls").
// ════════════════════════════════════════════════════════════════════════════
check('arena.contracted — the closing wall clamps a player caught outside the new footprint', () => {
  // Player parked near the OLD edge (x close to the opening right wall 592) so that
  // after one contraction it sits OUTSIDE the new, smaller right bound.
  const player = makePlayer(590, 400);
  const enemies = [makeEnemy()];
  const scene = makeScene({ player, enemies });
  const sys = new ShrinkingArena({ step: 0.15, minRadius: 0.25, margin: 8 });
  sys.attach(scene);

  sys.update();                       // enemies alive → arm the gate
  scene.enemies = makeEnemyGroup([]); // clear the wave
  sys.update();                       // contract + clamp in the SAME tick

  const b = scene.arenaBounds;
  const right = b.x + b.width; // new right wall
  // The new footprint is smaller, so the new right wall < 590 → player must be clamped to it.
  assert.ok(right < 590, `new right wall closed in past the player (right=${right} < 590)`);
  assert.equal(player.x, right, 'player was PUSHED by the closing wall to the new right boundary');
  // y was inside (400 within [cy-r, cy+r]) → untouched.
  assert.equal(player.y, 400, 'player y untouched (already inside the vertical bound)');
});

// ════════════════════════════════════════════════════════════════════════════
//  DRIVE 3 — MONOTONE over multiple waves (WaveSpawner re-arms via waveIndex): each
//  cleared wave contracts once and the radius STRICTLY falls until the floor.
// ════════════════════════════════════════════════════════════════════════════
check('arena.contracted — each cleared wave contracts once; radius strictly falls to the floor (monotone)', () => {
  const player = makePlayer(300, 400);
  const scene = makeScene({ player, enemies: [makeEnemy()], waveIndex: 0 });
  const sys = new ShrinkingArena({ step: 0.15, minRadius: 0.25, margin: 8 });
  sys.attach(scene);
  const sinceSeq = scene.eventBus.cursor;
  const startRadius = scene.arenaRadius; // 292
  const floor = startRadius * 0.25;      // 73

  const radii: number[] = [];
  // Simulate 12 waves: each wave = (advance waveIndex, spawn enemies, clear them).
  for (let w = 1; w <= 12; w += 1) {
    scene.waveIndex = w;                       // WaveSpawner releases the next wave
    scene.enemies = makeEnemyGroup([makeEnemy()]);
    sys.update();                              // enemies alive → re-arm
    scene.enemies = makeEnemyGroup([]);        // wave cleared
    sys.update();                              // contract once
    radii.push(scene.arenaRadius);
  }

  // OBSERVABLE: strictly DECREASING until it pins at the floor, never rising.
  let pinnedAt = -1;
  for (let i = 0; i < radii.length; i += 1) {
    if (i > 0) assert.ok(radii[i] <= radii[i - 1] + 1e-6, `radius never rises (step ${i}: ${radii[i - 1]} → ${radii[i]})`);
    if (pinnedAt < 0 && radii[i] <= floor + 1e-6) pinnedAt = i;
  }
  // It reached the floor and STOPPED emitting (no no-op contractions at the floor).
  assert.ok(radii[radii.length - 1] <= floor + 1e-6, `radius reached the floor (${radii[radii.length - 1]} ≤ ${floor})`);
  assert.ok(radii[0] > radii[radii.length - 1], 'net strict shrink from wave 1 to last');

  // Each NON-floor clear emitted exactly one arena.contracted; the count of emits
  // equals the count of real (non-no-op) contractions.
  const emits = scene.eventBus.recent(sinceSeq).filter((e) => e.type === 'arena.contracted');
  const realContractions = radii.filter((r, i) => i === 0 || r < radii[i - 1] - 1e-6).length;
  assert.equal(emits.length, realContractions, 'one emit per real contraction; floor no-ops emit nothing');
  // step counter is monotone 1..N matching the emit order.
  emits.forEach((e, i) => assert.equal((e.payload as any).step, i + 1, `step counter = ${i + 1}`));
});

// ════════════════════════════════════════════════════════════════════════════
//  COUNTERFACTUAL — proves the assertions BITE: a wave that NEVER held an enemy is a
//  clean no-op (no clear edge) → NO contraction, NO event. This is the same
//  observable that fails if update()'s clear-gate / contract() were no-op'd.
// ════════════════════════════════════════════════════════════════════════════
check('arena.contracted — counterfactual: an empty board that never held an enemy never contracts (no false fire)', () => {
  const player = makePlayer(300, 400);
  const scene = makeScene({ player, enemies: [] }); // never any enemy
  const sys = new ShrinkingArena({});
  sys.attach(scene);
  const open = scene.arenaRadius;
  const sinceSeq = scene.eventBus.cursor;

  for (let i = 0; i < 5; i += 1) sys.update(); // tick repeatedly with an empty board

  assert.equal(scene.arenaRadius, open, 'no contraction without a real wave-clear edge');
  assert.equal(scene.eventBus.recent(sinceSeq).filter((e) => e.type === 'arena.contracted').length, 0, 'no false arena.contracted');
});

// ── cross-check: the public onWaveCleared() seam takes the SAME contract() path ──
check('arena.contracted — onWaveCleared() seam drives the identical contract (radius falls + event fires)', () => {
  const scene = makeScene({ player: makePlayer(300, 400), enemies: [] });
  const sys = new ShrinkingArena({ step: 0.2 });
  sys.attach(scene);
  const open = scene.arenaRadius;
  const sinceSeq = scene.eventBus.cursor;
  const returned = sys.onWaveCleared();
  assert.ok(returned < open, 'onWaveCleared returns the fallen radius');
  assert.equal(scene.arenaRadius, returned, 'scene.arenaRadius matches the returned radius');
  assert.equal(scene.eventBus.recent(sinceSeq).filter((e) => e.type === 'arena.contracted').length, 1, 'one arena.contracted via the seam');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${passed} passed, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
