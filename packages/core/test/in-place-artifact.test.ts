import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile, LocalSandboxProvider } from '../src/index.js';
import type { NodeIntent, WorkflowSpec } from '../src/index.js';
import { runWorkflow, effectiveSandboxLocation } from '../src/runner/index.js';

// REGRESSION: an in-place `local` node writes its deliverable RELATIVE (as a real agent does), and the
// contract checks / downstream injects look for it under {{RUN}} (= outDir). Before the fix the node's
// working dir was the compile default `workspace: '.'` (resolved to the LAUNCH cwd), so the artifact
// landed beside wherever piflowctl was started — NOT the run dir — and the node blocked "artifact
// missing". The robust contract: IN_PLACE providers run IN the run dir (cwd = outDir), so a relative
// write lands at {{RUN}}/<artifact> and the guarded-identity download is a true no-op.

function n(label: string, reads: string[], produces: string[], over: Partial<NodeIntent> = {}): NodeIntent {
  return { label, prompt: `do ${label}`, tools: {}, io: { reads, produces, artifacts: produces.map((p) => ({ path: p })) }, ...over };
}
const wf = (nodes: NodeIntent[]): WorkflowSpec => ({ meta: { name: 't', description: 'd' }, nodes });

/** A builder that writes each declared artifact at its RELATIVE path (no `output/` prefix) — i.e. relative
 *  to the node's working directory, exactly how a real `pi` agent writes `findings/survey.md`. */
function relativeWriteBuilder() {
  return (node: { id: string; io: { artifacts: { path: string }[] } }): string => {
    const writes = node.io.artifacts
      .map((a) => {
        const p = a.path;
        const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.';
        return `mkdir -p ${dir} && printf '%s' ${node.id} > ${p}`;
      })
      .join(' && ');
    const ret = `printf '%s' '\`\`\`json\\n{"status":"ok"}\\n\`\`\`'`;
    return `${writes} && ${ret}`;
  };
}

describe('effectiveSandboxLocation — in-place anchors to the run dir', () => {
  it('IN-PLACE (local) ⇒ workdir = outDir, output = "." (the run dir IS the workspace)', () => {
    expect(effectiveSandboxLocation('local', '/run/abc', { workspace: '.', output: 'out/x' })).toEqual({
      workdir: '/run/abc',
      outputDir: '.',
    });
  });
  it('ISOLATED (inmemory) ⇒ keeps the throwaway workspace + out/<id> (collected back)', () => {
    expect(effectiveSandboxLocation('inmemory', '/run/abc', { workspace: '.', output: 'out/x' })).toEqual({
      workdir: '.',
      outputDir: 'out/x',
    });
  });
});

describe('in-place local — a relative artifact write lands under the run dir', () => {
  const prevCwd = process.cwd();
  afterEach(() => process.chdir(prevCwd));

  it('writes findings/survey.md-style relative artifact into outDir, not the launch cwd', async () => {
    const g = compile(wf([n('Solo', [], ['result/out.txt'])]));
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-run-'));
    // A LAUNCH cwd distinct from the run dir — the pre-fix bug dumps the artifact HERE.
    const launchCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-cwd-'));
    process.chdir(launchCwd);

    const { status } = await runWorkflow(g, {
      run: 'inplace',
      outDir,
      provider: new LocalSandboxProvider({ enforceReadScope: false }),
      buildCommand: relativeWriteBuilder(),
    });

    // The deliverable must live under the RUN dir (where the contract checks it + the next node injects it)…
    expect(existsSync(path.join(outDir, 'result/out.txt'))).toBe(true);
    // …and must NOT have leaked beside the launch cwd.
    expect(existsSync(path.join(launchCwd, 'result/out.txt'))).toBe(false);
    expect(status.status).not.toBe('failed');
  });
});
