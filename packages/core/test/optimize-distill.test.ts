// Contract for optimize/distill.ts — the DISTILLATION SEAM that turns MEMORIZE's `(pending …)` Root/Prevention
// placeholders into real distilled prose (piflow-memory-v1.5 §6; memory-slices MODE B "the model only distills").
// TWO halves: `fillLessonProse` is the DETERMINISTIC writer (locate the block at `sig:`, replace only the provided
// **Root:**/**Prevention:** lines, preserve everything else, idempotent, no-op on a missing file/sig); `distillLesson`
// is the async orchestrator that calls an INJECTED distiller (the model call — core holds NO model/network/prompt)
// then fills, DEGRADING to 'skipped' (block left intact) when the distiller throws or returns empty. The oracle is
// the ROUND-TRIP: after filling, `deriveRecurrence` reads back the new lesson.root/lesson.prevention.
//
// Run: npx vitest run packages/core/test/optimize-distill.test.ts

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memorize } from '../src/optimize/memorize.js';
import { fillLessonProse, distillLesson } from '../src/optimize/distill.js';
import type { LessonDistiller } from '../src/optimize/distill.js';
import { signatureOf, deriveRecurrence } from '../src/optimize/recurrence.js';
import type { NodeScore, Defect } from '../src/optimize/types.js';

// ── temp-dir plumbing (real fs; no mocks) ────────────────────────────────────────────────────────────────
const tmpDirs: string[] = [];
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'piflow-distill-'));
  tmpDirs.push(d);
  return d;
};
afterEach(async () => {
  const { rmSync } = await import('node:fs');
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// A LAPSE-shaped NodeScore + its defect (signature `flaky::failed`) — MEMORIZE writes a placeholder block for it.
const lapseScore = (node = 'flaky'): NodeScore => ({
  node,
  tier0: { anomalies: [], disqualified: true, reason: 'failed' },
  tier1: null,
  scalar: 0,
  abstained: false,
});
const lapseDefect = (node = 'flaky'): Defect => ({
  node,
  bucket: 'LAPSE',
  symptom: `${node} failed with no code-level signal`,
  evidence: [`anomalies:none`],
  confidence: 'low',
});

// Lay out `<runsDir>/<id>/optimize/`; return the run dir.
const makeRunDir = (runsDir: string, id: string): string => {
  const runDir = join(runsDir, id);
  mkdirSync(join(runDir, 'optimize'), { recursive: true });
  return runDir;
};

// Slice out the `### ` lesson block that carries `sig: <sig>` (same boundary rule the reader uses: `### ` opens,
// `### `/`## `/EOF closes) — so a whole-file marker in the seed's grammar comment can't confound a block assertion.
const extractBlock = (body: string, sig: string): string => {
  const lines = body.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trimStart();
    const isH3 = t.startsWith('### ');
    const isBoundary = isH3 || t.startsWith('## ');
    if (isBoundary && start >= 0) {
      if (lines.slice(start, i).some((l) => l.trim() === `sig: ${sig}`)) return lines.slice(start, i).join('\n');
      start = isH3 ? i : -1;
    } else if (isH3 && start < 0) {
      start = i;
    }
  }
  if (start >= 0 && lines.slice(start).some((l) => l.trim() === `sig: ${sig}`)) return lines.slice(start).join('\n');
  throw new Error(`no block for sig ${sig}`);
};

// Write a placeholder block via the real MEMORIZE writer; return { templateDir, memPath, sig }.
const seedPlaceholderBlock = () => {
  const root = scratch();
  const runsDir = join(root, 'runs');
  const templateDir = join(root, 'template');
  memorize([lapseScore()], [lapseDefect()], { runDir: makeRunDir(runsDir, 'run-1'), templateDir });
  const memPath = join(templateDir, 'nodes', 'flaky', 'memory.md');
  const sig = signatureOf(lapseScore()); // flaky::failed
  return { templateDir, memPath, sig };
};

describe('fillLessonProse — the deterministic writer (replace only the provided **Root:**/**Prevention:** lines)', () => {
  it('(a) replaces the placeholders with distilled text and deriveRecurrence reads it back', () => {
    const { templateDir, memPath, sig } = seedPlaceholderBlock();

    // precondition: the block starts with the honest placeholders (not the distilled prose).
    const before = readFileSync(memPath, 'utf8');
    expect(before).toContain('**Root:** (pending');
    expect(before).toContain('**Prevention:** (pending');

    fillLessonProse(memPath, sig, {
      root: 'the executor emitted an empty artifact before the write barrier',
      prevention: 'assert artifact.length > 0 in the node gate before landing',
    });

    // the ORACLE: the shipped reader now sees the distilled prose at this sig.
    const hit = deriveRecurrence({ templateDir, nodes: ['flaky'] }).get(sig);
    expect(hit?.lesson?.root).toBe('the executor emitted an empty artifact before the write barrier');
    expect(hit?.lesson?.prevention).toBe('assert artifact.length > 0 in the node gate before landing');
    // the placeholders are gone.
    const after = readFileSync(memPath, 'utf8');
    expect(after).not.toContain('(pending');
  });

  it('(a2) fills ONLY the provided field, leaving the other placeholder intact', () => {
    const { templateDir, memPath, sig } = seedPlaceholderBlock();

    fillLessonProse(memPath, sig, { root: 'root only, no prevention this pass' });

    const hit = deriveRecurrence({ templateDir, nodes: ['flaky'] }).get(sig);
    expect(hit?.lesson?.root).toBe('root only, no prevention this pass');
    // prevention was NOT provided ⇒ its placeholder line survives verbatim.
    const after = readFileSync(memPath, 'utf8');
    expect(after).toContain('**Prevention:** (pending');
  });

  it('(b) preserves sig / recurrence / [[okf]] and all other block content', () => {
    const { templateDir, memPath, sig } = seedPlaceholderBlock();
    // inject an okf link into the block so we can prove it survives the prose fill.
    const withOkf = readFileSync(memPath, 'utf8').replace(`sig: ${sig}`, `sig: ${sig}\n[[runner]]`);
    writeFileSync(memPath, withOkf, 'utf8');

    fillLessonProse(memPath, sig, { root: 'R', prevention: 'P' });

    const after = readFileSync(memPath, 'utf8');
    expect(after).toContain(`sig: ${sig}`);
    expect(after).toContain('recurrence: 1');
    expect(after).toContain('[[runner]]');
    // the reader still resolves every field of the lesson.
    const hit = deriveRecurrence({ templateDir, nodes: ['flaky'] }).get(sig);
    expect(hit?.count).toBe(1);
    expect(hit?.lesson?.okfSlice).toBe('runner');
    expect(hit?.lesson?.root).toBe('R');
    expect(hit?.lesson?.prevention).toBe('P');
  });

  it('(c) idempotent: re-filling updates in place with no duplicate Root/Prevention lines', () => {
    const { templateDir, memPath, sig } = seedPlaceholderBlock();

    fillLessonProse(memPath, sig, { root: 'first', prevention: 'first-p' });
    fillLessonProse(memPath, sig, { root: 'second', prevention: 'second-p' });

    // the LESSON BLOCK carries exactly ONE **Root:** + ONE **Prevention:** line (re-fill REPLACES, never appends).
    // (Count within the block: the seed skeleton's grammar COMMENT also mentions the markers, so counting the whole
    //  file would be wrong — the invariant is one marker per block, and the reader only reads the block.)
    const lessonBlock = extractBlock(readFileSync(memPath, 'utf8'), sig);
    expect(lessonBlock.split('**Root:**').length - 1).toBe(1);
    expect(lessonBlock.split('**Prevention:**').length - 1).toBe(1);

    // the ORACLE agrees the block resolves to exactly the SECOND fill's prose (last-write-wins, no stale carry).
    const hit = deriveRecurrence({ templateDir, nodes: ['flaky'] }).get(sig);
    expect(hit?.lesson?.root).toBe('second');
    expect(hit?.lesson?.prevention).toBe('second-p');
  });

  it('(no-op) a missing file is a silent no-op (never throws)', () => {
    const dir = scratch();
    const ghost = join(dir, 'nodes', 'ghost', 'memory.md');
    expect(() => fillLessonProse(ghost, 'ghost::x', { root: 'r' })).not.toThrow();
  });

  it('(no-op) an absent sig leaves the file byte-for-byte unchanged', () => {
    const { memPath } = seedPlaceholderBlock();
    const before = readFileSync(memPath, 'utf8');
    fillLessonProse(memPath, 'flaky::does-not-exist', { root: 'r', prevention: 'p' });
    expect(readFileSync(memPath, 'utf8')).toBe(before);
  });
});

describe('distillLesson — the injected-distiller orchestrator (degrade gracefully; core holds no model call)', () => {
  it('(f) a real distiller fills the block and round-trips through deriveRecurrence', async () => {
    const { templateDir, memPath, sig } = seedPlaceholderBlock();
    const distiller: LessonDistiller = async () => ({ root: 'distilled root', prevention: 'distilled guard' });

    const outcome = await distillLesson(memPath, sig, lapseDefect(), distiller);

    expect(outcome).toBe('filled');
    const hit = deriveRecurrence({ templateDir, nodes: ['flaky'] }).get(sig);
    expect(hit?.lesson?.root).toBe('distilled root');
    expect(hit?.lesson?.prevention).toBe('distilled guard');
  });

  it('(d) a THROWING distiller leaves the placeholders intact and returns "skipped" (MEMORIZE never crashes)', async () => {
    const { memPath, sig } = seedPlaceholderBlock();
    const before = readFileSync(memPath, 'utf8');
    const distiller: LessonDistiller = async () => {
      throw new Error('model timed out at 20min');
    };

    const outcome = await distillLesson(memPath, sig, lapseDefect(), distiller);

    expect(outcome).toBe('skipped');
    // the block is untouched — the honest placeholders survive a bad distiller.
    expect(readFileSync(memPath, 'utf8')).toBe(before);
  });

  it('(e) an EMPTY / whitespace-only distiller return also skips (no write, placeholders intact)', async () => {
    const { memPath, sig } = seedPlaceholderBlock();
    const before = readFileSync(memPath, 'utf8');
    const distiller: LessonDistiller = async () => ({ root: '   ', prevention: '' });

    const outcome = await distillLesson(memPath, sig, lapseDefect(), distiller);

    expect(outcome).toBe('skipped');
    expect(readFileSync(memPath, 'utf8')).toBe(before);
  });

  it('the distiller receives the defect (and optional foundRoot) — the injection contract', async () => {
    const { memPath, sig } = seedPlaceholderBlock();
    let seen: { node?: string; foundRoot?: string } = {};
    const distiller: LessonDistiller = async ({ defect, foundRoot }) => {
      seen = { node: defect.node, foundRoot };
      return { root: 'r', prevention: 'p' };
    };

    await distillLesson(memPath, sig, lapseDefect(), distiller, { foundRoot: 'traced: empty artifact' });

    expect(seen.node).toBe('flaky');
    expect(seen.foundRoot).toBe('traced: empty artifact');
  });
});
