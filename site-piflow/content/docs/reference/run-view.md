---
title: "run-view.json"
summary: "The rich run-view distilled from the .pi run directory on demand and shared by every observer."
read_when:
  - You need the shape of run-view.json
order: 3
draft: true
---

> Draft — canonical home for the run-view shape. Generate or verify against the `@piflow/core/observe`
> model so it stays in lockstep with the reader.

`run-view.json` is the rich, distilled view of a run, derived **on demand** from the `.pi` run
directory by `@piflow/core/observe`. Every observer (GUI, TUI, `watch`) reads the same model via
`watchRun` / `readRunModel`, re-derived verified-not-trusted — so the shape documented here is the
one all surfaces share. See [Observe](/docs/concepts/observe).

<!-- TODO: pull the authoritative field tables from the observe model in packages/core. -->
