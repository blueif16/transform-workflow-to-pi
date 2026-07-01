---
"@piflow/core": minor
---

Add `NodeDerived` — compute the per-node display zones ONCE in the observe surface.

The per-node attention zones a view renders — cache-hit, tool-error, single-tool dominance,
context pressure, time-vs-mean, and retries — plus the ranked tool list and the unified
artifacts∪writes output list were each recomputed inline by the GUI (drifting thresholds
scattered across four components). They now live in one pure `deriveNode`, and `buildRunView`
(and `previewView`) stamp the result on every run-view node as `node.derived`. Every view — the
GUI HUD today, the TUI next — renders `node.derived.*` verbatim and re-derives no threshold, so
the two surfaces render identical numbers from identical code.

This is the OBSERVE (display) layer — it computes every zone a human view wants; the telemetry
tier stays the separate agent-facing pick with its own stricter anomaly cutoffs. New exports from
`@piflow/core/observe`: `deriveNode`, the zone helpers (`cacheTone`/`toolErrorTone`/`contextTone`/
`timeTone`/`retriesTone`), and the types `NodeDerived`/`DeriveInput`/`Tone`/`RankedTool`/
`DerivedOutput`. Additive: the `derived` field is optional; existing consumers are unaffected.
