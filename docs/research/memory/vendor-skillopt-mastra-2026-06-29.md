# Vendor digest: SkillOpt + Mastra memory (for piflow memory v1)

> Produced 2026-06-29 for `piflow-memory-v1.md`. SkillOpt read from a fresh clone at
> `vendor/SkillOpt@9969a8f`; Mastra read from `vendor/mastra@12af22b` plus the existing
> per-aspect spec `docs/specs/mastra/memory-and-rag.md`. Every code claim is cited
> `path:line`; README/paper claims are tagged as such and separated from what the code does.
> Citations are relative to each vendor root (`vendor/SkillOpt/`, `vendor/mastra/`).

---

## 0. Clone status

- **Command run:** `git clone https://github.com/microsoft/SkillOpt /Users/tk/Desktop/piflow/vendor/SkillOpt` — **SUCCESS** (exit 0). The URL is the real Microsoft repo; no fallback search was needed.
- **Resolved URL:** `https://github.com/microsoft/SkillOpt`
- **Commit cloned:** `9969a8f393f3b5ece29715e6e5b07deb5be90741` (HEAD message: "Add Devin plugin (plugins/devin): MCP server + ATIF-v1.7 harvest (#88)").
- **README confirms identity** (`README.md:1`): *"SkillOpt: Executive Strategy for Self-Evolving Agent Skills"*, paper arXiv:2605.23904, PyPI `skillopt`. Matches "skill optimization for agents."
- **Mastra** was already vendored at `vendor/mastra@12af22b`; not re-cloned.

---

## 1. SkillOpt — what it is + the optimization loop

**Problem it solves (README claim, `README.md:30-44`):** agent skills are usually hand-written, one-shot LLM-generated, or loosely self-revised, and none behaves like a *deep-learning optimizer over the skill itself*. SkillOpt's framing (verified throughout the code, not just the README): **treat the skill document as the trainable state of a frozen agent** and "train" it with DL discipline — epochs, batch size, learning rate, validation gate — while making **zero model-weight and zero inference-time changes**. The deployed artifact is one `best_skill.md` (`engine/trainer.py:2048`).

**The loop is literally a 6-stage SGD analogue**, documented at `engine/trainer.py:1-13` and implemented in `ReflACTTrainer.train()` (`engine/trainer.py:597`):

1. **Rollout** (`trainer.py:1119-1129`) — run the target model on a *minibatch* of train tasks under the **current** skill; `adapter.rollout(...)` returns per-item results scored hard/soft (`compute_score`, `utils/scoring.py`).
2. **Reflect = the "gradient"** (`trainer.py:1131-1157`, impl `gradient/reflect.py`) — an **optimizer LLM** (separate from the target) reads the *minibatch* trajectories grouped together (minibatch-SGD analogy, `reflect.py:1-7`) and emits candidate **edits** to the skill text. Failures and successes are reflected separately (`trainer.py:1145` → `_normalise_patches`).
3. **Aggregate** (`trainer.py:1220-1228`, `gradient/aggregate.py:merge_patches`) — hierarchically merge the per-minibatch edit sets into one patch (the "gradient accumulation" step; `accumulation` config multiplies minibatches per step, `trainer.py:1096`).
4. **Select = "gradient clipping"** (`trainer.py:1238-1290`, `optimizer/clip.py:rank_and_select`) — an optimizer LLM ranks the merged edits and keeps only the **top-L**, where **L is the learning rate / `edit_budget`** (`clip.py:25,54`). The budget comes from a scheduler (`optimizer/scheduler.py:build_scheduler`, modes constant/linear/cosine, `trainer.py:821`) or is chosen per-step by an **autonomous LR** optimizer call (`optimizer/lr_autonomous.py:decide_autonomous_learning_rate`, `trainer.py:1252`).
5. **Update = "optimizer.step()"** (`trainer.py:1308-1360`) — apply the ranked edits to produce a **candidate** skill (`optimizer/skill.py:apply_patch_with_report`). Update modes vary: deterministic `patch` ops, `rewrite_from_suggestions` (LLM rewrites whole doc from the selected suggestions, `optimizer/rewrite.py`), or full-rewrite-minibatch (`trainer.py:1311,1328`).
6. **Evaluate = validation gate / early-stopping** (`trainer.py:1418-1528`) — roll out the candidate on a **held-out selection set** (`split="valid_seen"`, `trainer.py:1427-1435`), score it, and **accept the candidate only if its gate score strictly beats the current skill** (`evaluation/gate.py:evaluate_gate`, `:123` `cand_score > current_score`). Rejected → skill unchanged, edit recorded as negative feedback.

**Two slower memory tiers run at epoch boundaries** (not per step):
- **Slow update** (`trainer.py:1617-1932`, `optimizer/slow_update.py`) — "momentum": at the end of each epoch it re-rolls the previous-epoch vs current-epoch skill on the **same** tasks, builds **longitudinal pairs** categorized `improved / regressed / persistent_fail / stable_success` (`trainer.py:1754-1757`), and writes consolidated guidance into a **protected `<!-- SLOW_UPDATE -->` region** of the skill (`optimizer/skill.py:14-15`).
- **Meta-skill** (`trainer.py:1934-2045`, `optimizer/meta_skill.py`) — **optimizer-side memory**: distilled cross-epoch guidance that does NOT touch the target skill but is fed back into the *next* epoch's reflect/merge/rank prompts (`meta_skill.py:18-30`, injected at `reflect.py`/`clip.py` via `format_meta_skill_context`). This is memory *about how to optimize*, separate from the skill being optimized.

**Stability machinery (the "without touching weights" discipline) — all in code:**
- **Rejected-edit buffer**: a per-epoch `step_buffer` records each step's failure patterns and, on reject, the exact edits tried + the score drop (`trainer.py:1532-1564`, `_format_step_buffer:522`), and is fed into the next step's reflect prompt so the optimizer avoids re-proposing dead edits.
- **Selection cache**: candidate skills are hashed (`skill_hash`) and val-scores cached so identical candidates aren't re-rolled (`trainer.py:948-953,1420`).
- **Resume/runtime-state**: `history.json`, `runtime_state.json`, and per-step `skill_vNNNN.md` snapshots (`trainer.py:363-407`) make the whole trajectory replayable — the durable log of every skill version.

**Deployment-time companion — `skillopt_sleep/` (most piflow-relevant).** README `docs/sleep/README.md:1-28`: a **nightly offline self-evolution** cycle for *real local coding agents* (Claude Code / Codex / Copilot). The cycle (`skillopt_sleep/cycle.py:90`, `run_sleep_cycle`) is: **harvest transcripts → mine recurring checkable tasks → replay offline → consolidate (reflect → bounded edit → GATE on held-out tasks) → stage a proposal → human adopts** (`cycle.py:22-23` docstring, stages at `:139-289`). It vendors the SkillOpt gate verbatim (`skillopt_sleep/gate.py:1-9`) so the open-source tool has zero dependency on the paper code.

---

## 2. SkillOpt — key abstractions + mutable unit + eval/credit-assignment

**The mutable unit = a single Markdown skill document** (`best_skill.md`, 300–2000 tokens per `README.md:46`). The model weights are frozen; the *only* thing trained is text. There is **no code-editing abstraction in the core paper engine** — the target agent runs against the skill as a prompt. (In the `codex_exec` / `claude_code_exec` backends the target *is* a coding agent, so the trajectories are tool-use traces, but SkillOpt still only edits the skill text, never the agent's own code — `trainer.py:694-711` configures these as execution backends, and the optimizer edits `current_skill`.)

**Edit operations (the typed mutation vocabulary)** — `optimizer/skill.py:_apply_edit_with_report:85`:
- `append` (`:98`), `insert_after` (`:108`), `replace` (`:124`), `delete` (`:134`). Each is a deterministic string op with a per-edit status report (`applied_* / skipped_* / error`, `:165`). **Protected regions** (`SLOW_UPDATE`, `APPENDIX`) cannot be touched by step-level edits (`:27-30,94`) — disjoint write authority between the fast loop and the slow/meta tiers.

**How it scores a change (eval):** a candidate is scored by **rolling it out on a held-out selection split and comparing aggregate hard (exact-match) / soft (partial-credit) accuracy** to the incumbent (`evaluation/gate.py:select_gate_score:46`, `evaluate_gate:76`). Acceptance is **strictly-improves-or-reject** (`gate.py:123`). The eval signal is *task success on real held-out tasks*, never an LLM's self-assessment of the edit.

**How it decides WHAT to change — and the CREDIT-ASSIGNMENT crux (`optimizer/skill_aware.py`):** with `use_skill_aware_reflection` on, the failure analyst must **classify each failure** as one of two kinds (`skill_aware.py:61-91`, the `ERROR_SUFFIX` prompt):
- **`SKILL_DEFECT`** — "an agent that *followed the skill* would still fail, or the skill gives no relevant guidance" → routed to a **body edit** of the skill (`skill_aware.py:67-69,81`).
- **`EXECUTION_LAPSE`** — "the skill ALREADY contains a correct rule that would have avoided the failure, but the agent didn't follow it" → routed to a short reminder in the protected **appendix**, NOT a body edit (`skill_aware.py:70-73,82-85`). The discrimination test is explicit (`:75-78`): *"Is there a rule in the current skill that, if followed, prevents this failure?"* — yes ⇒ lapse, no ⇒ defect — **and when unsure, default to EXECUTION_LAPSE** (protect the body; never delete a valid rule over a one-off slip). The appendix is consolidated by a threshold-gated LLM compaction pass (`skill_aware.py:164` `consolidate_appendix_notes`, paper Eq.11; trainer flush at `trainer.py:81-144`).

This is *exactly* the blame-attribution decision piflow's v1 needs — only SkillOpt's two buckets are **{skill is wrong} vs {agent ignored a correct skill}**, both within the skill/prose axis. It does **not** have a third bucket "the underlying *code/functionality* is wrong" because its mutable unit is prose-only.

**The `_sleep` consolidate makes the two-target split explicit (`skillopt_sleep/consolidate.py:consolidate:64`):** it evolves **two separate documents** — the **skill** (`evolve_skill`, `:136-178`) and the **memory** = the live `CLAUDE.md` (`evolve_memory`, `:180-189`) — *in sequence*, **each gated independently** on the held-out val slice via the same `_gate_apply` closure (`:112-134`). After improving the skill it **re-evaluates the remaining failures under the new skill** before proposing memory edits (`:181-184`) — a causal ordering so memory only absorbs what the skill didn't fix.

---

## 3. Mastra — agentic memory model

Mastra's memory is `MastraMemory` (`packages/core/src/memory/memory.ts:114`, verified — the abstract base class is declared there), concrete `Memory` (`packages/memory/src/index.ts:227`). It composes **four memory kinds into one context window** (per `docs/specs/mastra/memory-and-rag.md` §"Memory — kinds", cross-checked against source):

1. **Thread history** — last-N messages of the current thread (`lastMessages` default 10, `memory.ts:83`), attached as a `MessageHistory` processor.
2. **Semantic recall (RAG over past messages)** — embeds the query, vector-searches prior messages, injects top-K + `messageRange` neighbors. Defaults **`topK=4`, `messageRange=1`** — verified at `packages/core/src/processors/memory/semantic-recall.ts:14-15`; similarity `threshold` filter at `semantic-recall.ts:420`.
3. **Working memory** — an agent-authored persistent record (Markdown template or Zod/JSON schema). The `WorkingMemory` **input processor reads the stored blob and PREPENDS it as a system instruction every turn** — verified at `packages/core/src/processors/memory/working-memory.ts` header (`:36-50`: *"Retrieves working memory… formats it as a system instruction… Prepends it to the message list"*). The agent **mutates it by calling the `updateWorkingMemory` tool** (`working-memory.ts:46` note; tool at `packages/memory/src/tools/working-memory.ts`), persisted under a mutex (`memory/src/index.ts`).
4. **Observational memory** — an Observer→Reflector pipeline that token-triggers extraction/compression of long-term observations (`packages/core/src/memory/types.ts:741-871`); async, with optional `recall` retrieval tool.

**Thread/resource model (`memory/types.ts:39`):** every thread is keyed by `id` + `resourceId` (the user). Both working memory and semantic recall accept `scope: 'thread' | 'resource'` — `resource` shares state across all of a user's threads, `thread` isolates it. This is the key distinction from a stateless DAG runner: an agent **remembers a user across separate sessions/processes**.

**Storage** is pluggable behind `MastraCompositeStore` (`memory/types.ts:1134`): the spec counts **17 storage classes / 16 store dirs** (libsql, pg, upstash, mongodb, redis, …) and **18 vector backends** behind `MastraVector` (`packages/core/src/vector/vector.ts:72`). RAG is turnkey: `MDocument` ingestion, 9 chunking strategies, embed, `createVectorQueryTool`, rerank (`packages/rag/src/rerank/index.ts`), and graph-RAG (`packages/rag/src/graph-rag/index.ts`).

The shape that matters for piflow: Mastra's "memory" is **conversational/episodic state for a chat agent**, attached per-agent, retrieved by recency + embedding similarity. Working memory is the *only* curated standing surface, and it is **the agent's own self-state** — there is no separate "world/code understanding" leg.

---

## 4. Mastra — any self-optimization / eval-driven improvement (explicit absence)

**Mastra has evals/scorers but NO eval-driven self-optimization loop — verified.** Scorers live in `packages/evals/src/scorers/` (dir confirmed) and scores are persisted into an observability storage domain `packages/core/src/storage/domains/scores/` (`base.ts`, `inmemory.ts`, `index.ts` confirmed). A grep for any module that consumes a score to **rewrite a prompt / skill / memory / instruction** returned **nothing**: `grep -rIlE "(self.?improv|auto.?tune|prompt.?optimiz|gepa|reflect.*edit.*prompt)" packages/core/src packages/evals/src` → no hits. The agent's instructions are **read-only at runtime** — `getInstructions` exists but is only referenced from `agent.test.ts`; there is **no `setInstructions`/`updateInstructions` mutator** in `packages/core/src/agent`.

The one place a "score" drives behavior is **retrieval-time**: `semantic-recall.ts:420` filters vector results by a similarity `threshold`, and rerank blends `{semantic, vector, position}` weights (`rerank/index.ts`). That is selection of *what to recall*, not improvement of *what the agent is*.

So Mastra's improvement story is **manual and human-in-the-loop**: evals report a number; a developer reads it and edits the agent/prompt by hand. Its automatic "learning" is limited to (a) working memory the model rewrites about the *user/conversation* via a tool, and (b) observational-memory compression. **Neither closes a measured-quality → edit-the-agent loop.** This is the categorical gap vs SkillOpt (and vs piflow's intent).

---

## 5. Mapped to piflow's two axes

| Axis | **SkillOpt** | **Mastra** | **piflow-memory-v1** |
|---|---|---|---|
| **Skill-system optimization** (UPDATE TARGET 1: prompts/skills/markdown) | **Core capability** — the skill `.md` IS the trained unit; reflect→rank→apply→gate edits it every step (`trainer.py:597`, `optimizer/skill.py:85`); `_sleep` does it nightly with `evolve_skill` (`consolidate.py:136`). | **Absent** — agent instructions are read-only at runtime; no module edits a prompt/skill from a signal (no `setInstructions` in `agent/`). | **Core intent** — per-node `prompt.md`/`SKILL.md`/`scripts` edited by a per-node fixer sub-agent, recorded as `skillsys(<node>)` commits (`piflow-memory-v1 §6,§7`). DESIGNED, optimizer loop NOT yet built (§11). |
| **Code/functionality optimization** (UPDATE TARGET 2: actual code) | **Absent in the engine** — even with coding-agent backends it only edits the skill text, never the agent's/product's code (`trainer.py:694-711` runs the coding agent; the optimizer mutates `current_skill` only). | **Absent** — Mastra is an app framework an engineer writes; it never edits its own or the product's code. | **Designed & distinctive** — a per-node fixer may edit **project code within `io.reads`/`owns`** (the runtime jail = the optimization blast radius); out-of-scope fixes route up to reconcile (`piflow-memory-v1 §5a, §5,§6`). NOT yet built. |
| **Memory base — self/history** (KB A: git records → curated memory.md) | **History as files**: per-step `skill_vNNNN.md`, `history.json`, rejected-edit buffer, slow-update region, optimizer-side meta-skill (`trainer.py:363-407,1532,1617,1934`). `_sleep` evolves the live `CLAUDE.md` via `evolve_memory` (`consolidate.py:180`). | **Has it for conversation**: thread history + working memory + observational memory, scoped per thread/resource (`memory.ts:83`, `working-memory.ts`, `types.ts:741`) — but it's *conversational self-state*, not git-distilled lessons. | **Leg A** = git (episodic, queried) + curated per-node/system `memory.md` (status + scars), Karpathy 3-file→2-surface (`piflow-memory-v1 §2,§4`). Scaffold SHIPPED (§11). |
| **Functionality base — world/code** (KB B: how components work, code-map/OKF) | **Absent** — no representation of "how the code under test works"; the skill captures *task strategy*, not a code map. | **Partial, generic**: RAG/Graph-RAG over ingested documents is a world-knowledge retriever, but it is not a structural code map and is not per-component. | **Leg B** = per-node `code-map.md`, always-OKF, Tier-0 one-slice ↔ Tier-1 codegraph + global OKF index (`piflow-memory-v1 §5b`). Tier-0 scaffold SHIPPED; Tier-1 NOT built (§11). |
| **Blame attribution / credit assignment** | **Yes, two-way within prose**: `SKILL_DEFECT` (skill wrong → body edit) vs `EXECUTION_LAPSE` (skill right, agent slipped → appendix reminder, default-when-unsure) — `optimizer/skill_aware.py:61-91`. No "code is wrong" bucket. | **Absent** — no failure analysis routes a defect anywhere; evals are measure-only. | **The crux, three-way**: Hermes triage credit-assigns each defect to a node, deciding **skill-system fault vs functionality/code fault**, and whether to edit functional components; escapes route up to reconcile (`piflow-memory-v1 §7`). DESIGNED, NOT built. |

---

## 6. What piflow should BORROW vs what it already has vs gaps

- **[BORROW] The strict held-out validation gate as the accept/reject primitive.** SkillOpt's `evaluate_gate` (`evaluation/gate.py:123`) — *accept a self-edit only if it strictly improves a held-out score* — is the single mechanism that makes "self-evolution" not drift. piflow's v1 currently has **human-gated** `skillsys` commits (`§7,§9`) but **no automatic per-edit quality gate**; an analogous "re-run the node/DAG on a held-out task slice, keep the edit only if the score rises" gate would make the per-node fixer safe to run before the human sees it.

- **[BORROW] The SKILL_DEFECT vs EXECUTION_LAPSE discrimination, extended to three buckets.** `optimizer/skill_aware.py:61-91` is a working, prompt-level credit-assignment rubric with a *default-when-unsure* rule that protects the corpus. piflow's triage (`§7`) should adopt this verbatim discrimination test and **add the third bucket it needs — "FUNCTIONALITY_DEFECT" (the product code is wrong)** — so triage routes to {edit prompt/skill} vs {nudge a correct skill} vs {edit code in `owns`}.

- **[BORROW] Bounded edits + a "learning-rate" cap + a rejected-edit buffer.** SkillOpt clips each step to `edit_budget` edits (`optimizer/clip.py:54`) and feeds the *rejected* edits back as negative context (`trainer.py:1532-1564`). piflow's `§3` caps are still open (`§10.1`); borrow both the top-L cap **and** the "remember what was rejected so the fixer doesn't re-propose it" buffer — directly addresses the Library-Drift concern piflow already cites (`§3`).

- **[BORROW] The `skillopt_sleep` nightly cycle as the literal template for the §7 meta-DAG.** `skillopt_sleep/cycle.py:90` is end-to-end the loop piflow describes: **harvest transcripts → mine tasks → replay → consolidate(gate) → stage → human adopt**, with **`evolve_skill` and `evolve_memory` as two separately-gated targets** consolidated in causal order (`consolidate.py:136-189`). This is the closest external prior art to piflow's triage→fixer→reconcile and validates the two-update-target architecture; piflow's "two targets" already maps onto sleep's two, and piflow adds the code target as a third.

- **[BORROW] Slow/meta tier with disjoint write authority via protected regions.** SkillOpt keeps fast per-step edits out of the `SLOW_UPDATE`/`APPENDIX` regions (`optimizer/skill.py:27-30,94`), mirroring piflow's "node fixers vs the one reconcile node" disjoint-authority rule (`§7`). Borrow the *mechanism* (protected, append-only region the fast loop cannot touch) for the template `memory.md` reconcile summary.

- **[HAVE] Two-leg self/world split — piflow's Leg B has no SkillOpt/Mastra equivalent.** Neither system models "how the code under test works." piflow's `code-map.md` / OKF Tier-0↔Tier-1 (`§5b`) is genuinely beyond both — keep it; do not look to these vendors to design it.

- **[HAVE] git-as-iteration-log + curated `memory.md`.** SkillOpt reinvents this with `history.json` + `skill_vNNNN.md` snapshots because it has no VCS substrate; piflow already gets it for free from `skillsys(<node>)` commits (`§2.1`). Don't adopt SkillOpt's bespoke JSON history — piflow's git approach is strictly better.

- **[GAP] piflow has no automatic eval/score signal yet — this blocks the whole gate.** SkillOpt's gate needs a per-task hard/soft score from a held-out set (`utils/scoring.py`, `compute_score`); `skillopt_sleep` *mines checkable tasks* from transcripts to manufacture that signal (`cycle.py:191`, `mine`). piflow's `§7` assumes triage reads `run-status.json` but there is **no held-out task replay / scoring harness**; closing the credit-assignment loop requires inventing piflow's analogue of "mine a checkable task from a node's run trace and re-score a candidate edit on it." This is the single biggest missing piece between piflow's scaffold (`§11`) and a working optimizer.

- **[GAP] The code-editing fixer is unproven and unbounded-by-tooling.** SkillOpt deliberately never edits code, sidestepping the hardest part; Mastra never does either. piflow's UPDATE TARGET 2 (fix the product code within `owns`, `§5a`) has **no external prior art to borrow from** — its safety rests entirely on the runtime jail = blast-radius claim (`§5a`), which is asserted but not yet demonstrated by a fixer that actually edits code and is gated by re-running tests.

- **[GAP] Mastra-style cross-session memory continuity is absent and may be wanted at the system tier.** Mastra's `resource`-scoped working memory (`memory/types.ts:184`) lets state persist across separate processes/sessions per owner; piflow's per-node `memory.md` is per-template, not per-(product, owner) across runs. If piflow ever wants "this product's DAG remembers across unrelated runs," the resource-scope idea is the cleanest borrow — but it is NOT in v1's scope and should stay out until a need appears.
