# Hand-off — observe live SSE single source (P4-live + P5)

## Snapshot (verified state, branch `feat/observe-live-sse-source`, NOT merged)
Design contract: `docs/design/observe-live-sse-single-source.md`. Built + verified (full gate green at each; every phase adversarially mutation-probed):
- `5bd120e` P0a — nodeTokenSpine + assembleNode + non-destructive `acc.snapshot()`
- `3881e46` P0b — resolveStructure (readRunModel ≡ buildRunView on edges/stages)
- `bd9803e` P1 — widened wire (optional tokens/derived/tokenTotal, `node-enriched` kind, CLI allowlist)
- `9f75bb8` P2 — watchRun folds incrementally + node-enriched deltas (the server single source; mirror-tested vs buildRunView over pi+Claude+reused+awaiting-input)
- `8f1cd7e` P3 — GUI renders from `live.model` behind the `liveSource` flag (default `poll`)
- `f19b3c4` P4a — shadow-diff parity harness (dev-only, `?shadow=1`)
- `67beeb0` — liveModelToRunView carries the SSE stages (clean parity)
Default is `poll` → zero behavior change; ships safely as-is.

## Remaining (human-in-the-loop, live)

### P4-live — prove parity, then flip the default
1. Launch a scoped serve against a REAL run (a dir with `.pi/`): `piflowctl serve` (or `piflowctl gui`); note the URL/port.
2. Open `http://localhost:<port>/?live=sse&shadow=1`. The graph renders from the SSE stream; the shadow-diff observer logs to the browser console.
3. ACCEPTANCE: over a full run — INCLUDING a run with a PARALLEL stage — the console shows `[shadow] SSE≡/run-view ✓` and NO `console.warn` divergences. A divergence names the exact node+field (e.g. `tokens.billable sse=… poll=…`); fix the fold/adapter until clean. Do NOT flip until clean on ≥1 full run + ≥1 parallel run (design §13 Q6).
4. FLIP: set the default `liveSource` to `sse` (`gui/src/data/liveSource.ts` default, or ship `VITE_PIFLOW_LIVE_SOURCE=sse`). Keep `?live=poll` as the escape hatch + the SSE-failure/done degrade (already wired).

### P5 — demote the two 3 s replay loops (ONLY after sse is battle-proven)
- `WorkflowCanvas.tsx`: the 3 s `/run-view` re-poll is already SKIPPED under `sseLive`; once `sse` is default, the live path stops re-polling. Verify in the network tab (no 3 s `/run-view` during a live sse run).
- `RunDigestPanel.tsx`: still self-polls `/run-digest` every 3 s off `live.status`. Drive its refetch off `node-status`/`done` deltas (event-driven, like DR5's file-tree refresh) or an explicit slower cadence. Keep `/run-view` + `/run-digest` for one-shot loads.
- Optional (DR6 reconcile net): a `visibilitychange` + slow (≥30 s) `/run-view` reconcile, applied as MODEL REPLACE (not field-merge).

## Verification bar (every step)
`npx tsc -b` · `npx tsc --noEmit -p gui/tsconfig.json` · `npm --prefix gui run build` · `npm test` — all green; shadow-diff clean on a real run before flipping.

## Gotchas (do NOT regress)
- The running-node ELAPSED clock stays view-side (`NodeModeStrip` `Date.now()`); `deriveNode.time` is null for running nodes; the node-enriched fold-signature EXCLUDES clock/updatedAt (else every poll emits).
- `node-enriched` MUST stay in `packages/cli/src/remote.ts` `RUN_UPDATE_KINDS` (a new kind is silently dropped otherwise).
- `watchRun` uses NON-destructive `acc.snapshot()`, never `finalize()`, on a live accumulator; the seed replays `[0,size)` via the same `tailEvents` primitive (byte-aligned).
- The GUI mirrors core shapes LOCALLY (no `@piflow/core` import in the browser bundle).

## Before merge
- Ensure a `@piflow/core` changeset exists (additive minor: enriched observe SSE stream). Merge `feat/observe-live-sse-source` → `main` with `--no-ff` once P4-live is clean.

## Also open (separate, from the design §9)
- Thrust 3 — the AgentDriver registry: `nodeTokenSpine`/`assembleNode` (P0a) is its seam (formalize the rec.usage-vs-replay branch into named per-agent-type drivers).
- Cross-run derivable metrics (extend buildHistory/derive).
