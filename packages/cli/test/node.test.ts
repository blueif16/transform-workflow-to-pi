import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildNodeResumeCommand,
  resolveNodeRunDir,
  runNodeCli,
  type NodeDeps,
} from '../src/node.js';
import { piSessionsDir, journalFile, piDir, type Journal } from '@piflow/core';

// ─────────────────────────────────────────────────────────────────────────────
// (A) buildNodeResumeCommand — the PURE argv builder (no spawn, no fs).
// This is a CONVERSATIONAL warm resume of the node's stored pi session: it RESUMES an
// existing session (`--session <id>`), never CREATES one (`--session-id`).
// ─────────────────────────────────────────────────────────────────────────────
describe('buildNodeResumeCommand — the pure warm-resume argv builder', () => {
  const runDir = '/runs/flaky-pecan';
  const nodeId = 'w1a';

  // Split the built command into argv tokens so flag assertions don't collide with substrings inside
  // shell-quoted paths (e.g. the run name "flaky-pecan" contains "-p"). We assert on TOKENS, not substrings.
  const tokens = (cmd: string): string[] => cmd.match(/'(?:[^'\\]|\\.)*'|\S+/g) ?? [];
  // The value immediately after a flag token (with its surrounding single-quotes stripped).
  const valueAfter = (cmd: string, flag: string): string | undefined => {
    const t = tokens(cmd);
    const i = t.indexOf(flag);
    if (i < 0 || i + 1 >= t.length) return undefined;
    return t[i + 1].replace(/^'(.*)'$/, '$1');
  };

  it('with a message file: stamps --session-dir <piSessionsDir>, --session <nodeId>, @<file>; never --session-id', () => {
    const msgFile = '/tmp/resume-w1a.md';
    const cmd = buildNodeResumeCommand({ runDir, nodeId, messageFile: msgFile, interactive: false });
    const t = tokens(cmd);

    // RESUMES the stored session by id under the per-run session dir.
    expect(t).toContain('--session-dir');
    expect(valueAfter(cmd, '--session-dir')).toBe(piSessionsDir(runDir));
    // It addresses the session by the node id exactly via --session (RESUME), not --session-id (CREATE).
    expect(t).toContain('--session');
    expect(valueAfter(cmd, '--session')).toBe(nodeId);
    // The message is staged as a FILE and referenced with @<file> (the runner's prompt-staging discipline).
    expect(t.some((tok) => tok.replace(/^'(.*)'$/, '$1') === `@${msgFile}` || tok === `@'${msgFile}'`)).toBe(true);
    // RESUME, not CREATE — must NOT emit --session-id (that would start a fresh conversation).
    expect(t).not.toContain('--session-id');
  });

  it('interactive (no message): drops -p / --mode json for a LIVE session, still --session <nodeId>', () => {
    const cmd = buildNodeResumeCommand({ runDir, nodeId, interactive: true });
    const t = tokens(cmd);

    // A live session: NOT headless print-mode (assert on TOKENS — "-p" must not be a flag token).
    expect(t).not.toContain('-p');
    expect(t).not.toContain('--mode');
    expect(t).not.toContain('json');
    // Still resumes THIS node's stored session.
    expect(t).toContain('--session');
    expect(valueAfter(cmd, '--session')).toBe(nodeId);
    expect(t).not.toContain('--session-id');
    // No staged-message ref in an interactive resume.
    expect(t.some((tok) => tok.startsWith('@'))).toBe(false);
  });

  it('with a message but non-interactive (message mode): runs headless -p --mode json', () => {
    const cmd = buildNodeResumeCommand({ runDir, nodeId, messageFile: '/tmp/m.md', interactive: false });
    const t = tokens(cmd);
    expect(t).toContain('-p');
    expect(t).toContain('--mode');
    expect(t).toContain('json');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) resolveNodeRunDir — reuse run.ts's `.piflow/<wf>/runs/<id>` convention.
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveNodeRunDir — run-dir resolution reuses run.ts conventions', () => {
  let TMP: string;
  beforeEach(async () => {
    TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-node-resolve-'));
  });
  afterEach(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
  });

  it('a --run <id> under .piflow/<wf>/runs/<id> resolves to that run dir; session dir is piSessionsDir(it)', async () => {
    // Lay down a canonical layout: <cwd>/.piflow/<wf>/runs/<id>/.pi/run.json
    const wf = 'game-omni';
    const runId = 'flaky-pecan';
    const runDir = path.join(TMP, '.piflow', wf, 'runs', runId);
    await fs.mkdir(piDir(runDir), { recursive: true });
    await fs.writeFile(journalFile(runDir), JSON.stringify({ version: 3, runId, source: wf, nodes: {} }));

    const resolved = resolveNodeRunDir({ run: runId, cwd: TMP });
    expect(resolved).toBe(runDir);
    // The session dir the resume addresses is piSessionsDir of the RESOLVED run dir.
    expect(piSessionsDir(resolved)).toBe(path.join(runDir, '.pi-sessions'));
  });

  it('a direct path to a run dir resolves to itself', async () => {
    const runDir = path.join(TMP, 'out', 'some-run');
    await fs.mkdir(piDir(runDir), { recursive: true });
    const resolved = resolveNodeRunDir({ run: runDir, cwd: TMP });
    expect(resolved).toBe(path.resolve(runDir));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (C) runNodeCli --resume — the GUARD: a node with no recorded sessionId FAILS
// with an actionable error naming the resumable nodes, and NEVER spawns.
// ─────────────────────────────────────────────────────────────────────────────
describe('runNodeCli --resume — resolve + guard', () => {
  let TMP: string;
  let spawned: string[];
  let errs: string[];

  function deps(journal: Journal | null, runDir: string): NodeDeps {
    spawned = [];
    errs = [];
    return {
      loadJournal: async () => journal,
      resolveRunDir: () => runDir,
      spawnResume: (cmd: string) => {
        spawned.push(cmd);
        return 0;
      },
      writeMessageFile: async () => '/tmp/msg.md',
      print: () => {},
      error: (s: string) => errs.push(s),
    };
  }

  beforeEach(async () => {
    TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-node-guard-'));
  });
  afterEach(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
  });

  it('a node with NO recorded sessionId fails with an actionable error naming resumable nodes, and does not spawn', async () => {
    const journal: Journal = {
      version: 3,
      runId: 'r',
      source: 'wf',
      nodes: {
        w0: { hash: 'sha256:x', inputHashes: {}, outputHashes: {}, status: 'ok', producedAt: 't', sessionId: 'w0', sessionDir: piSessionsDir(TMP) },
        w1: { hash: 'sha256:y', inputHashes: {}, outputHashes: {}, status: 'ok', producedAt: 't' }, // NO sessionId
      },
    };
    const code = await runNodeCli(['r', 'w1', '--resume'], deps(journal, TMP));

    expect(code).not.toBe(0); // fails
    expect(spawned).toHaveLength(0); // never spawned
    const msg = errs.join('\n');
    expect(msg).toContain('w1'); // names the requested node
    expect(msg.toLowerCase()).toContain('no'); // "no recorded/stored session …"
    expect(msg).toContain('w0'); // names the RESUMABLE node(s)
  });

  it('a node WITH a recorded sessionId spawns a resume command (does not error)', async () => {
    const journal: Journal = {
      version: 3,
      runId: 'r',
      source: 'wf',
      nodes: {
        w0: { hash: 'sha256:x', inputHashes: {}, outputHashes: {}, status: 'ok', producedAt: 't', sessionId: 'w0', sessionDir: piSessionsDir(TMP) },
      },
    };
    const code = await runNodeCli(['r', 'w0', '--resume', '-m', 'continue please'], deps(journal, TMP));

    expect(code).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toContain('--session');
    expect(spawned[0]).toContain('w0');
    expect(errs).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (D) runNodeCli --stop — the HONEST not-yet-supported path (no PID tracking exists).
// ─────────────────────────────────────────────────────────────────────────────
describe('runNodeCli --stop — honest not-yet-supported (no per-node PID tracking in --detach)', () => {
  it('exits non-zero with a clear message that stop needs per-node PID tracking, and does not spawn', async () => {
    const spawned: string[] = [];
    const errs: string[] = [];
    const code = await runNodeCli(['r', 'w0', '--stop'], {
      loadJournal: async () => null,
      resolveRunDir: () => '/runs/r',
      spawnResume: (cmd) => {
        spawned.push(cmd);
        return 0;
      },
      writeMessageFile: async () => '/tmp/m.md',
      print: () => {},
      error: (s) => errs.push(s),
    });

    expect(code).not.toBe(0);
    expect(spawned).toHaveLength(0);
    const msg = errs.join('\n').toLowerCase();
    expect(msg).toContain('not yet supported');
    expect(msg).toContain('pid'); // names the missing capability
  });
});
