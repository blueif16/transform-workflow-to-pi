# transform-workflow-to-pi

A [Claude Code](https://claude.com/claude-code) **skill** that takes any Claude Code Workflow
you've already proven — a `.claude/workflows/*.js` script using
`agent()` / `parallel()` / `pipeline()` / `phase()` — and runs the **identical** pipeline cheaply
on a fleet of [pi agents](https://github.com/earendil-works/pi) driven by non-Claude
coding-plan models, with Claude Code as the single console and monitor.

**One-line model:** the Claude Code Workflow `.js` is the single source of truth; the `pi-runner`
harness *extracts* the exact realized prompts + DAG from that same file and replays them, one cheap
`pi` process per node, while Claude Code owns the graph and polls `run-status.json`.
**No port, no codegen, no hand-sync, no drift.**

```
Claude Code (you) ── 1 driver per instance ─► run.mjs (owns the DAG)
                                               │ extract.mjs runs workflow.js under recording stubs
                                               │ → exact prompts + parallel lanes
                                               ▼  one `pi` per node (non-Claude coding-plan model)
                              <repo>/* artifacts + out/<id>/run-status.json  (you poll)
```

## Why

You proved a workflow on Claude (expensive, capable). Now you want to run it for cheap / at scale
without rewriting it. Because `pi-runner` *extracts* prompts from the same `.js` rather than
re-implementing them, new/removed/reordered waves propagate for free and the two executors can
never drift.

## Install

This is a Claude Code skill. Make it discoverable by placing (or symlinking) the folder under your
skills directory:

```bash
ln -s "$(pwd)" ~/.claude/skills/transform-workflow-to-pi
```

Claude Code will surface it whenever someone asks to "run my workflow on pi", "run this on a cheap
model", "pi-runner", or "offload the workflow to cheaper agents".

## Contents

| Path | What it is |
| --- | --- |
| `SKILL.md` | The skill itself — the six-step transform and the laws. |
| `reference/architecture.md` | Why the workflow runs unchanged: the four invariants, observability tiers, the one dynamic-workflow caveat. |
| `reference/orchestration.md` | Claude-Code-as-console: dry-run → background live → poll `run-status.json`, fleet, `--until`, debug vs production. |
| `reference/provider-and-headless.md` | Provider registration, `.env`, and the headless pi invariants / watchdog. |
| `templates/pi-runner/` | Copy this whole folder into a repo **verbatim**. The engine files stay byte-identical across every repo; `.env` (from `.env.example`) is the only file you fill in. |

## Quickstart (the transform, condensed)

1. **Confirm the source of truth** — exactly one `.claude/workflows/<name>.js`, `export const meta`
   pure literal, body uses only Workflow hooks. You edit and prove it on Claude; pi inherits it.
2. **Drop in the harness verbatim** — copy `templates/pi-runner/` next to `.claude/`. Edit none of
   the engine files (`run.mjs`, `extract.mjs`, `providers/coding-plan.ts`).
3. **Configure `.env`** (the only per-repo surface) — `cp templates/pi-runner/.env.example
   pi-runner/.env`, then set wiring (`PI_RUNNER_WORKFLOW`, `PI_RUNNER_CWD`) and model/credential
   (`CODING_PLAN_API_KEY`, `PI_CP_BASE_URL`, `PI_CP_MODEL`) for any OpenAI-compatible endpoint.
4. **Sanity-check the DAG (free)** — `node pi-runner/extract.mjs` prints the realized stages, no
   model invoked.
5. **Dry-run (free), then live (background, `--debug`)**:
   ```bash
   node pi-runner/run.mjs --run <id> --arg <k=v> --until <phase> --dry-run
   node pi-runner/run.mjs --run <id> --arg <k=v> --until <phase> --debug
   ```
6. **Monitor as the console** — poll `out/<id>/run-status.json` (verified status: `ok` requires
   artifacts on disk). Fleet = one background driver per instance.

## The laws

- **Single source of truth = the workflow `.js`.** Improve a wave by editing its prompt/skill and
  re-proving on Claude; pi runs the new prompts automatically.
- **The engine files never diverge.** `run.mjs` / `extract.mjs` / `coding-plan.ts` stay
  byte-identical across every repo and this template; 100% of per-repo specifics live in `.env`.
- **Extraction, not codegen.** `extract.mjs` runs the workflow under recording stubs and captures
  the exact prompts + grouping.
- **Driver owns the graph; pi owns the node.** Plain code decides stage order + parallel lanes +
  halt-on-failure; the model never decides control flow. Nodes coordinate via the filesystem.
- **Verified, not trusted.** Each node ends with one fenced ` ```json ` block; the driver `stat()`s
  every `outputArtifact`. `ok` ⇒ files exist on disk.
- **Headless invariants are non-negotiable.** Close stdin, `--offline`, `--no-extensions` + explicit
  `-e` provider, always `--debug` while developing.

## Security

No secrets ship in this repo. `.env.example` contains only placeholders (`sk-REPLACE_ME`,
`your-provider.example.com`); the bundled `.gitignore` excludes the real `.env`. Never commit a
filled-in `pi-runner/.env`.

## License

MIT
