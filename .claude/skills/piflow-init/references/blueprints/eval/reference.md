# Compose-eval reference oracle (CRITIC ONLY — never shown to the COMPOSE agent)

For each task: the correct blueprint (or compose op), the lane-count range, the `must` wiring signature, and the
`must-not` (wrong shapes). Score a stamped/edited DAG PASS iff it satisfies every `must` and violates no
`must-not`. Judge SHAPE (blueprint choice · lane/segment count · wiring · the compose op), not prose or ids. The
task prose deliberately names NO topology — the composer had to REASON the shape from the need, so never reward a
DAG for echoing task words; reward it only for the right arrangement.

---

## T1 — cold-outreach workflow design → **research-synthesize-author**
- must: N parallel research lanes (N = 2–4, one per independent area ≈ deliverability · enrichment · analytics)
  with disjoint `owns`, all `deps:[]`; → one `synthesize` (deps ALL lanes); → one `author` (deps synthesize).
- must: research lanes bound to `market-research`; author emits a template/artifact under `out/**`.
- must-not: a single linear chain with no fan-out; lanes that read each other (not independent); no synthesize
  join (lanes feeding author directly).

## T2 — self-correcting config build → **produce-verify-fix** (N=1)
- must: `produce → verify` with `verify` carrying a reroute back to `produce` (`op rerouteTo{produce, K}`),
  `--on-fail block`; a `plan` head is acceptable/encouraged. verify is READ-ONLY (creates no key artifact).
- must: exactly ONE produce→verify segment (one deliverable).
- must-not: parallel workers (there is one deliverable, not N shards); a verify node that WRITES the config
  (conflates producer + verifier); no reroute/loop (a one-shot produce→verify with no self-fix).

## T3 — independent assessment → consensus → **fan-out-map-reduce** (adjudicate)
- must: N parallel workers (N = 2–5) with disjoint `owns`, NO worker reading a sibling; → one `reduce`/consensus
  node (deps ALL workers) that reconciles into one verdict.
- must: workers bound to `reviewer` (or similar read-only judge); reduce bound to `verify`/`synthesizer`.
- must-not: a serial chain of reviewers (each reading the previous — kills independence); a single reviewer; no
  reduce/consensus node.

## T4 — interface frozen once, parts built together → **spec-fanout-build** (M=3)
- must: `design` freezes ONE spec (strict `spec/blueprint.json`); → M parallel producers (M = 3: types · impl ·
  tests) each `--dep design`, disjoint `frag/<facet>/**` owns, each reading ONLY the spec; → `verify-join` (deps
  all producers); → `build` (deps verify-join, assembles `out/**`).
- must-not: producers writing competing full candidates (that is candidate-fusion, not disjoint fragments);
  producers reading each other; no frozen-spec node (producers inventing their own interface); no verify-join.

## T5 — multi-attempt draft, then robustness pass → **candidate-fusion-refine**
- must: linear `plan → draft → harden → publish`; `draft.node.json` has `fusion.mode:"moa"` with a `panel`
  array (+ judge); `harden.node.json` has `fusion.mode:"best-of-n"` with integer `n`.
- must: disjoint owns per node; the siblings/judge are NOT hand-authored (fusion flags materialize them).
- must-not: hand-authored `__judge`/sibling nodes; a plain single-model draft/harden with no `fusion` block; a
  parallel-candidates fan-out with a separate authored judge (that reinvents fusion by hand).

## T6 — implement-and-fix a function → **produce-verify-fix** (N=1) — THE FALSIFIER
- must: `produce → verify(reroute→produce, K)` sequential self-fix loop; ONE segment; verify read-only.
  A `debugger`-bound fix inside the loop is fine (produce/fix is the same slot).
- **must-not (the falsifier):** `fan-out-map-reduce`. This task is inherently SERIAL — one function, one test, a
  sequential gate-and-fix loop. There are NO independent shards to fan out and NO consensus to reduce. A
  map-reduce composition MUST score **FAIL**.
- **Test-the-test:** feed the critic a PLANTED `fan-out-map-reduce` stamping of T6 (parallel "fixer" workers →
  a consensus reduce). The critic MUST return FAIL, citing the missing serial gate loop / absent independent
  shards. If it returns PASS, the critic is only checking `extract`-green, not SHAPE — the eval is void until
  the critic is fixed. See the concrete procedure at the end of this file.

## T7 — insert a review panel before the gate → **INSERT a `fan-out-map-reduce` fragment**
The starting template is the golden `example-produce-verify-fix` (`plan → produce → verify`, verify reroutes to
`produce` on fail). The correct edit INSERTS a parallel review fan-out between `produce` and `verify`, so `verify`
now reads the reviewers' reads in addition to `out/**`.
- must (the fragment): N parallel review workers (N = 2–5), each `--dep produce`, each reading `{{RUN}}/out/**`
  (the produced artifact) and NONE reading a sibling; bound to `reviewer` (read-only). This is a fan-out with the
  join folded INTO the existing `verify` (verify plays the reduce role — no NEW reduce node is required, though a
  separate consensus node feeding verify is also acceptable).
- must (the 3 insert disciplines, §4 of the guide — this is what T7 actually tests):
  1. **id-namespacing** — the new nodes carry a fragment prefix (e.g. `review-a`/`review-b` or `rev-*`), no id
     collides with `plan`/`produce`/`verify`.
  2. **write-disjointness** — each reviewer `owns` a DISJOINT namespaced path (e.g. `{{RUN}}/review/<worker>/**`
     or `review/<worker>.json`); no two reviewers share an `owns`, and none overlaps `out/**` or `verify/**`.
  3. **boundary-seam binding** — the input seam is bound to the surrounding DAG: each reviewer's read resolves to
     `produce`'s `out/**` (the edge `produce → review-*` auto-forms); the output seam is bound by making `verify`
     `--dep` on every reviewer AND extending `verify`'s `readScope` to include the reviewers' outputs (so the edge
     `review-* → verify` auto-forms). `extract` shows `produce → {review-*} → verify` with verify still rerouting.
- must (loop preserved): the original `verify → produce` reroute (`op rerouteTo{produce, K}`) is STILL present and
  unbroken; `produce`, `plan` unchanged in role.
- must-not: re-stamping a fresh DAG from scratch (T7 is an INSERT into the existing dir); reviewers that WRITE
  into `out/**` (they are read-only judges, not producers); a reviewer reading another reviewer (kills
  independence); an id collision or a shared/overlapping `owns` (that is the write-disjointness failure `extract`
  catches); inserting the panel AFTER `verify` (it must inform the gate, not run past it); deleting the reroute
  loop.
- lane range: 2–5 review workers. PASS ⟺ `extract` exit 0 AND all `must` hold AND no `must-not`.

## T8 — add a packaging step after the gate → **HAND-ADD one node**
The starting template is the same golden `example-produce-verify-fix`. The correct edit is a SINGLE hand-added
node appended to the tail — no fan-out, no fragment.
- must: exactly ONE new node (e.g. `package`/`publish`/`release`) with `--dep verify`, reading the accepted
  artifact `{{RUN}}/out/**` (and/or `{{RUN}}/verify/**`), owning a disjoint fresh path (e.g. `{{RUN}}/release/**`)
  and emitting the release bundle artifact there; `--on-fail block`. Bound to a sensible preset (`author`,
  `coder`, or `general-purpose` — the critic judges the SLOT, not the exact id).
- must: it runs strictly AFTER the gate — `deps` includes `verify` (so it only fires once the artifact passed);
  the edge `verify → package` forms via the dep and/or the `out/**` read; the existing reroute loop is untouched.
- must-not: MORE than one new node (T8 is a single HAND-ADD, not a fragment/panel); the new node depending on
  `produce` instead of `verify` (it must run after acceptance, not race the gate); an `owns` that overlaps
  `out/**` or `verify/**` (non-disjoint → `extract` red); re-stamping the whole DAG; touching/deleting the
  reroute loop.
- lane range: exactly 1 new node. PASS ⟺ `extract` exit 0 AND all `must` hold AND no `must-not`.

---

## Test-the-test — the concrete falsifier procedure (run this to prove the critic discriminates SHAPE)

The eval is only trustworthy if a WRONG-shape DAG that still compiles (`extract`-green) is scored FAIL. Run these
two planted negatives; each MUST come back FAIL. If either comes back PASS, the critic is rubber-stamping
`extract`-green and the whole eval is VOID until the critic is fixed.

1. **Planted map-reduce of T6 (the primary falsifier).** Hand the critic — against the **T6** reference entry — a
   stamped `fan-out-map-reduce` DAG for T6: e.g. 3 parallel `fixer-1/2/3` workers (each `deps:[]`, disjoint
   `owns` `work/fixer-N/**`, each implementing the function independently) → one `consensus` reduce node (`deps`
   all three) that votes/merges into `out/result.md`. This DAG IS `extract`-green (disjoint owns, no dangling
   reads, no cycle) — so it passes the mechanical gate. The critic MUST still return **FAIL**, citing T6's
   `must-not`: no sequential produce→verify gate loop, no reroute, and no independent shards to fan out (one
   function judged by one test is inherently serial). A PASS here means the critic checked only `extract`-green.

2. **Planted no-panel edit of T7 (the INSERT falsifier).** Hand the critic — against the **T7** reference entry —
   a copy of the golden with a SINGLE hand-added `review` node between `produce` and `verify` (one reviewer, not a
   panel), OR a copy where the reviewers all share one `owns` path. Both compile only in the single-node case; the
   shared-`owns` case is caught by `extract` (write-disjointness). For the single-reviewer case (`extract`-green),
   the critic MUST return **FAIL** against T7's `must` (N ≥ 2 independent reviewers) — proving the critic scores
   the fan-out WIDTH and the insert disciplines, not just "a node was added." A PASS here means the critic is not
   checking the panel shape.
