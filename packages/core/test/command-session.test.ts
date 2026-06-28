// defaultPiCommand — per-node SESSION flag emission (PURE LOGIC gate, test-discipline §0).
//
// Warm-resume foundation (docs/research/2026-06-28-warm-resume-pi-surfaces.md §4a): the command builder
// threads an OPTIONAL `opts.session = { dir, id, resume? }`. Mutually exclusive with `--no-session`:
//   - NO session opts        → keep `--no-session` (today's ephemeral default, backward-compatible).
//   - session, create (1st)  → `--session-dir <dir> --session-id <id>`, NO `--no-session`.
//   - session, resume        → `--session-dir <dir> --session <id>`     , NO `--no-session`, NO `--session-id`.
//
// These FAIL before the wiring (the builder always emits `--no-session` and never reads `opts.session`).

import { describe, it, expect } from 'vitest';
import { defaultPiCommand } from '../src/runner/command.js';
import type { NodeSpec, ResolveResult } from '../src/types.js';

// defaultPiCommand reads only ctx/resolved/opts (never `node`), so a bare stub is enough.
const node = {} as NodeSpec;
const resolved: ResolveResult = { piTools: ['read'] };
const ctx = { promptFile: 'p.md' };

describe('defaultPiCommand — session flag emission', () => {
  it('NO session opts → keeps --no-session and emits no --session* / --session-dir (back-compat)', () => {
    const cmd = defaultPiCommand(node, resolved, ctx);
    expect(cmd).toContain('--no-session');
    expect(cmd).not.toContain('--session-dir');
    expect(cmd).not.toMatch(/--session(-id)?\b/);
  });

  it('create-session opts → emits --session-dir <dir> + --session-id <id>, drops --no-session', () => {
    const cmd = defaultPiCommand(node, resolved, ctx, {
      session: { dir: '/run/.pi-sessions', id: 'producer' },
    });
    expect(cmd).toContain("--session-dir '/run/.pi-sessions'");
    expect(cmd).toContain("--session-id 'producer'");
    // create path must NOT use the resume flag …
    expect(cmd).not.toMatch(/--session '/);
    // … and must NOT be ephemeral.
    expect(cmd).not.toContain('--no-session');
  });

  it('resume-session opts → emits --session-dir <dir> + --session <id> (NOT --session-id), drops --no-session', () => {
    const cmd = defaultPiCommand(node, resolved, ctx, {
      session: { dir: '/run/.pi-sessions', id: 'producer', resume: true },
    });
    expect(cmd).toContain("--session-dir '/run/.pi-sessions'");
    expect(cmd).toContain("--session 'producer'");
    // the resume flag is `--session`, NEVER the create-flag `--session-id`.
    expect(cmd).not.toContain('--session-id');
    expect(cmd).not.toContain('--no-session');
  });
});
