import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Static-demo build — produces the pure-frontend flowmap demo embedded by the marketing
 * site at `/gui-demo/` (`<iframe src="/gui-demo/">`).
 *
 * Differences from the dev config (`vite.config.ts`):
 *   - NONE of the `/__piflow/*` dev middleware plugins are registered (they're dev/preview
 *     only and read `~/.piflow` + product repos). The demo answers `/__piflow/*` entirely in
 *     the browser via `demo/demoFetch.ts`, so there is no server dependency in this build.
 *   - `base: "/gui-demo/"` so the built `index.html` references its assets under `/gui-demo/`
 *     (the iframe path), not `/`.
 *   - output goes straight into the marketing site's static dir.
 *
 * The HTML entry is the SAME `gui/index.html` (which loads `/demo/main.tsx`), so this builds
 * the real `WorkflowCanvas`; only the data source differs (bundled JSON via the shim).
 */
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/gui-demo/",
  plugins: [react()],
  build: {
    outDir: resolve(here, "../site-piflow/public/gui-demo"),
    emptyOutDir: true,
  },
});
