// Ported from game-omni pi-runner/hooks/test/seed.test.mjs — the DRIVER-SEED parse + the {file:field}
// drill, RE-ROOTED off the retired RUN_CWD onto the U7 logical-root resolver ({{RUN}}/{{WORKSPACE}}).
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { driverSeed, resolveSeedTokens } from '../src/index.js';
import type { ResolveCtx } from '../src/index.js';

let tmp: string | undefined;
afterEach(async () => {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const mkTmp = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'piflow-seed-'));
const writeJson = async (p: string, o: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(o, null, 2) + '\n');
};

describe('driverSeed — parse the DRIVER-SEED PRE-stage markers', () => {
  it('parses MULTIPLE DRIVER-SEED lines in order ({dest} <= {src})', () => {
    const prompt = [
      'preamble',
      'DRIVER-SEED: a.json <= {{WORKSPACE}}/tpl/a.json',
      'DRIVER-SEED: b.json <= {{WORKSPACE}}/tpl/b.json',
      'trailer',
    ].join('\n');
    expect(driverSeed(prompt)).toEqual([
      { to: 'a.json', from: '{{WORKSPACE}}/tpl/a.json' },
      { to: 'b.json', from: '{{WORKSPACE}}/tpl/b.json' },
    ]);
  });

  it('parses three ADJACENT lines (the lookahead-boundary regression — no every-other skip)', () => {
    const prompt = 'DRIVER-SEED: x <= 1\nDRIVER-SEED: y <= 2\nDRIVER-SEED: z <= 3';
    expect(driverSeed(prompt)).toEqual([
      { to: 'x', from: '1' },
      { to: 'y', from: '2' },
      { to: 'z', from: '3' },
    ]);
  });

  it('returns [] when no DRIVER-SEED marker is present', () => {
    expect(driverSeed('no markers here')).toEqual([]);
  });
});

describe('resolveSeedTokens — {file:field} drill, re-rooted on the logical resolver', () => {
  it('drills a dotted path (incl array index) from a JSON file resolved under {{RUN}}', async () => {
    tmp = await mkTmp();
    await writeJson(path.join(tmp, 'spec', 'classification.json'), {
      archetype: 'platformer',
      genres: [{ coreBase: 'core' }],
    });
    const ctx: ResolveCtx = { run: tmp, workspace: tmp };
    expect(resolveSeedTokens('{{{RUN}}/spec/classification.json:archetype}', ctx)).toBe('platformer');
    expect(resolveSeedTokens('{{{RUN}}/spec/classification.json:genres.0.coreBase}', ctx)).toBe('core');
  });

  it('resolves a NESTED token inner→outer to a fixpoint (the W0→HARDEN composed seed)', async () => {
    tmp = await mkTmp();
    await writeJson(path.join(tmp, 'spec', 'classification.json'), { archetype: 'platformer' });
    await writeJson(path.join(tmp, 'templates', 'modules', 'platformer', 'genre.json'), {
      genres: [{ coreBase: 'core-2d' }],
    });
    const ctx: ResolveCtx = { run: tmp, workspace: tmp };
    const got = resolveSeedTokens(
      '{{{RUN}}/templates/modules/{{{RUN}}/spec/classification.json:archetype}/genre.json:genres.0.coreBase}',
      ctx,
    );
    expect(got).toBe('core-2d');
  });

  it('leaves a bare (untokened) string unchanged', async () => {
    tmp = await mkTmp();
    const ctx: ResolveCtx = { run: tmp, workspace: tmp };
    expect(resolveSeedTokens('templates/x.json', ctx)).toBe('templates/x.json');
  });

  it('leaves an UNRESOLVABLE {file:field} drill in place (missing file ⇒ no crash); the {{RUN}} root IS resolved', async () => {
    tmp = await mkTmp();
    const ctx: ResolveCtx = { run: tmp, workspace: tmp };
    // The logical root resolves (phase 1); only the failed DRILL keeps its now-absolute {file:field} token.
    expect(resolveSeedTokens('{{{RUN}}/nope/missing.json:field}', ctx)).toBe(
      `{${tmp}/nope/missing.json:field}`,
    );
  });

  it('leaves a token whose FIELD is absent in place (v==null ⇒ whole drilled token kept)', async () => {
    tmp = await mkTmp();
    await writeJson(path.join(tmp, 'c.json'), { present: 1 });
    const ctx: ResolveCtx = { run: tmp, workspace: tmp };
    expect(resolveSeedTokens('{{{RUN}}/c.json:absentField}', ctx)).toBe(`{${tmp}/c.json:absentField}`);
  });

  it('also resolves a {{WORKSPACE}}-rooted file token (canonical-tree drill)', async () => {
    tmp = await mkTmp();
    await writeJson(path.join(tmp, 'registry', 'genres.json'), { default: 'platformer' });
    const ctx: ResolveCtx = { run: '/some/run', workspace: tmp };
    expect(resolveSeedTokens('{{{WORKSPACE}}/registry/genres.json:default}', ctx)).toBe('platformer');
  });
});
