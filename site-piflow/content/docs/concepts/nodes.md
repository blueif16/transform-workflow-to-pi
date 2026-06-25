---
title: "Nodes and envelopes (L1)"
summary: "A node is one agent fully described by a declarative envelope: work, sandbox, tools, hooks, and contract."
read_when:
  - You want to understand what a single node is
  - You are writing or editing a node envelope
order: 2
draft: true
---

> Draft — expand from the L1 envelope canon (`../../docs/design/l1-node-envelope.md`). Keep the
> public version conceptual; the canonical field-by-field schema is owned by `packages/` and the
> [WorkflowSpec reference](/docs/reference/workflow-spec).

A node is one agent described by a declarative **envelope** with five parts:

- **work** — what the node does
- **sandbox** — where it runs and what it can touch
- **tools** — the callable surface it is granted
- **hooks** — deterministic behavior wired at its edges
- **contract** — the output it must produce for the next node

The envelope compiles to one headless `pi`.
