// `piflowctl optimize --fix --binding <module> [--staging-dir <d>] [--auto-adopt] [--edit-budget n] [--token-budget n]`
// — the FIX→GATE→LAND driver surfaced on the CLI (piflow-memory-v1.5 §6). It INVENTS the product→optimizer
// injection convention (none existed): a PRODUCT binding module supplies the LIVE stages that cannot live in
// @piflow/core — `oracle` (the product's runMilestoneVerify2 + build), `copyScope`, `fixer` — and the CLI
// dynamic-imports it (mirroring run.ts's `@piflow/daytona` sandbox pattern), then COMPOSES the already-tested,
// product-agnostic core pieces: scoreRun → triage → mineTaskFromTrace → makeReplayStages → runFixGate →
// writeStagingManifest. It LANDS NOTHING live — it stages a manifest; physical adopt is a separate step.
//
// `scoreRun` is injectable (OptimizeFixDeps) so the composition is testable without a live trace; the live
// binding (the browser+build oracle) is validated by a real run, not CI.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scoreRun as coreScoreRun, triage, mineTaskFromTrace, makeReplayStages, runFixGate, writeStagingManifest } from '@piflow/core';
import type { ReplayOracle, CopyScope, Fixer, MineOpts, NodeScore, RunDigest } from '@piflow/core';

/** The product binding the CLI dynamic-imports — the LIVE stages that stay product-side (out of @piflow/core). */
export interface OptimizeBinding {
  /** re-verify a candidate build → a raw verify report (game-omni: runMilestoneVerify2 + npm build). */
  oracle: ReplayOracle;
  /** copy the node's editable scope to a candidate dir (game-omni: copy the minimal set + rebuild). */
  copyScope: CopyScope;
  /** the context-isolated fixer that edits the candidate copy per defect bucket. */
  fixer: Fixer;
  /** optional: customize the default trace miner (node→milestone map, val/train split). */
  mineOpts?: MineOpts;
}

export interface ParsedOptimizeFixArgs {
  dir: string;
  binding: string;
  stagingDir?: string;
  autoAdopt: boolean;
  editBudget?: number;
  tokenBudget?: number;
}

export interface OptimizeFixDeps {
  /** inject the score pass (the trace read); default = @piflow/core scoreRun. */
  scoreRun?: (dir: string) => Promise<{ scores: NodeScore[]; digest: RunDigest }>;
  print?: (s: string) => void;
}

export function parseOptimizeFixArgs(argv: string[]): ParsedOptimizeFixArgs {
  const out: ParsedOptimizeFixArgs = { dir: '', binding: '', autoAdopt: false };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--fix') continue; // the subcommand marker (the dispatcher already routed on it)
    else if (k === '--binding') out.binding = argv[++i] ?? '';
    else if (k === '--staging-dir') out.stagingDir = argv[++i];
    else if (k === '--auto-adopt') out.autoAdopt = true;
    else if (k === '--edit-budget') out.editBudget = Number(argv[++i]);
    else if (k === '--token-budget') out.tokenBudget = Number(argv[++i]);
    else if (k.startsWith('--')) { /* ignore unknown flags */ }
    else positionals.push(k);
  }
  out.dir = positionals[0] ?? '';
  return out;
}

/** Dynamic-import a binding module (a local path or a package specifier) and validate its required stages. */
export async function loadBinding(spec: string): Promise<OptimizeBinding> {
  const looksLikePath = spec.startsWith('.') || spec.startsWith('/') || /\.(mjs|cjs|js)$/.test(spec);
  let mod: Record<string, unknown>;
  try {
    mod = looksLikePath ? await import(pathToFileURL(path.resolve(spec)).href) : await import(spec);
  } catch (e) {
    throw new Error(`optimize --binding: could not load binding '${spec}': ${(e as Error).message}`);
  }
  const b = ((mod.default as Record<string, unknown> | undefined) ?? mod) as Partial<OptimizeBinding>;
  for (const k of ['oracle', 'copyScope', 'fixer'] as const)
    if (typeof b[k] !== 'function')
      throw new Error(`optimize --binding: '${spec}' must export { oracle, copyScope, fixer } as functions (missing or invalid: ${k})`);
  return b as OptimizeBinding;
}

export async function runOptimizeFixCli(argv: string[], deps: OptimizeFixDeps = {}): Promise<void> {
  const args = parseOptimizeFixArgs(argv);
  const print = deps.print ?? ((s: string) => process.stdout.write(s + '\n'));
  if (!args.dir) {
    process.stderr.write('piflowctl optimize --fix: a <rundir> is required (the finished run to fix).\n');
    process.exitCode = 2;
    return;
  }
  if (!args.binding) {
    process.stderr.write('piflowctl optimize --fix: --binding <module> is required (the product oracle/fixer; it is not in @piflow/core).\n');
    process.exitCode = 2;
    return;
  }

  // SCORE → TRIAGE: the worklist (reuses the read path; scoreRun injectable for tests).
  const { scores, digest } = await (deps.scoreRun ?? coreScoreRun)(args.dir);
  const defects = triage(scores, digest);

  // Compose the binding's LIVE stages with the product-agnostic core driver. The driver decides/bounds/stages.
  const binding = await loadBinding(args.binding);
  const mineTask = mineTaskFromTrace(args.dir, binding.mineOpts);
  const stages = makeReplayStages({ oracle: binding.oracle, mineTask, copyScope: binding.copyScope });
  const result = await runFixGate(defects, { fixer: binding.fixer, ...stages }, {
    autoAdopt: args.autoAdopt,
    ...(args.editBudget !== undefined ? { editBudget: args.editBudget } : {}),
    ...(args.tokenBudget !== undefined ? { tokenBudget: args.tokenBudget } : {}),
  });

  const stagingDir = args.stagingDir ?? path.join(args.dir, 'optimize', 'staging');
  const manifestPath = await writeStagingManifest(result, { stagingDir });
  print(`optimize --fix: ${result.accepted}/${result.attempted} edit(s) accepted (${result.stoppedReason}); manifest → ${manifestPath}`);
  process.stderr.write(`\noptimize --fix: staged ${result.accepted} accepted edit(s) across ${defects.length} defect(s) in ${digest.run || args.dir}; nothing landed live (adopt is a separate step).\n`);
}
