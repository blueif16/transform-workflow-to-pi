# Lifting game-omni's verify checks into an out-of-band scorer (2026-06-29)

## 0. Method + files read

Read-only audit of game-omni's two VERIFY nodes — their wiring prompts, their loaded SKILLs, the
harness that actually executes the checks, the report schema, and the profile mechanism that elides
them. Every claim cites a real `path:line`. I edited nothing in game-omni; the only artifact written
is this doc. The question grounded here is from the design lens
(`docs/research/memory/piflow-memory-v1.5.md` §4d Tier-0/1/2/3 cascade;
`…/game-omni-quality-assets-and-sdk-gap-2026-06-29.md` §5 matrix): can verify's **MEASURE** half be
lifted into a pure out-of-band scorer, separate from its in-DAG **STABILIZE+GATE** half?

Files read in full (game-omni root `/Users/tk/Desktop/game-omni`):
- Nodes: `.piflow/game-omni/template/nodes/verify-1-design/{prompt.md,node.json}`,
  `…/verify-2-m1/{prompt.md,node.json}`, `…/verify-2-m2/prompt.md`, `…/verify-2-m3/prompt.md`
  (m2/m3 prompts are byte-identical to m1 modulo the milestone id `M1`→`M2`/`M3`).
- Skills: `packages/skills/verify-design/SKILL.md` (VERIFY-1),
  `packages/skills/verify/SKILL.md` (VERIFY-2), `packages/skills/verify/report.schema.json`,
  `packages/skills/verify/perturbation-grammar.md` (§1–§3 read).
- The harness (the code that runs the checks): `packages/verify/bin/verify-milestone.ts`,
  `packages/verify/src/{harness.ts,compile.ts,completability.ts,invariants.ts,perturbation.ts,marker.ts}`.
- Profile/elision mechanism (piflow SDK + game-omni `meta.json`) — via a delegated subagent sweep,
  citations inline in §4.

---

## 1. What each verify node checks (enumerated, Tier-1 deterministic vs Tier-2 judgment)

### VERIFY-1 (DESIGN) — `verify-design/SKILL.md` §1, mirrored in `verify-1-design/prompt.md:12-21`

Runs BEFORE any code exists; reasons **statically** over `spec/blueprint.json` (HARDEN's frozen
design). Nine criteria, judged "in order" (`SKILL.md:84`); criteria 1–6 are the **hard gate**
(`SKILL.md:132`):

| # | Check (re-derive, never trust the producer's word) | Tier |
|---|---|---|
| C1 | **EARNED-BY-MATH** — re-run kinematic feasibility from `feasibility.checks[].numbersUsed`; comparison must hold (gap ≤ d_max, rise ≤ h_max, window > dwell, BFS path ≤ maxMoves, wave survivable). Empty/decorative `numbersUsed` = FAIL (`SKILL.md:88-92`, math per archetype `SKILL.md:167-188`) | **Tier-1** (arithmetic over recorded numbers — no model) |
| C2 | **REAL DECISION / NO UNDESIRABLE SOLUTION** — `coupling[]` must show a threat region on EVERY path to each reward/goal; a threat-free path (BFS-avoid / geodesic) = FAIL (`SKILL.md:93-96`, `192-206`) | **Tier-1** ("statically decidable on the coordinates", `SKILL.md:93`) |
| C3 | **WINNABLE + ENGAGES** — `referenceSolution` reaches the win observable AND engages every threat; re-check `engagesEveryThreat` against the steps (`SKILL.md:98-99`) | **Tier-1** (reachability over the recorded sequence) |
| C4 | **SUBSTANTIAL-LEVEL FLOOR** — ≥3 distinct contested decisions, path beyond one screen, later beats measurably harder (the numbers show it), earned climax; thin one-threat crossing = FAIL "too simple" (`SKILL.md:100-104`, `139-154`) | **mostly Tier-1** (the SKILL insists these are "RELATIONS you check on the numbers, never a genre constant", `SKILL.md:104`) — but "rich/earned" carries a judgment residue |
| C5 | **COMPLETE + NO DANGLING BINDING** — every behavior/effect/control/config id + `{ref}` + `$custom` resolves in `capabilities.json` of the right kind/roles; every referenced spatial element declared in-bounds; every primary visible kind has an asset slot; assertion-vocab tokens on-roster (`SKILL.md:105-115`, `210-240`) | **Tier-1** (a static fact-check against an immutable catalog; "decidable", `SKILL.md:105`) |
| C6 | **SCORE bounded/idempotent/coherent** — `maxScore == Σ rewards`, no respawn→re-credit, gate ≤ maxScore; when `none`, no vestigial counter (`SKILL.md:116-119`, `246-253`) | **Tier-1** ("decidable on the numbers") |
| C7 | **STATUS-MODEL COHERENCE** — `won`/`lost` terminal; recoverable respawn stays `playing`; no catch→lost + respawn→playing for one mechanic (`SKILL.md:120-123`, `255-261`) | **Tier-1** (decidable; conforms to the immutable `isLegalStatusTransition` invariant) |
| C8 | **RANGES SAFE** — every `declaredRanges` band keeps C1 feasibility + C2 threat-on-path true at BOTH endpoints (`SKILL.md:124-126`, `263-267`) | **Tier-1** (plug each endpoint into the math) |
| C9 | **FANTASY · PACING/ONBOARDING · PILLAR** — does the loop deliver `coreFantasy`; teach→test→twist; every mechanic serves the loop (`SKILL.md:127-130`, `271-288`) | **Tier-2/Tier-3** — explicitly "design judgments… not pure math" recorded for the human steward; "the human is the eye for is-it-fun/tense" (`SKILL.md:287`) |

**VERIFY-1 split: C1–C8 are Tier-1 deterministic (the hard gate is entirely Tier-1); only C9 is
Tier-2/3** and by contract does *not* itself fail the design — it is "recorded so the human can
sharpen the criteria" (`SKILL.md:286-288`), the residual surfaced to the eye.

### VERIFY-2 (IMPLEMENTATION QA) — `verify/SKILL.md` §2–§6; executed by `packages/verify/`

Runs AFTER W4 built the milestone; boots the real game headless and drives it. Six gates
(`SKILL.md:86-94`), each implemented as model-free TypeScript in the harness:

| Gate | Check | Implemented in | Tier |
|---|---|---|---|
| G1 BUILD-HEALTH | boot headless, reach `__GAME__.ready` (never sleep), no console error, canvas-not-blank (`SKILL.md:124-144`) | `harness.ts:214-280` (`boot`), advisory canvas `vlm.ts` | **Tier-1** (deterministic) |
| G2 USER-FLOW FIDELITY | each blueprint mechanism as Given/When/Then; place a known precondition via `commands.{reset,setState}`, fire the input, read the comparator off `__GAME__` (`SKILL.md:147-186`) | `compile.ts:558` (`executeAssertion`) → `observe.ts` comparators; driven at `harness.ts:616-654` | **Tier-1** (compiles a declarative assertion; "assert OBSERVABLE state only") |
| G3 COMPLETABILITY | replay `blueprint.referenceSolution` step-by-step through real input; assert interim observables + the win, never via setState (`SKILL.md:189-221`) | `completability.ts:51` (`runCompletability`); scoped to the terminal milestone `harness.ts:671,879` | **Tier-1** (real-play replay + observable reads) |
| G4 INVARIANTS | sample the trace; monotonicity, bounds, no-softlock, status-legality, no-side-effect, structural (`SKILL.md:224-251`) | `invariants.ts:54-346` (`InvariantSampler.evaluate`) | **Tier-1** (relations over the sampled trace) |
| G5 ISOMORPHIC PERTURBATION | re-run the originally-passing checks + completability with `declaredRanges` parameters permuted in-envelope; a faithful build is invariant, a contorted one diverges (`SKILL.md:253-302`) | `perturbation.ts:111` (`runPerturbation`), deterministic FNV-1a draw, no `Math.random` | **Tier-1** (the load-bearing anti-gaming gate, fully deterministic) |
| G6 verdict-correctness self-guard | confirm a FAILED is the build's not the test's (precondition actually placed; permutation stayed in-band) (`SKILL.md:465-487`) | partly in harness (`detectDesignEscalation` `harness.ts:899`; perturbation-error swallow `harness.ts:713-719`); partly agent reasoning | **mostly Tier-1**, a thin judgment edge |
| (advisory) VLM | end-state screenshot → coarse `looks_right/off/inconclusive` | `vlm.ts` (`runAdvisoryVlm`) | **Tier-2 but NON-BLOCKING** — "NEVER blocks the marker" (`SKILL.md:451-461`, schema `report.schema.json:86-97`) |

**VERIFY-2 split: G1–G6 (the marker-deciding gates) are 100% Tier-1 deterministic** — they read
real `__GAME__` state through model-free TS. There is, by design, **no quality rubric in this node at
all** (`SKILL.md:48`); the one Tier-2 signal (the VLM) is explicitly advisory and never enters the
verdict (`harness.ts:726` runs it, but `passed` at `harness.ts:750-756` ignores it).

---

## 2. report.M&lt;n&gt;.json — production + schema

**Produced by the harness, not the model.** The agent invokes the CLI
`verify-milestone <projectDir> <milestoneId>` (`bin/verify-milestone.ts:5,46-71`). The CLI reads
`spec/blueprint.json` (`readBlueprint`, `bin:63`), selects the milestone, and calls
`runMilestoneVerify2` (`bin:94`), which runs all six gates and writes the report via `buildReport` +
`writeReport` (`harness.ts:777-796`). The harness "does NOT edit files, does NOT contain the self-fix
loop" (`harness.ts:10-12`); it always exits 0 — "the marker is the signal, not the exit code"
(`bin:19-21,118`).

**Schema** = `packages/skills/verify/report.schema.json` (additive extension of the original W5
shape). Required: `milestoneId, marker, passed, summary, assertions, buildHealth, fixCycles,
advisoryVlm, screenshots, startedAt` (`:8`). The VERIFY-2 gate fields are OPTIONAL additions but
non-optional on a real run:
- `assertions[]` / `fidelity[]` — per-mechanism `{id, describe, observe, comparator, expected,
  observed, status}` (`:29-49`, `:107-127`); built at `harness.ts:642-653`.
- `completability{ran, reachedWin, interimObservables[], status}` (`:128-141`).
- `invariants[]{name, kind, held, evidence}` (`:142-156`).
- `perturbation{ran, permutationSeed, permutationsApplied[], invariant, diverged[]}` (`:157-197`);
  `invariant===false` forces marker FAILED.
- `escalation?{milestoneId, kind:'design-defect', evidence, note}` (`:198-217`) — present iff a
  design defect routes upstream.
- `fixCycles` (0–3), `fixEdits[]`, `fixOutcome`, `regression{}` — the **STABILIZE trail**, written
  only when the agent edited `src/**`.

VERIFY-1's analogue is `spec/DESIGN_REVIEW.md` (prose math-trail) plus the structured return
`{result, rubric, reasons, stabilizedEdits}` (`verify-1-design/node.json:47-57`) — no JSON report
schema, because there is no harness; VERIFY-1's measurement is the model re-deriving math.

---

## 3. Measure vs stabilize+gate — are they separable?

**Verdict: in VERIFY-2 they are ALREADY mechanically separated; in VERIFY-1 they are entangled in
one model turn but cleanly delineated in prose.**

**VERIFY-2 — already separated (the strong case).** The MEASURE is the harness, a pure
exit-0 CLI that takes the raw build + the blueprint and emits the verdict + report
(`bin:74-118`, `harness.ts:533-812`). The STABILIZE loop is **not in the harness at all** — it is the
agent (SKILL §7, `SKILL.md:331-356`) re-invoking the CLI after each `src/**` edit. The harness's only
participation in the fix loop is the structural ≤3 counter (`harness.ts:335-368`, `fixcycles.ts`),
which **only STOPS** the loop (refuses the 4th boot) — it never fixes and never fakes a pass
(`harness.ts:343-344`). So measuring the RAW producer output is literally "run the harness once and
read the marker/report, then ignore the agent's fix step." The measure code (`executeAssertion`,
`runCompletability`, `InvariantSampler.evaluate`, `runPerturbation`) is model-free, archetype-general
TS that only READS `__GAME__` and never writes it (`compile.ts:6-8`, `invariants.ts:25-26`,
`perturbation.ts:15-19`). **This is a clean lift: the scorer is the harness minus the agent.**

**VERIFY-1 — entangled in one turn, but the boundary is explicit.** Both halves live inside one
`agent()` call (`SKILL.md:296-316,420-427`): the same model re-derives the math AND, on a small
fixable number, applies a STRENGTHENING edit to `blueprint.json` (raise a number, re-place a threat,
tighten a range) then re-derives. There is no harness to peel off. BUT the measure logic is fully
specified as deterministic arithmetic (§3/§4/§6 of the SKILL), and the stabilize action is a tightly
scoped, monotone-only edit that the prose forbids from ever weakening the bar
(`SKILL.md:309-310,374`). To lift VERIFY-1's MEASURE you re-run criteria C1–C8 over the RAW (unedited)
`blueprint.json` and emit the rubric verdict **without** the stabilize edit — i.e. drop the
`WHILE … stabilize < 2` body (`SKILL.md:300-311`) and keep the re-derivation. The arithmetic is
implementable as deterministic code (it is exactly the math the harness's `perturbation`/`feasibility`
already encode product-side), but today it lives in model prose, so lifting VERIFY-1 means
**re-implementing the measure as code (or running the same model with the stabilize branch removed)**,
whereas VERIFY-2's measure is **already** code.

The clean line in both: **MEASURE = re-derive/observe and compare to the immutable oracle;
STABILIZE = a monotone, anti-reward-hack edit (blueprint number for V1, `src/**` for V2) that the
oracle is structurally outside of.** The anti-reward-hack invariants make the boundary sharp: the fix
NEVER touches the blueprint/assertions/`__GAME__` hook/harness/grammar (`SKILL.md:364-370`,
`verify/node.json` owns `src/**`+`verify/**`+`MEMORY.md` only) — so removing the fix never changes
what MEASURE computes.

---

## 4. The profile mechanism + what dropping the gate loses

**The mechanism is generic phase-elision, and dropping the gate is clean.** `--profile` is parsed at
`packages/cli/src/run.ts:193` (piflow worktree); the value is resolved by the SDK's
`resolveProfile`/`applyProfileByName` (`packages/core/src/workflow/profile.ts:43-51,133-135`), called
on the live run path BEFORE compile (`runner/entry.ts:102,169`) and in the CLI dry-run
(`run.ts:429`). The only predicate a profile supports is `elidePhases: string[]`
(`packages/core/src/types.ts:944-947`); `elidedLabels` selects nodes purely by the node's `phase`
field (`profile.ts:59-66`). game-omni declares it as DATA:
`.piflow/game-omni/template/meta.json:15-19` →
`"companion": { "elidePhases": ["verify-1", "verify-2"] }`, default `production` (a no-op `{}`).

**Exactly the four verify nodes are elided** (their `phase` is `verify-1`/`verify-2`;
`verify-1-design/node.json:3`, the three `verify-2-m*/node.json` `phase:"verify-2"`); no other node
carries those phases.

**The elision is clean — no orphaned edge.** `applyProfile` (`profile.ts:95-127`) doesn't just drop
the node; it **transitively rewires** each survivor's deps via `bypass` (`profile.ts:73-87`), so a
dep on an elided node is replaced by that node's own deps. The graph: `w2-scaffold` deps
`[verify-1-design]` → rewires to `[shell,guidance,asset,sound,model]`; `w4-execute-m2` deps
`[verify-2-m1]` → `[w4-execute-m1]`; `w4-execute-m3` deps `[verify-2-m2]` → `[w4-execute-m2]`;
`verify-2-m3` is terminal (nothing depends on it). **No downstream node reads a verify ARTIFACT as
input** — the verify deps are pure ORDERING (a gate between a producer and the next consumer). This
confirms the verify-node law: "removing this node entirely must still leave a buildable blueprint…
a verify node is never load-bearing" (`verify-1-design/prompt.md:24`; `verify-design/SKILL.md:32-33`).
The blueprint is HARDEN's (`spec/blueprint.json`); verify-1 only emits `spec/DESIGN_REVIEW.md`
(review output) and at most a strengthen-edit.

**What dropping the gate LOSES (exactly):** (a) the within-run **STABILIZE** — VERIFY-1's bounded
blueprint strengthen-edit (`SKILL.md:292-316`) and VERIFY-2's ≤3-cycle `src/**` self-fix
(`SKILL.md:331-356`) that *repairs the producer's output in-run* — which is precisely the masking the
optimizer must avoid; (b) the in-DAG **PASSED/FAILED verdict + routing** (verify-2's
`op[].rerouteTo w4-execute-m1` on failure, `verify-2-m1/node.json:7-17`; verify-1's `DESIGN_FAILED`
back to W1/Harden); (c) the **design escalation** channel (`detectDesignEscalation`,
`harness.ts:899-922`). It does **NOT** lose the MEASURE capability — the harness CLI and the
re-derivation logic are still runnable against the raw artifacts. That asymmetry is the whole basis
for the scorer: companion-mode drops fix+gate but the measure survives as a standalone tool.

---

## 5. Verdict — liftability + the measure/fix boundary

**The check logic is liftable — PARTIAL by node, and the split is favorable.**

- **VERIFY-2 is fully and immediately liftable.** Its MEASURE is *already* an out-of-band, model-free,
  exit-0 CLI (`bin/verify-milestone.ts` → `runMilestoneVerify2`) that consumes the RAW build +
  frozen blueprint and emits the verdict marker + the structured `report.M<n>.json`. To use it as a
  Tier-1 scorer against the un-stabilized producer output you run the harness once and read the
  report; you do **not** run the agent's §7 fix loop. The six marker-deciding gates are 100%
  deterministic (`compile.ts`, `completability.ts`, `invariants.ts`, `perturbation.ts`), and the
  perturbation gate (G5) is the load-bearing anti-gaming signal that already keys on the
  declared-range envelope. This maps 1:1 onto v1.5 Tier-1 (outcome-checkable, the gate signal).

- **VERIFY-1 is liftable in principle but needs re-homing.** Its measure (C1–C8, the hard gate) is
  fully deterministic arithmetic, but today it executes inside one model turn fused with the
  stabilize edit. Lifting = run the same re-derivation over the RAW blueprint with the
  `WHILE stabilize<2` branch removed (or re-implement the kinematics/BFS/score proofs as code, which
  the harness's feasibility/perturbation logic shows is feasible product-side).

**The measure/fix boundary** is the same in both nodes and is sharp because of the anti-reward-hack
invariants: MEASURE = re-derive (V1) or observe-and-compare (V2) against an **immutable oracle**;
STABILIZE = a **monotone-only** edit whose blast radius (V1: a blueprint number that only strengthens;
V2: `src/**` game code) **structurally excludes** that oracle (`verify/SKILL.md:364-370`;
`verify-design/SKILL.md:309-310,374`). Because the oracle is outside the fix set, deleting the fix
never perturbs the measurement — which is exactly why a pure scorer can re-use the measure half
verbatim.

**Irreducibly Tier-2 (the residual that does NOT lift):** VERIFY-1 C9 (fantasy / pacing / pillar /
"reads tense / fun") — explicitly a human-eye judgment recorded for the steward, never a gate
(`verify-design/SKILL.md:286-288`); and VERIFY-2's advisory VLM screenshot verdict (non-blocking,
`verify/SKILL.md:451-461`). Everything that *decides a marker today* is Tier-1; the Tier-2 fraction is
small and is already quarantined out of the verdict — consistent with v1.5 §4c
(outcome-gated accept; the visual/aesthetic residual abstains to the human).

---

## Brief (return)

**Is the check logic cleanly liftable? Yes for VERIFY-2, partial for VERIFY-1 — and the split is
favorable.** VERIFY-2's MEASURE is *already* an out-of-band, model-free CLI
(`verify-milestone` → `runMilestoneVerify2`, `harness.ts:533`) that consumes the raw build + frozen
blueprint and emits a verdict + `report.M<n>.json`; the harness explicitly "does NOT contain the
self-fix loop" (`harness.ts:10-12`) and exits 0. The STABILIZE half is the AGENT (SKILL §7) re-invoking
that CLI after `src/**` edits; the harness only owns the ≤3 *stop* counter. So lifting VERIFY-2 is
"run the harness, ignore the agent." VERIFY-1's measure (C1–C8 deterministic math) is fused with its
blueprint strengthen-edit inside one model turn, so lifting it means re-running the re-derivation with
the `stabilize<2` branch removed (or coding the arithmetic).

**Tier-1 vs Tier-2 split of what verify measures.** Everything that decides a marker is **Tier-1
deterministic**: VERIFY-1's hard gate C1–C8 (kinematic feasibility, threat-on-path BFS/geodesic,
substantial-floor relations, dangling-reference fact-check, score/status/range proofs — "decidable on
the numbers") and VERIFY-2's six gates (build-health, fidelity comparators over `__GAME__`,
reference-solution replay, trace invariants, isomorphic perturbation — pure model-free TS reads). The
**Tier-2/3 residual is small and already quarantined out of the verdict**: VERIFY-1 C9
(fantasy/pacing/pillar, surfaced to the human eye, never a gate) and VERIFY-2's advisory VLM
(non-blocking by contract). This matches v1.5 §4c: outcome-gated, judge-assisted, human-for-the-eye.

**Single biggest risk in scoring the RAW (un-stabilized) output.** The perturbation gate (G5) — the
load-bearing anti-gaming signal — depends on `blueprint.declaredRanges`. If that envelope is
missing/empty the harness reports `perturbation.ran=false` and the run is INCOMPLETE / escalated
(`perturbation.ts:119-121`, `harness.ts:736,768-771`), not scored. So a raw scorer can mistake a
VERIFY-1 *contract gap* (no ranges) for a build verdict. And the completability gate is in scope only
on the TERMINAL milestone (`harness.ts:671,879`) — scoring a non-terminal raw slice must not penalize
the missing whole-game win path. The scorer must therefore treat "measure couldn't run" (missing
ranges / non-terminal / boot-failed) as a distinct *abstain*, never as a low score.
