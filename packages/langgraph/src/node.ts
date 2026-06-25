// ── node — drop-in LangGraph sugar (optional) ────────────────────────────────────────────────────────
// Generic LangGraph primitives over launch + stream: a state Annotation carrying ONLY run-status channels
// (no product/domain fields) and a node factory that launches a run, streams its status to the graph's
// custom stream, and folds the terminal model into state. A graph that wants finer control can compose
// `launchRun` + `bridgeToWriter` directly; this is the convenience path.
//
// `@langchain/langgraph` is a PEER dependency — only this module imports it, so launch/stream stay
// langchain-free (they need nothing but @piflow/core).

import { Annotation } from '@langchain/langgraph';
import type { RunModel, RunUpdate } from '@piflow/core';
import { launchRun, type LaunchOpts } from './launch.js';
import { bridgeToWriter, type StatusWriterConfig } from './stream.js';

/** Last-write-wins run-status channels. Generic — extend this with your own domain channels in the app. */
export const WorkflowRunAnnotation = Annotation.Root({
  runId: Annotation<string | null>({ reducer: (_x, y) => y, default: () => null }),
  runModel: Annotation<RunModel | null>({ reducer: (_x, y) => y, default: () => null }),
  ok: Annotation<boolean | null>({ reducer: (_x, y) => y, default: () => null }),
});

export interface WorkflowRunNodeOpts extends LaunchOpts {
  /** Derive the run `--arg`s from graph state (e.g. read a prompt channel). Overrides `args` when present. */
  argsFrom?: (state: unknown) => Record<string, string>;
  /** Map each `RunUpdate` to the custom-stream frame shape. Default: the raw `RunUpdate`. */
  map?: (u: RunUpdate) => unknown;
}

/**
 * A LangGraph node `(state, config) => { runId, runModel, ok }`: launches a pi workflow run, streams every
 * `RunUpdate` to `config.writer` (consume with `streamMode:'custom'`), and folds the TERMINAL model into
 * state. Emits one synthetic `{kind:'launched', runId, runDir}` frame up front so the UI can link the run
 * immediately. Generic over any template — carries no app vocabulary.
 */
export function createWorkflowRunNode(opts: WorkflowRunNodeOpts) {
  return async (state: unknown, config: StatusWriterConfig) => {
    const args = opts.argsFrom ? opts.argsFrom(state) : (opts.args ?? {});
    const { runId, runDir } = launchRun({ ...opts, args });
    try { config.writer?.({ kind: 'launched', runId, runDir }); } catch { /* non-fatal */ }
    const runModel = await bridgeToWriter(runDir, config, { map: opts.map });
    return { runId, runModel, ok: runModel?.ok ?? null };
  };
}
