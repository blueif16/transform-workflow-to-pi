// (M5 · G13) op-action-lower — the CONTROL op forms are SUGAR that lower to the canonical M3/M4 primitives:
//   action:{kind:'rerouteTo'} → NodeIntent.reroute (M3, consumed by expandReroute — never dense NodeSpec)
//   action:{kind:'retry'}     → NodeIO.retry      (M4)
//   action:{kind:'escalate'}  → NodeIO.escalate   (M4)
// The action op carries the SLOT (G13); G12 owns the runtime. We assert the loader lowers the sugar onto the
// canonical fields, so the existing M3/M4 machinery (expandReroute / the retry+escalate lanes) acts on it.
//
// Written test-first against the absent action-lowering: today an authored action op stays an inert `op`
// entry and never populates reroute/retry/escalate — RED for the right reason.

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTemplate } from '../src/index.js';

const writeJson = (p: string, v: unknown): Promise<void> => fs.writeFile(p, JSON.stringify(v, null, 2) + '\n');

async function templateWith(defs: Record<string, unknown>[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-actlower-'));
  await writeJson(path.join(dir, 'meta.json'), { id: 't', name: 't', description: 'd', phases: ['build'] });
  for (const def of defs) {
    const ndir = path.join(dir, 'nodes', String(def.id));
    await fs.mkdir(ndir, { recursive: true });
    await writeJson(path.join(ndir, 'node.json'), def);
    await fs.writeFile(path.join(ndir, 'prompt.md'), `do ${def.id}`);
  }
  return dir;
}

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await fs.rm(dirs.pop()!, { recursive: true, force: true });
});

describe('op-action-lower — CONTROL op forms lower to the canonical M3/M4 primitives', () => {
  it('rerouteTo → NodeIntent.reroute · retry → io.retry · escalate → io.escalate', async () => {
    const produce = {
      id: 'produce',
      phase: 'build',
      deps: [],
      prompt: { file: 'prompt.md' },
      contract: { artifacts: ['work/draft.md'], owns: ['work/**'], readScope: ['{{RUN}}'] },
    };
    const verify = {
      id: 'verify',
      phase: 'build',
      deps: ['produce'],
      prompt: { file: 'prompt.md' },
      contract: { artifacts: ['verify/report.json'], owns: ['verify/**'], readScope: ['{{RUN}}'] },
      op: [
        { when: 'on-failure', action: { kind: 'rerouteTo', node: 'produce', max: 2, evidence: ['verify/report.json'] } },
        { when: 'on-failure', action: { kind: 'retry', max: 1 } },
        { when: 'on-failure', action: { kind: 'escalate', via: 'deep', evidence: ['verify/report.json'] } },
      ],
    };
    const dir = await templateWith([produce, verify]);
    dirs.push(dir);

    const spec = await loadTemplate(dir);
    const node = spec.nodes.find((n) => n.label === 'verify')!;

    // rerouteTo lowers to the canonical NodeIntent.reroute (the M3 expandReroute input).
    expect(node.reroute, 'rerouteTo must lower to NodeIntent.reroute').toEqual({
      onFail: 'produce',
      max: 2,
      evidence: ['verify/report.json'],
    });
    // retry lowers to io.retry (M4).
    expect(node.io.retry, 'retry must lower to io.retry').toEqual({ max: 1 });
    // escalate lowers to io.escalate (M4); `via` resolves through model-routing as a tier/model.
    expect(node.io.escalate, 'escalate must lower to io.escalate').toMatchObject({ tier: 'deep' });
  });
});
