// @piflow/langgraph — the generic Pi Flow ↔ LangGraph.js connector.
//
//   ACTIVATE a run:   launchRun({ templateDir, args })            -> { runId, runDir, child }
//   STREAM status:    streamStatus(runDir) === core watchRun      -> AsyncIterable<RunUpdate>
//   GROUND into graph: bridgeToWriter(runDir, config)             -> writes config.writer per frame, returns terminal RunModel
//   one-shot outcome: awaitTerminal(runDir)                       -> RunModel | null
//   drop-in sugar:    WorkflowRunAnnotation, createWorkflowRunNode
//
// No product/domain vocabulary lives here — the connector only transports run status; the app maps it.

export { launchRun, newRunId } from './launch.js';
export type { LaunchOpts, LaunchHandle } from './launch.js';

export { streamStatus, bridgeToWriter, awaitTerminal } from './stream.js';
export type { StatusWriterConfig, BridgeOpts, AwaitTerminalOpts, RunUpdate, RunModel } from './stream.js';

export { WorkflowRunAnnotation, createWorkflowRunNode } from './node.js';
export type { WorkflowRunNodeOpts } from './node.js';
