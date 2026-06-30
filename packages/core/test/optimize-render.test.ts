// Contract for optimize/render.ts — render a Defect[] worklist into the proven HERMES-ROUTING.md shape:
// a `## Routing summary` table (one row per defect) + a `## Finding N — …` section per defect. The
// post-hoc `## Update — fixes applied` trailer must NEVER be emitted by the projector.
//
// Run: npx vitest run packages/core/test/optimize-render.test.ts

import { describe, it, expect } from 'vitest';
import { renderRouting } from '../src/optimize/render.js';
import type { Defect } from '../src/optimize/types.js';

const defects: Defect[] = [
  {
    node: 'w4-execute-m2',
    bucket: 'FUNCTIONALITY',
    symptom: 'M2-A3 score<=maxScore fails (maxScore===0)',
    evidence: ['check:M2-A3', 'owner:templates/modules/gallery_shooter/src/**'],
    confidence: 'high',
  },
  {
    node: 'w4-execute-m3',
    bucket: 'FUNCTIONALITY',
    symptom: 'M3 fidelity 0/4 + completability fail',
    evidence: ['check:M3-A1', 'check:completability'],
    confidence: 'medium',
  },
];

describe('renderRouting', () => {
  const md = renderRouting(defects, { runId: 'gs01', archetype: 'gallery_shooter' });

  it('emits a routing summary table with a row per defect', () => {
    expect(md).toContain('## Routing summary');
    // a markdown table header carrying the MVP columns
    expect(md).toMatch(/\|\s*#\s*\|/);
    expect(md).toContain('Node');
    expect(md).toContain('Bucket');
    expect(md).toContain('Confidence');
    // every defect's node + bucket appears in the table
    expect(md).toContain('w4-execute-m2');
    expect(md).toContain('w4-execute-m3');
    expect(md).toContain('FUNCTIONALITY');
  });

  it('emits one `## Finding N` section per defect, carrying the symptom + evidence', () => {
    expect(md).toContain('## Finding 1');
    expect(md).toContain('## Finding 2');
    expect((md.match(/^## Finding /gm) ?? [])).toHaveLength(2);
    expect(md).toContain('M2-A3 score<=maxScore fails');
    expect(md).toContain('templates/modules/gallery_shooter/src/**');
  });

  it('carries the run meta', () => {
    expect(md).toContain('gs01');
    expect(md).toContain('gallery_shooter');
  });

  it('NEVER emits the post-hoc fixes-applied trailer', () => {
    expect(md).not.toContain('## Update');
  });
});
