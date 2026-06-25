---
title: "Data boundaries"
summary: "Per-product data lives in the repo; the global index and snapshots live in ~/.piflow. The SDK stays product-agnostic."
read_when:
  - You want to know where templates, runs, and the global index live
order: 6
draft: true
---

> Draft — keep in sync with the project's data-boundary rule (repo `CLAUDE.md`).

Pi Flow keeps a strict separation:

- **Per-product / per-repo data** — templates, runs, `run-view.json` — lives **in that
  product/repo**.
- **Global mapping, index, and snapshots** live in the home global dir **`~/.piflow/`**
  (`products.json` = registered repos; `index.json` = the unified snapshot), parallel to the pi
  runtime's `~/.pi/`.
- The **SDK (`@piflow/core`) is logic only** and stays product-agnostic — it never stores collected
  data or a global index.
