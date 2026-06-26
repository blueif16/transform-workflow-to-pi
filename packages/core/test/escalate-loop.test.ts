import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile, InMemorySandboxProvider } from '../src/index.js';
import type { NodeIntent, WorkflowSpec, NodeSpec, SandboxProvider, Sandbox, CreateOpts } from '../src/index.js';
import { runWorkflow } from '../src/runner/index.js';

// ── M4 · escalate-with-evidence (#4) — attempt 2 runs on the STRONGER (tier-resolved) model fed the ──
// VERIFIED failure evidence (consultPreamble), NEVER a self-score. Attempt 1 fails its artifact contract
// (classified `contract` → escalate); the runner re-runs ONCE on the `escalate.tier`-resolved model with
// the consult prefix prepended to the prompt. We assert BOTH halves: the prefix text AND the routed model.
// Fully deterministic — no live pi (a stub builder records the model per attempt; a recording provider
// captures the staged prompt bytes per attempt).

function n(label: string, reads: string[], produces: string[], over: Partial<NodeIntent> = {}): NodeIntent {
  return { label, prompt: `do ${label}`, tools: {}, io: { reads, produces, artifacts: produces.map((p) => ({ path: p })) }, ...over };
}
const wf = (nodes: NodeIntent[]): WorkflowSpec => ({ meta: { name: 't', description: 'd' }, nodes });
const tmpOut = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'piflow-escalate-'));

/** A recording provider that captures every staged `_pi/<id>/prompt.md` write (the per-attempt prompt). */
function promptRecorder(): { provider: SandboxProvider; prompts: string[] } {
  const prompts: string[] = [];
  const base = new InMemorySandboxProvider();
  const provider: SandboxProvider = {
    kind: 'inmemory',
    async create(opts: CreateOpts): Promise<Sandbox> {
      const sb = await base.create(opts);
      const orig = sb.writeFile.bind(sb);
      sb.writeFile = async (p: string, d: Uint8Array | string) => {
        if (p.endsWith('/prompt.md')) prompts.push(typeof d === 'string' ? d : Buffer.from(d).toString('utf8'));
        return orig(p, d);
      };
      return sb;
    },
  };
  return { provider, prompts };
}

describe('escalate-with-evidence — the consult attempt runs on the tier-resolved stronger model (#4)', () => {
  it('attempt 2 receives the consultPreamble text AND the escalate.tier-resolved model', async () => {
    // The node escalates to tier "deep" → "strong-model" via the injected routing map.
    const node = n('Build', [], ['out.txt'], {
      io: { reads: [], produces: ['out.txt'], artifacts: [{ path: 'out.txt' }], escalate: { tier: 'deep' } },
    });
    const g = compile(wf([node]));
    const outDir = await tmpOut();
    const { provider, prompts } = promptRecorder();

    // A STATEFUL stub: attempt 1 writes NOTHING (→ blocked, contract breach → escalate); attempt 2 (the
    // consult) writes the artifact so it ends ok. Record the model the builder saw on each call.
    const models: (string | undefined)[] = [];
    let call = 0;
    const builder = (nodeSpec: NodeSpec & { sandbox: { output: string } }, _resolved: unknown, opts: { model?: string }): string => {
      call++;
      models.push(opts.model);
      const out = nodeSpec.sandbox.output;
      if (call === 1) return 'true'; // attempt 1: produce nothing → blocked
      return `mkdir -p ${out} && printf '%s' done > ${out}/out.txt`; // attempt 2: produce the artifact
    };

    const { status } = await runWorkflow(g, {
      run: 'esc',
      outDir,
      provider,
      buildCommand: builder as never,
      // INJECTED routing: tier "deep" resolves to "strong-model" (the deterministic test seam).
      modelRouting: { tiers: { active: true, tiers: { deep: 'strong-model' } }, modelsIndex: new Map() },
    });

    // The node ended OK only because the escalation attempt produced the artifact.
    expect(status.nodes.build.status).toBe('ok');
    // Exactly two attempts ran (the cheap default, then ONE consult).
    expect(models.length).toBe(2);
    // Attempt 1 ran on the default model (no pin); attempt 2 ran on the tier-resolved stronger model.
    expect(models[1]).toBe('strong-model');
    expect(models[0]).not.toBe('strong-model');
    // The consult attempt's prompt carried the VERIFIED-evidence preamble.
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toMatch(/CONSULT/);
    expect(prompts[1]).toMatch(/Failure class: contract/);
    expect(prompts[1]).toMatch(/missing required artifact\(s\): out\.txt/);
    // Attempt 1 (the cheap default) did NOT carry the consult prefix.
    expect(prompts[0]).not.toMatch(/CONSULT/);

    await fs.rm(outDir, { recursive: true, force: true });
  });
});
