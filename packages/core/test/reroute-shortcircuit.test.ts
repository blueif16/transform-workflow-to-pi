// (M3 · G12 · #17) The bounded-reroute SHORT-CIRCUIT: when attempt 1 PASSES (the verify node's canonical
// artifact is produced), the cloned re-entry bodies (`produce__r2`/`verify__r2`) MUST NOT spawn — the
// zero-pi existence-gate preflight stat()s the canonical artifact and skips the whole re-entry slice.
//
// The DISCRIMINATING gate (test-discipline (d)): a call-count of 0 on the injected `buildCommand` for the
// CLONED ids — a spy on the NEGATIVE. Asserting only "the run finishes ok" would pass VACUOUSLY even if the
// clones also ran; the call-count proves the bodies provably did not execute. Fails today (no expandReroute,
// no preflight short-circuit) — every pending clone would spawn.
//
// Runs offline through `runWorkflow` with a stub `buildCommand` (writes declared artifacts, never `pi`).

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile } from '../src/index.js';
import { expandReroute } from '../src/workflow/reroute/expand.js';
import { runWorkflow } from '../src/runner/index.js';
import type { NodeIntent, WorkflowSpec } from '../src/types.js';

async function tmpOut(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'piflow-reroute-'));
}

/**
 * A stub command builder that, for every node it is asked to build, RECORDS the node id (the spy on the
 * negative) and returns a shell command writing each declared artifact into the node's sandbox output dir.
 * A node whose body never spawns is never passed to this builder ⇒ its id never appears in `built`.
 */
function spyBuilder(built: string[]) {
  return (node: { id: string; io: { artifacts: { path: string }[] }; sandbox: { output: string } }): string => {
    built.push(node.id);
    const writes = node.io.artifacts
      .map((a) => {
        const dest = `${node.sandbox.output}/${a.path}`;
        const dir = dest.includes('/') ? dest.slice(0, dest.lastIndexOf('/')) : '.';
        return `mkdir -p ${dir} && printf '%s' ${node.id} > ${dest}`;
      })
      .join(' && ');
    const ret = `printf '%s' '\`\`\`json\\n{"status":"ok"}\\n\`\`\`'`;
    return writes ? `${writes} && ${ret}` : ret;
  };
}

/** produce → verify (with a bounded reroute back to produce) → publish. */
function specWith(reroute: NodeIntent['reroute']): WorkflowSpec {
  const produce: NodeIntent = {
    label: 'produce',
    prompt: 'PRODUCE the draft.',
    tools: {},
    io: { reads: [], produces: ['work/draft.md'], artifacts: [{ path: 'work/draft.md' }] },
  };
  const verify: NodeIntent = {
    label: 'verify',
    prompt: 'VERIFY the draft.',
    tools: {},
    io: { reads: ['work/draft.md'], produces: ['verify/report.json'], artifacts: [{ path: 'verify/report.json' }] },
    reroute,
  };
  const publish: NodeIntent = {
    label: 'publish',
    prompt: 'PUBLISH it.',
    tools: {},
    io: { reads: ['verify/report.json'], produces: ['out/final.md'], artifacts: [{ path: 'out/final.md' }] },
  };
  return { meta: { name: 't', description: 'd' }, nodes: [produce, verify, publish] };
}

describe('expandReroute — attempt-1 PASS short-circuits the cloned re-entry (#17)', () => {
  it('attempt-1 PASS ⇒ the cloned r2 body nodes NEVER spawn (call-count 0 on buildCommand)', async () => {
    const out = expandReroute(specWith({ onFail: 'produce', max: 2 }));
    const wf = compile(out);
    const outDir = await tmpOut();

    // PREMISE (so the call-count-0 below is NOT vacuous): the unroll really PRODUCED the cloned bodies in
    // the DAG. Without this, a short-circuit test on a no-op transform would pass trivially (no clones to spawn).
    expect(wf.nodes['produce-r2']).toBeDefined();
    expect(wf.nodes['verify-r2']).toBeDefined();

    const built: string[] = [];
    // The stub writes every node's declared artifacts ⇒ attempt-1 `verify` PASSES (its canonical artifact
    // exists), so the re-entry must be short-circuited.
    const { status } = await runWorkflow(wf, { run: 'sc', outDir, buildCommand: spyBuilder(built) });

    // The run completes OK (attempt 1 was good).
    expect(status.ok).toBe(true);
    // attempt-1 bodies DID spawn.
    expect(built).toContain('produce');
    expect(built).toContain('verify');
    // THE DISCRIMINATING ASSERTION: the cloned re-entry bodies — though PRESENT in the DAG — NEVER reached
    // the command builder (call-count 0). A short-circuit that didn't fire would let them spawn ⇒ RED.
    expect(built.filter((id) => id === 'produce-r2')).toHaveLength(0);
    expect(built.filter((id) => id === 'verify-r2')).toHaveLength(0);
    // and the cloned bodies are recorded as skipped/reused, not run.
    expect(status.nodes['produce-r2']?.status).not.toBe('ok');
    expect(status.nodes['verify-r2']?.status).not.toBe('ok');
  });
});
