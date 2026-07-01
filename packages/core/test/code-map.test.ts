import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildNodeCodeMap, seedNodeCodeMap } from '../src/code-map.js';

// code-map is Leg B (piflow-memory-v1 §2/§5b) — the OPTIMIZER's understanding of the PRODUCT CODE in a
// node's scope. It is a SEPARATE leg from memory (self/history) — different concern, different file,
// different module. v1 is the Tier-0 OKF reference slice: pointers + semantics, NEVER a copy of the
// source. These guards: the slice is marked Tier-0 + pointers-not-copy + never-injected, and seeding is
// create-if-absent (the optimizer curates the slice; a re-seed must not clobber it).

let DIR: string;
beforeEach(async () => {
  DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-codemap-'));
});
afterEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});
const read = (p: string): Promise<string> => fs.readFile(p, 'utf8');

describe('buildNodeCodeMap — the Leg-B Tier-0 OKF slice skeleton', () => {
  it('interpolates the id and marks the slice Tier-0, pointers-not-copy, never-injected', () => {
    const md = buildNodeCodeMap('w4-execute');
    expect(md).toContain('w4-execute');
    expect(md.toLowerCase()).toContain('tier 0');
    // Leg B discipline (§5b): a slice records pointers + semantics, never a copy of the source bytes.
    expect(md.toLowerCase()).toContain('never a copy');
    expect(md.toLowerCase()).toContain('never injected');
  });
});

describe('seedNodeCodeMap — create-if-absent', () => {
  it('writes code-map.md from the builder, then never overwrites a curated slice', async () => {
    const r = await seedNodeCodeMap(DIR, 'build');
    expect(r.created).toBe(true);
    expect(r.path).toBe(path.join(DIR, 'code-map.md'));
    expect(await read(r.path)).toBe(buildNodeCodeMap('build'));

    await fs.writeFile(r.path, 'CURATED SLICE\n');
    const again = await seedNodeCodeMap(DIR, 'build');
    expect(again.created).toBe(false);
    expect(await read(r.path)).toBe('CURATED SLICE\n');
  });
});
