# SOTA verification of the slice / anti-drift practices (2026-06-30)
_An adversarial external audit (EXA web research) of the practices implemented this session, to confirm we obey
SOTA / industry best practice. Brief is `anti-drift-sota-2026-06-30.md` (the prior survey); this doc VERIFIES the
specific decisions in `code-understanding-and-anti-drift.md` §2 + §4.1, including the new line:symbol gate._

> **Headline:** 6.5 of 7 practices are well-grounded against primary sources (papers + shipping tools). The audit
> was instructed to REFUTE first, not confirm. Two wording errors in our doc were CORRECTED in place (P4 rationale,
> P2 churn phrasing); one significant upgrade was added to the backlog (**E8 · stable SCIP symbol anchors**, the
> single most concrete improvement). The two corrections + E8/E4 notes are already folded into the design doc.

## Verdict summary
| Practice | Verdict | Action taken |
|---|---|---|
| P1 · slice = spine (origin→terminal), stage-grouped anchors, curated+derived halves | ✅ ALIGNED (Literate Tracing, agent-system-mapper) | none — keep; caveat: a runtime-only terminal can pass anchor-resolution while being semantically wrong |
| P2 · discovery = graph projection; reachability=membership, centrality=importance, **recency≠frequency** liveness | ✅ ALIGNED, phrasing overshoot | CORRECTED §2: "churn ≠ importance" → "cumulative churn over-weights historically-troubled-but-now-dead code"; added the recent-churn-is-positive nuance + the dynamic-dispatch confidence-tier limit |
| P3 · deterministic-first; LLM advisory, fires only on a quotable contradiction | ✅ ALIGNED (strongest consensus — DocPrism, Staleguard, spec-drift) | none; note: advisory-tier precision tops ~0.62 → route to a cheap glance, never auto-rewrite (doc already forbids) |
| P4 · granularity ladder matched to cadence | ⚠️ PARTIAL — rungs are SOTA, "match granularity to cadence" is OUR synthesis; rationale was backwards | CORRECTED §4.1: method-body hash is advisory for COST/CADENCE, not FP-risk (AST-hash is a *clean* signal); labeled the cadence-mapping as a derived rule; E4 gets an incremental-hash note |
| P5 · anchor `file:line — symbol` valid iff line ∈ symbol span, fallback symbol-in-file | ✅ ALIGNED, stronger mechanism exists | added **E8** — anchor on stable SCIP/LSIF symbol ids, derive line as a hint (kills line-drift FPs + free rename detection) |
| P6 · don't front-load; pull slice JIT, validate after | ✅ ALIGNED (Anthropic context-engineering, context rot, "When Retrieval Hurts" +88pp) | none; "validate after retrieval" is our addition (least externally attested) |
| P7 · slice read by out-of-band optimizer, never injected into the worker node prompt | ✅ ALIGNED, mild caveat | none; caveat: a lightweight POINTER may be injected, and slices get grep/semantic-searched into the worker if they sit in a swept dir → physically isolate `.agents/okf/` |

## Key external anchors (per practice, fetched in-session)
- **P1** — Literate Tracing (arXiv 2510.09073); agent-system-mapper "code-flows" (`[VERIFIED: path:line]`); DKB graph-vs-RAG (arXiv 2601.08773): AST/dep-graph beats chunk-RAG on multi-hop structural questions.
- **P2** — CodeScene Hotspot docs (relative-churn: old stable files fall faster; historic hotspot "sticks around due to its troubled past"); Knip/fallow/CodeReap (reachability-from-entry-points = liveness; membership only as good as the root set); Nagappan & Ball ICSE'05 (relative churn → defect density).
- **P3** — DocPrism LCEF (arXiv 2511.00215): naive LLM flagged 98% of functions → deterministic harness cut to 14%, accuracy 14%→94%; Staleguard L1 deterministic / L2 advisory; spec-drift confidence matrix.
- **P4** — docdrift / sem / symtrace / sem-core (method-body AST hash, formatting-insensitive, ≥4 independent impls); Test-Impact-Analysis (Fowler, Ekstazi, Meta PTS >95%, Glean fanout); alert-fatigue (STAF arXiv 2604.18525; Snyk 2023: 62% of teams ≥¼ FPs). "Match granularity to cadence" NOT found as a named principle — it is our synthesis.
- **P5** — CKB Doc-Symbol-Linking → SCIP ids (`missing_symbol`/`symbol_renamed`/`ambiguous`); VS Code PR #314864 (LSP DocumentSymbol, tree-sitter fallback); SCIP design doc ("limit blast radius of off-by-one indexer bugs that broke navigation repo-wide").
- **P6** — Anthropic "Effective context engineering" (context rot; just-in-time; lightweight identifiers); "When Retrieval Hurts" (arXiv 2605.14478, +88pp obsolete code from stale-only retrieval); NoLiMa (11/13 models <50% of short-context score at 32k).
- **P7** — Augment Code "a good AGENTS.md is a model upgrade; a bad one is worse than no docs" (too-much-architecture-overview measured WORSE than no file; ~half of context hits came from grep/search, not references); Anthropic CLAUDE.md guidance.

## Bottom line (from the audit)
- **Ship as-is:** P3, P5 (mechanism), P6, P1 — multiple independent SOTA sources each; P3/P6 are near-consensus.
- **P2 phrasing fixed:** recency-over-frequency is vindicated by CodeScene *for our question*, but churn is the best-validated *defect* predictor — so recent churn among live slices is a positive signal, used nowhere as a negative.
- **P4 rungs are SOTA; the cadence-mapping headline is our synthesis (now labeled), and the body-hash rationale was corrected** (advisory for cost, not FP-risk).
- **Biggest upgrade (E8):** move the anchor key from `file:line` to a **stable SCIP/codegraph symbol id**, deriving line as a hint — SOTA solved line fragility structurally rather than with a `line ∈ span` workaround.
- **Two blind spots to watch:** reachability under-counts dynamic/framework dispatch (use a confidence tier, not binary); an "out-of-band" slice still leaks into a worker via grep/semantic-search if it lives in a swept directory.
- **Single most important thing we might be getting wrong:** storing+validating a line number at all — the field moved to stable symbol ids to escape line fragility (this is E8).
