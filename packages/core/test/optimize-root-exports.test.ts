// Contract: the FULL optimize surface (§6 FIX→GATE→LAND + §5.1 replay/mine) must be reachable from the
// `@piflow/core` ROOT, not only the internal `optimize/index.js`. A product-side binding (game-omni's live
// oracle module) imports `makeReplayStages` + the replay/driver TYPES from the package root — it cannot reach
// into `src/optimize/`. Before this lift, only the §7 Score+Triage names were on the root (the recon flagged
// this as the one boundary-safe core change the live binding needs). The "red" here is an ESM bind error: a
// missing named export makes this module fail to load. Pure compile/import contract — no behaviour mocked.
//
// Run: npx vitest run packages/core/test/optimize-root-exports.test.ts

import { describe, it, expect } from 'vitest';
import {
  makeReplayStages,
  mineTaskFromTrace,
  gameOmniNodeToMilestone,
  runFixGate,
  evaluateGate,
  writeStagingManifest,
  adoptFile,
} from '../src/index.js';
import type {
  CheckableTask,
  ReplayDeps,
  ReplayStages,
  MineOpts,
  FixGateStages,
  FixGateResult,
  GateVerdict,
  LandPolicy,
} from '../src/index.js';

describe('the @piflow/core ROOT lifts the full optimize surface (replay + mine + driver + gate + land)', () => {
  it('re-exports the replay/mine/driver/gate/land VALUES from the package root', () => {
    for (const fn of [makeReplayStages, mineTaskFromTrace, gameOmniNodeToMilestone, runFixGate, evaluateGate, writeStagingManifest, adoptFile])
      expect(typeof fn).toBe('function');
  });

  it('re-exports the replay/driver TYPES from the root (compiles only if they are on the root surface)', () => {
    // A product binding builds these against the package root; this usage is the compile-time proof.
    const task: CheckableTask = { id: 'x:M1', node: 'n', split: 'val', baseReport: {}, oracleInput: {} };
    const policy: LandPolicy = 'stage-for-human';
    const verdict: GateVerdict = evaluateGate({ bucket: 'SKILL', base: 0, candidate: 1, editsApplied: 1 });
    // a ReplayDeps the live binding would assemble (types reachable from root); not executed.
    const deps: ReplayDeps = { oracle: async () => ({}), mineTask: () => null, copyScope: async () => 'cand' };
    const _stages: ReplayStages = makeReplayStages(deps);
    const _opts: MineOpts = { split: () => 'val' };
    const _gate: FixGateStages = { fixer: async () => ({ editsApplied: 0 }), replayScore: async () => null, prepareCandidate: async () => 'c', baseScore: () => null };
    const _res: FixGateResult | null = null;
    expect(task.split).toBe('val');
    expect(policy).toBe('stage-for-human');
    expect(verdict.accept).toBe(true);
    expect(typeof _stages.baseScore).toBe('function');
    expect(_opts.split?.({ node: 'n', milestoneId: 'M1' })).toBe('val');
    expect(typeof _gate.fixer).toBe('function');
    expect(_res).toBeNull();
  });
});
