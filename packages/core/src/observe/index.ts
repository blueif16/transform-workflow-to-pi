// @piflow/core/observe — THE shared observability source: one reader, one model, one live stream.
// `readRunModel` is the one-shot snapshot; `watchRun` is the live stream. The CLI, the TUI, and a
// future GUI all render the SAME `RunModel`/`RunUpdate` contract (src/observe/types.ts) over the
// engine-owned `.pi/` run layout — no view re-derives status, stages, or edges on its own.

export { readRunModel, readRunJson, deriveStatus } from './read.js';
export { watchRun } from './watch.js';
export type { WatchOpts } from './watch.js';
export type { RunModel, RunUpdate, NodeView, StageView, EdgeView } from './types.js';
