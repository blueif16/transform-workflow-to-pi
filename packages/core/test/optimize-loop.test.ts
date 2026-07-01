// Contract for optimize/loop.ts — the multi-round OVERLORD (piflow-memory-v1.5 §6). A deterministic straight-
// line driver that composes INJECTED stages (run → score+triage → fix+gate → memorize) over N rounds, bounds by
// run-count + convergence + stall + a circuit-breaker, and NEVER decides accept/reject itself (the injected
// fixGate does). Tests use in-memory FAKE stages (real functions that record calls + return canned shapes) —
// orchestration glue, no mocks.
//
// Run: npx vitest run packages/core/test/optimize-loop.test.ts

import { describe, it, expect } from 'vitest';
import { runOptimizeLoop, type OptimizeLoopStages } from '../src/optimize/loop.js';
import type { FixGateResult } from '../src/optimize/driver.js';
import type { Defect } from '../src/optimize/types.js';

const defect = (node = 'flaky'): Defect => ({ node, bucket: 'LAPSE', symptom: 'x', evidence: [], confidence: 'low' });

const fixResult = (accepted: number, attempted = accepted): FixGateResult => ({
  records: [], skipped: [], attempted, accepted, stoppedReason: 'complete',
});

describe('runOptimizeLoop — runs the budget, in order, threading one rejected-buffer', () => {
  it('runs N rounds (run→score→fix per round), records the trajectory, threads ONE buffer, stops budget-exhausted', async () => {
    const calls: string[] = [];
    const buffers: Set<string>[] = [];
    const stages: OptimizeLoopStages<string> = {
      run: async (r) => { calls.push(`run:${r}`); return `run-${r}`; },
      scoreAndTriage: async (run, r) => { calls.push(`score:${r}:${run}`); return [defect()]; },
      fixGate: async (_defects, buffer, r) => { calls.push(`fix:${r}`); buffers.push(buffer); return fixResult(1); },
    };

    const res = await runOptimizeLoop(stages, { rounds: 3 });

    expect(res.roundsRun).toBe(3);
    expect(res.stoppedReason).toBe('budget-exhausted');
    expect(res.trajectory).toEqual([
      { round: 1, accepted: 1, attempted: 1 },
      { round: 2, accepted: 1, attempted: 1 },
      { round: 3, accepted: 1, attempted: 1 },
    ]);
    // stage order per round is run → score → fix; and the loop ran all three rounds.
    expect(calls).toEqual([
      'run:1', 'score:1:run-1', 'fix:1',
      'run:2', 'score:2:run-2', 'fix:2',
      'run:3', 'score:3:run-3', 'fix:3',
    ]);
    // the SAME rejected-buffer instance is threaded every round (dead edits carry across rounds).
    expect(buffers[0]).toBe(buffers[1]);
    expect(buffers[1]).toBe(buffers[2]);
  });
});

describe('runOptimizeLoop — convergence early-stop', () => {
  it('a round whose triage returns 0 defects stops the loop (converged) BEFORE fixing, without exhausting the budget', async () => {
    let fixCalls = 0;
    const stages: OptimizeLoopStages<string> = {
      run: async (r) => `run-${r}`,
      // round 1 has a defect; round 2 is clean → converged.
      scoreAndTriage: async (_run, r) => (r === 1 ? [defect()] : []),
      fixGate: async () => { fixCalls++; return fixResult(1); },
    };

    const res = await runOptimizeLoop(stages, { rounds: 5 });

    expect(res.stoppedReason).toBe('converged');
    expect(res.roundsRun).toBe(2); // stopped at round 2, not the full 5
    expect(fixCalls).toBe(1); // round 2 converged → fixGate NOT called that round
    expect(res.trajectory).toHaveLength(1); // only round 1 fixed
  });
});

describe('runOptimizeLoop — stalled early-stop (optional)', () => {
  it('stops (stalled) after `stalledPatience` consecutive rounds with 0 accepted edits', async () => {
    const stages: OptimizeLoopStages<string> = {
      run: async (r) => `run-${r}`,
      scoreAndTriage: async () => [defect()],
      fixGate: async () => fixResult(0, 1), // always attempts, never accepts
    };

    const res = await runOptimizeLoop(stages, { rounds: 10, stalledPatience: 2 });

    expect(res.stoppedReason).toBe('stalled');
    expect(res.roundsRun).toBe(2); // two no-accept rounds hit patience
  });

  it('a single accepted round RESETS the stall counter (does not stop on isolated no-accept rounds)', async () => {
    // accepts pattern by round: 0, 1, 0 — never TWO no-accepts in a row → runs the full budget.
    const accepts = [0, 1, 0];
    const stages: OptimizeLoopStages<string> = {
      run: async (r) => `run-${r}`,
      scoreAndTriage: async () => [defect()],
      fixGate: async (_d, _b, r) => fixResult(accepts[r - 1], 1),
    };

    const res = await runOptimizeLoop(stages, { rounds: 3, stalledPatience: 2 });

    expect(res.stoppedReason).toBe('budget-exhausted'); // the round-2 accept reset the counter
    expect(res.roundsRun).toBe(3);
  });
});

describe('runOptimizeLoop — robustness + circuit-breaker', () => {
  it('trips the circuit-breaker after `errorBudget` CONSECUTIVE throwing rounds', async () => {
    const stages: OptimizeLoopStages<string> = {
      run: async () => { throw new Error('run blew up'); },
      scoreAndTriage: async () => [defect()],
      fixGate: async () => fixResult(1),
    };

    const res = await runOptimizeLoop(stages, { rounds: 10, errorBudget: 2 });

    expect(res.stoppedReason).toBe('circuit-broken');
    expect(res.roundsRun).toBe(2);
    expect(res.rounds[0].error).toContain('run blew up');
  });

  it('tolerates an ISOLATED throwing round (robust): a transient failure does not stop or crash the loop', async () => {
    const stages: OptimizeLoopStages<string> = {
      run: async (r) => { if (r === 1) throw new Error('transient'); return `run-${r}`; },
      scoreAndTriage: async () => [defect()],
      fixGate: async () => fixResult(1),
    };

    const res = await runOptimizeLoop(stages, { rounds: 3, errorBudget: 2 });

    // round 1 threw but a later success reset the breaker → the loop ran to the budget, never crashed.
    expect(res.stoppedReason).toBe('budget-exhausted');
    expect(res.roundsRun).toBe(3);
    expect(res.rounds[0].error).toContain('transient');
    expect(res.trajectory).toHaveLength(2); // rounds 2 and 3 fixed
  });
});

describe('runOptimizeLoop — MEMORIZE + buffer threading (content)', () => {
  it('calls the optional memorize stage once per FIXED round with that round result', async () => {
    const memoized: number[] = [];
    const stages: OptimizeLoopStages<string> = {
      run: async (r) => `run-${r}`,
      scoreAndTriage: async () => [defect()],
      fixGate: async () => fixResult(1),
      memorize: async (_run, _result, r) => { memoized.push(r); },
    };

    await runOptimizeLoop(stages, { rounds: 3 });

    expect(memoized).toEqual([1, 2, 3]);
  });

  it('carries the rejected-buffer CONTENT across rounds (a key added in round 1 is visible in round 2)', async () => {
    const seenInRound2: string[] = [];
    const stages: OptimizeLoopStages<string> = {
      run: async (r) => `run-${r}`,
      scoreAndTriage: async () => [defect()],
      fixGate: async (_d, buffer, r) => {
        if (r === 1) buffer.add('dead-edit-key');
        if (r === 2) seenInRound2.push(...buffer);
        return fixResult(1);
      },
    };

    await runOptimizeLoop(stages, { rounds: 2 });

    expect(seenInRound2).toContain('dead-edit-key'); // the same Set, threaded — round 1's dead edit persists
  });
});
