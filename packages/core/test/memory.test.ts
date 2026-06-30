import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildNodeMemory, buildSystemMemory, seedNodeMemory, seedSystemMemory } from '../src/memory/index.js';

// The memory layer (piflow-memory-v1 §2) is Leg A — the OPTIMIZER's surface. The Hermes fixers/reconcile
// node READ + UPDATE these `memory.md` files from run traces to improve the system; a node NEVER sees its
// own memory at run time (user, 2026-06-29 — failure history only makes the executor hesitate). These
// tests pin the load-bearing invariants, each a real RED guard (not coverage theater):
//   1. the seed is OPTIMIZER-FACING and marked NEVER injected into the node prompt — drop that header and a
//      future session may wire memory into a prompt, the one thing it must never be;
//   2. the id is woven into the title AND the `skillsys(<id>)` history pointer — the optimizer's link to git;
//   3. seeding is CREATE-IF-ABSENT — memory ACCUMULATES across runs, so a re-seed must NEVER clobber it.

let DIR: string;
beforeEach(async () => {
  DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-memory-'));
});
afterEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});
const read = (p: string): Promise<string> => fs.readFile(p, 'utf8');

describe('buildNodeMemory — the §4 node memory skeleton', () => {
  it('interpolates the id into the title and the skillsys history pointer', () => {
    const md = buildNodeMemory('w4-execute');
    expect(md).toContain('w4-execute');
    // the optimizer queries git for the node's full change log via this exact grep key.
    expect(md).toContain('skillsys(w4-execute)');
  });

  it('is marked optimizer-facing / NEVER injected into the node prompt (the load-bearing guardrail)', () => {
    expect(buildNodeMemory('n').toLowerCase()).toContain('never injected');
  });

  it('carries the §4 spine — the failure-mode section where the generalized LESSON lands', () => {
    expect(buildNodeMemory('n')).toContain('## Known failure modes');
  });
});

describe('buildSystemMemory — the §2.4 template reconcile summary', () => {
  it('carries the workflow id, the reconcile-only authorship rule, and the never-injected guardrail', () => {
    const md = buildSystemMemory('game-omni');
    expect(md).toContain('game-omni');
    // §7 disjoint write authority: ONLY the reconcile node edits the template memory.
    expect(md.toLowerCase()).toContain('reconcile');
    expect(md.toLowerCase()).toContain('never injected');
  });
});

describe('seedNodeMemory / seedSystemMemory — create-if-absent (never clobber curated memory)', () => {
  it('seedNodeMemory writes memory.md from the builder on first call', async () => {
    const r = await seedNodeMemory(DIR, 'build');
    expect(r.created).toBe(true);
    expect(r.path).toBe(path.join(DIR, 'memory.md'));
    expect(await read(r.path)).toBe(buildNodeMemory('build'));
  });

  it('seedNodeMemory does NOT overwrite a curated memory.md on a second call', async () => {
    await seedNodeMemory(DIR, 'build');
    await fs.writeFile(path.join(DIR, 'memory.md'), 'CURATED LESSON\n');
    const r = await seedNodeMemory(DIR, 'build');
    expect(r.created).toBe(false);
    expect(await read(path.join(DIR, 'memory.md'))).toBe('CURATED LESSON\n');
  });

  it('seedSystemMemory is create-if-absent too', async () => {
    const first = await seedSystemMemory(DIR, 'wf');
    expect(first.created).toBe(true);
    await fs.writeFile(first.path, 'CURATED RECONCILE\n');
    const second = await seedSystemMemory(DIR, 'wf');
    expect(second.created).toBe(false);
    expect(await read(first.path)).toBe('CURATED RECONCILE\n');
  });
});
