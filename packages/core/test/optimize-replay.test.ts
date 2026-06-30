// Contract for optimize/replay.ts — the held-out replay+scoring harness (piflow-memory-v1.5 §5.1, §6). This
// is the KEYSTONE that turns the driver's injected baseScore/replayScore/prepareCandidate from stubs into
// REAL measurements off a product oracle. makeReplayStages is PRODUCT-AGNOSTIC: it folds whatever verify
// report the injected oracle emits (here: real captured game-omni verify-milestone reports) via the SAME
// readVerifyReport the §7 score pass uses, and it enforces the two load-bearing invariants:
//   • ABSTAIN propagates as null, NEVER 0 — "abstain ≠ low score" (v1.5 §7); the gate then routes to human.
//   • VAL-hygiene — the across-run gate scores ONLY a held-out 'val' task; a 'train' task throws (fail-closed),
//     so a train task can never leak into the gate (v1.5 §6 consolidate.py:54-58).
// baseScore reads the incumbent's RECORDED report from the trace (measured once, during the run); replayScore
// runs the oracle FRESH on the candidate copy. The end-to-end test dogfoods the gs01 worked example: a real
// broken incumbent (M2, scalar 0) vs a real passing six-gate build (scalar 1.0) flows through the whole
// overlord and the strict-improvement gate ACCEPTS it.
//
// Run: npx vitest run packages/core/test/optimize-replay.test.ts

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeReplayStages,
  type CheckableTask,
  type ReplayOracle,
  type MineTask,
  type CopyScope,
} from '../src/optimize/replay.js';
import { runFixGate, type Fixer } from '../src/optimize/driver.js';
import type { Defect } from '../src/optimize/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (...p: string[]): unknown => JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'optimize', ...p), 'utf8'));

// Real captured reports (schema-current per the 2026-06-30 verification; verify schema last moved 2026-06-10).
const brokenM2 = load('gs01', 'verify', 'report.M2.json'); // degraded/exhausted, no gate blocks → marker fallback 0, NOT abstained
const passingM1 = load('run01', 'verify', 'report.M1.json'); // full six-gate VALIDATION_PASSED → scalar 1.0
const bootFailed = load('abstain', 'report.boot-failed.json'); // fixOutcome 'boot_failed' → ABSTAIN (the measure never ran)

// ── tiny injectable doubles (real impls would read a trace / boot a browser) ───────────────────────────────
const mineReturning = (t: CheckableTask | null): MineTask => () => t;
const copyScope: CopyScope = async (node) => `cand:${node}`; // a COPY ref, never the live path

/** An oracle that returns a fixed report and RECORDS the build dir it was asked to verify (candidate-copy proof). */
function oracleReturning(report: unknown): { oracle: ReplayOracle; calls: string[] } {
  const calls: string[] = [];
  const oracle: ReplayOracle = async (_task, candidateBuildDir) => {
    calls.push(candidateBuildDir);
    return report;
  };
  return { oracle, calls };
}

const valTask = (over: Partial<CheckableTask> = {}): CheckableTask => ({
  id: 'gs01:M2',
  node: 'w4-execute',
  split: 'val',
  baseReport: brokenM2,
  oracleInput: { milestoneId: 'M2' },
  ...over,
});

describe('makeReplayStages — the held-out replay+scoring harness', () => {
  it('baseScore folds the incumbent report RECORDED in the trace (real broken M2 → 0)', () => {
    const { baseScore } = makeReplayStages({ oracle: oracleReturning(passingM1).oracle, mineTask: mineReturning(valTask()), copyScope });
    expect(baseScore('w4-execute')).toBe(0); // exhausted/degraded → marker fallback, a real measured fail
  });

  it('baseScore folds a real passing six-gate report to 1.0 (the fold counts the gate checks)', () => {
    const { baseScore } = makeReplayStages({ oracle: oracleReturning(brokenM2).oracle, mineTask: mineReturning(valTask({ baseReport: passingM1 })), copyScope });
    expect(baseScore('w4-execute')).toBe(1);
  });

  it('replayScore runs the oracle on the CANDIDATE copy and folds the FRESH report (passing → 1.0)', async () => {
    const { oracle, calls } = oracleReturning(passingM1);
    const { prepareCandidate, replayScore } = makeReplayStages({ oracle, mineTask: mineReturning(valTask()), copyScope });
    const ref = await prepareCandidate({ node: 'w4-execute', bucket: 'FUNCTIONALITY', symptom: 'x', evidence: [], confidence: 'high' });
    const s = await replayScore('w4-execute', ref);
    expect(s).toBe(1); // folded the candidate's report, not the base
    expect(calls).toEqual(['cand:w4-execute']); // the oracle measured the CANDIDATE copy, never the live build
  });

  it('ABSTAIN propagates as null, NEVER 0 (base AND replay) — abstain ≠ low score', async () => {
    const { oracle } = oracleReturning(bootFailed);
    const { baseScore, replayScore } = makeReplayStages({ oracle, mineTask: mineReturning(valTask({ baseReport: bootFailed })), copyScope });
    expect(baseScore('w4-execute')).toBeNull(); // the incumbent never booted → unmeasurable, not a 0
    expect(await replayScore('w4-execute', 'cand:w4-execute')).toBeNull(); // candidate never booted → unmeasurable
  });

  it('VAL-hygiene: a non-val (train) task is REFUSED — base AND replay throw (fail-closed, never gate-leaks)', async () => {
    const { baseScore, replayScore } = makeReplayStages({ oracle: oracleReturning(passingM1).oracle, mineTask: mineReturning(valTask({ split: 'train' })), copyScope });
    expect(() => baseScore('w4-execute')).toThrow(/val/i);
    await expect(replayScore('w4-execute', 'cand:w4-execute')).rejects.toThrow(/val/i);
  });

  it('a node with no replayable task scores null (nothing to measure) — base AND replay', async () => {
    const { baseScore, replayScore } = makeReplayStages({ oracle: oracleReturning(passingM1).oracle, mineTask: mineReturning(null), copyScope });
    expect(baseScore('w4-execute')).toBeNull();
    expect(await replayScore('w4-execute', 'cand:w4-execute')).toBeNull();
  });

  it('prepareCandidate copies off the defect node and returns a non-live ref', async () => {
    const { prepareCandidate } = makeReplayStages({ oracle: oracleReturning(passingM1).oracle, mineTask: mineReturning(valTask()), copyScope });
    const ref = await prepareCandidate({ node: 'w4-execute', bucket: 'FUNCTIONALITY', symptom: 'x', evidence: [], confidence: 'high' });
    expect(ref).toBe('cand:w4-execute');
    expect(ref).not.toBe('live');
  });
});

describe('the keystone end-to-end — real broken→passing pair through the whole overlord (dogfood gs01)', () => {
  const defect: Defect = { node: 'w4-execute', bucket: 'FUNCTIONALITY', symptom: 'maxScore===0 → M2-A3 bounded-score fails', evidence: ['M2-A3'], confidence: 'high' };
  const okFixer: Fixer = async () => ({ editsApplied: 1, candidatePassedProductChecks: true, tokensSpent: 5 });

  const stages = () => {
    const { baseScore, replayScore, prepareCandidate } = makeReplayStages({
      oracle: oracleReturning(passingM1).oracle, // the "fixed" candidate verifies clean
      mineTask: mineReturning(valTask()), // base = the real broken M2 (scalar 0)
      copyScope,
    });
    return { fixer: okFixer, replayScore, prepareCandidate, baseScore };
  };

  it('the strict-improvement gate ACCEPTS the real 0→1.0 fix and STAGES it (auto_adopt OFF)', async () => {
    const r = await runFixGate([defect], stages());
    expect(r.records[0].verdict.accept).toBe(true);
    expect(r.records[0].verdict.delta).toBe(1); // 1.0 (candidate) − 0 (base)
    expect(r.records[0].landed).toBe('staged');
  });

  it('the same accepted FUNCTIONALITY win AUTO-ADOPTS once auto_adopt is set', async () => {
    const r = await runFixGate([defect], stages(), { autoAdopt: true });
    expect(r.records[0].landed).toBe('adopted');
    expect(r.accepted).toBe(1);
  });
});
