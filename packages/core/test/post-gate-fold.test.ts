// (A-fix) post-gate fold — a node authored DIRECTLY in `op[]` expresses a post-check as a `{when:'post',gate}`
// op. The runner's gate reader fires only PRE gates, and io.checks (THE post-check engine) was populated only
// from the deprecated `checks` alias — so a direct-op[] post-gate was a DEAD representation: it passed
// `extract` but was NEVER enforced. The loader now folds those post-gates (from the AUTHORED `def.op`) into
// io.checks via `collectChecks`. This is genuine NEW behavior; the no-double-count case guards the additive
// invariant for hooks-authored nodes (whose `def.op` is absent).

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTemplate } from '../src/index.js';

const writeJson = (p: string, v: unknown): Promise<void> => fs.writeFile(p, JSON.stringify(v, null, 2) + '\n');

async function templateWith(def: Record<string, unknown>, prose: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-postgate-'));
  await writeJson(path.join(dir, 'meta.json'), { id: 't', name: 't', description: 'd', phases: ['build'] });
  const ndir = path.join(dir, 'nodes', String(def.id));
  await fs.mkdir(ndir, { recursive: true });
  await writeJson(path.join(ndir, 'node.json'), def);
  await fs.writeFile(path.join(ndir, 'prompt.md'), prose);
  return dir;
}

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop()!, { recursive: true, force: true });
});

const base = {
  id: 'w0',
  phase: 'build',
  deps: [] as string[],
  prompt: { file: 'prompt.md' },
  contract: { artifacts: ['out.json'], owns: ['out.json'], readScope: ['{{RUN}}'] },
};

describe('post-gate fold — a direct op[] post-gate is enforced via io.checks (A-fix)', () => {
  it("a node authoring {when:'post',gate} in op[] gets that gate in io.checks", async () => {
    // RED pre-fix: collectChecks read only def.checks, so io.checks is empty and the post-gate never runs.
    const dir = await templateWith(
      { ...base, op: [{ when: 'post', gate: { kind: 'non-empty', path: 'out.json' } }] },
      'produce out.json',
    );
    dirs.push(dir);

    const spec = await loadTemplate(dir);
    const node = spec.nodes.find((n) => n.label === 'w0')!;
    expect(node.io.checks ?? [], 'the direct op[] post-gate folds into io.checks').toContainEqual(
      expect.objectContaining({ kind: 'non-empty', path: 'out.json' }),
    );
  });

  it("a direct op[] PRE-gate is NOT folded into io.checks (it runs via the pre-gate reader, not the post engine)", async () => {
    const dir = await templateWith(
      { ...base, op: [{ when: 'pre', reads: ['in.json'], gate: { kind: 'json-parses', path: 'in.json' } }] },
      'consume in.json',
    );
    dirs.push(dir);

    const spec = await loadTemplate(dir);
    const node = spec.nodes.find((n) => n.label === 'w0')!;
    // A pre-gate must not leak into the POST engine (else it double-runs / runs at the wrong phase).
    expect((node.io.checks ?? []).some((c) => c.kind === 'json-parses')).toBe(false);
  });

  it('a HOOKS-authored checks.post is NOT doubled by the fold (def.op absent ⇒ no addition)', async () => {
    const dir = await templateWith(
      { ...base, checks: { post: [{ kind: 'non-empty', path: 'out.json' }] } },
      'produce out.json',
    );
    dirs.push(dir);

    const spec = await loadTemplate(dir);
    const node = spec.nodes.find((n) => n.label === 'w0')!;
    const hits = (node.io.checks ?? []).filter((c) => c.kind === 'non-empty' && c.path === 'out.json');
    expect(hits, 'hooks checks.post appears exactly once — the op[] fold adds nothing for a hooks node').toHaveLength(1);
  });
});
