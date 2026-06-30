# Codex goal mode + 2026 loop-engineering patterns — gap-check vs piflow's overlord (2026-06)

> Stress-test of piflow's autonomous-optimization "overlord" design (the deterministic-driver
> RUN→SCORE→TRIAGE→FIX→GATE→LAND→MEMORIZE loop in `piflow-memory-v1.5.md §6-7`) against the latest
> external loop-engineering state of the art. **SkillOpt is already digested** (`skillopt-sleep-loop-control-2026-06-29.md`)
> and is NOT re-covered here — this doc finds what is BEYOND it. No piflow code/design is proposed; this is
> external SOTA + the gap-check only.

## 0. Sources & recency note

All search via Exa MCP (`web_search_exa`, `web_fetch_exa`) — Exa was reachable, no fallback used. Every claim
below cites a named system/paper/product + URL or arXiv id + the specific mechanism. CLAIMED vs MEASURED is
flagged inline. Priority = 2026; pre-2026 work (GEPA 2025-07, ACE 2025-10, AlphaEvolve 2025-05/06, Ralph
2025-07) is flagged as **[background]** but included because it is the load-bearing prior art the 2026 loop
discourse explicitly builds on.

Primary 2026 sources:
- OpenAI Codex Goals: `developers.openai.com/codex/use-cases/follow-goals`,
  `developers.openai.com/cookbook/examples/codex/using_goals_in_codex` (2026-05-09),
  `effloow.com/articles/codex-goal-mode-developer-guide-2026` (2026-05-27),
  Simon Willison `simonwillison.net/2026/Apr/30/codex-goals/`,
  OpenAI "Run long horizon tasks with Codex" (`developers.openai.com/blog/run-long-horizon-tasks-with-codex`),
  OpenAI "Unrolling the Codex agent loop" (`openai.com/index/unrolling-the-codex-agent-loop/`).
- Loop engineering: Addy Osmani "Loop Engineering" (`addyosmani.com/blog/loop-engineering/`,
  substack 2026-06-08, O'Reilly Radar 2026-06-22); Daniel Vaughan "Loop Engineering with Codex CLI"
  (2026-06-10); Blake Crosley "Loops Win Where Verification Is Cheap" (2026-06-09); Brenn Hill / LoopRails
  (`looprails.dev`, 2026-06-22/23); Andrew Ng "Three Key Loops" (deeplearning.ai, 2026-06-26);
  Thoughtworks Radar "Ralph loop" (2026-04-15); Geoffrey Huntley `ghuntley.com/loop/` (2026-01-17) **[background]**.
- Self-improvement papers: GEPA (arXiv 2507.19457, ICLR 2026 oral) **[background]**; ACE (arXiv 2510.04618,
  ICLR 2026) **[background]**; AlphaEvolve (arXiv 2506.13131) **[background]**; ReVeal (openreview, ReVeal.github.io);
  TRT "Test-time Recursive Thinking" (arXiv 2602.03094); SWE-TRACE (arXiv 2604.14820); Socratic-SWE (arXiv 2606.07412);
  ReflexiCoder (ACL 2026 findings 1872).

## 1. OpenAI Codex goal mode — what it is + its loop/control structure

**It exists and is named `/goal`** ("goal mode", a.k.a. "Goals"/"following a goal"). It graduated from
experimental to stable on **2026-05-21** ("Codex Thursday"), shipping across the Codex app, VS Code/JetBrains
extensions, and CLI (v0.128.0+; the `/goal` slash command surfaced in CLI 0.128.0 per Willison, and Vaughan
cites v0.133.0 for the GA graduation). The base agent loop it sits on is described directly by OpenAI in
"Unrolling the Codex agent loop": the harness re-queries the model, executes tool calls, appends output, and
re-queries **until the model stops and produces an assistant message** — each turn ends in a termination
state. ([OpenAI](https://openai.com/index/unrolling-the-codex-agent-loop/))

**What goal mode adds on top: a durable, thread-scoped completion contract + cross-turn persistence.** A
normal Codex turn is `ask → work → result → wait`; a Goal is `work → check → continue-or-complete`
([OpenAI cookbook](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)). Mechanism, precisely:

- **State.** The Goal is durable thread-scoped state recording objective, lifecycle, budget, and progress
  accounting — stored in a **local SQLite table** (effloow). It explicitly does NOT write to global memory or
  project instructions (cookbook: "the Goal belongs to the current thread, not to global memory").
- **Loop (effloow's reconstructed pseudocode):** `while goal.status != complete: plan next step → execute
  (edits/shell/tests) → check output against success condition → if met: mark complete; elif stuck/error:
  attempt recovery or ask for input; elif budget hit: pause + notify.`
- **The gate = a SEPARATE small check model.** After every turn a *separate, smaller model* (config
  `check_model = "o4-mini"`) evaluates whether the completion condition holds — "the agent that wrote the code
  is not the one grading it" (Vaughan; Osmani: "a fresh model decides if the loop is done"). This is explicit
  **maker-verifier separation applied to the stop condition itself.**
- **Completion is evidence-based, model-proposed, system/user-controlled.** The model has exactly three tools
  — `create_goal`, `update_goal` (incl. mark `complete`), `get_goal` — and "can mark a Goal complete only when
  the evidence supports completion." **Critically, the model CANNOT pause or resume** — those are
  system/user-controlled, by design, "to prevent a class of edge cases where a stuck model might try to loop
  forever or prematurely stop" (effloow). A runtime event bus tracks token + wall-clock deltas per turn,
  auto-pauses on interrupt, and injects budget-limit steering into the response stream near the cap.
- **Continuation is event-driven, not a busy loop.** Codex checks for continuation only at **safe boundaries**:
  after a turn finishes, when no other work is pending, no user input is queued, and the thread is idle
  (cookbook). It is implemented largely via injected prompts `goals/continuation.md` and `goals/budget_limit.md`
  appended at the end of a turn (Willison) — i.e. a prompt-level harness, not a model-internal capability.
- **Bounds.** `[goals] max_turns = 200`, `timeout_minutes = 480`, plus a token **budget** that triggers a
  budget-limited pause (not a hard kill) — the user reviews and resumes/abandons. Stopping conditions are:
  success, pause, clear, interruption, budget limit, or an honest "blocked, no defensible path" report.
- **Human gate.** Lifecycle authority is split: model may *start* and *evidence-complete*; **pause/resume/clear
  are user/system only**; for risky writes the CLI offers `approval_policy` checkpoints and PostToolUse diff
  hooks (Vaughan). Reported runs: 25h (OpenAI blog), "upwards of 100 hours on a single goal" (OpenAI video). **[CLAIMED]** — these are anecdotal run-length claims, not a benchmark.

**One-line:** Codex `/goal` is a Ralph-style "run until a verifiable condition holds" loop with a durable
SQLite-backed goal contract, where a *separate small model* grades "done" each turn and pause/resume is taken
away from the model on purpose. Willison names it directly: "their own version of the Ralph loop."

## 2. 2026 agentic loop-engineering patterns (each: mechanism + measured result)

**P1 — Loop engineering as a named discipline (the meta-framing).** Addy Osmani, June 2026
(`addyosmani.com/blog/loop-engineering/`, O'Reilly 2026-06-22), grounded in Karpathy's "loopy era" and Boris
Cherny's "my job is to write loops." Mechanism: stop prompting the agent; **design the system that prompts it
— the feedback loops, scheduling, isolation, and verification gates.** Five building blocks (Vaughan's Codex
mapping): scheduled automations · goal mode (condition-based termination) · worktrees (parallel isolation) ·
subagents (maker-verifier) · skills (encoded conventions) + memory file (cross-run state). **MEASURED anchor:**
Karpathy's AutoResearch ran **700 experiments in 2 days → 20 optimizations improving training loss** (Vaughan,
citing Karpathy). The discipline's three compounding risks (Osmani): verification weakness, comprehension debt,
cognitive surrender.

**P2 — "Loops win where verification is cheap" (the verification-cost thesis).** Blake Crosley 2026-06-09
(`blakecrosley.com/blog/loops-win-where-verification-is-cheap`) + Brenn Hill "Evaluation-Driven Development"
(`looprails.dev/article-evaluation-driven-development.html`, 2026-06-23). Mechanism: the loop's automatability
is decided by **verification cost, not loop construction** — "every loop Cherny actually names has a success
condition a machine can check for free." CI repair automated first (test suite is the free verifier); feature
dev resists (verification = a human reading the diff). Hill: **build the verifier FIRST, then trust the loop**;
"a loop with a generous verifier is a machine for generating output that satisfies the verifier and nothing
else"; **verifiers need their own tests** (the verifier can be gamed). **[CLAIMED]** — practitioner thesis, not
benchmarked; Crosley cites two production incidents as evidence.

**P3 — Maker-verifier separation as a hard rule.** Osmani + Vaughan + Hill all converge: the verifier must be a
**different identity (model/process) from the maker**, run read-only/high-effort, "because the loop runs while
you are not watching." Hill warns the inverse failure: a verifier with the *same* training as the maker makes
**correlated errors** and misses the same things. Codex implements this as `check_model` (§1). **[CLAIMED]** as
a rule, but **MEASURED** in the eval literature piflow already cites (arXiv 2606.02866: only an evidence-gated
*independent* critic beats single-agent; `piflow-memory-v1.5.md §4d`).

**P4 — GEPA: reflective prompt evolution with Pareto-frontier multi-candidate selection** **[background, 2025-07]**
(arXiv 2507.19457, ICLR 2026 oral; `github.com/gepa-ai/gepa`). Mechanism: instead of collapsing a trajectory to
a scalar reward, an LLM **reads the full execution trace** (errors, profiler output, reasoning logs) — termed
**Actionable Side Information (ASI), "the text-optimization analogue of a gradient"** — diagnoses *why* a
candidate failed, mutates a targeted fix, and **maintains a Pareto front of candidates that excel on different
task subsets** (not a single greedy best). Loop: Select-from-Pareto → Execute-on-minibatch-with-traces →
Reflect → Mutate (inheriting ancestors' lessons) → **Accept iff improved, update Pareto front**. Plus
**system-aware merge** — combine two Pareto-optimal candidates strong on different tasks. **MEASURED:** beats
GRPO by **6pp avg / up to 19pp using up to 35× fewer rollouts** (100–500 evals vs 5,000–25,000+); beats MIPROv2
by >10pp (+12pp AIME-2025); ARC-AGI agent **32%→89%** via architecture discovery; coding-agent resolve rate
**55%→82%** on Jinja via auto-learned skills; 90× cheaper than Opus 4.1 at Databricks; 50+ production uses.

**P5 — AlphaEvolve: evolutionary code optimization with a program database + LLM ensemble** **[background, 2025-05/06]**
(arXiv 2506.13131; DeepMind blog). Mechanism: a seed program is iteratively mutated by an **ensemble of models
(Gemini Flash for breadth/throughput + Gemini Pro for occasional depth)**, scored by **automated evaluators
against a ground-truth metric**, and survivors stored in an **evolutionary program database implementing
MAP-Elites + island-population models** to balance exploit (improve the best) vs explore (keep diversity).
Asynchronous pipeline optimized for *throughput of ideas evaluated per compute budget*, not single-run latency.
Prompts are seeded with *diverse high-performing programs* — "each representing a different definition of
'good'" — to provoke varied candidates. **MEASURED:** first improvement over Strassen in 56 years (4×4 complex
matmul in 48 scalar mults); improved Google datacenter scheduling; sped up its own LLM's training; novel
provably-correct math results.

**P6 — ACE: evolving-playbook context engineering (anti-collapse incremental memory)** **[background, 2025-10]**
(arXiv 2510.04618, ICLR 2026). Mechanism: treat context as an **evolving playbook** updated by **structured,
incremental DELTA updates** (generate → reflect → curate, "grow-and-refine"), explicitly to defeat two failure
modes of naive memory: **brevity bias** (rewrites drop domain detail for terse summaries) and **context
collapse** (full-rewrite-each-step erodes detail — case study: 18,282 tokens @66.7% accuracy collapsed to 122
tokens @57.1% in ONE step). Adapts from **natural execution feedback, no labeled supervision**. **MEASURED:**
+10.6% on agents, +8.6% on finance; matches the top AppWorld production agent (and beats it on the harder split)
with a smaller open model, at lower adaptation latency and rollout cost.

**P7 — Ralph / Wiggum loop: stateless fresh-context iteration, state in files+git.** **[background July-2025, 2026-current discourse]**
Geoffrey Huntley (`ghuntley.com/loop/` 2026-01-17; `github.com/ghuntley/how-to-ralph-wiggum`); Thoughtworks Radar
(2026-04-15, "Assess"); Anthropic official `ralph-loop` plugin; analysis `genalphai.com/ralph-wiggum-loop-stateless-agents`
(2026-06-10). Mechanism: `while :; do cat PROMPT.md | agent; done` — each iteration is a **brand-new stateless
agent with an empty context window**; **ALL durable state lives in files + git commits** (an `IMPLEMENTATION_PLAN.md`
checklist + a curated "Codebase Patterns" log), never the context window. Four invariants: a loop · a fresh
agent per iteration · a **deterministic stop sentinel** (grep stdout for `COMPLETE`/`LOOP_COMPLETE`) ·
externalized state. Deliberate **context rotation** trades in-context memory for inspectable/bisectable failure
modes. Anthropic's plugin implements it via a **Stop hook (exit code 2)** that blocks session exit and re-feeds
the SAME prompt. Explicitly scoped (Huntley's "everything is a ralph loop") to **tasks with deterministic
acceptance signals — "what you reach for after the spec exists, not the tool that produces the spec."** goose
extends it with **cross-model review between iterations** (Thoughtworks). **[CLAIMED]** — practitioner pattern,
40+ community implementations; no controlled benchmark.

**P8 — Test-time / agentic-RL generation-verification loops (self-improvement over traces).** Cluster of 2026
papers. **ReVeal** (openreview, ReVeal.github.io): multi-turn RL interleaving code-gen + **self-verification**
(model writes its own tests + invokes tools), dense per-turn rewards, **TAPO turn-level credit assignment**,
anti-reward-gaming. **MEASURED:** trained on 3 turns, **keeps improving to 20+ turns at inference** (Pass@1
34.8%→36.7%→38.7% to turn 25). **TRT** (arXiv 2602.03094): test-time recursive thinking, accumulated knowledge +
self-generated verification, **no external feedback** — open models hit **100% on AIME-25/24**; closed models
+10.4–14.8pp on hardest LiveCodeBench; test-execution alone contributes +7.4pp as a selection signal.
**SWE-TRACE** (arXiv 2604.14820): **rubric-based process reward model** + **heuristic test-time scaling that
prunes weak ACTIONS during rollout** (step-level), not reranking complete trajectories after; multi-task
cascading where an oracle verifier picks the best of multiple candidate actions per step. **Socratic-SWE** (arXiv
2606.07412): co-evolutionary self-play distilling an **Agent Skill Registry from historical traces** to
target capability gaps — **+7.80pp SWE-bench Verified after 3 iterations**, beating 5 self-play baselines;
note **teacher-guided variants saturate by iteration 2** (a documented ceiling). **ReflexiCoder** (ACL 2026):
internalizes the reflect-correct trajectory into weights, **−40% inference compute** vs base. (These are mostly
*weight-training* loops; relevant to piflow as the **trace-as-learning-signal** and **multi-candidate
action selection** mechanisms, not as a training recipe.)

**P9 — LoopRails: per-ACTION oversight grading (Grade·Guard·Show·Prove).** Brenn Hill (`looprails.dev`,
2026-06-22/23; `github.com/brennhill/looprails`). Mechanism: grade **every action the loop can take** (not the
system) on **reversibility × blast-radius × stakes → G0–G3**; the highest axis sets the grade. **Guard** by
grade: where a human cannot realistically catch the mistake in time, **PREVENT by design (sandbox / force
reversibility / cap blast radius / lock capability) rather than ask for review** — "an approval prompt no one
reads is a delay with a signature on it." Every governed action stays **RAIL: Reversible · Authorized ·
Interruptible · Logged.** A **circuit breaker** trips automatically (server-side) on error rate / spend / spend
rate / action volume, and an open breaker resumes ONLY on deliberate logged human re-authorization. **Show**:
feedforward consequence preview + provenance ("how did this get to me?") + contrastive why/why-not framed for
*error-detection not persuasion*. **Prove**: seed errors and measure whether humans actually catch them.
**MEASURED anchor it cites:** even the safest agent fails ~24% on a high-stakes tool benchmark (so
consequence+reversibility preview is necessary, not decorative). Pairs with **BRACE** (the security baseline:
isolation, capability-scoped tokens, signed/minimal containers, observability).

**P10 — Andrew Ng's three nested loops (the loop hierarchy).** deeplearning.ai 2026-06-26. Mechanism: software
gets built by **three loops at different timescales**: (1) **agentic coding loop** (seconds–minutes: agent
writes/tests/iterates against spec+evals), (2) **developer feedback loop** (tens-of-min–hours: human steers
product-level changes), (3) **external feedback loop** (hours–weeks: alpha testers / A/B / production data feeds
the vision). The point: the optimization loop is the *innermost* of a nested hierarchy; the outer loops carry
the *vision/spec* that the inner loop optimizes against and cannot itself generate. **[CLAIMED]** — framework, not benchmarked.

## 3. Gap-check vs piflow's overlord (per pattern: HAVE-IT / ADDS / CONTRADICTS)

**P1 Loop engineering (the discipline).** **[WE-HAVE-IT]** — piflow's overlord IS loop engineering: a
deterministic driver that prompts on your behalf with feedback gates, isolation, and termination. The five
building blocks all have piflow analogues (automations≈the N-round driver; goal≈the gate; worktrees≈per-node
sandbox/`owns`; subagents≈implement-vs-check split; skills+memory≈the two legs). Nothing missing at the framing level.

**P2 Verification-cost thesis ("loops win where verification is cheap").** **[WE-HAVE-IT, sharpened]** — this is
exactly v1.5's organizing principle ("outcome-gated accept, push the score toward OUTCOME, the human is the eye
for the irreducible residual") and the four-tier cascade. The four-way triage's *blast-radius ordering* (LAPSE→SKILL→FUNCTIONALITY→ARCH,
each with a harder gate) is the same "automate where verification is cheap" calculus applied to the *fix surface*.
Hill's "**verifiers need their own tests**" is a faint **[ADDS]**: piflow's scoring harness (the lifted checks,
the judge) is itself un-tested infrastructure that could be gamed — v1.5 names the abstention/swap-consistency
guards but never says the *verifier itself* gets adversarial tests.

**P3 Maker-verifier separation.** **[WE-HAVE-IT]** — implement-model ≠ check-model is shipped, and v1.5 §4b/§4d
already require a *separate, grounded critic ≠ producer* with the correlated-error warning. Codex's twist —
**a separate SMALL/cheap model for the binary "done?" check** specifically (not a full peer critic) — is a minor
**[ADDS]** on cost framing (the stop-decision can be cheaper than the quality-decision), but structurally we have it.

**P4 GEPA — Pareto-frontier multi-candidate selection + ASI text-gradient + system-aware merge.**
**[ADDS — we're missing the multi-candidate frontier].** This is the sharpest add. piflow's overlord is a
**single-incumbent ratchet**: each round proposes an edit, the gate accepts iff it *strictly improves the
scalar*, and the loser goes to a rejected-edit buffer (v1.5 §6, SkillOpt's `gate.py:123`). GEPA (and AlphaEvolve,
P5) keep a **population/Pareto front of multiple candidates that win on DIFFERENT task subsets** and **merge
complementary ones** — precisely because a single scalar ratchet gets stuck in local optima and discards a
candidate that's worse-on-average but better on a hard slice. v1.5's gate "accept iff score strictly improves"
is GEPA's documented **failure mode** ("local optima that afflict greedy prompt optimization"). The ASI half
(LLM reads the *full trace* as a gradient) piflow HAS (Tier-0 telemetry + the diagnostic check-model = ASI);
the **Pareto-front + merge** half it does NOT.

**P5 AlphaEvolve — program database (MAP-Elites/islands) + model ensemble + throughput-over-latency.**
**[ADDS — we're missing population diversity + the cheap/strong ensemble].** Same core add as P4 from the
evolutionary side: an explicit **database of scored candidates** balancing exploit vs explore, not a single
incumbent. Two further sub-adds: (a) **a heterogeneous proposer ensemble** — a fast cheap model for *breadth of
candidate edits* + a strong model for *occasional depth* (piflow proposes with one fixer per node; it does not
mix a cheap-breadth + strong-depth proposer); (b) **optimize the loop for throughput of evaluated candidates
per budget**, async, rather than N sequential rounds. piflow's N-round sequential driver is the opposite design point.

**P6 ACE — incremental DELTA updates, anti-brevity-bias, anti-context-collapse.** **[ADDS — we're missing the
explicit anti-collapse update discipline for memory.md].** v1.5's MEMORIZE step writes lessons to per-node
`memory.md` with "cap/freshness," and the harvested-practices doc has "budget pressure as distiller." But ACE
names the precise danger of the *consolidation* move piflow plans (between-rounds cap/freshness + reconcile):
**full-rewrite consolidation under budget pressure CAUSES collapse** (66.7%→57.1% in one step). ACE's answer —
**structured incremental delta updates that never rewrite the whole playbook** — is a concrete mechanism piflow's
memory-consolidation does not yet specify. This is a real gap in the MEMORIZE/reconcile leg, distinct from the
gate gap.

**P7 Ralph loop — stateless fresh-context per iteration + deterministic stop sentinel.** **[CONTRADICTS — partial].**
Two contrasts. (a) **Context handling:** Ralph's thesis is **fresh empty context every iteration, all state in
files** — deliberately the *opposite* of accumulating context, to avoid degradation. piflow's per-round driver
runs the workflow fresh each round and externalizes state to run-dirs + memory.md, so it is *Ralph-aligned* on
the RUN. But the overlord's TRIAGE/FIX/MEMORIZE accumulates cross-round reasoning; Ralph would say keep even the
*optimizer* stateless and let git+the worklist be the only memory. (b) **The deeper [CONTRADICTS]:** Ralph
(and Codex `/goal`) terminate on a **deterministic stop sentinel / verifiable completion condition** ("run until
done"); piflow's overlord terminates on a **fixed run-count budget N** with no "goal reached → stop early"
condition. piflow has *no early-stop on convergence* (it inherited SkillOpt's "no patience/early-stop" — `skillopt-sleep §4`).
SOTA loops are **goal-conditioned, not count-conditioned**; piflow is count-conditioned. (Note: this cuts both
ways — SkillOpt also has no early-stop and it works; but Codex/Ralph/GEPA all stop on a *condition*, which is
the broader pattern.)

**P8 Test-time/agentic-RL trace loops — step-level action selection, trace-as-skill distillation, saturation ceiling.**
**[ADDS — we're missing per-step (intra-run) candidate selection].** piflow optimizes **between runs** (edit the
system, re-run). SWE-TRACE's HG-TTS and TRT/ReVeal add a layer piflow has no analogue for: **multiple candidate
ACTIONS generated per step, an oracle/verifier prunes weak branches DURING the rollout** — verification moved
*inside* the run at step granularity, not only at the end. (piflow's within-run gate is `checks.post` per
artifact + G8 repair — node-level, not step-level branch selection.) Also **[ADDS]** the documented **saturation
ceiling** (Socratic-SWE: teacher-guided self-improvement saturates by iteration 2; even skill-guided gains
decelerate) — empirical evidence that a fixed-N loop should *expect diminishing returns* and budget rounds
accordingly, reinforcing the P7 early-stop gap. Socratic-SWE's "**distill skills from historical traces to
target capability gaps**" is what piflow's SKILL bucket + Leg-A recurrence is reaching for **[WE-HAVE-IT, designed]**.

**P9 LoopRails — per-ACTION grade (G0–G3) + prevent-don't-review + circuit breaker + RAIL.**
**[ADDS — we're missing the per-action consequence grade and the auto circuit-breaker].** piflow gates on
**fix-SURFACE blast radius** (the four-way triage: prose vs code vs arch, with harder gates up the chain) and on
the sandbox jail (`owns`/`readScope`) — which is real prevention-by-design and partially HAS this. But LoopRails
grades **each ACTION the loop emits** on reversibility×blast×stakes and insists that for high-grade actions a
human **cannot** be a reliable catcher inside an unattended loop, so you **prevent (sandbox/cap/lock), not
review**. piflow's LAND step is human-gate-for-judgment + auto-commit-for-outcome — but it has **no automatic
circuit breaker** (trip on error-rate / spend / action-volume / runaway, server-side, resume only on logged
human re-auth) and **no explicit RAIL (interruptible + logged) contract on the optimizer's own edits**. The
overlord bounds tokens/rounds/edits (caps) but does not *trip and halt on anomalous trajectory mid-loop* —
LoopRails' circuit breaker is exactly the runaway guard a multi-hour autonomous optimizer needs.

**P10 Three nested loops.** **[WE-HAVE-IT, implicitly].** piflow's overlord is Ng's innermost agentic loop; the
developer-feedback loop = the human who batch-approves staged judgment edits; the external loop = product
evals/criteria maintenance (`piflow-enhance` owns the criteria fixture). No gap, but a useful framing: the
overlord must not try to generate its own vision/spec — that lives in the outer loops (matches v1.5's "criteria/golden
stay product-side" and the ARCH-bucket route-up).

## 4. Verdict — the most important missing pattern + the sharpest contradiction

**The single most important missing pattern: multi-candidate / Pareto-frontier selection (P4 GEPA + P5
AlphaEvolve).** piflow's overlord is a **single-incumbent strict-improvement ratchet** — each round keeps one
edit iff its *scalar* strictly beats the baseline, and discards everything else to a dead-edit buffer. Both
GEPA and AlphaEvolve independently abandoned exactly this design because a scalar ratchet **gets stuck in local
optima and throws away a candidate that is worse-on-average but better on a hard task slice**. Their fix — keep
a **population/Pareto front of candidates that win on different task subsets, then merge complementary ones**
(GEPA's system-aware merge; AlphaEvolve's MAP-Elites/island database) — is *measured* to be the difference
(GEPA: up to +19pp over RL at 35× fewer rollouts; ARC-AGI 32%→89%). v1.5's gate predicate "accept iff the
scalar strictly improves" is, verbatim, the documented greedy-optimizer failure mode. This is the one piece of
the SOTA loop architecture piflow's design has no analogue for, and it is the highest-leverage add: it most
likely lifts a stagnant pipeline that a single-incumbent ratchet would plateau on (echoed by P8's measured
saturation-by-iteration-2 ceiling).

**The sharpest contradiction: goal-conditioned termination vs fixed-count termination (P7 Ralph / Codex
`/goal`).** Every flagship 2026 loop — Codex `/goal`, the Ralph loop, GEPA's Pareto-accept — **stops on a
verifiable CONDITION** ("run until the success condition holds, or honestly report blocked"), with a separate
checker grading "done" each turn. piflow's overlord **stops on a fixed run-count budget N** and has *no
early-stop on convergence and no "goal reached" condition* (inherited from SkillOpt's deliberate no-patience
design). The contradiction is real but narrow: count-bounding is a defensible *safety* choice (and SkillOpt
ships it successfully), but it means the overlord will burn its full budget even after it has converged or
stalled, and it lacks the SOTA's first-class "the loop's own verifier says we're done / we're blocked" stop
signal. The honest reconciliation: piflow's per-edit OUTCOME gate already provides the *quality* check the SOTA
verifier provides — what's missing is letting a **run of no-accepted-edits (or a tripped circuit breaker, P9)
terminate the loop early** rather than grinding to N.

**Is the overlord design complete vs SOTA?** No — it is ~80% complete and architecturally sound on the control
plane (deterministic driver, propose/score/gate/land/stage-with-manifest, maker-verifier split, human gate for
judgment, hard caps), but it is missing three things the 2026 SOTA treats as load-bearing: (1) **multi-candidate
Pareto selection** instead of a single-incumbent ratchet [the big one]; (2) a **convergence/condition-based
early stop + an automatic circuit breaker** instead of pure count-bounding; and (3) **ACE-style incremental
delta memory updates** to keep the MEMORIZE/reconcile leg from collapsing under consolidation pressure.
