// Contract for optimize/criteria.ts — parse the product's per-node quality bar (`skill-system-criteria.md`)
// into a CriteriaFixture keyed by node id. Bound to the REAL committed fixture so a wrong parser turns RED.
// The parser reads ONLY `## <Label> (<node-id>)` H2 headings (a parenthetical id); thematic H2s without an
// id parenthetical (e.g. "## Affordance bar") are NOT nodes and must be skipped.
//
// Run: npx vitest run packages/core/test/optimize-criteria.test.ts

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCriteria } from '../src/optimize/criteria.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'optimize', 'skill-system-criteria.md');
const md = readFileSync(FIXTURE, 'utf8');

describe('parseCriteria', () => {
  it('keys every producing node by its parenthetical id', () => {
    const fx = parseCriteria(md);
    for (const id of [
      'w0-classify', 'w1-spec', 'harden-blueprint', 'verify-1-design', 'w2-scaffold',
      'w3a-art-direction', 'w3b-assets', 'w4-execute', 'verify-2-qa',
      'author-guidance', 'author-shell', 'sound-author', 'model-director',
    ]) {
      expect(fx.has(id), `missing node entry: ${id}`).toBe(true);
    }
  });

  it('captures a node entry whole — label, artifact, and the two bullet lists', () => {
    const fx = parseCriteria(md);
    const w0 = fx.get('w0-classify')!;
    expect(w0.nodeId).toBe('w0-classify');
    expect(w0.label).toBe('W0 Classify');
    expect(w0.artifact).toBe('spec/classification.json');
    expect(w0.purpose).toContain('First node');
    // the real fixture has ~8 acceptance bullets and ~6 red flags for W0 — a parser that drops the list goes RED.
    expect(w0.acceptanceCriteria.length).toBeGreaterThanOrEqual(6);
    expect(w0.redFlags.length).toBeGreaterThanOrEqual(5);
    expect(w0.acceptanceCriteria[0]).toContain('archetype is byte-identical');
  });

  it('does NOT slurp thematic H2s that carry no node id', () => {
    const fx = parseCriteria(md);
    for (const key of fx.keys()) {
      expect(key).not.toContain('Affordance');
      expect(key).not.toContain(' '); // a real node id is a slug, never a prose heading
    }
  });
});
