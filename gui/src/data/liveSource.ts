// liveSource.ts — the CLIENT-SIDE transport flag for the live graph (docs/design/observe-live-sse-single-source.md
// DR7). It picks how a LIVE run's graph is fed: 'poll' (today's 3 s /run-view re-poll — the DEFAULT, byte-identical
// to before) or 'sse' (render from the SSE-enriched live.model, computing nothing client-side). PURE, no side
// effects: it only reads the URL `?live=` override and the build-time default. The server ALWAYS folds after P2 —
// this flag is transport-only, never a data switch, so a bug is a transport bug, isolated to the client.
export type LiveSource = "poll" | "sse";

/** The build-time default. `VITE_PIFLOW_LIVE_SOURCE=sse` flips it for a build; unset ⇒ 'poll' (the safe default). */
function buildDefault(): LiveSource {
  return import.meta.env.VITE_PIFLOW_LIVE_SOURCE === "sse" ? "sse" : "poll";
}

/**
 * Resolve the live transport: the `?live=sse|poll` query param wins (a per-session runtime override), else the
 * build default, else 'poll'. Any unrecognized value falls through to the default — never throws, never a side
 * effect (so it is safe to call on every render).
 */
export function liveSource(): LiveSource {
  try {
    const q = new URLSearchParams(window.location.search).get("live");
    if (q === "sse" || q === "poll") return q;
  } catch {
    /* no window (SSR / tests) — use the build default */
  }
  return buildDefault();
}
