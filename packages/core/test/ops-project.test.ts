// Ported from game-omni pi-runner/hooks/test/project.test.mjs — the GENERIC projection transforms
// (copy | assemble | merge), re-rooted onto the U7 resolver (paths under {{RUN}}). The game-omni-specific
// `union` op (asset-slot + genre-record + golden-blueprint) stays a CONSUMER concern, NOT in core (flagged).
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyProjectionOp } from '../src/index.js';

let tmp: string | undefined;
afterEach(async () => {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const mkTmp = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'piflow-project-'));
const readJson = async (p: string): Promise<unknown> => JSON.parse(await fs.readFile(p, 'utf8'));
const writeJson = async (p: string, o: unknown): Promise<void> => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(o, null, 2) + '\n');
};

// ---------- copy ----------
describe('applyProjectionOp — copy', () => {
  it('writes the drilled subtree verbatim (2-space + trailing newline)', async () => {
    tmp = await mkTmp();
    const spec = { layout: { voxelWorld: { size: [4, 4], blocks: [{ x: 1 }] } } };
    const res = await applyProjectionOp(
      'runtimeData',
      { to: 'src/world/world1.json', copy: 'layout.voxelWorld' },
      spec,
      tmp,
    );
    expect(res).toEqual({ to: 'src/world/world1.json', op: 'copy', wrote: true });
    const onDisk = await fs.readFile(path.join(tmp, 'src/world/world1.json'), 'utf8');
    expect(onDisk).toBe(JSON.stringify(spec.layout.voxelWorld, null, 2) + '\n');
  });

  it('skips (no write) when the source path is absent', async () => {
    tmp = await mkTmp();
    const res = await applyProjectionOp('x', { to: 'out.json', copy: 'no.such.path' }, { a: 1 }, tmp);
    expect(res.wrote).toBe(false);
    expect(res.skipped).toMatch(/not found/);
    expect(await fs.stat(path.join(tmp, 'out.json')).then(() => true, () => false)).toBe(false);
  });
});

// ---------- assemble ----------
describe('applyProjectionOp — assemble', () => {
  it('= onDisk ∪ (spread keys minus @entity keys) ∪ deterministic fields; @entity preserved', async () => {
    tmp = await mkTmp();
    await writeJson(path.join(tmp, 'src/levels/L.json'), { scene: 'OLD', player: { woven: true }, leftover: 9 });
    const spec = {
      layout: { platforms: [1, 2], goal: { id: 'g' }, player: { SHOULD_NOT_WIN: true } },
      systems: ['S1'],
      config: { hazardTimePenalty: 50 },
    };
    const opSpec = {
      to: 'src/levels/L.json',
      assemble: {
        spread: 'layout',
        fields: {
          scene: { value: 'Level1Scene' },
          systems: 'systems',
          hitTimePenalty: { from: 'config.hazardTimePenalty', default: 0 },
          player: '@entity:weave the player',
        },
      },
    };
    const res = await applyProjectionOp('runtimeData', opSpec, spec, tmp);
    expect(res.op).toBe('assemble');
    expect(res.modelOwns).toEqual(['player']);
    expect(await readJson(path.join(tmp, 'src/levels/L.json'))).toEqual({
      scene: 'Level1Scene',
      player: { woven: true },
      leftover: 9,
      platforms: [1, 2],
      goal: { id: 'g' },
      systems: ['S1'],
      hitTimePenalty: 50,
    });
  });

  it('falls back to the spread skeleton when no on-disk file exists', async () => {
    tmp = await mkTmp();
    const spec = { layout: { a: 1, b: 2 }, systems: ['x'] };
    const res = await applyProjectionOp(
      'rt',
      { to: 'lvl.json', assemble: { spread: 'layout', fields: { systems: 'systems' } } },
      spec,
      tmp,
    );
    expect(res.wrote).toBe(true);
    expect(await readJson(path.join(tmp, 'lvl.json'))).toEqual({ a: 1, b: 2, systems: ['x'] });
  });

  it('DROPS a deterministic string-path field whose source is absent (no seed leak)', async () => {
    tmp = await mkTmp();
    await writeJson(path.join(tmp, 'lvl.json'), { brickGrid: { placeholder: true }, keep: 1 });
    const spec = { layout: { bricks: [1, 2, 3] } };
    const opSpec = {
      to: 'lvl.json',
      assemble: { spread: 'layout', fields: { bricks: 'layout.bricks', brickGrid: 'layout.brickGrid' } },
    };
    await applyProjectionOp('rt', opSpec, spec, tmp);
    const out = (await readJson(path.join(tmp, 'lvl.json'))) as Record<string, unknown>;
    expect('brickGrid' in out).toBe(false);
    expect(out.bricks).toEqual([1, 2, 3]);
    expect(out.keep).toBe(1);
  });

  it('DROPS a {from} field whose source is absent AND has no default', async () => {
    tmp = await mkTmp();
    await writeJson(path.join(tmp, 'o.json'), { ghost: 'SEED', real: 0 });
    const spec = { cfg: { real: 7 } };
    const opSpec = {
      to: 'o.json',
      assemble: { fields: { real: { from: 'cfg.real', default: -1 }, ghost: { from: 'cfg.ghost' } } },
    };
    await applyProjectionOp('rt', opSpec, spec, tmp);
    const out = (await readJson(path.join(tmp, 'o.json'))) as Record<string, unknown>;
    expect('ghost' in out).toBe(false);
    expect(out.real).toBe(7);
  });

  it('APPLIES a {from} default when the source is absent (the drop must NOT over-reach)', async () => {
    tmp = await mkTmp();
    const spec = { cfg: {} };
    await applyProjectionOp(
      'rt',
      { to: 'd.json', assemble: { fields: { speed: { from: 'cfg.speed', default: 99 } } } },
      spec,
      tmp,
    );
    expect(await readJson(path.join(tmp, 'd.json'))).toEqual({ speed: 99 });
  });
});

// ---------- merge (the projection merge: .value overwrite + literal coalesce) ----------
describe('applyProjectionOp — merge', () => {
  it('overwrites .value of seeded group keys + sets top-level literals (coalesce + absent→"")', async () => {
    tmp = await mkTmp();
    await writeJson(path.join(tmp, 'src/gameConfig.json'), {
      playerConfig: {
        gravityY: { value: 1, type: 'number', description: 'g' },
        jumpPower: { value: 2, type: 'number', description: 'j' },
        unrelatedKept: { value: 99, type: 'number', description: 'keep' },
      },
      otherGroup: { foo: { value: 'bar' } },
    });
    const spec = {
      config: { gravityY: 1180, jumpPower: 620, notInGroup: 7 },
      meta: { failModel: 'respawn' },
      controls: [{ input: 'A', action: 'left' }],
      winCondition: { description: 'win!' },
    };
    const opSpec = {
      to: 'src/gameConfig.json',
      merge: {
        wrapInto: 'playerConfig',
        from: 'config',
        literals: {
          failModel: 'meta.failModel',
          controlsHelp: 'controls',
          objective: ['meta.objective', 'winCondition.description'],
          missingLiteral: 'nowhere.at.all',
        },
      },
    };
    const res = await applyProjectionOp('gameConfig', opSpec, spec, tmp);
    expect(res.op).toBe('merge');
    const out = (await readJson(path.join(tmp, 'src/gameConfig.json'))) as any;
    expect(out.playerConfig.gravityY.value).toBe(1180);
    expect(out.playerConfig.jumpPower.value).toBe(620);
    expect(out.playerConfig.unrelatedKept.value).toBe(99);
    expect('notInGroup' in out.playerConfig).toBe(false);
    expect(out.otherGroup.foo.value).toBe('bar');
    expect(out.failModel).toBe('respawn');
    expect(out.controlsHelp).toEqual([{ input: 'A', action: 'left' }]);
    expect(out.objective).toBe('win!');
    expect(out.missingLiteral).toBe('');
  });
});

// ---------- unknown op ----------
describe('applyProjectionOp — unknown', () => {
  it('returns a skip for an unrecognized op (no recognized copy|assemble|merge)', async () => {
    tmp = await mkTmp();
    const res = await applyProjectionOp('weird', { to: 'x.json' }, { a: 1 }, tmp);
    expect(res.wrote).toBe(false);
    expect(res.op).toBe('unknown');
  });
});
