# game-omni quality assets → piflow v1.5 cascade + the SDK gap (2026-06-29)

## 0. Method + files read

Read-only inventory of the QUALITY/EVAL lane of the canonical product
`/Users/tk/Desktop/game-omni` (the prompt-to-game engine practicing the piflow SDK), mapped onto
the v1.5 scoring cascade. Every claim cites a real path / `file:line`. I edited nothing in
game-omni; the only artifact written is this doc. I own the quality/eval lane; the DAG-wiring /
runtime sibling owns `workflow.json` + the runner — I name a node's OUTPUT only to anchor a bar.

**Correction confirmed.** The prior SDK-only audit
(`gap-analysis-optimizer-substrate-2026-06-29.md:128`) concluded "golden samples and per-node
criteria fixtures … exist as ZERO committed files." That is true **of the SDK repo** and **false
of the product**: game-omni HAS them, product-side, exactly where the data boundary
(`CLAUDE.md` "Per-product / per-repo data lives IN that product/repo") puts them. This doc
inventories them; it does not relitigate their existence.

Design lens (piflow worktree, read first, in order):
- `docs/research/memory/piflow-memory-v1.5.md` — the four-tier cascade (§4d: Tier-0 trace gates /
  Tier-1 outcome-checkable / Tier-2 pairwise-vs-golden+rubric+separate-critic / Tier-3
  abstain→human), the four-way triage (§3), the two gates (§2).
- `docs/research/memory/gap-analysis-optimizer-substrate-2026-06-29.md` — what the SDK scores today
  (Tier-0 ~built, Tier-1 binary, Tier-2 a partial judge-node, golden+criteria absent in SDK).
- `docs/research/memory/eval-llm-judge-reliability-2026-06.md` — outcome-gated-accept · judge-assisted
  reflection · NEVER judge-gated accept; pairwise-vs-golden + rubric + separate critic + swap-abstain.
- `docs/research/memory/eval-visual-perceptual-quality-2026-06.md` — VLM as position-swapped pairwise
  ranker on rubric-decomposed, deterministically-groundable judgments with an abstention gate.

game-omni assets read:
- `.agents/skill-system-criteria.md` (426 lines — the criteria fixture; read in full across pages)
  + its OKF reference card `.agents/okf/references/criteria.md`.
- `.agents/okf/index.md`, `okf.config.json`, `log.md`, and invariants
  `three-immutable-oracles.md` / `anti-reward-hack.md` / `verify-node-law.md` (via index) /
  `generalize-or-dont-ship.md` (via index); subsystem `verify-harness.md`.
- `.agents/node-catalog.json` (the drift-gated chrome node-contract seed + the observable palette).
- `eval/README.md`, `eval/prompt-suite.json` (+ 6 per-genre siblings by listing),
  `eval/gold/platformer/{GOLD-NOTE.md,mecha-plumber.blueprint.json}`.
- `.codegraph/{codegraph.db,daemon.log,.gitignore}`, `.mcp.json`.

---

## 1. The criteria fixture (structure, coverage, form, injected-or-not)

**File:** `.agents/skill-system-criteria.md` (426 lines), titled "game-omni — per-node
output-criteria fixture." Its self-description (`:1-2`): "_The human-judged QUALITY bar a Hermes
node-validation loop judges each node's artifact against (the complement to the mechanical Output
Contract: the contract checks the artifact EXISTS, these criteria say whether it is GOOD)._" Its OKF
card restates the same (`.agents/okf/references/criteria.md:14-15`).

**Structure.** One block per node, four sub-headers each: **Artifact · Purpose · Acceptance
criteria · Red flags** (`criteria.md` OKF card `:17-18`). The fixture covers the **full 9-node
win-lose spine plus the parallel/3D producers**: W0 Classify (`:4`), W1 Spec (`:25`), Harden (`:55`),
VERIFY-1 Design (`:82`), W2 Scaffold (`:106`), W3a Art Direction (`:130`), W3b Assets (`:149`), W4
Execute (`:168`), VERIFY-2 QA (`:189`); plus the v1.6 chrome producers Guidance (`:206`), Shell
(`:227`), Sound (`:248`), and the 3D-only Model retrieval (`:268`); then an additive
**voxel / open-ended-sandbox** block re-deriving W1/Harden/W2/W4/VERIFY-2 bars
(`:288-` onward), and an `action_3d` block at the tail (referenced `:1`). So **all 9 core nodes are
covered, plus 4 extra producer lanes** — coverage is complete and then some.

**Form of each bar.** The bar is overwhelmingly a **rubric of observable checkable predicates** —
acceptance criteria phrased as countable RELATIONS, never genre constants. Three sub-forms:
- **Checkable outcomes** (Tier-1-shaped): "the file is strict-valid JSON against
  classification.schema.json" (W0, `:16`); "≥3 DISTINCT escalating challenge beats on the critical
  path" + "later beats measurably harder than the teach" (W1, `:38`); "ground vs background ≥ **1.5
  WCAG relative-luminance contrast** … the gen post-hook recomputes it and HALTs below it (exit 6)"
  (W3a, `:139` — a *measured, deterministic* visual floor); "perturbation.invariant===true"
  (VERIFY-2, `:193`).
- **Rubric-judgments** (Tier-2-shaped, an eye/blind-judge call): "the residual SUBJECTIVE calls
  surfaced for the human eye (reads-tense / fantasy-strong-enough)" (VERIFY-1, `:93`); "BEST MATCH —
  each pick is the best fit for its moment" (Sound, `:254`); "a building-INVITING starting world"
  (voxel W1, `:298`).
- **Prose purpose** framing why the bar exists (each block's _Purpose_ line).

**Injected or kept as the law?** **Kept as the JUDGING fixture — never injected into a producing
node.** The header is explicit (`:2`): "**NEVER injected into a producing node's prompt** — that
would teach-to-the-test and void the clean-room signal." The OKF card repeats it (`criteria.md:15`):
"read by the EYE (a human, or an independent blind judge subagent) to judge a run, never by the
producer." This is exactly v1.5's separate-critic discipline (§4b.2) made an architectural law: the
fixture is the *oracle side*; the craft lives in the producer's SKILL, "never the same prose in both"
(`criteria.md:22`).

**Reward-hack flags I found in the bars themselves.** The fixture is deliberately written to be
*non-gameable*: it repeatedly forbids asserting intent over observable output. W1 red-flag: "A
milestone assertion is not OBSERVABLE over window.__GAME__ (e.g. 'jump() was called') … uses an
input.key absent from controls[] … reward-hackable, flaky" (`:45`); W4 red-flag: "Reward-hacking the
hook: code that makes __GAME__ report a value the real state lacks, an overlap tuned to the harness's
DRIVE_OVERLAP_PX rather than the blueprint distance" (`:182`); VERIFY-2 red-flag: "Faked pass via
injection: a precondition setState writes the very field under test (setState({score:4}) then asserts
door->'won')" (`:202`). These are the home-grown statements of the cascade's "checkable outcome, not a
claim of intent" principle.

---

## 2. Golden samples + eval prompt-suites (what they are, mapped to held-out replay)

**Two distinct asset classes live under `eval/`, and they are NOT the same thing.**

**(a) The golden — one, platformer only.** `eval/gold/platformer/mecha-plumber.blueprint.json` is a
**hand-authored golden BLUEPRINT** (a complete frozen Harden-output: layout geometry, bindings,
feasibility math, referenceSolution, milestone assertions). Its note (`GOLD-NOTE.md:5-7`) calls it
"the round-1 platformer **gold**: 'what we think a great blueprint looks like' … **Track A is judged
against it; Track B consumes it.**" The thesis it tests (`GOLD-NOTE.md:11-12`): "If Track B works, the
blueprint IS the game." It carries its own certification checklist (`GOLD-NOTE.md:79-92`: self-
sufficient · every `{ref}` resolves · winnable+fair with the feasibility math · doctrine-aligned), and
its human-certification box is **still unchecked** (`GOLD-NOTE.md:91` `[ ] Human certification —
pending`). **This is the ONLY golden in the repo:** `find eval/gold` returns exactly
`eval/gold/platformer/` and two files; `grep -rln GOLD eval/` hits only the platformer blueprint. The
6 other live archetypes have NO golden.

**(b) The eval prompt-suites — held-out INPUT banks, 7 of them, NOT goldens.** `eval/prompt-suite.json`
(+ `-topdown/-voxel/-paddle/-shooter/-runner/-grid`) are "the fixed, **growing** bank of real-world
user prompts we run the whole `game-omni` pipeline against" (`eval/README.md:7-8`). Each row is "**one
INPUT** (what an actual user would type) and its **OUTPUT trail**" (`README.md:9-11`). Row shape
(confirmed by parse): `id · prompt · voice · expectedArchetype · expectedScoringModel · themeTags ·
tests · status · runs[]` — and each `runs[]` record stamps `flowCommit · piModel · nodeReached ·
verdict · humanEyed · notes` (`prompt-suite.json:23-32`). The defining rule is **scenario-only**: "a
prompt describes a **scenario, never a spec**. No numbers, no tuning … are the **model's** job"
(`README.md:64-67`) — i.e. the prompts pin only the held-out *task* + its *expected classification*,
not a target artifact. Coverage is engineered as a stress matrix: each genre file documents what each
prompt stresses (e.g. P04 "**two** distinct hazards on the path", P06 "minimal prompt → must elaborate
to a rich level", P10 scope-discipline; `README.md:84-96`), and every non-platformer bank is run "in
**companion mode**" (`README.md:33` et al.).

**Map to v1.5 held-out replay (§5.1) + the tiers.**
- The prompt-suites ARE piflow's missing **held-out task slice**: a stable, growing,
  classification-labelled corpus of inputs with a per-run verdict trail. v1.5 §5.1 asks "what is
  piflow's analogue [to SkillOpt mining a checkable task]?" — game-omni's answer is *hand-curated
  held-out prompts* with `expectedArchetype`/`expectedScoringModel` as the cheap **Tier-1 outcome**
  (did W0 classify it right?), and the full E2E `verdict` (`DESIGN_PASSED/FAILED`,
  `VALIDATION_PASSED/FAILED`) as the **Tier-1 end-to-end** signal.
- The golden blueprint is the **Tier-2 pairwise-vs-golden** anchor the cascade names (v1.5 §4d Tier-2:
  "we already keep a per-node golden sample — judge candidate-vs-golden"). It is, precisely, the
  reference a judge would rank a candidate Harden output against — *for platformer only*.

---

## 3. OKF + codegraph = Leg-B Tier-1, already real in game-omni

**The OKF layer (`.agents/okf/`) is a complete, generated functionality memory.** `index.md` is an
OKF v0.1 index (`:2,5`) cataloguing six section-kinds: **criteria · interface-ledger · invariant ×6 ·
playbook · subsystem ×6 · system ×2 · system-map** (`index.md:7-37`). Subsystems capture the real code
architecture (e.g. `subsystems/verify-harness.md` carries live `file:line` anchors —
`harness.ts:214 boot()`, `harness.ts:321 runMilestone()`, `compile.ts:558 executeAssertion()`). The
OKF is **GENERATED, not hand-maintained**: `okf.config.json` is "Substrate locations for the OKF
topic-card generator (`topics/_generate.mjs`)" pointing at `repoRoot` + a `memoryDir` + an *optional*
`codegraph` substrate (`okf.config.json:2-6`); `topics/_generate.mjs` (10.5 KB) is the builder; and
`log.md` is the git-derived iteration log ("Skill-system iteration log (from git skillsys commits)",
`log.md:1`), so the OKF evolves with the code rather than rotting.

**The codegraph IS LIVE.** `.codegraph/codegraph.db` is a real **116 MB SQLite graph**, mtime
**2026-06-26 10:27** (recent); `.codegraph/daemon.log` shows a running daemon with a file-watcher that
"auto-syncs on changes" ("Auto-synced 1 file(s) in 1027ms", "Caught up 1 file(s) changed since last
run") — i.e. it is **incrementally maintained, not a stale dump**. It is built/served by an **external
`codegraph` CLI wired as an MCP server**: `.mcp.json` registers `{ "codegraph": { command:
"codegraph", args: ["serve","--mcp"] } }`. `.codegraph/.gitignore` ignores the db (it is a local build
artifact, never committed — consistent with the data boundary). **Who builds it: not game-omni's own
code and not the piflow SDK** — it is a third-party tool run against the repo; the OKF generator merely
*consumes it as an optional substrate* (`okf.config.json:5`).

**Map to v1.5 Leg-B (code-map, Tier-0↔Tier-1).** v1.5/v1's Leg-B is a two-tier code memory: Tier-0 =
one OKF slice per node (shipped in the SDK as `code-map.ts`), Tier-1 = an opt-in codegraph the gap
doc calls "**unproven on piflow**" (`gap-analysis…:228`, v1 §10.6). **game-omni is the live proof that
Tier-1 exists and is useful product-side**: a real, daemon-synced codegraph + a generated OKF that
already enforces the "code-as-truth, drift-gated" invariant
(`index.md:17` "The registry is a build artifact … generated from the real code by discover.mjs and
drift-gated; never hand-edited"). **What it would take to standardize for the SDK:** lift this
arrangement into a product-agnostic contract — (i) the OKF section-kinds + the generated-not-handwritten
rule as the SDK's Leg-B schema, (ii) a declared codegraph substrate seam (the `okf.config.json`
`codegraph: optional` pattern) so any product can plug a graph CLI in, and (iii) the
proof-before-promote token-win measurement v1 §10.6 gates Tier-1 on — which game-omni can now *supply*,
because it has the live graph to measure against.

---

## 4. The three immutable oracles + anti-reward-hack (the home-grown gate)

These two invariants (`.agents/okf/invariants/three-immutable-oracles.md`,
`anti-reward-hack.md`) are game-omni's home-grown answer to "how do we score without being gamed,"
and they map one-to-one onto the eval-brief's organizing principle.

**The three immutable oracles** (`three-immutable-oracles.md:14-21`):
1. "Success = a required ON-DISK artifact gate, never the model's self-report" (`:14`) — a node cannot
   self-report `outputArtifact`; the file must appear at a known path or `status=blocked` ⇒ HALT
   (worked instance: the asset manifest, `:15`).
2. "An asserted observable lives in the engine/contract canonical home" (`:17`) — every assertion is
   OBSERVABLE state over `window.__GAME__`, "never an engine-internal call (`jump() was called`)" (`:18`).
3. "The oracle is immutable to the producer" (`:20`) — "a fix changes real `src/**` behavior — NEVER
   the test" (`:21`).
The rationale (`:23-24`): "A node that can grade itself will, under pressure (especially on the
non-Claude executor), report green without producing … These three oracles remove self-grading."

**Anti-reward-hack** (`anti-reward-hack.md:12,18-21`): "Assert OBSERVABLE state only; the oracle is
IMMUTABLE." Its class of rules — "Assert observable state, never an implementation call"; "The oracle
is read-only to the producer … a mis-declared oracle is an ESCALATION to the author, never a silent
oracle edit"; "The verifier never weakens" (only STRENGTHENS — raise a number, re-place a threat,
tighten a range); "**The human is the eye** for the playable artifact" — and its one-line test (`:23`):
"Did the fix change `src/**` (real behavior) or the oracle (the test)? Only the former is allowed."

**Relation to the eval-brief.** This IS the brief's principle, independently arrived at, product-side:
- "Success = on-disk artifact gate, never self-report" + "assert OBSERVABLE state only" ⇔ v1.5 §4c
  "**Outcome-gated accept … NEVER judge-gated accept**" and the brief's "outcome > judge, measured."
- "the oracle is immutable to the producer" + "the human is the eye" ⇔ the **separate-critic**
  requirement (v1.5 §4b.2; brief §2.6 `p_c ≈ p_g`) and the **abstain→human** Tier-3 floor.
- "the verifier never weakens" ⇔ the brief's "prefer precision over recall — false positives
  (accepting wrong work) are the dangerous error for a self-optimizer."
- The golden's own note flags the trap explicitly (`GOLD-NOTE.md:67-68`): adding the `timeRemaining`
  observable "STRENGTHENS the oracle, never weakens it … we ADD a field, we don't edit a test."

---

## 5. NODE × OUTPUT × QUALITY-BAR matrix (the inventory)

For each of the 9 win-lose-spine nodes: (a) the quality bar today (cite), (b) its FORM
(checkable-outcome / golden / rubric-judgment / human), (c) the v1.5 tier it maps to, (d) whether a
golden sample exists for that output. **Checkable = a deterministic predicate over the artifact;
Judgment = an eye call.** Every node ALSO has a Tier-0/1 mechanical Output Contract (artifact exists +
schema) that is the SDK's, named here only as the floor.

| # | Node → output artifact | (a) Quality bar today (cite `skill-system-criteria.md`) | (b) Form | (c) v1.5 tier | (d) Golden exists? |
|---|---|---|---|---|---|
| 1 | **W0 Classify** → `spec/classification.json` | archetype byte-identical to live registry + physics-justified; coreLoop one self-enclosed sentence; scoringModel ∈ enum from goal-type; strict-valid JSON (`:8-16`). PLUS held-out `expectedArchetype`/`expectedScoringModel` (`prompt-suite.json:42-43`). | checkable-outcome (schema + label match) + rubric (coreLoop quality) | **Tier-1** (label match) + **Tier-2** (loop quality) | label-golden YES (per eval row); blueprint-golden no |
| 2 | **W1 Spec** → `spec/gdd.md` (prose + milestones JSON tail) | format = prose body + ONE fenced milestones tail; every assertion OBSERVABLE Given/When/Then over `__GAME__`; ≥3 distinct escalating beats, rising difficulty, earned climax; score-meaning + status-model coherent (`:29-41`). | checkable-outcome (observability, count floor, schema) + rubric (richness/escalation) | **Tier-1** (observable assertions, count) + **Tier-2** (richness eye) | partial — platformer gold carries the gdd→milestone shape; no per-node gold artifact |
| 3 | **Harden** → `spec/blueprint.json` (frozen) | config complete; feasibility.checks re-runnable by hand; referenceSolution wins + engages every threat; declaredRanges safe at both endpoints; every binding resolves; strict-valid (`:59-70`). | checkable-outcome (feasibility math, binding resolution, schema) | **Tier-1** (math/resolution checkable) | **YES** — `mecha-plumber.blueprint.json` is exactly a golden Harden output (platformer only) |
| 4 | **VERIFY-1 Design** → `spec/DESIGN_REVIEW.md` | verdict EARNED by RE-DERIVED math (not Harden's claim); substantial-floor re-checked; dangling-ref re-run; verifier never weakens; creates nothing the build binds to (`:86-94`). | checkable-outcome (re-derived arithmetic) + judgment (residual subjective calls surfaced) | **Tier-1** (re-derived) + **Tier-3** (subjective → eye, `:93`) | judged against the golden's checklist (`GOLD-NOTE.md:79-92`); no review-golden |
| 5 | **W2 Scaffold** → `STRUCTURE.md` + `index.json` + `src/levels/<level>.json` | index.json = exact UNION of assetList ∪ entities.assetSlot, per-frame dims; level JSON a VERBATIM projection of blueprint.layout (no coord invented); HUD keyed off failModel; strict-valid (`:110-119`). | checkable-outcome (drift = verbatim-equality to blueprint) | **Tier-1** (byte-faithful projection is deterministically checkable) | derivable from the platformer gold (gold + index.json + SDK is self-sufficient, `GOLD-NOTE.md:79`); no W2-gold |
| 6 | **W3a Art Direction** → `asset-prompts.json` | one prompt per non-audio slot in order; each names ONLY its own subject (anti-theme-bleed); palette distinct per role; **ground vs background ≥ 1.5 WCAG contrast, gate HALTs below (exit 6)** (`:134-140`). | checkable-outcome (1.5 WCAG = a MEASURED deterministic floor) + rubric (prompt taste) | **Tier-1** (the contrast floor) + **Tier-2** (theme-bleed/taste) | no golden palette/prompt set |
| 7 | **W3b Assets** → `ASSETS.md` + `public/assets/*` + index write-back | every non-audio slot a real file (no placeholder floor); on-disk dims == slot dims; animation strip tiles into frames.length cells; verify-then-claim (props read back from bytes) (`:153-159`). | checkable-outcome (on-disk fidelity, dims, alpha) | **Tier-1** (file/dims/format all checkable) | no golden assets (bytes excepted by design, `GOLD-NOTE.md:79`) |
| 8 | **W4 Execute** → `src/**` = blueprint.custom[] delta atop green build | data-driven boundary (NO coord/behavior in a .ts); blueprint-verbatim custom logic at real interaction distances; build genuinely green (no stub/loosen); HALT on a missing number; no hook reward-hack (`:172-179`). | checkable-outcome (build green, no-stub, data-driven boundary) | **Tier-1** (build/typecheck = the v1.5 §3③ FUNCTIONALITY gate) | golden's custom[] delta (`pipe_repair_gate`, `core_grants_time`) is the reference, platformer only (`GOLD-NOTE.md:70-75`) |
| 9 | **VERIFY-2 QA** → `verify/report.M<id>.json` + verbatim marker | marker consistent with gates; every gate EVIDENCED off live `__GAME__` (before/after values, screenshots); **isomorphic-perturbation gate ran (invariant===true)**; no faked-pass via setState injection; fix/escalation boundary honored (`:193-198`). | checkable-outcome (headless run + perturbation invariant) | **Tier-1** (executable oracle — the strongest signal) | the held-out E2E `verdict` per eval row is the ground truth; no per-milestone report-golden |

**Notes on the matrix.** (i) The bar is **Tier-1-dominant** — game-omni has pushed most quality down
to checkable outcomes (the exact v1.5 §4c goal), with a Tier-2 residual concentrated in W0 coreLoop /
W1 richness / W3a taste and a Tier-3 human residual that VERIFY-1 explicitly *surfaces* rather than
rubber-stamps (`:93`). (ii) **A single golden (Harden/platformer) anchors the whole platformer track**
because the pipeline is filesystem-as-contract: `gold + index.json + SDK = the whole game`
(`GOLD-NOTE.md:79`), so the one blueprint golden transitively covers W2→W4→VERIFY-2 for platformer.
(iii) The 4 extra producer lanes (Guidance `:206`, Shell `:227`, Sound `:248`, Model `:268`) each carry
a full bar too, all Tier-1/2-shaped (resolution-against-a-per-node-JSON is a checkable-outcome;
best-match/coherence is rubric).

---

## 6. Gap-to-SDK: what to bring in, per asset

For each asset: what game-omni does BY HAND (or in the hermes/piflow-enhance skill) that a v1.5 SDK
mechanism could consume/formalize, and the ONE concrete missing SDK mechanism.

1. **The criteria fixture → Tier-2 judge input.** *By hand:* a human or a blind judge subagent reads
   `.agents/skill-system-criteria.md`'s per-node block and judges the artifact (`criteria.md:21`); the
   fixture lives product-side and is hand-maintained via `skillsys` commits. *Missing SDK mechanism:* a
   **declared per-node criteria-fixture seam** the SDK loads as a *judge input* (NOT injected into the
   producer — the SDK must honor the clean-room law `skill-system-criteria.md:2`), feeding the existing
   judge node (`workflow/judge/materialize.ts`) its rubric, so a node's bar is a first-class loadable
   artifact instead of skill prose. (The SDK judge today judges absolute-vs-threshold with no rubric
   input wired — `gap-analysis…:67`.)

2. **The golden blueprint → pairwise-vs-golden Tier-2.** *By hand:* the steward hand-authored one
   platformer gold and certifies it with the human (`GOLD-NOTE.md:5-7,91`); "Track A is judged against
   it." *Missing SDK mechanism:* a **per-node golden-sample store + a pairwise-vs-golden + position-swap
   wiring into the judge node** — feed the golden as a second INPUT to the judge and switch it from
   absolute scoring to candidate-vs-golden ranking with AB/BA swap-consistency abstention (v1.5 §4d
   Tier-2/3; `gap-analysis…:259-261`). The SDK has the judge host but neither the golden input slot nor
   the pairwise/swap mode.

3. **The eval prompt-suites → held-out replay (§5.1).** *By hand:* the orchestrator CONSUMES the next
   `pending` prompt, runs the E2E, and LOGS the `verdict`/`flowCommit`/`piModel` back into the row
   (`eval/README.md:62-78`, `prompt-suite.json:23-32`) — a manual replay-and-score loop. *Missing SDK
   mechanism:* a **held-out task-replay harness** that consumes a labelled task bank (the prompt-suite
   shape: `prompt + expectedArchetype + expectedScoringModel`), re-runs the affected node/sub-DAG on a
   frozen slice, and captures the comparable verdict — the §5.1 critical path the gap doc ranks #1
   (`gap-analysis…:239-243`). game-omni supplies the *corpus format*; the SDK lacks the *runner-driven
   single-node re-exec + the score capture*.

4. **OKF + codegraph → Leg-B Tier-1.** *By hand:* an external `codegraph` CLI maintains the live graph
   (`.mcp.json`; `.codegraph/daemon.log`), and `topics/_generate.mjs` regenerates the OKF from
   repo+graph (`okf.config.json:2-6`). *Missing SDK mechanism:* a **product-agnostic Leg-B contract** —
   the OKF section-kind schema + the "generated, drift-gated, never hand-edited" rule
   (`index.md:17`) + a declared optional codegraph-substrate seam — so the SDK's `code-map.ts` Tier-0
   slice can promote to a Tier-1 graph-backed memory the optimizer reads, with game-omni as the
   proof-before-promote measurement site (v1 §10.6).

5. **The three oracles + anti-reward-hack → the gate.** *By hand:* the invariants are prose law the
   nodes + the hermes loop honor (`three-immutable-oracles.md`, `anti-reward-hack.md`); the
   verify-harness enforces #1/#2 mechanically (`verify-harness.md:11-27`) but the "never weaken the
   oracle / fix changes src not the test" rule (#3) is human-/skill-enforced. *Missing SDK mechanism:*
   an **across-run accept gate that keys ONLY on the deterministic Tier-0/1 outcome and structurally
   forbids editing the oracle** — i.e. SkillOpt's `if cand_score > current_score` (v1.5 §2) where the
   score is the executable VERIFY-2 outcome, plus a hard rule that an edit's blast radius excludes the
   assertions / gdd / `__GAME__` hook / harness (the anti-reward-hack class as a runtime invariant, not
   prose). The SDK has the within-run gate but neither this across-run gate nor the oracle-edit
   prohibition (`gap-analysis…:48-50`).

**One-line synthesis.** game-omni already practices the entire v1.5 cascade BY HAND, product-side — a
rubric fixture (Tier-2 input), a golden (Tier-2 anchor), held-out prompt banks (the §5.1 corpus), a
live OKF+codegraph (Leg-B Tier-1), and the oracle/anti-reward-hack invariants (the gate's principle).
The SDK gap is not "do these exist" but "the SDK has no MECHANISM to *consume* them as first-class,
product-agnostic inputs to an across-run scoring/accept loop."
