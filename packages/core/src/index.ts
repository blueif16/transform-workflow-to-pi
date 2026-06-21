// @piflow/core — public API.
//
// The frozen L1 schema spine (types) is the contract everything plugs into. The compiler + reference
// primitives below are the spine made executable; horizontal seams (cloud sandboxes, MCP/sdk tool
// compilation, the runner, viz, COMPOSE) fill in against these interfaces without changing the spine.

export * from './types.js';

// DAG compiler (data-flow edge inference + topological staging + validation)
export { compile, tryCompile, validate, inferEdges, stagesOf, slugify, WorkflowError } from './dag.js';

// Contract-marker codec (DRIVER-*)
export { emitMarkers, parseMarkers, markersFromNode } from './contract.js';
export type { ContractMarkers } from './contract.js';

// Tool registry (namespace:name → bare pi names)
export { DefaultToolRegistry, BUILTIN_TOOLS, PENDING_EXTENSION } from './tools/registry.js';

// Sandbox providers (lifecycle; in-memory reference impl + not-implemented stubs)
export { InMemorySandbox, InMemorySandboxProvider, NotImplementedProvider } from './sandbox/index.js';

// Deterministic hook runner
export { runHooks } from './hooks/index.js';
export type { HookReport, RunHooksOpts } from './hooks/index.js';
