import { describe, it, expect, beforeAll } from 'vitest';

import { loadAllOpenClawPlugins, type LoadedOpenClawPlugin } from '../src/tools/openclaw-host.js';

// ── S1 INTEGRATION TEST — register EVERY installed tool-bearing OpenClaw plugin on the host ──────────
//
// This is NOT a unit test of a mock. It discovers every `node_modules/openclaw/dist/extensions/*/
// openclaw.plugin.json` whose `contracts.tools` is non-empty, imports each REAL plugin entry, runs its
// REAL `register(api)` against our host's `api`, and records what tools it captured. S0 proved the
// execute-driver on ONE keyless tool; S1 proves the REGISTRATION guarantee on ALL of them: "works on one
// → works on all", made observable.
//
// THE MEANINGFUL CROSS-CHECK (what fails if the loader doesn't really drive register): for every plugin
// reported `registered`, its `capturedTools` must be a SUPERSET of its manifest `contracts.tools`. A
// loader that imports the module but never calls `register(api)` captures ZERO tools — so this assertion
// goes RED. The tool names are not in the manifest's reach of the loader except via the real register
// body (OpenClaw's `registerTool` carries the name on the def/opts/produced-tool), so the only way to
// produce the right names is to actually run register and capture across all 3 registerTool shapes.
//
// HONESTY: a plugin whose `register` reaches a runtime SERVICE we must not fake at register time is
// reported `needs-runtime` with the exact reached path — NEVER caught-and-counted-as-registered. The
// expected status table below pins each plugin, so a regression (registered→needs-runtime, or vice-versa)
// fails the test.

// The discovered tool-bearing set — pin it so a discovery regression (a new bundled plugin, or one
// dropped on a version bump) fails LOUDLY rather than silently changing breadth.
const EXPECTED_DISCOVERED_IDS = [
  'browser',
  'canvas',
  'codex-supervisor',
  'file-transfer',
  'llm-task',
  'memory-core',
  'memory-wiki',
  'tavily',
  'workboard',
  'xai',
].sort();

// The known per-plugin status table (S1 outcome). Every installed tool-bearing plugin registers clean on
// the host once we add the register-time-SAFE no-op verbs it declares (gateway-methods, http-routes,
// node-invoke-policies, memory supplements, lifecycle hooks, media/provider declarations) — none of which
// returns a service the tool's execute consumes. If a future version makes one reach a real runtime
// service at register time, this table is what turns it red.
const EXPECTED_STATUS: Record<string, LoadedOpenClawPlugin['status']> = {
  browser: 'registered',
  canvas: 'registered',
  'codex-supervisor': 'registered',
  'file-transfer': 'registered',
  'llm-task': 'registered',
  'memory-core': 'registered',
  'memory-wiki': 'registered',
  tavily: 'registered',
  workboard: 'registered',
  xai: 'registered',
};

let loaded: LoadedOpenClawPlugin[];
let byId: Map<string, LoadedOpenClawPlugin>;

beforeAll(async () => {
  loaded = await loadAllOpenClawPlugins();
  byId = new Map(loaded.map((p) => [p.id, p]));
});

describe('loadAllOpenClawPlugins — S1: registration breadth over all installed tool-bearing plugins', () => {
  it('discovers exactly the expected tool-bearing plugin set from the installed dist manifests', () => {
    const got = loaded.map((p) => p.id).sort();
    // Equality (not superset): a discovery regression in EITHER direction must fail.
    expect(got).toEqual(EXPECTED_DISCOVERED_IDS);
  });

  it('declares a non-empty tool set for every discovered plugin (from its manifest contracts.tools)', () => {
    for (const p of loaded) {
      expect(p.declaredTools.length, `${p.id} should declare >=1 tool`).toBeGreaterThan(0);
    }
  });

  it("captures each registered plugin's full declared tool set (the real-register cross-check)", () => {
    // THIS is the assertion that goes RED if register isn't actually driven: a loader that skips
    // `register(api)` captures zero tools, so the superset check fails for every plugin.
    for (const p of loaded) {
      if (p.status !== 'registered') continue;
      const missing = p.declaredTools.filter((t) => !p.capturedTools.includes(t));
      expect(missing, `${p.id}: capturedTools must be a superset of manifest contracts.tools`).toEqual(
        [],
      );
      // A registered plugin must capture SOMETHING — guards against a silent zero-tool register.
      expect(p.capturedTools.length, `${p.id} registered but captured no tools`).toBeGreaterThan(0);
    }
  });

  it('matches the known per-plugin status table (a status regression fails loudly)', () => {
    const gotStatus = Object.fromEntries(loaded.map((p) => [p.id, p.status]));
    expect(gotStatus).toEqual(EXPECTED_STATUS);
  });

  it('reports an exact reached path on any needs-runtime plugin (never a swallowed throw)', () => {
    for (const p of loaded) {
      if (p.status === 'needs-runtime') {
        expect(p.detail, `${p.id} needs-runtime must carry the exact reached path`).toBeTruthy();
      }
    }
  });

  // Spot-check the two plugins whose tool NAME only exists on the produced tool (factory(ctx).name),
  // not on the def or opts — these would silently capture zero tools if the loader only read opts.names.
  it('captures factory-named tools (browser, canvas) whose name is on the produced tool, not the opts', () => {
    expect(byId.get('browser')?.capturedTools).toContain('browser');
    expect(byId.get('canvas')?.capturedTools).toContain('canvas');
  });

  // Spot-check a def-named plugin (file-transfer): name on the def object, opts undefined.
  it('captures def-named tools (file-transfer) whose name is on the def object', () => {
    expect(byId.get('file-transfer')?.capturedTools).toEqual(
      expect.arrayContaining(['file_fetch', 'dir_list', 'dir_fetch', 'file_write']),
    );
  });

  // Spot-check an opts.names plugin (workboard): the original S0 shape, with the largest tool set.
  it('captures opts.names tools (workboard) — the largest declared set', () => {
    const wb = byId.get('workboard');
    expect(wb?.capturedTools.length).toBeGreaterThanOrEqual(34);
    expect(wb?.capturedTools).toEqual(expect.arrayContaining(['workboard_list', 'workboard_create']));
  });
});
