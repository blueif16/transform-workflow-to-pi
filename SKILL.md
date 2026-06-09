---
name: transform-workflow-to-pi
description: >-
  Take any Claude Code Workflow (a `.claude/workflows/*.js` script that uses agent()/parallel()/
  pipeline()/phase()) and run the IDENTICAL pipeline cheaply on a fleet of pi agents
  (pi.dev / earendil-works/pi) driven by non-Claude coding-plan models — with Claude Code as the
  single console and monitor. Use when someone wants to run a proven Workflow at lower cost / at
  scale, "run my workflow on pi", "run this on a cheap model", "pi-runner", "offload the workflow
  to cheaper agents", or to stand up the pi-runner harness in a new repo. Ships copy-paste
  templates (extract.mjs, run.mjs, provider extension, .env) so any project can adopt it.
---

# Transform a Claude Code Workflow → pi agents

**One-line model:** the Claude Code Workflow `.js` is the single source of truth; pi-runner
*extracts* the exact realized prompts + DAG from that same file and replays them, one cheap `pi`
process per node, while Claude Code owns the graph and monitors `run-status.json`. **No port, no
codegen, no hand-sync, no drift.**

```
Claude Code (you) ── 1 driver per instance ─► run.mjs (owns the DAG)
                                               │ extract.mjs runs workflow.js under recording stubs
                                               │ → exact prompts + parallel lanes
                                               ▼  one `pi` per node (non-Claude coding-plan model)
                              <repo>/* artifacts + out/<id>/run-status.json  (you poll)
```

## When this applies
- You have a Workflow you've **already proven on Claude** (it runs via the `Workflow` tool) and
  want to run it for cheap / at scale.
- The workflow is **pipeline-shaped**: a fixed set of waves over one input, coordinating through
  the filesystem. (Data-driven fan-out needs one extra step — see `reference/architecture.md`
  "Dynamic workflows".)
- You want Claude Code to stay the operator: it runs everything, the user runs nothing.

If there is **no** workflow yet, write and prove one with the `Workflow` tool first. This skill
transforms an existing workflow; it does not author the pipeline logic.

## The transform — six steps

1. **Confirm the source of truth.** There is exactly one `.claude/workflows/<name>.js`, it begins
   with `export const meta = {…}` (a pure literal), and its body uses only the Workflow hooks
   (`agent`/`parallel`/`pipeline`/`phase`/`log`/`args`/`budget`) — no `import`/`export` besides
   `meta`, and top-level `return`/`await` are fine. You **edit and prove the workflow on Claude**;
   pi inherits it. Never edit pi's copy of a prompt — there is no copy.

2. **Drop in the harness — verbatim.** Copy `templates/pi-runner/` into the repo (alongside
   `.claude/`): `extract.mjs`, `run.mjs`, `providers/coding-plan.ts`, `.env.example`, `.gitignore`.
   **You edit none of them.** All three engine files are generic and meant to stay byte-identical
   across every repo (and this template) — that is precisely how the repo copy and the template
   never diverge: a future fix is a one-file copy, never a manual merge.

3. **Configure everything in `.env` (the only per-repo surface).** `cp templates/pi-runner/.env.example
   pi-runner/.env`, then set:
   - **Wiring** — `PI_RUNNER_WORKFLOW` (path to the `.js`, relative to repo root) and, if your
     build runs in a subpackage, `PI_RUNNER_CWD` (where pi executes + where node-reported relative
     artifact paths resolve). `PI_RUNNER_ROOT` defaults to `pi-runner/`'s parent — usually leave it.
     Optionally `PI_RUNNER_UNTIL` to set a default `--until` during bring-up.
   - **Model/credential** — `CODING_PLAN_API_KEY`, `PI_CP_BASE_URL`, `PI_CP_MODEL` for any
     OpenAI-compatible coding-plan endpoint. Set once; swap providers by editing `.env`, never code.

   See `reference/provider-and-headless.md`.

4. **Sanity-check the DAG (free).** `node pi-runner/extract.mjs` prints the realized stages — no
   model invoked. Confirm node count + parallel lanes match the workflow you proved on Claude.

5. **Dry-run (free), then live (background, `--debug`).**
   ```bash
   node pi-runner/run.mjs --run <id> --arg <k=v> --until <phase> --dry-run   # prints exact pi cmds
   node pi-runner/run.mjs --run <id> --arg <k=v> --until <phase> --debug     # live; run in background
   ```
   Pass the workflow's `args` with `--arg k=v` (repeatable) and `--arg-file k=path` (reads file
   text, e.g. `--arg-file brief=./brief.md`). `--until` brings a long pipeline up one block at a
   time so a bare run can't hit a later toolchain wall.

6. **Monitor as the console.** Poll `out/<id>/run-status.json` (verified status — `ok` requires
   artifacts on disk). Fleet = one background driver per instance, poll each status. See
   `reference/orchestration.md`. **You run every command; the user runs nothing.**

## The laws (do not violate)
- **Single source of truth = the workflow `.js`.** Improve a wave by editing its prompt/skill in
  the workflow and re-proving on Claude; pi runs the new prompts automatically. Zero hand-sync.
- **The engine files never diverge.** `run.mjs` / `extract.mjs` / `coding-plan.ts` stay
  byte-identical across every repo and this template; 100% of per-repo specifics live in `.env`.
  A fix is a one-file copy. If you find yourself editing an engine file for one repo, you're
  introducing the drift this whole pattern exists to prevent — push it into `.env` instead.
- **Extraction, not codegen.** `extract.mjs` runs the workflow under recording stubs and captures
  the exact prompts + grouping. New/removed/reordered waves propagate for free.
- **Driver owns the graph; pi owns the node.** Plain code decides stage order + parallel lanes +
  halt-on-failure; the model never decides control flow. Nodes coordinate via the filesystem.
- **Verified, not trusted.** Each node ends with one fenced ```json``` block; the driver `stat()`s
  every `outputArtifact`. `ok` ⇒ files exist on disk, regardless of what the model claimed.
- **Headless invariants are non-negotiable.** Close stdin, `--offline`, `--no-extensions` + explicit
  `-e` provider, always `--debug` while developing (heartbeat + 45s stall flag + node-timeout). A
  silent headless hang is otherwise invisible — this cost a real ~10-minute mystery stall.

## Files in this skill
- `reference/architecture.md` — why the workflow runs unchanged: the four invariants, the
  observability tiers, and the one dynamic-workflow caveat. **Read this to understand the pattern.**
- `reference/orchestration.md` — Claude-Code-as-console: dry-run → background live → poll
  `run-status.json`, fleet, `--until`, debug vs production. **Read this to operate a run.**
- `reference/provider-and-headless.md` — provider registration, `.env`, and the headless pi
  invariants/watchdog. **Read this for setup + when a node hangs.**
- `templates/pi-runner/` — copy this whole folder into a repo **verbatim**. `run.mjs` +
  `extract.mjs` + `coding-plan.ts` are the generic engine (stay byte-identical); `.env` (from
  `.env.example`) is the only file you fill in — wiring + credential.

## Reference implementation
The original, battle-tested instance lives in the `animation-test` repo at `pi-runner/` (the
`lesson-build` workflow → 14 nodes / 10 stages with parallel voice/asset/compose lanes). Its
`run.mjs` / `extract.mjs` / `coding-plan.ts` are **byte-identical** to these templates — the
animation-test instance was converged onto this generic engine, with its wiring
(`PI_RUNNER_CWD=remotion-svg-primitives`, `PI_RUNNER_WORKFLOW=.claude/workflows/lesson-build.js`,
`PI_RUNNER_UNTIL=design`) living in its gitignored `.env`. When in doubt about a detail, that
repo is the worked example; to re-sync after a template fix, `cp` the three files.
