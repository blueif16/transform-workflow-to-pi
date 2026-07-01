---
"@piflow/core": minor
---

Add a first-class `fixer-aborted` OptimizeEvent so a watchdog/timeout cutoff is a PORTABLE signal.

The FIX→GATE driver's context-isolated fixer can be cut short by a live behaviour watchdog or a wall-clock
timeout. Until now the only trace of that was buried in the product's OPAQUE `fixer-trace` payload (which core
never inspects) or smuggled into the fixer's `summary` string — so the control plane had no product-agnostic way
to key on a cutoff.

- `CandidateEdit` gains an optional `aborted?: { reason: string }` — a product-agnostic SHAPE with a
  product-specific reason STRING. The fixer reports the cutoff STRUCTURALLY on its typed return.
- `runFixGate` emits a new `{ type: 'fixer-aborted'; node; reason }` OptimizeEvent (right before `fixer-done`)
  whenever `edit.aborted` is set, reading the fixer's TYPED return — it never sniffs the opaque `emit` payload.
  The loop is otherwise unchanged: an aborted fixer is just a (usually 0-edit) proposal the gate rejects, so the
  round still scores → gates → lands → stops exactly as before.
- `renderOptimizeEvent` handles the new variant (`fixer-aborted [node] reason`). The `--watch` CLI renderer
  needs no change — it delegates to `renderOptimizeEvent` / `JSON.stringify`, so it surfaces the new event for
  free.
