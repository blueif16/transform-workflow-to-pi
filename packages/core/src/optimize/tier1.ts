// optimize/tier1.ts — project a game-omni `verify-milestone` report (the standalone, model-free six-gate
// harness output) into a Tier1Result. This is the OUTCOME/checkable quality signal the accept gate keys on
// (v1.5 §4d, §7). Pure: a parsed report object → Tier1Result. NO disk, NO browser — the live re-verify
// (runMilestoneVerify2) is a SEPARATE source that emits the same shape for the later GATE step.
//
// THE LOAD-BEARING RULE: `abstained` (the measure could NOT run) is re-tagged here even though the harness
// itself marks boot-fail / missing declaredRanges / design-escalation as VALIDATION_FAILED. ABSTAIN ≠ low
// score (v1.5 §7) — the fold must never penalize a build whose quality was never measured.
//
// STUB (RED phase) — returns a fixed failing verdict so the contract test fails on assertions, not import.
// Implemented to the contract in optimize/tier1.test.ts.

import type { Tier1Result } from './types.js';

/** Project a parsed verify-milestone report object → the Tier1Result the fold consumes. */
export function readVerifyReport(_report: unknown, _opts: { reportPath?: string } = {}): Tier1Result {
  return { milestoneId: '', marker: 'VALIDATION_FAILED', passed: false, abstained: false, checks: [], scalar: 0 };
}
