// ── stream — GROUND @piflow/core's shared run-status stream into a LangGraph graph ───────────────────
// We do NOT invent a status channel. `@piflow/core/observe` already exposes the ONE live stream every
// view renders — `watchRun(runDir) -> AsyncIterable<RunUpdate>` (snapshot -> node-status -> node-event
// -> done), the running status of all the pi agents. This module only ADAPTS that existing stream to a
// LangGraph consumer: each `RunUpdate` is pushed through `config.writer` (idiomatic `streamMode:'custom'`),
// and the TERMINAL `RunModel` is returned once for a single state fold. `config.signal` threads straight
// into `watchRun`'s abort, so an aborted graph stops the stream promptly.

import { watchRun, readRunModel, type RunUpdate, type RunModel } from '@piflow/core';

/** Re-export of the core stream verbatim — the SAME layer the CLI `watch` + the TUI consume. */
export { watchRun as streamStatus };
export type { RunUpdate, RunModel };

/**
 * The minimal slice of a LangGraph `RunnableConfig` the bridge touches — `writer` (the `streamMode:'custom'`
 * sink) + `signal` (abort). Declared structurally so the bridge is testable with a plain object and does
 * not hard-couple to a specific `@langchain/langgraph` type name.
 */
export interface StatusWriterConfig {
  writer?: (chunk: unknown) => void;
  signal?: AbortSignal;
}

export interface BridgeOpts {
  /** Map each `RunUpdate` to the frame your consumer wants. Default: identity (the raw `RunUpdate`). */
  map?: (u: RunUpdate) => unknown;
  /** Injectable stream source (testing) — overrides `watchRun(runDir)` with a deterministic sequence. */
  updates?: AsyncIterable<RunUpdate>;
  /** Poll cadence (ms) for the default `watchRun` source. */
  pollMs?: number;
}

/**
 * Stream a run's live status into `config.writer`, returning the terminal `RunModel`.
 *
 * Writes one frame per `RunUpdate` (including the terminal `{kind:'done'}`) then stops. For a real run
 * (`opts.updates` omitted) it re-reads `readRunModel(runDir)` after `done` so the returned model carries
 * the FINAL ok/duration/node-statuses (the lone `snapshot` watchRun emits is the run's START). Never
 * throws on a bad writer or an unreadable final model — status transport must not break the run.
 */
export async function bridgeToWriter(
  runDir: string,
  config: StatusWriterConfig,
  opts: BridgeOpts = {},
): Promise<RunModel | null> {
  const map = opts.map ?? ((u: RunUpdate) => u);
  const source = opts.updates ?? watchRun(runDir, { signal: config.signal, pollMs: opts.pollMs });

  let terminal: RunModel | null = null;
  for await (const u of source) {
    if (u.kind === 'snapshot') terminal = u.model;
    try { config.writer?.(map(u)); } catch { /* a faulty consumer must never break the stream */ }
    if (u.kind === 'done') break;
  }

  if (opts.updates === undefined) {
    try { terminal = await readRunModel(runDir); } catch { /* keep the last snapshot we saw */ }
  }
  return terminal;
}

export interface AwaitTerminalOpts {
  signal?: AbortSignal;
  pollMs?: number;
}

/**
 * Wait for a run to finish WITHOUT streaming, then return its terminal `RunModel`. For a consumer that
 * only wants the one-shot outcome (e.g. fold the result into agent state once), not live heartbeats.
 */
export async function awaitTerminal(runDir: string, opts: AwaitTerminalOpts = {}): Promise<RunModel | null> {
  for await (const u of watchRun(runDir, { signal: opts.signal, pollMs: opts.pollMs })) {
    if (u.kind === 'done') break;
  }
  try { return await readRunModel(runDir); } catch { return null; }
}
