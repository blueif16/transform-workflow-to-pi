import { describe, it, expect, vi, afterEach } from 'vitest';
import { nodeSchema, metaSchema, workflowSchema } from '@piflow/core';
import { runSchemaCli } from '../src/schema.js';

// `piflowctl schema [node|meta|workflow]` makes the SDK self-describing: it prints the SAME schema
// objects @piflow/core exports, so an authoring agent in any repo can fetch the machine-readable
// node-authoring contract on demand. The load-bearing assertion here is the ANTI-DRIFT one: the
// captured stdout, JSON-parsed, must DEEP-EQUAL the schema imported from @piflow/core. If the command
// ever hand-copies or diverges from the SDK's schema, this test goes RED — which is the whole point.

/** Run `runSchemaCli(argv)`, capturing whatever it writes to stdout (and the resulting exit code). */
function capture(argv: string[]): { stdout: string; stderr: string; exitCode: number } {
  let stdout = '';
  let stderr = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  });
  process.exitCode = 0;
  try {
    runSchemaCli(argv);
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  const exitCode = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { stdout, stderr, exitCode };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('piflowctl schema — self-describing SDK authoring schemas', () => {
  it('prints the node schema by default, DEEP-EQUAL to @piflow/core nodeSchema (anti-drift)', () => {
    const { stdout, exitCode } = capture([]);
    expect(exitCode).toBe(0);
    // The structural anti-drift guarantee: the printed JSON IS the SDK's own schema object.
    expect(JSON.parse(stdout)).toEqual(nodeSchema);
  });

  it("'node' selector prints the node schema (DEEP-EQUAL to @piflow/core nodeSchema)", () => {
    const { stdout, exitCode } = capture(['node']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(nodeSchema);
  });

  it('the node schema output carries the real authoring fields (judgeGate, op, checks)', () => {
    const { stdout } = capture(['node']);
    // Proves it is the actual AUTHORING schema agents need — not some thin/placeholder object.
    expect(stdout).toContain('judgeGate');
    expect(stdout).toContain('op');
    expect(stdout).toContain('checks');
  });

  it("'meta' selector prints the meta schema (DEEP-EQUAL to @piflow/core metaSchema)", () => {
    const { stdout, exitCode } = capture(['meta']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(metaSchema);
  });

  it("'workflow' selector prints the workflow schema (DEEP-EQUAL to @piflow/core workflowSchema)", () => {
    const { stdout, exitCode } = capture(['workflow']);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual(workflowSchema);
  });

  it('pretty-prints with 2-space indentation', () => {
    const { stdout } = capture(['node']);
    expect(stdout).toBe(`${JSON.stringify(nodeSchema, null, 2)}\n`);
  });

  it('an unknown selector exits non-zero and lists the valid selectors on stderr', () => {
    const { stdout, stderr, exitCode } = capture(['bogus']);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('node');
    expect(stderr).toContain('meta');
    expect(stderr).toContain('workflow');
  });
});
