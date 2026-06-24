// Ported from game-omni pi-runner/hooks/test/seed-contract.test.mjs — the DRIVER-SEED-CONTRACT
// bind-template interpreter (resolveNodeContract + helpers) and runSeedContract, RE-ROOTED off the
// retired RUN_CWD/ROOT/here chain onto the explicit `projectBase` (absUnder), with no `ctx` parameter.
//
// ORACLE GROUNDING: the game-omni oracle resolved the live node-catalog against the out/p02 blueprint
// golden (which does NOT exist in piflow). Re-grounded here with the COPIED node-catalog.json fixture +
// INLINE blueprint fixtures carrying the documented p02 meta — the expected contracts are the SAME
// hand-derived values the .mjs asserts (p02 meta: scoringModel="bounded-collectible",
// failModel="respawn", coreFantasy="a nimble monkey swinging through a dangerous jungle canopy").
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveNodeContract,
  coreObservables,
  drillArrayField,
  gatherEntityIds,
  runSeedContract,
} from '../src/workflow/ops/seed-contract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(here, 'fixtures', 'node-catalog.json');

let tmp: string | undefined;
afterEach(async () => {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const mkTmp = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'piflow-seed-contract-'));
const readJson = async (p: string): Promise<any> => JSON.parse(await fs.readFile(p, 'utf8'));
const writeJson = async (p: string, o: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(o, null, 2) + '\n');
};

const catalog = JSON.parse(await fs.readFile(CATALOG_PATH, 'utf8'));

// ---------- the pure interpreter primitives (verbatim from the .mjs oracle, inline fixtures) ----------
describe('coreObservables — base ∪ scalar-gated additions', () => {
  it('scoring adds maxScore; a failModel map MISS (respawn) adds nothing', () => {
    // p02 meta: scoringModel != 'none' ⇒ +maxScore; failModel 'respawn' has no map entry ⇒ +nothing.
    const spec = { meta: { scoringModel: 'bounded-collectible', failModel: 'respawn' } };
    expect(coreObservables(spec, catalog.observables)).toEqual(['status', 'score', 'player.x', 'player.y', 'maxScore']);
  });

  it('a failModel WITH a map entry (health) adds player.health; scoringModel none adds no maxScore', () => {
    const spec = { meta: { scoringModel: 'none', failModel: 'health' } };
    expect(coreObservables(spec, catalog.observables)).toEqual(['status', 'score', 'player.x', 'player.y', 'player.health']);
  });
});

describe('drillArrayField', () => {
  it("'a[].b' projects each element's b; plain path scalar ⇒ [v]; array ⇒ array; missing ⇒ []", () => {
    const spec = { milestones: [{ id: 'M1' }, { id: 'M2' }], one: 5, arr: [1, 2] };
    expect(drillArrayField(spec, 'milestones[].id')).toEqual(['M1', 'M2']);
    expect(drillArrayField(spec, 'one')).toEqual([5]);
    expect(drillArrayField(spec, 'arr')).toEqual([1, 2]);
    expect(drillArrayField(spec, 'missing')).toEqual([]);
  });
});

describe('gatherEntityIds', () => {
  it('single {id} object AND arrays of {id}, in path then array order', () => {
    const spec = { layout: { goal: { id: 'g' }, rewards: [{ id: 'r1' }, { id: 'r2' }] } };
    expect(gatherEntityIds(spec, ['layout.goal', 'layout.rewards'])).toEqual(['g', 'r1', 'r2']);
  });
});

// ---------- resolveNodeContract over the catalog.shell entry + the documented p02 meta ----------
describe('resolveNodeContract(shell)', () => {
  it('reproduces the hand-derived contract for the p02 meta', () => {
    // Inline fixture carrying the documented p02 meta scalars.
    const spec = {
      meta: {
        scoringModel: 'bounded-collectible',
        failModel: 'respawn',
        coreFantasy: 'a nimble monkey swinging through a dangerous jungle canopy',
      },
    };
    const out = resolveNodeContract(spec, catalog.nodes.shell, catalog.observables);

    // owns: verbatim copy of catalog.nodes.shell.owns
    expect(out.owns).toEqual(['hud', 'intro', 'sceneFlow', 'modes']);

    // bind: segment 1 = dedup-sort(coreObservables ∪ {objective}); segment 2 = literal 'controls[]'.
    // coreObservables(p02) = [status,score,player.x,player.y,maxScore]; +objective; dedup-sort ⇒
    //   ["maxScore","objective","player.x","player.y","score","status"]; then 'controls[]' appended.
    expect(out.bind).toEqual(['maxScore', 'objective', 'player.x', 'player.y', 'score', 'status', 'controls[]']);

    // scalars: failModel <= meta.failModel; scoringModel <= meta.scoringModel.
    expect(out.failModel).toBe('respawn');
    expect(out.scoringModel).toBe('bounded-collectible');

    // demand render: scoringModel!='none' ⇒ {scoring?score-progress:objective}=score-progress;
    // failModel 'respawn' ∈ {none,respawn} ⇒ {failResource}='' and {gameOver?}='out' (→ 'without').
    expect(out.demand).toBe(
      'HUD surfacing the score-progress; title + how-to-play from controls[]; scene-flow without a gameOver branch.',
    );

    // tone: meta.coreFantasy present ⇒ that string (not the default).
    expect(out.tone).toBe('a nimble monkey swinging through a dangerous jungle canopy');
  });

  it('a non-respawn failModel injects the resource + a gameOver branch (lives / none / empty fantasy)', () => {
    // Controlled fixture to exercise the OTHER demand branch (failModel='lives', scoringModel='none').
    const spec = { meta: { failModel: 'lives', scoringModel: 'none', coreFantasy: '' } };
    const out = resolveNodeContract(spec, catalog.nodes.shell, catalog.observables);
    // {scoring?...:objective}=objective; {failResource}=' + the lives resource'; {gameOver?}='' (→ 'with a gameOver branch').
    expect(out.demand).toBe(
      'HUD surfacing the objective + the lives resource; title + how-to-play from controls[]; scene-flow with a gameOver branch.',
    );
    // tone falls back to the catalog default when coreFantasy is empty.
    expect(out.tone).toBe('clear, legible first');
  });
});

// ---------- runSeedContract end-to-end: writes source.contracts.<node> for every catalog node ----------
describe('runSeedContract', () => {
  it('writes contracts.{shell,guidance,asset,sound} into the source blueprint', async () => {
    tmp = await mkTmp();
    const src = path.join(tmp, 'spec', 'blueprint.json');
    // Inline blueprint: the p02 meta PLUS the minimal arrays the binds drill, so guidance/sound/asset
    // resolve without error (effects[].on, custom[].emits[].name, milestones[].id, assetList[].slot,
    // entities[].assetSlot, layout.goal/rewards/threats with {id}).
    await writeJson(src, {
      meta: {
        scoringModel: 'bounded-collectible',
        failModel: 'respawn',
        coreFantasy: 'a nimble monkey swinging through a dangerous jungle canopy',
        coreVerb: 'swing',
        artStyle: 'flat vector cartoon jungle',
      },
      layout: {
        goal: { id: 'treehouse' },
        rewards: [{ id: 'banana1' }, { id: 'banana2' }],
        threats: [{ id: 'snake' }],
      },
      effects: [{ on: 'collect' }, { on: 'hit' }],
      custom: [{ emits: [{ name: 'swing.start' }] }],
      milestones: [{ id: 'M1' }, { id: 'M2' }, { id: 'M3' }],
      assetList: [{ slot: 'monkey' }, { slot: 'banana' }],
      entities: [{ assetSlot: 'snake' }],
    });
    const proj = { source: src, catalog: CATALOG_PATH, into: 'contracts' };
    const summary = await runSeedContract(proj, tmp);
    // The catalog has 4 node types (shell/guidance/asset/sound); $comment keys are skipped.
    expect(summary).not.toBeNull();
    expect(summary!.nodes!.sort()).toEqual(['asset', 'guidance', 'shell', 'sound']);
    const written = await readJson(src);
    expect(Object.keys(written.contracts).sort()).toEqual(['asset', 'guidance', 'shell', 'sound']);
    // contracts.shell matches the resolveNodeContract derivation above (same meta input).
    expect(written.contracts.shell.bind).toEqual([
      'maxScore',
      'objective',
      'player.x',
      'player.y',
      'score',
      'status',
      'controls[]',
    ]);
  });

  it('skips gracefully when the catalog is missing', async () => {
    tmp = await mkTmp();
    await writeJson(path.join(tmp, 'b.json'), { meta: {} });
    const proj = { source: path.join(tmp, 'b.json'), catalog: 'no-such-catalog.json', into: 'contracts' };
    const out = await runSeedContract(proj, tmp);
    expect(out!.skipped).toMatch(/catalog/);
  });
});
