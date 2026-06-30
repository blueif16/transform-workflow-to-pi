// optimize/render.ts — render the triage worklist (Defect[]) into the PROVEN HERMES-ROUTING.md shape
// (v1.5 §7: "the output FORMAT is already proven — reproduce its shape, don't design a new one"). Pure:
// Defect[] + run meta → markdown string. Writes nothing.
//
// The proven shape (see the golden fixture gs01.hermes-routing.golden.md): a `## Routing summary` table
// (one row per defect) followed by a `## Finding N — …` section per defect. The post-hoc `## Update —
// fixes applied` trailer is NEVER emitted by the projector (it is hand-appended after fixes land).
//
// STUB (RED phase) — returns empty so the contract test fails on assertions, not an import error.
// Implemented to the contract in optimize/render.test.ts.

import type { Defect } from './types.js';

export interface RoutingMeta {
  runId: string;
  archetype?: string;
}

/** Render the worklist into the proven HERMES-ROUTING.md markdown (routing table + per-finding sections). */
export function renderRouting(_defects: Defect[], _meta: RoutingMeta): string {
  return '';
}
