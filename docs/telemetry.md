# Telemetry & Observability — capability map

**What this is.** The single consolidated record of piflow's observe/telemetry program: what run data we
collect, how one enriched run-view is built from it, what every viewer surfaces *right now*, and what is
designed-but-not-yet-built. It is an **index over** the scattered research/design/spec docs (linked in §9),
not a restatement of them. Code is the source of truth; this doc points at it.

**Thesis.** *Surface the observation data we already collect* — not new collection. A run's `.pi/` tree is
folded into ONE enriched `RunView`; every surface (GUI, TUI, CLI, the agent-facing digest) is a **projection**
of that one view and **re-derives nothing**. See memos `observe-single-data-path`, `config-is-truth-gui-is-projection`.

---

## 1. The pipeline (raw `.pi/` → one run-view → viewers, live via SSE)

```
LIVE / FINISHED RUN  (.pi/ on disk, engine-owned)
  run.json (statuses) · nodes/<id>/io.json (declared reads/writes) · nodes/<id>/events.jsonl (pi event firehose)
        │
        ├── readRunModel (read.ts)      LEAN snapshot: status (verified-not-trusted) + stages + edges, no replay
        │
        ├── buildRunView (runView.ts)   RICH: replays events.jsonl through the shared distiller → tokens/cost/
        │                               context/toolBreakdown/timeline/reads → assembleNode → deriveNode (display zones)
        │
        └── watchRun (watch.ts)         LIVE single source: tails events incrementally and folds the SAME assembly
                                        server-side → node-enriched deltas over SSE (see §4)
        ▼
  RunView / RunModel contract (types.ts)  →  projected by:
     • GUI      — the WorkflowCanvas graph + NodeHud + RunDigestPanel (renders, computes nothing)
     • TUI      — adapt.mjs overlays the rich view onto a lean snapshot
     • CLI      — piflowctl status / watch (thin renderer)
     • Agent    — projectRunDigest / telemetryStream (telemetry.ts) — the decision-grade lens
```

The load-bearing invariant: **a surface NEVER reads `.pi/` directly**; all run-file reading lives in
`packages/core/src/observe/`. Contract + surfaces: `docs/design/observability-pipeline.md`. The canonical
code map is the OKF slice `.agents/okf/topics/observe.md` (`piflowctl understand observe`).

---

## 2. What we surface right now (the live metric set)

Grounded in the research inventory (`docs/research/telemetry-observability-2026.md` §2 — 17 metrics; ~13
have-it/derivable, 5 need new intakes). The **derived DISPLAY projection** is computed once, server-side, in
`packages/core/src/observe/derive.ts` (`deriveNode`), so every view renders identical numbers. The zone
thresholds ARE the oracle (mutation-tested in `derive.test.ts`):

| Zone (per node) | Definition | Thresholds (`ok` / `warn` / `high`) |
|---|---|---|
| **context** pressure | `contextPeak / contextWindow` (window from pi's `models.json`, else 200k) | `<0.4` / `0.4–0.7` / `≥0.7` |
| **cache-hit** | `cacheRead / (input + cacheRead)` | `≥0.6` / `0.3–0.6` / `<0.3` |
| **tool-error** rate | tool-execution errors / tool calls | `≤0.05` / `0.05–0.15` / `>0.15` |
| **dominance** | one tool `>0.8` of calls AND `toolCalls>5` | flag |
| **time** slowdown | `durationMs / mean(prior-run durations)` (cross-run history) | `≤1` / `1–1.5` / `>1.5` |
| **retries** | count of provider `auto_retry_start` | `<1` / `1–5` / `≥5` |
| **topTools** | ranked `toolBreakdown` (name, count, pct) | — |
| **outputs** | unified writes ∪ artifacts (path, bytes, on-disk verified) | — |

Also carried per node: `tokens` (input/output/cacheRead/cacheWrite/cost/contextPeak/**billable**), `model`,
`provider` (per-node), `toolCalls`, `timeline` (spans w/ durMs/ok), `reads`/`writes`/`artifacts`, `retries`,
`stopReason`, `truncated`, `thinkingChars`, `durationMs`. Run-level: `tokenTotal` (sum; `contextPeak` = max),
`totals`, `stages`, `edges`, `sandbox`.

Two projections over the view:
- **RunView** — the wide per-node view every graph/HUD renders.
- **RunDigest** — the run-LEVEL agent-facing lens (`projectRunDigest`, telemetry.ts): verdict + cost spine +
  ranked anomaly worklist + failure-onset chains, in OTel `gen_ai.*` naming. Surfaced in the GUI
  `RunDigestPanel` (D key) and the CLI `piflowctl telemetry`.

**GUI surfaces (what we're showing).** WorkflowCanvas graph (stage columns × parallel lanes, file-flow edges);
NodeHud (`CacheDonut`, `ToolStackBar`, ranked tool bars, tool-error/dominance/retries flags); NodeModeStrip
(context/time bars, running-node live-elapsed clock — the one view-side compute exception); RunDigestPanel;
POLICY gate glyphs (`summarizeGates`); G6 agent-preset icons (poll path — see §6 gap).

---

## 3. Agent-type telemetry (pi and Claude Code on one surface)

Dispatch is unified (pi + Claude Code nodes), but **observe was not** until Thrust 1. pi nodes emit pi's event
vocabulary; Claude-Code nodes emit `--output-format stream-json` where the real usage lands in a single
`result` event. **Thrust 1 (MERGED, main `e8c2e93`)** lifts Claude's ttft/stop_reason/modelUsage.contextWindow
into an agent-neutral `NodeUsage` on `NodeStatusRecord.usage`; `buildRunView` PREFERS `rec.usage` for the
token/cost/context spine (gated so pi stays byte-identical). Consequence: Claude nodes' cost/context/anomalies
now light up, and the optimizer's Claude **fixer** node is no longer scored blind. Per-tool timeline/loop for
Claude is deferred (needs per-event decode). Full formalization = Thrust 3 (§7).

---

## 4. The live SSE single source (P0a–P5 + DR6) — the change record

**Before:** a live run was watched by TWO 3-second replay polls (`/run-view` for the graph + `/run-digest` for
the digest panel), each re-folding the entire run from byte zero every tick, per client. **Now:** the SSE
stream is the single enriched live source — `watchRun` folds per-node telemetry **incrementally** (one
long-lived accumulator/node over the byte-offset tail), computes `derived` **once** via the SAME
`assembleNode`/`nodeTokenSpine`/`deriveNode` the batch builder uses, and pushes the **full** enriched node
(`node-enriched` delta). The GUI renders it and computes nothing; the two 3s polls are demoted to one-shot
loads + a reconcile net. Design + adversarial review: `docs/design/observe-live-sse-single-source.md`.

The core mechanism is a **non-destructive** accumulator read: `distill.ts` `finalize()` is destructive
(synth-closes open tool spans), so the live path uses `acc.snapshot()` (a frozen copy with open spans projected
read-only) — never `finalize()` on a live accumulator.

| Phase | Commit | What landed |
|---|---|---|
| P0a | `5bd120e` | `nodeTokenSpine` + `assembleNode` extracted; non-destructive `acc.snapshot()` twin of `finalize()` |
| P0b | `3881e46` | `resolveStructure` — `readRunModel` ≡ `buildRunView` on stages/edges (prefers `.pi/workflow.json`) |
| P1  | `bd9803e` | widened wire: optional `tokens`/`derived`/`tokenTotal`, the `node-enriched` kind, CLI `RUN_UPDATE_KINDS` allowlist |
| P2  | `9f75bb8` | `watchRun` folds incrementally + emits `node-enriched` — the server single source (mirror-tested vs `buildRunView` over pi/Claude/reused/awaiting-input) |
| P3  | `8f1cd7e` | GUI renders the graph from `live.model` behind the `liveSource` client flag |
| P4a | `f19b3c4` | dev-only shadow-diff parity harness (`?live=sse&shadow=1`) |
| —   | `67beeb0` | `liveModelToRunView` carries the SSE snapshot stages (clean parity) |
| P4-fix | `f8e9865` | the live fold byte-matches `/run-view` — 4 real divergences fixed (per-node provider, durationMs, `derived.time` history, display paths) |
| P4-test | `5479a4c` | headless SSE≡/run-view parity GATE (`gui/src/data/sseParity.test.ts`) driving the real fold path |
| P4-flip | `abebb82` | the live default flipped `poll` → `sse` (escape hatch `?live=poll` / `VITE_PIFLOW_LIVE_SOURCE=poll` / auto degrade-to-poll on SSE failure) |
| P5  | `36ba65e` | RunDigestPanel refetches off SSE deltas (`digestLiveSig`), not a 3s idle poll — an idle run makes ZERO digest fetches |
| DR6 | `a06e930` | reconcile net: on `visibilitychange`→visible (SSE path), fetch `/run-view` once and MODEL-REPLACE the live model (`runViewToLiveModel` + `useRunStream.reconcile`) — heals drift after a backgrounded/throttled tab |

**Reversibility & robustness.** The transport is a CLIENT flag (`liveSource.ts`); the server always folds, so a
bug is a transport bug. Safety nets, worst-case first: SSE push → EventSource auto-reconnect (fresh snapshot) →
DR6 visibilitychange reconcile (MODEL REPLACE) → full `/run-view` poll fallback (on SSE failure/done). No
persisted state changes — it is a read-path change over immutable `.pi/`.

**Verification bar (held at each phase):** `npx tsc -b` · `npx tsc --noEmit` in `gui/` · `npm --prefix gui run
build` · `npm test`. Parity is a deterministic headless test (`watchRun` → `reduce` → `liveModelToRunView`
shadow-diffed vs `buildRunView`), plus an env-gated real-run case (`PIFLOW_PARITY_RUN`).

---

## 5. Where each capability lives (code anchors)

- Lean snapshot: `packages/core/src/observe/read.ts:82` `readRunModel` · `:62` `deriveStatus`
- Rich reducer: `packages/core/src/observe/distill.ts:140` `createNodeAccumulator` · `:271` `snapshot()` (live, non-destructive) · `:281` `finalize()` (terminal, destructive) · `:169` `costScalar` (the COST number)
- Run-view builder: `packages/core/src/observe/runView.ts:354` `buildRunView` · `:240` `nodeTokenSpine` · `:297` `assembleNode`
- Display zones: `packages/core/src/observe/derive.ts:74` `deriveNode`
- Structure parity: `packages/core/src/observe/structure.ts:70` `resolveStructure`
- Context window: `packages/core/src/observe/models.ts:66` `contextWindowFor` (pi-native `models.json`)
- Live stream: `packages/core/src/observe/watch.ts:196` `watchRun` · `:218` `acc.snapshot()` fold · `:319` `yield node-enriched`
- Wire contract: `packages/core/src/observe/types.ts:45` `NodeView` (`:79` `tokens?` · `:81` `derived?`) · `:135` `RunModel` · `:177` `node-enriched` RunUpdate kind
- Agent-facing digest: `packages/core/src/observe/telemetry.ts:294` `projectRunDigest` · `:363` `telemetryStream`
- GUI live client: `gui/src/data/runStream.ts` (`reduce`, `reconcile`) · `gui/src/data/runView.ts` (`liveModelToRunView`, `runViewToLiveModel`, `digestLiveSig`) · `gui/src/data/liveSource.ts` (transport flag) · `gui/src/components/WorkflowCanvas.tsx` (render + DR6 reconcile) · `gui/src/components/RunDigestPanel.tsx`

---

## 6. Known gaps / not-yet-surfaced

- **5 new intakes** (research §5, ranked): rate-limit/429 count · `finish_reasons` (stop vs max_tokens vs
  tool_use) · a first-class retry count · TTFT (time-to-first-token) · thinking/reasoning tokens. Some partials
  exist (`retries`, `stopReason`/`truncated`, `thinkingChars` are captured); the first-class 429/TTFT/finish-
  reason intakes are not.
- **cost = 0 on Max-subscription / non-billing providers.** The `$` spine reads 0 there; go **tokens-first**,
  show `$` only when real (memo `gui-nodehud-redesign`).
- **`agentType` not on the SSE render path.** `LiveNode` doesn't carry `agentType`, so under `?live=sse` (the
  default) G6 preset icons render as the DEFAULT glyph — a cosmetic poll-vs-sse difference the P4 shadow-diff
  can't catch (`agentType` isn't in its field key). Fold it onto the enriched wire node when addressing Thrust 3.
- **Stale spec.** `docs/specs/remaining-telemetry-features.md` is written as "Tasks 1–6 pending," but Tasks 2–5
  (reducer intakes, truncation/retry badges, ToolStackBar, CacheDonut) have LANDED. Treat that spec as a
  contract doc; this doc is the status of record.

---

## 7. Thrust 3 (PARKED — the next substantive track, task #7)

Two orthogonal pieces, both seamed off the P0a extraction (`nodeTokenSpine`/`assembleNode` at
`runView.ts:240/297` — the `rec.usage`-vs-event-replay branch is the driver-selection point):

1. **AgentDriver registry.** Formalize per-agent-type drivers `{ buildCommand, resolveModel, parseResult,
   +NEW decodeEvents, modelCaps }` (reframed vs `docs/design/agent-executor-interface.md` §2, where telemetry
   parity was "optional for v1"). This turns the `rec.usage`-vs-replay branch into "pick the driver for `rec`,"
   and is where Claude per-tool timeline/loop decode + `agentType`-on-wire land.
2. **Cross-run derivable metrics.** cost-spike needs cross-run cost history (extend `buildHistory` — NOT purely
   derivable); `loopScore` (consecutive, first-100-chars) must be reconciled against the existing global
   `maxToolRepeat` (full-args); TTFT/thinking already ride the Claude stream.

Status: not started. The SSE track (P0a–P5 + DR6) is complete and merge-ready and does not depend on it.

---

## 8. Design decisions carried (do not regress)

- The SSE stream MUST be fed the SAME `historyDirs` + `workspaceRoot` the `/run-view` handler passes to
  `buildRunView` — else `derived.time` and display paths diverge (P4-fix).
- The running-node ELAPSED clock stays view-side (`NodeModeStrip` `Date.now()`); `deriveNode.time` is `null`
  for running nodes; the `node-enriched` fold-signature EXCLUDES clock/updatedAt.
- `node-enriched` MUST stay in `packages/cli/src/remote.ts` `RUN_UPDATE_KINDS` (a new kind is dropped otherwise).
- `watchRun` uses `acc.snapshot()`, never `finalize()`, on a live accumulator; seed replays `[0,size)` via the
  same `tailEvents` primitive (byte-aligned).
- The GUI mirrors core shapes LOCALLY (no `@piflow/core` import in the browser bundle); the parity TEST imports
  core src by relative path — that's a test, not the bundle.

---

## 9. Map — the full document + memory set

- Research (previous): `docs/research/telemetry-observability-2026.md` — the 17-metric inventory (§2), warning
  signals (§3), visualization guide (§4), ranked new intakes (§5).
- Pipeline contract: `docs/design/observability-pipeline.md` — types, per-surface consumption, invariants.
- SSE single source: `docs/design/observe-live-sse-single-source.md` (+ `-HANDOFF.md`) — the P0a–P5 design,
  DRs, phased plan, adversarial review (§15), build log (§16).
- Remaining features (contract, partially landed): `docs/specs/remaining-telemetry-features.md`.
- Understanding slice (canonical code map): `.agents/okf/topics/observe.md` — `piflowctl understand observe`.
- Memory: `[[telemetry-legibility-tracks]]` (roadmap), `[[observe-single-data-path]]`, `[[config-is-truth-gui-is-projection]]`, `[[gui-nodehud-redesign]]`, `[[piflow-overlord-control-plane]]`.
