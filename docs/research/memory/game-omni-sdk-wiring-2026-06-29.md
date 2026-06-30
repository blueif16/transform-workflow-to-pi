# game-omni ↔ piflow SDK wiring (code-grounded, 2026-06-29)

## 0. Method + files read

Read-only audit of `/Users/tk/Desktop/game-omni` against the piflow SDK design lens. Every game-omni
claim cites a real `file:line` or path; "absent" names what was grepped and where. NOTHING in game-omni was
edited; this doc in the piflow worktree is the only artifact written.

Design lens read first (in the piflow worktree):
- `docs/research/memory/piflow-memory-v1.5.md` — the four-way triage (§3), the two gates (§2), the scoring
  cascade (§4d), the §5.1 held-out-replay critical path.
- `docs/research/memory/gap-analysis-optimizer-substrate-2026-06-29.md` — what the SDK runner/observe/checks
  emit today (SHIPPED vs DESIGNED).

game-omni files read (in-lane = execution/wiring):
- `CLAUDE.md` (the project guide / pipeline narrative + the "How to run" block).
- `.piflow/game-omni/template/meta.json`, `workflow.json` — the DAG, phases, profiles.
- All 16 `nodes/<id>/node.json` (w0-classify, w1-design, gameplay, asset, guidance, model, shell, sound,
  verify-1-design, w2-scaffold, w4-execute-m1/m2/m3, verify-2-m1/m2/m3) + spot-read prompts.
- `deploy.sh`, `scripts/_compliance-check.mjs`, `.mcp.json`, `.codegraph/{daemon.log,.gitignore}` (no root
  `package.json` exists — `wc package.json` → no such file).
- `.pi/{run.json,state.json}` (the repo-root copy of the latest run) + `.piflow/game-omni/runs/{gs01,gs02,p06,run01,RUN02}/`
  (run state, `.pi/journal.json`, `MEMORY.*.md`, `HERMES-ROUTING.md`).
- SDK side, to confirm the profile mechanism: `packages/core/src/workflow/profile.ts`.

Sibling-lane assets NOTED + HANDED OFF (NOT analyzed — the quality/eval/criteria agent owns these):
`.agents/skill-system-criteria.md` (115 KB per-node quality bar), `.agents/okf/`, `eval/` (per-archetype
prompt banks + `eval/gold/`). In-lane exception: `.agents/node-catalog.json` IS execution wiring (a node
hook consumes it; §2) and `.agents/skill-system-{map,io-map,playbooks}.md` + `tracked-systems.md` are the
hand-maintained wiring ledgers (§5/§6) — those I read for WIRING, not quality content.

---

## 1. The template + the DAG (every node, phase, deps)

Source of truth: `.piflow/game-omni/template/`. `meta.json:1-20` declares `id:"game-omni"`, eight phases
(`classify, design, gameplay, producers, verify-1, scaffold, execute, verify-2`,
`meta.json:5-14`), two profiles (`meta.json:15-18`), `defaultProfile:"production"` (`meta.json:19`).

**The real v1.6 DAG diverges from the CLAUDE.md narrative.** CLAUDE.md still describes the old
`W0 → W1 → Harden → VERIFY-1 → W2 → W3a → W3b → (W4 → VERIFY-2)×N` shape (`CLAUDE.md` pipeline table). The
SHIPPED template (`workflow.json:1-149`, `meta.json:4` description) is the **dependency-separated v1.6**
tier: `gameplay` (= "Harden", the blueprint producer) hardens a gameplay-only blueprint and seeds per-node
contracts, then **five chrome producers run in PARALLEL** (`asset, guidance, model, shell, sound`), each
folding its section back into `blueprint.json`, then the build tier. The milestone fan-out is **statically
materialized to 3 milestones** (m1/m2/m3) — NOT a runtime ×N expansion (see §3).

**16 nodes, 12 stages** (`workflow.json:7-48`; one extra stage vs `meta.json`'s 8 phases because `execute`
and `verify-2` each occupy 3 serial stages). Per-node phase + deps (`workflow.json:49-148`, cross-checked
against each `node.json`'s `deps`):

| Node | Phase | deps (from workflow.json) | Skill (prompt.skill) |
|---|---|---|---|
| `w0-classify` | classify | — (root) | `classify-game` |
| `w1-design` | design | `w0-classify` | `write-gdd` |
| `gameplay` (= Harden) | gameplay | `w1-design` | `harden-blueprint` |
| `asset` | producers | `gameplay` | `assets` |
| `guidance` | producers | `gameplay` | `author-guidance` |
| `model` | producers | `gameplay` | `assets` (reused, W3c section) |
| `shell` | producers | `gameplay` | `author-shell` |
| `sound` | producers | `gameplay` | `sound-author` |
| `verify-1-design` | verify-1 | `shell, guidance, asset, sound, model` (join of all 5 producers) | `verify-design` |
| `w2-scaffold` | scaffold | `verify-1-design` | `scaffold` |
| `w4-execute-m1` | execute | `w2-scaffold` | `implement-milestone` |
| `verify-2-m1` | verify-2 | `w4-execute-m1` | `verify` |
| `w4-execute-m2` | execute | `verify-2-m1` | `implement-milestone` |
| `verify-2-m2` | verify-2 | `w4-execute-m2` | `verify` |
| `w4-execute-m3` | execute | `verify-2-m2` | `implement-milestone` |
| `verify-2-m3` | verify-2 | `w4-execute-m3` | `verify` |

DAG shape: a single source (`w0-classify`) → linear to `gameplay` → **fan-out 5** (producers) → **fan-in 1**
(`verify-1-design` joins all 5, `verify-1-design/node.json:4-10`) → `w2-scaffold` → then a strictly serial
**execute↔verify-2 ladder** (each milestone's verify gates the next milestone's execute:
`w4-execute-m2.deps=[verify-2-m1]`, `w4-execute-m3.deps=[verify-2-m2]`, `workflow.json:130-147`). The
milestone count (3) is baked into the node set, not parameterized.

---

## 2. Per-node contract × SDK-feature matrix

Read from each `nodes/<id>/node.json`. Legend: ✓ = present/used, — = absent. Hooks: game-omni uses the
**`hooks.{seed,promote,merge,registryProject}`** object form (an alias for the SDK `op[]` derive hooks);
the only literal **`op[]`** array usage is the verify-2 reroute action (last column).

| Node | artifacts | owns | readScope | schema | returnMode | return-schema | checks.post | seed | promote | merge ops | registryProject | tools.allow extras | timeoutMs / retries | policy.fail | op[] (action) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| w0-classify | spec/classification.json | spec/** | 3 | — | optional | ✓ (9 req fields) | — | — | ✓ `classification.json:archetype → state.archetype` | — | — | bash | — | block | — |
| w1-design | spec/gdd.md | spec/** | 3 | — | optional | ✓ (status enum) | ✓ `fenced-tail` json `milestones` minItems 3 | ✓ ×2 (gdd skeleton + genre-options) | — | — | — | — | retries:2 | block | — |
| gameplay | spec/blueprint.json | spec/** | 3 | ✓ `…/{{state.archetype}}/blueprint.schema.json` | (default) | — | — | ✓ (blueprint template) | — | ✓ `run` seed-contracts.mjs (reads `.agents/node-catalog.json`) | — | — | timeoutMs:2700000 | block | — |
| asset | asset-prompts.json, public/assets/asset-manifest.json | asset-prompts.json, MEMORY.asset.md | 2 | — | optional | ✓ (status/promptsAuthored/paletteRoles) | — | — | — | ✓ `run` generate_assets.py | — | — | — | block | — |
| guidance | spec/guidance.fragment.json | (same) | 4 | ✓ `…/guidance.section.schema.json` | (default) | — | — | — | — | ✓ `fold` → blueprint.guidance | — | — | — | block | — |
| model | model-queries.json | model-queries.json, MEMORY.model.md | 2 | — | optional | ✓ (status/queriesAuthored) | — | — | — | ✓ `run` fetch_models.py | — | — | — | block | — |
| shell | spec/shell.fragment.json | (same) | 2 | ✓ `…/shell.section.schema.json` | (default) | — | — | — | — | ✓ `fold` → blueprint.shell | — | — | — | block | — |
| sound | spec/sound.fragment.json | (same) | 4 | ✓ `…/sound.section.schema.json` | (default) | — | — | — | — | ✓ `fold` → blueprint.sound | — | — | — | block | — |
| verify-1-design | spec/DESIGN_REVIEW.md | spec/** | 4 | — | optional | ✓ (result enum + rubric) | — | — | — | — | ls,grep,find,bash | — | block | — |
| w2-scaffold | STRUCTURE.md, index.json, verify/event-bindings.ok.json | src/**,STRUCTURE.md,index.json,package.json,…,MEMORY.w2.md | 3 | — | optional | ✓ (status built/failed + 6 fields) | — | ✓ ×3 (coreBase, src, core-contract) | — | ✓ `concat` MEMORY.*.md + 2× `reconcile` + `run` check-event-bindings | ✓ (blueprint→genres.json by archetype) | bash | — | block | — |
| w4-execute-m1 | MEMORY.w4-M1.md | src/**,STRUCTURE.md,MEMORY.w4-M1.md | 3 | — | optional | ✓ (milestone/status + 4) | — | — | — | ✓ `run` check-event-wiring.mjs | — | bash | — | block | — |
| w4-execute-m2 | MEMORY.w4-M2.md | (same, M2) | 3 | — | optional | ✓ | — | — | — | ✓ `run` check-event-wiring | — | bash | — | block | — |
| w4-execute-m3 | MEMORY.w4-M3.md | (same, M3) | 3 | — | optional | ✓ | — | — | — | ✓ `run` check-event-wiring | — | bash | — | block | — |
| verify-2-m1 | verify/report.M1.json | src/**,verify/**,MEMORY.md | 4 | — | optional | ✓ (marker/passed + 8) | — | — | — | — | ls,grep,find,bash | — | block | ✓ `on-failure → rerouteTo w4-execute-m1, max:4, evidence:[report.M1.json]` |
| verify-2-m2 | verify/report.M2.json | (same) | 4 | — | optional | ✓ | — | — | — | — | ls,grep,find,bash | — | block | ✓ `→ w4-execute-m2, max:4` |
| verify-2-m3 | verify/report.M3.json | (same) | 4 | — | optional | ✓ | — | — | — | ls,grep,find,bash | — | block | ✓ `→ w4-execute-m3, max:4` |

**Features the template uses HARD** (every / most nodes):
- **`contract.owns` + `readScope`** — every node (`w0-classify/node.json:26-33`, etc.). This is the sandbox
  jail = the per-node blast radius the v1.5 §3③ FUNCTIONALITY gate would edit within. `owns` is tight: chrome
  producers own a single fragment file; build nodes own `src/**`; verify-1 owns `spec/**` only (cannot touch code).
- **`return` JSON schema** (structured-return validation) — 13 of 16 nodes carry a rich `return` object schema
  (`w0-classify/node.json:49-75` is the richest; the 3 chrome producers with a `schema` use the default
  returnMode instead). This is the SDK's `returnSchema`/`returnMode` Tier-1 gate.
- **`hooks.merge.ops[]`** — the workhorse: `run` (spawn a node/python tool — gameplay, asset, model, w2, all
  w4), `fold` (merge a fragment into blueprint — shell/guidance/sound), `concat` (gather `MEMORY.*.md` →
  `MEMORY.md`, `w2-scaffold/node.json:73-79`), `reconcile` (fold asset/model manifests into index.json with a
  schema + conditional fields, `w2-scaffold/node.json:80-106`). These are the SDK `op[]` derive hooks under the
  object alias.
- **`policy.fail:"block"`** — uniform on all 16 nodes (no `warn`/`stop` anywhere).

**Features used SELECTIVELY:**
- **`schema`** (artifact JSON-Schema validation): only gameplay (archetype-keyed `blueprint.schema.json`) +
  the 3 section-schema chrome producers (shell/guidance/sound). asset/model validate via `return` schema not
  artifact schema; the verify nodes carry none.
- **`checks.post`**: exactly ONE node — `w1-design` with a single `fenced-tail` check
  (`w1-design/node.json:36-47`: the GDD's fenced-JSON `milestones` tail must have ≥3 items). No other node
  uses `checks.post`; the integrity bar lives in `return` schemas + the `merge.run` tool gates instead.
- **`hooks.seed`**: w1-design (gdd skeleton + per-archetype genre-options), gameplay (blueprint template),
  w2-scaffold (3 seeds incl. an archetype-resolved `coreBase`). **`hooks.promote`**: only w0-classify (lifts
  `archetype` into `state` — confirmed live in `.pi/state.json:{"archetype":"gallery_shooter"}`).
  **`registryProject`**: only w2-scaffold (`node.json:66-70`).
- **`timeoutMs`**: only gameplay (45 min, `gameplay/node.json:20`). **`retries`**: only w1-design (2,
  `w1-design/node.json:20`). **`fillSentinel:"<FILL:"`**: only w1-design + gameplay (the partial-artifact
  completeness sentinel); all others `null`.
- **`tools.allow`**: a small fixed set per node-type — design/producer nodes get `read,write,edit,submit_result`;
  classify/verify/build nodes additionally get `ls,grep,find,bash`. No `tools.deny` is ever populated
  (every node's `deny:[]`).

**Features NOT used anywhere (grepped across `nodes/`):**
- **`model` / `tier` / `provider`** — ZERO per-node routing. (`grep -E '"(model|tier|provider)"' nodes/`
  matches only the node literally named `model` and a `"tier":"library"` field inside `model/prompt.md`'s JSON
  example — neither is SDK routing.) Model selection is **global**, set at the CLI (`--provider`, `--thinking`)
  — confirmed in the recorded command: `pi … --provider mmgw … --thinking low` (`.pi/run.json` node `command`
  field). So per-node heterogeneous routing — the SDK feature the memory MEMORY note calls the per-node moat —
  is available but UNUSED by game-omni.
- **`mcp`** — ZERO per-node MCP config. The only MCP server (`codegraph`, `.mcp.json`) is a dev-time tool for
  the Claude Code orchestrator, not bound to any node (§4).
- **`op[]` action protocol** beyond `rerouteTo` — only the three verify-2 nodes carry an `op[]` array, all the
  same `on-failure → rerouteTo` shape. No `notify`, `pre-fn-run`, hook/action kinds elsewhere.

---

## 3. The verify gates + the profile toggle

**Both verify tiers are pure gates** — they produce a verdict artifact the build does not bind to, exactly
the CLAUDE.md "a verify node verifies + stabilizes, it is NEVER the primary creator" law:
- **`verify-1-design`** (`node.json`): owns `spec/**`, artifact `spec/DESIGN_REVIEW.md`, returns
  `result ∈ {DESIGN_PASSED, DESIGN_FAILED}` + a `rubric[]` + `stabilizedEdits[]` (`node.json:47-57`). The
  blueprint it judges is PRODUCED by `gameplay` + the chrome producers' folds — verify-1 only re-derives the
  feasibility/dangling-ref math over it. It is the fan-in join of all 5 producers (`deps`, `node.json:4-10`).
- **`verify-2-m{1,2,3}`** (`node.json`): own `src/**, verify/**, MEMORY.md`, artifact
  `verify/report.M<n>.json`, return `marker ∈ {VALIDATION_PASSED, VALIDATION_FAILED}` + `passed` +
  `fixCycles (0–3)` + `perturbationInvariant` + an `escalation` string (`verify-2-m1/node.json:56-72`). Each
  runs the headless `packages/verify/` harness against `window.__GAME__`.

**The self-correction wiring on the verify-2 gates is the literal SDK `op[]` action protocol:** each carries
`op:[{ when:"on-failure", action:{ kind:"rerouteTo", node:"w4-execute-m<n>", max:4, evidence:["verify/report.M<n>.json"] }}]`
(`verify-2-m1/node.json:7-17`). On a `VALIDATION_FAILED` the runner reroutes back to that milestone's executor
with the report as evidence, bounded to 4 cycles. (Note `return.fixCycles` is capped at 3 — the verify node's
OWN inner self-fix loop — distinct from the `max:4` outer reroute.) The `escalation` field is the route-UP
seam (a genuine DESIGN problem routes to verify-1, never the executor) — the v1.5 §3④ ARCH route, declared in
the schema but driven by the skill prose, not a wired `op[]`.

**The profile toggle is the SDK's generic node-elision primitive**, not a game-omni branch.
`meta.json:15-18` declares two profiles as DATA: `production:{}` (no-op, the full 16-node DAG) and
`companion:{ elidePhases:["verify-1","verify-2"] }`. The SDK applies the predicate verbatim — `profile.ts`
header: "the SDK applies the predicate verbatim and never branches on a profile name"; the load-bearing
transitive rewire (`profile.ts:10-19`) collapses `a → v1 → b` to `a → b` so the surviving graph stays
gateless. **Which nodes elide under `companion`:** `verify-1-design` + `verify-2-m1/m2/m3` (4 nodes, the two
verify phases). **Verified live:** the `run01` record is a companion run whose node set is exactly the 12
non-verify nodes, all `ok`, `done:true ok:true` (`.piflow/game-omni/runs/run01/.pi/run.json`), and the gs02
companion record shows `profile:"companion"` with only the non-verify nodes journaled
(`.piflow/game-omni/runs/gs02/.pi/{run.json,journal.json}`). `defaultProfile:"production"` (`meta.json:19`)
runs all 16. The skill prose (CLAUDE.md "How to run") confirms: companion = "the orchestrator + human ARE the
verifier" for archetype bring-up; production = the unattended two-gate default.

---

## 4. Runtime: invocation, .pi state, codegraph daemon, runs layout

**Invocation.** game-omni has NO root `package.json` and NO build/run npm script (`wc package.json` → no such
file). The canonical run command is the **global `piflowctl run <templateDir>` bin off the SDK**, documented
in CLAUDE.md "How to run": `piflow run .piflow/game-omni/template --workspace . --arg prompt="…"` (+
`--profile companion`), with `--provider … --thinking low --sandbox local` pinned by the `piflow-start` skill,
and **NEVER `--out`** (the run home is SDK-derived). The actual per-node command is captured verbatim in the
run record's `command` field, e.g.
`pi -p --mode json -a --no-session --offline --no-extensions --no-context-files --provider mmgw --tools read,… --thinking low -e '_pi/w0-classify/tools.ts' @'_pi/w0-classify/prompt.md'`
(`.pi/run.json`, w0-classify node) — one `pi` process per node, the global provider (`mmgw`), no per-node
model. `deploy.sh` is a SEPARATE concern: it builds/serves the **gallery** (`apps/gallery/build.mjs` +
`server.mjs`, a viewer of finished games), NOT the workflow runner. `scripts/_compliance-check.mjs` is a
throwaway probe that `loadTemplate` + `compile`s the template against the SDK `dist` to prove it loads
(`scripts/_compliance-check.mjs:5-18`).

**`.pi/` run state** (the SDK shared run model). Per run dir `.pi/` holds: `run.json` (the rich record — run
id, `promptId`, `profile`, `provider`, `model:null`, `stage{index,total,nodeIds}`, and a `nodes{}` map with
per-node `status`/`artifacts[]`/`checks[]`/`command`/`exitCode`/`durationMs`/`summary`), `state.json` (the
promoted channel state — `{"archetype":"gallery_shooter"}`, written by w0-classify's `promote` hook),
`workflow.json` (the compiled DAG), `journal.json` (the v2 content-hash journal: per-node `hash` +
`inputHashes` + `outputHashes` + `status` + `producedAt`, `.piflow/game-omni/runs/gs02/.pi/journal.json` — the
SDK resume/replay substrate), and `nodes/<id>/` per-node event persistence. A repo-root `.pi/` mirrors the
most recent run (gs01).

**`.codegraph/` daemon — NOT part of the workflow runner.** `.codegraph/` holds `codegraph.db` (a 116 MB
SQLite index) + `daemon.log`. It is an external MCP server (`codegraph serve --mcp`, v1.0.1) wired into Claude
Code via `.mcp.json` (`{"codegraph":{"command":"codegraph","args":["serve","--mcp"]}}`). The daemon runs a
file watcher that auto-syncs the graph on change (`daemon.log`: "File watcher active — graph will auto-sync",
"Auto-synced 1 file(s)…", "Caught up 76 file(s) changed since last run"). Everything in `.codegraph/` except
`.gitignore` is git-ignored (`.codegraph/.gitignore`: `*` / `!.gitignore`) — local per-machine. **No node
binds it** (no `mcp` in any `node.json`); it is a dev-side code-navigation aid for the human/orchestrator, the
ad-hoc analogue of the v1.5 Leg-B Tier-1 codegraph (which the SDK does not yet ship).

**Where runs land.** `.piflow/game-omni/runs/<id>/` — confirmed dirs `gs01, gs02, p06, run01, RUN02`. A
completed run dir is a full game project (`spec/, src/, public/, dist/, node_modules/, verify/, index.json`,
`STRUCTURE.md`, `MEMORY*.md`) plus `.pi/`. The gallery (`apps/gallery/server.mjs`) auto-discovers every run
under this canonical home (and legacy `out/`) and plays each built `dist/` inline. Legacy/earlier copies also
sit in `out/` and `_prior-runs/` (e.g. `out/run01/`, `_prior-runs/run01/`), which the HERMES doc and the older
runs reference with `out/<id>/` paths.

---

## 5. The per-run MEMORY/*.md practice vs the v1.5 Leg-A design

**What game-omni records, and at what granularity.** Two distinct on-disk memory artifacts, both
**run-scoped** (they live inside `.piflow/game-omni/runs/<id>/`, not in the template):

1. **`MEMORY.<node>.md` → concatenated `MEMORY.md` (per-node, agent-written).** Each producing node writes its
   own fragment as a declared artifact in its `owns` set: `MEMORY.asset.md` (asset), `MEMORY.model.md` (model),
   `MEMORY.w2.md` (w2-scaffold), `MEMORY.w4-M1/M2/M3.md` (each milestone executor) — confirmed present in
   `runs/{gs01,p06,run01}/`. The **node's executor writes it**, recording the build state it observed, the
   fix it applied, root-cause traces, and a quirk log — e.g. `runs/run01/MEMORY.w4-M1.md` records a TS2305
   barrel-export failure, its root cause (W2 placed gallery_shooter content in the endless_runner barrel), the
   exact fix (copied the correct barrel from the testkit cache), and the post-fix green build. The
   `w2-scaffold` node's `concat` op (`w2-scaffold/node.json:73-79`, glob `MEMORY.*.md → MEMORY.md`, heading
   `## {name}`) gathers all fragments into one `MEMORY.md` — confirmed in `runs/run01/MEMORY.md`. Granularity:
   **per-node (and per-milestone for W4)**, within a single run.

2. **`HERMES-ROUTING.md` (per-run, orchestrator/human-written).** Present only in `runs/run01/` (and
   `_prior-runs/{gs01,run01}/hermes-routing.md`). This is NOT written by a node; it is the Hermes
   capture→route artifact written by the orchestrator AFTER the run, mapping each verify finding to a root
   cause + a SOURCE OWNER (a `file:line`, a skill, or a module) + a chain-vs-node decision + local-vs-promote
   + confidence (`runs/run01/HERMES-ROUTING.md` "Routing summary" table). It is effectively a hand-built
   four-way-triage-and-route ledger over ONE run's verify reports.

**How this differs from the v1.5 Leg-A `memory.md` design (the core contrast):**

| Axis | game-omni today | v1.5 Leg-A design |
|---|---|---|
| **Scope** | RUN-scoped — every `MEMORY*.md` lives in `runs/<id>/`, born and dying with one run | TEMPLATE-scoped — a per-node `memory.md` beside `node.json`, persisting ACROSS runs (the SDK scaffold `packages/core/src/memory/{skeleton,seed}.ts`) |
| **Consumer / direction** | INJECTED forward, intra-run — a downstream node reads upstream fragments as context (e.g. w4 reads w2's notes); the agent is the writer AND reader | OPTIMIZER-FACING — the across-run fixer reads/edits it; it is the durable Leg-A self/history surface the triage→fixer loop consults and updates |
| **Who writes** | the node EXECUTOR (the MEMORY.\*.md) + the human/orchestrator (HERMES-ROUTING.md), free-form prose | the SDK seeds a STRUCTURED skeleton (capped ~40 lines, top-loaded), the optimizer maintains it under a cap/freshness contract |
| **Template presence** | NONE — `find template -iname memory.md -o -iname code-map.md` → zero files; the template carries no Leg-A/Leg-B scaffold at all | the v1.5 substrate is exactly these template-scoped `memory.md` + `code-map.md` files |
| **Routing/triage** | `HERMES-ROUTING.md` is a HAND-WRITTEN, file-based, post-hoc routing doc, one per run, not machine-consumed | the four-way triage is a designed (not-yet-built) projector feeding an automated fixer with an across-run gate |

So game-omni's practice is the **ad-hoc, run-scoped, human-in-the-loop precursor** to v1.5 Leg-A: the
`MEMORY.*.md` fragments are an intra-run working memory injected forward between nodes, and `HERMES-ROUTING.md`
is the manual stand-in for the optimizer's triage+route output — neither is template-scoped, neither is
optimizer-readable storage, and the SDK's `memory.md`/`code-map.md` scaffold is entirely absent from this
template.

---

## 6. SDK-capability usage verdict (using / ad-hoc / not-used)

| SDK capability | Verdict | Evidence |
|---|---|---|
| **`op[]` derive hooks** (seed / promote / merge: run/fold/concat/reconcile / registryProject) | **USING — hard.** The central wiring mechanism. | `gameplay` seed+`run`; `shell/guidance/sound` `fold`; `asset/model` `run`; `w2-scaffold` seed×3 + concat + reconcile×2 + run + registryProject (`w2-scaffold/node.json:51-126`); `w0-classify` `promote` (`node.json:40-48`) |
| **`op[]` action protocol** (on-failure → rerouteTo, the bounded reroute) | **USING — narrowly.** Only the 3 verify-2 gates, all `rerouteTo …, max:4`. No other action kinds. | `verify-2-m1/node.json:7-17` (+ m2,m3) |
| **`checks.post`** | **USING — minimally / AD-HOC elsewhere.** Exactly one node (w1 `fenced-tail`). The rest of the integrity bar is carried by `return` schemas + `merge.run` tool gates (event-binding/event-wiring receipts) rather than `checks.post`. | `w1-design/node.json:36-47`; the receipts at `w2-scaffold/node.json:107-123`, `w4-execute-m1/node.json:41-58` |
| **Artifact `schema` gate** | **USING — selectively.** gameplay (archetype-keyed) + 3 section-schema chrome producers. | `gameplay/node.json:33`; `shell/guidance/sound .../*.section.schema.json` |
| **Structured `return` schema** (returnMode/returnSchema) | **USING — broadly.** 13 of 16 nodes carry a rich `return` object schema; `returnMode:"optional"` on most. | `w0-classify/node.json:49-75`; verify nodes' verdict schemas |
| **Profiles** (`elidePhases`) | **USING — exactly as designed.** Two declared profiles, the generic SDK predicate, verified live elision. | `meta.json:15-18`; `profile.ts`; companion `run01`/`gs02` records |
| **Sandbox `owns` / `readScope`** | **USING — every node, tight.** The per-node jail is fully populated; `--sandbox local` pinned at the CLI. | every `node.json` `contract.owns`+`readScope`; CLAUDE.md "How to run" |
| **Per-node routing** (`model`/`tier`/`provider`) | **NOT USED.** Zero per-node routing; model is global via `--provider mmgw --thinking low`. The piflow per-node-heterogeneity moat is left on the table here. | grep `nodes/` → none; `.pi/run.json` command field |
| **Per-node `mcp`** | **NOT USED in nodes; AD-HOC at dev layer.** codegraph MCP serves the orchestrator, bound nowhere in the template. | `.mcp.json`; no `node.json` `mcp` key |
| **`timeoutMs` / `retries`** | **USING — sparingly.** timeoutMs only gameplay; retries only w1-design. | `gameplay/node.json:20`; `w1-design/node.json:20` |
| **`policy.fail`** | **USING — uniformly `block`.** No `warn`/`stop` used. | all 16 `node.json` |
| **The memory scaffold** (template-scoped `memory.md` / `code-map.md`, the v1.5 Leg-A/Leg-B substrate) | **NOT USED (SDK scaffold) — replaced by an AD-HOC, run-scoped version.** game-omni has its own run-scoped `MEMORY.*.md` + `HERMES-ROUTING.md` convention; the SDK's template-scoped scaffold is absent (§5). | `find template … memory.md` → 0; `runs/<id>/MEMORY*.md`, `HERMES-ROUTING.md` |
| **Across-run scoring / replay gate** | **NOT USED (matches the SDK gap).** No score, no held-out replay; `HERMES-ROUTING.md` is the manual triage stand-in. | gap-analysis §2,§4; `HERMES-ROUTING.md` |
| **`.codegraph` Tier-1 graph** | **AD-HOC (external tool), not SDK.** A real SQLite codegraph daemon exists but as a dev MCP, not the v1.5 Leg-B SDK feature. | `.codegraph/`, `.mcp.json` |
