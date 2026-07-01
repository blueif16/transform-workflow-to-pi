// optimize/types.ts — the shared contract for the out-of-band Score + Triage pass (piflow-memory-v1.5 §7).
//
// The optimization layer is PURE + READ-ONLY + OUT-OF-BAND (post-run; NEVER an in-DAG node — "curation off
// the critical path"). It reads a finished run's traces + the product's per-node criteria and emits the
// worklist a fixer consumes (= the automated HERMES-ROUTING.md). This file declares ONLY the data shapes;
// the behaviour lives in score.ts (the fold) and triage.ts (the four-way projector). Nothing here writes.

import type { AnomalyKind } from '../observe/telemetry.js';

// ── the four-way credit-assignment bucket (v1.5 §3, ascending blast radius) ────────────────────────────
// LAPSE         — the skill was right; the executor slipped (lowest blast radius; the default-when-unsure).
// SKILL         — the prose is wrong/missing/underspecified (edit the envelope: prompt.md / SKILL.md / node.json).
// FUNCTIONALITY — the prose is fine; the product CODE the node operates on is wrong (edit code in owns/readScope).
// ARCH          — the fix escapes the node's scope: a cross-node wiring/contract flaw (route UP to reconcile).
export type DefectBucket = 'LAPSE' | 'SKILL' | 'FUNCTIONALITY' | 'ARCH';

export type Confidence = 'high' | 'medium' | 'low';

// ── Tier-1: the outcome / checkable quality signal (v1.5 §4d, §7) ──────────────────────────────────────
// For game-omni this is the standalone, model-free `verify-milestone` report (the six-gate harness). It is
// the preferred quality signal precisely because it is deterministic — no judge, no false confidence.
export type Tier1Gate = 'fidelity' | 'completability' | 'invariant' | 'perturbation';

/** One checkable outcome the verify harness measured. */
export interface Tier1Check {
  /** assertion / gate id, e.g. "M2-A3", "completability", "score/moveCount/waveIndex non-decreasing". */
  id: string;
  gate: Tier1Gate;
  passed: boolean;
  describe?: string;
  message?: string;
}

/**
 * The per-milestone Tier-1 verdict, projected from a verify-milestone report. CRITICAL: `abstained` (the
 * measure could NOT run — boot-fail / missing blueprint.declaredRanges / design escalation) is a DISTINCT
 * state from a low score (v1.5 §7 "ABSTAIN ≠ low value"). The verify harness itself marks some of these
 * cases VALIDATION_FAILED; the reader RE-TAGS them as abstained so the fold never penalizes a build whose
 * quality was never measured.
 */
export interface Tier1Result {
  milestoneId: string;
  marker: 'VALIDATION_PASSED' | 'VALIDATION_FAILED';
  passed: boolean;
  abstained: boolean;
  /** the per-check results across the six gates; empty on boot-fail. */
  checks: Tier1Check[];
  /** fraction of checks that RAN and passed (passed/total); 0 when none ran. Meaningless when abstained. */
  scalar: number;
  /** absolute path to the source report, when read from disk. */
  reportPath?: string;
  /**
   * Uncaught runtime errors the harness captured (verify report `consoleErrors`). NOT a check — but the
   * DOMINATING signal when a crash wedges the run loop and masks the per-check failures. Surfaced into the
   * fixer's evidence so it can trace the real root cause; omitted entirely when the report has none.
   */
  consoleErrors?: string[];
}

// ── Tier-0: the deterministic trace gate (v1.5 §4d, §7) ────────────────────────────────────────────────
/**
 * The judgment-free disqualifier read straight off telemetry (loops, retry storms, truncation, context
 * pressure, failure). It is a PRE-FILTER + the diagnostic that routes the §3 bucket — NEVER a quality score
 * ("more time spent" is non-monotonic; token count is a risk signal, not a grade).
 */
export interface Tier0Signal {
  anomalies: AnomalyKind[];
  /** a structural disqualifier (failure / truncation / tool-loop) tripped — the deterministic pre-filter. */
  disqualified: boolean;
  reason?: string;
}

/**
 * The per-node score — the projection of (Tier-0 disqualifier × Tier-1 value) one fixer reads per node.
 * `scalar` folds the two deterministic tiers; it is `null` when the node was ABSTAINED (no quality signal)
 * or has no Tier-1 mapping and no Tier-0 problem (nothing to measure, nothing wrong). Tier-2 (judgment) is
 * deliberately ABSENT in v1 — it is quarantined out of the verdict (v1.5 §4c, §7).
 */
export interface NodeScore {
  node: string;
  tier0: Tier0Signal;
  /** null = no milestone-verify maps to this node (Tier-1 not applicable). */
  tier1: Tier1Result | null;
  scalar: number | null;
  /** true when the score could not be measured (Tier-1 abstained AND no Tier-0 disqualifier). */
  abstained: boolean;
}

// ── the triage output — one worklist item per defect (v1.5 §7; the proven HERMES-ROUTING.md shape) ──────
/**
 * The deterministic projector emits the STRUCTURAL worklist (node · bucket · symptom · evidence ·
 * confidence). The deep free-text root-cause TRACE the human used to hand-write is the FIXER's job, not the
 * projector's — so the MVP emits pointers, never invented prose. Buckets the projector cannot yet decide
 * (SKILL needs cross-run recurrence; a residual LAPSE/SKILL split needs a prose-judge) populate
 * `needsSignal` instead of mis-attributing (v1.5 §7 "emit 'needs signal X', never mis-attribute").
 */
export interface Defect {
  node: string;
  bucket: DefectBucket;
  /** one-line, agent-readable — derived from the failing check / anomaly, never invented. */
  symptom: string;
  /** the grounding pointers: failing check ids, anomaly kinds, the source-owner hint. */
  evidence: string[];
  confidence: Confidence;
  /** the missing signal that would sharpen/confirm the bucket (when the projector defaulted). */
  needsSignal?: string;
}

// ── the per-node criteria fixture (the product's quality bar; v1.5 §7) ─────────────────────────────────
/** One node's quality bar, parsed from the product's `skill-system-criteria.md`. Read-only INPUT. */
export interface CriteriaEntry {
  /** the node id from the `## Label (node-id)` heading, e.g. "w0-classify", "harden-blueprint". */
  nodeId: string;
  label: string;
  artifact: string;
  purpose: string;
  acceptanceCriteria: string[];
  redFlags: string[];
  /** set when the entry is an archetype/goal-model variant, e.g. "open-ended" or "action_3d". */
  variantKey?: string;
}

/** Keyed by node id (and `nodeId:variantKey` for variant entries). */
export type CriteriaFixture = Map<string, CriteriaEntry>;
