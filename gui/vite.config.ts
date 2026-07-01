import { defineConfig, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The piflow control API — live index/products, run telemetry SSE (`watchRun`), on-demand run-view, fusion
 * preview + save-run, file/tree read-back, checkpoint reply, the agent-preset catalog, node write-back, and
 * the two-way `pi --mode rpc` control session — now lives in `@piflow/server` so the Vite dev middleware and
 * the standalone `piflowctl serve` share ONE implementation (no logic fork; the control plane behaves
 * identically on a laptop and a cloud VM).
 *
 * A synchronous wrapper is registered in configureServer (so it sits as a PRE middleware, intercepting
 * /__piflow/* before Vite tries to serve them as files); the real handler is dynamically imported on first
 * request so esbuild never bundles `@piflow/server` (or `@piflow/core`) into this config — the same reason
 * the handlers reach core's dist by absolute path. Requires `@piflow/server` to be built (repo `npm run build`).
 */
function piflowControlApi(): Plugin {
  let mw: Connect.NextHandleFunction | null = null;
  let loading: Promise<void> | null = null;
  const ensure = (): Promise<void> => {
    if (mw) return Promise.resolve();
    if (!loading) loading = import("@piflow/server").then((m) => { mw = m.createApiMiddleware() as Connect.NextHandleFunction; });
    return loading;
  };
  const wrapper: Connect.NextHandleFunction = (req, res, next) => {
    ensure().then(() => mw!(req, res, next)).catch((e) => {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `@piflow/server not available (${String(e)}) — run: npm run build (at repo root)` }));
    });
  };
  const attach = (server: { middlewares: Connect.Server }) => { server.middlewares.use(wrapper); };
  return {
    name: "piflow-control-api",
    configureServer(server) { attach(server); },
    configurePreviewServer(server) { attach(server); },
  };
}

export default defineConfig({
  plugins: [react(), piflowControlApi()],
  server: { port: 5173, host: true },
});
