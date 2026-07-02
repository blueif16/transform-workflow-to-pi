# Compose eval — can a skill spot the correct DAG for a real workflow?

This is the acceptance test for the whole blueprint layer. It does NOT test the SDK (that is `extract` +
`tsc`); it tests whether an agent, given a real workflow NEED and the authoring guide, **composes the DAG whose
shape actually solves it** — the right blueprint(s), sized right, wired right. Per `test-discipline`, a skill is
gated by an eval, not unit tests.

The tasks state only the SITUATION and its constraints — never a topology, a reduce mode, or a blueprint's
trigger words — so choosing the shape requires REASONING about the work, not keyword-matching a task line to a
recipe's opening line. The 8 tasks also cover all THREE compose ops from the authoring guide (§3): T1–T6 are
whole-blueprint **STAMP**s; T7 is an **INSERT** of a fragment into an existing template (exercising the 3 insert
disciplines — id-namespacing, write-disjointness, boundary-seam binding); T8 is a single **HAND-ADD** node onto
an existing DAG.

## Protocol (per task)

1. **Compose.** Give a COMPOSE agent ONLY the task prose (`tasks.md`, one task) + the authoring layer
   (`AUTHORING-GUIDE.md`, the `README.md` catalog, the blueprint `.md`s, the presets). It reasons the task into
   a DAG via the scaffold loop — for a STAMP task it authors a fresh template into a scratch dir; for the INSERT
   (T7) and HAND-ADD (T8) tasks it copies the named existing template into the scratch dir and EDITS it in place.
   It NEVER sees `reference.md`.
2. **Mechanical gate.** Run `piflowctl extract <scratch-dir>`. Exit ≠ 0 ⇒ the task FAILS outright (a DAG that
   does not compile cannot be the answer).
3. **Topology judge.** A SEPARATE critic agent is given the stamped DAG (the `extract` output + the `node.json`
   set) AND that task's `reference.md` entry, and scores the SHAPE match — never byte-identity. It returns
   PASS/FAIL + evidence against the reference's `must` / `must-not` list.
4. **Task PASS** ⟺ `extract` exit 0 AND the critic returns PASS.

## Suite bar (all must hold)

- Every REAL task PASSES (right shape, extract-green): the STAMPs (T1–T5), the INSERT (T7 — fan-out fragment with
  all 3 insert disciplines, existing reroute loop intact), and the HAND-ADD (T8 — one post-gate node).
- **The test-the-test is CAUGHT (the eval's own falsifier):** T6 is an inherently-SERIAL self-fix task; a
  `fan-out-map-reduce` composition of it MUST score FAIL. Feed the critic the *planted* map-reduce composition of
  T6 (concrete procedure in `reference.md`) — and the planted single-reviewer T7 negative — if either scores PASS,
  the critic is not discriminating SHAPE (only "extract-green"), and the eval is void until the critic is fixed.
- Judge SHAPE, not prose. A task passes on the topology (blueprint/op choice · lane count in range · wiring
  signature · the insert disciplines), regardless of prompt wording — the task prose names no topology, so a DAG
  earns PASS only by the arrangement it CHOSE.

## Why these levers (anti-teach-to-the-test)

- `tasks.md` and `reference.md` are SEPARATE files; the COMPOSE agent sees only the task. The reference (the
  oracle) is the critic's alone — the standard is never injected into the composer (that would void the signal,
  same rule as the criteria fixture).
- The critic scores against an OBSERVABLE rubric (blueprint id, countable lane range, named wiring edges), never
  "is this a good DAG". Each `reference.md` entry carries both a `must` list and a `must-not` (the wrong shapes)
  so a plausible-but-wrong composition is caught, not rubber-stamped.
- **No task echoes its blueprint's trigger phrase.** A task describes the need, the data shape, and the failure
  feared — never the topology, the reduce mode, or the recipe's opening words — so a keyword-matcher can't win by
  aligning surface words to a recipe line; the composer must reason about the WORK. Keep it this way: when adding
  a task, confirm its blueprint id is not derivable from its surface vocabulary alone.

## Running it

Author-time, run as a small workflow: one COMPOSE lane per task → `extract` → one critic lane per task judging
against `reference.md`. Report per-task PASS/FAIL + the suite bar. (A future `piflowctl blueprint` verb, see
`docs/design/blueprint-compose-verb.md`, makes the compose step deterministic; the eval still judges the SHAPE
the agent CHOSE, which the verb does not decide.)
