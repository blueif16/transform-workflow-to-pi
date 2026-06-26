// (M5 · G13) op-lowering — the GRAMMAR-UNIFICATION red bar. An OLD-grammar node (the game-omni shape:
// `inject` + `hooks.seed` + `checks.pre/post` + `policy`) and the equivalent node authored DIRECTLY in the
// new `op[]` envelope must compile to the IDENTICAL `NodeSpec.op[]`. This is the load-bearing additivity
// proof: every deprecated alias LOWERS at the loader into one canonical envelope, so an existing template
// and its op[] rewrite are byte-identical at the dense spec.
//
// Written test-first against the absent lowering: today `loadTemplate` never builds `op[]` (the field is
// undefined on the compiled NodeSpec) AND the node schema rejects a top-level `op` key, so BOTH halves go
// RED for the right reason (behavior missing — no lowering, no op-authoring) — not an import error.

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTemplate, compile } from '../src/index.js';
import type { OpSpec } from '../src/types.js';

const writeJson = (p: string, v: unknown): Promise<void> => fs.writeFile(p, JSON.stringify(v, null, 2) + '\n');

/** Stand up a one-node template in a fresh tmp dir from the given node.json def + prose. */
async function templateWith(def: Record<string, unknown>, prose = 'do the thing'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-oplower-'));
  await writeJson(path.join(dir, 'meta.json'), { id: 't', name: 't', description: 'd', phases: ['build'] });
  const ndir = path.join(dir, 'nodes', String(def.id));
  await fs.mkdir(ndir, { recursive: true });
  await writeJson(path.join(ndir, 'node.json'), def);
  await fs.writeFile(path.join(ndir, 'prompt.md'), prose);
  return dir;
}

/** Compile a template dir → the single node's dense NodeSpec. */
async function compileOne(dir: string, id: string) {
  const wf = compile(await loadTemplate(dir));
  return wf.nodes[id];
}

/** Sort an op[] by (when, body-key, id) so the comparison is order-insensitive across the two authorings. */
const bodyKey = (o: OpSpec): string => (o.transform ? 'transform' : o.run ? 'run' : o.gate ? 'gate' : o.action ? 'action' : 'none');
const sortOps = (ops: OpSpec[] | undefined): OpSpec[] =>
  [...(ops ?? [])].sort((a, b) => `${a.when}|${bodyKey(a)}|${JSON.stringify(a)}`.localeCompare(`${b.when}|${bodyKey(b)}|${JSON.stringify(b)}`));

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop()!, { recursive: true, force: true });
});

describe('op-lowering — the deprecated grammars lower to ONE canonical op[]', () => {
  it('an OLD-grammar node and its op[] rewrite compile to the IDENTICAL NodeSpec.op[]', async () => {
    // The OLD grammar (deprecated aliases): a pre-injected read, a seed, a pre-check + a post-check, a policy.
    const oldDef = {
      id: 'verify',
      phase: 'build',
      deps: [],
      prompt: { file: 'prompt.md' },
      inject: ['{{RUN}}/spec/request.json'],
      contract: { artifacts: ['out/report.json'], owns: ['out/**'], readScope: ['{{RUN}}'] },
      checks: {
        pre: [{ kind: 'json-parses', path: 'spec/request.json' }],
        post: [{ kind: 'field-present', path: 'out/report.json', param: 'status' }],
      },
      policy: { fail: 'block' },
      hooks: { seed: [{ to: 'spec/seed.json', from: '{{WORKSPACE}}/seed.json' }] },
    };

    // The SAME node authored DIRECTLY in the new envelope (the migration table, design §2.2).
    const newDef = {
      id: 'verify',
      phase: 'build',
      deps: [],
      prompt: { file: 'prompt.md' },
      contract: { artifacts: ['out/report.json'], owns: ['out/**'], readScope: ['{{RUN}}'] },
      op: [
        { when: 'pre', reads: ['{{RUN}}/spec/request.json'] },
        { when: 'pre', writes: ['spec/seed.json'], transform: { kind: 'seed', from: '{{WORKSPACE}}/seed.json' } },
        { when: 'pre', gate: { kind: 'json-parses', path: 'spec/request.json' }, onFailure: 'block' },
        { when: 'post', gate: { kind: 'field-present', path: 'out/report.json', param: 'status' }, onFailure: 'block' },
      ],
    };

    // The canonical envelope the OLD grammar must LOWER to (the migration table, design §2.2).
    const expected: OpSpec[] = [
      { when: 'pre', reads: ['{{RUN}}/spec/request.json'] },
      { when: 'pre', writes: ['spec/seed.json'], transform: { kind: 'seed', from: '{{WORKSPACE}}/seed.json' } },
      { when: 'pre', gate: { kind: 'json-parses', path: 'spec/request.json' }, onFailure: 'block' },
      { when: 'post', gate: { kind: 'field-present', path: 'out/report.json', param: 'status' }, onFailure: 'block' },
    ];

    const oldDir = await templateWith(oldDef);
    dirs.push(oldDir);
    const oldNode = await compileOne(oldDir, 'verify');

    // THE LOAD-BEARING ASSERTION (RED today: oldNode.op is undefined — the loader never lowers the aliases).
    expect(oldNode.op, 'OLD grammar must LOWER into op[]').toBeDefined();
    expect(sortOps(oldNode.op)).toEqual(sortOps(expected));

    // And the SAME node authored DIRECTLY in the new envelope produces the identical compiled op[].
    const newDir = await templateWith(newDef);
    dirs.push(newDir);
    const newNode = await compileOne(newDir, 'verify');
    expect(newNode.op, 'a directly-authored op[] must survive to the dense NodeSpec').toBeDefined();
    expect(sortOps(newNode.op)).toEqual(sortOps(oldNode.op));
  });
});
