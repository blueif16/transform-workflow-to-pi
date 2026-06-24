// Ported from game-omni pi-runner/hooks/test/seed.test.mjs — the DRIVER-SEED parse + the {file:field}
// drill, RE-ROOTED off the retired RUN_CWD onto the U7 logical-root resolver ({{RUN}}/{{WORKSPACE}}).
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { driverSeed, resolveSeedTokens, stageSeed } from '../src/index.js';
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

// S2 — the seed PRE EXECUTOR: stage a starting artifact at `to` from the (token-bearing) `from`, before
// the model runs. Ports run.mjs:1517-1551 (file copy / dir recursion / idempotency / source-existence).
describe('stageSeed — the seed copy executor (S2)', () => {
  const writeFile = async (p: string, body: string): Promise<void> => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  };

  it('copies a FILE source to ${RUN}/<to> with the source bytes (a relative `to` lands under runDir)', async () => {
    tmp = await mkTmp();
    const workspace = path.join(tmp, 'canon');
    const runDir = path.join(tmp, 'run');
    await writeFile(path.join(workspace, 'tpl', 'skeleton.json'), '{"shape":"seeded"}');
    const ctx: ResolveCtx = { run: runDir, workspace };

    const res = await stageSeed({ to: 'spec/skeleton.json', from: '{{WORKSPACE}}/tpl/skeleton.json' }, ctx, runDir);

    expect(res.staged).toBe(true);
    expect(await fs.readFile(path.join(runDir, 'spec', 'skeleton.json'), 'utf8')).toBe('{"shape":"seeded"}');
  });

  it('resolves a {{state.*}}-bearing `from` against ctx.state (the w2-scaffold/gameplay seed shape)', async () => {
    tmp = await mkTmp();
    const workspace = path.join(tmp, 'canon');
    const runDir = path.join(tmp, 'run');
    // The per-archetype skeleton lives under the archetype dir; the seed names it via {{state.archetype}}.
    await writeFile(path.join(workspace, 'templates', 'modules', 'platformer', 'level-skeleton.json'), '{"level":1}');
    const ctx: ResolveCtx = { run: runDir, workspace, state: { archetype: 'platformer' } };

    const res = await stageSeed(
      { to: 'spec/level-skeleton.json', from: '{{WORKSPACE}}/templates/modules/{{state.archetype}}/level-skeleton.json' },
      ctx,
      runDir,
    );

    expect(res.staged).toBe(true);
    expect(await fs.readFile(path.join(runDir, 'spec', 'level-skeleton.json'), 'utf8')).toBe('{"level":1}');
  });

  it('does NOT re-stage an already-filled FILE dest (idempotency — a resume never clobbers)', async () => {
    tmp = await mkTmp();
    const workspace = path.join(tmp, 'canon');
    const runDir = path.join(tmp, 'run');
    await writeFile(path.join(workspace, 'tpl', 's.json'), 'TEMPLATE');
    // The dest already holds the model's filled work — it must survive.
    await writeFile(path.join(runDir, 'spec', 's.json'), 'MODEL-FILLED');
    const ctx: ResolveCtx = { run: runDir, workspace };

    const res = await stageSeed({ to: 'spec/s.json', from: '{{WORKSPACE}}/tpl/s.json' }, ctx, runDir);

    expect(res.staged).toBe(false);
    expect(res.reason).toMatch(/present|filled/i);
    expect(await fs.readFile(path.join(runDir, 'spec', 's.json'), 'utf8')).toBe('MODEL-FILLED');
  });

  it('skips (does not throw) when the source template is absent — the node hand-builds', async () => {
    tmp = await mkTmp();
    const ctx: ResolveCtx = { run: path.join(tmp, 'run'), workspace: path.join(tmp, 'canon') };
    const res = await stageSeed({ to: 'spec/x.json', from: '{{WORKSPACE}}/tpl/missing.json' }, ctx, ctx.run);
    expect(res.staged).toBe(false);
    expect(res.reason).toMatch(/no template|absent|source/i);
    // and nothing was written
    await expect(fs.access(path.join(ctx.run, 'spec', 'x.json'))).rejects.toThrow();
  });

  it('copies a DIRECTORY source RECURSIVELY to the dest', async () => {
    tmp = await mkTmp();
    const workspace = path.join(tmp, 'canon');
    const runDir = path.join(tmp, 'run');
    await writeFile(path.join(workspace, 'base', 'src', 'index.ts'), 'export const a = 1;');
    await writeFile(path.join(workspace, 'base', 'README.md'), '# base');
    const ctx: ResolveCtx = { run: runDir, workspace };

    const res = await stageSeed({ to: '.', from: '{{WORKSPACE}}/base' }, ctx, runDir);

    expect(res.staged).toBe(true);
    expect(await fs.readFile(path.join(runDir, 'src', 'index.ts'), 'utf8')).toBe('export const a = 1;');
    expect(await fs.readFile(path.join(runDir, 'README.md'), 'utf8')).toBe('# base');
  });

  // §8.2 — the NESTED-token ordering risk: a {{state.archetype}} INSIDE a {file:field} drill must resolve
  // FIRST (phase-1 logical roots), so the outer drill reads the right per-archetype file. This is the
  // w2-scaffold composed-seed shape; the test pins the order holds end-to-end through stageSeed.
  it('resolves a {{state}} token NESTED inside a {file:field} drill, then copies (the w2-scaffold seed)', async () => {
    tmp = await mkTmp();
    const workspace = path.join(tmp, 'canon');
    const runDir = path.join(tmp, 'run');
    // 1) classification names the archetype; 2) the archetype's genre.json names the coreBase dir; 3) the
    // seed `from` drills coreBase via a {{state.archetype}}-nested {file:field}, then copies that base.
    await writeJson(path.join(runDir, 'spec', 'classification.json'), { archetype: 'platformer' });
    await writeJson(path.join(workspace, 'templates', 'modules', 'platformer', 'genre.json'), {
      genres: [{ coreBase: 'core-2d' }],
    });
    await writeFile(path.join(workspace, 'templates', 'core', 'core-2d', 'engine.ts'), 'export const E = 2;');
    const ctx: ResolveCtx = { run: runDir, workspace, state: { archetype: 'platformer' } };

    const from =
      '{{WORKSPACE}}/templates/core/' +
      '{{{WORKSPACE}}/templates/modules/{{state.archetype}}/genre.json:genres.0.coreBase}';
    const res = await stageSeed({ to: 'src', from }, ctx, runDir);

    expect(res.staged).toBe(true);
    // proves the inner {{state.archetype}} resolved to platformer → the drill read core-2d → that dir copied.
    expect(await fs.readFile(path.join(runDir, 'src', 'engine.ts'), 'utf8')).toBe('export const E = 2;');
  });
});
