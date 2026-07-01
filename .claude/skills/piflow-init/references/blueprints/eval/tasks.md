# Compose-eval tasks (the COMPOSE agent sees ONLY this file + the authoring layer)

Each task is a real workflow NEED. Reason it into a DAG, pick the matching blueprint shape(s) from the catalog,
size the holes, and stamp/insert an `extract`-green template into the given scratch dir. Write each `prompt.md`
task-only. Do NOT read `reference.md`.

Tasks are stated as a SITUATION and its constraints, never as a topology — deciding the shape is the test. T1–T6
build a fresh DAG (a whole-blueprint STAMP). T7–T8 start from an EXISTING template you must edit in place (an
INSERT of a fragment, and a single HAND-ADD node) — do not re-stamp them from scratch.

---

## T1 — cold-outreach workflow, from a standing start
We want to stand up a cold-outreach system, but nobody here knows today's best practices, and the unknowns sit in
three areas that don't depend on each other: how to keep email landing in the inbox, where to get accurate contact
data, and how to read campaign results. I need each area studied deeply enough that we could commit to real
choices on it — and none of them should wait on or borrow from the others while that studying happens — then one
coherent design that reconciles all three, and finally the actual workflow template that design calls for. Stamp
into `<scratch>/t1`.

## T2 — a config file that must be exactly right
Turn a written spec into a deployment config file. The spec ships strict validation rules and the file is
worthless if it violates any of them, so a wrong file must not be allowed to stand: after it's generated, something
has to check it against those rules and, when it's off, send it back to be corrected and re-checked, over and over
within a sane attempt budget, until it's clean. There is exactly ONE file to deliver. Stamp into `<scratch>/t2`.

## T3 — is this design doc any good?
I have a single design doc and I want a trustworthy assessment of it. I don't want one opinion, and I don't want
one assessor's take to color the next — each assessment has to be formed against the same rubric with no knowledge
of what the others concluded, so their agreement (or disagreement) actually means something. Then I need those
separate verdicts pulled into ONE decision I can act on, with the blocking issues called out. Stamp into
`<scratch>/t3`.

## T4 — a small service where the interface is decided once, up front
Build a small service. The one thing that must be pinned down before anything else is the interface — the data
types, the handler signatures, the contract — because every piece is written against it and they can't be allowed
to drift from each other. Once that's fixed, three different pieces get written: the data types, the request
handlers, and the tests. Those pieces touch different files and never overlap, so there's no reason to write them
one after another. Then confirm the pieces agree with the fixed interface, and assemble them into the finished
module. Stamp into `<scratch>/t4`.

## T5 — an explainer I don't want one model to write alone
Produce a technical explainer, but I don't trust any single model's one-shot attempt at it. For the initial draft
I want several different model tiers to each take a swing at it, and one arbiter to fold those separate attempts
into a single draft that's better than any one of them. After that, I want the draft made more robust — have a
model take several independent passes at improving it and keep whichever pass came out best — before it's
published. The two moves (the initial multi-attempt draft, then the robustness pass) happen back to back on ONE
artifact. Stamp into `<scratch>/t5`.

## T6 — get one function to green (the falsifier task)
There's one function to implement against a spec, and one test that decides whether it's right. Write the function,
run the test, and if it's red, diagnose and correct it, re-running the test after each attempt until it passes —
giving up after a few attempts rather than trying forever. It is a single function judged by a single test — there
is nothing here to split up and nothing to take a vote on. Stamp into `<scratch>/t6`.

---

## T7 — add a review panel to an existing self-fix pipeline (INSERT)
Start from the EXISTING template at `.piflow/example-produce-verify-fix/template/` — copy it into `<scratch>/t7`
and edit that copy in place; do NOT re-author it from scratch. Today it goes plan → produce → verify (verify gates
the produced artifact and reroutes to produce on fail). The team wants more eyes on the artifact BEFORE the gate:
several reviewers should each look at what `produce` wrote and each record their own read, without seeing each
other's, and the existing `verify` gate should then take those reads into account when it decides pass/fail. Add
that review step into the existing pipeline (keep the current reroute loop intact). Leave the result in
`<scratch>/t7`.

## T8 — add a packaging step to an existing pipeline (HAND-ADD)
Start from the EXISTING template at `.piflow/example-produce-verify-fix/template/` — copy it into `<scratch>/t8`
and edit that copy in place; do NOT re-author it from scratch. Once `verify` has passed the artifact, there is one
more thing missing: nothing turns the accepted artifact into the shippable release bundle (a versioned package
with a short release note). Add that final step so it runs after the artifact is accepted and produces the release
bundle. It is a single, one-off finishing task. Leave the result in `<scratch>/t8`.
