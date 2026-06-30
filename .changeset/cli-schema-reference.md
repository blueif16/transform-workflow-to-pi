---
"@piflow/cli": minor
---

`piflowctl schema` — a self-describing, topic-segmented CLI reference for authoring agents.

A fresh agent composing a workflow can pull just the slice it needs instead of reading the whole flag
firehose:

- `piflowctl schema` → a one-line-per-topic INDEX (no flags front-loaded).
- `piflowctl schema <topic>` → that topic's concise flag grammar + load-bearing gotchas. Topics: `node`,
  `tools`, `agent`, `routing`, `derive`, `checks`, `control`, `judge`, `hitl`, `topology`, `contract`,
  `commands`.
- `piflowctl schema --json [node|meta|workflow]` → the formal `@piflow/core` JSON Schema (a re-export of
  the SDK's own frozen schema objects, never a copy — it can't drift from the SDK).

A single `CLI_TOPICS` source is rendered into BOTH `piflowctl schema` AND the `add-node` `--help`, so the
reference an agent reads and the help can never diverge (pinned by a single-source test, and a coverage
test that asserts every add-node flag lives in exactly one topic).
