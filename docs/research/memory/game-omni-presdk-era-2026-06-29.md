# game-omni pre-SDK optimization era + what the new layer must restore (2026-06-29)

> Reconstruction for the memory/optimization layer (`piflow-memory-v1.5.md`) dogfood. game-omni is the
> first target. Every claim cites a real path in `/Users/tk/Desktop/game-omni`. Read-only audit; this is
> the only file written.

## 0. Method + files read

I read the legacy archive, the prior-runs record, the retired workflow seeds, the eval bank, and the two
migration-direction docs, then cross-checked against the live SDK run dirs and git log.

- `.agents/legacy/README.md`, `.agents/legacy/status-pre-sdk-2026-06-17.md`, `.agents/legacy/skill-system-index.mjs`,
  `.agents/legacy/archetype-status.mjs`, and the diagnostics-log header of `.agents/legacy/skill-system-map.md`.
- `.agents/okf/log.md` (the distilled iteration ledger), `status.md` (the post-SDK reset).
- `_prior-runs/INDEX.md`, `_prior-runs/gs01/hermes-routing.md` (the per-run diagnosis-record shape).
- `eval/README.md`, `eval/prompt-suite.json` (the run-record convention), `eval/gold/platformer/GOLD-NOTE.md`.
- `docs/sdk-reframe-direction.md` (Part 9 deferral; Part 10.6 accretion thesis), `docs/multiagent-and-verified-retrieval-direction.md`
  (Part 4 three-DB spec), `research/ai-game-generation-2026-06-08.md` §7 (OpenGame "Game Skill = Template + Debug Skill").
- `packages/skills/implement-milestone/SKILL.md` (the per-node `MEMORY.*` write/read contract).
- `.gitignore`, `.piflow/game-omni/runs/run01/MEMORY.w4-M2.md`, `git log --oneline` (the migration commits).
- "Absent" claims: I grepped `MEMORY\.`, `debug skill|opengame|cross-run|fix db|accret`, and `find .piflow/game-omni/template -iname 'memory*.md' -o -iname 'code-map*.md'`.

## 1. The old (pre-SDK) self-improvement mechanism

The phrase "self-exampled API agent workflows" resolves to OpenGame's thesis, which game-omni adopted as its
"direct architectural parent": **Game Skill = Template Skill (reusable scaffolds that grow from experience) +
Debug Skill (a living protocol of verified fixes)** — "literally templates + a self-improving fix database"
(`research/ai-game-generation-2026-06-08.md:129`; named the parent at `research/genre-and-skill-loading-2026-06-13.md:150`).
Improvement across runs ran on **three coupled tracks**, all human-mediated, none automated:

1. **A per-run on-disk memory handoff (within one run).** Every producing node appends a terse, typed per-node
   fragment — `MEMORY.w2.md`, `MEMORY.asset.md`, `MEMORY.w4-m<k>.md` — recording quirks, what failed, and
   blueprint gaps; a deterministic JOIN merges the fragments into a canonical `MEMORY.md`, and the next node
   READS it "so you don't re-hit a known quirk"
   (`packages/skills/implement-milestone/SKILL.md:79-85`, `:116`, `:531-557`). The cited lineage is
   "godogen/pipeline §4 (MEMORY.md = W4's file); CCGS context-management.md — the file is the memory"
   (`implement-milestone/SKILL.md:533`). **This is per-RUN only** — it never crossed run boundaries.

2. **The eval prompt bank as an I/O contract with an outcome trail (across runs).** `eval/prompt-suite.json`
   is the "fixed, growing bank of real-world prompts" where each input accrues a `runs[]` trail stamped with
   `runId`, `flowCommit` (the git SHA correlating prompt→flow-version→outcome), `piModel`, `verdict`,
   `humanEyed`, and a `notes` field defined as "what this run taught / any Hermes finding routed"
   (`eval/prompt-suite.json` `runRecordShape`/`convention`; `eval/README.md:6-12`). A hand-authored **gold
   exemplar** (`eval/gold/platformer/mecha-plumber.blueprint.json`) was the target Track-A blueprints were
   judged against and Track-B consumed (`eval/gold/platformer/GOLD-NOTE.md:1-11`).

3. **The Hermes loop that turned a run's findings into a generalizing edit (the actual improver).** A debugged
   run was written up as `_prior-runs/<id>/hermes-routing.md`, tracing each finding to its generalizing **root**
   and routing it to the canonical **source owner** — "the chain/contract, never a downstream guard"
   (`_prior-runs/INDEX.md:9`). The fix landed as a reviewed, revertible `skillsys(<id>)` / `fix(...)` commit
   editing the SKILL, the template engine, or the chain; the durable lesson was distilled into a dated
   `_lesson:_` entry in `.agents/okf/log.md` ("from git skillsys commits", `log.md:1`). Two read-only
   code-as-truth tools surfaced state from this trail: `archetype-status.mjs` rolled up per-archetype
   **run pass-rate** from the `runs[]` records (`archetype-status.mjs:71-96`), and `skill-system-index.mjs`
   derived the node→skill→artifact router from the workflow itself (`skill-system-index.mjs:46-66`).

So the loop was: run → per-node `MEMORY.*` (ephemeral) → human diagnoses → `hermes-routing.md` → `skillsys`
commit to the owner + `_lesson:_` ledger line → the next run inherits a better skill/template. Git was the
iteration log (`status.md:63`).

## 2. What the cleared memory logs contained (the target shape)

Two distinct memory surfaces, and it matters which one the new layer must reproduce.

**(a) The per-run `MEMORY.*` fragments — the typed quirk/gap log.** These are NOT empty by design; they are
RICH and still produced today. The live `.piflow/game-omni/runs/run01/MEMORY.w4-M2.md` carries the milestone
scope verbatim, every acceptance criterion, the `custom[]` delta required, and a per-seam table of which
system/file ships each behavior and its exact mechanism. The recorded grammar is one typed line per quirk:
`[Mk] blueprint-gap: <field path> missing/contradictory — <one line>` (`implement-milestone/SKILL.md:163`),
plus "score lives in registry", "overlap fires once" style quirks the next node must know
(`implement-milestone/SKILL.md:557`). They appear near-empty because they live in `out/<id>/` and
`.piflow/*/runs/`, **both gitignored** (`.gitignore:6-7`) — wiped per run, never promoted, by construction.

**(b) The cross-run distilled memory — the diagnostics ledger + Hermes routing record (this is the real
target).** Pre-rebuild this lived as a dated per-milestone "Diagnostics log" at the tail of
`.agents/legacy/skill-system-map.md` ("a dated per-milestone ledger ... the rot the new Hermes drops",
`.agents/legacy/README.md:6-9`), now distilled into `.agents/okf/log.md`. The SHAPE is a
**Symptom → Trace (path:line) → Root cause → Owner/route → Local-vs-promote → Generalization+anti-reward-hack
→ Suggested smallest durable edit** record, exemplified at `_prior-runs/gs01/hermes-routing.md:8-13` (the
routing table) and `:17-37` (the full finding). The OKF log compresses each to a one-line `_lesson:_` —
e.g. "a live respawn must return CONTROL — reset every layer the death funnel latched" (`log.md:147`) or
"load the on-disk file whenever a slot has a path" (`log.md:180`). **This is the single most valuable thing
the new layer must reproduce: a durable, cross-run, root-caused fix record keyed to the owner, so a fixed bug
stays fixed and the next run starts richer.**

## 3. What was lost / stagnated at the SDK migration

The migration "retired the bespoke pi-runner renderer and now run[s] the identical template on the
`@piflow/core` SDK ... Render → SDK. That is the whole migration" (`status.md:9-15`; commits
`dd001c1 chore(repo): retire pi-runner to legacy/` and `da7ea2b docs(status): reset to the SDK era`).
What was lost is NOT the workflow or the skills — those carried over. What was lost is the **cross-run
improvement loop**:

1. **The OKF iteration ledger stopped.** `.agents/okf/log.md` runs `2026-06-19` back to `2026-06-09` and has
   **no entries after 06-19** (`grep '^## 2026' .agents/okf/log.md`), yet the migration commits land
   `2026-06-24/25`. The status was explicitly "reset to a clean start; open items reset" (`status.md:16-17`).
   The `_lesson:_`-distillation discipline that made fixes durable went quiet.

2. **The Debug Skill / verified-fix database was specced but NEVER built — the missing optimization layer.**
   It was DEFERRED at `docs/sdk-reframe-direction.md:311` ("Promoting `MEMORY.md` into a durable cross-run
   Debug-Skill fix DB (OpenGame Layer 1)") and re-specced as DBs 2+3 in
   `docs/multiagent-and-verified-retrieval-direction.md:88` (Verified-pattern/design DB + Verified-snippet/Debug
   DB), both with **Status: new** (`:84-88`) and an explicit **cold-start: "we have ZERO proven runs today"**
   (`:145-146`). So the automated half — bank every VERIFIED pattern/snippet, retrieve the best at design time,
   "every run starts richer than the last" (`:172`) — was always vapor. game-omni never had it; it only ever
   had the manual Hermes loop, and that loop went idle at the migration.

3. **The per-run memory still evaporates.** The fragments in §2(a) are written into the gitignored run dir
   and there is **no node-level `memory.md` / `code-map.md` in the template** (`find .piflow/game-omni/template
   -iname 'memory*.md' -o -iname 'code-map*.md'` → empty). There is no seam that promotes a run's quirk/gap
   into a durable per-node surface the NEXT run reads.

Net: game-omni today can generate a game and (in companion mode) a human can route a fix by hand, but the
pipeline **cannot improve itself** — no fix is automatically banked, no verified pattern is retrieved, no
per-node memory survives the run. The evidence of stagnation is concrete: only **one gold exemplar exists**
(`eval/gold/platformer/`, platformer only), passing-run records are sparse across the seven banks
(`grep -c PASSED eval/*.json` → 0–2 per bank), and the cross-run ledger has been silent since before the SDK
cutover.

## 4. Dogfood success criteria — what the new layer must produce on game-omni

The new optimization layer "works" on game-omni when it closes the manual loop of §1 into a durable, automatic
one. Concrete, measurable signals (in ascending order of proof):

1. **Per-node memory persists and is non-empty after a run.** After one `piflow run`, each node has a durable
   `memory.md` (the v1.5 per-node surface) that is committed, not gitignored — i.e. it survives `out/`/`runs/`
   being cleaned. **Measure:** `git status` shows tracked, non-empty `memory.md` for the producing nodes;
   re-running the same prompt does not re-discover a quirk the prior run already recorded (the next run READS
   it, matching `implement-milestone/SKILL.md:116`).

2. **A fixed bug stays fixed without re-diagnosis (the regression signal).** Replay one of the already-routed
   `_prior-runs` findings — e.g. gs01 Finding 1 (`maxScore===0`, owner `templates/modules/gallery_shooter/src/**`,
   `_prior-runs/gs01/hermes-routing.md:10`/`:29`) or gs01 Finding 2 (the `hook.ts:138-139` destroyed-group read,
   `:11`/`:52`). **Measure:** the layer surfaces that root-caused fix from its banked memory at the relevant
   node BEFORE the bug recurs, so a fresh gallery_shooter / any-2D run does not reproduce the same
   `VALIDATION_FAILED` / boot crash. The fix-record shape must match §2(b) (Symptom→Trace→Root→Owner→
   generalization), keyed to the owner path.

3. **Verified patterns/snippets accrete and are retrieved at design time (the flywheel signal).** A passing run
   (verdict `*_PASSED`, ideally perturbation-robust) writes its blueprint/`custom[]` delta into the verified
   corpus (DBs 2/3, `multiagent-...-direction.md:87-99`, where **VERIFY-2 is the only writer**); a later
   same-family run retrieves it as design grounding instead of re-deriving. **Measure:** the corpus grows from
   the current floor (1 gold, ~0–2 passes/bank) to ≥1 banked verified pattern per archetype that actually gets
   retrieved on a subsequent run; the retrieved item is logged as "grounding used."

4. **The improvement is observable in the outcome trail.** `eval/prompt-suite*.json` run records and the
   `archetype-status.mjs` per-archetype pass-rate rollup (`archetype-status.mjs:71-96`) show **pass-rate
   trending up across successive `flowCommit`s for the same archetype** — the prompt→flow-version→outcome
   correlation the bank was built to expose (`eval/prompt-suite.json` convention; `eval/README.md`).

**The single clearest "it works" signal:** run game-omni twice on the same (or same-archetype) prompt across a
banked fix — the second run does NOT re-hit the bug the first run's memory recorded, and you can point at the
durable per-node `memory.md` (or fix-DB entry) that carried that knowledge across the run boundary. That is the
exact capability §1's manual Hermes loop provided and §3 shows the pipeline lost; reproducing it automatically
is the dogfood bar.
