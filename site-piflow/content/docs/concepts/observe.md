---
title: "Observe"
summary: "One live stream from the on-disk run layout, re-derived verified-not-trusted; the GUI, TUI, and watch are monitor-only twins of it."
read_when:
  - You want to understand how runs are observed without drift
order: 5
draft: true
---

> Draft — expand from the observability-pipeline canon and `reference/observability.md`.

Every view of a run reads the **one** stream: `@piflow/core/observe`'s `watchRun` / `readRunModel`,
re-derived **verified-not-trusted** from the on-disk run layout. The GUI, the TUI, and the `watch`
sentinel are **monitor-only twins** — there is exactly one reader, so the views never reimplement run
state and never diverge. The rich run-view is distilled from the `.pi` run directory on demand.

See also the [run-view reference](/docs/reference/run-view).
