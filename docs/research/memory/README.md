# Memory & self-correction — research home + build index

> Created 2026-06-28; built out 2026-06-29 into a **build-ready corpus**. This folder is the design +
> evidence for piflow's **memory / self-correction (optimization) layer** — the piece the SDK migration
> left behind. Cite `file:line`; reference, don't duplicate. **`piflow-memory-v1.5.md` is the CURRENT
> spec.** We build the layer AND validate it on **game-omni** simultaneously, so we never drift from the
> end goal (a loop that measurably improves game-omni's pipeline across runs).

## ▶ START HERE (to build)
1. **`piflow-memory-v1.5.md` §6** — the autonomous-loop OVERLORD (deterministic driver; the four SOTA additions).
2. **`piflow-memory-v1.5.md` §7** — the FIRST BUILD: the out-of-band Score + Triage pass (spec shape).
3. **`game-omni-verify-extraction-2026-06-29.md`** — the Tier-1 scorer is game-omni's standalone model-free
   `verify-milestone` CLI (`runMilestoneVerify2`, `harness.ts:533`); the ABSTAIN rule.
4. **`game-omni-quality-assets-and-sdk-gap-2026-06-29.md`** — the assets the loop consumes + the per-asset gap.
The rest is evidence/grounding behind those four.

## The design (the spec)
- **`piflow-memory-v1.md`** — v1: the SUBSTRATE. The `hermes-skill-system` method on a DAG of `pi` nodes; two
  legs (self/history `memory.md` + world/code `code-map.md`); scope = the node's contract; the §7
  triage→fixer→reconcile meta-DAG; the §2 scaffold slice (SHIPPED). *Header points forward to v1.5.*
- **`piflow-memory-v1.5.md`** — **CURRENT.** The FOUR-way triage (§3); the two gates (§2 — within-run quality
  gate HAVE vs across-run optimization gate NEW); the research-grounded 4-tier SCORING CASCADE (§4); the
  autonomous-loop OVERLORD + the four SOTA additions (§6); the first-build Score+Triage spec (§7).

## The eval research (the scoring-cascade evidence — mechanism-cited)
- **`eval-llm-judge-reliability-2026-06.md`** — judge reliability + the false-confidence toolbox: outcome-gated
  accept, rubric decomposition, abstain-on-low-confidence; ~59% of judge errors are confidently wrong.
- **`eval-trajectory-process-scoring-2026-06.md`** — telemetry = a diagnostic + a deterministic disqualifier,
  NOT a quality score; "more time" is non-monotonic.
- **`eval-visual-perceptual-quality-2026-06.md`** — VLM-as-judge for visuals: pairwise-vs-golden,
  position-swap abstention; trustable only as a ranker.
- **`eval-codex-goalmode-loop-patterns-2026-06.md`** — Codex `/goal` + 2026 loop patterns; the gap-check that
  produced v1.5 §6's four additions (early-stop · Pareto multi-candidate · RAIL breaker · ACE delta memory).

## External prior art (the loop reference)
- **`vendor-skillopt-mastra-2026-06-29.md`** — Microsoft **SkillOpt** (DL-over-skills loop + held-out gate +
  the SKILL_DEFECT/EXECUTION_LAPSE classifier) vs **Mastra** (memory continuity, zero self-optimization).
- **`skillopt-sleep-loop-control-2026-06-29.md`** — SkillOpt's `skillopt_sleep` control structure = the
  overlord reference (deterministic driver · gate on a candidate copy · stage→adopt · bound by caps).

## The SDK gap (what the runner emits today)
- **`gap-analysis-optimizer-substrate-2026-06-29.md`** — code-grounded: Tier-0 telemetry ~built (`observe/`),
  Tier-1 binary, the replay harness + a scalar + the triage projector are the gaps; the prioritized build list.

## The dogfood target — game-omni (build AND validate here)
- **`game-omni-sdk-wiring-2026-06-29.md`** — how game-omni is wired to the SDK (16-node DAG, the contract ×
  SDK-feature matrix, the run-scoped MEMORY practice vs v1.5 Leg-A).
- **`game-omni-quality-assets-and-sdk-gap-2026-06-29.md`** — the criteria fixture (all nodes), eval
  prompt-suites, the live codegraph/OKF; the NODE×OUTPUT×tier matrix; the per-asset SDK gap.
- **`game-omni-verify-extraction-2026-06-29.md`** — verify's checks are Tier-1-dominant + VERIFY-2's measure is
  ALREADY a standalone model-free CLI; the ABSTAIN rule; dropping the gate in dogfood is clean.
- **`game-omni-presdk-era-2026-06-29.md`** — what the SDK migration LOST (the self-improvement loop) + the
  proven output shapes (`hermes-routing.md`, OKF `_lesson:_`) + the concrete dogfood success test.

## The prior harvest (provenance)
- **`harvested-practices.md`** — the Hermes / RondoFlow / ADK memory harvest + the seven-dimension matrix +
  distilled lessons (the framing this corpus grew from).

## Framing this corpus assumes (the four-memory taxonomy)
There is no single "memory": **episodic** (run/git, queried) · **semantic** (curated, injected) ·
**procedural** (skills — the self-improvement substrate, progressively disclosed) · **user model**. Keep them
separate with distinct capture/recall policies. Honesty rule: cite code, not marketing; where a README claim
has no code behind it, say so. The canonical METHOD is the global `hermes-skill-system` skill — this folder is
piflow's APPLICATION of it, not a second copy (law 5: reference, don't duplicate).

## Sources (vendored, `.gitignore`d under `vendor/`)
`vendor/SkillOpt` (the optimization-loop prior art) · `vendor/mastra` · `vendor/hermes-agent` · `vendor/rondoflow`
· `vendor/adk-python`. The dogfood target is the separate product repo `~/Desktop/game-omni`.
