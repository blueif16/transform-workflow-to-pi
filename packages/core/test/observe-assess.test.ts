import { describe, it, expect } from 'vitest';
import { assessRunView } from '../src/observe/assess.js';
import type { RunView, RunViewNode, ArtifactRef } from '../src/observe/runView.js';

// ── builders: a MINIMAL-but-valid RunView / node, overridable on the rubric-relevant fields only ───────
// Field semantics are source-verified against buildRunView (runView.ts): node.status is the RAW record
// status (NOT re-derived), and artifacts[].exists/bytes come from the runner's host-stat record. The rubric
// therefore treats artifact existence + run-level ok/totals as the load-bearing (self-report-independent)
// signals, and node.status as secondary.
function mkNode(over: Partial<RunViewNode> & { id: string }): RunViewNode {
  return {
    label: over.id, phase: null, status: 'ok',
    toolCalls: 0, toolBreakdown: {}, timeline: [], reads: [], scopes: [], writes: [],
    artifacts: [], bash: [], retries: 0, stopReason: null, truncated: false,
    thinkingChars: 0, modelCalls: 0, maxToolRepeat: 0, repeatedTool: null,
    ...over,
  };
}
function art(over: Partial<ArtifactRef> = {}): ArtifactRef {
  return { path: '/run/greeting.txt', displayPath: 'greeting.txt', exists: true, bytes: 12, ...over };
}
function mkView(over: Partial<RunView> = {}): RunView {
  return {
    run: 'greet-0001', sandbox: 'local', done: true, ok: true,
    totals: { nodes: 1, ok: 1, failed: 0 },
    stages: [], edges: [],
    nodes: [mkNode({ id: 'greet', status: 'ok', artifacts: [art()] })],
    ...over,
  };
}

describe('assessRunView — the falsifiable full-run rubric', () => {
  it('PASSES a genuine success (real sandbox, node ok, declared artifact present + non-empty)', () => {
    const r = assessRunView(mkView());
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('FAILS the Railway shape: node blocked, declared artifact absent, run not ok (the false-green)', () => {
    const r = assessRunView(mkView({
      ok: false, totals: { nodes: 1, ok: 0, failed: 1 },
      nodes: [mkNode({ id: 'greet', status: 'blocked', artifacts: [art({ exists: false, bytes: 0 })] })],
    }));
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/greet/);
  });

  it('FAILS when EVERYTHING self-reports success but the artifact is absent (the artifact probe is the sole catch)', () => {
    // The scariest case: buildRunView passes rec.status through un-derived, so status is a RAW "ok"; run.ok
    // and totals also look clean. The ONLY signal that the work didn't happen is the file not being on disk.
    // This isolates the load-bearing artifact-existence probe — the exact reward-hack the old smoke was blind to.
    const r = assessRunView(mkView({
      ok: true, totals: { nodes: 1, ok: 1, failed: 0 },
      nodes: [mkNode({ id: 'greet', status: 'ok', artifacts: [art({ exists: false })] })],
    }));
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/node 'greet' artifact 'greeting\.txt' is missing/);
  });

  it('FAILS an inmemory sandbox even if everything else looks green (N-inmemory: it proved nothing)', () => {
    const r = assessRunView(mkView({ sandbox: 'inmemory' }));
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/inmemory/);
  });

  it('FAILS when the sandbox backend is unknown (cannot prove a real sandbox executed)', () => {
    const r = assessRunView(mkView({ sandbox: undefined }));
    expect(r.pass).toBe(false);
  });

  it('FAILS when the run never reached done', () => {
    expect(assessRunView(mkView({ done: false })).pass).toBe(false);
  });

  it('FAILS when totals report a failed node even if the listed node looks ok', () => {
    const r = assessRunView(mkView({ totals: { nodes: 2, ok: 1, failed: 1 } }));
    expect(r.pass).toBe(false);
  });

  it('FAILS a declared-but-empty (0-byte) artifact (silent empty write)', () => {
    const r = assessRunView(mkView({
      nodes: [mkNode({ id: 'greet', status: 'ok', artifacts: [art({ bytes: 0 })] })],
    }));
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/empty|0 ?byte/i);
  });

  it('FAILS a node that declared no artifacts at all (nothing to verify)', () => {
    const r = assessRunView(mkView({ nodes: [mkNode({ id: 'greet', status: 'ok', artifacts: [] })] }));
    expect(r.pass).toBe(false);
  });

  it('FAILS when an EXPECTED node is absent from the run-view', () => {
    const r = assessRunView(mkView({ nodes: [] }), { expectNodes: ['greet'] });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/greet/);
  });

  it('honours a caller-supplied non-inmemory forbid set (e.g. also forbid "local" for a cloud-only assert)', () => {
    const r = assessRunView(mkView({ sandbox: 'local' }), { forbidSandbox: ['inmemory', 'local'] });
    expect(r.pass).toBe(false);
    expect(r.failures.join(' ')).toMatch(/local/);
  });
});
