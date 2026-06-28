# Handoff — per-node sandbox truth, the 3-mode skin, and the cloud-execution direction

**Date:** 2026-06-28 · **Branch (merged):** `feat/gui-fusion-zones` → `main` (`--no-ff`) · **Status of the decision: UNDECIDED**

> A fresh session can resume from here with zero re-discovery. This session was a **design dialogue + one
> research pass — no new code**. The conclusion we reached is explicitly *that the cloud-execution direction
> is not yet decided*; this doc records the options, what's locked, and what's open. Reference-don't-duplicate:
> the deep content lives in the cited research/design files, not here.

## 1. Goal
Give piflow **per-node sandbox truth** (which backend a node runs in) that is recorded to local files and
reflected to GUI/TUI through `observe`, rendered as a per-node **skin**; and settle **how "cloud" actually
executes**. This branch shipped the GUI skin/frame/mirror *foundation*; the cloud-execution model was explored
and left undecided.

## 2. State now
- **Done & verified (code, this branch — verified green at commit time: tsc + vite build clean, observe tests green):**
  - `f706464` GUI fusion button label `MoA` → "Model Fusion" (label only; `moa` stays in code/types/schema/agentType).
  - `67db298` fusion-cluster **FRAME** channel (violet `ZoneNode` backdrop; `gui/src/data/zones.ts`).
  - `a53ec10` core **config-mirror** — `NodeConfig` slice + **run-level** `RunStatus.sandbox` ride `run.json` → observe → GUI (`packages/core/src/runner/status.ts`, `buildNodeConfig` in `runner.ts`).
  - `b822638` cloud node **SKIN** — form-first 3D block from the mirrored sandbox (`gui/src/data/runView.ts` `effectiveSandbox`/`sandboxSkin`).
- **This session (no code):** design dialogue + a background research pass (Opus + Exa). Research doc written. Decision left UNDECIDED at the user's direction; merged to `main` with references.

## 3. Next steps (ordered — lead with the decision, since everything forks on it)
1. **Decide the cloud-execution model.** Options, with this session's lean:
   - **(rec.) Mid-run migration (A→B):** run starts local; at a node boundary, push the control plane + remaining nodes to a cloud control-VM; laptop detaches/re-attaches as observer. Run-level, reuses the shipped resume journal.
   - **(deferred) Per-node simultaneous mixed backends:** hand-pick node X→cloud while node Y stays local in ONE run. Real but narrow value (resource/cost targeting); costs the scope-per-kind runner refactor; NOT the differentiator.
   - **(fallback) Binary all-local / all-cloud.**
2. **If migration → write the Track B design spec** from `docs/research/2026-06-28-mid-run-migration-laptop-to-control-vm.md`. The genuinely net-new correctness work is the **`run.lock` single-writer lease** (split-brain mitigation — specced in the G4 doc but **NOT shipped**, confirmed by grep).
3. **Track A (independent of the decision, cheap, visible):**
   - `node.json` gains an optional `sandbox` field + `node.schema.ts` enum (reuse the CLI `SandboxChoice` vocab; lift it to core — no new verb).
   - `workflow-json.ts` `buildWorkflowJson` carries per-node `sandbox` (generated from node.jsons; `workflow.schema.ts` too).
   - **Extend the `a53ec10` mirror from run-level → per-node effective location** (so the GUI can draw the migration frontier).
   - **3-mode skin:** `gui/src/data/runView.ts` `sandboxSkin` (`:191`) `flat|cloud` → add `danger`; `danger-full-access` must be recorded as the *choice* (it is NOT a `SandboxProviderKind`; provider.kind can't express it).
   - **Sync pipeline:** mirror the existing fusion `override → save-run` precedent (`gui/src/components/FusionContext.tsx` + `WorkflowCanvas` `saveRunFusion` → POST `/__piflow/save-run`): GUI edit → in-memory override → preview → **save** bakes into the run dir; plus a **new explicit `promote`** verb (run → template `node.json`, per-node or `--all`). A run NEVER auto-mutates the template.

## 4. Open threads / undecided
- **THE open item: cloud-execution direction is UNDECIDED** (step 1).
- From the migration research (`§6` of that doc): drain-vs-abort default at the cut; whether to gate migration on G1 (per-node model in the envelope hash); mid-fusion-stage cut safety (flagged, not verified); where the observe re-attach handle lives; migrate-back (VM→laptop) — real or scope creep.
- `run.lock` lease is **unshipped** — required before any two-control-plane story.
- Persistence semantics: "run never auto-mutates template" is **locked**; "save-run bake + explicit promote" is the **leaning**, not yet built.

## 5. Key decisions & constraints (LOCKED — do not relitigate)
- **Local files = truth; a run NEVER auto-mutates the template.** CLI/GUI sandbox overrides are run-scoped and *recorded* (→ observe), reflected to GUI/TUI. WHY: non-destructive, matches the SDK/data-boundary conventions (`CLAUDE.md`, memory `sdk-data-boundaries`).
- **Last-write-wins, per node:** run override > template `node.json` > core default. `--sandbox` overrides for the run; it does not rewrite committed files.
- **Per-node *recording* of effective location = yes** (the GUI must draw the frontier); **per-node *simultaneous mixed execution* = deferred.** WHY: it's the expensive scope-per-kind refactor and NOT the differentiator — the thesis is per-node *capability* isolation (tools/scope/egress), which needs no per-node VM (`docs/research/2026-06-27-per-node-capability-isolation.md`).
- **Cloud-execution is run-level (mid-run migration A→B), not per-node mixing.** WHY: `docs/design/detached-run-control-vm.md` already chose **B** (control-VM = "just another staged sandbox running `piflowctl run`"), rejected **C**. The control plane runs in ONE place.
- **Skin = `flat` (local) · `red` (danger-full-access) · `blue` (cloud/migrated).** **No control-plane node in the GUI for now** (cloud nodes imply it).
- **No new verbs.** Reuse `SandboxChoice` + the fusion `override → save-run` pattern.

## 6. Suggested skills (so they fire reliably next session)
- `agentic-prompt-design` — before writing ANY subagent/node prompt (e.g. spec-drafting agents).
- `test-discipline` — test-first before Track A core logic (`node.schema` accept/reject, the per-node mirror round-trip, resolution precedence).
- `piflow-start` — do a real registered run to populate the per-node mirror so the new skin can be eyeballed on live data (existing runs predate `a53ec10` and lack the fields).
- `systematic-debugging` — if resume/journal behavior surprises during the migration spec work.
- Load memory `runs-live-in-product-runs-folder` (runs live under per-product `.piflow/<wf>/runs/<id>`, resolved via `~/.piflow/index.json`; NEVER look in `out/`).

## 7. Artifacts (by path)
- **Research (the load-bearing one):** `docs/research/2026-06-28-mid-run-migration-laptop-to-control-vm.md` — A→B migration: 13-system prior-art survey, the v1 mechanism (drain → snapshot `${RUN}/.pi/` → boot control-VM → `--from <frontier>` → re-attach), 8 failure modes, recommendation. Verified against code: **G4 journal+resume is SHIPPED & WIRED** (`journal.ts` `decideResume`; `runner.ts:834`/`:2063`, `selectWindow:418`); **`run.lock` lease is NOT** (net-new).
- **Grounding design docs:** `docs/design/detached-run-control-vm.md` (A/B/C, B chosen); `docs/research/2026-06-27-per-node-capability-isolation.md` (the thesis); `docs/specs/wiring-g4-resume-journal.md`; `docs/design/multi-provider-sandbox-portability.md`; `docs/design/credential-architecture.md`; `docs/design/control-session-mirror.md` + `control-session-streaming-spec.md` (observe re-attach).
- **Competitive briefs (committed this session):** `docs/research/2026-06-27-adk-python-workflow-runtime-comparison.md`; `docs/research/2026-06-28-rondoflow-vs-piflow.md`.
- **Code seams to extend (Track A):** `packages/core/src/runner/status.ts` (`RunStatus.sandbox` run-level → per-node; `NodeConfig`); `packages/core/src/runner/runner.ts` (`buildNodeConfig`, `finishNode`); `packages/core/src/workflow/template/types.ts` + `schema/node.schema.ts` (+`workflow.schema.ts`); `packages/core/src/workflow/template/workflow-json.ts`; `gui/src/data/runView.ts` (`sandboxSkin:191`, `effectiveSandbox:185`); `gui/src/components/FusionContext.tsx` + `WorkflowCanvas.tsx` (`saveRunFusion`) — the override→save precedent to mirror.
