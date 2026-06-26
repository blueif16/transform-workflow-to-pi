// (M3 · G12) expandReroute — STUB (test-first). The real transform UNROLLS a bounded conditional reroute
// loop into forward-only acyclic clones. This stub returns the spec unchanged so the failing unroll test
// FAILS for the RIGHT reason (the clones are absent), not an import error.

import type { WorkflowSpec } from '../../types.js';

/** Thrown when a reroute activation is unbuildable (non-ancestor target / max<1). Loud, never a silent skip. */
export class RerouteConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RerouteConfigError';
  }
}

export function expandReroute(spec: WorkflowSpec): WorkflowSpec {
  return spec;
}
