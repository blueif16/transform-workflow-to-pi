// Contract for the `piflowctl optimize --fix --binding <module>` seam (piflow-memory-v1.5 §6 driver,
// surfaced on the CLI). The seam INVENTS the product→optimizer injection convention (no precedent existed):
// a product binding module supplies the LIVE stages that cannot live in @piflow/core — `oracle`
// (runMilestoneVerify2 + build), `copyScope`, `fixer` — and the CLI dynamic-imports it (mirroring the
// `@piflow/daytona` sandbox pattern), then COMPOSES the already-tested core pieces: scoreRun → triage →
// mineTaskFromTrace → makeReplayStages → runFixGate → writeStagingManifest. It lands nothing live; it stages.
//
// Tested at the level the seam adds: arg-parse, the dynamic-import LOADER (+ its shape validation), and one
// composition smoke that the loaded binding drives a real FIX→GATE to a staging manifest (scoreRun injected —
// the gs01 fixture carries no .pi telemetry, and scoreRun's trace read is covered elsewhere).
//
// Run: npx vitest run packages/cli/test/optimize-fix-cli.test.ts

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOptimizeFixArgs, loadBinding, runOptimizeFixCli } from '../src/optimize-fix.js';
import { scoreNodes } from '@piflow/core';
import type { RunDigest, NodeDigest, Tier1Result, Tier1Check } from '@piflow/core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, 'fixtures', 'fake-binding.mjs');
const BAD = path.join(HERE, 'fixtures', 'bad-binding.mjs');

describe('parseOptimizeFixArgs', () => {
  it('parses the run dir, the required --binding, and the bound/policy flags', () => {
    const a = parseOptimizeFixArgs(['runs/gs01', '--fix', '--binding', './b.mjs', '--staging-dir', '/tmp/s', '--auto-adopt', '--edit-budget', '2', '--token-budget', '500']);
    expect(a.dir).toBe('runs/gs01');
    expect(a.binding).toBe('./b.mjs');
    expect(a.stagingDir).toBe('/tmp/s');
    expect(a.autoAdopt).toBe(true);
    expect(a.editBudget).toBe(2);
    expect(a.tokenBudget).toBe(500);
  });

  it('defaults auto-adopt OFF and leaves budgets unset when not given', () => {
    const a = parseOptimizeFixArgs(['runs/gs01', '--binding', './b.mjs']);
    expect(a.autoAdopt).toBe(false);
    expect(a.editBudget).toBeUndefined();
    expect(a.tokenBudget).toBeUndefined();
  });
});

describe('loadBinding — the dynamic-import seam', () => {
  it('loads a binding module exporting { oracle, copyScope, fixer }', async () => {
    const b = await loadBinding(FAKE);
    expect(typeof b.oracle).toBe('function');
    expect(typeof b.copyScope).toBe('function');
    expect(typeof b.fixer).toBe('function');
  });

  it('rejects a module missing a required stage with a clear error', async () => {
    await expect(loadBinding(BAD)).rejects.toThrow(/fixer/i);
  });

  it('rejects an unresolvable binding path with an actionable error', async () => {
    await expect(loadBinding(path.join(HERE, 'fixtures', 'does-not-exist.mjs'))).rejects.toThrow(/binding/i);
  });
});

// ── one composition smoke: the loaded binding drives a real FIX→GATE to a staging manifest ──────────────────
const dnode = (id: string): NodeDigest => ({
  id, label: id, phase: null, outcome: 'ok', model: null, provider: null,
  durationMs: null, expectedMs: null, slowRatio: null, inputTokens: 0, outputTokens: 0, cost: 0,
  contextPeak: 0, contextWindow: null, contextPct: null, modelCalls: 0, toolCalls: 0, topTools: {},
  maxToolRepeat: 0, repeatedTool: null, retries: 0, stopReason: null, truncated: false, missing: [], issues: [], anomalies: [],
});
const t1 = (milestoneId: string, checks: Tier1Check[]): Tier1Result =>
  ({ milestoneId, marker: 'VALIDATION_FAILED', passed: false, abstained: false, checks, scalar: checks.filter((c) => c.passed).length / checks.length });

describe('runOptimizeFixCli — composition smoke (scoreRun injected)', () => {
  it('drives the loaded binding through FIX→GATE and writes a staging manifest with the accepted (staged) edit', async () => {
    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'optfix-run-'));
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'optfix-stage-'));
    // the incumbent's recorded report the miner reads for baseScore (a real-shaped degraded fail → 0).
    await fs.mkdir(path.join(runDir, 'verify'), { recursive: true });
    await fs.writeFile(path.join(runDir, 'verify', 'report.M2.json'), JSON.stringify({ milestoneId: 'M2', marker: 'VALIDATION_FAILED', passed: false, fixOutcome: 'exhausted' }));

    // inject scoreRun: triage turns this into a FUNCTIONALITY defect on w4-execute-m2 (the trace read is covered elsewhere).
    const digest: RunDigest = {
      run: 'tmp', done: true, ok: true, durationMs: 1,
      totals: { nodes: 1, ok: 1, failed: 0, inputTokens: 0, outputTokens: 0, cost: 0, contextPeak: 0, modelCalls: 0, toolCalls: 0 },
      nodes: [dnode('w4-execute-m2')], anomalies: [], rootCauses: [],
    };
    const tier1ByNode = new Map([['w4-execute-m2', t1('M2', [{ id: 'M2-A3', gate: 'fidelity', passed: false }])]]);
    const fakeScoreRun = async () => ({ scores: scoreNodes({ digest, tier1ByNode }), digest });

    await runOptimizeFixCli(['--fix', runDir, '--binding', FAKE, '--staging-dir', stagingDir], { scoreRun: fakeScoreRun, print: () => {} });

    const manifest = JSON.parse(await fs.readFile(path.join(stagingDir, 'manifest.json'), 'utf8'));
    expect(manifest.summary.accepted).toBe(1); // base 0 → candidate 1.0 (fake oracle passes) → strict improvement
    expect(manifest.records[0].node).toBe('w4-execute-m2');
    expect(manifest.records[0].landed).toBe('staged'); // auto-adopt OFF → the win stages for the human
  });
});
