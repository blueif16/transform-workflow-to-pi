// The OpenClaw in-process tool HOST — the execute-driver (substrate step S0).
//
// WHY this exists (load-bearing forensic finding — docs/design/openclaw-substrate-adoption.md "Wiring
// plan"): OpenClaw's registry/loader only STORE tool factories; there is NO free "run this tool"
// entrypoint — the `factory(ctx)` → `tool.execute(...)` call lives in OpenClaw's agent runtime, which we
// do NOT vendor. So to HOST a plugin's tool we DRIVE execution ourselves:
//   1. run the plugin's `register(api)` against an `api` WE build (real-or-stub `runtime`, capturing
//      `registerTool`),
//   2. capture the registered tool FACTORY (OpenClaw registers `(ctx) => tool`, not a bare tool def),
//   3. build the tool `ctx`, call `factory(ctx)` to obtain the (lazy) tool,
//   4. call the tool's OWN `execute(toolCallId, params, signal, onUpdate)` and return its result.
//
// This is the EXECUTE side of `openclaw-shim.ts`'s capture side: the shim learns tool DEFS against a
// no-op `api` (its missing `api.runtime` is the purity gate); this host adds a real-enough `runtime` so a
// keyless tool's execute actually runs. S0 proves the driver on `memory-core`'s `memory_get` — an
// fs-backed read of a file under the agent's memory dir that touches NO live gateway.
//
// Scope: S0 only. The `runtime` here is minimal — `state.openKeyedStore` is a real in-memory KV store
// (stored lazily by `memory-core` at register time; never invoked by `memory_get`), and the rest is a
// loud-throwing stub so any unexpected reach surfaces instead of silently no-oping. Later steps
// (S1 breadth, S2 provider-wire, S3 the `runEmbeddedAgent` seam) extend this same driver.

import { resolveEntry, type OpenClawPluginEntry } from './openclaw-shim.js';

/** A captured `registerTool` call: the FACTORY `(ctx) => tool` and the opts (e.g. `{ names: [...] }`). */
interface CapturedFactory {
  factory: (ctx: unknown) => OpenClawTool | null | undefined;
  opts?: { names?: string[] } & Record<string, unknown>;
}

/** The (possibly lazy) tool a factory returns — we only need its `execute`. */
interface OpenClawTool {
  name?: string;
  execute(
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (...a: unknown[]) => void,
  ): unknown;
}

/** Arguments to drive one keyless OpenClaw tool through the host. */
export interface HostOpenClawToolParams {
  /** The imported plugin module (the `definePluginEntry` default export, or its `{ default }` wrapper). */
  mod: unknown;
  /** The registered tool to run — matched against `registerTool` opts `names` (e.g. `'memory_get'`). */
  toolName: string;
  /** The agent workspace dir; the memory file is read relative to it (`<workspaceDir>/<params.path>`). */
  workspaceDir: string;
  /** The tool params, passed verbatim to `execute` (e.g. `{ path: 'memory/note.md' }`). */
  params: Record<string, unknown>;
  /** Optional agent id / session key threaded into the tool `ctx` (default agent when omitted). */
  agentId?: string;
  sessionKey?: string;
  /** Optional explicit toolCallId (defaults to a stable host id). */
  toolCallId?: string;
}

const noop = (): void => {};

/** A real-enough in-memory keyed store matching `PluginStateKeyedStore<T>` (async CRUD over a Map). */
function makeInMemoryKeyedStore<T>(): unknown {
  const map = new Map<string, T>();
  return {
    async register(key: string, value: T): Promise<void> {
      map.set(key, value);
    },
    async registerIfAbsent(key: string, value: T): Promise<void> {
      if (!map.has(key)) map.set(key, value);
    },
    async update(key: string, updater: (prev: T | undefined) => T): Promise<void> {
      map.set(key, updater(map.get(key)));
    },
    async lookup(key: string): Promise<T | undefined> {
      return map.get(key);
    },
    async consume(key: string): Promise<T | undefined> {
      const value = map.get(key);
      map.delete(key);
      return value;
    },
    async delete(key: string): Promise<void> {
      map.delete(key);
    },
    async entries(): Promise<Array<[string, T]>> {
      return [...map.entries()];
    },
    async clear(): Promise<void> {
      map.clear();
    },
  };
}

/**
 * A loud-throwing stub for any `runtime.*` path we did NOT wire. Reaching one means the tool needs a
 * runtime service beyond S0's keyless scope — we WANT that to throw with a precise path, not no-op.
 */
function loudRuntimeStub(pathSoFar: string): unknown {
  return new Proxy(
    () => {
      throw new Error(`openclaw-host: unsupported runtime call \`${pathSoFar}()\` (out of S0 keyless scope)`);
    },
    {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        return loudRuntimeStub(`${pathSoFar}.${String(prop)}`);
      },
    },
  );
}

/**
 * Build the host `api` an OpenClaw plugin's `register(api)` receives, plus the `captured` factories its
 * `registerTool` pushes into. The `runtime` is real where `memory-core` needs it at register time
 * (`state.openKeyedStore`, `config.current`) and a loud-throwing stub elsewhere. Every non-tool
 * registration verb is a graceful no-op (per the doc: stubbing them still registers + runs the tool).
 */
function makeHostApi(cfg: Record<string, unknown>): { api: Record<string, unknown>; captured: CapturedFactory[] } {
  const captured: CapturedFactory[] = [];
  const logger = { info: noop, warn: noop, error: noop, debug: noop, log: noop };

  const runtime: Record<string, unknown> = {
    state: {
      openKeyedStore: () => makeInMemoryKeyedStore(),
      openSyncKeyedStore: () => makeInMemoryKeyedStore(),
    },
    config: { current: () => cfg },
    // Anything else under runtime.* that a plugin reaches throws loudly with its path.
    agent: loudRuntimeStub('runtime.agent'),
    subagent: loudRuntimeStub('runtime.subagent'),
  };

  const api: Record<string, unknown> = {
    runtime,
    // The one verb we capture: OpenClaw registers a FACTORY `(ctx) => tool` plus opts (`{ names }`).
    registerTool: (factory: CapturedFactory['factory'], opts?: CapturedFactory['opts']) => {
      captured.push(opts === undefined ? { factory } : { factory, opts });
    },
    // Graceful no-ops: register-time verbs memory-core calls that the tool's execute does not need.
    registerMemoryCapability: noop,
    registerMemoryEmbeddingProvider: noop,
    registerProvider: noop,
    registerEmbeddingProvider: noop,
    registerWebSearchProvider: noop,
    registerChannel: noop,
    registerCommand: noop,
    registerCli: noop,
    registerService: noop,
    registerHook: noop,
    on: noop,
    emitAgentEvent: noop,
    logger,
    config: cfg,
    pluginConfig: {},
    resolvePath: (p: unknown) => p,
  };

  return { api, captured };
}

/**
 * Drive ONE keyless OpenClaw tool end-to-end through the in-process host: register the real plugin,
 * capture the named tool factory, build a tool `ctx`, and call the tool's OWN `execute` — returning its
 * result verbatim. The value is produced by the PLUGIN (e.g. `memory_get`'s fs read), not by this host.
 *
 * Throws if the plugin entry has no `register`, or if no registered tool matches `toolName`.
 */
export async function hostOpenClawTool(args: HostOpenClawToolParams): Promise<unknown> {
  const entry: OpenClawPluginEntry = resolveEntry(args.mod);

  // Minimal cfg: pin the agent workspace so the memory read resolves under OUR dir. memory-search is
  // enabled by default (so the tool is not gated off) and the memory backend defaults to "builtin" (the
  // fs read path) — both verified in openclaw's config-utils / backend-config.
  const cfg: Record<string, unknown> = {
    agents: { defaults: { workspace: args.workspaceDir } },
  };

  const { api, captured } = makeHostApi(cfg);

  // 1. Run the plugin's real register(api) — synchronous; stores factories + capability/embedding/CLI.
  entry.register(api as never);

  // 2. Capture the named tool's factory (OpenClaw matches by the `names` opt, not the def name).
  const found = captured.find((c) => c.opts?.names?.includes(args.toolName));
  if (!found) {
    const available = captured.flatMap((c) => c.opts?.names ?? []).join(', ') || '(none)';
    throw new Error(
      `openclaw-host: tool \`${args.toolName}\` not registered by this plugin (registered: ${available})`,
    );
  }

  // 3. Build the tool ctx the factory reads (resolveMemoryToolOptions: config/getRuntimeConfig, agentId,
  //    sessionKey, sandboxed) and instantiate the (lazy) tool.
  const ctx = {
    config: cfg,
    getRuntimeConfig: () => cfg,
    runtimeConfig: cfg,
    agentId: args.agentId,
    sessionKey: args.sessionKey,
    sandboxed: false,
    oneShotCliRun: false,
  };
  const tool = found.factory(ctx);
  if (!tool || typeof tool.execute !== 'function') {
    throw new Error(`openclaw-host: factory for \`${args.toolName}\` did not yield a tool with execute()`);
  }

  // 4. Drive the tool's OWN execute — THIS is the execute-driver the registry/loader do not hand us.
  return await tool.execute(args.toolCallId ?? 'oc-host-s0', args.params);
}
