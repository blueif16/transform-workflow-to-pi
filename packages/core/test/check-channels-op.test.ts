// U1c oracle — checkChannels must see channel producers/consumers authored via the CANONICAL `op[]`,
// not only via the `hooks` alias. checks.ts derived seeds from `def.hooks?.seed` and promotes from
// `def.hooks?.promote`; a node that promotes/seeds DIRECTLY in `op[]` was invisible to the dangling-
// channel check → a FALSE "dangling channel" error for its consumers.
//
// RED mutation (the bug this pins): with the OLD `def.hooks?.promote` producer read, the `op[]`-authored
// promote is invisible → checkChannels RAISES a false `dangling channel` for the downstream consumer →
// the assert-empty case goes RED. GREEN once the read derives from `lowerToOps(def)`.
//
// checkChannels is PURE over LoadedNode[] — we construct nodes directly (no fixture/disk round-trip).

import { describe, it, expect } from 'vitest';
import { checkChannels } from '../src/workflow/template/checks.js';
import type { LoadedNode } from '../src/workflow/template/types.js';
import type { OpSpec } from '../src/types.js';

/** Minimal LoadedNode builder — the fields checkChannels reads (def.id/deps/contract/hooks/op/prose). */
function node(
  id: string,
  opts: {
    deps?: string[];
    readScope?: string[];
    op?: OpSpec[];
    hooks?: NonNullable<LoadedNode['def']['hooks']>;
    prose?: string;
  } = {},
): LoadedNode {
  return {
    def: {
      id,
      phase: 'p',
      deps: opts.deps ?? [],
      contract: { artifacts: [], owns: [], readScope: opts.readScope ?? [] },
      ...(opts.op ? { op: opts.op } : {}),
      ...(opts.hooks ? { hooks: opts.hooks } : {}),
    } as LoadedNode['def'],
    dir: `/tmp/${id}`,
    prose: opts.prose ?? '',
  };
}

describe('checkChannels — op[]-authored producers/consumers (U1c)', () => {
  it('op[]-authored PROMOTE registers as a channel producer → downstream {{state.X}} is NOT a dangle', () => {
    // Producer authors the promote DIRECTLY in op[] (the canonical rep), no hooks alias.
    const producer = node('prod', {
      op: [{ when: 'post', transform: { kind: 'promote', from: '@return:x', to: 'X' } }],
    });
    // Downstream consumer reads {{state.X}} via readScope; depends on the producer.
    const consumer = node('cons', { deps: ['prod'], readScope: ['{{state.X}}'] });

    // GREEN bar: the op[]-promote is seen → no dangling channel. (RED under the old hooks?.promote read.)
    expect(checkChannels([producer, consumer])).toEqual([]);
  });

  it('op[]-authored SEED consuming {{state.Y}} is checked → unpromoted channel IS a dangle (consumer seen)', () => {
    // A node that SEEDS from {{state.Y}} authored in op[]. No upstream promotes Y → it must dangle.
    const seeder = node('seeder', {
      op: [{ when: 'pre', writes: ['seed.json'], transform: { kind: 'seed', from: '{{state.Y}}' } }],
    });
    const errs = checkChannels([seeder]);
    // The op[]-authored seed's {{state.Y}} consumption is SEEN (old hooks?.seed read missed it → empty/GREEN-wrong).
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('Y');
    expect(errs[0]).toMatch(/dangling channel/);
  });

  it('ADDITIVITY: a hooks-authored promote→consumer pair still passes (no regression)', () => {
    const producer = node('hprod', {
      hooks: { promote: [{ from: '@return:x', to: 'Z' }] },
    });
    const consumer = node('hcons', { deps: ['hprod'], readScope: ['{{state.Z}}'] });
    expect(checkChannels([producer, consumer])).toEqual([]);
  });
});
