// optimize/loop.ts — the multi-round OVERLORD (piflow-memory-v1.5 §6). A DETERMINISTIC, straight-line driver
// matching SkillOpt's `run_sleep_cycle` (skillopt-sleep-loop-control §1,§7): for each round it composes the
// INJECTED model stages (run → score+triage → fix+gate → memorize) but the control flow, the bounds, the
// early-stop, and the circuit-breaker are all CODE. "The model proposes and scores; deterministic code decides,
// bounds, and lands" — the loop never decides accept/reject (the gate does, inside fixGate) and never mutates a
// live file (land.ts does). The loop is BLIND to what a "run" or a "fix" actually is (the SkillOpt `backend`
// abstraction): every stage is injected, so @piflow/core stays product-agnostic.
//
// Bounding, dual-grounded (SkillOpt hard-caps + the goalmode/loop-engineering "honest reconciliation",
// eval-codex-goalmode-loop-patterns §4):
//   • run-count N — the BUDGET ceiling (SkillOpt: one cron firing = one night; here an in-process N-round loop).
//   • CONVERGED early-stop — a round whose triage returns 0 defects stops the loop (SkillOpt's early-exit guard,
//     cycle.py:208). Deterministic: the quality check already happened in the gate/triage, so no separate model.
//   • STALLED early-stop (optional) — K consecutive rounds with no ACCEPTED edit stop the loop (Codex/Ralph
//     "stop on a verifiable condition" — here "no progress"). Off unless `stalledPatience` is set.
//   • CIRCUIT-BREAKER (LoopRails P9) — K consecutive rounds whose stage THREW trip the breaker and halt; a fresh
//     invocation is the logged human re-authorization. This is also what makes the loop robust to a transient
//     stage failure (one throw does not crash the run).
// The per-round edit_budget / token budget live INSIDE the injected fixGate (driver.ts) — the loop does not
// re-implement them. Multi-candidate Pareto selection (v1.5 §6 phase-2) is a FIX+GATE change, not the loop's.

import type { Defect } from './types.js';
import type { FixGateResult } from './driver.js';
import type { OptimizeEventSink } from './events.js';

/**
 * The injected round stages — the loop calls these in order and is blind to their internals. `R` is an opaque
 * run handle (e.g. a run dir) the product's `run` returns and its later stages consume.
 */
export interface OptimizeLoopStages<R = unknown> {
  /** RUN the system for this round → an opaque handle (product-side; e.g. runs the workflow, returns its run dir). */
  run(round: number): Promise<R>;
  /** SCORE + TRIAGE the run → the worklist. An EMPTY list means CONVERGED (nothing left to fix). Uses the check-model. */
  scoreAndTriage(run: R, round: number): Promise<Defect[]>;
  /** FIX→GATE the worklist on candidate copies → the round's decisions. Thread `rejectedBuffer` so dead edits don't recur. */
  fixGate(defects: Defect[], rejectedBuffer: Set<string>, round: number): Promise<FixGateResult>;
  /** MEMORIZE the round's lessons (Leg A). Optional; out-of-band, after the gate. */
  memorize?(run: R, result: FixGateResult, round: number): Promise<void>;
}

export interface OptimizeLoopOpts {
  /** N — the run-count BUDGET ceiling. */
  rounds: number;
  /** optional: stop after this many CONSECUTIVE rounds with 0 accepted edits (stalled). Off when unset. */
  stalledPatience?: number;
  /** optional circuit-breaker: trip after this many CONSECUTIVE rounds whose stage threw. Default 2; 0 disables. */
  errorBudget?: number;
  /** carried across rounds so a dead edit is never re-proposed (SkillOpt all_rejected). A fresh Set when unset. */
  rejectedBuffer?: Set<string>;
  /** optional LIVE round-level progress sink; a throwing sink is swallowed so it never breaks the loop. */
  onEvent?: OptimizeEventSink;
}

export type LoopStopReason = 'budget-exhausted' | 'converged' | 'stalled' | 'circuit-broken';

/** One round's outcome. `result` is null for a converged round (no fix ran) or an errored round (breaker path). */
export interface RoundRecord {
  round: number;
  defectCount: number;
  result: FixGateResult | null;
  /** set only when the round's stage threw (the round was counted toward the circuit-breaker). */
  error?: string;
}

export interface OptimizeLoopResult {
  rounds: RoundRecord[];
  /** the round-by-round score trajectory the human reads at the end (fix rounds only). */
  trajectory: { round: number; accepted: number; attempted: number }[];
  stoppedReason: LoopStopReason;
  /** how many rounds were actually entered (≤ opts.rounds). */
  roundsRun: number;
}

/**
 * Drive up to `opts.rounds` optimization rounds. Each round: run → score+triage → (converged? stop) → fix+gate
 * → memorize. Stops early on convergence (0 defects), stall (K no-accept rounds), or the circuit-breaker (K
 * consecutive throwing rounds). Deterministic control flow; all intelligence is in the injected stages. Returns
 * the per-round records + the score trajectory; lands nothing itself (the injected fixGate/land already decided).
 */
export async function runOptimizeLoop<R>(stages: OptimizeLoopStages<R>, opts: OptimizeLoopOpts): Promise<OptimizeLoopResult> {
  const errorBudget = opts.errorBudget ?? 2;
  const buffer = opts.rejectedBuffer ?? new Set<string>();
  const rounds: RoundRecord[] = [];
  const trajectory: OptimizeLoopResult['trajectory'] = [];

  // Fire-and-forget the progress event: a throwing sink must NEVER break the loop (the loop is the source of
  // truth, the stream is only a projection). No sink ⇒ a no-op. Mirrors the FIX→GATE driver's safeEmit.
  const safeEmit: OptimizeEventSink = (event) => {
    if (!opts.onEvent) return;
    try { opts.onEvent(event); } catch { /* swallow — the stream never gates the loop */ }
  };

  let stalled = 0; // consecutive rounds with 0 accepted edits
  let consecutiveErrors = 0; // consecutive rounds whose stage threw (feeds the circuit-breaker)
  let stoppedReason: LoopStopReason = 'budget-exhausted';
  let roundsRun = 0;

  for (let round = 1; round <= opts.rounds; round++) {
    roundsRun = round;
    safeEmit({ type: 'round-started', round, of: opts.rounds });
    try {
      const run = await stages.run(round);
      const defects = await stages.scoreAndTriage(run, round);

      // CONVERGED — triage found nothing left to fix. The quality check already happened in score/triage, so
      // this is a deterministic early-stop (SkillOpt's early-exit guard), no separate checker needed.
      if (defects.length === 0) {
        rounds.push({ round, defectCount: 0, result: null });
        safeEmit({ type: 'loop-converged', round });
        stoppedReason = 'converged';
        break;
      }

      const result = await stages.fixGate(defects, buffer, round);
      if (stages.memorize) await stages.memorize(run, result, round);

      rounds.push({ round, defectCount: defects.length, result });
      trajectory.push({ round, accepted: result.accepted, attempted: result.attempted });
      safeEmit({ type: 'round-complete', round, defectCount: defects.length, accepted: result.accepted, attempted: result.attempted });
      consecutiveErrors = 0; // a round that completed resets the breaker

      // STALLED — K consecutive rounds landed no accepted edit (a "no progress" condition, off unless opted in).
      if (result.accepted === 0) {
        stalled++;
        if (opts.stalledPatience != null && stalled >= opts.stalledPatience) { stoppedReason = 'stalled'; break; }
      } else {
        stalled = 0;
      }
    } catch (err) {
      // ROBUSTNESS + CIRCUIT-BREAKER: a thrown stage does not crash the loop. One throw is tolerated (transient);
      // `errorBudget` CONSECUTIVE throwing rounds trip the breaker and halt — a fresh invocation is the logged
      // human re-authorization (LoopRails). errorBudget 0 disables the breaker (throws still counted, never trip).
      const message = err instanceof Error ? err.message : String(err);
      rounds.push({ round, defectCount: 0, result: null, error: message });
      consecutiveErrors++;
      if (errorBudget > 0 && consecutiveErrors >= errorBudget) { stoppedReason = 'circuit-broken'; break; }
    }
  }

  safeEmit({ type: 'loop-stopped', reason: stoppedReason, roundsRun });
  return { rounds, trajectory, stoppedReason, roundsRun };
}
