# Compose-eval — run record (the reproducible result)

This is the CAPTURED result of running the compose eval (`README.md` + `tasks.md` + `reference.md`) by
**dogfooding the `blueprint` verb**. It turns "an agent can spot + compose the right DAG" from an asserted
claim into a recorded, reproducible run. It is a SNAPSHOT, not the final eval design — see the flexible-eval
direction at the bottom.

## Result (2026-07-01)

**8/8 tasks PASS · 8/8 extract-green · falsifiers caught 2/2.**

| Task | compose op | blueprint the blind composer picked | critic verdict |
|---|---|---|---|
| T1 | stamp† | research-synthesize-author | PASS |
| T2 | stamp | produce-verify-fix | PASS |
| T3 | stamp | fan-out-map-reduce (adjudicate) | PASS |
| T4 | stamp | spec-fanout-build | PASS |
| T5 | stamp | candidate-fusion-refine | PASS |
| T6 | stamp | produce-verify-fix | PASS |
| T7 | **insert** | fan-out-map-reduce (into example-produce-verify-fix) | PASS |
| T8 | **hand-add** | single packaging node | PASS |
| Falsifier (T6) | planted map-reduce of a serial task | — | critic **FAIL** ✓ |
| Falsifier (T3) | planted single produce-verify-fix of a panel task | — | critic **FAIL** ✓ |

† **Known gap:** `research-synthesize-author` has NO code-map wiring rule in `blueprint-wiring.ts`, so
`blueprint stamp` returned "not stampable" and the composer hand-composed it via `piflowctl new` + `add-node`
(the documented fallback). The flagship blueprint is discoverable (`list`/`show`) but not yet stampable.

## Method (how it ran)

- **Blind composers** (one per task) saw ONLY the task's plain-English NEED (no oracle, no blueprint name) +
  the authoring guide + the `blueprint` verb. Each ran `blueprint list` → `show <id>` → authored a lane-plan →
  `blueprint stamp|insert` (or `add-node` for hand-add) into a scratch dir → `extract` (must exit 0).
- **Independent critics** (one per task) held `reference.md` (the hidden oracle) and judged SHAPE — right
  topology + load-bearing wiring — PASS/FAIL. extract-green is necessary but NOT sufficient (a mis-wired-but-
  valid DAG must still FAIL).
- **Falsifiers:** two planted-WRONG compositions (a map-reduce of the inherently-serial T6; a single
  produce-verify-fix loop of the independent-panel T3) fed to the critic, which MUST return FAIL — proving the
  critic checks shape, not just extract-green.

## Reproduce

1. Build the worktree CLI: `npx tsc -b packages/cli` → `packages/cli/dist/cli.js`.
2. Seed a hermetic `PIFLOW_HOME` (never touch the real `~/.piflow`): copy
   `references/agent-presets/*.md` → `$HOME/agents/` and `references/blueprints/*.md` → `$HOME/blueprints/`.
3. Run each task's need through a composer that invokes
   `PIFLOW_HOME=$HOME node packages/cli/dist/cli.js blueprint list|show|stamp|insert`, then a critic holding
   `reference.md`. (This run used a Workflow harness of 8 compose→critic pairs + 2 falsifiers.)

## Direction (do NOT freeze this as the eval)

Per the 2026-07-01 steer: the real eval must be **flexible** — real workflows are complex and varied, not these
8 fixed tasks. The next iteration should test that an agent UNDERSTANDS + applies the blueprint knowledge to
arbitrary needs (drawn from the SDK registry), and should run on **Sonnet 5**, not Opus. These 8 goldens stay
as the verb's round-trip fixtures; the reasoning eval evolves separately.
