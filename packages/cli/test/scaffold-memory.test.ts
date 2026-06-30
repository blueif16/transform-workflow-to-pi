import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTemplate } from '@piflow/core';
import { scaffoldNew, scaffoldAddNode, scaffoldMemory } from '../src/scaffold.js';

// The scaffolder is the THIN ACCESSOR over @piflow/core's memory layer: `new` seeds the template's system
// memory.md; `add-node` seeds each node's memory.md (Leg A) + code-map.md (Leg B); `scaffoldMemory` backfills
// a whole template. Every seed is CREATE-IF-ABSENT, the same discipline already applied to prompt.md. The
// load-bearing guards here (real RED, not theater): (1) re-scaffolding overwrites node.json but NEVER the
// curated memory/code-map; (2) the sidecars are invisible to the §8 compile gate — loadTemplate still compiles.

let DIR: string;
beforeEach(async () => {
  DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-scaffold-mem-'));
});
afterEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});
const writeProse = (id: string): Promise<void> =>
  fs.writeFile(path.join(DIR, 'nodes', id, 'prompt.md'), `prose for ${id}\n`);
const read = (p: string): Promise<string> => fs.readFile(p, 'utf8');
const exists = (p: string): Promise<boolean> =>
  fs.access(p).then(() => true).catch(() => false);

describe('the scaffolder seeds the §2 memory layout', () => {
  it('scaffoldNew seeds template/memory.md (titled by the workflow id)', async () => {
    const r = await scaffoldNew(DIR, { id: 'game-omni', name: 'game-omni', description: 'd' });
    expect(r.memory.created).toBe(true);
    expect(await read(path.join(DIR, 'memory.md'))).toContain('game-omni');
  });

  it('scaffoldAddNode seeds nodes/<id>/memory.md + code-map.md', async () => {
    await scaffoldNew(DIR, { name: 'x', description: 'd' });
    const r = await scaffoldAddNode(DIR, { id: 'build', artifacts: ['a.md'] });
    expect(r.memory.created).toBe(true);
    expect(r.codeMap.created).toBe(true);
    expect(await exists(path.join(DIR, 'nodes', 'build', 'memory.md'))).toBe(true);
    expect(await exists(path.join(DIR, 'nodes', 'build', 'code-map.md'))).toBe(true);
  });
});

describe('create-if-absent through the scaffolder — config is overwritten, curated memory is not', () => {
  it('re-emitting a node rewrites node.json but leaves a curated memory.md + code-map.md untouched', async () => {
    await scaffoldNew(DIR, { name: 'x', description: 'd' });
    await scaffoldAddNode(DIR, { id: 'n', artifacts: ['a.md'] });

    const memPath = path.join(DIR, 'nodes', 'n', 'memory.md');
    const mapPath = path.join(DIR, 'nodes', 'n', 'code-map.md');
    await fs.writeFile(memPath, 'CURATED LESSON\n');
    await fs.writeFile(mapPath, 'CURATED SLICE\n');

    const r = await scaffoldAddNode(DIR, { id: 'n', artifacts: ['b.md'] });
    expect(r.memory.created, 'a curated memory.md is kept, not re-seeded').toBe(false);
    expect(r.codeMap.created).toBe(false);

    const node = JSON.parse(await read(path.join(DIR, 'nodes', 'n', 'node.json')));
    expect(node.contract.artifacts, 'CLI-owned config IS overwritten').toEqual(['b.md']);
    expect(await read(memPath)).toBe('CURATED LESSON\n');
    expect(await read(mapPath)).toBe('CURATED SLICE\n');
  });
});

describe('the memory sidecars are invisible to the compile gate', () => {
  it('loadTemplate compiles a template that carries the seeded memory + code-map sidecars', async () => {
    await scaffoldNew(DIR, { name: 'x', description: 'two nodes' });
    await scaffoldAddNode(DIR, { id: 'research', artifacts: ['f.md'] });
    await scaffoldAddNode(DIR, { id: 'build', deps: ['research'], artifacts: ['out.md'] });
    await writeProse('research');
    await writeProse('build');
    const spec = await loadTemplate(DIR);
    expect(spec.nodes.map((n) => n.label).sort()).toEqual(['build', 'research']);
  });
});

describe('scaffoldMemory — backfill an existing template', () => {
  it('seeds the system memory + every node\'s memory + code-map, create-if-absent', async () => {
    await scaffoldNew(DIR, { name: 'legacy', description: 'd' });
    await scaffoldAddNode(DIR, { id: 'a', artifacts: ['a.md'] });
    await scaffoldAddNode(DIR, { id: 'b', deps: ['a'], artifacts: ['b.md'] });
    // simulate a template authored before the layer: remove the auto-seeded files, then curate one.
    await fs.rm(path.join(DIR, 'memory.md'));
    await fs.rm(path.join(DIR, 'nodes', 'b', 'memory.md'));
    await fs.writeFile(path.join(DIR, 'nodes', 'a', 'memory.md'), 'CURATED\n');

    const { system, nodes } = await scaffoldMemory(DIR);
    expect(system.created, 'the missing system memory is backfilled').toBe(true);
    const a = nodes.find((n) => n.id === 'a')!;
    const b = nodes.find((n) => n.id === 'b')!;
    expect(a.memory.created, 'a curated node memory is kept').toBe(false);
    expect(b.memory.created, 'the missing node memory is backfilled').toBe(true);
    expect(await read(path.join(DIR, 'nodes', 'a', 'memory.md'))).toBe('CURATED\n');
    expect(await exists(path.join(DIR, 'nodes', 'b', 'code-map.md'))).toBe(true);
  });
});
