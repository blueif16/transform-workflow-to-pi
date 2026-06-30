# SkillOpt skillopt_sleep — the loop control structure (reference for piflow's overlord, 2026-06-29)

> Scope: the loop **CONTROL** only — driver type, stage order, where the gate sits, propose-vs-adopt, bounding, negative-feedback, consolidation order. NOT what SkillOpt *is* (see `vendor-skillopt-mastra-2026-06-29.md`). All paths relative to `/Users/tk/Desktop/piflow/vendor/SkillOpt`.

## 0. Method + files read

Read end-to-end: `skillopt_sleep/cycle.py` (the night orchestrator), `skillopt_sleep/consolidate.py` (the gated epoch), `skillopt_sleep/gate.py` (vendored pure gate), `skillopt_sleep/staging.py` (propose/adopt), `skillopt_sleep/state.py` (cross-night persistence), `skillopt_sleep/dream.py` (recall+augment wrapper), `skillopt_sleep/slow_update.py` (cross-night memory), `skillopt_sleep/config.py` (defaults/budgets), `skillopt_sleep/__main__.py` (CLI driver), `skillopt_sleep/budget.py`. Cross-checked the research-side reference loop in `skillopt/engine/trainer.py` (the per-step epoch loop) and `skillopt/evaluation/gate.py` (the canonical gate the sleep gate is vendored from). Grepped the engine for `early.?stop|patience|no_improve` — none exist (only docstring analogy). Every claim below cites file:line.

## 1. The loop control structure (driver = code or LLM? stages + order)

**The driver is deterministic Python, not an LLM.** `run_sleep_cycle()` (`cycle.py:90`) is a straight-line procedure that calls each stage in a fixed order; the only LLM-driven steps are the *inner* stages (mining, reflect/edit-proposal, replay-scoring) which are reached through the `backend` abstraction (`cycle.py:113` `get_backend(...)`), never the loop itself. The module docstring states this directly: "It is pure-Python and import-light" (`cycle.py:6-7`), and the staged wiring is named at `cycle.py:3-4`: `harvest -> mine -> replay -> consolidate(gate) -> stage (-> optional adopt)`.

Concrete stage order inside `run_sleep_cycle`:
1. **begin night / load state** — `state.begin_night()` increments the night counter (`cycle.py:109`, `state.py:79-81`).
2. **harvest** — `harvest_for_config(...)` reads new session transcripts since `last_harvest` (`cycle.py:165-169`).
3. **mine** — `mine(...)` distills harvested sessions into checkable `TaskRecord`s, split-tagged train/val/test (`cycle.py:191-200`); uses an `llm_miner` only when a real backend is configured (`cycle.py:176-185`).
4. **early-exit guard** — if no tasks mined, record the night and return (`cycle.py:208-216`).
5. **replay + consolidate(gate)** — one call to `dream_consolidate(...)` (`cycle.py:228-241`) which wraps `consolidate(...)` (`dream.py:132-138`); this is the single gated epoch (§2).
6. **stage** — `write_staging(...)` writes proposals + report to a staging dir (`cycle.py:270-278`), skipped on `dry_run`.
7. **adopt (opt-in)** — only if `auto_adopt` AND accepted (`cycle.py:286-288`).

The per-night cycle is itself driven externally by a scheduler/cron, not by an in-process multi-night loop: `cmd_schedule` installs one cron entry per project (`__main__.py:274-287`); each firing runs exactly **one** night via `cmd_run` → `run_sleep_cycle` (`__main__.py:159`). The research-side `ReflACTTrainer.train()` runs the same six stages (rollout→reflect→aggregate→select→update→evaluate, `trainer.py:1-12`) as a deterministic `for epoch ... for step_in_epoch` double loop (`trainer.py:1026,1062`) — again plain Python, LLM only inside each stage.

## 2. Gate placement + the accept/reject predicate

**The gate sits at the very end of the consolidation epoch, per evolved target, AND once more at the end.** It is *inside* `consolidate()`, after edits are proposed and applied to a *candidate* copy — never against the live doc. Two placements:

- **Per-edit-batch gate** in the local closure `_gate_apply(...)` (`consolidate.py:112-134`): after `apply_edits` produces a candidate doc, it replays the **VAL slice** under the trial doc, aggregates, and **keeps the edit only if `cand_score > base_score`** (`consolidate.py:129-132`); otherwise the edit goes to `all_rejected` and the doc is reverted (`consolidate.py:133-134`). On accept it ratchets `base_score = max(base_score, cand_score)` (`consolidate.py:130`).
- **Final decision gate** (`consolidate.py:201-225`): re-replays the full candidate on the VAL slice, then calls the pure `evaluate_gate(...)` (`gate.py:37-50`, vendored from `skillopt/evaluation/gate.py:76`). The acceptance predicate is **strict held-out improvement**: `accepted = bool(all_applied) and final_score > base_gate_score` (`consolidate.py:222`) — there must be ≥1 applied edit AND the candidate must beat the baseline on VAL.

The pure gate's three actions (`gate.py:43-50`): `cand_score > current_score` → `accept` (or `accept_new_best` if it also beats best-so-far); else `reject`. The comparison metric is projected from (hard, soft) via `select_gate_score` — `hard`, `soft`, or `mixed = (1-w)*hard + w*soft` (`gate.py:24-34`); default `gate_metric="mixed"`, `w=0.5` (`config.py:44-45`). On reject, the candidate is discarded and the **returned `new_skill`/`new_memory` fall back to the unchanged originals**: `new_skill=cand_skill if accepted else skill` (`consolidate.py:232-233`).

Key safety property: the VAL slice is the gate reference and is **never polluted** — recalled/dreamed tasks only enlarge the TRAIN split (`dream.py:120-131`), and `_split` "never silently use[s] test as val" (`consolidate.py:54-58`). Splits are deterministic by stable id-hash (`mine.py:221-263`), default `val_fraction=0.34`, `test_fraction=0.0` (`config.py:35-37`).

`gate_mode="off"` (greedy, `config.py:41`) is an opt-out: edits are accepted with **no VAL scoring at all** (`consolidate.py:96-97,119-122,192-199`), `accepted = bool(all_applied)`, action `greedy_applied`. Even then nothing auto-lands without the adopt step (§3).

## 3. Propose-vs-adopt: auto-land vs human-stage

**Default is PROPOSE-and-stage; LAND is a separate, explicit, opt-in step.** The cycle *never* mutates the live `CLAUDE.md` / `SKILL.md`; `staging.py:2-7` calls this "the Dreams safety contract." The split is coded in three places:

- **Always stage** (the propose half): `write_staging(...)` writes `proposed_SKILL.md`, `proposed_CLAUDE.md`, `report.md`, `report.json`, and a `manifest.json` into `project/.skillopt-sleep/staging/<ts>/` (`staging.py:39-72`, `cycle.py:270-278`). Proposals are only populated **when accepted**: `proposed_skill = result.new_skill if (evolve_skill and result.accepted) else None` (`cycle.py:268-269`).
- **Auto-land — gated, opt-in** (the adopt half): in the cycle, adoption fires **only if BOTH** `cfg.get("auto_adopt")` **AND** `result.accepted` (`cycle.py:286-288`). The default is `auto_adopt=False` (`config.py:58`, "default: stage + require explicit `adopt`").
- **Human-stage path** (default): when `auto_adopt` is off, the CLI prints the staging dir and the instruction "review it, then: `python -m skillopt_sleep adopt`" (`__main__.py:178-180`); the report ends with the same hand-off line (`cycle.py:86`). A human then runs the separate `adopt` subcommand (`__main__.py:215-228`), which calls `adopt_staging(...)` → copies staged proposals over live files **after backing them up first** (`staging.py:81-103`, `_backup` at `staging.py:75-78`).

So the "land vs stage-for-human" decision is **not** content-type-based here (SkillOpt stages both skill and memory identically); it is **outcome+flag-gated**: auto-land requires accepted-by-gate *and* the operator pre-authorized `auto_adopt`; otherwise everything waits for a human `adopt`. Piflow's "auto-commit code vs stage judgment-edits for human" maps onto this seam — the same staging dir, with the auto-land predicate widened to a per-target policy.

## 4. Bounding the loop (epochs / count / budget / early-stop)

There is **no early-stop / patience** anywhere in the engine (grep for `early.?stop|patience|no_improve` hits only the gate docstring analogy at `gate.py:3`). Bounding is by **hard caps**, set deterministically up front:

- **Per-night work caps**: `max_tasks_per_night=40`, `max_sessions_per_night` defaults to `max_tasks*3` (`config.py:33`, `cycle.py:156-157`); `edit_budget=4` is the "textual learning rate (max edits/night)" (`config.py:43`, threaded to `backend.reflect(... edit_budget=...)`, enforced at `backend.py:247` `if len(edits) >= edit_budget`).
- **Harvest window**: first run looks back only `lookback_hours=72` (`config.py:31`, `cycle.py:149-155`); subsequent runs harvest only since `last_harvest` (`cycle.py:146`, `state.py:66-70`) so each night sees only new data.
- **Token budget**: `max_tokens_per_night=400_000` (`config.py:34`); a `Budget` controller (`budget.py:15-56`) tracks tokens/minutes and `exhausted()` (`budget.py:44-49`) "stops cleanly when exhausted" (`budget.py:5`). NOTE: `Budget`/`plan_depth` are wired into the **experiment harness** (`experiments/run_gbrain.py:173-176`), not the shipped `run_sleep_cycle` — the production night relies on the task/edit/token caps above, not on a budget object.
- **Run-count bound**: the night count is **external** — one cron firing = one night (`__main__.py:274-287` schedule; `run_sleep_cycle` runs once per invocation). `plan_depth` *can* convert a token budget into `nights` (`budget.py:71-75`, clamped 1..4) for experiments.
- **Epochs (research loop)**: `num_epochs` × `steps_per_epoch` gives a fixed `total_steps = num_epochs * steps_per_epoch` (`trainer.py:780-804`); the double `for` loop runs exactly that many steps (`trainer.py:1026,1062`), with `edit_budget` as the per-step LR ceiling (`config`/scheduler `trainer.py:821-826`). Bounded by count, not by convergence.

## 5. Rejected-edit / negative-feedback handling

Rejected edits are **first-class, surfaced, and persisted** so they aren't re-proposed:

- The per-edit gate routes losers to `all_rejected` (`consolidate.py:133`), returned as `rejected_edits` on `ConsolidationResult` (`consolidate.py:235`) and carried onto the night report (`cycle.py:257`).
- They are **written into the human report** under a dedicated heading: "Rejected by gate (kept as negative feedback)" (`cycle.py:77-80`), and printed by the CLI ("rejected by gate:", `__main__.py:173-176`) and emitted in the JSON payload (`__main__.py:62`).
- **Within an epoch (research loop), rejected edits feed back into the next proposal**: the `step_buffer` records each step's `rejected_edits` plus the score drop (`trainer.py:1548-1574`), and `_format_step_buffer(...)` renders them into the reflect/optimizer context with the explicit instruction "Use it to avoid repeating ineffective edits" (`trainer.py:534-537`), so the optimizer sees "Rejected edits (score X → Y)" listed verbatim (`trainer.py:555-574`). This is the anti-thrash mechanism.
- **Across nights**, the slow-update pass distills persistent regressions/failures into durable guidance: `_summarize_pairs` buckets outcomes into improved/regressed/persistent_fail/stable_success (`slow_update.py:83-100`) and `run_slow_update` asks the model for "regressions/persistent failures to avoid," written into a PROTECTED `<!-- SLOW_UPDATE -->` field that step-level edits never touch (`slow_update.py:103-142`, markers `slow_update.py:30-31`).
- The mined-task archive (`state.add_to_archive`, capped 300, `state.py:91-96`) lets later nights *recall* similar past tasks (`dream.recall_similar`, `dream.py:62-94`) — re-testing whether a fix still holds rather than re-proposing blind.

## 6. Two-target consolidation order + why

**Order: `evolve_skill` FIRST, then `evolve_memory` — sequentially, each independently gated.** Coded as two blocks in `consolidate()`: skill at `consolidate.py:136-178`, then memory at `consolidate.py:180-189`; docstring states "Skill and memory are evolved in sequence (skill first if both enabled)" (`consolidate.py:86`). Defaults `evolve_skill=True`, `evolve_memory=True` (`config.py:51-52`).

**Why this order matters (causal, in the code):** after the skill is (possibly) improved and gated in, the memory phase **re-runs replay under the new candidate skill before proposing memory edits** — `train_pairs2 = replay_batch(backend, train_tasks, cand_skill, cand_memory)` and recomputes failures/successes from *that* (`consolidate.py:182-184`). So memory edits are proposed against the residual failures that the improved skill did **not** already fix. Skill (the general procedure/SKILL.md) is the higher-leverage, broader surface, so it is improved first; memory (CLAUDE.md, the project-specific facts) then patches what's left. Each target carries its own `_gate_apply` against VAL, so a bad memory edit can be rejected even if the skill edit was accepted (`consolidate.py:178,189`). The two-leg skill/memory split mirrors piflow's self/history vs world/code memory legs.

## 7. Deterministic-driver vs model-stage split

The architecture cleanly separates a **deterministic control plane** from **model-driven worker stages**:

- **DETERMINISTIC DRIVER (no LLM):** the stage sequencing (`run_sleep_cycle`, `cycle.py:90`); night counting and `last_harvest` bookkeeping (`state.py`); split assignment by id-hash (`mine.py:221-263`); the **gate decision itself** — `evaluate_gate`/`select_gate_score` are pure arithmetic comparisons, "the pure decision function," side-effect-free (`gate.py:37-50`, `skillopt/evaluation/gate.py:8-9`); edit application (`apply_edits`); staging/adopt file I/O with backup (`staging.py`); all caps/budget accounting (`config.py`, `budget.py`). The accept/reject *predicate* lives in deterministic code, fed by model-produced *scores*.
- **MODEL STAGES (LLM via the `backend` abstraction):** task mining from transcripts (`llm_miner`, `cycle.py:178-185`); reflect → bounded edit proposal (`backend.reflect(...)`, `consolidate.py:174-177,185-188`); replay/scoring of candidate docs on tasks (`replay_batch`, used as the gate's measurement, `consolidate.py:99,126,203`); the cross-night slow-update synthesis (`run_slow_update`, `slow_update.py:134`). The backend is swappable (`mock|claude|codex|copilot`, `config.py:39`) without touching the driver.

The load-bearing design rule: **the model proposes and scores; deterministic code decides, bounds, and lands.** The LLM never controls the loop, never decides accept/reject, and never writes the live file directly — it only emits candidate edits and numeric scores that the deterministic gate + caps + staging seam adjudicate.
