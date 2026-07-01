#!/usr/bin/env node
// Contract of the `--check` drift gate: it exits 1 ONLY on a HEALTH failure (a seed/anchor
// file or symbol/line moved — the anchors may be wrong), NEVER on advisory auto-region DRIFT
// (a stale git/memory/blast block, which --write refreshes). See SKILL.md MODE-A step 5.
//
// These run the REAL _generate.mjs against hermetic fixture topic dirs (OKF_TOPICS_DIR seam,
// codegraph off, no memory dir) so the exit code is exercised end-to-end, not a unit stub.
//   run: node --test .agents/okf/topics/_generate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '_generate.mjs');
const CARD = fm => `---\n${fm}\n---\n\n# card\n\nprose.\n`;

// Build a hermetic OKF root: <root>/okf.config.json + <root>/topics/<cards>. Codegraph and
// the memory dir are absent so every derive is deterministic. Returns the topics dir.
function fixture(cards) {
  const root = mkdtempSync(join(tmpdir(), 'okf-gate-'));
  const topics = join(root, 'topics');
  mkdirSync(topics);
  writeFileSync(join(root, 'okf.config.json'),
    JSON.stringify({ repoRoot: '..', memoryDir: join(root, '__absent__'), noise: [], codegraph: null }));
  for (const [name, body] of Object.entries(cards)) writeFileSync(join(topics, name), body);
  return topics;
}
const run = (topics, mode) => {
  const env = { ...process.env, OKF_TOPICS_DIR: topics, OKF_NO_CODEGRAPH: '1' };
  try { execFileSync('node', [SCRIPT, mode], { env, encoding: 'utf8', stdio: 'pipe' }); return 0; }
  catch (e) { return e.status ?? 1; }
};

test('advisory DRIFT alone does NOT block the gate (exit 0)', () => {
  // No auto region on disk → regenerating appends one → next !== text → DRIFT.
  // No seeds and no anchors → HEALTH is clean. The gate must NOT block on drift alone.
  const topics = fixture({ 'a.md': CARD('key: a\naliases: [alpha]') });
  assert.equal(run(topics, '--check'), 0, 'stale auto-region is advisory, must not exit 1');
});

test('HEALTH failure blocks the gate (exit 1)', () => {
  // A missing seed is a HEALTH failure. --write first makes the auto region fresh (drift=0),
  // isolating that HEALTH alone still exits 1.
  const topics = fixture({ 'b.md': CARD('key: b\nseeds: [does/not/exist.ts]') });
  run(topics, '--write');
  assert.equal(run(topics, '--check'), 1, 'a missing seed must block the commit');
});

test('fresh + healthy card is clean (exit 0)', () => {
  const topics = fixture({ 'c.md': CARD('key: c\naliases: [gamma]') });
  run(topics, '--write'); // make the auto region fresh
  assert.equal(run(topics, '--check'), 0, 'no drift + no health issue → clean');
});
