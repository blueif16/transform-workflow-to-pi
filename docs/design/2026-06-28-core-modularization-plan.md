# Core modularization plan (audit)

READ-ONLY architecture audit of `packages/core/src`. Behavior-preserving decomposition plan only — no
code was changed; the only file written is this one. All claims grounded in `file:line` (numbers from an
actual `wc -l` / `grep -n` over the worktree at `feat+expert-representations`, 2026-06-28).

---

## 0. Verdict — is decomposition worth it, and what's the single highest-value split?

**Yes, but surgically — and only `runner.ts`.** The core SDK is, with ONE exception, already well-modularized:
the `runner/` directory holds 18 sibling files (`status.ts`, `journal.ts`, `checkpoint.ts`, `command.ts`,
`op-dispatch.ts`, `model-routing.ts`, `events.ts`, `logs.ts`, …) that each own one concern and re-export
through `runner/index.ts`. The decomposition discipline is in place; `runner.ts` is the one file that never
got carved.

`runner.ts` is **2461 lines — 13% of all 18,727 core source lines, and 5.3× the next-largest file**
(`types.ts`, 963). It co-locates at least **eight** unrelated responsibilities (the run loop, the
retry/escalation state machine, four distinct no-pi node lanes, the 700-line pi-node lifecycle, MCP/cred env
staging, the G8 repair loop, the resume/journal-seed logic, the prompt-parse + window-selection utilities).
Every edit to any one of these reloads the whole file into context and risks the others.

**The single highest-value split: lift the four no-pi node lanes** — `runCheckpoint`+`finishCheckpoint`
(runner.ts:722–837), `runRerouteGate` (968–1013), and `runProgrammatic` (1029–1256) — **into
`runner/node-lanes.ts`**. They are ~470 lines (~19% of the file), are each a self-contained
`(ctx, node) → Promise<NodeStatusRecord>`, import NOTHING that the rest of `runner.ts` doesn't already
import, and are referenced ONLY from the run loop's dispatch (runner.ts:2399/2406/2410). They carry the
lowest blast radius and instantly shrink the file by a fifth with zero public-API or test impact.

Do **not** split anything else in core — see §4. Maximal fragmentation here would HURT (the `RunContext`
coupling, below, makes over-splitting create circular-import churn for no readability gain).

---

## 1. Inventory

Heaviest source files (from `find packages/core/src -name '*.ts' | xargs wc -l | sort -rn`):

| File | Lines | Primary responsibility | Too much? |
|---|---:|---|---|
| `runner/runner.ts` | **2461** | The whole execution engine: run loop + 5 node lanes + retry/escalate FSM + env/cred staging + G8 repair + resume seeding + parse/window utils | **YES — 8+ responsibilities** |
| `types.ts` | 963 | The frozen L1 schema spine: all `NodeSpec`/`NodeIO`/sandbox/tool/op interfaces + 2 trivial seam defaults | No — one cohesive contract |
| `tools/openclaw-host.ts` | 748 | OpenClaw in-process tool HOST: drive `register()`→factory→`execute`; PLUS the `runEmbeddedAgentViaPi` seam; PLUS plugin discovery | **Borderline — 3 sub-concerns** |
| `observe/runView.ts` | 498 | Build the enriched `RunView` (events replay + token/tool/ledger distill) from a run dir; PLUS `previewView` | Mild — `previewView` is a tag-along |
| `observe/telemetry.ts` | 487 | Telemetry projection: node digest + anomaly detect + root-cause localize + live stream + OTel bridge | No — one lens, clear sections |
| `workflow/gate-authoring.ts` | 391 | Author-time gate descriptors → `op[]` lowering + cost-ladder ordering | No — cohesive |
| `workflow/template/schema/node.schema.ts` | 383 | One exported JSON-Schema constant (`nodeSchema`) | No — a single data literal |
| `sandbox/seatbelt.ts` | 363 | macOS seatbelt provider + profile builder | No — one backend |
| `runner/logs.ts` | 344 | `docker logs`-for-a-run reader: distill/tail/follow/diagnose | No — one read-side concern |
| `workflow/template/checks.ts` | 343 | Template static-check suite | No — cohesive |
| `tools/compile.ts` | 341 | ToolEntry[] → generated `-e` extension source + bundle | No — one pipeline |
| `runner/journal.ts` | 334 | G4 content-hash resume journal I/O + decide | No — cohesive |

Only **`runner.ts`** is unambiguously doing too much. `openclaw-host.ts` and `runView.ts` are mild (one
tag-along each) and are **not** worth a dedicated refactor right now (§4).

---

## 2. Top offenders — per-file decomposition

### 2.1 `runner/runner.ts` (2461) — the one real offender

**Co-located responsibilities, with `file:line` spans:**

| # | Cluster | Span | What it is |
|---|---|---|---|
| A | Injection-seam types + `RunOptions`/`RunResult`/`CheckpointWaiter` | 99–307 | The public option surface + the `ExecRunner`/`ExecWatchdogOpts`/`CheckpointWaiter` seam interfaces |
| B | `defaultExecRunner` (watchdog race + kill seam) + `defaultCheckpointWait` | 309–375 | The two default injectable primitives (watchdog/poll) |
| C | `lastJsonBlock` (forgiving return-parse) | 377–405 | Pure string→`NodeReturn` recovery |
| D | `stageMatches`/`selectWindow` (`--from/--until` window) | 407–433 | Pure stage-window selection |
| E | MCP/cred env staging: `CLOUD_KINDS`, `IN_PLACE_KINDS`, `selectedBridgedTool`, `referencedEnvVars`, `mcpEnvAdditions`, `cloudCredEnvAdditions` | 443–559 | Build the per-node env-allowlist additions (secret broker seam) |
| F | `RunContext` interface + `readHostFile`/`stageHostPathIntoSandbox`/`toPosixRel` | 561–695 | The shared mutable run state + host↔sandbox staging helpers |
| G | The retry/escalate FSM: `runNodeWithRetries` (+ SA-D L1/L2/L3 wiring header) | 839–957 | The bounded retry-by-failure-class + escalate-with-evidence lane |
| H | **No-pi node lanes**: `runCheckpoint`+`finishCheckpoint`, `runRerouteGate`, `runProgrammatic` | 711–1256 | Three node kinds that spawn no `pi` |
| I | The pi-node lifecycle: `runNode` (+`AttemptOverride`) | 1258–1925 | Create→stage→exec→collect→verify→G8-repair→promote→dispose (the single biggest function) |
| J | `finishNode` + `cappedRecord` | 1927–1998 | Terminal record stamping + journal write + the node-cap synthetic record |
| K | `openRunScope` (per-run scope or trivial forwarder) | 2000–2016 | The `RunScope` open seam |
| L | Resume: `envelopeHashOf`, `seedFromJournal`, `loadPriorStatus` | 2018–2128 | G4 journal-vs-window seed decision + prior-status carry-forward |
| M | `runWorkflow` (the run loop + barrier merge + halt) | 2130–2461 | The orchestration entrypoint |

**Proposed split** (all internal; every new module re-exported from `runner.ts` so its public seam and the
test-reachable symbols are unchanged):

| New module | Owns | ~Lines | Public seam (what importers see) |
|---|---|---:|---|
| `runner/exec-runner.ts` | Cluster B + the `ExecRunner`/`ExecWatchdogOpts`/`CheckpointWaiter` seam types (A-subset) | ~120 | `export const defaultExecRunner`, `defaultCheckpointWait`; `export interface ExecRunner, ExecWatchdogOpts, CheckpointWaiter` |
| `runner/return-parse.ts` | Cluster C | ~40 | `export function lastJsonBlock(text): NodeReturn \| null` |
| `runner/window.ts` | Cluster D | ~35 | `export function selectWindow(wf, from?, until?): { fromIdx; untilIdx }` |
| `runner/env-staging.ts` | Cluster E | ~130 | `export function selectedBridgedTool(node)`, `mcpEnvAdditions(...)`, `cloudCredEnvAdditions(...)`, `referencedEnvVars(...)`, `CLOUD_KINDS`, `IN_PLACE_KINDS` |
| `runner/run-context.ts` | The `RunContext` interface + `readHostFile`/`stageHostPathIntoSandbox`/`toPosixRel` (F) | ~150 | `export interface RunContext`; `export function stageHostPathIntoSandbox(...)`, `readHostFile(...)` |
| `runner/node-lanes.ts` | Cluster H (the 3 no-pi lanes) | ~470 | `export function runCheckpoint(ctx, node, spec)`, `runRerouteGate(ctx, node)`, `runProgrammatic(ctx, node)` |
| `runner/retry.ts` | Cluster G | ~120 | `export function runNodeWithRetries(ctx, node, scope): Promise<NodeStatusRecord>` |
| `runner/resume.ts` | Cluster L + `loadPriorStatus`/`openRunScope` (K) | ~130 | `export function seedFromJournal(...)`, `envelopeHashOf(...)`, `loadPriorStatus(...)`, `openRunScope(...)` |
| `runner/node-lifecycle.ts` | Cluster I + `finishNode`/`cappedRecord` (J) + `AttemptOverride` | ~720 | `export function runNode(ctx, node, scope, over?)`, `finishNode(...)`, `cappedRecord(...)`; `export interface AttemptOverride` |
| `runner/runner.ts` (remainder) | Cluster M (`runWorkflow`) + `RunOptions`/`RunResult` (A) + thin re-exports | ~330 | `export async function runWorkflow(...)`; **re-exports** `defaultExecRunner`, `defaultCheckpointWait`, `lastJsonBlock`, `selectedBridgedTool`, `cloudCredEnvAdditions` so `runner/index.ts` and the two tests that import from `runner.js` keep working unchanged |

This takes `runner.ts` from 2461 → ~330 lines (the orchestrator + the option types it owns), with the heavy
`runNode` lifecycle isolated in its own ~720-line module that can be edited without touching the loop.

**RISKS (call-outs):**

1. **`RunContext` is shared mutable state threaded into every lane** (defined runner.ts:563–648; mutated:
   `ctx.runState` reassigned at 2430, `ctx.failureSignals`/`ctx.promotesByNode`/`ctx.spawnedNodes` mutated
   throughout). It must move to its OWN module (`run-context.ts`) that the lane modules import, NOT live in
   `runner.ts` — otherwise `runner.ts → node-lifecycle.ts → runner.ts` is a **circular import**. The interface
   is a pure type (erased at compile, so a `type`-only circular ref would be tolerable), but
   `stageHostPathIntoSandbox`/`readHostFile` are VALUE helpers many lanes call, so co-locating them with the
   interface in a leaf module breaks the cycle cleanly. **This is the load-bearing sequencing constraint.**

2. **`runNode` ↔ `runNodeWithRetries` ↔ node-lanes mutual reach.** `runNodeWithRetries` (retry.ts) calls
   `runNode` (node-lifecycle.ts); `runProgrammatic` (node-lanes.ts) reuses `finishNode` (node-lifecycle.ts).
   These form a DAG, not a cycle, IF `finishNode`+`runNode` live together in `node-lifecycle.ts` and the
   lanes/retry import FROM it (one direction). Keep `finishNode` with `runNode` (do not give it its own
   module) precisely to keep that edge one-way.

3. **Test files import runner INTERNALS by path** — `test/runner.test.ts:12` imports `selectedBridgedTool`;
   `test/cloud-provider-cred.test.ts:16` imports `cloudCredEnvAdditions`; `test/self-correction-l1.test.ts`
   + `test/warm-resume-l1.test.ts` import `defaultExecRunner` + the `ExecWatchdogOpts` type — all from
   `'../src/runner/runner.js'`. **Every one of these symbols MUST stay re-exported from `runner.ts`** (a
   `export { selectedBridgedTool } from './env-staging.js'` line), or the suite breaks. This is the hard
   acceptance gate for each step. (No `@piflow/core` public-API change is forced — `runner/index.ts:4` and
   `index.ts:195` already pull these through the barrel, which re-exports from `runner.ts`.)

4. **op[] consumers stay put.** The runner reads derives/gates/run/action ops via `derivesFromOp`/
   `gatesFromOp`/`runOpsFromOp`/`actionsFromOp` from `op-dispatch.ts` (imported runner.ts:62). Those adapters
   already live in their own file (the "two-layer op[] reader" — memory `op-consumption-two-layer`); the
   split only MOVES the call sites (into node-lifecycle/node-lanes/retry), it does not touch the adapters.
   Verify the `derivesFromOp(node.op)` calls (runner.ts:1059, 1409) travel WITH their lane.

5. **No public-API break anywhere** — all 5 new symbols already surface only via the barrel; the new modules
   are internal-only and never added to `index.ts`. If any proposed move tempted an `index.ts` edit, that is
   the red flag to stop (none here do).

### 2.2 `tools/openclaw-host.ts` (748) — borderline, LOW priority

Three sub-concerns separated by section banners (already visually demarcated at 194/201, 555/560):

| Cluster | Span | Responsibility |
|---|---|---|
| The tool-execute host | 33–192, 411–554 | `injectSecrets`, `makeInMemoryKeyedStore`, `loudRuntimeStub`, `makeHostApi`, `hostOpenClawTool` |
| The embedded-agent seam | 204–409 | `runEmbeddedAgentViaPi`, `defaultRunPiCommand`, `finalAssistantTextFromPiJson`, `makeRuntimeAgent(ForTest)` |
| Plugin discovery | 560–727 | `openClawExtensionsDir`, `discoverToolBearingPlugins`, `captureToolNames`, `loadAllOpenClawPlugins` |

If/when this file is touched again, a clean split is `openclaw-host.ts` (execute host) +
`openclaw-embedded-agent.ts` (the `runEmbeddedAgentViaPi` seam) + `openclaw-discovery.ts` (plugin scan),
each re-exported from `openclaw-host.ts`. But it is cohesive enough (one subsystem, S0 driver) and NOT on
the hot edit path the way the runner is — **defer it.** Flagged here for completeness, not scheduled.

### 2.3 `observe/runView.ts` (498) — NOT worth splitting now

`buildRunView` (205–419) is one 215-line function but it is a single cohesive pipeline (replay events →
distill tokens → assemble node/stage/edge view). Its only tag-along is `previewView` (431–498), a separate
~70-line "render a not-yet-run workflow" path. The two share the `RunView*` types (22–125). A defensible
move is `runView-preview.ts` for `previewView`, but the saving is small and the types would have to be
re-homed. **Leave whole** (§4) unless `buildRunView` itself grows.

---

## 3. Sequencing (ordered, independently-committable, suite-green at each step)

All steps target ONLY `runner.ts`. Each step: move the cluster to its new module, add a re-export line in
`runner.ts`, run the suite (must stay green — the re-export keeps both `runner/index.ts` and the
internal-importing tests working). Smallest blast radius first.

**Serial-vs-parallel note:** every step edits `runner.ts` (to delete the moved code + add a re-export), so
the steps are **SERIAL on `runner.ts`** — they CANNOT be parallel subagents (shared file = merge conflict on
every commit). Run them one after another in the order below. (Within a single step, the work is small enough
for one agent.) The one genuinely independent unit is `run-context.ts` (Step 5), which other steps depend on
— so it is NOT last despite being riskier.

1. **`return-parse.ts`** (Cluster C, ~40 lines). Pure function, zero `RunContext` dependency, no test imports
   it directly but `lastJsonBlock` is re-exported via the barrel — keep the `runner.ts` re-export. Lowest risk;
   do it first to validate the move-then-reexport recipe.
2. **`window.ts`** (Cluster D, ~35 lines). Pure, no `ctx`. `selectWindow` is called once (runner.ts:2217).
3. **`exec-runner.ts`** (Cluster B + its seam types, ~120 lines). `defaultExecRunner`/`defaultCheckpointWait`
   are barrel-exported AND test-imported (`self-correction-l1`, `warm-resume-l1`) — re-export both + the
   `ExecRunner`/`ExecWatchdogOpts`/`CheckpointWaiter` types from `runner.ts`. Self-contained (no `ctx`).
4. **`env-staging.ts`** (Cluster E, ~130 lines). Re-export `selectedBridgedTool` + `cloudCredEnvAdditions`
   (both test-imported) + `mcpEnvAdditions` from `runner.ts`. Imports only `types.js` — no `ctx`.
5. **`run-context.ts`** (Cluster F — the `RunContext` interface + staging helpers, ~150 lines). **The pivot
   step.** After this, lanes/retry/lifecycle can import `RunContext` from a leaf module instead of from
   `runner.ts`, breaking the would-be cycle. Must precede Steps 6–8.
6. **`node-lanes.ts`** (Cluster H, ~470 lines — the §0 highest-value move). Imports `RunContext` from
   `run-context.ts`, `finishNode` from `runner.ts` (temporarily) — see Step 8 ordering note. Update the run
   loop's dispatch (runner.ts:2399/2406/2410) to import these three lanes.
7. **`retry.ts`** (Cluster G, ~120 lines). Imports `runNode` — keep that import pointing at `runner.ts` until
   Step 8 lands, then repoint to `node-lifecycle.ts`.
8. **`node-lifecycle.ts`** (Clusters I+J, ~720 lines — `runNode`+`finishNode`+`cappedRecord`+`AttemptOverride`).
   Largest move; do it once the leaf deps (`run-context`, `env-staging`, `exec-runner`, `return-parse`) exist
   so it imports cleanly. After it lands, repoint Step 6/7's `finishNode`/`runNode` imports here. The run loop
   in `runner.ts` now imports `runNode`→via `retry.ts`'s `runNodeWithRetries` and the lanes directly.
9. **`resume.ts`** (Cluster L+K, ~130 lines). `seedFromJournal`/`envelopeHashOf`/`loadPriorStatus`/
   `openRunScope`. Called only from `runWorkflow`; independent of 6–8, could swap with Step 5's position but
   keep after the pivot for a clean diff.

After Step 9, `runner.ts` is `runWorkflow` + `RunOptions`/`RunResult` + a re-export block (~330 lines).

**Verification per step (the gate):** `npm test` in `packages/core` stays green AND `grep` confirms the 5
barrel/test symbols (`runWorkflow`, `defaultExecRunner`, `defaultCheckpointWait`, `lastJsonBlock`,
`selectedBridgedTool`, `cloudCredEnvAdditions`) still resolve from `runner.ts`. A red suite = the re-export
was missed; revert that one step.

---

## 4. Leave-whole list (do NOT split — cohesive single-responsibility)

- **`types.ts` (963).** The frozen L1 schema spine — pure interface/type declarations + 2 one-line seam
  defaults (`defaultSecretResolver` types.ts:631, `defaultEscalator` 655). Big by line count, but it is ONE
  contract; splitting it would scatter the spine the whole SDK plugs into and invite drift (the file's own
  header at types.ts:10–11 warns against widening it casually). Everything `export *`s from here (index.ts:7).
- **`workflow/template/schema/node.schema.ts` (383).** A single exported JSON-Schema data literal. Lines ≠
  responsibilities.
- **`observe/telemetry.ts` (487).** One lens (the agent-facing projection), cleanly sectioned (digest /
  anomaly / root-cause / stream / OTel). Internal cohesion is high; no unrelated tenant.
- **`observe/runView.ts` (498).** One pipeline (`buildRunView`); `previewView` is a minor tag-along not worth
  a module churn (see §2.3).
- **`workflow/gate-authoring.ts` (391), `tools/compile.ts` (341), `runner/journal.ts` (334),
  `runner/logs.ts` (344), `sandbox/seatbelt.ts` (363).** Each is a single concern already in its own file —
  the `runner/` siblings are exactly the modular target shape `runner.ts` should match.
- **`tools/openclaw-host.ts` (748).** Splittable in principle (§2.2) but cohesive (one S0 driver subsystem)
  and off the hot edit path — defer, do not schedule.

**Best-practice note:** the goal is single-responsibility modules, NOT maximal fragmentation. Core already
has 18 well-scoped `runner/` siblings; the entire job is bringing `runner.ts` down to that same shape. Do not
manufacture `utils.ts` buckets — every new module above names a concrete public seam.
