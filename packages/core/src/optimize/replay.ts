// optimize/replay.ts — the held-out replay+scoring harness (piflow-memory-v1.5 §5.1, §6). THE KEYSTONE: it
// turns the driver's injected baseScore/replayScore/prepareCandidate from stubs into REAL measurements off a
// product oracle. §5.1 names this the true critical path — "everything in §2–§4 is downstream of it": the
// across-run gate (§2) has nothing to compare until a real score exists.
//
// PRODUCT-AGNOSTIC by construction (SDK boundary law: @piflow/core stays product-agnostic). This module folds
// whatever verify report the INJECTED oracle emits — it never knows what a "milestone" or "assertion" is. The
// product (game-omni) supplies the three seams: the oracle (its runMilestoneVerify2), mineTask (read a
// checkable task from a run trace), and copyScope (copy the node's editable scope to a candidate dir). We fold
// the report through the SAME readVerifyReport the §7 score pass uses, so base, candidate, and the in-DAG
// score all agree on one scalar definition.
//
// Two load-bearing invariants this harness physically enforces:
//   • ABSTAIN ≠ low score (v1.5 §7). A report whose measure could NOT run (boot-fail / missing declaredRanges
//     / design escalation — readVerifyReport sets `abstained`) folds to NULL, never 0. The gate then refuses
//     to outcome-accept and routes to the human (gate.ts) — an unmeasured build is never auto-rejected as bad.
//   • VAL-hygiene (v1.5 §6, SkillOpt consolidate.py:54-58). The across-run gate scores ONLY a held-out 'val'
//     task. A 'train' task reaching a scoring path is a product wiring error, so we throw (fail-closed) rather
//     than silently let train data leak into the gate.
//
// base vs candidate: baseScore folds the incumbent report RECORDED in the trace (the run already measured it
// once); replayScore runs the oracle FRESH on the candidate copy (the only thing a new edit makes unmeasured).
// baseScore is SYNC to match the driver's BaseScore contract — mineTask reads the trace synchronously.

import type { BaseScore, ReplayScore, PrepareCandidate } from './driver.js';
import { readVerifyReport } from './tier1.js';

/**
 * A checkable task mined from a node's run trace — the unit a replay scores. The reports are product-OPAQUE
 * to @piflow/core (game-omni: a verify-milestone report); we only fold them via readVerifyReport. `split`
 * enforces VAL-hygiene; `baseReport` is the incumbent's recorded report; `oracleInput` is whatever the
 * product oracle needs to re-verify a candidate build (e.g. milestoneId + assertions + blueprint).
 */
export interface CheckableTask {
  /** stable id, e.g. "gs01:M2". */
  id: string;
  /** the node this task scores (the blame target), e.g. "w4-execute". */
  node: string;
  /** VAL-hygiene: the gate scores ONLY a held-out 'val' task; a 'train' task throws (never gate-leaks). */
  split: 'val' | 'train';
  /** the incumbent's RAW verify report (from the run trace) — folded for baseScore. */
  baseReport: unknown;
  /** product-opaque input the oracle needs to re-verify a candidate build (milestoneId, assertions, …). */
  oracleInput: unknown;
}

/** Product-injected oracle: re-verify a candidate build dir for this task → a RAW verify report. MEASURES; never scores. */
export type ReplayOracle = (task: CheckableTask, candidateBuildDir: string) => Promise<unknown>;

/** Product-injected: mine the checkable task for a node (null = nothing replayable). SYNC — reads the trace. */
export type MineTask = (node: string) => CheckableTask | null;

/** Product-injected: copy the node's editable scope (build/source) to a fresh candidate dir; return its ref. NEVER the live path. */
export type CopyScope = (node: string) => Promise<string>;

export interface ReplayDeps {
  oracle: ReplayOracle;
  mineTask: MineTask;
  copyScope: CopyScope;
}

/** The three stages the driver injects (driver.ts FixGateStages): the real baseScore + replayScore + prepareCandidate. */
export interface ReplayStages {
  baseScore: BaseScore;
  replayScore: ReplayScore;
  prepareCandidate: PrepareCandidate;
}

/** Fold a raw verify report → the gate scalar, propagating ABSTAIN as null (abstain ≠ low score, v1.5 §7). */
function foldScore(report: unknown): number | null {
  const r = readVerifyReport(report);
  return r.abstained ? null : r.scalar;
}

/** VAL-hygiene gate (fail-closed): a non-val task must never reach a scoring path (v1.5 §6). */
function requireVal(task: CheckableTask): void {
  if (task.split !== 'val')
    throw new Error(
      `VAL-hygiene: refusing to score a '${task.split}' task (${task.id}); the across-run gate scores only held-out 'val' tasks (v1.5 §6)`,
    );
}

/**
 * Compose the product's oracle + mineTask + copyScope into the driver's three injected stages. Pure wiring +
 * the two invariants (abstain→null, val-only); no disk, no live mutation — copying is the product's copyScope.
 */
export function makeReplayStages(deps: ReplayDeps): ReplayStages {
  const { oracle, mineTask, copyScope } = deps;

  // baseScore: the incumbent's recorded outcome from the trace — measured ONCE during the run, not re-run.
  const baseScore: BaseScore = (node) => {
    const task = mineTask(node);
    if (!task) return null;
    requireVal(task);
    return foldScore(task.baseReport);
  };

  // replayScore: the candidate is the only thing a fresh edit left unmeasured — run the oracle on its COPY.
  const replayScore: ReplayScore = async (node, candidateRef) => {
    const task = mineTask(node);
    if (!task) return null;
    requireVal(task);
    return foldScore(await oracle(task, candidateRef));
  };

  // prepareCandidate: copy the node's editable scope to a candidate dir — the fixer edits the COPY, never live.
  const prepareCandidate: PrepareCandidate = (defect) => copyScope(defect.node);

  return { baseScore, replayScore, prepareCandidate };
}
