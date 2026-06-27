/**
 * GhostHouseRelease — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the surface() event `ghost.released` ACTUALLY FIRES at runtime by driving
 * the REAL verb (collect — eating a dot, via the standardized `reward.collected`
 * bus event the SUT subscribes to in attach()) on the REAL GhostHouseRelease class,
 * and asserting EACH part of the declared `expect` transition on OBSERVABLE state:
 *   - the named ghost LEAVES the pen and BEGINS HUNTING — its REAL GhostTarget
 *     behavior flips enabled false→true, so the engine's BehaviorManager.update()
 *     loop now drives it and its entity starts MOVING in __GAME__.entities (its
 *     measured Δpos/frame goes 0 → non-zero), AND
 *   - scene.ghostsReleased INCREMENTS (monotonic, 0..n), AND
 *   - `ghost.released` is logged on the bus with {ghostId,ghostsReleased}.
 *
 * REAL objects only: the system under test (GhostHouseRelease), the REAL GhostTarget
 * brain on each maze-hunter sprite, each sprite's REAL BehaviorManager (the same
 * getAll() the SUT's resolver walks AND the same enabled-gated update() loop the
 * engine runs), a real getChildren-backed `scene.enemies` group, the REAL MazeGrid
 * corridor the ghosts walk, and a recording EventBus that ALSO dispatches (.on/.emit)
 * so the SUT's OWN reward.collected / player.died subscriptions fire. No stub returns
 * the expected value: the "begins moving" observable is the REAL GhostTarget actually
 * driving the body velocity once un-gated, integrated over real frames the way the
 * engine's __GAME__.entities adapter reports it (pos[t] - pos[t-1]).
 *
 * MOVEMENT observable (`measureDeltaPxPerFrame`): run the engine's per-frame loop —
 * sprite.behaviors.update() (which SKIPS a disabled behavior, exactly like the live
 * BehaviorManager) then integrate body.velocity into the owner position (owner.x +=
 * vx*dt) — over N frames and report mean |Δposition|/frame, the literal Δpos/frame
 * the oracle reads. A penned ghost (GhostTarget.enabled=false) is skipped → 0; a
 * released ghost (enabled=true) runs its brain → non-zero. Deterministic.
 *
 * COUNTERFACTUAL (meaningfulness): if release() were no-op'd (never sets
 * behavior.enabled=true / never bumps ghostsReleased / never emits), then after the
 * dot crosses the threshold the penned ghost STAYS gated (its Δpos/frame stays 0),
 * scene.ghostsReleased does NOT rise, and no 'ghost.released' is logged → every
 * assertion below FAILS. Exercised directly as a guard (a sub-threshold dot count
 * does not cross → nothing releases, nothing moves, nothing logs — the same
 * observable a broken release would show), and via a no-penned-ghost board.
 *
 * Run (from repo root):
 *   packages/verify/node_modules/.bin/tsx \
 *     templates/modules/top_down/src/systems/__tests__/GhostHouseRelease.drive.test.mts
 */
import assert from 'node:assert/strict';
// Dynamic import: the source modules carry type-only `@contract` imports that trip
// tsx's static named-export resolution; `import()` loads the REAL classes cleanly.
const { GhostHouseRelease } = (await import('../GhostHouseRelease.ts')) as typeof import('../GhostHouseRelease.ts');
const { GhostTarget } = (await import('../../behaviors/GhostTarget.ts')) as typeof import('../../behaviors/GhostTarget.ts');
const { BehaviorManager } = (await import('../../behaviors/BehaviorManager.ts')) as typeof import('../../behaviors/BehaviorManager.ts');
const { MazeGrid } = (await import('../../scenes/maze-grid.ts')) as typeof import('../../scenes/maze-grid.ts');

const DT = 1 / 60; // one frame at 60fps — the engine integration step.

// ── a real recording EventBus that ALSO dispatches (so the SUT's own
//    reward.collected / player.died subscriptions actually fire). Every emit is
//    logged AND delivered to registered listeners — a real bus, not a stub. ──
function makeBus() {
  const log: Array<{ name: string; payload: any }> = [];
  const listeners = new Map<string, Array<(p?: any) => void>>();
  return {
    log,
    on(name: string, cb: (p?: any) => void) {
      const arr = listeners.get(name) ?? [];
      arr.push(cb);
      listeners.set(name, arr);
      return () => { const a = listeners.get(name); if (a) a.splice(a.indexOf(cb), 1); };
    },
    emit(name: string, payload?: any) {
      log.push({ name, payload });
      for (const cb of listeners.get(name)?.slice() ?? []) cb(payload);
    },
  };
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
 * A long straight horizontal corridor maze (one open row inside a wall ring) so a
 * released ghost (chasing the far-right player) walks a predictable line and its
 * commanded velocity is the full `speed` along x — the cleanest measurable Δpos/frame.
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
 * A real maze-hunter sprite carrying the REAL GhostTarget behavior inside a REAL
 * BehaviorManager (the same getAll() the SUT's resolver walks, and the same
 * enabled-gated update() loop the engine runs). Started at the left of the corridor
 * so a released ghost chases the far-right player straight along the open row.
 */
function makeGhostSprite(maze: any, scene: any, selector: string, col: number, speed = 80) {
  const start = maze.cellCenter(col, 1);
  const ghost = new GhostTarget({ selector: selector as any, speed });
  const sprite: any = {
    __id: `ghost_${selector}`,
    __type: 'enemy',
    x: start.x, y: start.y, active: true,
    scene,
    body: { velocity: { x: 0, y: 0 } },
  };
  sprite.behaviors = new BehaviorManager(sprite);
  sprite.behaviors.add('target', ghost); // attach() binds the brain to this sprite
  return { sprite, ghost };
}

/**
 * The MOVEMENT observable, read off a sprite the way the engine's __GAME__.entities
 * adapter does: run the engine per-frame loop — sprite.behaviors.update() (which
 * SKIPS a disabled behavior, exactly like the live BehaviorManager) then integrate
 * the commanded body velocity into the owner position (owner.x += vx*dt) — over N
 * frames, returning mean |Δposition|/frame. A penned ghost (enabled=false) is skipped
 * → 0; a released ghost (enabled=true) runs its real brain → non-zero. We snapshot &
 * restore the sprite pose so measuring never disturbs the live sprite.
 */
function measureDeltaPxPerFrame(sprite: any, frames = 30): number {
  const save = { x: sprite.x, y: sprite.y, vx: sprite.body.velocity.x, vy: sprite.body.velocity.y };
  let total = 0, prevX = sprite.x, prevY = sprite.y;
  for (let f = 0; f < frames; f++) {
    sprite.behaviors.update();               // engine loop: disabled brain is SKIPPED
    sprite.x += sprite.body.velocity.x * DT;  // engine integration step
    sprite.y += sprite.body.velocity.y * DT;
    total += Math.hypot(sprite.x - prevX, sprite.y - prevY);
    prevX = sprite.x; prevY = sprite.y;
  }
  sprite.x = save.x; sprite.y = save.y;
  sprite.body.velocity.x = save.vx; sprite.body.velocity.y = save.vy;
  return total / frames;
}

/**
 * A minimal REAL scene host: the live world GhostHouseRelease + GhostTarget read by
 * name. The player sits at the far-right open cell (the chase target so a released
 * ghost moves); enemies is the live ghost group; eventBus is the recording bus the
 * SUT subscribes to. __ghostMode 'chase' so the brain targets the player (motion).
 */
function makeScene(maze: any, bus: ReturnType<typeof makeBus>) {
  const playerCell = maze.cellCenter(10, 1);
  return {
    __maze: maze,
    __ghostMode: 'chase',
    __ghostReverseEpoch: 0,
    player: { __id: 'player', x: playerCell.x, y: playerCell.y, active: true, facingDirection: 'left' },
    enemies: makeGroup(),
    eventBus: bus,
    gameCompleted: false,
    ghostsReleased: 0,
    fireEffect: (_n: string, _x?: number, _y?: number) => {},
  } as any;
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — ghost.released
//   drivenBy: collect — eating a dot ticks the next penned ghost's dot counter past
//             its release threshold.
//   expect:  the named ghost leaves the pen and begins hunting (its GhostTarget
//            enables so its entity starts moving in __GAME__.entities) and
//            scene.ghostsReleased increments (monotonic, 0..n); ghost.released logged.
// ════════════════════════════════════════════════════════════════════════════
check('ghost.released — eating a dot past a ghost\'s threshold un-pens it (it starts MOVING), bumps ghostsReleased + logs the event', () => {
  const maze = makeCorridor();
  const bus = makeBus();
  const scene = makeScene(maze, bus);

  // Lead 'blinky' (loose from start) + two penned: 'pinky' (personal threshold 0 →
  // releases on the FIRST dot) and 'inky' (threshold 2 → releases on the 2nd dot).
  const lead = makeGhostSprite(maze, scene, 'blinky', 1);
  const pinky = makeGhostSprite(maze, scene, 'pinky', 2);
  const inky = makeGhostSprite(maze, scene, 'inky', 3);
  scene.enemies.add(lead.sprite);
  scene.enemies.add(pinky.sprite);
  scene.enemies.add(inky.sprite);

  const sys = new GhostHouseRelease({
    leadSelector: 'blinky',
    releaseOrder: ['pinky', 'inky'],
    personalThresholds: [0, 2],
  });
  sys.attach(scene); // pens pinky+inky (GhostTarget.enabled=false), opens the lead

  // ── precondition: lead loose (counts), both penned ghosts GATED + MOTIONLESS ──
  assert.equal(scene.ghostsReleased, 1, 'lead opens the board → ghostsReleased = 1');
  assert.equal(pinky.ghost.enabled, false, 'pinky starts PENNED (GhostTarget disabled)');
  assert.equal(inky.ghost.enabled, false, 'inky starts PENNED (GhostTarget disabled)');
  const pinkyPennedDelta = measureDeltaPxPerFrame(pinky.sprite);
  assert.equal(pinkyPennedDelta, 0, `a penned ghost does NOT move (Δpos/frame=${pinkyPennedDelta})`);
  // sanity: the lead (loose) DOES move — proves the corridor/brain produce motion.
  const leadDelta = measureDeltaPxPerFrame(lead.sprite);
  assert.ok(leadDelta > 0, `the loose lead moves (Δpos/frame=${leadDelta.toFixed(3)}) — corridor produces motion`);

  // ── DRIVE the verb: eat ONE dot (the real reward.collected bus event). pinky's
  //    personal threshold is 0, so the first dot crosses it → pinky releases. ──
  let cur = bus.log.length;
  bus.emit('reward.collected', { id: 'dot_0', x: 16, y: 48 });

  // 1a OBSERVABLE: pinky's GhostTarget flipped enabled false→true (un-penned).
  assert.equal(pinky.ghost.enabled, true, 'pinky\'s GhostTarget enabled (released from the pen)');
  // 1b OBSERVABLE: pinky now MOVES in __GAME__.entities (its Δpos/frame went 0 → >0).
  //    COUNTERFACTUAL: if release() never enabled it, this stays 0 and FAILS.
  const pinkyReleasedDelta = measureDeltaPxPerFrame(pinky.sprite);
  assert.ok(pinkyReleasedDelta > 0,
    `released pinky starts MOVING (Δpos/frame 0 → ${pinkyReleasedDelta.toFixed(3)})`);
  // 1c OBSERVABLE: scene.ghostsReleased incremented (1 → 2).
  assert.equal(scene.ghostsReleased, 2, 'ghostsReleased incremented on pinky\'s release (1 → 2)');
  // 1d OBSERVABLE: ghost.released logged once with {ghostId,ghostsReleased}.
  let released = bus.log.slice(cur).filter((e) => e.name === 'ghost.released');
  assert.equal(released.length, 1, 'ghost.released logged exactly once on pinky\'s release');
  assert.equal(released[0].payload.ghostId, 'ghost_pinky', 'payload carries the released ghost id (auto-derived from __id)');
  assert.equal(released[0].payload.ghostsReleased, 2, 'payload carries the live ghostsReleased count');
  // strict release order: inky (next in line, threshold 2) must NOT have released yet.
  assert.equal(inky.ghost.enabled, false, 'inky still PENNED (its threshold 2 not yet reached)');

  // ── DRIVE deeper: eat a 2nd dot. inky's personal threshold is 2; the personal
  //    counter re-based to 0 after pinky left, so it now reads 1 — still < 2, inky
  //    stays penned. The 3rd dot makes it 2 → inky releases. ──
  bus.emit('reward.collected', { id: 'dot_1', x: 48, y: 48 });
  assert.equal(inky.ghost.enabled, false, 'inky still penned at counter=1 (threshold 2 not crossed)');
  assert.equal(scene.ghostsReleased, 2, 'ghostsReleased unchanged while inky stays penned');

  cur = bus.log.length;
  bus.emit('reward.collected', { id: 'dot_2', x: 80, y: 48 }); // counter 2 → crosses inky's threshold

  // 2a/2b OBSERVABLE: inky released → enabled + MOVING.
  assert.equal(inky.ghost.enabled, true, 'inky\'s GhostTarget enabled (released)');
  const inkyReleasedDelta = measureDeltaPxPerFrame(inky.sprite);
  assert.ok(inkyReleasedDelta > 0, `released inky starts MOVING (Δpos/frame ${inkyReleasedDelta.toFixed(3)})`);
  // 2c OBSERVABLE: ghostsReleased ratcheted up again (2 → 3) — monotonic.
  assert.equal(scene.ghostsReleased, 3, 'ghostsReleased incremented again on inky\'s release (2 → 3)');
  // 2d OBSERVABLE: a second, distinct ghost.released logged.
  released = bus.log.slice(cur).filter((e) => e.name === 'ghost.released');
  assert.equal(released.length, 1, 'a second ghost.released logged on inky\'s release');
  assert.equal(released[0].payload.ghostId, 'ghost_inky', 'second release carries inky\'s id');
  assert.equal(released[0].payload.ghostsReleased, 3, 'second release carries the bumped count');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — ghost.released via the POST-DEATH global counter (the other driver)
//   A life loss (player.died) switches personal→global thresholds (GameInternals).
// ════════════════════════════════════════════════════════════════════════════
check('ghost.released — after a life loss, the GLOBAL dot counter releases the next ghost (post-death scheme)', () => {
  const maze = makeCorridor();
  const bus = makeBus();
  const scene = makeScene(maze, bus);

  const lead = makeGhostSprite(maze, scene, 'blinky', 1);
  const pinky = makeGhostSprite(maze, scene, 'pinky', 2);
  scene.enemies.add(lead.sprite);
  scene.enemies.add(pinky.sprite);

  // High PERSONAL threshold so pinky does NOT release pre-death; low GLOBAL threshold
  // so it releases post-death after a few global dots (Dossier post-death scheme).
  const sys = new GhostHouseRelease({
    leadSelector: 'blinky',
    releaseOrder: ['pinky'],
    personalThresholds: [999],
    globalThresholds: [3],
  });
  sys.attach(scene);
  assert.equal(scene.ghostsReleased, 1, 'lead loose at start');

  // Eat dots PRE-death: personal threshold 999 → pinky never releases.
  bus.emit('reward.collected', {});
  bus.emit('reward.collected', {});
  assert.equal(pinky.ghost.enabled, false, 'pinky stays penned pre-death (personal threshold not crossed)');
  assert.equal(scene.ghostsReleased, 1, 'no release pre-death');

  // DRIVE the life loss: player.died switches to the GLOBAL counter (re-based to 0).
  bus.emit('player.died', {});

  // Eat 3 dots on the GLOBAL counter → crosses globalThreshold 3 → pinky releases.
  bus.emit('reward.collected', {});
  bus.emit('reward.collected', {});
  let cur = bus.log.length;
  bus.emit('reward.collected', {}); // global counter = 3 → crosses

  assert.equal(pinky.ghost.enabled, true, 'pinky released on the global counter crossing post-death');
  assert.equal(scene.ghostsReleased, 2, 'ghostsReleased incremented on the post-death release');
  const released = bus.log.slice(cur).filter((e) => e.name === 'ghost.released');
  assert.equal(released.length, 1, 'ghost.released logged on the post-death release');
  assert.equal(released[0].payload.ghostId, 'ghost_pinky', 'post-death release carries pinky\'s id');
});

// ════════════════════════════════════════════════════════════════════════════
//  COUNTERFACTUAL guards (meaningfulness — prove the assertions BITE)
// ════════════════════════════════════════════════════════════════════════════

// Guard A: a SUB-threshold dot count drives the verb but never CROSSES → nothing
// releases, the penned ghost stays GATED + MOTIONLESS, ghostsReleased does not rise,
// nothing logs. This is the SAME observable a no-op'd release() would show.
check('counterfactual — below the threshold: ghost stays penned + motionless, ghostsReleased flat, no ghost.released', () => {
  const maze = makeCorridor();
  const bus = makeBus();
  const scene = makeScene(maze, bus);
  const lead = makeGhostSprite(maze, scene, 'blinky', 1);
  const pinky = makeGhostSprite(maze, scene, 'pinky', 2);
  scene.enemies.add(lead.sprite);
  scene.enemies.add(pinky.sprite);

  const sys = new GhostHouseRelease({ leadSelector: 'blinky', releaseOrder: ['pinky'], personalThresholds: [5] });
  sys.attach(scene);

  bus.emit('reward.collected', {});
  bus.emit('reward.collected', {}); // 2 dots, threshold 5 — never crosses

  assert.equal(pinky.ghost.enabled, false, 'pinky still penned below the threshold');
  assert.equal(measureDeltaPxPerFrame(pinky.sprite), 0, 'a still-penned ghost does NOT move (Δpos/frame=0)');
  assert.equal(scene.ghostsReleased, 1, 'ghostsReleased unchanged (still just the lead)');
  assert.equal(bus.log.filter((e) => e.name === 'ghost.released').length, 0, 'no ghost.released below the threshold');
});

// Guard B: a board with NO penned ghost — the verb still ticks every counter past
// every threshold, but there is nothing to release → no ghostsReleased rise, no
// ghost.released. (Same observable a no-op'd release would show on a present ghost.)
check('counterfactual — no penned ghost on the board: crossing thresholds releases NOTHING + emits NOTHING', () => {
  const maze = makeCorridor();
  const bus = makeBus();
  const scene = makeScene(maze, bus);
  const lead = makeGhostSprite(maze, scene, 'blinky', 1);
  scene.enemies.add(lead.sprite); // ONLY the lead — pinky/inky never on the board

  const sys = new GhostHouseRelease({ leadSelector: 'blinky', releaseOrder: ['pinky', 'inky'], personalThresholds: [0, 0] });
  sys.attach(scene);
  const openCount = scene.ghostsReleased; // just the lead

  for (let i = 0; i < 10; i++) bus.emit('reward.collected', {}); // well past every threshold

  assert.equal(scene.ghostsReleased, openCount, 'ghostsReleased does not rise with no penned ghost to release');
  assert.equal(bus.log.filter((e) => e.name === 'ghost.released').length, 0, 'no ghost.released with no penned ghost');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
