/**
 * BeatGate — ORACLE drive test (event-protocol conformance, endless_runner).
 * ============================================================================
 *
 * Mirrors the Phase-3 exemplar (paddle_ball ScoreCombo.oracle.test.mjs): boots the REAL
 * endless_runner engine via bootHeadlessGame({archetype}) and mounts the system through the
 * ENGINE'S OWN resolver (world.mountSystem) — the test never imports the component.
 *
 * surface() contract under test (templates/modules/endless_runner/src/systems/BeatGate.ts):
 *   - beat.hit  drivenBy "a tap landing inside a beat gate window on the seeded track"
 *               expect   "__GAME__ accuracy/score reflects the timing grade — a tap near a beat
 *                         grades perfect/good (scene.beatAccuracy + __GAME__.score advance by the
 *                         grade's points), a tap outside the window grades miss (no score change);
 *                         beat.hit logged"
 *   - observable beatAccuracy ← the last timing grade
 *
 * REAL drive through the REAL seam: BeatGate paces the run on a SEEDED beat track (a
 * beatPeriodFrames cadence) and grades each tap by its frame-distance to the nearest beat. The
 * tap is a public verb (tap(), the SAME the DOM input drives) and the beat clock advances one per
 * update(). We clear the level's DEFAULT systems, mount the gate, STEP the engine to a frame ON a
 * beat (a multiple of the period → distance 0 → PERFECT), call the real tap() and step one frame —
 * the OBSERVABLE transition is scene.beatAccuracy → 'perfect', the beatAccuracy observable, and
 * __GAME__.score += perfectScore, with beat.hit logged. A MISS COUNTERFACTUAL taps far from any
 * beat (distance > the window) → grade 'miss', no score change, beat.hit{grade:miss}.
 *
 *   node templates/modules/endless_runner/src/systems/__tests__/BeatGate.oracle.test.mjs
 */
import assert from 'node:assert/strict';
import { bootHeadlessGame } from '../../../../../core-contract/src/testkit/bootHeadlessGame.mjs';

let passed = 0;
const check = (label, cond, detail = '') => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
};

const PERIOD = 10;

// ════════════════════════════════════════════════════════════════════════════
// DRIVE: a tap ON a beat grades PERFECT → accuracy + score advance; a tap off-beat MISSES.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];

  const sys = world.mountSystem('BeatGate', { beatPeriodFrames: PERIOD, beatWindowFrames: 3, perfectWindowFrames: 1, perfectScore: 3, goodScore: 1 });
  // The bundler may rename the class (e.g. _BeatGate to avoid a collision); match the suffix.
  check('resolveSystem returned a real BeatGate', sys.constructor.name.endsWith('BeatGate'), sys.constructor.name);
  check('precondition: beatAccuracy observable starts none', sys.surface().observables.beatAccuracy() === 'none', `acc=${sys.surface().observables.beatAccuracy()}`);

  // The system's frame increments each update(). Step (PERIOD-1) → next update lands frame==PERIOD
  // (phase 0 → distance 0 → PERFECT). Queue the tap, then step the landing frame.
  world.step(PERIOD - 1);
  const scoreBefore = Number(scene.registry.get('score') ?? 0);
  let cur = bus.cursor;
  sys.tap();
  world.step(1); // frame -> PERIOD: phase 0, perfect window
  let hits = bus.recent(cur).filter((e) => e.type === 'beat.hit');
  check('PERFECT: beat.hit logged on the real bus', hits.length === 1, `count=${hits.length}`);
  check("PERFECT: beat.hit graded 'perfect' (dead-on the beat)", hits.at(-1)?.payload?.grade === 'perfect', JSON.stringify(hits.at(-1)?.payload));
  check("PERFECT: scene.beatAccuracy / the observable reflect 'perfect'", scene.beatAccuracy === 'perfect' && sys.surface().observables.beatAccuracy() === 'perfect', `acc=${scene.beatAccuracy}`);
  check('PERFECT: __GAME__.score advanced by perfectScore (+3)', Number(scene.registry.get('score')) === scoreBefore + 3, `${scoreBefore}→${scene.registry.get('score')}`);

  world.destroy();
}

// ════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL (meaningfulness proof): a tap landing OUTSIDE the window (distance >
// beatWindowFrames from any beat) grades MISS — no score change — yet beat.hit still
// logs the miss grade. If judgeTap() scored every tap regardless of timing the PERFECT
// score-advance would be vacuous; this proves the grade + score are gated on real timing.
// ════════════════════════════════════════════════════════════════════════════
{
  const world = await bootHeadlessGame({ archetype: 'endless_runner' });
  const { scene, bus } = world;
  scene.systems = [];
  const sys = world.mountSystem('BeatGate', { beatPeriodFrames: PERIOD, beatWindowFrames: 3, perfectWindowFrames: 1, perfectScore: 3, goodScore: 1 });

  // Land a tap mid-period (phase ~5, distance 5 > window 3 → MISS). Step to frame PERIOD+5.
  world.step(PERIOD + 4); // next update lands frame == PERIOD+5 → phase 5
  const scoreBefore = Number(scene.registry.get('score') ?? 0);
  const cur = bus.cursor;
  sys.tap();
  world.step(1);
  const hits = bus.recent(cur).filter((e) => e.type === 'beat.hit');
  check('counterfactual: an off-beat tap still logs beat.hit (graded)', hits.length === 1, `count=${hits.length}`);
  check("counterfactual: the off-beat tap graded 'miss'", hits.at(-1)?.payload?.grade === 'miss', JSON.stringify(hits.at(-1)?.payload));
  check('counterfactual: a miss does NOT change __GAME__.score', Number(scene.registry.get('score')) === scoreBefore, `score=${scene.registry.get('score')}`);

  world.destroy();
}

console.log(`\n[oracle] BeatGate ok — ${passed} assertions: beat.hit (a tap dead-on a seeded beat grades 'perfect' → scene.beatAccuracy + __GAME__.score +3); counterfactual (an off-beat tap grades 'miss' → no score change) holds.`);
process.exit(0);
