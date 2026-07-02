import type { RunView } from './runView.js';
import type { SandboxProviderKind } from '../types.js';

// The FALSIFIABLE full-run rubric (docs/design/full-run-simulation.md §5). Decides whether a distilled
// RunView is EVIDENCE of a real, successful run — computed only from observable state (the run-level
// verdict + each declared artifact's on-disk existence), NEVER from a config/blob substring or from the
// run merely reaching a terminal scheduler state. This is the reusable core the smoke drivers and the
// L1–L3 E2E tiers all call, replacing the reward-hackable regex checks that let the Railway run go green.
//
// IMPORTANT (source-verified against runView.ts): the rich `buildRunView` passes node `status` through
// RAW (rec.status, un-derived), so `status==='ok'` alone is not self-report-independent. The load-bearing
// signals are therefore: (a) the sandbox backend actually ran something real (≠ inmemory), (b) EVERY
// declared artifact exists on disk and is non-empty, (c) the run-level ok/totals verdict. `status` is kept
// as a secondary check (a genuine success is 'ok'), but never the sole gate.

export interface AssessOpts {
  /** Node ids that MUST each reach a good verdict with produced artifacts. Default: every node in the view. */
  expectNodes?: string[];
  /** Sandbox backends that DISQUALIFY the run as proof of execution. Default: ['inmemory']. */
  forbidSandbox?: SandboxProviderKind[];
  /** Require each asserted node to declare AND produce ≥1 non-empty artifact. Default: true. */
  requireArtifacts?: boolean;
}

export interface RunAssessment {
  /** True iff every rubric check held — the run is genuine, successful evidence. */
  pass: boolean;
  /** One human-readable line per violated check (empty iff pass). */
  failures: string[];
}

/** Terminal node statuses that count as a genuine success (a fresh E2E run expects 'ok'; 'reused' = cache hit). */
const OK_STATUS = new Set(['ok', 'reused']);

export function assessRunView(view: RunView, opts: AssessOpts = {}): RunAssessment {
  const failures: string[] = [];
  const forbid = new Set<SandboxProviderKind>(opts.forbidSandbox ?? ['inmemory']);
  const requireArtifacts = opts.requireArtifacts ?? true;

  // 1. PROVIDER PROOF — a real sandbox executed (guards the silent `--sandbox inmemory` no-op, N-inmemory).
  if (view.sandbox === undefined) {
    failures.push('sandbox backend unknown — cannot prove a real (non-inmemory) sandbox executed');
  } else if (forbid.has(view.sandbox)) {
    failures.push(`sandbox '${view.sandbox}' is a non-proving backend (forbidden: ${[...forbid].join(', ')}) — the run executed nothing real`);
  }

  // 2. RUN-LEVEL VERDICT — reached done, succeeded overall, and no node counted as failed.
  if (view.done !== true) failures.push('run did not reach done');
  if (view.ok !== true) failures.push(`run.ok is ${String(view.ok)} (expected true)`);
  if (view.totals && view.totals.failed > 0) {
    failures.push(`${view.totals.failed} node(s) failed per run totals`);
  }

  // 3. NODE-LEVEL — each expected node reached a good verdict AND produced its declared artifacts on disk.
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const targets = opts.expectNodes ?? view.nodes.map((n) => n.id);
  if (targets.length === 0) failures.push('no nodes to assess (empty run-view)');
  for (const id of targets) {
    const n = byId.get(id);
    if (!n) {
      failures.push(`expected node '${id}' is absent from the run-view`);
      continue;
    }
    if (!OK_STATUS.has(n.status)) {
      failures.push(`node '${id}' status '${n.status}' (expected ok)`);
    }
    if (requireArtifacts) {
      if (n.artifacts.length === 0) {
        failures.push(`node '${id}' declared no artifacts — nothing to verify`);
      }
      for (const a of n.artifacts) {
        if (!a.exists) failures.push(`node '${id}' artifact '${a.displayPath}' is missing on disk`);
        else if (a.bytes <= 0) failures.push(`node '${id}' artifact '${a.displayPath}' is empty (0 bytes)`);
      }
    }
  }

  return { pass: failures.length === 0, failures };
}
