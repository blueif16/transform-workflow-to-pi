import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile } from '../src/index.js';
import type { NodeIntent, WorkflowSpec } from '../src/index.js';
import { runWorkflow } from '../src/runner/index.js';
import type { NodeSpec } from '../src/types.js';

// ── run-start EXECUTOR OVERRIDE (RunOptions.executor / executorOverride) ────────────────────────────
//   A caller (CLI/GUI) picks pi vs claude-code PER NODE at run start WITHOUT editing the template. The
//   SINGLE choke point is `resolveExecutor` in node-lifecycle.ts, folded into the resolved-node clone the
//   runner consumes — so the effective executor reaches `effectiveModel` (model resolution) AND
//   `ctx.buildCommand` (dispatch) AND the credential/verdict paths, uniformly.
//
//   The template authors BOTH nodes as `pi` (no `executor`); only the run-start override flips nodeB. This
//   proves the override is applied at run start, not read from the template.

/** A NodeIntent factory (mirrors runner.test): reads/produces; artifacts default to produces. */
function n(label: string, reads: string[], produces: string[], over: Partial<NodeIntent> = {}): NodeIntent {
  return {
    label,
    prompt: `do ${label}`,
    tools: {},
    io: { reads, produces, artifacts: produces.map((p) => ({ path: p })) },
    ...over,
  };
}
const wf = (nodes: NodeIntent[]): WorkflowSpec => ({ meta: { name: 't', description: 'd' }, nodes });

async function tmpOut(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'piflow-exec-override-'));
}

/**
 * A command builder that writes each declared artifact into the sandbox OUTPUT dir (the downloadDir
 * convention), so the DEFAULT execRunner running the returned command drives the full lifecycle green.
 * `onNode` is an optional per-call spy (records the EFFECTIVE executor the runner handed the builder).
 */
function artifactBuilder(onNode?: (node: NodeSpec) => void) {
  return ((node: NodeSpec): string => {
    onNode?.(node);
    const out = node.sandbox.output;
    return node.io.artifacts
      .map((a) => `mkdir -p ${out} && printf '%s' ${node.id} > ${out}/${a.path}`)
      .join(' && ');
  }) as unknown as Parameters<typeof runWorkflow>[1]['buildCommand'];
}

describe('runWorkflow — run-start executor override (per-node, wins over the template)', () => {
  it('routes executorOverride[nodeId] into BOTH the command builder AND effectiveModel; a node without an override keeps its authored `pi`', async () => {
    // Two nodes, BOTH authored `pi` (no `executor` on the intent). nodeB is a downstream consumer so the
    // stages run in order and the artifact-flow verifies end-to-end.
    const g = compile(wf([
      n('NodeA', [], ['a.txt']),
      n('NodeB', ['a.txt'], ['b.txt']),
    ]));
    // Sanity: the template authored neither node as claude-code — the flip must come from the override alone.
    expect(g.nodes.nodea.executor).toBeUndefined();
    expect(g.nodes.nodeb.executor).toBeUndefined();

    // The SPY command builder RECORDS the `executor` on the node it is handed (= the effective executor,
    // post-clone), then writes the declared artifact so the lifecycle completes clean.
    const seenExecutor: Record<string, NodeSpec['executor']> = {};
    const spyBuild = artifactBuilder((node) => { seenExecutor[node.id] = node.executor; });

    const outDir = await tmpOut();
    // Default execRunner runs the returned command on the InMemory sandbox (writes the artifact), so the
    // lifecycle verifies end-to-end — we do NOT stub execRunner (an ignored command ⇒ no artifact ⇒ blocked).
    const { status } = await runWorkflow(g, {
      run: 'exec-override',
      outDir,
      buildCommand: spyBuild,
      // The RUN-START override: flip ONLY nodeB to claude-code; nodeA is left to its authored `pi`.
      executorOverride: { nodeb: 'claude-code' },
      // Deterministic OAuth token (the §7.2 credential model) so a claude-code node resolves host-side.
      secretResolver: (name) => (name === 'CLAUDE_CODE_OAUTH_TOKEN' ? 'test-oauth-token' : undefined),
    });

    // buildCommand SEAM — the spy saw the EFFECTIVE executor: overridden for nodeB, authored `pi`-absent
    // (i.e. the pi default) for nodeA. This is the choke-point clone; remove it and nodeB reverts to undefined.
    expect(seenExecutor.nodeb).toBe('claude-code');
    expect(seenExecutor.nodea).toBeUndefined(); // no override, no authored executor ⇒ pi default (undefined)

    // COMPLETES — the full lifecycle is green for both nodes.
    expect(status.nodes.nodea.status).toBe('ok');
    expect(status.nodes.nodeb.status).toBe('ok');
    expect(status.ok).toBe(true);

    await fs.rm(outDir, { recursive: true, force: true });
  });

  it('the overridden node resolves its model via the claude tier block (effectiveModel saw the override), while the non-overridden node uses the pi tier value', async () => {
    // BOTH nodes authored `pi` + `tier: 'deep'`. The override flips nodeB → claude-code. The tier map
    // resolves `deep` to DIFFERENT values per executor, so the effective model recorded on each node's
    // status record proves which executor `effectiveModel` branched to.
    const g = compile(wf([
      n('NodeA', [], ['a.txt'], { tier: 'deep' }),
      n('NodeB', ['a.txt'], ['b.txt'], { tier: 'deep' }),
    ]));

    const tiers = { active: true, tiers: { deep: 'deepseek-v3' }, claude: { deep: 'haiku' } };

    const outDir = await tmpOut();
    const { status } = await runWorkflow(g, {
      run: 'exec-override-model',
      outDir,
      buildCommand: artifactBuilder(),
      modelRouting: { tiers, modelsIndex: new Map() },
      executorOverride: { nodeb: 'claude-code' },
      secretResolver: (name) => (name === 'CLAUDE_CODE_OAUTH_TOKEN' ? 'test-oauth-token' : undefined),
    });

    // nodeA (pi): `deep` → the pi tiers value `deepseek-v3`.
    expect(status.nodes.nodea.model).toBe('deepseek-v3');
    // nodeB (overridden → claude-code): `deep` → the parallel `claude` block value `haiku` — proof that
    // effectiveModel saw the overridden executor, NOT the pi tiers value.
    expect(status.nodes.nodeb.model).toBe('haiku');
    expect(status.ok).toBe(true);

    await fs.rm(outDir, { recursive: true, force: true });
  });

  it('a RUN-LEVEL executor default (RunOptions.executor) flips EVERY node; a per-node override still wins over it', async () => {
    const g = compile(wf([
      n('NodeA', [], ['a.txt'], { tier: 'deep' }),
      n('NodeB', ['a.txt'], ['b.txt'], { tier: 'deep' }),
    ]));
    const tiers = { active: true, tiers: { deep: 'deepseek-v3' }, claude: { deep: 'haiku' } };

    const outDir = await tmpOut();
    const { status } = await runWorkflow(g, {
      run: 'exec-override-run-level',
      outDir,
      buildCommand: artifactBuilder(),
      modelRouting: { tiers, modelsIndex: new Map() },
      // Run-level default flips both to claude-code; the per-node override then pins nodeA BACK to pi.
      executor: 'claude-code',
      executorOverride: { nodea: 'pi' },
      secretResolver: (name) => (name === 'CLAUDE_CODE_OAUTH_TOKEN' ? 'test-oauth-token' : undefined),
    });

    // nodeA: per-node override `pi` wins over the run-level `claude-code` default ⇒ the pi tiers value.
    expect(status.nodes.nodea.model).toBe('deepseek-v3');
    // nodeB: no per-node override ⇒ the run-level `claude-code` default ⇒ the claude tier value.
    expect(status.nodes.nodeb.model).toBe('haiku');
    expect(status.ok).toBe(true);

    await fs.rm(outDir, { recursive: true, force: true });
  });
});
