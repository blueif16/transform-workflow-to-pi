// (M6 · #20) OpenClaw hook-bus registrations are SURFACED as ADVISORY (Dagster blocking=False), not silent.
//
// The host/shim drive a tool's `execute` DIRECTLY, bypassing OpenClaw's hook bus, so a plugin that self-gates
// via `before_tool_call` (or persists via `tool_result_persist`) has that hook SKIPPED. Today `registerHook`
// and `on` are silent no-ops (openclaw-shim.ts:80-81, openclaw-host.ts:453,473) — the latent trap is INVISIBLE
// (#20). The fix: RECORD each hook-bus registration as an ADVISORY entry (surfaced, observable) while keeping
// it NON-BLOCKING (the tool still runs; the advisory does not gate it — Dagster blocking=False). A future
// self-gating plugin is then visible as advisory, never silently dropped.
//
// DISCRIMINATING: a plugin that registers `before_tool_call`/`tool_result_persist` yields a NON-EMPTY
// advisory list naming those hooks; a plugin that registers NO hooks yields an EMPTY list (additive — the
// hook-free path is unchanged). A silent no-op (today) yields an empty list even for the self-gating plugin.
import { describe, it, expect } from 'vitest';
import { makeCaptureApi, captureOpenClawHooks } from '../src/tools/openclaw-shim.js';

/** A plugin whose register() registers TWO hook-bus handlers (the self-gate + the persist hook) + one tool. */
const HOOKING_ENTRY = {
  id: 'self-gater',
  name: 'Self Gater',
  register(api: any) {
    api.registerHook('before_tool_call', () => ({ allow: false })); // a self-gate the host bypasses
    api.on('tool_result_persist', () => {}); // a persist hook the host bypasses
    api.registerTool({ name: 'gated_tool', description: '', parameters: {}, async execute() {} });
  },
};

/** A plugin that registers NO hooks (the additive baseline). */
const PLAIN_ENTRY = {
  id: 'plain',
  name: 'Plain',
  register(api: any) {
    api.registerTool({ name: 'plain_tool', description: '', parameters: {}, async execute() {} });
  },
};

describe('OpenClaw hook bus — surfaced as advisory, not silent (#20)', () => {
  it('records before_tool_call + tool_result_persist registrations as ADVISORY (non-blocking) entries', () => {
    const { api, advisories } = makeCaptureApi();
    HOOKING_ENTRY.register(api);
    // BOTH hook registrations are surfaced (the self-gate via registerHook AND the persist via `on`).
    expect(advisories.map((a) => a.hook).sort()).toEqual(['before_tool_call', 'tool_result_persist']);
    // ADVISORY = Dagster blocking=False — the hook is recorded but does NOT block the tool.
    for (const a of advisories) expect(a.advisory).toBe(true);
  });

  it('captureOpenClawHooks returns the advisory hook list for a plugin entry (the caller-facing seam)', () => {
    expect(captureOpenClawHooks(HOOKING_ENTRY).map((a) => a.hook).sort()).toEqual([
      'before_tool_call',
      'tool_result_persist',
    ]);
  });

  it('a plugin that registers NO hooks yields an EMPTY advisory list (additive — hook-free path unchanged)', () => {
    const { api, advisories } = makeCaptureApi();
    PLAIN_ENTRY.register(api);
    expect(advisories).toEqual([]);
    expect(captureOpenClawHooks(PLAIN_ENTRY)).toEqual([]);
  });

  it('does NOT throw on the hook-bus verbs (register completes) — only now they are recorded, not dropped', () => {
    expect(() => captureOpenClawHooks(HOOKING_ENTRY)).not.toThrow();
  });
});
