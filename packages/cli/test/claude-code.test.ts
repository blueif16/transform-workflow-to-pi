// `piflowctl claude-code connect` — capture the Claude Code subscription OAuth token (from `claude
// setup-token`) and PERSIST it to ~/.piflow/claude-code.json, the explicit, portable credential the core
// resolver prefers (runner/claude-executor.ts resolveClaudeOAuthToken: env → ~/.piflow file → keychain).
//
// Two PURE units carry the logic (no fs, exhaustively testable): `resolveConnectToken` (the source
// precedence) and `claudeCodeCredJson` (the on-disk shape). `writeClaudeCodeCred` is the thin fs boundary —
// pinned here for the load-bearing SECURITY property (mode 0600: a token file must never be world-readable).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveConnectToken,
  claudeCodeCredJson,
  writeClaudeCodeCred,
  homeClaudeCodeFile,
} from '../src/claude-code.js';

describe('resolveConnectToken — source precedence (--token > env)', () => {
  it('the explicit --token wins over the env var', () => {
    expect(resolveConnectToken({ token: 'flagtok', env: 'envtok' })).toBe('flagtok');
  });

  it('falls back to CLAUDE_CODE_OAUTH_TOKEN when no --token', () => {
    expect(resolveConnectToken({ token: undefined, env: 'envtok' })).toBe('envtok');
  });

  it('an EMPTY / whitespace token is treated as absent (an empty token is "not logged in")', () => {
    // The credential model proved an empty token = absent; it must never be persisted as a real value.
    expect(resolveConnectToken({ token: '   ', env: '' })).toBeUndefined();
    expect(resolveConnectToken({ token: '', env: undefined })).toBeUndefined();
  });

  it('trims surrounding whitespace (a pasted token often carries a trailing newline)', () => {
    expect(resolveConnectToken({ token: '  tok-123\n', env: undefined })).toBe('tok-123');
  });
});

describe('claudeCodeCredJson — the on-disk shape the core resolver reads', () => {
  it('is { oauthToken } JSON (the exact key tokenFromPiflowFile parses)', () => {
    expect(JSON.parse(claudeCodeCredJson('tok-abc'))).toEqual({ oauthToken: 'tok-abc' });
  });
});

describe('homeClaudeCodeFile — mirrors core defaultClaudeCodeCredFile', () => {
  it('resolves to <home>/.piflow/claude-code.json', () => {
    expect(homeClaudeCodeFile('/tmp/fakehome')).toBe('/tmp/fakehome/.piflow/claude-code.json');
  });
});

describe('writeClaudeCodeCred — fs boundary (content + 0600)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-cc-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes the {oauthToken} json AND chmods 0600 (a secret file must not be world-readable)', async () => {
    const file = path.join(dir, '.piflow', 'claude-code.json');
    await writeClaudeCodeCred('tok-secret', file);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ oauthToken: 'tok-secret' });
    const mode = (await fs.stat(file)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
