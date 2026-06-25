---
title: "Compose (L2)"
summary: "An agent designs the flow and emits a flat WorkflowSpec; the SDK compiles it to a DAG."
read_when:
  - You want to understand how a workflow is authored
order: 3
draft: true
---

> Draft — expand from the orchestration-substrate canon. Cross-link the
> [WorkflowSpec reference](/docs/reference/workflow-spec) for the schema.

At COMPOSE time an agent designs the flow tool-aware and emits a **flat `WorkflowSpec`**. The SDK
`compile`s that spec into a DAG. The key property: a human-authored imperative workflow and an
agent-authored spec compile to the **same** DAG — author once, the fleet inherits it.
