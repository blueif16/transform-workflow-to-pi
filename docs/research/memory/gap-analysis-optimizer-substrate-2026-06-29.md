# Gap analysis: piflow optimizer substrate vs the v1.5 design (code-grounded, 2026-06-29)

## 0. Method + files read

This is a code-grounded audit: every claim about piflow cites a `file:line` in the worktree
`/Users/tk/Desktop/piflow/.claude/worktrees/memory`; "absent" claims name the pattern grepped and the
dirs searched. SHIPPED code is distinguished from DESIGNED-only (the v1/v1.5 docs). No code was edited;
this doc is the only artifact written.

Design read first (in order):
- `docs/research/memory/piflow-memory-v1.5.md` — the four-way triage (§3), the two gates (§2), the
  four-tier scoring cascade (§4d), the §5.1 held-out replay+scoring critical path.
- `docs/research/memory/piflow-memory-v1.md` — the substrate (§2 two legs), the §7 optimizer meta-DAG,
  the §11 SHIPPED/NOT-BUILT status.

Code read (primary):
- `packages/core/src/observe/telemetry.ts` — the agent-facing run digest + anomaly detector.
- `packages/core/src/observe/distill.ts` — the per-node event-stream reducer (the trace aggregator).
- `packages/core/src/observe/runView.ts`, `read.ts`, `watch.ts` — the run-view / snapshot / live stream.
- `packages/core/src/runner/status.ts` — the `.pi/run.json` record schema.
- `packages/core/src/checks.ts` — `evaluateChecks`, `effectiveChecks`, `classifyFailure`, `consultPreamble`.
- `packages/core/src/runner/retry.ts` — the within-run retry/escalate FSM + the L1/L2/L3 stubs.
- `packages/core/src/runner/node-lifecycle.ts` — checks.post / schema gate / G8 repair wiring.
- `packages/core/src/runner/journal.ts` — the content-hash envelope/input journal + `decideResume`.
- `packages/core/src/runner/resume.ts`, `workflow/profile.ts` — `--from`/`--until` window + profiles.
- `packages/core/src/workflow/state.ts` — RunState channels.
- `packages/core/src/workflow/reroute/expand.ts` — the G8/G12 bounded reroute (self-fix QA loop).
- `packages/core/src/workflow/judge/materialize.ts` — the judge-node load-time transform.
- `packages/core/src/memory/{skeleton.ts,seed.ts,index.ts}`, `packages/core/src/code-map.ts` — the §11 scaffold.
- `packages/cli/src/node.ts` — the `piflowctl node <run> <id> --resume` surface.
- `runner/events.ts`, `runner/layout.ts` — `.pi/nodes/<id>/events.jsonl` persistence.

Searched-and-not-found (two thorough Explore sweeps over `packages/`, `templates/`, `.piflow/`, `docs/`):
no `*optimizer*`/`*triage*`/`*fixer*` module; no `score`/`scoring`/`evaluate_gate`/`held-out`/`replay` in
an across-run sense; no committed golden-sample or criteria-fixture files; no `.agents/` directory; no
codegraph/okf/sqlite builder.

---

## 1. Scoring signals that exist today — mapped to the cascade tiers

Tier mapping: **0** = deterministic trace gates (judgment-free, from telemetry); **1** = outcome/checkable
(tests/schema/`checks.post`); **2** = hardened judgment (pairwise-vs-golden, rubric, separate critic);
**3** = abstain→human. "Diagnostic" = feeds triage (Job A), not the quality gate (Job B).

| Signal | file:line | Tier | Status |
|---|---|---|---|
| `modelCalls` (assistant completions / loop signal) | `observe/distill.ts:189` | 0 | **present** |
| `toolCalls` + `toolBreakdown` (per-tool counts) | `observe/distill.ts:205-207` | 0 | **present** |
| `maxToolRepeat` + `repeatedTool` (same-args tool-loop fingerprint, ≥3 ⇒ loop) | `observe/distill.ts:130-132,213-215` | 0 | **present** |
| `retries` (provider `auto_retry_start` / rate-limit) | `observe/distill.ts:197-198` | 0 | **present** |
| `stopReason` + `truncated` (`max_tokens`/`length` ⇒ runaway/cut-off) | `observe/distill.ts:191-192,247` | 0 | **present** |
| `contextPeak` + `contextPct` (context-pressure vs the model window) | `observe/distill.ts:169`; `telemetry.ts:163-166` | 0 | **present** |
| tokens in/out, cost, cacheRead/Write | `observe/distill.ts:162-170` | 0 | **present** |
| timing `durationMs`; `slowRatio` vs cross-run mean | `observe/distill.ts:265`; `telemetry.ts:171-173` | 0 | **partial** — `slow` needs `priorSamples>0` (cross-run history); fires only in RECORD mode, never live (`telemetry.ts:170,361`) |
| anomaly worklist (`failed/truncated/tool-loop/context-pressure/slow/retries`, ranked) | `telemetry.ts:154-178,331-333` | 0 | **present** — exactly the v1.5 Tier-0 pre-filter, edge-triggered live |
| failure-onset localization (earliest upstream failed node via the file-flow DAG) | `telemetry.ts:250-291` | 0 (diagnostic) | **present** — routes "where", not a score |
| OTel `gen_ai.*` export of the above | `telemetry.ts:469-487` | 0 | **present** |
| artifact-presence gate (driver `stat()`s every declared artifact → `blocked` if missing) | `status.ts:30-34,217-226`; `node-lifecycle.ts` collect/verify | 1 | **present** — "verified, not trusted" |
| `checks.post` integrity checks (`exists/non-empty/regex/json-parses/field-present/count-floor/fenced-tail`) | `checks.ts:62-129`; run at `node-lifecycle.ts:517-521` | 1 | **present** — but PASS/FAIL per artifact, NOT a scalar (v1.5 §2 "binary pass ≠ a score") |
| auto fill-sentinel completeness check (artifact still contains the sentinel ⇒ incomplete) | `checks.ts:138-147` | 1 | **present** |
| artifact JSON-Schema validation (draft-2020-12; present-but-invalid ⇒ `blocked`) | `node-lifecycle.ts:495-505`; `runner/schema.ts` | 1 | **present** |
| structured-return schema validation (`returnSchema`/`returnMode`) | `status.ts:92-102`; `node-lifecycle.ts:540-553` | 1 | **present** |
| `count-floor` explicitly asserts existence, NEVER goodness | `checks.ts:6-7` ("the human-judged quality bar lives in the criteria fixture, not here") | 1 (boundary) | **present** — the code itself disclaims Tier-2 |
| tests / typecheck / build re-run as a quality gate | grepped `npm test`/`tsc`/`vitest` as a node OUTCOME signal in `packages/core/src/` — **only** in the project's own CI, not invoked as a node score | 1 | **absent** — the FUNCTIONALITY_DEFECT gate (v1.5 §3③) has no runner hook |
| render-and-diff / symbolic grounding for visuals | grepped `render-and-diff`/`SceneCritic`/`parity` in `packages/` — no matches | 1 (visual) | **absent** (design-only, v1.5 §4d Tier-1) |
| judge node (rubric + acceptance bar → verdict.json, can `reroute` on fail) | `workflow/judge/materialize.ts:51-106` | 2 | **partial** — a SEPARATE-critic node exists and carries a rubric, but it judges ABSOLUTE vs a threshold, not PAIRWISE-vs-golden; no golden input wired (see §3) |
| separate critic ≠ producer (implement-model vs check-model split) | judge node is a distinct `agentType:'judge'` pi node (`materialize.ts:79`) | 2 | **partial** — the structural split exists; the swap-consistency + abstention (Tier-3 trigger) do not |
| pairwise-vs-golden ranking | grepped `pairwise`/`reference-anchored` in `packages/` — research docs only | 2 | **absent** |
| swap-consistency abstention → human | grepped `swap`/`abstain`/`conformal` in `packages/` — no matches | 3 | **absent** |

**Net (Tier-0/1):** the deterministic disqualifiers (Tier 0) are **almost fully computed today** — loops,
retry storms, truncation/runaway tokens, context pressure all fall straight out of `distill.ts` and are
ranked into a worklist in `telemetry.ts`. The Tier-1 checkable-outcome gate is **present for
artifacts/schema/declared checks** but is **binary pass/fail, not a scalar**, and the one Tier-1 signal the
FUNCTIONALITY_DEFECT bucket most needs — re-running the product's tests/build as a node outcome — is
**absent**. Tier 2 is a partial judge-node skeleton; Tier 3 is absent.

---

## 2. Replay: can a node be re-run on a held-out slice?

**Short answer: the trace is replayable and the inputs are content-pinned, but a single node cannot yet be
re-EXECUTED under the runner on a frozen slice. The pieces exist; the harness does not.**

What EXISTS (the replay prerequisites, all shipped):
- **Frozen, queryable trace.** Every node's full event stream is persisted to
  `.pi/nodes/<id>/events.jsonl` (`runner/events.ts:141-146`; the `NodeRecorder` is wired in
  `node-lifecycle.ts:383-397`, and `recordEvents` defaults to `true` at `runner.ts:334`).
  `buildRunView` REPLAYS that jsonl post-hoc through the same `distill.ts` reducer
  (`runView.ts:156-159`, distill header `distill.ts:8-10`). So "re-score a recorded run" is free today.
- **Content-pinned inputs + envelope.** The journal records each node's `sha256` envelope hash AND a
  `path→sha256` map of every consumed input file (`journal.ts:25-50,110-137,148-157`). `decideResume`
  re-runs a node iff its envelope OR any input byte changed (`journal.ts:210-256`) — exactly the
  "did this candidate edit change the node" predicate a replay gate needs.
- **Slice selection.** `--from`/`--until` window the run to a stage range (`resume.ts:75-135`, the `fromIdx`
  pin at `resume.ts:125-127`), and PROFILES elide+rewire a node subset purely (`workflow/profile.ts`).
- **Frozen RunState channels** (`workflow/state.ts`) and a same-`source` carry-forward of prior records
  (`resume.ts:143-150`) — so reused nodes keep their timings/checks rather than blanking.
- **Comparable result capture.** A re-run node's outcome is already captured comparably: status ladder
  (`status.ts:18-27`), `checks`/`schemaInvalid`/`returnSchemaInvalid` on the record
  (`status.ts:86-102`), and the digest in `telemetry.ts`.

What is MISSING for a held-out replay (the §5.1 critical path):
1. **Single-node runner-integrated re-execution does not exist.** `piflowctl node <run> <id> --resume`
   is explicitly a *conversational warm-resume of the stored pi session*, NOT a re-staged contract run —
   `node.ts:13-16`: "this is a CONVERSATIONAL warm resume … it does NOT re-stage the node's sandbox/tools/
   gates or re-run the contract. That heavier, runner-driven resume is a follow-up." So you cannot today
   say "re-run node N with the same frozen inputs under its contract and capture a comparable verdict."
2. **No task-mining from a trace.** SkillOpt mines a checkable task from a transcript
   (`skillopt_sleep/cycle.py:191`, cited in v1.5 §5.1). piflow has no analogue — grepped
   `held-out`/`replay`/`task`-mining in `packages/` → no across-run matches. The journal pins WHICH bytes
   fed a node, but nothing turns a node's run into a re-scorable held-out task.
3. **No A/B scoring loop.** No code re-runs a node before and after an edit and compares (the SkillOpt
   `if cand_score > current_score`); there is no `score` to compare (see §1, §5).
4. **Warm-resume itself is half-wired in the optimizer path.** `retry.ts:44-49,101-107` notes TRUE
   warm-resume is absent on this branch (`pi --no-session`, `command.ts:71`); the `resumeSessionId` hint is
   set but honored only on in-place/local providers.

So the **replay substrate is ~70% present** (trace, input hashing, slice windowing, comparable capture);
the **missing 30% is the runner-driven single-node re-exec + the trace→task miner** — and that is precisely
what v1.5 §5.1 calls the true critical path.

---

## 3. Golden samples + per-node criteria — do they exist? where?

**No. Golden samples and per-node criteria fixtures are DESIGNED and REFERENCED but exist as ZERO committed
files in this repo.** The user's premise ("we have criteria for each node and a golden sample for each
node") is **not yet true in code**.

Where they are REFERENCED (design/skill prose, not artifacts):
- `docs/research/memory/piflow-memory-v1.5.md:128` — "we already keep per-node criteria + a golden sample"
  (aspirational; the file-level claim is not backed by committed files).
- `.claude/skills/piflow-enhance/SKILL.md:6,40` — "Owns the criteria fixture (the per-node quality bar)";
  names `<repo>/.agents/skill-system-criteria.md` as the intended home. The skill is marked **STUB**
  (`SKILL.md:9`) and DELEGATES to `hermes-skill-system`; it does not define or ship the fixture format.
- `.claude/skills/piflow-init/SKILL.md:126,178` — claims init "seeds `<repo>/.agents/skill-system-criteria.md`",
  but there is **no seeding code**: the CLI scaffolder (`packages/cli/src/scaffold.ts`) seeds `memory.md`/
  `code-map.md` only — grepped `.agents`/`criteria` in `scaffold.ts` → no matches.

What was searched and NOT found:
- **`.agents/` directory** — does not exist anywhere in the repo (grepped; only referenced in skill prose).
- **`templates/` node dirs** — `templates/quality/verify/nodes/{review-a,review-b,consensus}/` carry only
  `node.json` + `prompt.md`. The verify prompts conditionally read an OPTIONAL `{{RUN}}/verify/criteria.md`
  (`templates/quality/verify/nodes/review-a/prompt.md:22-23`) — i.e. the runtime reads a criteria file IF a
  product supplies one, but no template ships one.
- **`.piflow/` example templates** — `example-basic`, `example-academy`, `example-fusion`: node dirs carry
  `node.json` + `prompt.md` only; no `golden`/`criteria`/`rubric`/`expected/` files.
- grepped `golden`/`rubric`/`fixture`/`expected/` across `templates/` + `.piflow/` → matches only in
  `docs/research/memory/*` prose.

What DOES exist (the nearest shipped primitive):
- The **judge node** carries a rubric + acceptance bar in its prompt and emits a verdict
  (`workflow/judge/materialize.ts:51-106`, verdict at `_judge/<producer>/verdict.json`). But it judges the
  producer's artifact **absolutely against a threshold**, with **no golden sample wired as an input** — so
  it is not the pairwise-vs-golden Tier-2 mechanism v1.5 §4d requires.

**Conclusion:** Tier 2's two prerequisites (a golden sample per node, a criteria fixture per node) are
**absent as artifacts**. The judge-node code is a reusable host for them, but nothing seeds, stores, or
feeds a golden sample today.

---

## 4. Four-way triage: is each bucket distinguishable from existing signals?

The within-run classifier `classifyFailure` (`checks.ts:203-221`) emits a 6-way `FailureClass`
(`halt/schema/contract/quality-gap/infra/degenerate`) over empirical signals — this is the **within-run**
retry/escalate taxonomy, NOT the v1.5 **across-run** four-way credit-assignment. The four-way buckets
(`EXECUTION_LAPSE/SKILL_DEFECT/FUNCTIONALITY_DEFECT/ARCH`) appear **only in `piflow-memory-v1.5.md:56-102`**
— grepped those token names in `packages/` → no matches. Below: for each bucket, the discriminating signal
and whether it exists.

| Bucket | Discriminating signal needed | Exists today? |
|---|---|---|
| **EXECUTION_LAPSE** ("a correct rule was not followed; often a weak-model/transient slip") | (a) a node had a rule in its prompt/SKILL it violated; (b) the same node succeeds on retry/escalate (transience). | **(a) absent** — nothing parses a node's `prompt.md`/`SKILL.md` for a rule and checks the run against it (grepped; no rule-adherence checker). **(b) present** — the retry/escalate FSM (`retry.ts:81-130`) already re-runs and an escalation succeeding *is* the transience signal, and `infra`/`degenerate` classes (`checks.ts:216-218`) flag transient/no-parse. So "did a stronger model fix it unchanged" is observable; "did it break a stated rule" is not. |
| **SKILL_DEFECT** ("the prose is wrong/missing/underspecified") | the failure recurs ACROSS runs on the same node with no rule covering it. | **partial/absent** — within one run, `quality-gap` (`checks.ts:211,214,220`) is the residual capability-miss class, a reasonable proxy. But "recurs across runs" needs cross-run history, and **nothing aggregates a node's failures across runs** (the journal is per-run; `memory.md` is write-only scaffold, §5). No recurrence detector. |
| **FUNCTIONALITY_DEFECT** ("prose fine; the PRODUCT CODE the node operates on is buggy") | a faithful executor still fails because code in `owns`/`readScope` is wrong → distinguishable by "the node's OWN checks pass but a downstream/product test fails." | **absent** — the runner has no product-test outcome signal (§1: tests/build are not invoked as a node score), and nothing separates "the agent under-performed" from "the code it was handed is broken." `classifyFailure` reads artifact/schema/integrity-check breaches only (`checks.ts:166-189`); none of these is "the product code is buggy." |
| **ARCH / COORDINATION** ("a hand-off, shared contract, or fix that escapes the node's scope") | the root cause is upstream / a missing-input HALT / the fix must touch code outside `owns`. | **partial** — the `halt` class flags a missing UPSTREAM input (`checks.ts:205`), and `telemetry.ts:250-291` localizes the earliest-upstream failed node via the file-flow DAG. So "the failure originated upstream / a hand-off broke" IS observable. What is NOT: deciding the fix must leave the node's `owns` scope (no scope-escape detector). |

**Net:** of the four, only **ARCH** (via the HALT class + upstream localization) and the *transience* half
of **EXECUTION_LAPSE** are discriminable from shipped signals. The two "edit" buckets that matter most —
**SKILL_DEFECT** (needs cross-run recurrence) and **FUNCTIONALITY_DEFECT** (needs a product-test outcome and
a rule-adherence check) — **cannot be distinguished today**. The within-run `FailureClass` is a useful
*input* but does not map onto the four-way side-attribution.

---

## 5. The other gaps + the smallest next slice for each

### §7 optimizer meta-DAG (triage → per-node fixer → reconcile)
- **Status: DESIGNED (v1 §7) · SUBSTRATE SCAFFOLD SHIPPED (§11) · EXECUTION ABSENT.** The scaffold is
  write-only: `memory/skeleton.ts` builds `memory.md` text (`buildNodeMemory`/`buildSystemMemory`),
  `memory/seed.ts` create-if-absent-writes it (`seed.ts:17-39`), `code-map.ts` does the same for Leg B.
  **No reader** consumes these (`memory/index.ts:1` is labelled "STUB — RED phase"); grepped
  `*optimizer*`/`*triage*`/`*fixer*`/`reconcile` modules → none. The closest live hook is the L2/L3 stub in
  `retry.ts:51-72` ("NOT YET IMPLEMENTED — falls through to L1 feedback").
- **Smallest next slice:** a read-only **triage projector** — a pure function from a `RunDigest`
  (`telemetry.ts:98-120`) + per-node `FailureSignals` (`checks.ts:166-189`) to
  `{ node, bucket, evidence }`, reusing the existing anomalies + `classifyFailure` + upstream localization.
  It writes nothing; it just produces the worklist the fixer would consume. Touches: a new
  `packages/core/src/memory/triage.ts` reading `observe/telemetry.ts` + `checks.ts`.

### Cap / freshness enforcement (§9)
- **Status: DOCUMENTED ONLY.** The "~40 lines / top-loaded / bottom-truncates" rule is prose in the seed
  headers (`memory/skeleton.ts` header comments) and the v1 §9 keep-it-short rules. **No code truncates,
  retires, or freshness-flags** — grepped `cap`/`truncate`/`retire`/`freshness`/`stale` in
  `packages/core/src/memory/` → matches are comment text only. The maintenance contract deliberately "lives
  ONCE in the optimizer skill" (per §11), so this is a non-gap until the optimizer exists.
- **Smallest next slice:** defer until there is a writer (the fixer) — a cap enforcer with no writer to bound
  has nothing to do.

### The code-fixer (Target 2 / FUNCTIONALITY_DEFECT)
- **Status: ABSENT.** Designed in v1.5 §3③ + v1 §6 (edit product code within `owns`/`readScope`, gated by
  the product's tests). The sandbox jail already BOUNDS the blast radius (`sandbox/scope.ts`, `owns`/
  `readScope` in `status.ts:60-62`), so the *boundary* is shipped — but nothing edits code on a failure.
  Grepped a fix-context use of `owns`/`readScope` → only the jail + the template glob validator
  (`workflow/template/checks.ts`), never a fixer.
- **Smallest next slice:** the prerequisite is the **product-test-as-node-outcome** Tier-1 signal (§1, §4) —
  without it the bucket can't even be detected, let alone gated. Build that signal first (a `checks.post`
  kind or op that runs `npm test`/`tsc` and folds the exit into the verdict ladder), then the fixer is the
  same loop as the envelope fixer (v1 §5 "the recursive insight").

### Tier-1 codegraph
- **Status: TIER-0 SHIPPED · TIER-1 ABSENT.** `code-map.ts` is strictly Tier 0 — exactly one OKF slice per
  node, pointers+semantics, no graph (`code-map.ts:4-6,35-56`). Grepped `codegraph`/`okf`/`sqlite`/`AST` in
  `packages/` → only the forward-reference comment in `code-map.ts`. No `codegraph.sqlite` builder, no
  `okf/index.md` generator. This is an explicit v1 §10.6 open question (opt-in, unproven on piflow).
- **Smallest next slice:** none warranted yet — Tier-1 is gated on "proof-before-promote" (a measured
  token/tool-call win on one product), and the optimizer that would consume it doesn't exist.

---

## 6. Prioritized gap list

Ordered by what unblocks the most. The replay+scoring harness is first because §2's gate, §3's golden-sample
score, §4's recurrence/functionality discrimination, and the §7 fixer's accept/reject ALL depend on it.

1. **Held-out task-replay + scoring harness** — the true critical path: a runner-driven single-node
   re-execution that re-stages the contract on frozen inputs and captures a comparable verdict, plus a
   trace→task miner. Touches: `packages/cli/src/node.ts` (upgrade `--resume` past conversational warm-resume,
   per its own `node.ts:13-16` follow-up note), `packages/core/src/runner/{node-lifecycle.ts,resume.ts,journal.ts}`
   (re-exec one node under its envelope/input pin), a new `packages/core/src/memory/replay.ts`.
2. **A Tier-0/1 SCORE function** — fold the already-computed deterministic disqualifiers (`telemetry.ts`
   anomalies) + the binary `checks`/schema outcomes (`checks.ts`, `node-lifecycle.ts`) into ONE comparable
   scalar (Tier-0 as a disqualifier, Tier-1 as the value), so the §2 across-run gate has something to compare.
   Touches: a new `packages/core/src/memory/score.ts` reading `observe/telemetry.ts` + `checks.ts`.
3. **A read-only four-way TRIAGE projector** — `{RunDigest, FailureSignals} → {node, bucket, evidence}`,
   reusing `classifyFailure` + anomalies + upstream localization; the gap it can't yet close (cross-run
   recurrence for SKILL_DEFECT, product-test outcome for FUNCTIONALITY_DEFECT) tells you exactly the two
   signals to add next. Touches: a new `packages/core/src/memory/triage.ts` reading
   `observe/telemetry.ts:98-120` + `checks.ts:203-221`.
4. **Product-test-as-node-outcome (Tier-1)** — a `checks.post` kind / op that runs the product's
   tests/typecheck/build and folds the exit into the verdict ladder; this is the single missing Tier-1
   signal and the precondition for detecting FUNCTIONALITY_DEFECT at all. Touches: `packages/core/src/checks.ts`
   (a new check kind), `packages/core/src/runner/node-lifecycle.ts` (wire it into the verdict ladder).
5. **Golden-sample + criteria-fixture storage + pairwise wiring** — seed a per-node `golden/` + criteria
   entry (the `.agents/skill-system-criteria.md` the skills already assume) and feed the golden as an INPUT
   to the existing judge node, switching it from absolute-vs-threshold to pairwise-vs-golden + swap-consistency.
   Touches: `packages/cli/src/scaffold.ts` (seed the fixture), `packages/core/src/workflow/judge/materialize.ts`
   (wire the golden input + pairwise/swap).
6. **The per-node fixer + reconcile meta-DAG** — only after 1–5 give it a score to gate on and a bucket to
   route by; the editable surface (v1 §6) and the jail boundary (`sandbox/scope.ts`) are already shipped, so
   this is "compose the loop," not "new machinery." Touches: new `packages/core/src/memory/{fixer,reconcile}.ts`
   + the L2/L3 seam in `packages/core/src/runner/retry.ts:51-72`.
7. **Cap/freshness enforcement** — deferred until there is a writer (the fixer) to bound; nothing to enforce
   before then. Touches: `packages/core/src/memory/skeleton.ts` + the future fixer.
8. **Tier-1 codegraph** — deferred; gated on a measured proof-before-promote win (v1 §10.6).
