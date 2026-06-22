---
name: workflow-intake
description: >-
  Get a workflow INTO @piflow/core's typed WorkflowSpec form — the SDK's on-ramp. TRIGGER when you need
  to PORT an existing Claude Code Workflow .js (the agent()/parallel()/pipeline()/phase() form) into a
  WorkflowSpec, or INIT a new WorkflowSpec for the SDK (compile/runWorkflow). This skill is a TRIAGE: it
  identifies which intake condition you're in and routes to the one reference + script that handles it.
  Use it for "convert my workflow to the SDK", "parse a Claude workflow", "extract→WorkflowSpec bridge",
  "author a piflow workflow".
---

# workflow-intake — triage to the right intake path

The SDK (`@piflow/core`) runs a **`WorkflowSpec`** (a flat bag of typed `NodeIntent`s that `compile()` turns
into a DAG). Getting a workflow into that form has a few distinct **conditions**, each with its own method.
This file ONLY triages — it names your condition and routes you. The actual craft (how to do each one) lives in
the matching `references/` file, and any programmatic step is a `scripts/` tool. **Do not inline the procedure
here.**

## Triage — pick the row that matches what you have

| You have… | Condition | Go to | Status |
|---|---|---|---|
| A proven Claude Code Workflow `.js` (`agent()`/`parallel()`/`pipeline()`/`phase()`) | **PORT** (parse → WorkflowSpec) | `references/parse-claude-workflow.md` + `scripts/parse-claude-workflow.mjs` | ✅ implemented |
| Only a task/goal, no workflow yet | **INIT / COMPOSE** (author a WorkflowSpec from a task) | — | ⛔ not yet — do not improvise; stop and flag |
| A workflow in some other format (YAML/JSON/another engine) | **IMPORT** | — | ⛔ not yet |

## Rules
- **Match exactly one condition, then route.** If none matches (or the row says "not yet"), STOP and say so —
  do not hand-roll an unsupported intake; that is how a silent, wrong WorkflowSpec gets built.
- **The script is the bridge; its 0 exit is the oracle.** A programmatic condition (PORT) ends by `compile()`ing
  its own output and checking the DAG survived — trust the exit code, not a glance at the JSON. A non-zero exit
  means the spec is not trustworthy; fix the cause named in the error, never hand-edit around it.
- **Mechanical port = the floor, not the finish.** Each reference names what its script CANNOT recover (data-flow
  reads, hooks, the new contract decisions) and how to refine it. Read that section before you ship the spec.
- **New conditions are new rows + a new reference + (if programmatic) a new script — never more prose in this
  file.** Keep the triage thin.
