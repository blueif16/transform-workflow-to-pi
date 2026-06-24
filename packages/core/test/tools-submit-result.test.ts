// S0 — submit_result is a REAL first-party CONTRACT tool: registered into the generated `-e` extension
// via pi.registerTool (the same non-native machinery mcp/sdk tools use), so a node that declares it gets
// a tool that ACTUALLY EXISTS + is CALLABLE in the pi process — not a static catalog line. Ported from
// game-omni pi-runner/extensions/node-contract.ts (the typed, terminating return tool).
import { describe, it, expect } from 'vitest';
import { DefaultToolRegistry, verifyToolBinding, compileToolExtension, SUBMIT_RESULT_TOOL } from '../src/index.js';
import type { ToolEntry } from '../src/index.js';

/**
 * Run the generated extension source the way pi would, but against stubs: strip the import lines, inject
 * a `Type` stub (Object/Union/Literal/Array/String → readable identities) + a `callTool` spy, run the
 * factory against a fake `pi` that records every registerTool. Proves the GENERATED CODE binds a real,
 * callable submit_result — not that a string contains a substring. (Mirrors tools-compile.test's harness.)
 */
function instantiate(source: string) {
  const body = source
    .replace(/^\s*import[^\n]*\n/gm, '')
    .replace(/export\s+default\s+function/m, 'return function');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function('Type', 'callTool', body);
  const id = (s: unknown): unknown => s;
  const TypeStub = {
    Unsafe: id,
    Object: id,
    Union: (a: unknown) => a,
    Literal: id,
    Array: id,
    String: id,
  };
  const callTool = (): unknown => {
    throw new Error('callTool must NOT be invoked for a first-party contract tool');
  };
  const factory = make(TypeStub, callTool) as (pi: unknown) => void;
  const registered: Array<Record<string, any>> = [];
  factory({ registerTool: (def: Record<string, any>) => registered.push(def) });
  return registered;
}

describe('submit_result — the registry entry + bind (S0)', () => {
  it('a fresh DefaultToolRegistry carries submit_result (a default, first-party tool)', () => {
    const e = new DefaultToolRegistry().list().find((t) => t.piName === 'submit_result');
    expect(e).toBeTruthy();
    expect(e!.source).toBe('contract');
  });

  it('the real w0-classify tools.allow (incl submit_result) BINDS against the default registry', () => {
    const allow = ['read', 'ls', 'grep', 'find', 'edit', 'write', 'bash', 'submit_result'];
    const r = verifyToolBinding({ allow }, new DefaultToolRegistry().list());
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.bound).toContain('submit_result');
  });
});

describe('submit_result — emitted into the generated -e extension (the genuine non-native path)', () => {
  it('a selection containing submit_result compiles to an extension that registers it', () => {
    const r = new DefaultToolRegistry().resolve({ allow: ['write', 'submit_result'] });
    // it goes on --tools by its bare name AND ships a generated -e extension that binds it.
    expect(r.piTools).toContain('submit_result');
    expect(r.extension).toBeTruthy();
    expect(r.extension).toContain('submit_result');
  });

  it('the GENERATED extension actually registers a callable submit_result with terminate:true', async () => {
    // Compile the contract tool entry alone → the extension source pi would load.
    const { source, registered } = compileToolExtension([SUBMIT_RESULT_TOOL]);
    expect(registered).toContain('submit_result');

    const tools = instantiate(source);
    const submit = tools.find((t) => t.name === 'submit_result');
    expect(submit).toBeTruthy();
    // It has the real typed parameter surface (status/summary/outputArtifacts) — not an empty schema.
    expect(submit!.parameters).toBeTruthy();
    expect(typeof submit!.execute).toBe('function');

    // Calling it returns the structured result + terminate:true (the typed terminating return tool).
    const out = await submit!.execute('tc-1', {
      node: 'w0-classify',
      status: 'ok',
      outputArtifacts: ['spec/classification.json'],
      summary: 'classified',
      issues: [],
    });
    expect(out.terminate).toBe(true);
    expect(out.details).toMatchObject({ node: 'w0-classify', status: 'ok' });
  });

  it('a builtins-only selection emits NO extension (submit_result not selected ⇒ nothing generated)', () => {
    const r = new DefaultToolRegistry().resolve({ allow: ['read', 'write'] });
    expect(r.extension).toBeUndefined();
  });
});

describe('SUBMIT_RESULT_TOOL — the exported catalog entry', () => {
  it('is a contract-source ToolEntry with the bare piName submit_result', () => {
    const e: ToolEntry = SUBMIT_RESULT_TOOL;
    expect(e.piName).toBe('submit_result');
    expect(e.source).toBe('contract');
    expect(e.parameters).toBeTruthy(); // carries the typed param schema
  });
});
