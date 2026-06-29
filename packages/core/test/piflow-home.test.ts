// The lazy `~/.piflow` BOOTSTRAP + the tier WRITE side — the round-trip partner of `loadModelTiers`.
//
// `ensurePiflowHome()` is the "check on first run" seed: on a fresh home it creates the dir and writes a
// `model-tiers.json` carrying the three canonical keys (inactive), so `model list` always has something to
// show and tier resolution gives the EXISTING clear errors until configured. It is IDEMPOTENT — a second
// call, or an existing user file, is a NO-OP that NEVER clobbers the user's values. Both the ensure and the
// writer honor `PIFLOW_HOME` (the test seam) so these run in a temp dir, never the real home.
//
// The load-bearing guards: (a) the seed has the 3 canonical keys + active:false; (b) an existing file's
// values SURVIVE a second ensure (the clobber guard — test-the-test mutates the seed to overwrite); (d) the
// `writeModelTiers`→`loadModelTiers` round-trip is exact; (e) after a CLI-style write the RUNNER's
// `resolveNodeModel` resolves a node's tier to the freshly-written model — proving the CLI writes EXACTLY
// what the runner reads (same `{active,tiers}` shape, same file).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeModelTiers,
  loadModelTiers,
  resolveNodeModel,
  CANONICAL_TIERS,
  type ModelTiers,
} from '../src/runner/model-routing.js';
import { ensurePiflowHome, globalDir } from '../src/observe/registry.js';

let HOME: string;
let SAVED: string | undefined;
beforeEach(async () => {
  HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-home-'));
  SAVED = process.env.PIFLOW_HOME;
  // Point the global home at the temp dir so ensure/globalDir never touch the real ~/.piflow.
  process.env.PIFLOW_HOME = HOME;
});
afterEach(async () => {
  if (SAVED === undefined) delete process.env.PIFLOW_HOME;
  else process.env.PIFLOW_HOME = SAVED;
  await fs.rm(HOME, { recursive: true, force: true });
});

const tiersFile = (): string => path.join(globalDir(), 'model-tiers.json');

describe('ensurePiflowHome — the first-run seed', () => {
  it('(a) on an empty home, creates the dir and seeds the 3 canonical keys with active:false', async () => {
    // Start truly empty: remove the mkdtemp dir so ensure must create it.
    await fs.rm(HOME, { recursive: true, force: true });
    expect(existsSync(HOME)).toBe(false);

    ensurePiflowHome();

    expect(existsSync(globalDir())).toBe(true);
    const seeded = loadModelTiers(tiersFile());
    expect(seeded.active).toBe(false);
    // The three canonical keys are all PRESENT (so `model list` shows them) — order-independent.
    expect(Object.keys(seeded.tiers).sort()).toEqual([...CANONICAL_TIERS].sort());
  });

  it('(b) is a NO-OP when the tiers file exists — NEVER clobbers the user values', async () => {
    // A user already configured their tiers (active + real model ids).
    const userTiers: ModelTiers = { active: true, tiers: { fast: 'my-fast', balanced: 'my-mid', deep: 'my-deep' } };
    writeModelTiers(userTiers, tiersFile());

    ensurePiflowHome();

    // The user's exact values survive — the seed did not overwrite them.
    expect(loadModelTiers(tiersFile())).toEqual(userTiers);
  });
});

describe('writeModelTiers — the round-trip partner of loadModelTiers (behavior d)', () => {
  it('(d) writeModelTiers then loadModelTiers returns the SAME object', () => {
    const tiers: ModelTiers = { active: true, tiers: { fast: 'deepseek-v3', balanced: 'sonnet', deep: 'claude-opus-4-8' } };
    writeModelTiers(tiers, tiersFile());
    expect(loadModelTiers(tiersFile())).toEqual(tiers);
  });

  it('mkdir -p the home: writes into a not-yet-existing dir', async () => {
    await fs.rm(HOME, { recursive: true, force: true });
    const tiers: ModelTiers = { active: false, tiers: { fast: '', balanced: '', deep: '' } };
    writeModelTiers(tiers, tiersFile());
    expect(loadModelTiers(tiersFile())).toEqual(tiers);
  });
});

describe('CLI write ↔ runner read (behavior e — the runner reads exactly what the CLI writes)', () => {
  it('(e) after a write that sets tiers.deep + active, resolveNodeModel resolves a node.tier to that model', () => {
    // Stand in for `piflowctl model set deep claude-opus-4-8` (active:true) writing the canonical file.
    const written: ModelTiers = { active: true, tiers: { fast: '', balanced: '', deep: 'claude-opus-4-8' } };
    writeModelTiers(written, tiersFile());

    // The runner reads that same file (read side) and resolves a node pinned to the `deep` tier.
    const tiers = loadModelTiers(tiersFile());
    const eff = resolveNodeModel({ tier: 'deep' }, { tiers });
    expect(eff.model).toBe('claude-opus-4-8');
  });
});

// A sanity check the seed file is valid JSON on disk (not just round-trip-parseable) — guards a malformed write.
describe('seed shape on disk', () => {
  it('writes pretty JSON ending in a newline', () => {
    writeModelTiers({ active: false, tiers: { fast: '', balanced: '', deep: '' } }, tiersFile());
    const raw = readFileSync(tiersFile(), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
