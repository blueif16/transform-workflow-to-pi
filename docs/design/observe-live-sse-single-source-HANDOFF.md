# Hand-off — observe live SSE single source (P4-live DONE · P5 next)

## Snapshot (verified state, branch `feat/observe-live-sse-source`, NOT merged)
Design contract: `docs/design/observe-live-sse-single-source.md`. Built + verified (full gate green at each; every phase adversarially mutation-probed):
- `5bd120e` P0a — nodeTokenSpine + assembleNode + non-destructive `acc.snapshot()`
- `3881e46` P0b — resolveStructure (readRunModel ≡ buildRunView on edges/stages)
- `bd9803e` P1 — widened wire (optional tokens/derived/tokenTotal, `node-enriched` kind, CLI allowlist)
- `9f75bb8` P2 — watchRun folds incrementally + node-enriched deltas (the server single source; mirror-tested vs buildRunView over pi+Claude+reused+awaiting-input)
- `8f1cd7e` P3 — GUI renders from `live.model` behind the `liveSource` flag
- `f19b3c4` P4a — shadow-diff parity harness (dev-only, `?shadow=1`)
- `67beeb0` — liveModelToRunView carries the SSE stages
- **`f8e9865` P4-fix — the live SSE fold byte-matches /run-view (4 divergences fixed, below)**
- **`5479a4c` P4-test — headless SSE≡/run-view parity gate (`gui/src/data/sseParity.test.ts`)**
- **`abebb82` P4-flip — the live default is now `sse`**

## P4-live — DONE (parity proven, default flipped)
Rather than a manual `?live=sse&shadow=1` browser eyeball, parity is now a **deterministic, CI-safe test** that
drives the SAME code the browser does: REAL `watchRun` → REAL `reduce` → REAL `liveModelToRunView`,
shadow-diffed vs REAL `buildRunView` (frames JSON-round-tripped on BOTH sides — the wire is JSON both ways).
Covered: settled snapshot, a **parallel** fan-out stage, the **incremental node-enriched delta** path, and a
history-context REPRO (teeth). An env-gated case (`PIFLOW_PARITY_RUN`) ran the same proof against **real** runs
`gs01`/`p06`/`run01`/`gs02` — all clean.

Four real divergences the P4a fixtures never exercised were found and fixed in `f8e9865` (all "the live fold
must equal /run-view"):
1. **per-node `provider`** — the adapter blanketed the run provider; `buildRunView` detects it per-node (null
   for a rec.usage node). Now carried on the wire (`NodeView.provider` + `mergeEnriched`) and rendered as `n.provider`.
2. **`durationMs`** — the adapter dropped it. Now carried.
3. **`derived.time`** — `watchRun` folded with NO history (ratio 1, tone `ok`) while the /run-view handler passes
   `historyDirs` (mean of siblings → a different tone). `watchRun` now threads `historyDirs` (reusing `buildHistory`).
4. **reads/writes/edge display paths** — `watchRun` used a run-only `displayPath`; /run-view uses `workspaceRoot`
   too. `watchRun`/`readRunModel` now thread `workspaceRoot` (reusing `makeDisplayPath`); the **SSE handler**
   resolves + passes the SAME history+workspace the run-view handler does.

Default flipped `poll` → `sse` (`liveSource.ts`). Escape hatch intact: `?live=poll` (runtime),
`VITE_PIFLOW_LIVE_SOURCE=poll` (build), + the automatic degrade-to-poll on SSE failure/done in `WorkflowCanvas`.

## P5 — DONE (`36ba65e`): the 3 s replay loops are demoted
- `WorkflowCanvas.tsx`: the 3 s `/run-view` re-poll is SKIPPED under `sseLive` (already wired); with `sse`
  default the live graph no longer re-polls.
- `RunDigestPanel.tsx`: the unconditional 3 s `/run-digest` self-poll is now a POLL-mode-only fallback. A pure
  `digestLiveSig(sseLive, liveModel)` (per-node statuses + a coarse billable bucket; `null` in poll-mode) is
  the trigger — under SSE the panel refetches only when that signature changes (a node status flip / billable
  bucket crossing) or the stream flips to `done`. An IDLE run makes zero digest fetches. Unit-tested (pure fn,
  test-the-test proven). Trigger-timing only — the digest stays the server's `projectRunDigest`.

## Remaining (optional / separate)

### DR6 reconcile net (OPTIONAL robustness — not built)
- A `visibilitychange` + slow (≥30 s) `/run-view` reconcile, applied as MODEL REPLACE (not field-merge) — a
  safety net that heals any drift after a backgrounded tab / dropped stream. Optional; the degrade-to-poll path
  already covers the common failure.

### Thrust 3 (separate track, design §9)
- The AgentDriver registry: `nodeTokenSpine`/`assembleNode` (P0a) is its seam (formalize the rec.usage-vs-replay
  branch into named per-agent-type drivers). Cross-run derivable metrics (extend `buildHistory`/`derive`).

## Verification bar (every step)
`npx tsc -b` · `npx tsc --noEmit` in `gui/` · `npm --prefix gui run build` · `npm test` — all green.
Current (merged with main): **1709 pass / 8 skip** (the 8th skip = the env-gated real-run parity case).

## Gotchas (do NOT regress)
- The SSE stream MUST be fed the SAME `historyDirs` + `workspaceRoot` the /run-view handler passes to
  `buildRunView` (else `derived.time` + display paths diverge). The two handlers now resolve them identically.
- The running-node ELAPSED clock stays view-side (`NodeModeStrip` `Date.now()`); `deriveNode.time` is null for
  running nodes; the node-enriched fold-signature EXCLUDES clock/updatedAt.
- `node-enriched` MUST stay in `packages/cli/src/remote.ts` `RUN_UPDATE_KINDS`.
- `watchRun` uses NON-destructive `acc.snapshot()`, never `finalize()`, on a live accumulator; seed replays
  `[0,size)` via the same `tailEvents` primitive (byte-aligned).
- The GUI mirrors core shapes LOCALLY (no `@piflow/core` import in the browser BUNDLE). The parity TEST imports
  core src by relative path — that's a test, not the bundle.

## Merge status
- `main` has been reconciled INTO this branch (merge `9f535ec`, clean auto-merge — main's cloud/hosting work
  vs this track's observe/gui changes had no real overlap). Branch is now AHEAD of main only.
- `@piflow/core` changeset updated (`.changeset/observe-sse-single-source.md` covers the P4 additive surface:
  `NodeView.provider`, `WatchOpts.historyDirs/workspaceRoot`, `readRunModel({workspaceRoot})`, exported
  `makeDisplayPath`/`buildHistory`).
- P0a–P5 are DONE + green (1709/8). The track is ready to merge `feat/observe-live-sse-source` → `main` with
  `--no-ff`. DR6 + Thrust 3 are optional/separate and need not gate the merge.
