# Condition: PORT — parse a Claude Code Workflow `.js` → `@piflow/core` WorkflowSpec

You have a proven Claude Code Workflow (`.claude/workflows/<name>.js`, the `agent()`/`parallel()`/
`pipeline()`/`phase()` form) and want it as a typed `WorkflowSpec` the SDK's `compile()` consumes. This is
the extract→WorkflowSpec bridge.

## Do this
```bash
node <skill>/scripts/parse-claude-workflow.mjs <path/to/workflow.js> [--arg k=v ...] -o out.spec.json
```
- `--arg k=v` passes workflow input args through (a STATIC input-arg branch realizes its DAG — e.g.
  `--arg mode=companion` drops the verify nodes), exactly as `extract.mjs` does.
- Exit **0** means the spec was emitted AND it `compile()`s with the recorded staging preserved (the oracle).
  Exit **non-zero** means extraction or the compile self-check failed — the spec is NOT trustworthy; fix the
  cause, do not hand-edit around it.

## What the script does (and why it's faithful, not a guess)
It does NOT re-parse the `.js` by hand. It REUSES two ground-truth pieces:
1. **`templates/pi-runner/extract.mjs`** — runs the workflow body under recording stubs and captures the
   EXACT realized prompts + the parallel/serial grouping (the same recording the pi driver replays). No codegen.
2. **`@piflow/core`'s own `parseMarkers` + `compile`/`tryCompile`** — so the marker grammar and the DAG
   compiler are the SDK's, never a fork.

Per recorded node it emits one `NodeIntent`:
- `prompt` = the realized text with the `DRIVER-*` marker lines **stripped** (the SDK re-emits markers from
  `io` via `markersFromNode`; leaving them in the prose would duplicate them in the spawned pi prompt).
- `io.artifacts` ← `DRIVER-ARTIFACTS` (with per-artifact `schema` from `DRIVER-SCHEMA`).
- `io.checks` / `io.policy` / `io.returnMode` / `io.fillSentinel` ← the matching markers (usually absent — see
  "the gap" below).
- `sandbox.read` ← `DRIVER-READ-SCOPE`, `sandbox.write` ← `DRIVER-OWNS`.
- `tools.allow` ← `DRIVER-TOOLS`, `tools.deny` ← `DRIVER-EXCLUDE-TOOLS`; `agentType` ← the recorded hint.
- **`io.dependsOn`** = every node id of the immediately-preceding recorded stage. This reproduces the EXACT
  recorded staging (serial order + parallel lanes) without needing data-flow inference. `io.reads`/`produces`
  are left empty in the mechanical port; the DAG rides on `dependsOn`.

The self-check then compiles the spec and asserts the compiled stage count and per-stage membership equal the
recording — so a 0 exit means "the DAG survived the translation," not merely "the script ran."

## What the LLM MUST CONSTRUCT — the port is the FLOOR, the LLM builds the run-ready template
piflow-init is an LLM-driven skill: `parse-claude-workflow.mjs` does the MECHANICAL half (the realized prompts
+ the DAG + artifacts/tools/sandbox); **you, the LLM, then CONSTRUCT everything else a successful run needs and
MERGE it into the template — miss nothing.** The bar is NOT "it compiles" — it is **a green dry-run AND a clean
live run in which every hook fires and every declared artifact lands on disk.** The mechanical port emits
0 hooks, 0 policy, 0 returnMode and empty data-flow; the SDK is safe-by-default with these absent (it cannot
over-block), but the run is INCOMPLETE until you build them. Construct each, per node, from the source `.js`'s
intent (`enrich-contract.md` is the per-target how-to, with a worked exemplar):

1. **op[] (the largest construct — the whole deterministic-action layer).** Every `DRIVER-SEED` (pre) and
   `DRIVER-PROJECT`/`DRIVER-MERGE`/`DRIVER-SEED-CONTRACT` (post) marker in the source is a deterministic action
   the text port drops. Re-express each as an entry in the node's canonical **`op[]`** array — a `pre`/`post`
   `transform` (seed/project/projectRegistry/merge/promote), a `run` (shell side-effect: top-level `run` +
   `onFailure:"block"` for a GATE, else a `transform:merge` for a no-verdict derive), or a bare `reads` (a
   forced read) — with `{{WORKSPACE}}`/`{{RUN}}`/`{{state.*}}`/`{project}` tokens. See `enrich-contract.md §1`
   for the full source-marker → `op[]` table (and the legacy `hooks`/`inject` alias each replaces). **Point
   every `run`-op cmd at the CURRENT code path** (e.g. a relocated script), never the path the old `.js` used.
2. **State promotion.** Any `{{state.X}}` token a downstream seed/project resolves against needs a node that
   PROMOTES it (e.g. w0 classify → `promote` archetype → `state.archetype`). The port has no state-channel
   awareness; add the `promote` on the establishing node or every downstream token resolves to nothing.
3. **SDK-vocabulary translation.** Rename the Claude/pi-runner marker vocab to the SDK's
   (`project`→`registryProject`, `genre`→`key`, …) so the hooks bind to `@piflow/core`'s op set, not the legacy
   monolith's.
4. **Contract decisions — `policy` / `returnMode` / `checks` / `fillSentinel`.** The Claude `contract()` emits
   only `artifacts`/`owns`/`readScope`/tools. Add: `policy.fail:"block"` on every producing node (the artifact
   gate); `returnMode` where the default is wrong (default = optional-with-artifacts, required for a
   zero-artifact gate); the integrity `checks` + `fillSentinel` the workflow relied on.
5. **True data-flow (optional upgrade).** The port pins the recorded order via `io.dependsOn`. To reveal real
   parallelism, replace it with each node's actual `io.reads` (upstream files) + `io.produces` (its artifacts).
   Keep `dependsOn` until you do — never ship a spec with neither.

**The miss-nothing self-check (run before declaring the port done):** every `DRIVER-*` marker in the source has
a matching hook in the template · every `{{state.X}}` token has a promoting node · every producing node has
`policy.fail` + an artifact contract · the green dry-run compiles the SAME stage count + membership as the
source · a live run produces every artifact and fires every hook. **A template that compiles but drops a hook
is a FAILED port, not a partial one.**

## Fixture
`fixtures/sample-workflow.js` is a 4-node (serial → parallel(2) → serial) workflow carrying the full marker
family. Porting it must yield 4 nodes / 3 stages that compile with the parallel lane preserved — the script's
own regression check.
