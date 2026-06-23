import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractWorkflow } from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'sample-workflow.js');

describe('extractWorkflow — record realized prompts + DAG from a workflow .js', () => {
  it('records the EXACT agent count and stage grouping (phase + parallel boundaries)', async () => {
    const { records, stages } = await extractWorkflow(FIXTURE, { theme: 'space' });

    // 4 agent() calls: W0, W3a, W3b, W4.
    expect(records).toHaveLength(4);

    // 3 stages: serial W0, then a parallel lane of 2 (W3a+W3b), then serial W4.
    expect(stages).toHaveLength(3);
    expect(stages.map((s) => s.nodes.length)).toEqual([1, 2, 1]);
    expect(stages.map((s) => s.phase)).toEqual(['design', 'build', 'build']);

    // The parallel stage's two lanes share ONE group id; the serial stages have group=null.
    expect(stages[0].group).toBeNull();
    expect(stages[2].group).toBeNull();
    expect(stages[1].group).not.toBeNull();
    expect(stages[1].nodes[0].group).toBe(stages[1].group);
    expect(stages[1].nodes[1].group).toBe(stages[1].group);

    // LOAD-BEARING: the stub records the REALIZED values (label/agentType/phase/schema), not placeholders.
    const w0 = records[0];
    expect(w0.label).toBe('W0 Classify');
    expect(w0.agentType).toBe('classifier');
    expect(w0.phase).toBe('design');
    expect(w0.hasSchema).toBe(false);
    expect(records[1].hasSchema).toBe(true); // W3a passed a schema
    expect(records[1].label).toBe('W3a Art');
  });

  it('threads args into the body — a prompt interpolating an arg reflects the passed value', async () => {
    const { records } = await extractWorkflow(FIXTURE, { theme: 'space' });
    expect(records[0].prompt).toBe('W0 classify the space game');

    // A different arg flows through to the SAME recorded prompt slot (proves it is not a constant).
    const { records: r2 } = await extractWorkflow(FIXTURE, { theme: 'ocean' });
    expect(r2[0].prompt).toBe('W0 classify the ocean game');
  });

  it("extracts the pure `meta` literal and returns the body's aggregate", async () => {
    const { meta, aggregate } = await extractWorkflow(FIXTURE, { theme: 'space' });
    expect(meta?.name).toBe('sample-fixture');
    expect(meta?.phases).toHaveLength(2);
    expect(aggregate).toEqual({ ok: true });
  });
});
