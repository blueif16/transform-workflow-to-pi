# Pi Flow

> *Repo + Claude Code skill name: `transform-workflow-to-pi`. The product/library surfaces as **Pi Flow** (`piflow`).*

**Pi Flow is a self-designing, durable, self-improving orchestration substrate** — a graph of
**full-agent (`pi`) nodes** that a planner *designs*, a cheap fleet *runs*, and a learning loop
*improves*, all coordinated through the filesystem. It generalizes a proven stack (`pi-runner` +
`game-omni` + Hermes) into a horizontal framework.

The one-line positioning (the load-bearing sentence):

> **ADAS/AFlow's structure search + GEPA's reflective module-level credit assignment — but with
> *full-agent nodes* on a *durable cheap fleet*, running *online in production*.**

Three proven parents (so we are not reinventing), three genuine deltas (so we are not merely cloning).
No single shipping system occupies that intersection — that empty space is the defensible center
(see [`docs/design/orchestration-substrate.md`](docs/design/orchestration-substrate.md) §11).

```
Claude Code (you) ── 1 driver per instance ─► run.mjs (owns the DAG)
                                               │ extract.mjs runs workflow.js under recording stubs
                                               │ → exact prompts + parallel lanes
                                               ▼  one `pi` per node (non-Claude coding-plan model)
                              <repo>/* artifacts + out/<id>/run-status.json  (you poll)
```

## Why

You prove a workflow on Claude (expensive, capable). Then you run it for cheap / at scale **without
rewriting it** — `pi-runner` *extracts* the realized prompts + DAG from the same `.js` and replays
them, one cheap `pi` process per node, while Claude Code owns the graph and polls `run-status.json`.
New/removed/reordered waves propagate for free; the two executors never drift. **No port, no codegen,
no hand-sync.** That executor is the **producer node** of the broader substrate.

## The two layers

| Layer | Where | What |
|---|---|---|
| **The product vision** | [`docs/`](docs/), [`ROADMAP.md`](ROADMAP.md) | The substrate Pi Flow is becoming — the design canon, the buildable architecture, the forward plan. **Start at [`docs/INDEX.md`](docs/INDEX.md).** |
| **The shipping skill + harness** | [`SKILL.md`](SKILL.md), [`reference/`](reference/), [`templates/pi-runner/`](templates/pi-runner/) | What runs *today*: the Claude Code skill that performs the transform, and the byte-identical engine you drop into any repo. |

**Status: Foundation.** The harness ships and runs; the substrate is at the docs + structure stage.
The strategic fork ("product vs means-to-games") is resolved to **product** — see [`ROADMAP.md`](ROADMAP.md).

## Documentation

- **[`docs/INDEX.md`](docs/INDEX.md)** — start here: reading map + the vocabulary.
- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — the buildable mechanism (two node kinds, three
  modes/loops, the seam control plane) + **what is built today vs the gaps**.
- **[`docs/design/orchestration-substrate.md`](docs/design/orchestration-substrate.md)** — the deep design +
  strategy canon (positioning, competitive map, borrow-vs-build, white-space, the fork).
- **[`docs/research/substrate-multiagent-and-runtime-2026-06-21.md`](docs/research/substrate-multiagent-and-runtime-2026-06-21.md)**
  — the evidence base (multi-agent practice + runtime-language verdict).
- **[`ROADMAP.md`](ROADMAP.md)** — the build order, framework/library shape, and guardrails.
- **[`docs/pi-agent-notes.md`](docs/pi-agent-notes.md)** — the durable knowledge record about `pi` as a headless
  executor (capabilities, mechanics, sharp edges, codex-vs-pi, backlog).

## Install (the skill)

This is a Claude Code skill. Make it discoverable by placing (or symlinking) the folder under your
skills directory:

```bash
ln -s "$(pwd)" ~/.claude/skills/transform-workflow-to-pi
```

Claude Code surfaces it whenever someone asks to "run my workflow on pi", "run this on a cheap
model", "pi-runner", or "offload the workflow to cheaper agents".

## Quickstart (the transform, condensed)

1. **Confirm the source of truth** — exactly one `.claude/workflows/<name>.js`, `export const meta`
   a pure literal, body uses only Workflow hooks. You edit and prove it on Claude; pi inherits it.
2. **Set the credential ONCE in pi's own global config** — `cp templates/models.json.example
   ~/.pi/agent/models.json`, edit `apiKey`/`baseUrl`/model ids, `chmod 600`, verify `pi --list-models cp`.
3. **Drop in the harness verbatim** — copy `templates/pi-runner/` next to `.claude/`; edit none of
   the engine files. `cp templates/pi-runner/.env.example pi-runner/.env` and set wiring only
   (`PI_RUNNER_WORKFLOW`, `PI_RUNNER_CWD`) — no secret.
4. **Sanity-check the DAG (free)** — `node pi-runner/extract.mjs` prints the realized stages.
5. **Dry-run (free), then live (background, `--debug`)**:
   ```bash
   node pi-runner/run.mjs --run <id> --arg <k=v> --until <phase> --dry-run
   node pi-runner/run.mjs --run <id> --arg <k=v> --until <phase> --debug
   ```
6. **Monitor as the console** — poll `out/<id>/run-status.json` (`ok` requires artifacts on disk).
   Fleet = one background driver per instance.

## The laws

- **Single source of truth = the workflow `.js`.** Improve a wave by editing its prompt/skill and
  re-proving on Claude; pi runs the new prompts automatically.
- **The engine files never diverge.** `run.mjs` / `extract.mjs` stay byte-identical across every
  repo; per-repo wiring lives in `.env`, the credential in pi's global `models.json`.
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
