---
"@piflow/cli": patch
---

The bundled `piflow-init` skill now teaches `op[]` as the canonical authoring surface.

`enrich-contract.md §1` (and `parse-claude-workflow.md`) previously taught the deprecated `hooks` grammar as
the port target. They now author `op[]` directly, with a source-marker → `op[]` table whose middle column is
the legacy `inject`/`hooks` alias each replaces (the migration recipe), the blocking-gate vs no-verdict-derive
fork made explicit, the "don't mix grammars — the loader rejects op[] beside inject/hooks" rule, and the
`note` slot for rationale. The `--schema` flag reference is updated to `--artifact-schema`.
