---
title: "Author a workflow"
summary: "Use piflow-init to create a workflow template, or port one from a Claude .js file or an n8n export."
read_when:
  - You want to create a new workflow
  - You are porting an existing workflow onto Pi Flow
order: 1
---

Authoring is the **COMPOSE** step. The `piflow-init` skill triages your starting point and builds
the template:

- **COMPOSE fresh** — design a new DAG from a description.
- **PORT** — convert an existing Claude `.js` workflow.
- **IMPORT** — bring in another engine's workflow (n8n / YAML / JSON).

## The template is the source of truth

The output is a structured **template** at `.piflow/<workflow>/template/`. `@piflow/core` loads it
into a `WorkflowSpec` and runs one `pi` per node. The template — not any UI — is what you edit,
review, and version.

See the [WorkflowSpec reference](/docs/reference/workflow-spec) for the schema, and
[Run on Pi](/docs/guides/run-on-pi) to execute it.
