import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyToolBinding, BUILTIN_TOOLS, DefaultToolRegistry, mcpToolsToEntries } from '../src/index.js';
import type { ToolEntry } from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MCP = mcpToolsToEntries('github', [
  { name: 'create_issue', description: 'Open an issue.' },
]); // → address mcp.github:create_issue, piName github_create_issue
const CATALOG: ToolEntry[] = [...BUILTIN_TOOLS, ...MCP];

describe('verifyToolBinding — the per-node bind pre-check', () => {
  it('passes a default (empty) selection: the node binds every builtin', () => {
    const r = verifyToolBinding({}, CATALOG);
    expect(r.ok).toBe(true);
    expect(r.bound).toEqual(expect.arrayContaining(['read', 'write', 'bash']));
    expect(r.missing).toEqual([]);
    expect(r.collisions).toEqual([]);
  });

  it('passes a mixed builtin + mcp selection and reports the exact bound bare names', () => {
    const r = verifyToolBinding({ allow: ['fs:read', 'mcp.github:create_issue'] }, CATALOG);
    expect(r.ok).toBe(true);
    expect(r.bound).toEqual(['read', 'github_create_issue']);
    expect(r.declared).toEqual(['fs:read', 'mcp.github:create_issue']);
  });

  it('honors deny: a denied tool is neither declared nor bound', () => {
    const r = verifyToolBinding({ allow: ['fs:read', 'fs:write'], deny: ['fs:write'] }, CATALOG);
    expect(r.ok).toBe(true);
    expect(r.bound).toEqual(['read']);
    expect(r.declared).toEqual(['fs:read']);
  });

  it('FAILS when a declared address is not in the catalog (the function will not bind)', () => {
    const r = verifyToolBinding({ allow: ['fs:read', 'mcp.slack:post_message'] }, CATALOG);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['mcp.slack:post_message']);
    expect(r.issues.join(' ')).toMatch(/mcp\.slack:post_message/);
  });

  it('FAILS on a bare-name collision: two declared addresses mapping to one piName', () => {
    // two DISTINCT addresses deliberately sharing a bare name (the pi flat-namespace skip hazard).
    const clashy: ToolEntry[] = [
      { address: 'a:dup', source: 'sdk', piName: 'dup', description: 'A' },
      { address: 'b:dup', source: 'sdk', piName: 'dup', description: 'B' },
    ];
    const r = verifyToolBinding({ allow: ['a:dup', 'b:dup'] }, [...BUILTIN_TOOLS, ...clashy]);
    expect(r.ok).toBe(false);
    expect(r.collisions).toEqual([{ piName: 'dup', addresses: ['a:dup', 'b:dup'] }]);
    expect(r.issues.join(' ')).toMatch(/collision|collide/i);
  });
});

// S0 — the migrated nodes declare `submit_result` (a pi-native builtin) in tools.allow; it MUST bind
// against the default catalog (the BUILTIN_TOOLS set) exactly like `read`/`bash`, by its bare piName.
// Before submit_result is registered, this is the live tool-bind block that halts a real run at W0.
describe('verifyToolBinding — submit_result binds for the migrated nodes (S0)', () => {
  it('binds the real w0-classify tools.allow (incl submit_result) against the default registry', async () => {
    // Read the COMMITTED game-omni template's W0 node — its tools.allow is the bare-name vocabulary a
    // live run binds. The default registry (what runWorkflow uses) is the catalog the bind check runs over.
    const w0 = JSON.parse(
      await fs.readFile(
        path.join(HERE, '..', '..', '..', '.piflow', 'game-omni', 'template', 'nodes', 'w0-classify', 'node.json'),
        'utf8',
      ),
    ) as { tools: { allow: string[]; deny?: string[] } };
    expect(w0.tools.allow).toContain('submit_result'); // guard: this test asserts the real declared shape

    const r = verifyToolBinding(w0.tools, new DefaultToolRegistry().list());
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.bound).toContain('submit_result');
  });

  it('submit_result is NOT a pi-native builtin (it is the first-party contract tool, registered separately)', () => {
    // The append-only model was rejected: submit_result is a `contract` tool with its own inline execute,
    // NOT a pi-native on BUILTIN_TOOLS — so the builtins-only default never drags it in.
    expect(BUILTIN_TOOLS.find((t) => t.piName === 'submit_result')).toBeUndefined();
  });
});
