---
title: "WorkflowSpec"
summary: "The flat workflow spec the design agent emits and the SDK compiles to a DAG, and the template layout on disk."
read_when:
  - You need the schema of a workflow template or a node
order: 2
draft: true
---

> Draft — this is the canonical public home for the spec. The field-by-field schema is owned by
> `packages/core` (the template loader + node schema); generate or verify this page against that
> source so it cannot drift.

## Template layout

A workflow's source of truth is a structured template:

```
.piflow/<workflow>/template/
```

`@piflow/core` loads it into a `WorkflowSpec` and `compile`s that to a DAG, running one `pi` per
node.

## Node envelope

Each node is a declarative envelope: **work · sandbox · tools · hooks · contract**. See
[Nodes and envelopes](/docs/concepts/nodes) for the concept.

<!-- TODO: pull the authoritative field tables from packages/core/src/workflow/template/schema. -->
