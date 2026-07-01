---
"@piflow/cli": minor
---

Add `piflowctl skills install [targetDir] [--force]` — ship the workflow-authoring skills into a target repo.

A fresh Claude Code agent in ANY repo can now run one command to get piflow's authoring brain (the
`piflow-init` / `piflow-start` / `piflow-enhance` trio) into that repo's `.claude/skills/`, so it's equipped
to compose workflows against the SDK. The trio is bundled in the npm tarball; a source checkout falls back to
the repo's canonical `.claude/skills/`.

No-drift design: the canonical skill source stays repo-root `.claude/skills/` (the one editable copy); the
packaged copy under `packages/cli/skills/` is a generated build artifact (a `prepack` step), gitignored and
never hand-edited — the same discipline as a generated `workflow.json`. Install is a byte-faithful copy
(an installed `SKILL.md` is byte-identical to its canonical source); an existing skill dir is kept unless
`--force`.
