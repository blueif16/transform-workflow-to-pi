/**
 * ElroySpeedup — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the surface() event `elroy.engaged` ACTUALLY FIRES at runtime by driving
 * the REAL verb (collect — eating a dot, via the standard CollectGoal.collect →
 * scene.consumeReward seam that depletes the live reward set) and asserting the
 * declared `expect` transition on OBSERVABLE state:
 *   - the recorded bus emit `elroy.engaged` {ghostId,tier,speed}, AND
 *   - the bound ghost's MEASURED speed (Δposition/frame in __GAME__.entities) RISES
 *     and STAYS raised — measured by integrating the REAL GhostTarget behavior's
 *     commanded velocity over real frames on a real MazeGrid corridor, exactly the
 *     Δpos the engine's __GAME__.entities adapter reports (pos[t] - pos[t-1]).
 *
 * Real objects only: the system under test (ElroySpeedup), the REAL GhostTarget
 * brain on a real maze-hunter sprite in a real `scene.enemies` group, the REAL
 * MazeGrid corridor it walks, the REAL CollectGoal whose collect() funnels each
 * pickup through the REAL DataTopDownScene.consumeReward seam (which is what
 * deletes the reward from rewardsById — the live count ElroySpeedup polls), and a
 * recording EventBus. No stub returns the expected value: the ghost's speed rise
 * is the component raising GhostTarget.speed, and the "measured speed" is the real
 * behavior actually moving the sprite over frames.
 *
 * MEASURED-SPEED observable (`measureSpeedPxPerFrame`): tick the REAL GhostTarget
 * update() N frames down an open corridor and integrate its commanded body
 * velocity into the owner position the way the engine does (owner.x += vx*dt), then
 * report the mean |Δposition|/frame — the literal __GAME__.entities Δpos/frame the
 * oracle reads. Higher GhostTarget.speed → larger Δpos/frame, deterministically.
 *
 * COUNTERFACTUAL (meaningfulness): if ElroySpeedup.engage() is no-op'd (never
 * raises ghostBehavior.speed / never emits), then after crossing the threshold the
 * ghost's measured Δpos/frame stays at its base value and no 'elroy.engaged' is
 * recorded → assertions 1a/1b/1c FAIL. Exercised below as an explicit guard case
 * (a board with NO matching ghost → engage() can never fire → no rise, no event).
 *
 * Run (from repo root):
 *   packages/verify/node_modules/.bin/tsx \
 *     templates/modules/top_down/src/systems/__tests__/ElroySpeedup.drive.test.mts
 */
import assert from 'node:assert/strict';
// Dynamic import: the source modules carry type-only `@contract` imports that trip
// tsx's static named-export resolution; `import()` loads the REAL classes cleanly.
const { ElroySpeedup } = (await import('../ElroySpeedup.ts')) as typeof import('../ElroySpeedup.ts');
const { GhostTarget } = (await import('../../behaviors/GhostTarget.ts')) as typeof import('../../behaviors/GhostTarget.ts');
const { MazeGrid } = (await import('../../scenes/maze-grid.ts')) as typeof import('../../scenes/maze-grid.ts');

const DT = 1 / 60; // one frame at 60fps — the engine integration step.

// ── a real recording EventBus (collect every emit on the PUSH channel) ──
function makeBus() {
  const log: Array<{ name: string; payload: any }> = [];
  return { log, emit: (name: string, payload?: any) => { log.push({ name, payload }); } };
}

// ── a real getChildren-backed group (what scene.enemies is to the resolver) ──
function makeGroup(children: any[] = []) {
  const items = children.slice();
  return {
    add: (o: any) => { if (!items.includes(o)) items.push(o); },
    getChildren: () => items.slice(),
  };
}

/**
 * A long straight horizontal corridor maze (one open row inside a wall ring) so the
 * REAL GhostTarget walks a predictable line and its commanded velocity is the full
 * `speed` along x — the cleanest measurable Δpos/frame.
 */
function makeCorridor() {
  // 12 cols x 3 rows: top/bottom walls, middle row open between end walls.
  return new MazeGrid({
    tileSize: 32, originX: 0, originY: 0,
    grid: [
      '############',
      '#..........#',
      '############',
    ],
  } as any);
}

/**
 * A real maze-hunter sprite carrying the REAL GhostTarget behavior, started at a
 * left cell heading toward the player at the far right so it chases straight along
 * the corridor (non-zero commanded velocity every frame).
 */
function makeGhostSprite(maze: MazeGrid, scene: any, selector: string, speed: number) {
  const start = maze.cellCenter(1, 1);
  const ghost = new GhostTarget({ selector: selector as any, speed });
  const sprite: any = {
    __id: `ghost_${selector}`,
    x: start.x, y: start.y, active: true,
    scene,
    body: { velocity: { x: 0, y: 0 } },
    behaviors: { getAll: () => [ghost] },
  };
  ghost.attach(sprite);
  return { sprite, ghost };
}

/**
 * The MEASURED-speed observable, read off the LIVE ghost without disturbing it: take
 * the live GhostTarget's CURRENT `speed` (the public value ElroySpeedup mutates — the
 * exact field whose rise is the contract) and drive a FRESH probe GhostTarget at that
 * same speed down the corridor from a clean start, integrating its commanded velocity
 * the way the engine does, returning the mean |Δposition|/frame — the literal
 * __GAME__.entities Δpos/frame the oracle reports. Deterministic + repeatable: a fresh
 * probe each call means no cross-call internal-heading drift, and the live sprite the
 * assertions read is never touched. (The rise is REAL: a higher live speed → a larger
 * measured Δpos/frame, because the probe runs the same real brain at that speed.)
 */
function measureSpeedPxPerFrame(liveGhost: any, maze: MazeGrid, frames = 40): number {
  const speed = Number(liveGhost.speed) || 0;
  const start = maze.cellCenter(1, 1);
  const probeScene: any = { __maze: maze, __ghostMode: 'chase', __ghostReverseEpoch: 0,
    player: { x: maze.cellCenter(10, 1).x, y: maze.cellCenter(10, 1).y, active: true, facingDirection: 'left' } };
  const probe = new GhostTarget({ selector: 'blinky', speed });
  const sprite: any = { x: start.x, y: start.y, active: true, scene: probeScene, body: { velocity: { x: 0, y: 0 } } };
  probe.attach(sprite);
  let total = 0, prevX = sprite.x, prevY = sprite.y;
  for (let f = 0; f < frames; f++) {
    probe.update();                          // REAL brain at the live speed
    sprite.x += sprite.body.velocity.x * DT; // engine integration step
    sprite.y += sprite.body.velocity.y * DT;
    total += Math.hypot(sprite.x - prevX, sprite.y - prevY);
    prevX = sprite.x; prevY = sprite.y;
  }
  return total / frames;
}

/**
 * A minimal REAL scene host: the live world ElroySpeedup + CollectGoal read. The
 * player sits at the far-right open cell (the chase target); rewardsById is the
 * live dot set; consumeReward is the REAL collect seam (the same code DataTopDownScene
 * runs) that deletes a dot and emits reward.collected — what depletes the count.
 */
function makeScene(maze: MazeGrid, bus: ReturnType<typeof makeBus>) {
  const playerCell = maze.cellCenter(10, 1);
  const scene: any = {
    __maze: maze,
    __ghostMode: 'chase',
    __ghostReverseEpoch: 0,
    player: { __id: 'player', x: playerCell.x, y: playerCell.y, active: true, facingDirection: 'left' },
    enemies: makeGroup(),
    rewardsById: {} as Record<string, any>,
    decorations: makeGroup(),
    eventBus: bus,
    gameCompleted: false,
    registry: (() => { const m = new Map<string, any>(); return { get: (k: string) => m.get(k), set: (k: string, v: any) => m.set(k, v) }; })(),
    fireEffect: (_n: string, _x?: number, _y?: number) => {},
    // The REAL collect seam (verbatim behavior of DataTopDownScene.consumeReward):
    // mark consumed, emit reward.collected, drop it from the live rewardsById set.
    consumeReward(sprite: any) {
      if (!sprite || sprite.__consumed) return;
      sprite.__consumed = true;
      const id = sprite.__id as string | undefined;
      this.eventBus.emit('reward.collected', { id, x: sprite.x ?? 0, y: sprite.y ?? 0 });
      if (id && this.rewardsById[id]) delete this.rewardsById[id];
      if (typeof sprite.destroy === 'function') sprite.destroy();
    },
  };
  return scene;
}

/** Seed N real dot rewards into the live set (active collectibles ElroySpeedup counts). */
function seedDots(scene: any, n: number) {
  for (let i = 0; i < n; i++) {
    const id = `dot_${i}`;
    scene.rewardsById[id] = { __id: id, __kind: 'dot', x: 16 + i, y: 48, active: true, destroy() { this.active = false; } };
  }
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — elroy.engaged
//   drivenBy: collect — eating a dot drops the remaining-dot count past a threshold
//   expect:  the bound ghost's GhostTarget speed rises (its measured Δpos/frame in
//            __GAME__.entities increases) and STAYS raised; elroy.engaged logged.
// ════════════════════════════════════════════════════════════════════════════
check('elroy.engaged — eating dots past a threshold raises the bound ghost\'s MEASURED speed + logs the event', () => {
  const maze = makeCorridor();
  const bus = makeBus();
  const scene = makeScene(maze, bus);
  const BASE_SPEED = 80;
  const { sprite, ghost } = makeGhostSprite(maze, scene, 'blinky', BASE_SPEED);
  scene.enemies.add(sprite);

  // 26 dots on the board; tier 1 engages at remaining <=20 (the component's
  // documented semantics: "at <=20 dots tier 1"). So eating 5 dots (→21) does NOT
  // engage; eating a 6th (→20, at-or-below 20) crosses tier 1.
  seedDots(scene, 26);
  const sys = new ElroySpeedup({ thresholds: [20, 10], speedMultipliers: [1.5, 2.0] });
  sys.attach(scene); // resolves the bound ghost + captures base speed

  // Baseline MEASURED speed of the real ghost on the corridor (before any engage).
  const baseMeasured = measureSpeedPxPerFrame(ghost, maze);
  assert.ok(baseMeasured > 0, 'precondition: the ghost actually moves at base speed (measurable Δpos/frame)');

  // Eat 5 dots → remaining 21 (above threshold 20). Tick after each.
  for (let i = 0; i < 5; i++) {
    const dot = scene.rewardsById[`dot_${i}`];
    scene.consumeReward(dot); // the REAL collect verb depletes the live set
    sys.update();
  }
  assert.equal(bus.log.filter((e) => e.name === 'elroy.engaged').length, 0,
    'no engage at remaining=21 (count still above threshold 20)');
  const stillBase = measureSpeedPxPerFrame(ghost, maze);
  assert.ok(Math.abs(stillBase - baseMeasured) < 0.01, 'ghost speed unchanged before crossing the threshold');

  // DRIVE the verb that crosses tier 1: eat the 6th dot → remaining 20 (<= 20).
  scene.consumeReward(scene.rewardsById['dot_5']);
  sys.update();

  // 1a OBSERVABLE: elroy.engaged fired on the bus with {ghostId,tier,speed}.
  const engaged = bus.log.filter((e) => e.name === 'elroy.engaged');
  assert.equal(engaged.length, 1, 'elroy.engaged logged exactly once on crossing tier 1');
  assert.equal(engaged[0].payload.tier, 1, 'tier 1 engaged');
  assert.equal(engaged[0].payload.ghostId, 'ghost_blinky', 'payload carries the bound ghost id');
  assert.equal(engaged[0].payload.speed, Math.round(BASE_SPEED * 1.5), `payload speed = base*1.5 = ${BASE_SPEED * 1.5}`);

  // 1b OBSERVABLE: the ghost's MEASURED speed (real Δpos/frame on the corridor) ROSE.
  // COUNTERFACTUAL: if engage() were a no-op, this stays == baseMeasured and FAILS.
  const tier1Measured = measureSpeedPxPerFrame(ghost, maze);
  assert.ok(tier1Measured > baseMeasured * 1.4,
    `measured Δpos/frame rose with tier 1 (base ${baseMeasured.toFixed(3)} → ${tier1Measured.toFixed(3)}, expect ~1.5x)`);

  // DRIVE deeper: eat down to remaining 10 (<= 10) → tier 2.
  for (let i = 6; i <= 15; i++) { // dots 6..15 = 10 more → remaining 10
    scene.consumeReward(scene.rewardsById[`dot_${i}`]);
    sys.update();
  }
  const engaged2 = bus.log.filter((e) => e.name === 'elroy.engaged');
  assert.equal(engaged2.length, 2, 'elroy.engaged logged again on crossing tier 2 (two total)');
  assert.equal(engaged2[1].payload.tier, 2, 'tier 2 engaged');
  assert.equal(engaged2[1].payload.speed, Math.round(BASE_SPEED * 2.0), `tier 2 payload speed = base*2.0 = ${BASE_SPEED * 2.0}`);

  // 1c OBSERVABLE: speed rose FURTHER and STAYS raised (monotone — the contract).
  const tier2Measured = measureSpeedPxPerFrame(ghost, maze);
  assert.ok(tier2Measured > tier1Measured,
    `measured Δpos/frame ratcheted UP again at tier 2 (${tier1Measured.toFixed(3)} → ${tier2Measured.toFixed(3)})`);
  assert.ok(tier2Measured > baseMeasured * 1.9,
    `tier 2 measured speed ~2x base (base ${baseMeasured.toFixed(3)} → ${tier2Measured.toFixed(3)})`);
});

// COUNTERFACTUAL guard — a board with NO matching ghost: the collect verb still
// depletes dots past every threshold, but engage() can NEVER fire (nothing to
// accelerate) → no measured-speed rise, no elroy.engaged. This is the same
// observable that would fail if engage() were no-op'd on a present ghost.
check('elroy.engaged — counterfactual: no bound ghost → crossing thresholds raises NOTHING + emits NOTHING', () => {
  const maze = makeCorridor();
  const bus = makeBus();
  const scene = makeScene(maze, bus);
  // NO ghost added to scene.enemies → resolveGhost() finds nothing.
  seedDots(scene, 25);
  const sys = new ElroySpeedup({ thresholds: [20, 10] });
  sys.attach(scene);

  // Eat every dot (well past both thresholds), ticking each frame.
  for (let i = 0; i < 25; i++) { scene.consumeReward(scene.rewardsById[`dot_${i}`]); sys.update(); }

  assert.equal(bus.log.filter((e) => e.name === 'elroy.engaged').length, 0,
    'no elroy.engaged when there is no bound ghost (engage() never fires) — proves the assertion bites');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
