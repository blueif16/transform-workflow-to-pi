# OpenClaw Plugin Substrate Adoption — scope & findings

**Status:** scoped, not started (2026-06-22). Supersedes the "reference OpenClaw over MCP" framing for the *plugin* question.

**Goal (one line):** Adopt OpenClaw's plugin **substrate** natively into our pi-based system so the whole community plugin ecosystem registers and runs as ours — every tool an agent might need — *for granted*, by manifest. Not MCP-wire a handful of tools; own the pipe.

---

## Scope decision

**IN — everything required to run plugin *tools*:**
1. **The plugin contract** (`@openclaw/plugin-sdk`) — what every community plugin codes against.
2. **The tool host** — register + execute stateless tools.
3. **The long-running plugin-server runtime** — keep plugin-owned servers/sessions/background jobs alive (browser's Playwright session, canvas's HTTP server, memory's reindex/watch).

**OUT — channels (deliberate):** telegram/whatsapp/discord/slack/feishu/google-meet/voice-call/qqbot/zalouser. These are **human-interaction surfaces**, not agent tools. They need external platform creds + webhooks + persistent connections the full gateway operates. Set aside; migrate one on-demand only if a specific platform is ever needed. Excluding them costs us nothing the agent needs.

**OUT — agent runtime & providers:** `src/agents` (25 M) + `src/llm`. **pi already is these** (design-shared — see Lineage). Migrating them would be redundant.

### "Is contract + tool-host + long-running-runtime everything required to run all the tools?"
**Yes — essentially.** Those three layers + our existing `SecretResolver` (for key-gated plugins) cover buckets A + B (all 64 tool-bearing, non-channel tools). Two honest footnotes, both *inside* "the runtime" (not new categories):
- **node-bus (`node.invoke`)** — a few tools (e.g. `file-transfer`'s `file_fetch`) do paired-**device** RPC. That's runtime, not a channel, but it's tied to multi-node topology. On a single host it degrades or maps to local fs. Only ~1 plugin depends on it.
- **provider access (LLM/embeddings)** — `memory_search` (embeddings) and `llm-task` (a model) need a provider. That wiring is part of the runtime and maps onto **pi's** provider layer. Keyless tools (`memory_get`, file ops, browser, diffs) need none of it.

Neither breaks the thesis. The three layers are the complete set for agent-facing tools.

---

## Lineage finding — why this is a pi-COMPATIBLE port, not a graft

Forensic-verified (2026-06-22, two subagents + local source at `vendor/openclaw`):
- OpenClaw **originally ran on pi's SDK** (imported `pi-coding-agent`/`pi-agent-core`/`pi-ai`; its loop *was* pi's `createAgentSession()`). It **migrated off** by `openclaw@2026.6.9` — internalized `packages/agent-core` + `src/agents/embedded-agent-runner`, keeping only `@earendil-works/pi-tui`.
- **Not a fork** — OpenClaw was a *consumer* of pi's published SDK (pi = Mario Zechner/earendil-works; OpenClaw = steipete/vincentkoc; pi's README lists OpenClaw as a flagship SDK integration).
- The internalized runtime is a **genuine rewrite, ~85–90% design-shared, 0% code-copied**: identical `Agent`/`agentLoop`/harness *contracts* as pi, but imports `@openclaw/llm-core` and adds a `runtime` injection param.

**Implication:** adopting OpenClaw's plugin-host onto pi is **low-impedance** — the substrate is the same lineage. The one deep service the ecosystem needs, `runtime.agent.runEmbeddedAgent`, maps **directly** to pi's `createAgentSession()`.

---

## Ecosystem sizing (census of all 135 manifests; live-proven)

| Bucket | Plugins | Tools | Status |
|---|---|---|---|
| **A — keyless** | 11 (memory-core, memory-lancedb, memory-wiki, browser, canvas, file-transfer, diffs, llm-task, lobster, codex-supervisor, workboard) | 58 | IN |
| **B — key-gated** (via SecretResolver) | 3 (firecrawl, tavily, xai) | 6 | IN |
| **C — channels/platform** | 5 (feishu, google-meet, voice-call, qqbot, zalouser) | 19 | **OUT** |
| **D — no tools** (LLM providers/channels) | 116 | 0 | n/a |

**Headline: 64 tools across 19 plugins inheritable; pipe inherits future plugins by manifest.** Live-proven: standalone `plugin-tools-serve.js` serves 8 by default, 20–25 with config. (Installed pkg bundles 77 ext in `dist/`; some — memory-lancedb, firecrawl, diffs — are external `openclaw plugins install @openclaw/*`.)

Tool concentration: workboard 34, memory(×3) 10, browser/canvas/files/diffs ~7, scrape(firecrawl/tavily) keyed, llm-task/lobster/codex-supervisor (deeper-runtime).

---

## What to build — the three layers and their `api` surface

### Layer 1 — Contract (trivial)
Vendor `packages/plugin-sdk` (116 K, **zero deps**). The keystone; plugins import their types/`definePluginEntry` from it.

### Layer 2 — Tool host (low; days)
A loader (`resolvePluginTools` + `standalone-runtime-registry-loader`, in `src/plugins/*`) that runs each manifest's `register(api)`, plus the **6 essential `api` services**:

| Essential service | Maps to on pi |
|---|---|
| `registerTool` | our tool registry / bridge |
| `config` / `pluginConfig` | our run config |
| `logger` | pi logger |
| `runtime.state.openKeyedStore` | a KV store (small) |
| **`runtime.agent.runEmbeddedAgent`** | **pi `createAgentSession()`** |
| `runtime.agent.resolveAgentDir` | workspace path |

### Layer 3 — Long-running plugin-server runtime (medium–hard, BOUNDED; weeks)
A long-lived host process providing the lifecycle/bus surface so plugin-owned servers stay alive. A slice of `src/gateway` (11 M) + `src/plugins` (8.4 M), ported onto pi's process model:
- `registerService` (service bus + lifecycle)
- `registerHttpRoute` (mount an HTTP server — e.g. canvas)
- `registerGatewayMethod` (JSON-RPC method bus)
- `lifecycle.registerRuntimeLifecycle` (startup/shutdown hooks — e.g. browser session)
- background tasks / cron; node-bus (for the one paired-device tool)

These are **optional for stateless tools** (stub as no-ops → tool still registers/executes) but **essential for the long-running plugins** the agent wants.

> The other ~20 `api.register*` verbs (memory-capability, web-fetch-provider, CLI, auto-enable-probe…) are **graceful-degrade**: stub them and the tool still registers and is callable directly.

---

## Migration plan

1. Vendor Layer 1 (`plugin-sdk`) + the Layer-2 loader.
2. Implement the 6-service `api` shim on pi (`runEmbeddedAgent` → `createAgentSession`).
3. Implement Layer 3 (service/HTTP/gateway-method/lifecycle bus) as a pi-hosted daemon.
4. Wire `SecretResolver` for bucket B.
5. Channels: **not migrated.**

**Cost honesty:** copying is trivial (MIT, full source, pi-compatible). The real work is the Layer-3 port (~10–15 M of relevant pi-compatible source; weeks–months, one engineer) + owning a fork (track `plugin-sdk` version on bumps). Not a wargame — finite.

## Proof spikes (in order)
- **S1 (registration):** all 19 plugins register on *our* host; `memory_get` (keyless) executes through our `api`. ✓ proves Layers 1–2.
- **S2 (the demand — long-running):** bring up a **server** plugin natively — `canvas` (persistent HTTP server) or `browser` (live Playwright session) — and hit its endpoint. ✓ proves Layer 3.
- **S3 (runEmbeddedAgent):** `llm-task` runs through pi's `createAgentSession()`. ✓ proves the deep-runtime tier.

## Open risks
- `workboard`'s `runtime.subagent` / `lobster`'s `managedFlows` may fail at **call** time (not registration) — needs a per-plugin call smoke (S2/S3 covers the pattern).
- `api` surface is not a frozen contract — the long tail of future plugins may reach for services beyond our shim; mitigated by the loader exposing the full `plugin-sdk` surface and stubbing the unimplemented as loud no-ops.
- Fork/drift: re-vet `plugin-sdk` + loader on OpenClaw version bumps.

---

## Related
- `docs/design/l1-node-envelope.md`, `orchestration-substrate.md` — the node/runtime context this plugs into.
- Memory: `openclaw-ecosystem-sizing`, `openclaw-as-mcp-gateway` (the MCP path this supersedes for the *plugin* question; MCP remains valid for *external* MCP servers).
