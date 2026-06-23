import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile } from '../src/index.js';
import type { NodeIntent, WorkflowSpec } from '../src/index.js';
import { runWorkflow } from '../src/runner/index.js';

// A node factory (mirrors runner.test): reads/produces; artifacts default to produces.
function n(label: string, reads: string[], produces: string[], over: Partial<NodeIntent> = {}): NodeIntent {
  return {
    label,
    prompt: `do ${label}`,
    tools: {},
    io: { reads, produces, artifacts: produces.map((p) => ({ path: p })) },
    ...over,
  };
}
const wf = (nodes: NodeIntent[]): WorkflowSpec => ({ meta: { name: 't', description: 'd' }, nodes });
const tmpOut = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'piflow-retproto-'));

/**
 * A builder that WRITES each declared artifact but emits NO return-protocol block. So an artifact-backed
 * node is `ok` under the default (artifact ⇒ optional handshake), but a run-level `returnProtocol:
 * 'required'` must FLIP it to require the (here-absent) fence → `error`.
 */
function artifactOnlyBuilder() {
  return (node: { id: string; io: { artifacts: { path: string }[] }; sandbox: { output: string } }): string => {
    const writes = node.io.artifacts
      .map((a) => {
        const dest = `${node.sandbox.output}/${a.path}`;
        const dir = dest.includes('/') ? dest.slice(0, dest.lastIndexOf('/')) : '.';
        return `mkdir -p ${dir} && printf '%s' ${node.id} > ${dest}`;
      })
      .join(' && ');
    return writes || 'true'; // NO return block emitted
  };
}

describe('RunOptions.returnProtocol — the run-level write-then-fence default (U8)', () => {
  it('default (unset) — an artifact-backed node WITHOUT a return fence is OK (artifact ⇒ optional)', async () => {
    const g = compile(wf([n('Solo', [], ['s.txt'])]));
    const outDir = await tmpOut();
    const { status } = await runWorkflow(g, { run: 'rp-default', outDir, buildCommand: artifactOnlyBuilder() });
    expect(status.nodes.solo.status).toBe('ok');
    expect(status.nodes.solo.returnMode).toBe('optional');
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it("returnProtocol:'required' — flips the SAME node to require the (absent) fence → error", async () => {
    const g = compile(wf([n('Solo', [], ['s.txt'])]));
    const outDir = await tmpOut();
    const { status } = await runWorkflow(g, {
      run: 'rp-required',
      outDir,
      buildCommand: artifactOnlyBuilder(),
      returnProtocol: 'required',
    });
    expect(status.nodes.solo.returnMode).toBe('required'); // the run default flowed into the run path
    expect(status.nodes.solo.status).toBe('error');
    expect(status.nodes.solo.issues.join(' ')).toMatch(/no return-protocol block/i);
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it('per-node returnMode WINS over the run-level returnProtocol (explicit override)', async () => {
    // node explicitly opts OUT of the handshake; the run default says required — the node's choice wins.
    const g = compile(wf([n('Solo', [], ['s.txt'], { io: { reads: [], produces: ['s.txt'], artifacts: [{ path: 's.txt' }], returnMode: 'optional' } })]));
    const outDir = await tmpOut();
    const { status } = await runWorkflow(g, {
      run: 'rp-override',
      outDir,
      buildCommand: artifactOnlyBuilder(),
      returnProtocol: 'required',
    });
    expect(status.nodes.solo.returnMode).toBe('optional'); // per-node override beats the run default
    expect(status.nodes.solo.status).toBe('ok');
    await fs.rm(outDir, { recursive: true, force: true });
  });
});
