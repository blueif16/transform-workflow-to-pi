// optimize/criteria.ts — parse the product's per-node quality bar (`skill-system-criteria.md`) into a
// CriteriaFixture the scorer/triage key by node id. Pure: markdown string → Map. READ-ONLY input.
//
// STUB (RED phase) — returns empty so the contract test fails on an assertion, not an import error.
// Implemented to the contract in optimize/criteria.test.ts.

import type { CriteriaFixture } from './types.js';

/** Parse `skill-system-criteria.md` content → entries keyed by node id (and `nodeId:variantKey`). */
export function parseCriteria(_markdown: string): CriteriaFixture {
  return new Map();
}
