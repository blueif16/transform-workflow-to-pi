---
title: "Architecture"
summary: "The orchestration substrate: two node kinds, three levels, three modes, three loops, and one observe stream."
read_when:
  - You want the mental model of how Pi Flow fits together
  - You are deciding where a new capability belongs (node vs seam vs control plane)
order: 1
---

Pi Flow is a graph of **full-agent (`pi`) nodes** coordinated through the filesystem. An agent
*designs* the graph, an efficient fleet *runs* it, and a control plane *observes and improves* it.

## Two node kinds

- **Producer node** — a full autonomous `pi` agent that does the task (not a thin LLM call).
- **Control node (seam)** — holds intelligence *about the workflow*: plan, optimize, debug, or gate.
  It always lives on a **seam** between producer nodes.

## The three levels

- **L1 — the node.** One agent described by a declarative [envelope](/docs/concepts/nodes):
  work · sandbox · tools · hooks · contract. Compiles to one headless `pi`.
- **L2 — COMPOSE.** An agent designs the flow tool-aware and emits a flat `WorkflowSpec`; the SDK
  `compile`s it to a DAG. A human-authored imperative workflow and an agent-authored spec compile to
  the **same** DAG. See [Compose](/docs/concepts/compose).
- **L3 — control plane.** Run · observe · intervene · learn — control nodes on the seams (the
  debug→Hermes ladder, the stuck-node governor, the background supervisor). See
  [Control plane](/docs/concepts/control-plane).

## The three modes

- **COMPOSE** — build the workflow.
- **RUN + LEARN** — execute, grade, improve.
- **CHAIN** — splice workflows together at a seam.

## The three loops

- **Inner** — within a single run.
- **Middle** — across runs of one task.
- **Outer** — Hermes, across tasks.

## One observe stream

The GUI, the TUI, and the `watch` sentinel are **monitor-only twins**. They all consume the one live
stream — `@piflow/core/observe`'s `watchRun` / `readRunModel` — re-derived **verified-not-trusted**
from the on-disk run layout. There is exactly one reader; the views never reimplement run state and
never diverge. See [Observe](/docs/concepts/observe).
