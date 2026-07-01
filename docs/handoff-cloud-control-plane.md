# HANDOFF — finish piflow's one-control-plane-two-contexts (local ⇄ cloud, one-click switch)

> Paste the block below into a fresh session to continue. It references files/commits (does not duplicate them).
> Work in the existing worktree + branch; keep the sub-agent fleet pattern; commit per coherent unit; push as you go.

---

You are continuing a multi-session build in the **piflow** monorepo. Do NOT restart from scratch — a large,
tested foundation already exists on a branch. Read this handoff, verify the state, then finish the vision.

## GOAL (the north star — the user's own words)
piflow's **control plane works identically local and in the cloud**, and you can **switch a run between them
with one click** — "one-click UPLOAD (laptop → cloud) / DOWNLOAD (cloud → laptop)". Switching context mid-run
**bundles the runner up to (or down from) a cloud VM**. Reuse everything; most robust structure. The control
plane (the deterministic runner loop) stays the control plane; Claude/pi are executors, the console, or the
out-of-band overlord — never the reconcile loop itself.

## WHERE THINGS ARE (verify first)
- Worktree: `/Users/tk/Desktop/piflow/.claude/worktrees/control-plane-serve-context` — branch
  `worktree-control-plane-serve-context` (pushed to origin), 6 commits off `main` (75ac169). Continue here.
- Approved design + phase plan: `/Users/tk/.claude/plans/sunny-inventing-pudding.md` (READ IT — it is the spec).
- Verify state: `git log --oneline main..HEAD` · `pnpm -r --filter './packages/*' build` · `pnpm test`
  (expect **1366 passing / 0 fail**) · `(cd gui && pnpm build)`.

## STATE NOW — DONE + verified (P1–P4 + P3b of the plan)
The whole **laptop loop works**: `serve` → start a run (choose pi|claude) → watch (SSE) → talk (`pi --mode rpc`)
→ switch context in the terminal. The naming is settled: **`serve` = the process, `context` = the pointer**
(orthogonal — kubectl/docker/Restate idiom). `local`/`cloud` are rows in `~/.piflow/contexts.json`.
- `e82e2b3` executor override — `RunOptions.executor`/`executorOverride`; single choke point
  `resolveExecutor` in `packages/core/src/runner/node-lifecycle.ts`; CLI `--executor [<node>=]pi|claude-code`.
- `79ee97e` GUI one configurable API base — `gui/src/data/apiBase.ts` (`api()`/`sse()`, `VITE_PIFLOW_API`).
- `10ea496` **`@piflow/server` + `piflowctl serve`** — the ~12 control-API handlers extracted from dev-only Vite
  middleware into `packages/server/src/handlers.ts` (one impl; `gui/vite.config.ts` now mounts the same
  middleware lazily). `create-server.ts` has a bearer-token **auth seam (default OFF)**. `serve-cli.ts` serves
  `gui/dist` + the API, scoped via `PIFLOW_SCOPE_ROOTS`.
- `bbc1126` **`POST /api/runs/start`** — `packages/server/src/start-run.ts`: resolve template → mint runId →
  spawn a DETACHED `piflowctl run --run <id>` (crash-durable via the journal) → poll `resolveRunDir` → 202.
  Pure `buildStartRunArgv` is unit-tested.
- `1c00da0` **`piflowctl context use|ls|add|rm`** — `packages/cli/src/context-store.ts` (+ `context.ts`); ladder
  `--context flag > PIFLOW_CONTEXT env > current > 'local'`; reuses core `globalDir()` (honors `PIFLOW_HOME`).
- `aaa64cf` **GUI Start panel** — `gui/src/components/StartRunPanel.tsx` (launch: product/workflow/args/sandbox/
  executor) → `POST api('/api/runs/start')` → selects the run via the existing `selectRun` seam; MenuBar
  launcher + endpoint reflector.

## NEXT STEPS — to COMPLETE the vision (in order)
1. **P5 — `piflowctl cloud up` (Fly.io), born-in-cloud, authed.** Author `deploy/control-vm/{Dockerfile,
   fly.toml,smoke-live.mjs}` (bake node22 + `@earendil-works/pi-coding-agent` + the Claude Code CLI +
   `piflowctl` + `@piflow/server` + `gui/dist` + git + ripgrep + **bubblewrap**). New `packages/cli/src/cloud.ts`
   (`cloud up|down`) + wire a `case 'cloud'` in `cli.ts`. `cloud up` = deploy the image to Fly, set a bearer
   token + scoped/TTL provider cred + Claude OAuth token as Fly secrets (reuse `SecretResolver {isCloud:true}`
   + `cloudCredEnvAdditions`, mint-not-forward), launch `piflowctl serve --host 0.0.0.0 --token …` as CMD, then
   **write + `context use` a `cloud` context** at the HTTPS URL. **Turn the auth seam ON** (`create-server.ts`
   `bearerGate`) for every route incl. SSE + start; add **template allow-listing** to `/api/runs/start` (it is
   RCE-by-design). **STOP before the real `fly deploy`** — it is outward-facing + spends money; hand that step
   to the user (the code is fine to author; the deploy is theirs to run/authorize).
   - Bar: `deploy/control-vm/smoke-live.mjs` passes — `/` requires the token (401 without), a `greet` run starts
     born-in-cloud, its SSE reaches `done`, run-view shows the artifact, a `claude-code` node used the OAuth
     subscription (not API billing), and `--sandbox local` jailed via bwrap in the VM.
2. **P6 — the ONE-CLICK UPLOAD/DOWNLOAD (the headline ask): mid-run context switch = migrate.** Model =
   **SkyPilot managed-jobs** (kill + re-provision + reload-from-checkpoint, NOT live teleport — see the survey
   note below). piflow already has the 3 hard pieces: durable run-dir + `journal.json`, replay-skip via `--from`,
   a stable run-id. Net-new is only: (a) **freeze-at-node-boundary** (quiesce the runner between nodes + a
   "flush the journal then die" hook), (b) **bundle** the run-dir local→cloud (upload) / cloud→local (download)
   + reload-on-startup, (c) a **single-writer lease** (`run.lock`) so the two runners never double-write the
   journal (mandatory — Windmill/Restate prove it). Symmetric: **upload** = laptop→cloud, **download** =
   cloud→laptop. Surface it as `piflowctl context migrate <name> <run>` (or `--adopt`) AND a **one-click button
   in the GUI context switcher**. Resume via the existing `--from`.
3. **Make the active context actually REDIRECT everything.** Today `context` is a store; the GUI's `apiBase` can
   already point remote (`VITE_PIFLOW_API`). Remaining wire: the **CLI honors `--context`/the active context to
   talk to a REMOTE `serve`** for observe/start (so `piflowctl status/watch/…` and the GUI both follow the
   switch). This is what makes "switch context" redirect the whole console, not just store a URL.

## OPEN THREADS / RISKS
- **bwrap in Fly** must allow userns or `--sandbox local` fails closed — verify with the pattern in
  `deploy/e2b/bwrap-jail-live.mjs`. (This is why Fly, not Daytona where bwrap is blocked, not E2B ephemeral.)
- **headless `claude -p` on Linux** with only `CLAUDE_CODE_OAUTH_TOKEN` — live-verify inside the VM.
- **Auth is OFF by default** (`create-server.ts` token param) — P5 must turn it on + add template allow-listing
  BEFORE any public exposure. `/api/runs/start` spawns agents with credentials.
- **Migration correctness** hinges on the single-writer lease; do NOT ship upload/download without it.
- start-run's runId-before-run.json race is handled by polling `resolveRunDir`; keep that invariant.

## DECISIONS + WHY (do not relitigate)
- **Fly.io** for the control VM (persistent web host + real bwrap jail; Daytona blocks bwrap, E2B is ephemeral).
- **Born-in-cloud** is the spine; **migration (upload/download) is the symmetric context switch** on top of it.
- **serve + context are orthogonal** (prior-art unanimous: Modal/BentoML/vite `serve` = process; kubectl/docker/
  Restate `use-context`/`use-environment` = the switch). Ladder: flag > env > current > local.
- **Migration is checkpoint→reprovision→reload with a stable run-id, NOT live memory teleport** — none of
  SkyPilot/Ray/Metaflow/Restate/Windmill teleport; piflow doesn't need to (progress is already on disk).
- **The deterministic runner is the control plane.** Claude is executor / console / out-of-band overlord.

## HOW TO WORK (process the user expects)
- Own the git loop: commit per coherent unit (one idea, no "and"), push as you go, `--no-ff` merge when a track
  is done + verified. End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Delegate disjoint, bounded work to named sub-agents** (the fleet pattern used to build P2a/P3a/P3b/P4);
  keep tightly-coupled spine work inline. Verify every agent against the diff + build + tests, never its report.
- **Tests must fail when the code is wrong** (test-discipline) — extract pure logic and pin it; a live smoke
  is the gate for the server/cloud glue.
- Confirm before outward-facing/irreversible actions (the real `fly deploy`).

## SUGGESTED SKILLS (load as relevant)
`piflow-start` (run/monitor a run) · `okf-slices` (FIND the runner/sandbox/observe/cloud-backends slices before
editing) · `memory-slices` · `agentic-prompt-design` (before ANY sub-agent/handoff prompt) · `test-discipline`
(before any test) · `piflow-overlord` (the k8s-style reconcile loop, for the supervisor lane) · `receiving-code-review`.

## ARTIFACTS
- Plan: `/Users/tk/.claude/plans/sunny-inventing-pudding.md`
- This handoff: `docs/handoff-cloud-control-plane.md`
- Design docs (migration prior art in-repo): `docs/design/detached-run-control-vm.md`,
  `docs/research/2026-06-28-mid-run-migration-laptop-to-control-vm.md`, `docs/specs/wiring-g7-detach.md`.
- Cloud seams to reuse: `packages/core/src/runner/env-staging.ts` (`cloudCredEnvAdditions`, `CLOUD_KINDS`),
  `packages/daytona/src/daytona.ts` / `packages/e2b/src/e2b.ts` (`openRun` provider seam), `deploy/e2b/`.
