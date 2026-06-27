/**
 * CarrierRideSystem.drive.mts — RUNTIME DRIVE PROOF for CarrierRideSystem.
 *
 * Proves the component's surface() event ACTUALLY FIRES at runtime by driving its
 * real verb (the per-frame `update()` tick) on a minimal REAL scene fixture and
 * asserting the declared `player.carried` emit + its `expect` transition on
 * OBSERVABLE state — never an internal flag.
 *
 * Surface contract (from CarrierRideSystem.surface()):
 *   event   player.carried   payload {carrierId,dx,dy}
 *   drivenBy  "the player stands on a moving carrier on a ride lane"
 *   expect    "__GAME__.player.x|y translate by the carrier's per-frame velocity
 *              while overlapping; stepping off over open water flips status to lost;
 *              player.carried logged"
 *
 * Real objects only: the REAL EventBus (the shared transport facade) records every
 * emit; the scene/player/carrier/groups are plain real objects shaped like the live
 * world the component reads (no stub returns the expected value — the component does
 * the math). MEANINGFUL: each assertion checks the EXACT computed transition, so if
 * the verb were a no-op the test FAILS (counterfactuals stated inline below).
 *
 * Run (from repo root):
 *   packages/verify/node_modules/.bin/tsx \
 *     templates/modules/top_down/src/systems/__tests__/CarrierRideSystem.drive.mts
 */
import assert from 'node:assert/strict';
// Dynamic import: both source modules transitively carry a type-only import
// (component-surface.ts: `import type { LoggedEvent }`) that trips tsx's static
// named-export resolution; `import()` loads the REAL classes/bus cleanly (same
// objects, no aliasing). The REAL shared transport facade `@contract/component-surface`
// (the alias the component itself uses) maps to ../core-contract/src/* per
// templates/core/tsconfig.json; we load that same real module by relative path so
// tsx resolves it with no alias setup. Resolved once at startup below.
const { CarrierRideSystem } = (await import('../CarrierRideSystem.ts')) as typeof import('../CarrierRideSystem.ts');
const { EventBus } = (await import('../../../../../core-contract/src/component-surface.ts')) as typeof import('../../../../../core-contract/src/component-surface.ts');

let passed = 0;
const ok = (label: string) => {
  passed++;
  console.log(`  PASS  ${label}`);
};

/** A minimal real arcade-body (velocity + reset). */
function makeBody(vx: number, vy: number) {
  return {
    velocity: { x: vx, y: vy },
    reset(x: number, y: number) {
      this._rx = x;
      this._ry = y;
    },
    _rx: 0,
    _ry: 0,
  };
}

/** A real sprite-like object the component scans (display-center AABB + a body). */
function makeSprite(opts: {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  id?: string;
  kind?: string;
  w?: number;
  h?: number;
}) {
  return {
    x: opts.x,
    y: opts.y,
    active: true,
    isDead: false,
    displayWidth: opts.w ?? 40,
    displayHeight: opts.h ?? 24,
    __id: opts.id,
    __kind: opts.kind,
    body: makeBody(opts.vx ?? 0, opts.vy ?? 0),
  };
}

/** A real Phaser-style group facade (getChildren). */
function makeGroup(children: any[]) {
  return { getChildren: () => children };
}

/**
 * A minimal REAL scene fixture: the live world surface the component reads. The
 * registry mirrors __GAME__.status (the OBSERVABLE the drown seam flips); the
 * eventBus is the REAL bus so emits are genuinely recorded.
 */
function makeScene(opts: {
  player: any;
  carriers?: any[];
  rideLanes?: { x: number; y: number; width: number; height: number }[];
  delta?: number;
}) {
  const status = { value: 'playing' };
  return {
    player: opts.player,
    decorations: makeGroup(opts.carriers ?? []),
    enemies: makeGroup([]),
    obstacles: makeGroup([]),
    eventBus: new EventBus(),
    levelData: { rideLanes: opts.rideLanes ?? [] },
    mapWidth: 432,
    mapHeight: 768,
    gameCompleted: false,
    game: { loop: { delta: opts.delta ?? 1000 / 60 } },
    registry: {
      _status: status,
      set(key: string, v: any) {
        if (key === 'status') status.value = v;
      },
      get(key: string) {
        return key === 'status' ? status.value : undefined;
      },
    },
    // OBSERVABLE __GAME__.status mirror for the assertions.
    get __status() {
      return status.value;
    },
  };
}

// ---------------------------------------------------------------------------
// DRIVE 1 — RIDE: player overlaps a MOVING carrier on a ride lane.
//   expect: player.x|y translate by carrier per-frame velocity + player.carried logged.
// ---------------------------------------------------------------------------
{
  const player: any = {
    x: 100,
    y: 200,
    active: true,
    isDead: false,
    displayWidth: 28,
    displayHeight: 28,
    body: makeBody(0, 0),
    takeDamage(_: number) {
      this.isDead = true;
    },
  };
  // A real moving carrier overlapping the player (centers 100,200 vs 105,205 — well
  // inside the AABB + pad). vx=120 px/s, vy=0; delta=1000/60 → dt = 1/60 → dx=2.
  const carrier = makeSprite({ x: 105, y: 205, vx: 120, vy: 0, id: 'log_3' });
  const scene = makeScene({ player, carriers: [carrier], delta: 1000 / 60 });

  const sys = new CarrierRideSystem({}); // no params → any moving entity is a carrier
  sys.reset();
  sys.attach(scene);

  const startX = player.x;
  const startY = player.y;
  const sinceSeq = scene.eventBus.cursor;

  sys.update(); // <-- the REAL verb

  const fired = scene.eventBus
    .recent(sinceSeq)
    .filter((e) => e.type === 'player.carried');

  // (a) the PUSH event fired on the real bus.
  assert.equal(fired.length, 1, 'player.carried must fire exactly once while riding');
  ok('player.carried emitted on the bus while riding');

  // (b) the payload carries the AUTO-DERIVED carrier id + the per-frame delta.
  const payload = fired[0].payload as { carrierId: string; dx: number; dy: number };
  assert.equal(payload.carrierId, 'log_3', 'carrierId auto-derived from carrier.__id');
  assert.equal(payload.dx, 2, 'dx = vx(120) * dt(1/60) = 2');
  assert.equal(payload.dy, 0, 'dy = vy(0) * dt = 0');
  ok('player.carried payload = {carrierId:log_3, dx:2, dy:0}');

  // (c) the OBSERVABLE transition: player.x translated by exactly the velocity delta.
  // COUNTERFACTUAL: if update()/carry() were a no-op, player.x would stay 100 and
  // this assertion (expects 102) FAILS — so the test is meaningful.
  assert.equal(player.x, startX + 2, 'player.x must translate by carrier dx (100→102)');
  assert.equal(player.y, startY, 'player.y unchanged (vy=0)');
  ok('__GAME__.player.x translated by carrier per-frame velocity (100→102)');

  // (d) the arcade body was reset in lockstep (no snap-back next physics step).
  assert.equal(player.body._rx, 102, 'body.reset kept the body on the log (x=102)');
  ok('player body re-synced to the translated position');
}

// ---------------------------------------------------------------------------
// DRIVE 2 — DROWN: NO carrier, player over an OPEN ride surface → status 'lost'.
//   expect: stepping off over open water flips status to lost (the inversion seam).
// ---------------------------------------------------------------------------
{
  const player: any = {
    x: 300,
    y: 400,
    active: true,
    isDead: false,
    displayWidth: 28,
    displayHeight: 28,
    body: makeBody(0, 0),
    takeDamage(_: number) {
      this.isDead = true;
      // The SDK death pipeline ends at scene.onPlayerDeath → status='lost'; here we
      // model that terminal observable directly via the registry the component holds.
      (this as any).__scene?.registry?.set('status', 'lost');
    },
  };
  // The player center (300,400) sits INSIDE this declared ride lane, with NO carrier.
  const rideLanes = [{ x: 250, y: 350, width: 120, height: 120 }];
  const scene = makeScene({ player, carriers: [], rideLanes });
  player.__scene = scene;

  const sys = new CarrierRideSystem({});
  sys.reset();
  sys.attach(scene);

  assert.equal(scene.__status, 'playing', 'precondition: status starts playing');

  sys.update(); // <-- the REAL verb, over open water, no carrier

  // OBSERVABLE: status flipped to 'lost'. COUNTERFACTUAL: a no-op update() leaves
  // status 'playing' and this FAILS — meaningful.
  assert.equal(scene.__status, 'lost', 'open ride surface must drown the player → lost');
  assert.equal(player.isDead, true, 'the death pipeline ran (takeDamage(Infinity))');
  ok('open water (no carrier) flipped __GAME__.status → lost');
}

// ---------------------------------------------------------------------------
// DRIVE 3 — NEGATIVE control: a SAFE position (carrier present, NOT over open water,
//   not swept off-screen) must NOT drown and MUST keep riding. Guards against a
//   component that flips 'lost' indiscriminately (which would falsely pass DRIVE 2).
// ---------------------------------------------------------------------------
{
  const player: any = {
    x: 100,
    y: 200,
    active: true,
    isDead: false,
    displayWidth: 28,
    displayHeight: 28,
    body: makeBody(0, 0),
    takeDamage(_: number) {
      this.isDead = true;
    },
  };
  const carrier = makeSprite({ x: 100, y: 200, vx: 60, vy: 60, id: 'turtle_1' });
  const scene = makeScene({
    player,
    carriers: [carrier],
    rideLanes: [{ x: 0, y: 0, width: 432, height: 768 }], // whole screen is a ride lane
    delta: 1000 / 60,
  });
  const sys = new CarrierRideSystem({});
  sys.reset();
  sys.attach(scene);

  const sinceSeq = scene.eventBus.cursor;
  sys.update(); // riding inside a ride lane — saved, NOT drowned

  assert.equal(scene.__status, 'playing', 'a ridden player on a ride lane is NOT drowned');
  const fired = scene.eventBus.recent(sinceSeq).filter((e) => e.type === 'player.carried');
  assert.equal(fired.length, 1, 'still emits player.carried while riding inside a lane');
  // dx = 60 * (1/60) = 1 ; dy = 60 * (1/60) = 1
  const p = fired[0].payload as { dx: number; dy: number };
  assert.equal(p.dx, 1, 'dx = 1 (vx 60 * dt 1/60)');
  assert.equal(p.dy, 1, 'dy = 1 (vy 60 * dt 1/60)');
  ok('carrier SAVES the player on a ride lane (no false drown); player.carried fires');
}

console.log(`\nCarrierRideSystem drive: ${passed} assertions PASSED`);
