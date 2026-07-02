// sseParity.test.ts — the P4-live headless PARITY GATE (docs/design/observe-live-sse-single-source.md §10-P4).
//
// Before the live default flips 'poll' → 'sse', we must PROVE the SSE-rendered graph is byte-identical to the
// authoritative /run-view — the design's ?live=sse&shadow=1 browser eyeball. This test IS that proof, made
// deterministic and headless: it drives the SAME code the browser drives, end to end.
//
//   REAL watchRun (the SSE source)  ──frames──▶  REAL reduce (the fold)  ──▶  REAL liveModelToRunView (adapter)
//                                                                                        │
//   REAL buildRunView (the /run-view source) ────────────────────────────────▶  REAL shadowDiff( sse , poll )
//
// The frames are folded exactly as the wire delivers them (handlers.ts writes each watchRun update VERBATIM as
// `data: <json>`), so a JSON round-trip precedes the fold. A non-empty shadowDiff names the exact node+field —
// the same actionable log the in-browser gate prints — and is a REAL bug to fix in the fold/adapter, not here.
import { describe, it, expect } from "vitest";
import { promises as fs, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ── the GUI fold path under test (the exact modules the browser bundles) ──────────────────────────────
import { reduce, INITIAL, type Frame, type LiveModel } from "./runStream";
import { liveModelToRunView, type RunView } from "./runView";
import { shadowDiff } from "./shadowDiff";

// ── the SERVER single source (core src, imported by relative path like the core tests do — node-safe deps) ─
import { watchRun, type WatchOpts } from "../../../packages/core/src/observe/watch.js";
import { buildRunView } from "../../../packages/core/src/observe/runView.js";
import { runJsonFile, nodeEventsFile, writeNodeIo } from "../../../packages/core/src/runner/layout.js";
import type { RunStatus, NodeStatusRecord } from "../../../packages/core/src/runner/status.js";
import type { NodeIo } from "../../../packages/core/src/types.js";
import type { PiEvent } from "../../../packages/core/src/runner/events.js";
import type { RunUpdate } from "../../../packages/core/src/observe/types.js";

const mkRunDir = (): string => mkdtempSync(path.join(tmpdir(), "piflow-sse-parity-"));

/** The wire is JSON on BOTH sides: the SSE frames AND the /run-view response (`res.json()`) round-trip through
 *  JSON, so keys with `undefined` values drop on both. Mirror that here or a `preview:undefined`-style ghost
 *  divergence appears that the browser never sees. */
const asWire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const rec = (id: string, label: string, status: NodeStatusRecord["status"], extra: Partial<NodeStatusRecord> = {}): NodeStatusRecord =>
  ({ id, label, status, artifacts: [], issues: [], ...extra });

async function writeRunJson(runDir: string, status: RunStatus): Promise<void> {
  const rj = runJsonFile(runDir);
  await fs.mkdir(path.dirname(rj), { recursive: true });
  await fs.writeFile(rj, JSON.stringify(status, null, 2));
}

async function writeNodeFixture(runDir: string, io: NodeIo, events: PiEvent[] = []): Promise<void> {
  await writeNodeIo(runDir, io);
  if (events.length) {
    const ef = nodeEventsFile(runDir, io.id);
    await fs.mkdir(path.dirname(ef), { recursive: true });
    await fs.writeFile(ef, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One assistant message_end that accrues billable input/output + a totalTokens context peak. */
const usageEvent = (input: number, output: number, totalTokens: number): PiEvent =>
  ({ type: "message_end", message: { role: "assistant", model: "m1", provider: "cp", usage: { input, output, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens }, stopReason: "end_turn" } }) as unknown as PiEvent;

const appendEvents = (runDir: string, id: string, events: PiEvent[]): Promise<void> =>
  fs.appendFile(nodeEventsFile(runDir, id), events.map((e) => JSON.stringify(e)).join("\n") + "\n");

/** Write the run-local resolved DAG (`.pi/workflow.json`) — the tier-1 structure BOTH readers resolve from. */
async function writeWorkflowJson(runDir: string, stages: { index: number; phase: string; parallel: boolean; nodeIds: string[] }[], edges: { from: string; to: string }[]): Promise<void> {
  const f = path.join(runDir, ".pi", "workflow.json");
  await fs.mkdir(path.dirname(f), { recursive: true });
  // edges with no `files` resolve to path '' on BOTH readers (structure.ts), so edge parity is independent of
  // each reader's displayPath — we test the topology, not path-stripping (covered elsewhere).
  await fs.writeFile(f, JSON.stringify({ meta: { name: "fan" }, profile: null, stages, edges: edges.map((e) => ({ ...e, files: [] })) }, null, 2) + "\n");
}

/** A run with a real PARALLEL stage: seed → {a,b,c fan-out} → join, each node token-enriched + settled. */
async function buildParallelRun(runDir: string): Promise<void> {
  const ids = ["seed", "a", "b", "c", "join"] as const;
  const status: RunStatus = {
    run: "fan5", provider: "cp", model: "m1",
    startedAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:09.000Z",
    done: true, ok: true, durationMs: 9000, stage: null,
    totals: { nodes: 5, ok: 5, failed: 0 },
    nodes: Object.fromEntries(ids.map((id, i) => [id, rec(id, id.toUpperCase(), "ok", { model: "m1", durationMs: 1000 + i * 100 })])),
  };
  await writeRunJson(runDir, status);
  for (const id of ids) {
    await writeNodeFixture(
      runDir,
      { id, label: id.toUpperCase(), phase: id === "seed" ? "seed" : id === "join" ? "join" : "fan", reads: [], writes: [], promotes: [], status: "ok" },
      [usageEvent(10 + ids.indexOf(id), 5, 100 + ids.indexOf(id) * 10)],
    );
  }
  await writeWorkflowJson(
    runDir,
    [
      { index: 1, phase: "seed", parallel: false, nodeIds: ["seed"] },
      { index: 2, phase: "fan", parallel: true, nodeIds: ["a", "b", "c"] },
      { index: 3, phase: "join", parallel: false, nodeIds: ["join"] },
    ],
    [
      { from: "seed", to: "a" }, { from: "seed", to: "b" }, { from: "seed", to: "c" },
      { from: "a", to: "join" }, { from: "b", to: "join" }, { from: "c", to: "join" },
    ],
  );
}

/**
 * Fold a completed run's watchRun stream through the REAL gui reducer exactly as the browser would: seed a meta
 * frame (the bridge sends one first), then apply every update JSON-round-tripped (the wire is `data: <json>`).
 * Returns the final LiveModel — the model `liveModelToRunView` renders from.
 */
async function foldStream(runDir: string, run: string, ctxOpts: Omit<WatchOpts, "signal" | "pollMs"> = {}): Promise<LiveModel> {
  const ctrl = new AbortController();
  let state = reduce(INITIAL, { kind: "meta", run, runDir } as Frame);
  for await (const u of watchRun(runDir, { signal: ctrl.signal, pollMs: 10, ...ctxOpts })) {
    // mimic the SSE wire: each update is serialized then parsed by the browser before the fold.
    const frame = JSON.parse(JSON.stringify(u)) as Frame;
    state = reduce(state, frame);
    if ((u as RunUpdate).kind === "done") break;
  }
  if (!state.model) throw new Error("stream produced no model");
  return state.model;
}

/** Build a settled two-node run (a pi event-replay node + a Claude rec.usage node), like the core mirror test. */
async function buildTwoNodeRun(runDir: string): Promise<void> {
  const status: RunStatus = {
    run: "par2", provider: "cp", model: "m1",
    startedAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:05.000Z",
    done: true, ok: true, durationMs: 5000, stage: null,
    totals: { nodes: 2, ok: 2, failed: 0 },
    nodes: {
      pi: rec("pi", "Pi Node", "ok", { model: "m1", durationMs: 4000, artifacts: [{ path: "out/pi.txt", exists: true, bytes: 3 }] }),
      cl: rec("cl", "Claude Node", "ok", {
        model: "claude-haiku-4-5-20251001", durationMs: 3000,
        artifacts: [{ path: "out/cl.txt", exists: true, bytes: 5 }],
        usage: { inputTokens: 18, outputTokens: 337, cacheRead: 17172, cacheCreation: 4790, cost: 0.0130002, contextWindow: 200000, numTurns: 2, stopReason: "end_turn" },
      }),
    },
  };
  await writeRunJson(runDir, status);

  const piEvents: PiEvent[] = [
    { type: "message_start", message: { role: "assistant", model: "m1", provider: "cp" } },
    { type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "spec/in.txt" }, _t: 0 },
    { type: "tool_execution_end", toolCallId: "1", isError: false, _t: 10 },
    { type: "tool_execution_start", toolCallId: "2", toolName: "write", args: { path: "out/pi.txt" }, _t: 20 },
    { type: "tool_execution_end", toolCallId: "2", isError: false, _t: 30 },
    { type: "message_end", message: { role: "assistant", usage: { input: 100, output: 20, cacheRead: 900, cacheWrite: 0, cost: 0.5, totalTokens: 1000 }, stopReason: "end_turn" } },
  ] as unknown as PiEvent[];
  await writeNodeFixture(
    runDir,
    { id: "pi", label: "Pi Node", phase: undefined, reads: [{ path: "spec/in.txt" }], writes: [{ path: "out/pi.txt", verified: true, bytes: 3 }], promotes: [], status: "ok" },
    piEvents,
  );
  await fs.mkdir(path.resolve(runDir, "out"), { recursive: true });
  await fs.mkdir(path.resolve(runDir, "spec"), { recursive: true });
  await fs.writeFile(path.resolve(runDir, "out/pi.txt"), "pi!");
  await fs.writeFile(path.resolve(runDir, "spec/in.txt"), "input-bytes");

  await writeNodeFixture(
    runDir,
    { id: "cl", label: "Claude Node", phase: undefined, reads: [], writes: [{ path: "out/cl.txt", verified: true, bytes: 5 }], promotes: [], status: "ok" },
    [],
  );
  await fs.writeFile(path.resolve(runDir, "out/cl.txt"), "hello");
}

/** A single-node run whose node `x` is settled at `durationMs`, with one usage event so it enriches. */
async function buildTimedRun(runDir: string, run: string, durationMs: number): Promise<void> {
  const status: RunStatus = {
    run, provider: "cp", model: "m1",
    startedAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:09.000Z",
    done: true, ok: true, durationMs, stage: null, totals: { nodes: 1, ok: 1, failed: 0 },
    nodes: { x: rec("x", "X", "ok", { model: "m1", durationMs }) },
  };
  await writeRunJson(runDir, status);
  await writeNodeFixture(runDir, { id: "x", label: "X", phase: undefined, reads: [], writes: [], promotes: [], status: "ok" }, [usageEvent(10, 2, 100)]);
}

/** Write a history sibling: `.pi/run.json` recording node `x`'s durationMs (buildHistory's expectedMs source). */
async function writeHistorySibling(dir: string, xDurationMs: number): Promise<void> {
  const status: RunStatus = {
    run: "hist-sib", provider: "cp", model: "m1",
    startedAt: "2026-06-30T00:00:00.000Z", updatedAt: "2026-06-30T00:00:01.000Z",
    done: true, ok: true, durationMs: xDurationMs, stage: null, totals: { nodes: 1, ok: 1, failed: 0 },
    nodes: { x: rec("x", "X", "ok", { model: "m1", durationMs: xDurationMs }) },
  };
  await writeRunJson(dir, status);
}

// ── P4-live real-run proof (env-gated; self-skips in CI) ────────────────────────────────────────────
// The design's acceptance bar is "SSE ≡ /run-view over ≥1 full + ≥1 parallel REAL run". Point this at a real
// served run's dir to exercise the fold against real Claude/pi nodes, tool timelines, artifacts, checkpoints,
// agentTypes — the field combinations synthetic fixtures miss:
//   PIFLOW_PARITY_RUN=/…/game-omni/.piflow/game-omni/runs/gs01 \
//   PIFLOW_PARITY_HISTORY=/…/runs/gs01,/…/runs/p06,/…/runs/run01 \
//   PIFLOW_PARITY_WORKSPACE=/…/game-omni  npx vitest run gui/src/data/sseParity.test.ts
const REAL_RUN = process.env.PIFLOW_PARITY_RUN;
const realRunIt = REAL_RUN ? it : it.skip;

describe("P4-live — real-run parity (env-gated PIFLOW_PARITY_RUN)", () => {
  realRunIt("SSE fold ≡ /run-view over a REAL run, fed the handler's history + workspace", async () => {
    const runDir = REAL_RUN!;
    const historyDirs = (process.env.PIFLOW_PARITY_HISTORY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const workspaceRoot = process.env.PIFLOW_PARITY_WORKSPACE || null;
    const runId = path.basename(runDir);

    const model = await foldStream(runDir, runId, { historyDirs, workspaceRoot });
    const sseView = asWire(liveModelToRunView(model) as RunView);
    const pollView = asWire(buildRunView(runDir, { historyDirs, workspaceRoot }).view as unknown as RunView);

    // teeth: the real run actually rendered nodes (a mis-resolved dir would silently compare two empties).
    expect(sseView.nodes.length).toBeGreaterThan(0);
    const div = shadowDiff(sseView, pollView);
    expect(div, JSON.stringify(div, null, 2)).toEqual([]);
  });
});

describe("P4 parity — context faithfulness: the SSE stream must be fed the SAME history/workspace as /run-view", () => {
  it("REPRO (teeth): watchRun with NO history diverges from /run-view built WITH history, on derived.time", async () => {
    const runDir = mkRunDir();
    await buildTimedRun(runDir, "hist1", 5000); // node x took 5000ms this run
    const histDir = mkRunDir();
    await writeHistorySibling(histDir, 1000); // …but averaged 1000ms across history ⇒ ratio 5 ⇒ tone 'high'

    // SSE side WITHOUT history (the pre-fix watchRun) vs /run-view WITH history (what the handler passes).
    const model = await foldStream(runDir, "hist1");
    const sseView = asWire(liveModelToRunView(model) as RunView);
    const pollView = asWire(buildRunView(runDir, { historyDirs: [histDir] }).view as unknown as RunView);

    const div = shadowDiff(sseView, pollView);
    // Proves BOTH: (a) history changes derived.time, and (b) the shadow-diff catches the mismatch — so the SSE
    // stream MUST be given the same historyDirs as /run-view (below) or the flipped live graph would diverge.
    expect(div.some((d) => d.scope === "node" && d.id === "x" && d.field.startsWith("derived.time"))).toBe(true);
  });

  it("with the SAME history context, watchRun folds CLEAN vs /run-view", async () => {
    const runDir = mkRunDir();
    await buildTimedRun(runDir, "hist2", 5000);
    const histDir = mkRunDir();
    await writeHistorySibling(histDir, 1000);

    // SSE side fed the SAME historyDirs the /run-view handler uses ⇒ identical expectedMs ⇒ identical derived.time.
    const model = await foldStream(runDir, "hist2", { historyDirs: [histDir] });
    const sseView = asWire(liveModelToRunView(model) as RunView);
    const pollView = asWire(buildRunView(runDir, { historyDirs: [histDir] }).view as unknown as RunView);

    const divergences = shadowDiff(sseView, pollView);
    expect(divergences, JSON.stringify(divergences, null, 2)).toEqual([]);
  });
});

describe("P4 parity — the SSE fold ≡ /run-view over the REAL adapter path", () => {
  it("folding watchRun through reduce → liveModelToRunView shadow-diffs CLEAN vs buildRunView", async () => {
    const runDir = mkRunDir();
    await buildTwoNodeRun(runDir);

    const model = await foldStream(runDir, "par2");
    const sseView = asWire(liveModelToRunView(model) as RunView);
    const pollView = asWire(buildRunView(runDir).view as unknown as RunView);

    const divergences = shadowDiff(sseView, pollView);
    // A non-empty result names the exact node+field that diverges — print it so a failure is actionable.
    expect(divergences, JSON.stringify(divergences, null, 2)).toEqual([]);
  });

  it("shadowDiff HAS TEETH: a single perturbed field surfaces as the exact node+leaf (test-the-test)", async () => {
    const runDir = mkRunDir();
    await buildTwoNodeRun(runDir);

    const model = await foldStream(runDir, "par2");
    const clean = asWire(liveModelToRunView(model) as RunView);
    const pollView = asWire(buildRunView(runDir).view as unknown as RunView);
    // sanity: clean is actually clean (guards against a vacuously-passing teeth check).
    expect(shadowDiff(clean, pollView)).toEqual([]);

    // Perturb ONE node's billable on the SSE side — the gate must catch it at the exact leaf.
    const perturbed: RunView = {
      ...clean,
      nodes: clean.nodes.map((n) => (n.id === "pi" && n.tokens ? { ...n, tokens: { ...n.tokens, billable: n.tokens.billable + 1 } } : n)),
    };
    const div = shadowDiff(perturbed, pollView);
    expect(div.some((d) => d.scope === "node" && d.id === "pi" && d.field === "tokens.billable")).toBe(true);
  });

  it("shadow-diffs CLEAN across a PARALLEL stage (stages/lane/stageIndex + edges parity, fan-out of 3)", async () => {
    const runDir = mkRunDir();
    await buildParallelRun(runDir);

    const model = await foldStream(runDir, "fan5");
    const sseView = asWire(liveModelToRunView(model) as RunView);
    const pollView = asWire(buildRunView(runDir).view as unknown as RunView);

    // teeth: the fixture MUST actually contain a parallel stage — else this test proves nothing about fan-out.
    expect(sseView.stages.some((s) => s.parallel && s.nodeIds.length === 3)).toBe(true);
    // the 3 fan nodes occupy distinct lanes in the same stage (what the parallel layout renders).
    const fan = sseView.nodes.filter((n) => ["a", "b", "c"].includes(n.id));
    expect(new Set(fan.map((n) => n.stageIndex))).toEqual(new Set([2]));
    expect(new Set(fan.map((n) => n.lane))).toEqual(new Set([0, 1, 2]));

    const divergences = shadowDiff(sseView, pollView);
    expect(divergences, JSON.stringify(divergences, null, 2)).toEqual([]);
  });

  it("INCREMENTAL node-enriched deltas fold to the same parity as /run-view (the live path)", async () => {
    const runDir = mkRunDir();
    // an IN-FLIGHT run: one running node seeded with a usage event; more events arrive across polls.
    const status: RunStatus = {
      run: "live1", provider: "cp", model: "m1",
      startedAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:01.000Z",
      done: false, ok: null, durationMs: null, stage: null, totals: null,
      nodes: { r0: rec("r0", "Runner", "running", { model: "m1" }) },
    };
    await writeRunJson(runDir, status);
    await writeNodeFixture(runDir, { id: "r0", label: "Runner", phase: undefined, reads: [], writes: [], promotes: [], status: "running" }, [usageEvent(10, 2, 12)]);

    const ctrl = new AbortController();
    const frames: Frame[] = [];
    let state = reduce(INITIAL, { kind: "meta", run: "live1", runDir } as Frame);

    // Drive: after the snapshot, append a usage event (billable 12 → 24), await its enriched delta, then settle.
    const driver = (async () => {
      while (!frames.some((f) => f.kind === "snapshot")) await sleep(5);
      await appendEvents(runDir, "r0", [usageEvent(10, 2, 20)]);
      while (!frames.some((f) => f.kind === "node-enriched" && ((f as { node: { tokens?: { billable?: number } } }).node.tokens?.billable ?? 0) >= 24)) await sleep(5);
      status.done = true; status.ok = true; status.durationMs = 1000;
      status.nodes.r0.status = "ok"; status.nodes.r0.durationMs = 1000;
      await writeRunJson(runDir, status);
    })();

    for await (const u of watchRun(runDir, { signal: ctrl.signal, pollMs: 10 })) {
      const frame = asWire(u) as Frame; // mimic the wire (JSON round-trip) then fold through the REAL reducer
      frames.push(frame);
      state = reduce(state, frame);
      if ((u as RunUpdate).kind === "done") break;
    }
    await driver;

    // teeth: we ACTUALLY exercised the delta path (a completed-run stream would carry only a snapshot).
    expect(frames.some((f) => f.kind === "node-enriched")).toBe(true);

    const sseView = asWire(liveModelToRunView(state.model!) as RunView);
    const pollView = asWire(buildRunView(runDir).view as unknown as RunView);
    const divergences = shadowDiff(sseView, pollView);
    expect(divergences, JSON.stringify(divergences, null, 2)).toEqual([]);
  });
});
