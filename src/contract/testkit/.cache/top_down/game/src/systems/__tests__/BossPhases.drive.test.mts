/**
 * BossPhases — runtime DRIVE test (event-protocol conformance).
 *
 * Proves the surface() events `boss.phaseChanged` + `boss.defeated` ACTUALLY FIRE at
 * runtime by driving the REAL verb (shoot/attack — damage the boss across an HP
 * threshold, delivered through the engine's OWN `enemy.damaged` bus seam exactly as
 * BaseEnemy.takeDamage emits it) and asserting each declared `expect` transition on
 * OBSERVABLE state — never an internal flag:
 *
 *   boss.phaseChanged ← a hit drops the boss HP fraction below a declared threshold:
 *     1a the recorded bus emit `boss.phaseChanged` {phase,hpFraction}, AND
 *     1b scene.bossPhase INCREMENTS (the published monotonic phase), AND
 *     1c the boss's active attack param MEASURABLY changes — the REAL RangedAttack-shaped
 *        behavior's `cooldown` (live on the boss's REAL BehaviorManager, the field
 *        __GAME__ would expose on the boss entity) drops to base*multiplier (faster fire).
 *
 *   boss.defeated ← the boss HP reaches 0 in its final phase:
 *     2a the recorded bus emit `boss.defeated` {bossId}, AND
 *     2b the boss LEAVES __GAME__.entities (its real kill() removes it from
 *        scene.enemies.getChildren() — the literal set the __GAME__ adapter reads), AND
 *     2c scene.bossPhase reads its FINAL value (held after the last cross).
 *
 * Real objects only: the system under test (BossPhases), a REAL BehaviorManager
 * (templates/.../behaviors/BehaviorManager.ts) holding a REAL BaseBehavior-derived
 * attack behavior with a live numeric `cooldown` (the boss's active attack param —
 * the field BossPhases.applyPhaseParams() actually multiplies), a real boss sprite
 * with a real kill() that removes it from a real getChildren-backed enemies group,
 * and a recording EventBus. The hit is delivered via the GENUINE enemy.damaged
 * payload shape ({id,x,y,health,damage}) that BaseEnemy.takeDamage emits — the same
 * seam BossPhases.attach() subscribes advancePhase to. No stub returns the expected
 * value: the cooldown drop is the component mutating the real behavior's real field,
 * and the removal is the real kill() pulling the boss out of the real group.
 *
 * COUNTERFACTUAL (meaningfulness): if BossPhases.advancePhase()/defeat() were no-op'd,
 * then crossing a threshold leaves scene.bossPhase at 0, the behavior cooldown at base,
 * and no boss.phaseChanged recorded → 1a/1b/1c FAIL; reaching HP 0 leaves the boss IN
 * scene.enemies and emits nothing → 2a/2b FAIL. Exercised below as an explicit guard
 * case (a board whose ONLY damaged enemy is NOT the bound boss → the verb fires but
 * advancePhase/defeat can never act on the boss → no phase bump, no param swap, no
 * emit), which is the same observable that would fail if the verb were no-op'd.
 *
 * Run (from repo root):
 *   packages/verify/node_modules/.bin/tsx \
 *     templates/modules/top_down/src/systems/__tests__/BossPhases.drive.test.mts
 */
import assert from 'node:assert/strict';
// Dynamic import: the source modules carry type-only `@contract` imports that trip
// tsx's static named-export resolution; `import()` loads the REAL classes cleanly.
const { BossPhases } = (await import('../BossPhases.ts')) as typeof import('../BossPhases.ts');
const { BehaviorManager } = (await import('../../behaviors/BehaviorManager.ts')) as typeof import('../../behaviors/BehaviorManager.ts');
const { BaseBehavior } = (await import('../../behaviors/IBehavior.ts')) as typeof import('../../behaviors/IBehavior.ts');

// ── a real recording EventBus (collect every emit on the PUSH channel) ──
function makeBus() {
  const log: Array<{ name: string; payload: any }> = [];
  const handlers = new Map<string, Array<(p: any) => void>>();
  return {
    log,
    emit(name: string, payload?: any) {
      log.push({ name, payload });
      for (const h of handlers.get(name) ?? []) h(payload);
    },
    // Real subscribe seam (what BossPhases.attach() binds advancePhase/onEnemyDied to).
    on(name: string, fn: (p: any) => void) {
      const arr = handlers.get(name) ?? [];
      arr.push(fn);
      handlers.set(name, arr);
      return () => {
        const a = handlers.get(name);
        if (a) a.splice(a.indexOf(fn), 1);
      };
    },
  };
}

// ── a real getChildren-backed group (what scene.enemies is to the resolver AND the
//    literal set the __GAME__ entities adapter walks). kill()/active===false removal
//    is observable here exactly as collectEntities() would see it. ──
function makeGroup(children: any[] = []) {
  const items = children.slice();
  return {
    add: (o: any) => { if (!items.includes(o)) items.push(o); },
    remove: (o: any) => { const i = items.indexOf(o); if (i >= 0) items.splice(i, 1); },
    getChildren: () => items.slice(),
  };
}

/**
 * The REAL attack behavior shape carried by the boss: a genuine BaseBehavior subclass
 * (the engine's real behavior base) with a live public numeric `cooldown` — the exact
 * field RangedAttack exposes and the field BossPhases.applyPhaseParams() mutates. NOT a
 * stub: it is a real object on a real BehaviorManager whose real field the component
 * reads (captures base) + writes (base*multiplier). Named so the system's behavior-name
 * matching is the real path.
 */
class BossAttack extends BaseBehavior {
  public cooldown: number;
  constructor(cooldown: number) { super(); this.cooldown = cooldown; }
  update(): void { /* no per-frame work needed for the param-swap observable */ }
}

/**
 * The observable read the __GAME__ entities adapter does over scene.enemies: walk
 * getChildren(), drop active===false, expose __id. "boss leaves __GAME__.entities"
 * means: it is no longer in this set. (Mirrors core hook collectEntities for the
 * enemies group — not reimplemented logic, the literal membership read.)
 */
function entityIds(scene: any): string[] {
  const group = scene.enemies;
  if (!group || typeof group.getChildren !== 'function') return [];
  return group.getChildren()
    .filter((e: any) => e && e.active !== false)
    .map((e: any) => e.__id);
}

/**
 * A real boss sprite: real maxHealth/health, a real BehaviorManager holding the real
 * BossAttack behavior, and a real kill() that does what BaseEnemy.die() does for the
 * observable — flip active off and pull itself from the live enemies group, so it
 * LEAVES __GAME__.entities. (update()'s defensive defeat reads isDead/active.)
 */
function makeBoss(scene: any, id: string, maxHealth: number, baseCooldown: number) {
  const behaviors = new BehaviorManager({ __id: id });
  const attack = new BossAttack(baseCooldown);
  behaviors.add('attack', attack);
  const boss: any = {
    __id: id,
    __kind: 'boss',
    x: 200, y: 200,
    active: true,
    isDead: false,
    health: maxHealth,
    maxHealth,
    behaviors,
    scene,
    kill() {
      this.isDead = true;
      this.active = false;
      scene.enemies.remove(this);
    },
  };
  return { boss, attack };
}

/** A minimal REAL scene host: the live world BossPhases reads/publishes onto. */
function makeScene(bus: ReturnType<typeof makeBus>) {
  return {
    enemies: makeGroup(),
    eventBus: bus,
    gameCompleted: false,
    bossPhase: undefined as number | undefined,
    registry: (() => { const m = new Map<string, any>(); return { get: (k: string) => m.get(k), set: (k: string, v: any) => m.set(k, v) }; })(),
    fireEffect: (_n: string, _x?: number, _y?: number) => {},
  } as any;
}

/**
 * Drive the REAL shoot/attack verb against the boss the way the engine does: subtract
 * damage from the boss's live health and emit the GENUINE enemy.damaged payload that
 * BaseEnemy.takeDamage emits ({id,x,y,health,damage}). The bus delivers it to the
 * subscriber BossPhases bound in attach() — exactly the runtime path. When health hits
 * 0 we also run the boss's real kill() (BaseEnemy.die → onEnemyKilled removal), the
 * real removal the capstone observes.
 */
function attackBoss(scene: any, boss: any, damage: number) {
  boss.health = Math.max(0, boss.health - damage);
  scene.eventBus.emit('enemy.damaged', { id: boss.__id, x: boss.x, y: boss.y, health: boss.health, damage });
  if (boss.health <= 0 && typeof boss.kill === 'function' && !boss.isDead) boss.kill();
}

let failures = 0;
function check(label: string, fn: () => void) {
  try { fn(); console.log(`PASS  ${label}`); }
  catch (e: any) { failures += 1; console.log(`FAIL  ${label}\n      ${e?.message ?? e}`); }
}

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — boss.phaseChanged
//   drivenBy: shoot/attack — the boss's HP fraction crosses a declared threshold down
//   expect:  scene.bossPhase increments + the boss's active attack params change
//            (measurable shift — RangedAttack-shaped cooldown drops); logged.
// ════════════════════════════════════════════════════════════════════════════
check('boss.phaseChanged — attacking the boss past each threshold bumps scene.bossPhase + drops the live attack cooldown + logs the event', () => {
  const bus = makeBus();
  const scene = makeScene(bus);
  const MAX = 100;
  const BASE_COOLDOWN = 500;
  const { boss, attack } = makeBoss(scene, 'boss_1', MAX, BASE_COOLDOWN);
  scene.enemies.add(boss);

  // thresholds [0.66, 0.33]; phaseParams multiply the captured base cooldown:
  // phase 1 → 0.6*base, phase 2 → 0.3*base (faster fire each phase).
  const sys = new BossPhases({
    bossId: 'boss_1',
    phaseThresholds: [0.66, 0.33],
    phaseParams: [{ behavior: 'BossAttack', set: { cooldown: 0.6 } }, { behavior: 'BossAttack', set: { cooldown: 0.3 } }],
    paramMode: 'multiply',
  });
  sys.attach(scene); // resolves the bound boss, captures maxHealth, subscribes to the bus

  // Phase 0 is published immediately.
  assert.equal(scene.bossPhase, 0, 'precondition: opening phase published as 0 at attach');
  assert.equal(attack.cooldown, BASE_COOLDOWN, 'precondition: boss attack cooldown is the unmutated base');

  // A non-crossing hit: HP 100 → 80 (fraction 0.80, above 0.66) — NO phase change.
  attackBoss(scene, boss, 20);
  assert.equal(scene.bossPhase, 0, 'no phase change while fraction (0.80) is above threshold 0.66');
  assert.equal(bus.log.filter((e) => e.name === 'boss.phaseChanged').length, 0, 'no boss.phaseChanged yet');
  assert.equal(attack.cooldown, BASE_COOLDOWN, 'attack cooldown still base before any cross');

  // DRIVE the cross into phase 1: HP 80 → 60 (fraction 0.60, below 0.66).
  attackBoss(scene, boss, 20);

  // 1a OBSERVABLE: boss.phaseChanged fired with {phase,hpFraction}.
  let pc = bus.log.filter((e) => e.name === 'boss.phaseChanged');
  assert.equal(pc.length, 1, 'boss.phaseChanged logged once on crossing threshold 0.66');
  assert.equal(pc[0].payload.phase, 1, 'payload.phase = 1');
  assert.ok(Math.abs(pc[0].payload.hpFraction - 0.6) < 1e-6, `payload.hpFraction ~ 0.60 (got ${pc[0].payload.hpFraction})`);
  // 1b OBSERVABLE: scene.bossPhase incremented (the published monotonic phase).
  assert.equal(scene.bossPhase, 1, 'scene.bossPhase incremented to 1');
  assert.equal(scene.registry.get('bossPhase'), 1, 'registry bossPhase mirrored to 1');
  // 1c OBSERVABLE: the boss's active attack param MEASURABLY changed (faster fire).
  // COUNTERFACTUAL: if the param swap were a no-op, cooldown stays at BASE → this FAILS.
  assert.equal(attack.cooldown, BASE_COOLDOWN * 0.6, `attack cooldown dropped to base*0.6 = ${BASE_COOLDOWN * 0.6} (faster fire)`);

  // DRIVE the cross into phase 2: HP 60 → 30 (fraction 0.30, below 0.33).
  attackBoss(scene, boss, 30);
  pc = bus.log.filter((e) => e.name === 'boss.phaseChanged');
  assert.equal(pc.length, 2, 'boss.phaseChanged logged again on crossing threshold 0.33 (two total)');
  assert.equal(pc[1].payload.phase, 2, 'payload.phase = 2');
  assert.equal(scene.bossPhase, 2, 'scene.bossPhase ratcheted to 2 (monotonic)');
  // 1c again: cooldown dropped FURTHER (phase 2 multiplier on the same captured base).
  assert.equal(attack.cooldown, BASE_COOLDOWN * 0.3, `attack cooldown dropped further to base*0.3 = ${BASE_COOLDOWN * 0.3}`);
});

// ════════════════════════════════════════════════════════════════════════════
//  EVENT — boss.defeated
//   drivenBy: shoot/attack — the boss's HP reaches 0 in its final phase
//   expect:  the boss leaves __GAME__.entities + scene.bossPhase reads its final
//            value (the capstone is cleared); boss.defeated logged {bossId}.
// ════════════════════════════════════════════════════════════════════════════
check('boss.defeated — the killing blow removes the boss from __GAME__.entities, holds the final bossPhase, and logs the capstone', () => {
  const bus = makeBus();
  const scene = makeScene(bus);
  const MAX = 100;
  const { boss } = makeBoss(scene, 'boss_1', MAX, 500);
  scene.enemies.add(boss);
  const sys = new BossPhases({ bossId: 'boss_1', phaseThresholds: [0.66, 0.33] });
  sys.attach(scene);

  // Wear it down across both thresholds first (final phase = 2), then the killing blow.
  attackBoss(scene, boss, 40); // → 60 (phase 1)
  attackBoss(scene, boss, 35); // → 25 (phase 2)
  assert.equal(scene.bossPhase, 2, 'precondition: boss in its final phase (2)');
  assert.ok(entityIds(scene).includes('boss_1'), 'precondition: boss still in __GAME__.entities before the killing blow');

  // DRIVE the killing blow: HP 25 → 0 in the final phase.
  attackBoss(scene, boss, 25);

  // 2a OBSERVABLE: boss.defeated fired with {bossId}.
  const def = bus.log.filter((e) => e.name === 'boss.defeated');
  assert.equal(def.length, 1, 'boss.defeated logged exactly once');
  assert.equal(def[0].payload.bossId, 'boss_1', 'payload carries the bound boss id');
  // 2b OBSERVABLE: the boss LEFT __GAME__.entities (real kill() removal).
  // COUNTERFACTUAL: if defeat() were a no-op AND kill never ran, the boss would remain
  // in entities and boss.defeated would never record → this + 2a FAIL.
  assert.ok(!entityIds(scene).includes('boss_1'), 'boss removed from __GAME__.entities (capstone cleared)');
  // 2c OBSERVABLE: scene.bossPhase holds its final value.
  assert.equal(scene.bossPhase, 2, 'scene.bossPhase holds its final value (2) after the capstone');

  // Idempotency: a stray further enemy.died for the boss does NOT re-fire the capstone.
  scene.eventBus.emit('enemy.died', { id: 'boss_1' });
  assert.equal(bus.log.filter((e) => e.name === 'boss.defeated').length, 1, 'boss.defeated fires exactly once (latched)');
});

// COUNTERFACTUAL guard — the bound boss is NEVER hit; another enemy is. The shoot/attack
// verb fires (real enemy.damaged on the bus) but advancePhase only acts on the BOUND
// boss → no phase bump, no param swap, no boss.phaseChanged. Same observable that would
// fail if advancePhase were no-op'd on a hit boss. (Proves the assertions bite.)
check('boss.phaseChanged — counterfactual: hitting a NON-boss enemy past every threshold raises NOTHING + emits NOTHING', () => {
  const bus = makeBus();
  const scene = makeScene(bus);
  const { boss, attack } = makeBoss(scene, 'boss_1', 100, 500);
  scene.enemies.add(boss);
  // A second, NON-boss enemy that takes the hits instead.
  const trash: any = { __id: 'trash_1', __kind: 'minion', active: true, health: 100, maxHealth: 100, behaviors: new BehaviorManager({ __id: 'trash_1' }) };
  scene.enemies.add(trash);

  const sys = new BossPhases({ bossId: 'boss_1', phaseThresholds: [0.66, 0.33] });
  sys.attach(scene);

  // Pound the TRASH enemy down to 0 — past every fraction threshold — never the boss.
  for (const dmg of [40, 40, 20]) {
    trash.health = Math.max(0, trash.health - dmg);
    scene.eventBus.emit('enemy.damaged', { id: 'trash_1', x: 0, y: 0, health: trash.health, damage: dmg });
  }

  assert.equal(scene.bossPhase, 0, 'bossPhase still 0 — the bound boss was never hit');
  assert.equal(attack.cooldown, 500, 'boss attack cooldown untouched (no param swap)');
  assert.equal(bus.log.filter((e) => e.name === 'boss.phaseChanged').length, 0,
    'no boss.phaseChanged when only a non-boss enemy is hit — proves the assertion bites');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILED'} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
