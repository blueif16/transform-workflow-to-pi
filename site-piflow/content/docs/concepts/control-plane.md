---
title: "Control plane (L3)"
summary: "Run, observe, intervene, and learn — control nodes that live on the seams between producer nodes."
read_when:
  - You want to understand how Pi Flow intervenes in and improves a run
order: 4
draft: true
---

> Draft — expand from the L2/L3 boundary map and the orchestration-substrate canon.

The control plane is the *run · observe · intervene · learn* layer. Its intelligence lives in
**control nodes on the seams** between producer nodes:

- the **debug → Hermes ladder** — escalating diagnosis of a failing node
- the **stuck-node governor** — detects and unblocks a node that never wrote
- the **background supervisor** — watches the run as a whole

A control node always sits on a seam, and can wire itself in three ways: a deterministic hook, a
callable tool, or a full producer node.
