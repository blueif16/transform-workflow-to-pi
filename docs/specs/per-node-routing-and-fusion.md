# Per-node model routing + fusion nodes — config model & DAG expansion

> Status: design spec. Created 2026-06-25. Closes competitive gap **G1** (per-node model routing)
> and adds **fusion nodes** (a DAG expansion). This doc is the SINGLE source of truth for *where every
> config knob lives* and *the exact override order* — the thing we must never get confused about.

## 0. Principles

1. **Route by MODEL.** The model id is the natural unit an author picks. The **provider is plumbing**
   — resolved from pi's `~/.pi/agent/models.json` (every model already lives under a provider there) or
   the run default. A node says `model: <id>`; it should rarely need to name a provider.
2. **Tiers are optional, activatable ALIASES** — data in a global file, never vocabulary baked into
   core. Same pattern as `profiles`/`defaultProfile` (product owns the names; core applies the map).
3. **Fusion is a DAG expansion**, not a new runtime: an activated node becomes a *judge*, with N
   *sibling* nodes spawned upstream. The existing compiler draws the edges. Two modes: best-of-n,
   mixture-of-agents.
4. **One documented precedence per concern.** No ambiguity. Unknown references fail LOUDLY.

## 1. Config inventory — where every knob lives

Per the project SDK-boundary rule, GLOBAL config lives in `~/.piflow/`, never in `packages/` or a repo.

| Scope | Location | Knobs |
| --- | --- | --- |
| **Global** | `~/.piflow/model-tiers.json` | `{ active: bool, tiers: { <name>: <model> } }` — optional tier→model aliases (e.g. `small`/`medium`/`large` AND/OR `fast`/`balanced`/`deep`; names are free data). |
| **Global** | `~/.piflow/fusion.json` | `{ active: bool, defaultMode, panel[], judge, mode, n, obligations, verify, web }` — fusion defaults + the toggle the init step honors for best-quality nodes. |
| **Per-node** | template `node.json` | `model?`, `provider?`, `tier?`, `fusion?` (the activation block, §4). |
| **Per-run** | CLI flags | `--model`, `--provider`, `--thinking`. |

> Workflow-level (`meta.json`) model/fusion defaults are intentionally OUT of scope for v1 — adding a
> fifth scope multiplies the precedence surface. Add later only if a real need appears.

## 2. Precedence — THE override contract

**Model** (first match wins):
```
node.model  >  tiers[node.tier]  (only if model-tiers.active)  >  run --model  >  pi provider default
```

**Provider** (first match wins):
```
node.provider  >  model→provider auto-resolved from models.json  >  run --provider  >  "cp"
```

**Fusion activation:**
```
node.fusion present  >  init auto-mark (fusion.active && node flagged best-quality)  >  off
```

**Fusion params** (`panel`/`judge`/`mode`/`n`/`obligations`/`verify`/`web`), each resolved independently:
```
node.fusion.<param>  >  ~/.piflow/fusion.json.<param>  >  built-in default
```

**Loud-failure rules** (never silently degrade):
- `node.tier` set but the name is absent from `tiers` (or tiers inactive) → **error**, not fallback to default.
- A fusion node whose `panel`/`judge` references a tier that doesn't resolve → **error** at expand time.

## 3. Isolation & the DAG — what exists today (so fusion needs almost nothing new)

- **Sandbox BACKEND is run-level** (`runWorkflow` picks ONE `provider`; `providerKind` is run-wide).
  But **per-node** read/write/output/workspace/timeout/env ARE already passed per node to
  `scope.create` (`runner.ts:801`). Each node gets its own `out/<id>` output dir.
- ⇒ **Fusion needs NO per-node backend work.** Each sibling is a node, so it already gets its own
  output dir — fusion runs on **local mode, today, unchanged**. (Per-node backend *kinds*
  — one sibling in a VM, another in a jail — remain a separate, optional future upgrade; the
  text-synthesis panel never needs them.)
- **Edges are inferred** from `io.reads ⋈ io.produces` (+ explicit `dependsOn`); topological levels
  with >1 node become a parallel stage (`dag.ts` `inferEdges`/`stagesOf`). ⇒ **The fusion expansion is
  pure node generation; the compiler produces the picture.**

## 4. Fusion expansion — the "final effect"

A node activates fusion via a `node.json` block:
```jsonc
"fusion": {
  "mode": "moa",                 // "moa" | "best-of-n"
  "n": 3,                        // best-of-n: sample count
  "panel": ["balanced", "deep"], // moa: tiers/models, one sibling each (overrides n)
  "judge": "deep",               // judge model/tier (default: the node's own model)
  "obligations": true,           // derive a coverage checklist before the panel (borrowed from pi-fusion)
  "verify": true                 // judge verify→revise loop ("quality"); false ⇒ "fast"
}
```

**Expansion (a spec-level transform run BEFORE `compile`):** for an activated node `X`:

1. **Keep `X`'s id; turn `X` into the JUDGE.** Its `prompt` is replaced by the mode-specific judge
   prompt; its `io.reads` becomes the sibling partials; its `io.produces` stays **X's original
   artifacts** — so every original downstream edge is preserved untouched.
2. **Spawn N siblings** `X__p1 … X__pN` (new ids): each clones `X`'s original prompt, `deps`, and read
   scope, and `produces` a distinct partial `<X.output>/fusion/p{i}.json`.
   - **best-of-n:** every sibling uses `X`'s resolved model (diversity from sampling).
   - **moa:** sibling *i* uses `panel[i]` (diversity from different models/providers).
3. *(optional)* an **obligations** pre-node deriving the coverage checklist the siblings + judge consume.

Resulting compiled graph (drawn automatically by the existing compiler):
```
[X's deps] → ( X__p1 ‖ X__p2 ‖ X__p3 ) → [ X = judge ] → [X's original successors]
```

**Judge behavior** (the only genuinely new agent-facing prose — author under `agentic-prompt-design`):
- **best-of-n:** select/vote the best partial (or synthesize from the majority).
- **moa:** pi-fusion's design — `analyze` (consensus / contradictions / coverage gaps) → *(recover
  obligations)* → `draft` a new synthesized answer → `verify → revise` when `verify:true`. Never ranks
  participants; writes a fresh answer.

## 5. GUI activation

The GUI stays a static viewer. "Click a node → activate as fusion" **writes the `fusion` block into
that `node.json`** (via the dev mechanism / Companion talk-back, currently WIP), then re-loads/compiles
— the viewer then renders the EXPANDED graph (siblings + judge). No runtime mutation; the template
remains the source of truth.

## 6. Sequencing

1. **Config foundation (G1).** `model`/`provider`/`tier` on the template node (types · `node.schema.ts`
   · `loader.ts`) → `NodeSpec`; `~/.piflow/model-tiers.json` reader + the §2 model/provider precedence;
   thread effective model/provider per node into the command builder (`runner.ts` populates
   `CommandContext` per node — `command.ts` already reads `ctx.model`/`ctx.provider`). Tests assert the
   precedence ladder. *Mirrors the in-flight `timeoutMs`/`retries` pattern exactly.*
2. **Fusion expansion.** `node.fusion` field + `expandFusion(spec)` (siblings + judge retarget) before
   compile; both modes; judge/obligation prompts; `~/.piflow/fusion.json` reader + §2 fusion precedence;
   tests assert the expanded nodes/edges/stages.
3. **GUI toggle.** The thin writer in §5.

## 7. Upstream canonical references — read these, don't reinvent

We are **porting proven mechanisms**, not inventing them. Subagents implementing fusion MUST consult the
canonical sources below and follow their practices; this spec only adapts them to piflow's per-node-process
model. **The rule: borrow the *design* (pipeline shape, judge structure, fallback policy), not the *packaging*
(pi-fusion is an in-process pi extension; we run real `pi` nodes).**

### 7a. OpenRouter — model routing & fusion (the productized reference)
OpenRouter is the canonical "many models behind one OpenAI-compatible endpoint" gateway, and it ships BOTH
levers we care about. Because a piflow `cp` provider can point at OpenRouter, these work as *just a model id*
once §1 routing lands (`model: "openrouter/auto"` or `"openrouter/fusion"`) — that path is free and is **not**
"our fusion," it is consuming theirs.
- **Fusion overview / model alias:** <https://openrouter.ai/fusion> · <https://openrouter.ai/openrouter/fusion>
- **Fusion Router (multi-model deliberation):** <https://openrouter.ai/docs/guides/routing/routers/fusion-router>
- **Fusion plugin (config surface) + server tool:** <https://openrouter.ai/docs/guides/features/plugins/fusion>
  · <https://openrouter.ai/docs/guides/features/server-tools/fusion>
- **Auto Router (single-model selection — the *routing* lever, ≈ our G1):** OpenRouter routing docs,
  `openrouter/auto`.
- **Practices to mirror:** panel→judge (the judge *compares*, doesn't merge); `Quality` vs `Budget` panel
  presets (maps to our tier-named panels); price = sum of panel + judge calls (surface this cost in telemetry,
  §G10); `tool_choice:"required"` to force fusion ↔ our explicit `node.fusion` activation.

### 7b. pi-fusion — the open-source MoA mechanism we port (`aa2246740/pi-fusion`)
- **Repo:** <https://github.com/aa2246740/pi-fusion> · install `pi install git:https://github.com/aa2246740/pi-fusion@main`
  · config `~/.pi/agent/pi-fusion/config.json`.
- **Files to read before authoring our judge (the design we borrow):**
  - `src/engine.ts` — the 7-stage orchestration (prepare → workspace → **plan obligations** → evidence →
    **participants ‖** → **judge** → complete).
  - `src/judge.ts` — the 4-phase judge: `analyze` (consensus / contradictions / coverageGaps / uniqueInsights
    / blindSpots) → `recoverObligations` → `draft` (**generative synthesis — never ranks/votes**) →
    `verify → revise` (only in quality mode). **This is the structure our MoA judge prompt mirrors (Appendix A).**
  - `src/obligations.ts` — the coverage checklist (`id`/`kind`/`description`), extracted from the prompt
    ONLY ("do not infer hidden rubrics"). We port this as the optional `obligations` pre-node.
  - `src/fallback.ts` — fall back to another model **only on OBJECTIVE failures** (rate-limit, quota, timeout,
    network, empty, context-limit, provider error) — never on a quality judgment; per-slot fallbacks REPLACE
    defaults. Mirror this policy in our participant retry.
  - `src/config.ts` / `src/types.ts` — `participants[] / judge / defaultFallbacks / webPolicy(required|optional|off)`;
    our `~/.piflow/fusion.json` is the analogue.
  - `src/workspace-sandbox.ts` — confirms participants are **in-process file-copy sandboxes in ONE process**
    (the limit our per-node-process model removes — see §3 and the note below).
- **Why we port, not vendor:** pi-fusion is in-process (`ModelCaller` via `@earendil-works/pi-ai`; participants
  are API calls, not processes), shipped as a `/pi-fusion` slash-command with global config, and carries
  DRACO/evidence/SEC/UX scaffolding we don't need. Running it inside a headless `pi -p` node is fragile
  (slash-command triggering, global-vs-per-node config) and its in-process panel **cannot** give each panelist
  a different sandbox/toolset. Our fusion **node** reuses our own `pi`-spawn + §1 routing instead.

### 7c. pi provider/model resolution (how the flags actually land)
- **Custom provider:** <https://pi.dev/docs/latest/custom-provider> · models config `~/.pi/agent/models.json`
  (every model lives under a provider — this IS the model→provider registry §2 auto-resolve reads). Bundled
  `docs/models.md` for the full schema.
- **In-repo:** `reference/provider-and-headless.md` (headless invariants + how `--provider cp --model <id>` is
  wired), `templates/models.json.example`, `templates/legacy/providers/coding-plan.ts`.

## Appendix A — authored prompts (place verbatim; do not redesign)

These are the agent-facing artifacts for the fusion judge/obligation nodes, authored to the
`agentic-prompt-design` bar (output-shape-first, explicit bar, coverage floor, mandatory self-check, scope
fence). The fusion expander (T2.2) fills `{{ORIGINAL_TASK}}` (the activated node's original prompt),
`{{PARTIAL_FILES}}` (the sibling artifact paths), and `{{OBLIGATIONS}}` (the checklist path, or omit).
The executor is a headless `pi` node (possibly a non-frontier model) — keep these byte-stable.

### A1 — Mixture-of-agents judge (synthesize)
```
<role>You are the JUDGE of a mixture-of-agents panel. Several independent expert agents each produced a FULL
answer to the SAME task. Write the single best answer by SYNTHESIZING across them — do not pick a winner, do
not average, do not copy any one verbatim.</role>

<task>The task the panel was given (your output must fully satisfy THIS — it replaces a panelist's answer):
---
{{ORIGINAL_TASK}}
---</task>

<inputs>Read every panel answer IN FULL before judging:
{{PARTIAL_FILES}}
{{OBLIGATIONS}}   # optional coverage checklist the answer MUST satisfy; ignore this line if absent
Use only the panel's content plus the task. If you add a fact no panelist supports, it must be your own clearly
reasoned inference, never a fabrication.</inputs>

<output_spec>Produce the FINAL answer in EXACTLY the shape the task requires, written to this node's declared
artifact. No commentary about the panel in the artifact itself.</output_spec>

<method>Think before writing, in order:
1. ANALYZE — per panelist: consensus points, contradictions (who claims what), coverage gaps, and insights only
   one panelist found.
2. RESOLVE — for every contradiction pick the better-supported stance and note why (evidence-grounded beats
   asserted). 
3. COVER — if obligations are provided, ensure EVERY item is satisfied; fill any the panel missed.
4. DRAFT — write a fresh, complete answer taking the strongest material from all panelists, resolving
   contradictions and closing gaps.
5. VERIFY → REVISE — audit the draft against the task and obligations; fix every gap; re-audit. (Skip the
   revise loop only if verification is disabled for this node.)</method>

<the_bar>Required — revise until ALL pass:
(1) the final answer satisfies the task standalone (a reader never needs the panel);
(2) every obligation (if provided) is addressed;
(3) every substantive contradiction is RESOLVED, not ignored or averaged;
(4) a correct insight from a single panelist is preserved, not lost to the majority;
(5) the artifact matches the required shape exactly.
A MINIMAL output that restates the longest panelist or concatenates the answers FAILS.</the_bar>

<self_check>Before returning, list each Required item and mark PASS/FAIL with one line of evidence. Revise every
FAIL, then re-audit. Return the artifact only.</self_check>

<scope_fence>Do NOT do any downstream node's job. If a panel file is missing or unreadable, or the task is
absent, HALT and emit FUSION_INPUT_MISSING — never invent a panelist's answer.</scope_fence>
```

### A2 — Best-of-N judge (select + light repair)
```
<role>You are the JUDGE for a best-of-N panel. The SAME agent answered the SAME task N times. SELECT the single
best answer and lightly repair it — do NOT synthesize a new one.</role>

<task>The task:
---
{{ORIGINAL_TASK}}
---</task>

<inputs>Read all N candidates IN FULL:
{{PARTIAL_FILES}}
{{OBLIGATIONS}}   # optional coverage checklist; ignore if absent</inputs>

<output_spec>Write the selected-and-repaired answer to this node's declared artifact, in the shape the task
requires.</output_spec>

<method>1. SCORE each candidate against the task (and obligations): correctness, completeness, coverage. Record
each score + the deciding factor (in your reasoning, not the artifact).
2. SELECT the highest-scoring candidate.
3. REPAIR — fix ONLY clear errors/omissions in the selected candidate, using material the other candidates got
right. Do not rewrite wholesale.</method>

<the_bar>Required: (1) the chosen answer satisfies the task standalone; (2) every obligation addressed; (3)
repairs correct only real defects and introduce nothing the candidates didn't support. Choosing arbitrarily, or
merging all candidates into a new answer, FAILS.</the_bar>

<self_check>Audit against each Required item (PASS/FAIL + evidence); fix FAILs; return the artifact only.</self_check>

<scope_fence>Do NOT do downstream work. If a candidate file is missing/unreadable or the task is absent, HALT and
emit FUSION_INPUT_MISSING — never fabricate a candidate.</scope_fence>
```

### A3 — Obligations planner (optional coverage pre-node)
```
<role>You extract a COVERAGE CHECKLIST from a task — the concrete things any complete answer MUST address —
before any answer is written.</role>

<task>Read the task and list its obligations. Extract ONLY what the task itself requires; do NOT invent hidden
rubrics, benchmarks, or requirements the task does not state.
---
{{ORIGINAL_TASK}}
---</task>

<output_spec>Write JSON to this node's declared artifact:
{ "obligations": [ { "id": "kebab-id", "kind": "metric|comparison|source|calculation|recommendation|caveat|other",
  "description": "what a complete answer must address" } ] }</output_spec>

<the_bar>Required: (1) every distinct requirement / entity / metric / deliverable named in the task appears as
exactly one obligation; (2) ids are unique kebab-case; (3) nothing invented beyond the task. A vague or partial
list FAILS — capture each separable requirement.</the_bar>

<self_check>Re-read the task; confirm each separable requirement maps to one obligation; add any missed; return
JSON only.</self_check>

<scope_fence>Do NOT answer the task — only enumerate its obligations. If the task text is absent, HALT and emit
FUSION_INPUT_MISSING.</scope_fence>
```
