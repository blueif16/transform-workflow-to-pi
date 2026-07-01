---
type: thread
key: per-node-routing-and-fusion
title: Per-node routing + fusion (route a node to a model · expand a node into a sub-DAG)
description: Two intertwined author-time mechanisms (competitive gap G1) — ROUTING resolves each node's effective model/provider by ONE documented precedence (node.model > tiers[node.tier] > run --model > default) and stamps it onto the headless pi command; FUSION expands a fusion-activated node into a sibling∥judge sub-DAG BEFORE compile, so the DAG gains nodes the author never wrote. Spec is the single source of truth for the knobs.
resource: packages/core/src/runner/model-routing.ts
aliases: [route by model, per-node model, model routing, provider, tier, resolveNodeModel, loadModelTiers, loadModelsIndex, fusion, sibling, judge, obligations, sub-DAG, expandFusion, expandNode, precedence, G1, model-tiers.json, fusion.json, FUSION_PRESETS]
seeds: [packages/core/src/runner/model-routing.ts, packages/core/src/runner/fusion-config.ts, packages/core/src/runner/retry.ts, packages/core/src/workflow/fusion/expand.ts, packages/core/src/workflow/fusion/prompts.ts, packages/core/src/workflow/fusion/presets.ts, packages/core/src/runner/entry.ts, packages/core/src/runner/command.ts, packages/core/src/dag.ts, docs/specs/per-node-routing-and-fusion.md]
symbols: [resolveNodeModel, loadModelTiers, loadModelsIndex, expandFusion, expandNode, classifyRef, loadFusionConfig, fillJudgePrompt, judgePresetId, FUSION_PRESETS]
tags: [routing, fusion, model, tier, dag-expansion, g1, core, thread]
timestamp: 2026-06-30
---

# Why / how it works (the two intertwined spines)
ROUTING (G1): a node may carry `model`/`provider`/`tier`. `resolveNodeModel` is the PURE resolver applying ONE
documented precedence — `node.model > tiers[node.tier]` (only if `model-tiers.active`) `> run --model > pi default`
— reading the two read-only adapters `loadModelTiers` (`~/.piflow/model-tiers.json`, tier→model aliases) and
`loadModelsIndex` (pi's `~/.pi/agent/models.json`, model id→provider auto-resolve). The run-level `modelRouting`
config is resolved once and threaded into `RunContext` (runner.ts); at each node's build call `runNode` calls
`resolveNodeModel` and `defaultPiCommand` STAMPS the result onto the headless command as `--provider`/`--model`
(the terminal); `retry.ts` re-resolves on escalation so a tier bump takes effect. An unknown tier fails LOUDLY,
never silently defaulting. FUSION: a node with a `fusion` activation is expanded BEFORE compile by `expandFusion`
(→ `expandNode`) into a sub-DAG — N siblings (each a distinct model, refs classified tier-vs-model by `classifyRef`
but resolved LATER by routing), an optional obligations pre-node, and a judge (`fillJudgePrompt`, preset chosen by
`judgePresetId` over `FUSION_PRESETS`). `loadFusionConfig` supplies defaults from `~/.piflow/fusion.json`. The judge
keeps the original node's label, so all downstream edges/contracts survive. `compile` (dag.ts) then folds the
expanded nodes into stages/edges — the terminal: a DAG with nodes the author never wrote.

# Anchors
ROUTING — resolve (precedence)
- `packages/core/src/runner/model-routing.ts:75` — `resolveNodeModel` — PURE precedence resolver (node.model > tiers[node.tier] > run --model > default)
- `packages/core/src/runner/model-routing.ts:171` — `loadModelTiers` — read-only `~/.piflow/model-tiers.json`; absent/invalid ⇒ `{active:false}` default
- `packages/core/src/runner/model-routing.ts:272` — `loadModelsIndex` — read-only pi `~/.pi/agent/models.json`; model id → provider auto-resolve
ROUTING — thread + per-node + escalate
- `packages/core/src/runner/runner.ts:332` — `modelRouting: opts.modelRouting ?? { tiers, modelsIndex }` — resolve run config once, thread into `RunContext`
- `packages/core/src/runner/node-lifecycle.ts:362` — `eff = resolveNodeModel(node, {…})` — per-node resolution at the build call
- `packages/core/src/runner/retry.ts:119` — `resolveNodeModel(…)` — re-resolve on escalation so a tier bump applies
ROUTING — stamp (terminal)
- `packages/core/src/runner/command.ts:82` — `'--provider', provider` — provider stamped onto the headless pi command
- `packages/core/src/runner/command.ts:84` — `if (ctx.model) parts.push('--model', ctx.model)` — pinned model stamped onto the command
FUSION — config + expand
- `packages/core/src/runner/fusion-config.ts:45` — `loadFusionConfig` — read-only `~/.piflow/fusion.json` defaults (mode/n/panel/judge/obligations)
- `packages/core/src/workflow/fusion/expand.ts:52` — `classifyRef` — mark a panel/judge ref as `.tier` vs `.model` (does NOT resolve — routing does, later)
- `packages/core/src/workflow/fusion/expand.ts:69` — `expandNode` — expand ONE fusion node → `[obligations?, siblings[], judge]`
- `packages/core/src/workflow/fusion/expand.ts:197` — `expandFusion` — PURE: expand every fusion node in a `WorkflowSpec`, BEFORE compile
- `packages/core/src/workflow/fusion/prompts.ts:113` — `fillJudgePrompt` — fill the judge template with task/partials/obligations
- `packages/core/src/workflow/fusion/presets.ts:43` — `judgePresetId` — pick the judge preset by mode (moa / best-of-n) over `FUSION_PRESETS`
FUSION — expand-then-compile (terminal)
- `packages/core/src/runner/entry.ts:116` — `spec = expandFusion(spec, fusionExpandOpts())` — expand before compile (runFromConfig path)
- `packages/core/src/runner/entry.ts:177` — `spec = expandFusion(spec, fusionExpandOpts())` — expand before compile (runFromTemplate path)
- `packages/core/src/dag.ts:177` — `compile` — folds the expanded siblings+judge into stages/edges (the DAG the author never wrote)

# Freshness (anti-drift)
anchors ✓ (opened + line-verified; corrected from a recon that hallucinated an `effectiveModel` front door — there is none, the single resolver is `resolveNodeModel`) · scope = the seeds above · re-derive when `model-routing.ts`'s precedence or `expand.ts`'s shape changes. DRIFT NOTE: precedence is resolved in ONE place per concern (`model-routing.ts` for routing; `expand.ts`/`fusion-config.ts` for fusion params) — the spec (`docs/specs/per-node-routing-and-fusion.md` §2) is the override contract. Fusion is a PORT of the DAG-expansion idea, not the vendor `pi-fusion`. `FUSION_PRESETS` (presets.ts:24) is shared with the `base-agent-types` slice (preset SHAPE) — this slice owns the EXPANSION, that one owns the preset lifecycle. The CLI dry-run also calls `expandFusion` (`packages/cli/src/run.ts:436`) so previews show the real expanded DAG + resolved models.

<!-- okf:auto-start -->
> _Auto-generated by `_generate.mjs` — do not hand-edit between the markers; re-run `--write`._

### Final state — file set (seeds)

| File | exists |
|---|---|
| `packages/core/src/runner/model-routing.ts` | ✓ |
| `packages/core/src/runner/fusion-config.ts` | ✓ |
| `packages/core/src/runner/retry.ts` | ✓ |
| `packages/core/src/workflow/fusion/expand.ts` | ✓ |
| `packages/core/src/workflow/fusion/prompts.ts` | ✓ |
| `packages/core/src/workflow/fusion/presets.ts` | ✓ |
| `packages/core/src/runner/entry.ts` | ✓ |
| `packages/core/src/runner/command.ts` | ✓ |
| `packages/core/src/dag.ts` | ✓ |
| `docs/specs/per-node-routing-and-fusion.md` | ✓ |

### Evolution arc

- `e570755` 2026-06-21 — feat(core): DAG compiler + contract codec + registry + sandbox + hooks
- `55eb576` 2026-06-21 — feat(core): M1 runner — execution loop over the spine
- `a4751de` 2026-06-21 — feat(core): wire outside tools end-to-end — resolve generates the -e, runner stages it + bind-gates each node
- `42f17a6` 2026-06-23 — feat(core): defaultPiCommand opts (thinking, extraExtensions) + --exclude-tools from resolved (U4)
- `62cbc0c` 2026-06-23 — feat(core): runFromConfig + loadConfig (U8)
- `1df3a36` 2026-06-23 — feat(core): carry node ops + resolve {{arg}}/{{state}} at node launch
- `a6f974a` 2026-06-23 — feat(core): runFromTemplate joins loadTemplate+instantiate+run; --arg channel (S5)
- `9d54218` 2026-06-24 — feat(core): generic run-profile node elision + transitive dep rewire
- `067b365` 2026-06-25 — feat(core): add the G5 human-checkpoint NODE KIND (schema → spec) + awaiting-input
- `7ea87f7` 2026-06-25 — docs(specs): per-node model routing (G1) + fusion nodes — design & execution plan
- `5243633` 2026-06-25 — feat(core): carry per-node model/provider/tier through the template (G1)
- `9c64f0c` 2026-06-25 — feat(core): model-routing.ts — the one home of model/provider precedence (G1)
- `47164cd` 2026-06-25 — feat(core): expandFusion — siblings+judge DAG expansion as preset agents (T2.2)
- `26a3620` 2026-06-25 — feat(core): fusion-config.ts — read-only ~/.piflow/fusion.json defaults reader (T2.3)
- `cb16658` 2026-06-25 — fix(core): fusion siblings collect into disjoint top-level dirs (parallel-safe)
- `6aae3e6` 2026-06-25 — feat: wire expandFusion into the run path + dry-run; runnable example (T2.4/T2.6)
- `2b1f8d1` 2026-06-25 — feat(core): G9 — subworkflow sub-DAG inlining (expandSubworkflow)
- `32c3b42` 2026-06-25 — feat(core): assembleRunTools — seed the tool catalog into the canonical run path (M1)
- `a3fdf7a` 2026-06-25 — feat(core): expandReroute — unroll the bounded QA loop into a forward-only acyclic DAG with a zero-pi #17 short-circuit (M3, closes #2/#5/#17)
- `3b38db0` 2026-06-25 — feat(core): M5 lower deprecated grammars into the unified op[] at the loader
- `0564114` 2026-06-26 — merge: integrate main (G3/G6/G7/G9) into the node-action M0–M7 lineage
- `169cb6d` 2026-06-26 — feat(observe): lift the fleet registry + discovery into @piflow/core
- `e78f94c` 2026-06-26 — refactor(cli): rename global bin piflow → piflowctl
- `9636137` 2026-06-26 — feat(core): withNodeFusion toggle + previewView projection
- `d074a39` 2026-06-26 — feat(catalog): feed the ~/.piflow catalog slice into the run path so mcp.* nodes bind
- `b5972f2` 2026-06-26 — feat(skills): wire node.skill — stage the skill folder into the sandbox + emit --skill (reuse the seed seam)
- `7f1b283` 2026-06-27 — feat(runner): programmatic (no-pi) node kind
- `f365b73` 2026-06-27 — feat(core): W1 — switch every consumer from node.ops to the canonical op[]
- `d9035b4` 2026-06-27 — feat(core)!: U6 — retire node.ops/NodeOps; op[] is the sole derive rep
- `3d0f33b` 2026-06-28 — feat(core): AgentBase schema + compiler expansion + canonical tiers (SA-C)
- `56f1145` 2026-06-28 — feat(core): per-node pi session-id + warm-resume L1
- `4a47965` 2026-06-28 — refactor(core): extract retry from runner.ts (step 7/9)
- `716b9ec` 2026-06-28 — refactor(core): extract node-lifecycle from runner.ts (step 8/9)
- `2ddf66d` 2026-06-28 — feat(cli): piflowctl model + lazy ~/.piflow bootstrap (seed model-tiers)
- `2051840` 2026-06-29 — feat(executor): claudeCommand builder for the claude-code executor
- `af19417` 2026-06-29 — feat(executor): map the 3-tier config to Claude via a parallel `claude` block
- `ca01064` 2026-06-29 — feat(executor): wire per-node executor selection (pi | claude-code) into dispatch
- `44b4310` 2026-06-29 — feat(executor): carry `executor` through compile + offline end-to-end dispatch test
- `1adbe3f` 2026-06-29 — feat(executor): robust §7.2 credential model for claude-code (env token, API-key strip, isolated CLAUDE_CONFIG_DIR)
- `4415ae9` 2026-06-29 — feat(core): per-node fullAccess flag — open the fs jail for one node
- `a935280` 2026-06-29 — merge: claude-code 2nd node executor + interactive piflowctl init wizard

### Lessons — memory cluster

**Alias matches** (review — may include false positives):
- [[blueprints-layer]]
- [[capability-catalog-feed]]
- [[claude-code-executor]]
- [[cloud-sandbox-portability]]
- [[competitive-gaps-pdw]]
- [[config-is-truth-gui-is-projection]]
- [[daytona-cloud-path]]
- [[expert-representations]]
- [[g11-g13-node-action-protocol]]
- [[g6-agenttype-presets]]
- [[game-omni-reference-product]]
- [[gui-nodehud-redesign]]
- [[mastra-competitive-analysis]]
- [[observe-single-data-path]]
- [[op-consumption-two-layer]]
- [[optimize-loop-native-not-adhoc]]
- [[per-node-routing-fusion]]
- [[piflow-init-scaffolder]]
- [[piflow-memory-system-v1]]
- [[piflow-optimize-layer-built]]
- [[piflow-rollout-enablement]]
- [[sandbox-readscope-default-on]]
- [[swarm-consensus-deferred]]
- [[tui-dag-structure-source]]

### Code anchors / blast radius (codegraph)

- `judgePresetId` (packages/core/src/workflow/fusion/presets.ts:43) — 3 callers in `packages/core/src/workflow/fusion/expand.ts`, `packages/core/src/index.ts`; ⚠ no covering tests found
- `expandNode` (packages/core/src/workflow/fusion/expand.ts:69) — 1 caller in `packages/core/src/workflow/fusion/expand.ts`; ⚠ no covering tests found
- `loadModelTiers` (packages/core/src/runner/model-routing.ts:171) — 11 callers in `packages/cli/src/init/steps/claude-code.ts`, `packages/cli/src/init/steps/model-tiers.ts`, `packages/cli/src/model.ts`, `packages/core/src/runner/runner.ts` +2 more; tests: `packages/core/test/model-routing.test.ts`
- `FUSION_PRESETS` (packages/core/src/workflow/fusion/presets.ts:24) — 2 callers in `packages/core/src/workflow/fusion/expand.ts`, `packages/core/src/index.ts`; ⚠ no covering tests found
- `loadModelsIndex` (packages/core/src/runner/model-routing.ts:272) — 5 callers in `packages/core/src/runner/runner.ts`, `packages/core/src/index.ts`, `packages/core/src/runner/index.ts`; tests: `packages/core/test/model-routing.test.ts`

<sub>derived 2026-07-01 · arc=41 commits · files=10 · lessons=24</sub>
<!-- okf:auto-end -->
