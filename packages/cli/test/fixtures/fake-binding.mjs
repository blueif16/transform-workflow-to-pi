// A fake `optimize --binding` module for tests — stands in for game-omni's LIVE oracle module. The real one
// imports runMilestoneVerify2 + runs npm build + boots a browser; this one returns a PASSING report so the
// strict-improvement gate accepts (base 0 → candidate 1.0). Named exports (the loader accepts default OR named).
export const oracle = async () => ({ marker: 'VALIDATION_PASSED', passed: true, fidelity: [{ id: 'M2-A3', status: 'pass' }] });
export const copyScope = async (node) => `cand:${node}`;
export const fixer = async () => ({ editsApplied: 1, candidatePassedProductChecks: true, tokensSpent: 10 });
