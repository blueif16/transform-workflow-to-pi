---
name: memory-slices
description: >-
  Per-node MEMORY slices (Leg A — self/history) — FIND a node's standing lessons + cross-run RECURRENCE before the
  optimizer edits it, and MAINTAIN the memory.md set so it stays honest, bounded, and never rots. The Leg-A twin of
  `okf-slices` (Leg B — world/code): a memory lesson `[[links]]` the OKF code slice it concerns, so its freshness
  gate rides that slice's `--check`. TRIGGER on either intent: (FIND) the out-of-band triage/fixer needs "has this
  node failed THIS way before, how often, and what did we learn?" — the LAPSE-vs-SKILL signal — before bucketing or
  editing a node; or (MAINTAIN) someone runs the MEMORIZE step, asks when/how memory.md is updated, what a lesson's
  scope is, whether a lesson is stale, or WHERE a lesson should live (per-node vs system). Works on any repo with
  template-scoped `memory.md` (`.piflow/<wf>/template/{memory.md, nodes/<id>/memory.md}`; config in
  `.agents/okf/okf.config.json`). Memory is OPTIMIZER-FACING reference, NEVER injected into a worker node's runtime
  prompt — this skill is how the out-of-band optimizer reads and writes it.
---

# Memory slices — find the lesson + its recurrence, keep the record honest and bounded

A **memory slice** is a node's small, capped set of standing **lessons**: what this node has gotten wrong, the ROOT
why, and the durable prevention — each lesson carrying a cross-run **recurrence count** and a `[[okf-slice]]`
cross-reference to the code it concerns. It is a distillation, never a run transcript or a changelog. The lessons
live in template-scoped `memory.md` — one per node (`.piflow/<wf>/template/nodes/<id>/memory.md`) plus one
system-level (`.piflow/<wf>/template/memory.md`); the design/rationale is
`docs/research/memory/piflow-memory-v1.md §5a` (the two legs) + `piflow-memory-v1.5.md §6` (the MEMORIZE step in the
overlord loop) — cite it, don't restate it. This skill is the OPERATIONAL procedure for the two things you do with
memory.

**The two legs, one pattern.** `okf-slices` (Leg B) answers *where the code is / how it works*; `memory-slices`
(Leg A) answers *what went wrong here, why, and how often*. The optimizer uses BOTH: memory-slices tells triage
"this node has failed this way N times → SKILL, not LAPSE, and here's the lesson"; the lesson's `[[okf-slice]]`
link hands the fixer the code map. **Substrate is shared with Leg B:** git (the deep, unbounded session log —
`skillsys`/`flowCommit` commits) + the run traces (`runs/<id>/`, the raw material MEMORIZE distills) + codegraph
*via the OKF cross-ref*. This "the commit message IS the record" move is the 2026 git-native-memory pattern — Lore (arXiv 2603.15566) restructures commit messages via git-trailers into decision records (constraints / rejected-alternatives / directives / verification); GitOfThoughts (arXiv 2606.14470) records scores as git-notes and merges a memory branch, and its finding that recalled memory helps only when a new case is >0.8 similar to a past one is exactly why we key on same-signature RECURRENCE; Projectmem (arXiv 2606.12329) is a grep-able append-only event log whose "you tried this before — it failed" judgment layer IS our recurrence signal, built. Do NOT confuse this template-scoped optimizer memory with two neighbours: (a) the
run-scoped, forward-INJECTED `MEMORY.<node>.md` some products write for in-run coordination (opposite semantics —
never touch it here); (b) the `memoryDir` session hub (`~/.claude/.../memory`) that OKF slices already read for
their *code* lessons-cluster. This skill owns only the template `memory.md`.

**Why this exists:** without a bounded, cross-run record, every optimizer round re-discovers the same defect and
can't tell a one-off slip from a real skill gap — so it either never edits (misses SKILL defects) or edits on a
single slip (rots the corpus). Memory is only useful if (a) you can FIND the right lesson + its recurrence and
(b) it is FRESH and SMALL. This skill is both halves.

---

## MODE A — FIND the lesson + recurrence for a node (the reader)

Use when triage is about to bucket a defect, or a fixer is about to edit a node, and you need the node's standing
record instead of re-deriving it. This is the reader that fills the `triage.ts` SKILL-vs-LAPSE deferral.
**Procedure (stop at the first step that resolves):**

1. **Normalize the query** to concrete keys: the NODE id, and the failure SYMPTOM (a short signature — the failing
   check id, the error class, the artifact field, or a one-line description).
2. **Read the node's `memory.md`** (`.piflow/<wf>/template/nodes/<node>/memory.md`) and match the symptom against
   its lessons. RANK by *where* the match lands — a lesson whose **Symptom/signature** matches OWNS the query;
   a bare prose mention is a WEAK match. If the defect's fix-surface is cross-node (a hand-off/contract), also
   read the **system** `memory.md`.
3. **Compute RECURRENCE deterministically — never guess it.** Count prior occurrences of this signature across
   runs: the lesson's own `recurrence:` counter, corroborated by the run trail (`grep` the signature across
   `runs/*/` reports/traces) and git (`git log --grep=<signature>` over `skillsys`/`flowCommit` commits). The
   COUNT is the signal; the prose is the explanation. Grep accuracy depends on a DISCIPLINED, controlled-vocabulary
   signature — CommitDistill (arXiv 2605.18284) shows an un-disciplined git mine needs a calibrated abstention
   threshold to stay correct; prefer stamping the count as a git-note on the landing commit (GitOfThoughts) so it is
   git-auditable and mergeable, not only in the `memory.md` frontmatter. If nothing matches → recurrence 0 (first occurrence).
4. **Validate the lesson before you trust it** (just-in-time; a stale lesson is worse than none): a lesson pinned
   to code via `[[okf-slice]]` is only current if that slice is. Run the OKF gate for the linked slice —
   `cd .agents/okf/topics && node _generate.mjs --check <okf-key>` — and read the signal (see `okf-slices` MODE A
   for HEALTH vs DRIFT). `HEALTH:` on the linked slice ⇒ the code the lesson describes MOVED: the lesson's
   prevention may no longer apply → flag it `code-shifted`, don't hand it over as settled. `ok`/`DRIFT` ⇒ the
   lesson's code anchor still holds.
5. **Return the SIGNAL, not a dump.** Hand triage: the matching lesson (Symptom → Root → Prevention), the
   recurrence COUNT, the linked `[[okf-slice]]`, and the freshness verdict. The count drives the bucket —
   **recurrence 0 → LAPSE (default-when-unsure, protect the corpus); recurrence ≥ threshold with a prevention the
   node already had → SKILL** (the prose was right, executor slipped again → routing/tier, not a prose edit);
   **recurrence ≥ threshold with NO prevention yet → SKILL** (author the missing rule). A code-shifted lesson
   routes toward FUNCTIONALITY/ARCH, not SKILL.

**Recurrence ≠ certainty.** A count says the symptom repeated, NOT that the same ROOT caused it. Before you let a
high count force SKILL, confirm the roots match (same trace signature, same fix-surface) — two different bugs with
one symptom are two LAPSEs, not one SKILL. When the roots diverge, report `ambiguous` and default to LAPSE.

**FIND output shape** (what you return to triage/the fixer): `{ node, lesson? (symptom/root/prevention), recurrence:
N, okfSlice?, freshness: fresh | code-shifted | none, suggestedBucket, confidence }`. If no lesson, say so plainly
(recurrence 0) — never invent one.

**FIND bar (must hold):** you cited a REAL lesson (or honestly reported recurrence 0); the recurrence count was
COMPUTED from traces/git, not asserted; you confirmed roots match before calling recurrence a SKILL signal (else
`ambiguous`→LAPSE); you ran `--check` on the linked OKF slice and reported freshness; you returned the signal
triage needs (bucket + evidence), not the whole file; you did NOT present a stale/code-shifted or invented lesson
as settled.

---

## MODE B — MAINTAIN the memory set (MEMORIZE + keep it bounded)

Use when the optimizer's MEMORIZE step runs, after a fix lands, when the cap is hit, or when asked "is this stale /
where should this lesson live." Memory has **two surfaces**, split by write-authority × freshness — keep them
distinct:

- **git = the deep, unbounded session log.** Every landed edit is a `skillsys(<node>)`/`flowCommit` commit whose
  message IS the record (Symptom → Root → Fix → Prevention). **NEVER hand-keep a changelog file** — that is the #1
  memory-rot; git is the generated log. git is QUERIED (`log`/`grep`/`blame`), never loaded wholesale into context.
- **memory.md = bounded STANDING STATE.** Lessons + why + current invariants + open threads. NOT diffs, NOT a log.
  Capped (~40 lines, top-loaded; lowest-value truncates first). Optimizer-facing; never injected into the node.

**The write authority + the update rule.** Only the optimizer's MEMORIZE step (and a human) writes memory.md —
disjoint from the node it describes. The rule is **ACE incremental-delta, never full-rewrite**:
- **append** a new lesson (with `recurrence: 1`, a `[[okf-slice]]` link, and the distilled Symptom/Root/Prevention);
- **update** an existing lesson (increment `recurrence`, sharpen the prevention) when the same signature recurs;
- **retire** a lesson that is superseded (its fix graduated to code/git) or stale (its `[[okf-slice]]` went HEALTH
  and the prevention no longer applies).
This append / update / retire shape is ExpeL's insight-pool operations (ADD / EDIT / UPVOTE / DOWNVOTE, arXiv
2308.10144) — our `recurrence` counter IS ExpeL's vote weight — and Mem0's ADD/UPDATE/DELETE with newer-wins (arXiv
2504.19413). Zep/Graphiti *invalidates* rather than deletes (arXiv 2501.13956), but git is already our invalidation
ledger, so `memory.md` can hard-remove a retired lesson without losing history.
Do **NOT** LLM-rewrite the whole file into a fresh summary — full-rewrite consolidation causes measured context
collapse (ACE, arXiv 2510.04618; A-MEM, arXiv 2502.12110, DOES let a new note evolve/rewrite existing linked notes,
but that optimizes retrieval recall for an unbounded, runtime-INJECTED store — the wrong move for our bounded,
optimizer-only, read-whole corpus; do not read it as license to rewrite lessons). When the cap is exceeded,
compaction is a SEPARATE, out-of-band pass that RETIRES discrete lowest-value entries (by age × non-recurrence ×
graduated-to-git), never a re-summarization. The ~40-line cap and the retire-metric weights are TUNABLE defaults,
not laws — the eviction surveys (Du et al. arXiv 2505.00675; the LLM-agent-memory surveys) settle the AXIS
(age × importance × recurrence), not the constant.

**Where a lesson lives (the assignment rule) — by the four-way triage bucket, i.e. by blast radius:**
| Lesson's fix-surface (bucket) | Home |
|---|---|
| LAPSE / SKILL / FUNCTIONALITY (edit is inside ONE node's envelope or `owns`/`readScope`) | that node's `memory.md` |
| ARCH / COORDINATION (a hand-off, a shared contract, a cross-node wiring) | the **system** `memory.md` |
Mirror Leg B: the bucket that selects the fixer's edit-surface also selects which memory.md the lesson lands in.
The node + system split is SOTA-endorsed — G-Memory (NeurIPS 2025), the Wu & Shu MAS-memory survey, SAMEP (arXiv
2507.10562). **RESOLVED: the human-session `memoryDir` hub stays SEPARATE** — the MAS-memory literature is unanimous
that isolation-by-default + an access-controlled shared tier beats a merged pool, and merging a human-facing
conversational hub into this optimizer-facing per-node store would break the invariants below. The ONE open grain
item is an optional per-vertical MIDDLE tier (G-Memory's query/team tier) we currently fold into "system" — add it,
tuple-namespaced à la LangMem, only if per-vertical lessons recur.

**Cadences:**
- **Per-round (the MEMORIZE step of the overlord loop).** After SCORE→TRIAGE→FIX→GATE, distill the round's
  confirmed defect into ONE delta (append/update/retire per above) on the owning memory.md, link its `[[okf-slice]]`,
  and stamp the recurrence. This is the write; it is out-of-band, never an in-DAG node.
- **Compaction (when over cap, out-of-band).** Retire discrete entries by the metric above; never re-summarize.
- **Post-merge freshness (advisory).** When code moves, a lesson can go stale. Re-run the linked slices'
  `okf --check`; any lesson whose `[[okf-slice]]` is HEALTH-flagged → mark `code-shifted` for the next MEMORIZE to
  re-validate or retire. The memory drift gate is not separate machinery — it RIDES the OKF gate through the link.

**To WRITE a lesson (the delta shape):** a lesson block =
`### <symptom signature>` · `recurrence: N` · `[[okf-slice-key]]` · **Root:** one line · **Prevention:** the
durable rule (positive recipe for SKILL, prohibition+rationalization for a discipline lapse — match the form to the
failure type, see `agentic-prompt-design §0b`). Keep it pointer + semantics: link the slice, cite the trace
`path:line`, do NOT paste the code or the transcript.

---

## Invariants (the laws — do not violate)
- **Optimizer-facing, never injected.** memory.md is read/written by the out-of-band optimizer; it is NEVER put
  into the worker node's own runtime prompt (a node that sees its failure history only hesitates). Keep memory.md
  out of any directory a worker node's tools sweep.
- **Distillation, never transcript.** A lesson is Symptom/Root/Prevention + pointers; it does not duplicate the run
  log or the code. git holds the history; memory.md holds the standing state.
- **Deterministic-first; the model only distills.** Recurrence is COUNTED (traces + git); the LLM writes the
  lesson prose. Never let a model assert a recurrence count.
- **Incremental-delta, never full-rewrite.** Append/update/retire discrete lessons; compaction retires, it does not
  re-summarize. Bounded by the cap.
- **Validate after retrieval (JIT), don't front-load.** Pull the lesson when needed and ride the linked slice's
  `--check` before trusting it; a stale/code-shifted lesson is actively harmful.
- **git is the log; never hand-keep a changelog.** The commit graph is the record; memory.md is not a diff feed.

## Self-check before returning
- FIND: Did I cite a real lesson (or say recurrence 0), COMPUTE recurrence from traces/git (not assert it), confirm
  the roots match before calling it SKILL (else ambiguous→LAPSE), ride the linked slice's `--check` and report
  freshness, and return the triage signal (bucket + evidence) not a dump?
- MAINTAIN: Did I write ONE incremental delta (append/update/retire) — never a full rewrite? Did I place the lesson
  by its bucket (node vs system)? Did I keep it distillation + pointers (no transcript/code)? Did I leave git as the
  log (no changelog file)? On compaction, did I retire discrete entries rather than re-summarize?

## Pointers
- Design + rationale: `docs/research/memory/piflow-memory-v1.md §5a` (two legs) · `piflow-memory-v1.5.md §6`
  (the MEMORIZE step + the overlord loop) · §3 (the four-way triage the assignment rule mirrors).
- Leg-B twin (the pattern to match) + the shared cross-ref: `.claude/skills/okf-slices/SKILL.md`; a lesson's
  `[[okf-slice-key]]` is a key under `.agents/okf/topics/`.
- The reader stub this fills: `packages/core/src/optimize/triage.ts:14` (SKILL ← cross-run recurrence, DEFERRED).
- The writers already seeded: `packages/core/src/memory/{skeleton,seed}.ts`; `piflowctl memory scaffold <template>`.
- **SOTA grounding + what's settled vs open:** `docs/research/memory/memory-substrate-sota-2026-06-30.md`
  (git-native substrate — Lore/GitOfThoughts/Projectmem/CommitDistill · the substrate comparison · the ExpeL/ACE/Mem0
  update-rule + eviction SOTA · G-Memory/Wu-&-Shu MAS scoping). RESOLVED there: flat-markdown-on-git is the right
  substrate (vector/graph/SQL is overkill for a bounded, read-whole, optimizer-written corpus; Mastra semantic-recall
  targets an unbounded conversational corpus we do not have); the `memoryDir` hub stays separate. STILL OPEN (tunable,
  not law): the ~40-line cap constant + retire-metric weights, and the optional per-vertical tier.
- Promotion path (Stage 2, mirroring okf): port FIND/RECURRENCE into a deterministic `piflowctl memory find|check`
  verb (a `deriveRecurrence()` alongside the generator's `deriveLessons()`), then add this skill to the
  `piflowctl skills install` bundle.
