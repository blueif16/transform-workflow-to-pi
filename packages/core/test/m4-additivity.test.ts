import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile } from '../src/index.js';
import type { NodeIntent, WorkflowSpec, NodeSpec } from '../src/index.js';
import { runWorkflow } from '../src/runner/index.js';

// ── M4 ADDITIVITY — a node declaring NONE of the new fields (retry/escalate/maxRepairAttempts) runs ──
// BYTE-IDENTICALLY: `io.retries` is read through `legacyRetry(io.retries)` so it reproduces today's exact
// semantics (a transient error/blocked retries up to N; a node with NO retries runs once and the failed
// record stands). This pins the additivity claim — if the M4 runtime ever changes the legacy retry
// behavior, this RED-bars. Deterministic, no live pi.

function n(label: string, reads: string[], produces: string[], over: Partial<NodeIntent> = {}): NodeIntent {
  return { label, prompt: `do ${label}`, tools: {}, io: { reads, produces, artifacts: produces.map((p) => ({ path: p })) }, ...over };
}
const wf = (nodes: NodeIntent[]): WorkflowSpec => ({ meta: { name: 't', description: 'd' }, nodes });
const tmpOut = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'piflow-m4add-'));

describe('M4 additivity — legacyRetry(io.retries) reproduces today exactly', () => {
  it('io.retries:2 — a node that fails-twice-then-succeeds recovers in ≤3 attempts (today behavior)', async () => {
    // Classic legacy retry: a transient blocked (no artifact) on calls 1-2, success on call 3.
    const node = n('Flaky', [], ['out.txt'], {
      io: { reads: [], produces: ['out.txt'], artifacts: [{ path: 'out.txt' }], retries: 2 },
    });
    const g = compile(wf([node]));
    const outDir = await tmpOut();
    let call = 0;
    const builder = (nodeSpec: NodeSpec & { sandbox: { output: string } }): string => {
      call++;
      const out = nodeSpec.sandbox.output;
      if (call < 3) return 'true'; // attempts 1-2: produce nothing → blocked
      return `mkdir -p ${out} && printf '%s' done > ${out}/out.txt`; // attempt 3: success
    };
    const { status } = await runWorkflow(g, { run: 'leg-retry', outDir, buildCommand: builder as never });
    expect(status.nodes.flaky.status).toBe('ok');
    expect(call).toBe(3); // 1 + retries(2) — the legacy budget, unchanged
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it('NO new fields, NO retries — a clean node runs ONCE and ends ok (record unchanged)', async () => {
    const node = n('Plain', [], ['p.txt']);
    const g = compile(wf([node]));
    const outDir = await tmpOut();
    let call = 0;
    const builder = (nodeSpec: NodeSpec & { sandbox: { output: string } }): string => {
      call++;
      const out = nodeSpec.sandbox.output;
      return `mkdir -p ${out} && printf '%s' done > ${out}/p.txt`;
    };
    const { status } = await runWorkflow(g, { run: 'plain', outDir, buildCommand: builder as never });
    expect(status.nodes.plain.status).toBe('ok');
    expect(call).toBe(1); // one attempt, no repair/escalate fields ⇒ no extra exec
    expect(status.nodes.plain.repairAttempts).toBeUndefined();
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it('io.retries:0, a permanent blocked — runs ONCE, no escalation (the failed record stands)', async () => {
    const node = n('Stuck', [], ['x.txt']); // no retries, no escalate ⇒ one attempt
    const g = compile(wf([node]));
    const outDir = await tmpOut();
    let call = 0;
    const builder = (): string => { call++; return 'true'; }; // never writes the artifact → blocked
    const { status } = await runWorkflow(g, { run: 'stuck', outDir, buildCommand: builder as never });
    expect(status.nodes.stuck.status).toBe('blocked');
    expect(call).toBe(1); // no retry, no escalate — exactly one attempt (today's behavior)
    await fs.rm(outDir, { recursive: true, force: true });
  });
});
