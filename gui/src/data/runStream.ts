// runStream.ts — the GUI's LIVE run-telemetry client. Subscribes to the SSE bridge
// (gui/vite.config.ts `/__piflow/stream/<run>`), which pipes the EXACT
// `@piflow/core/observe` `watchRun` stream. The view types here MIRROR observe/types.ts
// (RunModel/RunUpdate) — the shapes are the shared contract, not a fork. It carries the live
// status + snapshot model and folds NOTHING: the canvas renders the fully-derived run-view the
// `/__piflow/run-view/<run>` poll returns (the observe surface stamps every zone). Real data only.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { sse, useEndpoint } from "./apiBase";

export type LiveNodeStatus =
  | "pending" | "running" | "ok" | "reused" | "gap" | "blocked" | "error" | "dry";

/** A node as the live model carries it (subset of observe NodeView). */
export interface LiveNode {
  id: string;
  label: string;
  phase: string | null;
  status: LiveNodeStatus;
  stageIndex: number;
  lane: number;
}

/** The live snapshot (subset of observe RunModel). */
export interface LiveModel {
  run: string;
  done: boolean;
  ok: boolean | null;
  durationMs: number | null;
  provider?: string;
  model?: string | null;
  totals: { nodes: number; ok: number; failed: number } | null;
  nodes: LiveNode[];
  /** file-flow edges (a writer's path read back by a consumer) — fills in as nodes complete. */
  edges?: { from: string; to: string; path: string }[];
}

/** A wire frame: the observe RunUpdate kinds + the bridge's `meta`/`stream-error` wrappers. */
type Frame =
  | { kind: "meta"; run: string; runDir: string }
  | { kind: "snapshot"; model: LiveModel }
  | { kind: "node-status"; id: string; status: LiveNodeStatus }
  | { kind: "node-event"; id: string; event: Record<string, unknown> }
  | { kind: "done" }
  | { kind: "stream-error"; error: string };

export interface RunEvent { id: string; event: Record<string, unknown> }

export interface RunStreamState {
  status: "connecting" | "live" | "done" | "error";
  model: LiveModel | null;
  /** rolling tail of the most recent node events — the live "what's happening now" feed. */
  recent: RunEvent[];
  error?: string;
}

const INITIAL: RunStreamState = { status: "connecting", model: null, recent: [] };
const RECENT_CAP = 40;

/** Shared stream state — CanvasInner owns ONE subscription (for the live graph) and provides it here so
 *  the Companion reads the same connection instead of opening a second EventSource. */
export const RunStreamContext = createContext<RunStreamState>(INITIAL);
export const useRunStreamContext = (): RunStreamState => useContext(RunStreamContext);

function reduce(prev: RunStreamState, f: Frame): RunStreamState {
  switch (f.kind) {
    case "meta":
      return prev;
    case "snapshot":
      return { ...prev, status: prev.status === "done" ? "done" : "live", model: f.model };
    case "node-status": {
      if (!prev.model) return prev;
      const nodes = prev.model.nodes.map((n) => (n.id === f.id ? { ...n, status: f.status } : n));
      return { ...prev, model: { ...prev.model, nodes } };
    }
    case "node-event":
      return { ...prev, recent: [...prev.recent, { id: f.id, event: f.event }].slice(-RECENT_CAP) };
    case "done":
      return { ...prev, status: "done" };
    case "stream-error":
      return { ...prev, status: "error", error: f.error };
    default:
      return prev;
  }
}

/**
 * Subscribe to a run's live telemetry. Re-subscribes when `run` changes; closes the
 * EventSource on unmount AND on `done` (a finished run's stream is closed server-side,
 * so we stop EventSource's auto-reconnect). A transient drop mid-run auto-reconnects
 * (EventSource default) and the bridge re-sends a fresh snapshot — idempotent.
 */
export function useRunStream(run: string | null | undefined): RunStreamState {
  const [state, setState] = useState<RunStreamState>(INITIAL);
  const esRef = useRef<EventSource | null>(null);
  // Re-point trigger: a migrate switches the console to a new serve → this baseUrl changes → the effect
  // re-runs and reopens the telemetry stream against the new origin (for the same run id).
  const endpointBase = useEndpoint().baseUrl;

  useEffect(() => {
    if (!run) { setState(INITIAL); return; }
    setState(INITIAL);
    const es = sse(`/__piflow/stream/${encodeURIComponent(run)}`);
    esRef.current = es;
    es.onmessage = (e: MessageEvent) => {
      let f: Frame;
      try { f = JSON.parse(e.data) as Frame; } catch { return; }
      if (f.kind === "done") es.close(); // finished run → stop auto-reconnect
      setState((prev) => reduce(prev, f));
    };
    es.onerror = () => {
      // EventSource retries on its own; only surface an error if we never got a model
      // and the run isn't already done.
      setState((prev) => (prev.status === "done" || prev.model ? prev : { ...prev, status: "error", error: "stream connection failed" }));
    };
    return () => { es.close(); esRef.current = null; };
  }, [run, endpointBase]);

  return state;
}
