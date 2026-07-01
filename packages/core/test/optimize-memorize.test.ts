// Contract for optimize/memorize.ts — the MEMORIZE WRITER, the write-counterpart of the recurrence READER
// (piflow-memory-v1.5 §6). At the end of a run it persists the run's tier0-signature defects to a per-run
// `<runDir>/optimize/signatures.json` sidecar, DERIVES each signature's cross-run count from the run trail
// (the number of run dirs whose sidecar carries it — idempotent by construction), and APPENDS/UPDATEs a
// lesson block at `sig:` in the owning node's `memory.md`. The oracle is the ROUND-TRIP: `deriveRecurrence`
// must read back exactly what the writer wrote, and the two-run carry must flip triage LAPSE→SKILL.
//
// Run: npx vitest run packages/core/test/optimize-memorize.test.ts

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorize } from '../src/optimize/memorize.js';
import { signatureOf, deriveRecurrence } from '../src/optimize/recurrence.js';
import { triage } from '../src/optimize/triage.js';
import type { NodeScore, Defect } from '../src/optimize/types.js';
import type { RunDigest } from '../src/observe/telemetry.js';

// ── temp-dir plumbing (real fs; no mocks) ────────────────────────────────────────────────────────────────
const tmpDirs: string[] = [];
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'piflow-memorize-'));
  tmpDirs.push(d);
  return d;
};
afterEach(async () => {
  const { rmSync } = await import('node:fs');
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A LAPSE-shaped NodeScore: a self-originating structural failure, no code signal (tier0 disqualified, no
// tier1) → triage buckets it LAPSE (unless recurrence flips it). Its signature is `flaky::failed`.
const lapseScore = (node = 'flaky'): NodeScore => ({
  node,
  tier0: { anomalies: [], disqualified: true, reason: 'failed' },
  tier1: null,
  scalar: 0,
  abstained: false,
});

// The matching LAPSE defect the projector would emit for the score above.
const lapseDefect = (node = 'flaky'): Defect => ({
  node,
  bucket: 'LAPSE',
  symptom: `${node} failed with no code-level signal`,
  evidence: [`anomalies:none`],
  confidence: 'low',
});

// A FUNCTIONALITY defect — the product code is wrong; OUT of the tier0-signature MVP scope, must NOT be recorded.
const functionalityDefect = (node = 'w4-execute'): Defect => ({
  node,
  bucket: 'FUNCTIONALITY',
  symptom: `${node}: 1/1 checks failed — M2-A3`,
  evidence: [`check:M2-A3`],
  confidence: 'high',
});

const emptyDigest = (): RunDigest => ({
  run: 'r', done: true, ok: false, durationMs: 1,
  totals: { nodes: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, cost: 0, contextPeak: 0, modelCalls: 0, toolCalls: 0 },
  nodes: [], anomalies: [], rootCauses: [],
});

// Lay out `<runsDir>/<id>/` with an empty `optimize/` sidecar dir; return the run dir.
const makeRunDir = (runsDir: string, id: string): string => {
  const runDir = join(runsDir, id);
  mkdirSync(join(runDir, 'optimize'), { recursive: true });
  return runDir;
};

describe('memorize — the MEMORIZE writer (append/update, count derived from the run trail)', () => {
  it('APPEND: a LAPSE defect with no existing lesson writes a block at its sig with recurrence 1 (round-trips through deriveRecurrence)', () => {
    const root = scratch();
    const runsDir = join(root, 'runs');
    const templateDir = join(root, 'template');
    const runDir = makeRunDir(runsDir, 'run-1');

    const res = memorize([lapseScore()], [lapseDefect()], { runDir, templateDir });

    const sig = signatureOf(lapseScore()); // flaky::failed
    // (a) the lesson lands in the node's memory.md, keyed on sig, at recurrence 1.
    const memPath = join(templateDir, 'nodes', 'flaky', 'memory.md');
    expect(existsSync(memPath)).toBe(true);
    const body = readFileSync(memPath, 'utf8');
    expect(body).toContain(`sig: ${sig}`);
    expect(body).toContain('recurrence: 1');

    // (b) the round-trip: the SHIPPED reader sees the block at count 1 — proves the grammar is compatible.
    const idx = deriveRecurrence({ templateDir, nodes: ['flaky'] });
    expect(idx.get(sig)?.count).toBe(1);

    // (c) the returned lesson describes the append.
    expect(res.lessons).toHaveLength(1);
    expect(res.lessons[0]).toMatchObject({ node: 'flaky', sig, recurrence: 1, action: 'append' });
    expect(res.signaturesPath).toBe(join(runDir, 'optimize', 'signatures.json'));
  });

  it('UPDATE / no-duplicate: a 2nd run with the same sig lifts the SAME block to recurrence 2 (exactly one block)', () => {
    const root = scratch();
    const runsDir = join(root, 'runs');
    const templateDir = join(root, 'template');
    const sig = signatureOf(lapseScore());

    memorize([lapseScore()], [lapseDefect()], { runDir: makeRunDir(runsDir, 'run-1'), templateDir });
    const res2 = memorize([lapseScore()], [lapseDefect()], { runDir: makeRunDir(runsDir, 'run-2'), templateDir });

    const body = readFileSync(join(templateDir, 'nodes', 'flaky', 'memory.md'), 'utf8');
    // exactly ONE block for this sig (no duplicate append).
    const occurrences = body.split(`sig: ${sig}`).length - 1;
    expect(occurrences).toBe(1);
    expect(body).toContain('recurrence: 2');
    expect(body).not.toContain('recurrence: 1');
    expect(res2.lessons[0]).toMatchObject({ sig, recurrence: 2, action: 'update' });

    // the reader agrees the count is 2.
    expect(deriveRecurrence({ templateDir, nodes: ['flaky'] }).get(sig)?.count).toBe(2);
  });

  it('IDEMPOTENCY: re-memorizing the SAME runDir does NOT double the count (it is derived from distinct runs, not incremented)', () => {
    const root = scratch();
    const runsDir = join(root, 'runs');
    const templateDir = join(root, 'template');
    const sig = signatureOf(lapseScore());
    const runDir = makeRunDir(runsDir, 'run-1');

    memorize([lapseScore()], [lapseDefect()], { runDir, templateDir });
    const again = memorize([lapseScore()], [lapseDefect()], { runDir, templateDir });

    // one distinct run carries the sig ⇒ count is 1, NOT 2. This FAILS if the writer increments the block.
    expect(again.lessons[0]).toMatchObject({ sig, recurrence: 1 });
    const body = readFileSync(join(templateDir, 'nodes', 'flaky', 'memory.md'), 'utf8');
    expect(body).toContain('recurrence: 1');
    expect(body).not.toContain('recurrence: 2');
    expect(deriveRecurrence({ templateDir, nodes: ['flaky'] }).get(sig)?.count).toBe(1);
  });

  it('SCOPE: a FUNCTIONALITY defect is NOT recorded (no lesson, not persisted to signatures.json)', () => {
    const root = scratch();
    const runsDir = join(root, 'runs');
    const templateDir = join(root, 'template');
    const runDir = makeRunDir(runsDir, 'run-1');

    const funcScore: NodeScore = {
      node: 'w4-execute', tier0: { anomalies: [], disqualified: false }, tier1: null, scalar: 0.5, abstained: false,
    };
    const res = memorize([funcScore], [functionalityDefect('w4-execute')], { runDir, templateDir });

    expect(res.lessons).toHaveLength(0);
    expect(existsSync(join(templateDir, 'nodes', 'w4-execute', 'memory.md'))).toBe(false);
    // persisted, but as an EMPTY array (the FUNCTIONALITY defect is out of tier0-signature scope).
    const persisted = JSON.parse(readFileSync(res.signaturesPath, 'utf8'));
    expect(persisted).toEqual([]);
  });

  it('THE LOOP: memorize run1 (LAPSE) → triage of a 2nd run with the same signature reads the lesson and buckets SKILL', () => {
    const root = scratch();
    const runsDir = join(root, 'runs');
    const templateDir = join(root, 'template');

    // run 1: the writer persists the lesson at recurrence 1.
    memorize([lapseScore()], [lapseDefect()], { runDir: makeRunDir(runsDir, 'run-1'), templateDir });

    // run 2: triage reads the lesson (count 1 ≥ threshold 1) and flips LAPSE → SKILL — no human in the loop.
    const recurrence = deriveRecurrence({ templateDir, nodes: ['flaky'] });
    const defects2 = triage([lapseScore()], emptyDigest(), { recurrence });
    expect(defects2).toHaveLength(1);
    expect(defects2[0].bucket).toBe('SKILL');
  });
});
