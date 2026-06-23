import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hostOpenClawTool } from '../src/tools/openclaw-host.js';

// ── S0 INTEGRATION TEST — drive the REAL OpenClaw `memory_get` execute through our in-process host ───
//
// This is NOT a unit test of a mock. It imports the ACTUAL installed `memory-core` plugin entry
// (`node_modules/openclaw/dist/extensions/memory-core/index.js`), runs its real `register(api)` against
// our host's `api`, captures the LAZY `memory_get` tool factory, builds a tool `ctx`, and calls the
// plugin's OWN `execute(...)` — which performs a real fs read via `readAgentMemoryFile`.
//
// The load-bearing forensic fact (docs/design/openclaw-substrate-adoption.md, "Wiring plan"): OpenClaw's
// registry only STORES tool factories; there is NO free "run this tool" entrypoint. So the host must
// DRIVE execution itself: register → capture factory → factory(ctx) → tool.execute(...). This test proves
// that execute-driver works against a real plugin and a real on-disk memory file.
//
// The asserted value (MARKER) is one WE write to disk below — never copied from program output.

const MARKER = 'OC_S0_MARKER_4f1a-memory-get-live';
const REL_PATH = 'memory/s0-note.md';

// Imported by relative node_modules path: the plugin ENTRY is not in openclaw's package `exports` map
// (only the `plugin-sdk/memory-core` host SDK is). This is the real installed plugin, not a fixture.
const MEMORY_CORE_ENTRY = '../../../node_modules/openclaw/dist/extensions/memory-core/index.js';

let workspaceDir: string;

beforeAll(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), 'oc-s0-memget-'));
  mkdirSync(join(workspaceDir, 'memory'), { recursive: true });
  // A KNOWN content string we choose, written to disk BEFORE memory_get runs.
  writeFileSync(join(workspaceDir, REL_PATH), `# s0 note\n${MARKER}\n`, 'utf8');
});

afterAll(() => {
  if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true });
});

describe('hostOpenClawTool — S0: real memory_get execute driven through the in-process host', () => {
  it('registers the real memory-core plugin and returns the on-disk file content via memory_get', async () => {
    const mod = await import(MEMORY_CORE_ENTRY);

    const result = await hostOpenClawTool({
      mod,
      toolName: 'memory_get',
      workspaceDir,
      params: { path: REL_PATH },
    });

    // The plugin's execute returns a pi tool-result. `details.text` carries the raw file content; the
    // `content[0].text` is the JSON-serialized read result. Either way the MARKER we wrote must appear.
    const detailsText = (result as { details?: { text?: string } }).details?.text;
    expect(detailsText, 'memory_get should return the raw file content under details.text').toContain(
      MARKER,
    );

    const contentText = (result as { content?: Array<{ text?: string }> }).content?.[0]?.text;
    expect(contentText, 'memory_get content payload should include the file content').toContain(MARKER);

    // The plugin reported the path we asked for — proves it read OUR file, not some default.
    expect(detailsText).toContain('s0 note');
  });

  it('drives a real fs read: a non-existent memory path yields empty text, not the marker', async () => {
    const mod = await import(MEMORY_CORE_ENTRY);

    const result = await hostOpenClawTool({
      mod,
      toolName: 'memory_get',
      workspaceDir,
      params: { path: 'memory/does-not-exist.md' },
    });

    const detailsText = (result as { details?: { text?: string } }).details?.text ?? '';
    // The real fs-backed read returns empty text for a missing file (not an error, not our marker) —
    // confirms the value comes from the filesystem, not a host-fabricated constant.
    expect(detailsText).not.toContain(MARKER);
    expect(detailsText).toBe('');
  });
});
