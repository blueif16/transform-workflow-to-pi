// (Phase 2) expandFusion — the spec-level transform that turns a fusion-activated node into N sibling
// producers + a JUDGE (the activated node, retargeted), so the EXISTING compiler draws
// `deps → (siblings ‖) → judge → original successors` with NO new DAG code. The load-bearing assertions:
// (1) the right NUMBER + MODEL of siblings per mode; (2) the judge keeps the original id so downstream
// edges survive; (3) after compile() the siblings share one parallel stage feeding the judge; (4) a spec
// with no fusion node is returned untouched. Built test-first against the stub (which returns the spec
// unchanged → the count/edge assertions go RED).

import { describe, it, expect } from 'vitest';
import { expandFusion, FusionConfigError } from '../src/workflow/fusion/expand.js';
import { compile } from '../src/index.js';
import type { NodeIntent, WorkflowSpec } from '../src/types.js';

/** A fusion-activated producer `synth` with a downstream `publish` that reads its artifact. */
function specWith(fusion: NodeIntent['fusion']): WorkflowSpec {
  const synth: NodeIntent = {
    label: 'synth',
    prompt: 'ORIGINAL TASK: write the answer.',
    tools: { allow: ['fs:read', 'fs:write'] },
    model: 'base-model',
    io: { reads: [], produces: ['out/answer.md'], artifacts: [{ path: 'out/answer.md' }] },
    sandbox: { read: ['src'], write: ['out/**'] },
    fusion,
  };
  const publish: NodeIntent = {
    label: 'publish',
    prompt: 'publish it',
    tools: {},
    io: { reads: ['out/answer.md'], produces: ['out/final.md'], artifacts: [{ path: 'out/final.md' }] },
  };
  return { meta: { name: 't', description: 'd' }, nodes: [synth, publish] };
}

const labels = (s: WorkflowSpec): string[] => s.nodes.map((n) => n.label).sort();
const find = (s: WorkflowSpec, label: string): NodeIntent => s.nodes.find((n) => n.label === label)!;

describe('expandFusion — moa (mixture-of-agents)', () => {
  it('replaces the node with one sibling per panel entry + a judge keeping the original label', () => {
    const out = expandFusion(specWith({ mode: 'moa', panel: ['model-a', 'model-b'] }));
    // synth → synth__p1, synth__p2 (siblings) + synth (judge) ; publish untouched.
    expect(labels(out)).toEqual(['publish', 'synth', 'synth__p1', 'synth__p2']);
  });

  it('each sibling carries its panel model and produces a distinct partial; the original prompt is cloned', () => {
    const out = expandFusion(specWith({ mode: 'moa', panel: ['model-a', 'model-b'] }));
    const p1 = find(out, 'synth__p1');
    const p2 = find(out, 'synth__p2');
    expect(p1.model).toBe('model-a');
    expect(p2.model).toBe('model-b');
    expect(p1.prompt).toBe('ORIGINAL TASK: write the answer.'); // sibling clones X's prompt verbatim
    expect(p1.io.produces).toEqual(['fusion-synth-p1/partial.json']);
    expect(p2.io.produces).toEqual(['fusion-synth-p2/partial.json']);
    // write-disjoint owns ⇒ the siblings are a parallel lane.
    expect(p1.sandbox?.write).toEqual(['fusion-synth-p1/partial.json']);
    expect(p2.sandbox?.write).toEqual(['fusion-synth-p2/partial.json']);
  });

  it('the judge reads every partial, keeps the original produces, and drops the fusion block', () => {
    const out = expandFusion(specWith({ mode: 'moa', panel: ['model-a', 'model-b'] }));
    const judge = find(out, 'synth');
    expect(judge.io.reads).toEqual(['fusion-synth-p1/partial.json', 'fusion-synth-p2/partial.json']);
    expect(judge.io.produces).toEqual(['out/answer.md']); // original artifact → downstream edge preserved
    expect(judge.fusion).toBeUndefined(); // no re-expansion
    expect(judge.prompt).toContain('JUDGE of a mixture-of-agents panel'); // A1 prompt
    expect(judge.prompt).toContain('ORIGINAL TASK: write the answer.'); // {{ORIGINAL_TASK}} filled
    // the judge is a fusion PRESET AGENT — agentType brands it for observe/GUI.
    expect(judge.agentType).toBe('fusion-judge-moa');
  });

  it('compiles to deps→(siblings ‖)→judge→successor: siblings share a parallel stage feeding the judge', () => {
    const wf = compile(expandFusion(specWith({ mode: 'moa', panel: ['model-a', 'model-b'] })));
    // The two siblings sit together in one parallel stage.
    const parallel = wf.stages.find((s) => s.nodeIds.length > 1);
    expect(parallel?.parallel).toBe(true);
    expect([...(parallel?.nodeIds ?? [])].sort()).toEqual(['synth-p1', 'synth-p2']);
    // The judge depends on both siblings (edges sibling→judge), and publish still depends on the judge.
    const intoJudge = wf.edges.filter((e) => e.to === 'synth').map((e) => e.from).sort();
    expect(intoJudge).toEqual(['synth-p1', 'synth-p2']);
    const fromJudge = wf.edges.filter((e) => e.from === 'synth').map((e) => e.to);
    expect(fromJudge).toEqual(['publish']);
  });
});

describe('expandFusion — best-of-n', () => {
  it('spawns n same-model siblings (diversity from sampling, not panel)', () => {
    const out = expandFusion(specWith({ mode: 'best-of-n', n: 3 }));
    expect(labels(out)).toEqual(['publish', 'synth', 'synth__p1', 'synth__p2', 'synth__p3']);
    for (const id of ['synth__p1', 'synth__p2', 'synth__p3']) {
      expect(find(out, id).model).toBe('base-model'); // all inherit X's model
    }
    expect(find(out, 'synth').prompt).toContain('JUDGE for a best-of-N panel'); // A2 prompt
    expect(find(out, 'synth').agentType).toBe('fusion-judge-best-of-n');
  });

  it('defaults to 3 samples when n is omitted', () => {
    const out = expandFusion(specWith({ mode: 'best-of-n' }));
    expect(out.nodes.filter((n) => n.label.startsWith('synth__p')).length).toBe(3);
  });
});

describe('expandFusion — obligations pre-node', () => {
  it('adds an obligations node the judge reads when obligations:true', () => {
    const out = expandFusion(specWith({ mode: 'moa', panel: ['model-a', 'model-b'], obligations: true }));
    const obl = find(out, 'synth__obl');
    expect(obl.io.produces).toEqual(['fusion-synth-obl/obligations.json']);
    expect(obl.prompt).toContain('COVERAGE CHECKLIST'); // A3 prompt
    expect(obl.agentType).toBe('fusion-obligations'); // the obligations preset agent

    // the judge reads the obligations artifact too (so its {{OBLIGATIONS}} slot is wired).
    const judge = find(out, 'synth');
    expect(judge.io.reads).toContain('fusion-synth-obl/obligations.json');
    expect(judge.prompt).toContain('fusion-synth-obl/obligations.json');
    // it compiles (the obl node sits in the siblings' stage, upstream of the judge).
    const wf = compile(out);
    expect(wf.edges.filter((e) => e.to === 'synth').map((e) => e.from).sort()).toEqual([
      'synth-obl',
      'synth-p1',
      'synth-p2',
    ]);
  });

  it('omits the {{OBLIGATIONS}} line from the judge prompt when obligations is off', () => {
    const judge = find(expandFusion(specWith({ mode: 'moa', panel: ['model-a'] })), 'synth');
    expect(judge.prompt).not.toContain('{{OBLIGATIONS}}');
    expect(judge.prompt).not.toContain('obligations.json');
  });
});

describe('expandFusion — passthrough + loud failure', () => {
  it('returns the SAME spec object when no node activates fusion', () => {
    const spec = specWith(undefined);
    expect(expandFusion(spec)).toBe(spec); // referential — untouched
  });

  it('classifies a panel entry that is a known active tier onto .tier (not .model)', () => {
    const out = expandFusion(specWith({ mode: 'moa', panel: ['fast', 'real-model-id'] }), {
      tiers: { active: true, tiers: { fast: 'deepseek-v3' } },
    });
    expect(find(out, 'synth__p1').tier).toBe('fast'); // a tier alias → carried as tier (runner resolves)
    expect(find(out, 'synth__p1').model).toBeUndefined();
    expect(find(out, 'synth__p2').model).toBe('real-model-id'); // not a tier → a model id
  });

  it('throws FusionConfigError for moa with no panel', () => {
    expect(() => expandFusion(specWith({ mode: 'moa' }))).toThrow(FusionConfigError);
  });
});
