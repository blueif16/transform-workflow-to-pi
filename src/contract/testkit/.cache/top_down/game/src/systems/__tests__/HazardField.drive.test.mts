/**
 * HazardField — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the two surface() events actually FIRE at runtime by driving the REAL
 * verb on the REAL HazardField class and asserting each declared `expect`
 * transition on the OBSERVABLE state — the same state the engine's __GAME__
 * adapter reads:
 *   - __GAME__.entities      ← collectEntities() over the scene's `hazards` group
 *                              (templates/core/src/hook.ts lines 120-153: walk
 *                              getChildren(), drop active===false, read __type/__id).
 *                              Every materialized region is a tagged static sprite
 *                              in scene.hazards, so it reads as type 'hazard'.
 *   - __GAME__.player.health ← the player's own health field (BaseGameScene seam);
 *                              the SUT hurts the player through player.takeDamage,
 *                              so a strike drops player.health.
 *   - the PUSH event log     ← the EventBus the SUT emits on (hazard.struck /
 *                              hazard.toggled), the same bus __GAME__.events.recent taps.
 *
 * The verbs are driven through the system's OWN wiring, never a back-door:
 *   - MOVE (walk onto an active hazard tile-region) — invoke the REAL physics
 *                              overlap callback the SUT registers in setupCollisions()
 *                              (via utils.addOverlap → scene.physics.add.overlap),
 *                              passing the live hazard sprite the engine hands it on a
 *                              player↔hazard overlap. NOT a direct strike() call.
 *   - TOGGLE (the on/off cycle advances) — tick the SUT's own per-frame update()
 *                              with the scene clock until a sweeping region's
 *                              elapsed >= cycleMs, so the SUT's cycle math flips it.
 *                              NOT a direct toggle() call.
 *
 * Real objects: the system under test, a real getChildren-backed `hazards` group
 * (built by the real attach() through a Phaser-shaped staticGroup/staticSprite),
 * the recording EventBus, and a REAL player carrying a real takeDamage seam mirrored
 * from BaseGameScene contact-damage (drop health by `damage`, set i-frames, kill on
 * lethal). The scene is the harness boundary — a minimal Phaser-shaped host; it owns
 * NO logic under test: every materialize/active/strike/toggle/emit decision is the
 * component's own code.
 *
 * COUNTERFACTUAL (meaningfulness):
 *   - hazard.struck: if onPlayerOverlap()/strike() is no-op'd, walking onto an active
 *     region leaves player.health untouched and logs nothing → 1a/1b/1c fail. Also
 *     exercised by the SAFE-window case: the SAME overlap onto an INACTIVE region (a
 *     toggled-off sweeping cell) must NOT hurt and must NOT log — proving the strike
 *     is gated on the region being active, not on the overlap alone.
 *   - hazard.toggled: if update()'s cycle math is no-op'd (or toggle() is no-op'd),
 *     ticking past cycleMs never flips `active`, an inactive region keeps striking,
 *     and no 'hazard.toggled' is recorded → 2a/2b/2c fail.
 */
import assert from 'node:assert/strict';
// Dynamic import: the source carries a type-only `@contract` import that trips
// tsx's static named-export resolution; import() loads the REAL class cleanly.
const { HazardField } = (await import('../HazardField.ts')) as typeof import('../HazardField.ts');

// ── observable adapter — the literal read __GAME__.entities does over `hazards` ──
// Mirrors templates/core/src/hook.ts collectEntities() for the `hazards` group:
// walk getChildren(), drop active===false, read __type/__id. NOT reimplemented
// logic — the literal read the real oracle does.
function entitiesOf(scene: any): Array<{ type: string; id: string; x: number; y: number }> {
  const group = scene.hazards;
  const out: any[] = [];
  if (!group || typeof group.getChildren !== 'function') return out;
  for (const child of group.getChildren()) {
    if (!child || child.active === false) continue; // hook drops active===false
    out.push({
      type: child.__type ?? 'obstacle',
      id: child.__id ?? 'obstacle',
      x: child.x ?? 0,
      y: child.y ?? 0,
    });
  }
  return out;
}

// __GAME__.player.health — the player's own health field the hurt seam drops.
function playerHealthOf(scene: any): number {
  return (scene.player?.health as number) ?? 0;
}

// ── a real getChildren-backed Phaser static group (what scene.hazards is) ──
function makeStaticGroup() {
  const items: any[] = [];
  return {
    add: (o: any) => { if (!items.includes(o)) items.push(o); },
    getChildren: () => items.slice(),
    clear: () => { items.length = 0; },
  };
}

// ── a real recording EventBus (collect every emit on the PUSH channel) ──
function makeBus() {
  const log: Array<{ name: string; payload: any }> = [];
  return { log, emit: (name: string, payload?: any) => { log.push({ name, payload }); } };
}

/**
 * A REAL player carrying the takeDamage seam mirrored from BaseGameScene
 * contact-damage: drop health by `damage`, raise i-frames, and on a lethal hit set
 * isDead + run kill(). This is the player's OWN code path the SUT calls — the test
 * owns NO strike/health decision (the SUT decides whether/when to call takeDamage).
 */
function makePlayer(x: number, y: number, health = 100) {
  return {
    x, y, active: true,
    health,
    isInvulnerable: false,
    isHurting: false,
    isDead: false,
    takeDamage(amount: number) {
      if (this.isInvulnerable || this.isDead) return;
      this.health -= amount;
      this.isInvulnerable = true; // i-frames (the SUT relies on these to tick, not annihilate)
      if (this.health <= 0) { this.health = 0; this.isDead = true; }
    },
  };
}

/**
 * A minimal Phaser-shaped scene host: physics.add.staticGroup()/staticSprite() build
 * the REAL hazard sprites the SUT materializes; physics.add.overlap RECORDS its
 * (a, b, cb) so the test can drive the REAL move callback the SUT registers; a real
 * game.loop.delta is the cycle clock update() reads. No logic under test lives here.
 */
function makeScene(player: any, bus: ReturnType<typeof makeBus>, delta = 16) {
  const overlaps: Array<{ a: any; b: any; cb: (p: any, o: any) => void }> = [];
  const scene: any = {
    __overlaps: overlaps,
    player,
    eventBus: bus,
    gameCompleted: false,
    game: { loop: { delta } },
    textures: { exists: (_k: string) => false, generate: (_k: string, _c: any) => {} },
    physics: {
      add: {
        staticGroup: () => makeStaticGroup(),
        // A static sprite the SUT tags + sizes; carries the standard seam the SUT
        // touches (setDisplaySize/setTexture/setTint/setAlpha/refreshBody + a body).
        staticSprite: (cx: number, cy: number, _tex: string) => ({
          x: cx, y: cy, active: true,
          body: { enable: true },
          setDisplaySize() { return this; },
          setTexture() { return this; },
          setTint() { return this; },
          setAlpha() { return this; },
          refreshBody() { return this; },
          destroy() { this.active = false; },
        }),
        overlap: (a: any, b: any, cb: (p: any, o: any) => void) => { overlaps.push({ a, b, cb }); },
      },
    },
  };
  return scene;
}

// Drive a player↔hazard overlap through the REAL callback the SUT registered (the
// move seam). addOverlap(player, group, cb) takes the NON-swap branch, so the SUT's
// callback receives (player, hazardSprite) — exactly what the engine hands it.
function driveOverlap(scene: any, sprite: any) {
  for (const o of scene.__overlaps) o.cb(scene.player, sprite);
}

// The live hazard sprite for a region id in the materialized hazards group.
function spriteById(scene: any, id: string): any {
  return scene.hazards.getChildren().find((s: any) => s.__id === id);
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT 1 — hazard.struck (drivenBy: move — the player walks onto an active
//  hazard tile-region)
//  expect: the player takes the hazard's damage (__GAME__.player.health drops, or
//          the death/respawn seam fires on a lethal hazard) at the frame of overlap;
//          hazard.struck logged.
// ════════════════════════════════════════════════════════════════════════════
check('hazard.struck — walking onto an ACTIVE region drops __GAME__.player.health and logs the event', () => {
  const player = makePlayer(50, 50, 100);
  const bus = makeBus();
  const scene = makeScene(player, bus);
  // one STATIC danger cell (no cycleMs → permanently active), damage 30.
  const sys = new HazardField({ hazards: [{ x: 40, y: 40, width: 32, height: 32, damage: 30 }] });
  sys.attach(scene);
  sys.setupCollisions(); // wires the REAL player↔hazards overlap callback

  // precondition: the region reads as a 'hazard' in __GAME__.entities; health full.
  const hz = entitiesOf(scene).filter((e) => e.type === 'hazard');
  assert.equal(hz.length, 1, 'the active hazard region is present in __GAME__.entities (type hazard)');
  assert.equal(hz[0].id, 'hazard_0', 'the region id auto-derives from its manifest index');
  assert.equal(playerHealthOf(scene), 100, 'player.health is full before the strike');

  // DRIVE the move verb through the REAL overlap callback (what the engine invokes
  // on a player↔hazard overlap), handing it the live hazard sprite.
  const sprite = spriteById(scene, 'hazard_0');
  driveOverlap(scene, sprite);

  // 1a OBSERVABLE: __GAME__.player.health dropped by the region's damage.
  assert.equal(playerHealthOf(scene), 70, 'player.health dropped by the hazard damage on overlap');

  // 1b OBSERVABLE: the strike fired the death/hurt seam (i-frames raised by takeDamage).
  assert.equal(player.isInvulnerable, true, 'the takeDamage seam ran (i-frames raised)');

  // 1c OBSERVABLE: hazard.struck logged once with {hazardId,damage}.
  const struck = bus.log.filter((e) => e.name === 'hazard.struck');
  assert.equal(struck.length, 1, 'hazard.struck logged exactly once');
  assert.equal(struck[0].payload.hazardId, 'hazard_0', 'hazard.struck carries the region id');
  assert.equal(struck[0].payload.damage, 30, 'hazard.struck carries the region damage');
});

// EVENT 1 (lethal form — the death-seam clause of `expect`): a hazard whose damage
// exceeds the player's health kills the player (health → 0, isDead) on overlap.
check('hazard.struck — a LETHAL hazard runs the death seam (health → 0, isDead) on overlap', () => {
  const player = makePlayer(50, 50, 20);
  const bus = makeBus();
  const scene = makeScene(player, bus);
  const sys = new HazardField({ hazards: [{ x: 40, y: 40, width: 32, height: 32, damage: 999 }] });
  sys.attach(scene);
  sys.setupCollisions();

  driveOverlap(scene, spriteById(scene, 'hazard_0'));

  assert.equal(playerHealthOf(scene), 0, 'a lethal hazard drops health to 0');
  assert.equal(player.isDead, true, 'a lethal hazard fires the death seam (isDead)');
  assert.equal(bus.log.filter((e) => e.name === 'hazard.struck').length, 1, 'hazard.struck logged on the lethal hit');
});

// COUNTERFACTUAL for event 1: the SAME overlap onto an INACTIVE region must NOT hurt
// and must NOT log — proving the strike is gated on the region being active (the same
// observable a no-op'd strike() would show). Drives strike's `!hz.active` guard.
check('hazard.struck — counterfactual: overlapping an INACTIVE (safe-window) region does NOT hurt, no event', () => {
  const player = makePlayer(50, 50, 100);
  const bus = makeBus();
  const scene = makeScene(player, bus);
  // a sweeping region that STARTS inactive (startActive:false) — the safe window.
  const sys = new HazardField({ hazards: [{ x: 40, y: 40, width: 32, height: 32, cycleMs: 1000, damage: 30 }], startActive: false });
  sys.attach(scene);
  sys.setupCollisions();

  driveOverlap(scene, spriteById(scene, 'hazard_0')); // overlap an inactive region

  assert.equal(playerHealthOf(scene), 100, 'player.health is untouched while the region is in its safe window');
  assert.equal(bus.log.filter((e) => e.name === 'hazard.struck').length, 0, 'no hazard.struck when the region is inactive');
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT 2 — hazard.toggled (drivenBy: the hazard's on/off cycle advances — a
//  sweeping region activates or deactivates)
//  expect: the region's active state flips (an active region becomes safe or vice-
//          versa, changing whether a player standing in it is struck); hazard.toggled
//          logged.
// ════════════════════════════════════════════════════════════════════════════
check('hazard.toggled — the cycle clock crossing cycleMs flips the region active→safe (it stops striking) + logs the event', () => {
  const player = makePlayer(50, 50, 100);
  const bus = makeBus();
  // delta 16ms; cycleMs 100ms → ~7 ticks to cross one half-period.
  const scene = makeScene(player, bus, 16);
  const sys = new HazardField({ hazards: [{ x: 40, y: 40, width: 32, height: 32, cycleMs: 100, damage: 30 }], startActive: true });
  sys.attach(scene);
  sys.setupCollisions();
  const sprite = spriteById(scene, 'hazard_0');

  // precondition: the region starts ACTIVE — overlapping it strikes (health drops).
  driveOverlap(scene, sprite);
  assert.equal(playerHealthOf(scene), 70, 'precondition: the ACTIVE region strikes on overlap');
  player.isInvulnerable = false; // clear i-frames so a later overlap could strike again

  // DRIVE the toggle verb: tick the SUT's OWN per-frame update() until the cycle
  // clock crosses cycleMs (NOT a direct toggle() call). 7 ticks * 16ms = 112 >= 100.
  for (let i = 0; i < 7; i++) sys.update();

  // 2a OBSERVABLE: hazard.toggled logged once with {hazardId,active:false}.
  const toggled = bus.log.filter((e) => e.name === 'hazard.toggled');
  assert.equal(toggled.length, 1, 'hazard.toggled logged exactly once when the cycle crossed cycleMs');
  assert.equal(toggled[0].payload.hazardId, 'hazard_0', 'hazard.toggled carries the region id');
  assert.equal(toggled[0].payload.active, false, 'the region flipped active→safe');

  // 2b OBSERVABLE: the flip CHANGED whether a player in it is struck — the SAME
  // overlap that struck before now does NOT (health unchanged, no second strike).
  const healthBefore = playerHealthOf(scene);
  driveOverlap(scene, sprite);
  assert.equal(playerHealthOf(scene), healthBefore, 'the now-safe region no longer strikes the same overlap');
  assert.equal(bus.log.filter((e) => e.name === 'hazard.struck').length, 1, 'no second strike after the region toggled to safe');
});

// EVENT 2 (the OTHER direction — safe→active, the deadly window OPENS): a region that
// starts inactive flips ACTIVE on the cycle, after which the same overlap DOES strike.
check('hazard.toggled — the cycle flips a region safe→active (the deadly window opens, it begins striking) + logs', () => {
  const player = makePlayer(50, 50, 100);
  const bus = makeBus();
  const scene = makeScene(player, bus, 16);
  const sys = new HazardField({ hazards: [{ x: 40, y: 40, width: 32, height: 32, cycleMs: 100, damage: 30 }], startActive: false });
  sys.attach(scene);
  sys.setupCollisions();
  const sprite = spriteById(scene, 'hazard_0');

  // precondition: starts SAFE — overlapping it does nothing.
  driveOverlap(scene, sprite);
  assert.equal(playerHealthOf(scene), 100, 'precondition: the inactive region does not strike');

  for (let i = 0; i < 7; i++) sys.update(); // cross cycleMs → flip safe→active

  const toggled = bus.log.filter((e) => e.name === 'hazard.toggled');
  assert.equal(toggled.length, 1, 'hazard.toggled logged once on the safe→active flip');
  assert.equal(toggled[0].payload.active, true, 'the region flipped safe→active (deadly window opened)');

  // the now-active region DOES strike the same overlap.
  driveOverlap(scene, sprite);
  assert.equal(playerHealthOf(scene), 70, 'the now-active region strikes the overlap (health drops)');
  assert.equal(bus.log.filter((e) => e.name === 'hazard.struck').length, 1, 'hazard.struck fired once the window opened');
});

// COUNTERFACTUAL for event 2: a STATIC region (no cycleMs) NEVER toggles — ticking
// update() many times leaves it active + logs nothing (the same observable a no-op'd
// cycle would show). Drives update()'s `cycleMs <= 0` continue guard.
check('hazard.toggled — counterfactual: a STATIC region never toggles however long update() runs (no event)', () => {
  const player = makePlayer(50, 50, 100);
  const bus = makeBus();
  const scene = makeScene(player, bus, 16);
  const sys = new HazardField({ hazards: [{ x: 40, y: 40, width: 32, height: 32, damage: 30 }] }); // no cycleMs → static
  sys.attach(scene);
  sys.setupCollisions();

  for (let i = 0; i < 100; i++) sys.update();

  assert.equal(bus.log.filter((e) => e.name === 'hazard.toggled').length, 0, 'a static region never fires hazard.toggled');
  // still active: it still strikes.
  driveOverlap(scene, spriteById(scene, 'hazard_0'));
  assert.equal(playerHealthOf(scene), 70, 'the static region is still active and strikes');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
