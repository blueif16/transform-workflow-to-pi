# Demo data (static flowmap demo)

Bundled JSON that powers the pure-frontend demo built by `npm run build:demo` and served
from the marketing site at `/gui-demo/`. At runtime there is NO server — `demo/demoFetch.ts`
answers the GUI's `/__piflow/*` calls from these files (inlined into the build via
`import.meta.glob({ eager: true })`), so the demo makes zero network calls to `/__piflow/*`.

## Contents
- `index.json` — the trimmed global index (2 `done` runs). The LAST thread is the default
  run `pickCurrentRun` opens (`gs01`), since none are `running` and `updatedAt` is null.
- `run-view/<id>.json` — the distilled run-view the canvas/HUD render (one per bundled run).
- `tree/<id>.json` — the run's on-disk file tree for the "Run files" navigator (optional;
  absent ⇒ the canvas falls back to the run-view's produced-files tree).
- `agents.json` — the agent-preset catalog (node icons).

Bundled runs: `gs01` (game-omni, 12 nodes — the default) and `demo-fusion` (example-fusion,
10 nodes — selectable from the switcher).

## Refresh (re-capture from the live dev server, then rebuild)
The run-view shape is whatever the dev MIDDLEWARE returns (not the raw on-disk file), so
capture from the live endpoint, never by hand:

1. `cd gui && npm run dev` (needs `~/.piflow` + the product repos + a built `@piflow/core`).
2. `curl localhost:5173/__piflow/index.json` → trim to the chosen product/namespaces/runs,
   ordering the DEFAULT run LAST. Save as `index.json`.
3. For each kept run: `curl localhost:5173/__piflow/run-view/<id>` → `run-view/<id>.json`;
   optionally `/__piflow/tree/<id>` → `tree/<id>.json`. `curl /__piflow/agents.json` →
   `agents.json`. Mark each kept thread `"viewable": true` in the index.
4. Stop the dev server. `npm run build:demo` (writes `site-piflow/public/gui-demo/`).

Editing any file here requires re-running `build:demo` for the iframe to pick it up.
