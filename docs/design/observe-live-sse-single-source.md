# Observe live path — one enriched SSE source (retire the 3 s replay poll)

**Status:** REVIEWED (adversarial review folded in 2026-07-01 — see §15) · **P0a→P4a LANDED** on `feat/observe-live-sse-source` (build log §16; server single source built + shadow-diff harness, default `poll`) · P4-live + P5 remain (human-gated — see `observe-live-sse-single-source-HANDOFF.md`) · **Owner:** observe surface
**Depends on / converges with:** `docs/design/agent-executor-interface.md`, `docs/design/agent-executor-surface.md` (the AgentDriver registry — Thrust 3), `docs/specs/remaining-telemetry-features.md` (Tasks 1–6, landed), memo `observe-single-data-path`.
**Prereq landed:** the GUI now computes nothing on any render path — the dead SSE browser-fold + the `.mjs` reducer fork were deleted (`refactor(gui): render server derived only`, `chore(gui): kill the stale .mjs reducer fork`). This doc is the *next* step that direction pointed at.

---

## 1. One-paragraph summary

Today a live run is watched by **two parallel replay loops**: a 3 s HTTP poll of `/run-view` (which re-derives the *entire* run from byte zero every tick and draws the graph) and, independently, `RunDigestPanel`'s own 3 s self-poll of `/run-digest` (the same `buildRunView` under the hood). Both re-do work the SSE stream already tails incrementally but never folds. This doc makes the **SSE stream the single enriched live source** — the server folds per-node telemetry **incrementally** (reusing the byte-offset tail `watchRun` already maintains, via a **non-destructive** accumulator snapshot), computes `derived` **once** via the **same** code the batch builder uses, and pushes the **full** enriched node; the GUI renders it and computes nothing. The two expensive replay loops are **demoted, not deleted** — `/run-view` survives as the one-shot loader for finished/historical runs and as a reconcile safety-net — and the whole change ships behind a **client-side transport flag** so it is reversible at runtime with zero data risk.

---

## 2. Motivation — why the polls are the problem

`buildRunView` is **stateless**: every call re-reads and re-folds every node from scratch. The cost lives in `replayEvents` (`packages/core/src/observe/runView.ts:162-176`):

```ts
for (const line of fssync.readFileSync(f, 'utf8').split('\n')) {  // the ENTIRE events.jsonl
  acc.push(JSON.parse(line));                                     // re-folded from empty
}
```

called for **every node** at `runView.ts:258`, on **every** `buildRunView`. **Two** GUI loops re-arm that work every 3 s while a run is live:
- `gui/src/components/WorkflowCanvas.tsx:168` — `if (!preview && !view.done) timer = setTimeout(load, 3000)` (the graph).
- `gui/src/components/RunDigestPanel.tsx:60-81` — its **own** `loadRunDigest` self-poll every 3 s while `!done`, re-armed off the `liveStatus` prop, hitting `/__piflow/run-digest` → `projectRunDigest` over the same `buildRunView`.

**Cost:** `O(total bytes across all nodes) × (every 3 s) × (each loop) × (each connected client)`, for the entire duration of a run. 99% of each tick re-processes events already seen. Correct, but linear in run length × clients × loops.

**Contrast — the SSE stream already tails incrementally.** `watchRun` keeps a per-node byte offset and reads only *new* bytes each poll (`packages/core/src/observe/watch.ts:35-55` `tailEvents`, `offsets` map at `:70`), and already pushes `{kind:'node-event'}` deltas for exactly those new lines (`:108-118`). It simply never *folds* them. Moving the fold server-side makes the cost **`O(new bytes) per poll, computed once, shared by all clients`**.

---

## 3. Current architecture (as-is)

```
LIVE RUN (.pi/ on disk)
   │
   ├── HTTP GET /run-view/<run>   ─► buildRunView() ─ FULL replay every node ─► RunView (tokens, derived, tokenTotal)
   │      ▲ polled 3 s (WorkflowCanvas.tsx:139-177) ────────── toFlowGraph() ─► THE VISIBLE GRAPH
   │
   ├── HTTP GET /run-digest/<run> ─► projectRunDigest()→buildRunView() ─ FULL replay ─► digest
   │      ▲ polled 3 s (RunDigestPanel.tsx:60-81, armed off live.status)
   │
   └── SSE  /stream/<run>  ─► watchRun() ─ lean snapshot + raw events (incremental tail) ─► runStream.ts
              (readRunModel: status/stage/edges, NO tokens/derived)         │
                                                                            └─► live.status only → RunDigestPanel arm
                                                                                (the fold that consumed this was deleted)
```

Verified facts:
- `readRunModel` (`observe/read.ts:104`) is lean: run.json + io.json → status/stage/edges. **No** event replay, **no** tokens/derived, `totals` count-only. Reconstructs edges from io ledgers (`read.ts:153-169`); does **not** read `.pi/workflow.json`. `buildRunView` **prefers** `workflow.json`'s resolved DAG (`runView.ts:344-352`). → **live snapshot and loaded run-view can show different edges/stages.**
- `piflowRunStream` (`packages/server/src/handlers.ts:82`) pipes each `watchRun` update **verbatim**; `piflowRunView` serves `buildRunView`. The server transport is flagless.
- The remote CLI has a **hardcoded frame allowlist**: `packages/cli/src/remote.ts:38` `RUN_UPDATE_KINDS = new Set(['snapshot','node-status','node-event','done'])`; `:111` yields only frames whose kind is in it. **A new kind is dropped unless registered here.**
- `distill.ts` `finalize()` (`:251-254`) is **destructive**: it synth-closes every open tool span (`durMs:0, ok:true`) then `open.clear()`s. `buildRunView` calls it exactly once per node. A non-destructive live read exists — `metrics()` (`:242-249`) — but returns only `LiveMetrics` (tokens/modelCalls/toolCalls/retries/stopReason), **not** the timeline/reads/writes/toolBreakdown that `deriveNode` needs.
- `LiveNode` (`runStream.ts:14-21`) carries only `{id,label,phase,status,stageIndex,lane}` — none of the fields `toFlowGraph` renders. `reduce` replaces `model` wholesale on snapshot (`runStream.ts:69` `model: f.model`) and appends `node-event` to a `recent[]` tail **that no component reads** (grep: only its own write). `RunStreamContext`/`useRunStreamContext` (`:61-62`) is Provided at `WorkflowCanvas.tsx:292` but has **zero consumers** (the Companion uses `useControlSession`, a separate control-plane stream).
- The 3 s `load()` also fetches **non-telemetry** data: `loadRunTree`, `buildDirectory`, `loadAgentCatalog`, and (fusion) `loadPreview` (`WorkflowCanvas.tsx:146-167`).

---

## 4. Target architecture (to-be)

```
LIVE RUN (.pi/ on disk)
   └── SSE /stream/<run> ─► watchRun() ─ INCREMENTAL fold (one long-lived accumulator/node over the existing tail)
                              ├ acc.snapshot()  (NON-destructive; timeline/tools/reads/writes without closing open spans)
                              ├ nodeTokenSpine (rec.usage vs replay)  ─┐
                              ├ assembleNode()  [SHARED w/ buildRunView] ├─ full RunViewNode + deriveNode() once, server-side
                              └ resolveStructure(.pi/workflow.json)    ─┘  (edges/stages parity w/ buildRunView)
                                        │
              enriched snapshot  +  {kind:'node-enriched', id, node}  deltas (the FULL node, on material change)
                                        ▼
                                   runStream.ts (reduce: replace model on snapshot; merge full node on node-enriched)
                                        ▼
                         WorkflowCanvas builds the graph from live.model ─► THE VISIBLE GRAPH (renders, computes nothing)

  /run-view (buildRunView) ─ STAYS, demoted ─► one-shot load (finished/historical/foreign) + reconcile net (MODEL REPLACE)
  RunDigestPanel ─► refetch driven off node-status/done deltas, not a 3 s timer
  file tree / directory / agent catalog ─► refreshed on node-status change, not on a telemetry loop
```

**Invariant:** the live graph and the loaded run-view render byte-identical per-node data, because both go through the **same** `assembleNode` + `nodeTokenSpine` + `deriveNode`. Only the *transport* differs. The delta carries the **whole** node (not just tokens+derived) so no rendered field is missing (§5 DR3).

---

## 5. Design decisions

### DR1 — Fold in `watchRun` (incremental), NOT in `readRunModel` (full replay)
`readRunModel` stays lean (it is the fast status snapshot for `piflowctl status`/`watch`/remote, which read only `node.status`). The enrichment lives in `watchRun`, which already tails events incrementally. Enriching `readRunModel` would re-introduce a full replay on every poll — the exact cost we remove.

### DR2 — Share the *assembly* via a NON-DESTRUCTIVE accumulator snapshot (kills drift; = the AgentDriver seam)
Extract two pure functions from `buildRunView`'s per-node loop (`runView.ts:257-339`):
- `nodeTokenSpine(usage, rich, catalog, effModel)` — the `rec.usage`-first-vs-event-replay precedence at `runView.ts:295-314`.
- `assembleNode(rec, rich, ioLedger, ctx) → RunViewNode` — the whole per-node build (reads/scopes/writes/artifacts/tokens/spine/checkpoint), then `node.derived = deriveNode(node)`.

`buildRunView` calls both with `rich = acc.finalize(rec)` (one-shot, as today). **`watchRun` cannot call `finalize()` — it is destructive** (§3, `distill.ts:251-254`): calling it per-tick on a still-live accumulator double-pushes timeline spans, stamps `durMs:0/ok:true` on in-flight tool calls, and drops the real `tool_execution_end`, corrupting exactly the `toolError`/dominance/`topTools` zones this change ships. **Decision:** add `acc.snapshot(rec) → rich` to the reducer — a **non-destructive** read that returns a *frozen copy* of the full `RichNode` (timeline with open spans projected read-only, toolBreakdown, reads, writes, tokens) **without mutating `open`**. `buildRunView` may keep using `finalize()` (terminal); `watchRun`'s live `assembleNode` consumes `snapshot()`. This is the core mechanism; it is registry-shaped so the AgentDriver registry (Thrust 3) slots into `nodeTokenSpine` with no rework.

### DR3 — The delta carries the FULL node, on a concrete change rule (freshness + completeness)
`watchRun` yields the full snapshot **once** (`sentSnapshot`, `watch.ts:86`), then deltas. Enriching only the snapshot freezes a running node at t0. But a delta of *only* `tokens+derived` (the draft's error) leaves reads/writes/toolCalls/summary/model blank in the rendered graph, because `toFlowGraph` reads all of those and `LiveNode` carries none. **Decision:** the delta is `{ kind:'node-enriched'; id; node: RunViewNode }` — the **whole** re-assembled node. Emit it after the snapshot when a node's **stable fold-signature changes**, defined concretely as any change in: `tokens.billable`, `tokens.contextPeak`, `toolCalls`, or any `derived` tone/flag. The signature **excludes** any live clock / `updatedAt` / elapsed (those tick every poll and would defeat the cost win; `deriveNode.time` is already `null` for running nodes, so the signature is stable). The GUI `reduce` merges the full node into `model.nodes[id]` and recomputes `model.tokenTotal`.

### DR4 — Close the structure-parity gap (`workflow.json` in the live path) — a BEHAVIOR CHANGE, not a pure refactor
For the live graph to match the loaded graph, the SSE snapshot must resolve stages/edges the same way `buildRunView` does. Extract `resolveStructure(runDir, nodeIds, opts)` (prefers `.pi/workflow.json` → declared template → phase grouping) and have **both** `readRunModel` and `buildRunView` use it. **This changes `readRunModel`'s output** whenever a run has `workflow.json` (today it uses io-edge reconstruction, `read.ts:153-169`), so `observe.test.ts`'s io-edge assertions must be updated — this is an explicit behavior-change phase (P0b), not the "tests pass unchanged" refactor.

### DR5 — Decouple non-telemetry data + `RunDigestPanel` from the telemetry loop
- agent catalog: once per run (~static).
- file tree / directory: refresh on a `node-status` delta (a node finishing is when files land) and/or a slow cadence (≥10 s) — a cheap dir walk, not a `buildRunView` replay.
- `RunDigestPanel`: drive its refetch off `node-status`/`done` deltas (event-driven) instead of its 3 s timer, OR keep a slower accepted cadence — but decide explicitly (P5). Preserve `live.status`'s done-flip semantics so its refetch-on-done still fires.
- fusion preview: fusion-mode only, already static.

### DR6 — Robustness: SSE primary + reconnect re-sync + reconcile net (demote, don't delete)
- **Primary:** SSE. `EventSource` auto-reconnects; each (re)connect is a fresh `watchRun`. **A reconnect must seed each node's accumulator by replaying `events.jsonl` from byte 0** (not from EOF) so open-span/timeline history is reconstructed — otherwise a client that dropped mid-tool-call shows a transiently-wrong `toolError`/dominance until that node finishes. The GUI's snapshot-replace makes the model itself idempotent (`runStream.ts:69`).
- **Reconcile net:** on `visibilitychange` and optionally a slow interval (≥30 s), fetch `/run-view` once and **adopt it as the new model base (MODEL REPLACE, not field-merge)** — keeping one merge path (DR2), consistent with the existing snapshot-replace.
- **Degrade:** if SSE fails entirely (status `error`, never a model), the client flag's `poll` path is the safety valve.
- **One-shot:** finished/historical/foreign runs always use `/run-view` once. Unchanged.

### DR7 — Reversibility: a CLIENT-SIDE transport flag, corrected additive invariant, staged commits, shadow-diff
- **Flag is client-only.** After P2 the server `watchRun` **always** folds (the bridge/`piflowRunStream` pipe it verbatim, flagless) — so "server lean vs server enriching" inconsistency cannot occur. The flag `liveSource: 'poll' | 'sse'` lives only in the GUI (a build-time default + a `?live=poll|sse` query override). Ships defaulting to `poll` → flip to `sse` when validated → later `sse` default with `poll` fallback.
- **Corrected additive invariant.** "Additive" is **not** "optional fields alone." It is: *every new field is optional* **AND** *every new frame kind is registered in every stream allowlist/switch.* The new `node-enriched` kind **must** be added to `packages/cli/src/remote.ts` `RUN_UPDATE_KINDS` (`:38`) or the remote CLI silently drops it. (The GUI `reduce` already `default: return prev`, so it is safe there.)
- **Transport-only switch:** the flag chooses push vs poll; **both produce identical data** via the shared assembly. A bug is a transport bug, isolated.
- **Shadow-diff (dev parity gate):** a dev-only mode runs **both** transports and asserts deep-equality on the **entire per-node `RunViewNode` that `toFlowGraph` consumes** — at minimum `tokens, derived, toolCalls, toolBreakdown, reads, writes, artifacts, summary, model, provider, durationMs, stageIndex, lane` + `view.sandbox` + the edges/stages set. (The draft's `{tokens,derived,stageIndex,lane,edges}` key would pass while the visible graph diverged.) Run it clean on real runs before flipping the default.
- **Backup = git + the flag + the untouched source of truth.** This is a **read-path** change over immutable `.pi/`; no persisted state changes, no data migration, nothing to roll back data-wise. Revert = flip the flag (runtime) or `git revert` the phase (code).

---

## 6. Full change map

### Shared (extractions)
| File | Change | Behavior |
|---|---|---|
| `observe/distill.ts` | Add `snapshot(rec) → RichNode` — non-destructive twin of `finalize()` (frozen copy, open spans projected read-only, `open` untouched). | **additive** |
| `observe/runView.ts` | Extract `nodeTokenSpine()` (`:295-314`) + `assembleNode()` (`:257-339` body); `buildRunView` calls them with `finalize()`. | **pure refactor** |
| `observe/structure.ts` *(new)* | `resolveStructure(runDir, nodeIds, opts)` — `workflow.json` → template → phase grouping. | **new** |

### Server (enrich the stream)
| File | Change | Behavior |
|---|---|---|
| `observe/types.ts` | `NodeView` += optional `tokens?/derived?/`spine fields. `RunModel` += `tokenTotal?`. `RunUpdate` += `{kind:'node-enriched'; id; node}`. All optional. | **additive** |
| `observe/watch.ts` | One long-lived `createNodeAccumulator` per node (never recreated except reconnect-from-0); seed by replaying `[0,size)` via the **same** `tailEvents` primitive and store `offset=size` from that read (§DR-M2 invariant); feed the tail thereafter; `acc.snapshot()` → `assembleNode` → enrich snapshot + fold `tokenTotal`; emit `node-enriched` on signature change (DR3); use `resolveStructure` (DR4). | **additive** |
| `observe/read.ts` | Use `resolveStructure` (DR4). | **CHANGES edges/stages when workflow.json present** |
| `packages/cli/src/remote.ts` | Add `'node-enriched'` to `RUN_UPDATE_KINDS` (`:38`). | **required for reversibility** |
| `packages/server/src/handlers.ts` | **No change** — pipes verbatim. | — |

### Client (consume + render behind the flag, default `poll`)
| File | Change |
|---|---|
| `gui/src/data/runStream.ts` | Widen `LiveModel`/`LiveNode` to the full node shape; `reduce` handles `node-enriched` (merge full node, update `tokenTotal`); resolve the fate of the dead `recent[]` tail + unconsumed `RunStreamContext` (drop, or note retained). |
| `gui/src/data/runView.ts` | `toFlowGraph` accepts the enriched live model (or a `LiveModel→RunView` adapter with a field-coverage checklist). |
| `gui/src/components/WorkflowCanvas.tsx` | Behind `liveSource==='sse'`: build the graph from `live.model`; keep file-tree/dir refresh on `node-status` (DR5); keep the running-clock view-side. `poll` keeps today's loop verbatim (fallback). |
| `gui/src/components/RunDigestPanel.tsx` | Drive refetch off `node-status`/`done` deltas, or set an explicit slower cadence (DR5). |
| flag resolver (`apiBase.ts` or new `liveSource.ts`) | Resolve `liveSource` (build default + `?live=` override). |

### Stays (demoted, not deleted)
- `/run-view` + `buildRunView` + `loadRunView`: one-shot loads + reconcile net (DR6).
- `contextTone`/`timeTone` in `gui/src/data/runView.ts`: the running-node live-elapsed clock exception.

---

## 7. Robustness & fallback — "remove all polling, or keep robust?"

**Keep robust. Demote the polls; do not delete them.** The answer to "remove all polling" is *no*:
1. Kill only the expensive hot loops (the two 3 s `buildRunView` replays — the graph poll and `RunDigestPanel`).
2. Keep `/run-view` for one-shot loads of finished/foreign runs, the reconcile net, and the `poll` fallback.
3. Layer the safety nets worst-case-first: SSE push → auto-reconnect re-sync (seed-from-0) → visibility/slow reconcile (model replace) → full poll fallback. Graceful degradation, not failure.
4. Keep the file-tree/dir refresh (event-driven, cheap) so the navigator never goes stale.

Strictly *more* robust than today (today the SSE has no consumer; the graph has only the poll — no push path).

---

## 8. Revert & backup — "revertable / always have a backup"

Three independent levers, smallest blast-radius first:
1. **Runtime flag** — flip `liveSource` back to `poll`. Instant, no deploy. The poll path is always present.
2. **Additive wire** — every phase leaves the poll path working; any single phase is `git revert`-able. Each phase is one focused commit.
3. **No data migration** — read-path change over immutable `.pi/`; nothing persisted changes. "Backup" = the run dirs, untouched.

**Parity proof before cutover:** the dev **shadow-diff** (DR7, full field key) runs both transports and asserts they agree per-node over real runs. Flip the default to `sse` only after it is clean (game-omni live + a multi-node parallel run). If it ever diverges in the field, the reconcile net + flag catch it.

---

## 9. Adjacent gaps this reconciles

| Gap | Relationship | Action |
|---|---|---|
| **AgentDriver registry** (Thrust 3) | `nodeTokenSpine`/`assembleNode` **is** its seam — the `rec.usage`-vs-replay branch becomes "pick the driver for `rec`". | Do the DR2 extraction **registry-shaped**; land together. |
| **Cross-run derivable metrics** (Thrust 3) | Orthogonal transport-wise; both touch `runView`/`derive`. | Out of scope; note the shared files. Separate doc. |
| **Structure parity** (`readRunModel` vs `buildRunView` edges) | Load-bearing once the live graph comes from the snapshot. | Closed by DR4 (`resolveStructure`) — a behavior-change phase P0b. |
| **Node lifecycle** (reused/dry/awaiting-input/frozen) | The byte-identical invariant must hold for all statuses, not just running/ok. | DR2/DR3 contract (below); P2 fixtures include a reused + awaiting-input node. |
| **tokens-first cost / known cost bug** (memo `gui-nodehud-redesign`) | Cost flows through `nodeTokenSpine`. | VERIFY during the DR2 extraction; if real, fix in the one shared helper. |
| **Dead `recent[]` tail + unconsumed `RunStreamContext`** (`runStream.ts`) | The file P3 rewrites. | State their fate in P3/§6 (drop or note retained); record that the Companion's control stream stays a **separate** channel (do not entangle). |
| **Multi-client per-run watchers** | Each SSE client opens its own `watchRun` (own accumulators; each (re)connect re-pays a full seed replay). | Deferred; `log()` it; near-term client-side reconnect debounce; eventual shared per-run watcher. |
| **ToolStackBar/CacheDonut "dead" note** | Stale — both wired into `NodeHud.tsx` (verified 2026-07-01). | Recorded resolved. |

**Node-lifecycle fold contract (DR2/DR3):** *reused* → no events, prefer carried `rec.usage` if a future feature adds it, else all-zero shape (both paths blank today — parity by both being blank, not coincidence to rely on); *dry* → no events → neutral zones; *awaiting-input* → re-read the checkpoint marker on snapshot **and** delta; *frozen* → run-level flag passthrough.

---

## 10. Phased implementation plan (subagent-executable)

Each phase: **files · change · acceptance (mutation-checkable) · scope fence · verify.** Each ends green and is independently revertable.

### P0a — Pure extraction (zero behavior change)
- **Files:** `observe/distill.ts` (add `snapshot()`), `observe/runView.ts` (extract `nodeTokenSpine` + `assembleNode`; `buildRunView` uses them via `finalize()`).
- **Acceptance:** `packages/core` tests + `observability.test.ts` pass **unchanged**; a mutation to `nodeTokenSpine` (drop the `rec.usage` branch) turns a Claude fixture red; **`snapshot()` vs `finalize()` on a settled node return deep-equal `rich`** (proves the non-destructive twin matches), and `snapshot()` called twice does not mutate (idempotent — a second call equals the first, and a subsequent `finalize()` still closes correctly).
- **Scope fence:** no wire change, no watch change, no GUI, no structure change.
- **Verify:** `cd packages/core && npx tsc -b && npx vitest run`.

### P0b — `resolveStructure` (explicit behavior change to `readRunModel`)
- **Files:** `observe/structure.ts` (new), `observe/runView.ts` + `observe/read.ts` adopt it.
- **Acceptance:** `buildRunView` structure unchanged (existing tests green); `readRunModel` now prefers `workflow.json` — **update** the io-edge fixtures in `observe.test.ts` and add a fixture *with* and *without* `workflow.json` asserting the two paths now agree on edges/stages.
- **Scope fence:** structure only; no token/derived work.
- **Verify:** `npx tsc -b`; the updated `observe.test.ts`.

### P1 — Widen the wire (additive types + new kind + CLI allowlist)
- **Files:** `observe/types.ts`, `packages/cli/src/remote.ts`.
- **Acceptance:** `packages/cli` `watch`/`remote` tests green with a `node-enriched` frame **interleaved** (proves the allowlist widening — without it the frame is dropped and a new assertion for its passthrough fails); TUI/`status` unaffected (superset read).
- **Scope fence:** types + allowlist only; no producer yet.
- **Verify:** `npx tsc -b`; full default gate.

### P2 — Fold in `watchRun` + structure parity
- **Files:** `observe/watch.ts`.
- **Change:** one long-lived accumulator/node; seed `[0,size)` via `tailEvents` (M2 invariant); `snapshot()` → `assembleNode`; enrich snapshot + `tokenTotal`; `node-enriched` on signature change; `resolveStructure`.
- **Acceptance (new `watch` tests):**
  - **anti-freeze:** an accruing running node emits `node-enriched` with **advancing** `tokens.billable` (stop the delta → assertion on the 2nd value fails).
  - **open-span correctness:** push `tool_execution_start` → snapshot/derive → push its `_end` → the span carries the **real** `durMs`/`ok` (a `finalize`-based path fails this).
  - **byte-alignment:** append a partial line between snapshot and first tail poll → folded totals equal a single full replay (no line folded twice or skipped).
  - **contextPeak MAX:** a peak-bearing event then a lower one → `contextPeak` does not drop.
  - **mirror:** `watchRun`'s enriched snapshot per-node deep-equals `buildRunView`'s over a fixture dir including a **pi node, a Claude/`rec.usage` node, a reused node, and an awaiting-input node**.
- **Scope fence:** server only; `piflowRunStream` untouched; no GUI.
- **Verify:** `npx tsc -b`; `vitest run packages/core/test/{watch,observe,read}.test.ts`.

### P3 — GUI consumes the enriched stream (behind the flag, default `poll`)
- **Files:** `runStream.ts`, `runView.ts` (`toFlowGraph`/adapter), `WorkflowCanvas.tsx`, `RunDigestPanel.tsx`, flag resolver.
- **Change:** widen `LiveModel`/`LiveNode` to the full node; `reduce` handles `node-enriched`; `toFlowGraph` renders from the live model; file-tree refresh on `node-status`; RunDigestPanel off deltas; resolve the dead `recent`/context.
- **Acceptance:** flag `poll` (default) → byte-identical to today. Flag `sse` → a live run renders **a concrete streamed value** (assert a fixture node's `tokens.billable` and one `derived` tone reach a rendered `FlowNode`, not "renders correctly"); running-node clock still ticks; file tree updates as nodes finish.
- **Scope fence:** flag default stays `poll`; no poll-path deletion.
- **Verify:** `cd gui && npx tsc --noEmit -p tsconfig.json && npx vite build`; manual run under both flag values.

### P4 — Shadow-diff parity gate + flip default to `sse`
- **Files:** `WorkflowCanvas.tsx` (dev shadow branch), a dev assertion helper.
- **Acceptance:** shadow-diff over the **full field key** (DR7) clean (0 divergences) on a game-omni run **and** a multi-node parallel run; flip default `sse`; `poll` still works.
- **Scope fence:** do not remove the poll path.
- **Verify:** live runs with shadow-diff on; inspect the divergence log.

### P5 — Demote the polls to reconcile + one-shot (retire the hot loops)
- **Files:** `WorkflowCanvas.tsx`, `RunDigestPanel.tsx`.
- **Change:** on the `sse` code path only, remove the 3 s telemetry re-poll (graph) and the digest self-poll; keep `/run-view` for one-shot + reconcile net; RunDigestPanel refetches on `done`. The `poll` path and the SSE-failure degrade retain the 3 s re-arm verbatim.
- **Acceptance:** no 3 s `buildRunView`/`run-digest` calls during a live `sse` run (verify via server logs / network tab); reconnect re-syncs; a forced SSE failure falls back to poll.
- **Scope fence:** `/run-view`, `buildRunView`, `loadRunView` remain.
- **Verify:** live run; observe request cadence; kill/restore the stream.

---

## 11. Risks & traps (ranked)
1. **Destructive `finalize()` live (blocker, resolved by DR2):** the live path must use the non-destructive `snapshot()`, never `finalize()`; a test pins open-span correctness.
2. **Seed/offset byte-alignment (M2):** seed via `tailEvents` `[0,size)` and store that offset; never re-stat; one long-lived accumulator, never recreated except reconnect-from-0. Otherwise double-counted billable/cost/contextPeak.
3. **New kind dropped by CLI allowlist (B2):** register `node-enriched` in `remote.ts` `RUN_UPDATE_KINDS`.
4. **Running-clock exception:** never server-compute live elapsed; `NodeModeStrip` `Date.now()` stays view-side; `deriveNode.time` stays `null` for running nodes; the anti-freeze signature excludes clock/updatedAt.
5. **Delta completeness (M4):** the delta carries the **full** node, not just tokens+derived, or the rendered HUD blanks.
6. **Structure parity (DR4):** `resolveStructure` in both paths, or live edges/stages diverge from loaded.
7. **Reconnect open-span loss (DR6):** reconnect seeds from byte 0, else transient wrong `toolError`/dominance until node completion.
8. **RunDigestPanel second loop (M3):** account for it in the cutover or its 3 s replay survives.
9. **Optional-fields + registered-kinds wire:** CLI/TUI/remote read the superset.
10. **Reconcile merge rule (DR6):** MODEL REPLACE, not field-merge (one merge path).
11. **Multi-client scale:** one `watchRun` + a full seed replay per (re)connect; `log()` it; debounce reconnects; revisit with a shared per-run watcher.

---

## 12. Verification matrix
| Phase | tsc | unit | mutation | parity/shadow | live smoke |
|---|---|---|---|---|---|
| P0a | ✓ core | ✓ unchanged | ✓ spine + snapshot≡finalize | — | — |
| P0b | ✓ core | ✓ updated edges | — | ✓ read≡buildRunView structure | — |
| P1 | ✓ | ✓ superset + allowlist | — | — | — |
| P2 | ✓ core | ✓ anti-freeze/open-span/byte-align/mirror | ✓ anti-freeze | ✓ snapshot≡buildRunView (4 statuses) | — |
| P3 | ✓ gui | ✓ streamed-value reaches FlowNode | — | — | ✓ both flags |
| P4 | ✓ | — | — | ✓ full-key shadow-diff clean | ✓ game-omni + parallel |
| P5 | ✓ gui | — | — | — | ✓ cadence + failover |

---

## 13. Open questions
**Engineering (decide before/at P2 — have correctness teeth):**
1. `node-enriched` change-detector signature — the DR3 rule (`billable | contextPeak | toolCalls | any derived tone`) is proposed; confirm it is neither too coarse (freeze) nor too fine (every poll emits).
2. Reused-node token semantics if a future feature carries `rec.usage` on resume (M1) — carry vs re-replay.

**Product/UX (P3+):**
3. Flag surface: env/build default + `?live=` override only, or also a user-visible toggle? (Recommend no user toggle yet.)
4. Reconcile cadence: reconnect + visibility only, or add a slow (30 s) safety poll? (Recommend the former first.)
5. `RunDigestPanel` cadence: event-driven vs accepted slower poll.
6. Cutover bar: how long shadow-diff must be clean before flipping (recommend ≥1 game-omni + ≥1 parallel run).
7. Retire the poll entirely, ever? This doc keeps it as fallback indefinitely.

---

## 14. Appendix — code anchors
- Poll loops: `gui/src/components/WorkflowCanvas.tsx:139-177`; `gui/src/components/RunDigestPanel.tsx:60-81`.
- Full replay: `packages/core/src/observe/runView.ts:162-176` (`replayEvents`), called `:258`.
- Batch enrichment / spine to extract: `runView.ts:257-339` (loop), `:295-314` (spine), `:446-452` (tokenTotal fold), `:338` (`deriveNode`).
- Destructive vs non-destructive reducer read: `packages/core/src/observe/distill.ts:251-254` (`finalize`), `:242-249` (`metrics`).
- Incremental tail (reuse): `packages/core/src/observe/watch.ts:35-55` (`tailEvents`), `:70` (offsets), `:86-95` (snapshot-once + offset seed), `:108-118` (event deltas).
- Lean snapshot: `packages/core/src/observe/read.ts:104` (`readRunModel`), `:153-169` (io-edge reconstruction).
- Wire contract: `packages/core/src/observe/types.ts` (`NodeView` `:39`, `RunModel` `:91`, `RunUpdate` `:119`).
- Remote CLI allowlist: `packages/cli/src/remote.ts:38` (`RUN_UPDATE_KINDS`), `:111`.
- SSE endpoint / run-view route: `packages/server/src/handlers.ts:82` (`piflowRunStream`, `piflowRunView`).
- GUI SSE consumer: `gui/src/data/runStream.ts` (`useRunStream`, `reduce`, `LiveNode` `:14-21`, dead `recent`/context `:61-76`); render target `toFlowGraph` in `gui/src/data/runView.ts:479`.

---

## 15. Review log (2026-07-01)
Adversarially reviewed across four lenses (correctness-vs-code, architecture/robustness, migration/revertability, completeness/gaps) against the real source. Core thesis upheld — *fold-in-`watchRun`, share `assembleNode`/`nodeTokenSpine`/`deriveNode`, demote-not-delete the poll behind a flag* — no finding undermined the direction. Confirmed (code-verified) findings folded in: **B1** non-destructive `snapshot()` (else `finalize()` corrupts live derived) → DR2; **B2** register `node-enriched` in the CLI allowlist → DR7/§6/P1/Risk 3; **B3** split P0 into pure P0a + behavior-changing P0b → §10; **M1** node-lifecycle fold contract → §9; **M2** accumulator byte-alignment invariants → DR3/§6/P2; **M3** `RunDigestPanel`'s second replay loop → §2/§6/DR5/P5; **M4** the delta carries the **full** node → DR3; **M5** shadow-diff over the full rendered field key → DR7/P4. Wording folded: client-only flag (D2), reconcile = model replace (D3), hash excludes clock (D4), dead `recent`/context fate (D5), reconnect-from-0 open-span reconstruction (D1→DR6), per-connect replay note (D6), re-scoped open questions (D7).

---

## 16. Build log
Landed on `feat/observe-live-sse-source` (not yet merged; full gate green + adversarial mutation-probe at each):
- `5bd120e` — **P0a** pure extraction: `nodeTokenSpine` + `assembleNode` + non-destructive `acc.snapshot()` twin of `finalize()`.
- `3881e46` — **P0b** `resolveStructure`: `readRunModel` now prefers `.pi/workflow.json` → edge/stage parity with `buildRunView`.
- `bd9803e` — **P1** widened wire: optional `tokens`/`derived`/`tokenTotal`, the `node-enriched` `RunUpdate` kind, and the CLI `RUN_UPDATE_KINDS` allowlist.
- `9f75bb8` — **P2** `watchRun` folds telemetry incrementally + emits `node-enriched` deltas — the server-side single source (mirror-tested vs `buildRunView` over pi + Claude + reused + awaiting-input nodes).
- `8f1cd7e` — **P3** GUI renders the graph from the enriched `live.model` behind the `liveSource` flag (default `poll`).
- `f19b3c4` — **P4a** dev-only shadow-diff parity harness (`?shadow=1`).
- `67beeb0` — stages fix: `liveModelToRunView` carries the SSE snapshot stages (clean `SSE≡/run-view` parity).

Default is `poll`, so this is zero behavior change and ships safely as-is. **P4-live** (prove shadow-diff clean on a full + a parallel run, then flip the default to `sse`) and **P5** (demote the two 3 s replay loops) remain and are **human-gated** — the runbook is `docs/design/observe-live-sse-single-source-HANDOFF.md`.
