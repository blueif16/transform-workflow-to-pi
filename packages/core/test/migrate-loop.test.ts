import { describe, it, expect } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile } from '../src/index.js';
import type { NodeIntent, WorkflowSpec } from '../src/index.js';
import { runWorkflow } from '../src/runner/index.js';
import { packRunDir, unpackRunDir } from '../src/runner/migrate.js';
import { loadJournal } from '../src/runner/journal.js';
import { readLease } from '../src/runner/lease.js';

// ── harness (mirrors runner.test.ts / freeze-resume.test.ts) ─────────────────────────────────────────
function n(label: string, reads: string[], produces: string[]): NodeIntent {
  return { label, prompt: `do ${label}`, tools: {}, io: { reads, produces, artifacts: produces.map((p) => ({ path: p })) } };
}
const wf = (nodes: NodeIntent[]): WorkflowSpec => ({ meta: { name: 'migrate-t', description: 'd' }, nodes });
async function tmpOut(tag: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `piflow-migrate-${tag}-`));
}
function stubBuilder() {
  return (node: { id: string; io: { artifacts: { path: string }[] }; sandbox: { output: string } }): string => {
    const writes = node.io.artifacts
      .map((a) => `mkdir -p ${node.sandbox.output} && printf '%s' ${node.id} > ${node.sandbox.output}/${a.path}`)
      .join(' && ');
    return `${writes} && printf '%s' '\`\`\`json\\n{"status":"ok"}\\n\`\`\`'`;
  };
}
// A → B → C : three topological stages, so a freeze after stage 1 leaves REAL remaining work (B, C).
const threeStage = () => compile(wf([n('A', [], ['a.txt']), n('B', ['a.txt'], ['b.txt']), n('C', ['b.txt'], ['c.txt'])]));

// P6 — the FULL migrate mechanism at the core level (minus the HTTP transport): a run frozen on ONE host
// is bundled, reloaded on a DIFFERENT host's run-dir, and resumes there via the journal without re-running
// completed work or double-writing. This is exactly what `context migrate` orchestrates over the wire.
describe('mid-run migration loop: freeze → bundle → adopt-elsewhere → resume', () => {
  it('carries the run to a fresh run-dir and finishes it: done node REUSED, remaining nodes RUN, lease clean', async () => {
    // 1) SOURCE host — run with the REAL default lease, freeze after the first stage.
    const src = await tmpOut('src');
    const frozen = await runWorkflow(threeStage(), {
      run: 'migrating-pie',
      outDir: src,
      buildCommand: stubBuilder() as never,
      freezeSignal: () => true, // park at the first node boundary
    });
    expect(frozen.status.frozen).toBe(true);
    expect(frozen.status.nodes['a'].status).toBe('ok');
    expect(frozen.status.nodes['b'].status).toBe('pending');
    expect(frozen.status.nodes['c'].status).toBe('pending');
    // The source lease was RELEASED on freeze (so the target can take over) — no lingering run.lock.
    expect(await readLease(src)).toBeNull();

    // 2) BUNDLE the frozen run-dir (what GET /migrate/<run>/bundle ships) and UNPACK onto a DIFFERENT host.
    const bundle = await packRunDir(src);
    const dst = await tmpOut('dst');
    await unpackRunDir(bundle, dst);
    // The completed artifact + the journal traveled; the host-local sentinels did NOT.
    expect(existsSync(path.join(dst, 'a.txt'))).toBe(true);
    expect((await loadJournal(dst))?.nodes['a']).toBeTruthy();
    expect(existsSync(path.join(dst, '.pi', 'run.lock'))).toBe(false);
    expect(existsSync(path.join(dst, '.pi', 'freeze'))).toBe(false);

    // 3) TARGET host — resume from the reloaded run-dir (same run id, real lease, no freeze). Journal drives
    // reuse of A; B and C run to completion.
    const resumed = await runWorkflow(threeStage(), {
      run: 'migrating-pie',
      outDir: dst,
      buildCommand: stubBuilder() as never,
      freezeSignal: () => false,
    });
    expect(resumed.status.done).toBe(true);
    expect(resumed.status.ok).toBe(true);
    expect(resumed.status.frozen).toBeFalsy();
    expect(resumed.status.nodes['a'].status).toBe('reused'); // proven-unchanged upstream ⇒ never re-ran
    expect(resumed.status.nodes['b'].status).toBe('ok');
    expect(resumed.status.nodes['c'].status).toBe('ok');
    expect(existsSync(path.join(dst, 'c.txt'))).toBe(true);
    // Target lease released cleanly after completion.
    expect(await readLease(dst)).toBeNull();
  });
});
