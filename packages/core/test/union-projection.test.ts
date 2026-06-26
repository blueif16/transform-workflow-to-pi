// (M6 · #12) UNION PROJECTION through the NEW op[] envelope — the built-but-dropped calling path.
//
// `applyProjectionOp`'s `union` kind (project.ts:184) is fully built and unit-tested (ops-project.test.ts),
// and `runProjection` reaches it for a node authored in the LEGACY `hooks.registryProject` grammar. But a
// node authored in the unified `op[]` grammar — `op:[{ transform:{ kind:'projectRegistry', … } }]` — has NO
// `node.ops.registryProject` (the loader lowers `hooks` INTO `op[]`, it does not round-trip back), so the
// runtime dispatch at runner.ts:1187 (which reads ONLY `node.ops?.registryProject`) NEVER fires for it. The
// union projection is silently DROPPED — `index.json` is never written (#12's blank-sprite failure).
//
// This gate authors the projectRegistry on the op[] envelope ONLY (no `ops` block) and asserts the deduped
// `index.json` lands on disk. It FAILS today because the op[] transform is never dispatched; it goes GREEN
// once the runner dispatches `op[].transform.kind === 'projectRegistry'` (and project/merge) at runtime.
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile } from '../src/index.js';
import type { NodeIntent, WorkflowSpec } from '../src/index.js';
import { runWorkflow } from '../src/runner/index.js';

let outDir: string | undefined;
afterEach(async () => {
  if (outDir) await fs.rm(outDir, { recursive: true, force: true });
  outDir = undefined;
});

const wf = (nodes: NodeIntent[]): WorkflowSpec => ({ meta: { name: 't', description: 'd' }, nodes });
const readJson = async (p: string): Promise<unknown> => JSON.parse(await fs.readFile(p, 'utf8'));

/** Write exact file bytes into the node's sandbox output dir, then a return fence (the S4 builder shape). */
function filesBuilder(files: (id: string) => Record<string, string>) {
  return (node: { id: string; sandbox: { output: string } }): string => {
    const out = node.sandbox.output;
    const writes = Object.entries(files(node.id))
      .map(([p, c]) => {
        const dest = `${out}/${p}`;
        const dir = dest.slice(0, dest.lastIndexOf('/'));
        return `mkdir -p ${dir} && printf '%s' '${c}' > ${dest}`;
      })
      .join(' && ');
    return `${writes} && printf '%s' '\`\`\`json\\n{"status":"ok"}\\n\`\`\`'`;
  };
}

describe('runWorkflow — projectRegistry union through the op[] envelope (#12)', () => {
  it('a 2-source projectRegistry union (authored in op[]) yields the deduped index.json', async () => {
    // The node authors a frozen blueprint + the genres registry, then a projectRegistry op (op[] grammar,
    // NO legacy `ops` block) whose `demo` record runs a `union` over TWO refs with one cross-ref duplicate.
    const node: NodeIntent = {
      label: 'Index',
      prompt: 'author the blueprint + registry',
      tools: {},
      io: {
        reads: [],
        produces: ['bp.json', 'genres.json'],
        artifacts: [{ path: 'bp.json' }, { path: 'genres.json' }],
      },
      // op[] envelope ONLY — the projectRegistry transform must be dispatched at runtime to write index.json.
      op: [
        {
          when: 'post',
          writes: ['index.json'],
          transform: { kind: 'projectRegistry', source: 'bp.json', mapRef: 'genres.json', key: 'demo' },
        },
      ],
    };

    outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-union-'));
    const ASSET_UNION = {
      key: 'slot',
      path: { byField: 'type', dir: { sprite: 'sprites' }, defaultDir: 'sprites', defaultExt: 'png' },
      defaults: { width: 32, height: 32 },
      carry: ['type', 'width', 'height', 'description'],
      row: { status: 'pending' },
      envelope: { archetype: 'meta.archetype' },
      itemsKey: 'slots',
    };
    const bp = {
      meta: { archetype: 'demo' },
      assetList: [{ slot: 'hero', type: 'sprite', width: 10, height: 20, description: 'the hero' }],
      entities: [{ assetSlot: 'hero' }, { assetSlot: 'coin', type: 'sprite' }], // hero dup ⇒ dedup; coin new
    };
    const genres = {
      genres: [
        {
          id: 'demo',
          projections: { index: { to: 'index.json', union: { ...ASSET_UNION, from: ['assetList', 'entities[].assetSlot'] } } },
        },
      ],
    };

    const { status } = await runWorkflow(compile(wf([node])), {
      run: 'union',
      outDir,
      buildCommand: filesBuilder(() => ({
        'bp.json': JSON.stringify(bp).replace(/'/g, ''),
        'genres.json': JSON.stringify(genres).replace(/'/g, ''),
      })),
    });

    expect(status.nodes.index.status).toBe('ok');
    // The union landed on disk: hero deduped (appears ONCE), coin defaulted, envelope carried.
    const out = (await readJson(path.join(outDir, 'index.json'))) as {
      archetype: string;
      slots: { slot: string }[];
    };
    expect(out.archetype).toBe('demo');
    expect(out.slots.map((s) => s.slot)).toEqual(['hero', 'coin']); // deduped — hero not counted twice
  });
});
