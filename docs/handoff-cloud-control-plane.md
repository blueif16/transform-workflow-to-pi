# HANDOFF — finish piflow's one-control-plane-two-contexts (local ⇄ cloud, one-click switch)

> Paste the block below into a fresh session to continue. It references files/commits (does not duplicate them).
> Work in the existing worktree + branch; keep the sub-agent fleet pattern; commit per coherent unit; push as you go.

---

You are continuing a multi-session build in the **piflow** monorepo. Do NOT restart — a large, tested
foundation exists on a branch. Read this handoff, verify state, then finish the last two pieces + go live.

## GOAL (north star — unchanged)
piflow's **control plane works identically local and in the cloud**, and you **switch a run between them with
one click** — UPLOAD (laptop→cloud) / DOWNLOAD (cloud→laptop). The deterministic runner loop stays the control
plane; Claude/pi are executors / console / out-of-band overlord, never the reconcile loop.

## WHERE THINGS ARE
- Worktree: `/Users/tk/Desktop/piflow/.claude/worktrees/control-plane-serve-context` — branch
  `worktree-control-plane-serve-context` (pushed to origin, `b230a8c`), ~13 commits off `main`. Continue here.
- Approved design + phase plan: `/Users/tk/.claude/plans/sunny-inventing-pudding.md` (the spec — still valid).
- Verify state: `git log --oneline main..HEAD` · `pnpm -r --filter './packages/*' build` · `pnpm test`
  (expect **1464 passing / 0 fail** — A3 +22, D1 +14 over the 1428 baseline) · `(cd gui && pnpm build)` ·
  `(cd gui && npx tsc --noEmit)`. All green as of this handoff. A3 (`d9cfd63`) + D1 (`1933da4`, `94e87e0`) DONE —
  only GO-LIVE remains (the paid `fly deploy` + the live migrate e2e, both the user's to run).

## STATE NOW — DONE + verified this session (P5 server+image, P6 core+endpoints+CLI, P7 redirect)
The **whole local⇄cloud migrate mechanism works end-to-end at the code level** (only the live cloud deploy +
the GUI button remain). Commits (newest first):
- `b230a8c` **deploy security** — hardened `deploy/control-vm/.dockerignore` (whole `.claude`, `.npmrc`,
  `*.pem/*.key/id_rsa/.ssh/.aws/.netrc/secrets`) + README made the copy-to-context-root a REQUIRED step.
  Audited: the Dockerfile bakes NO secrets (all injected at runtime via `fly secrets set`; CMD fails closed if
  `PIFLOW_TOKEN` unset); scan found no real keys in the build context.
- `d529c10` **`piflowctl context migrate <target> <run>`** (`packages/cli/src/migrate.ts`) — the headline
  one-click UPLOAD/DOWNLOAD. Symmetric freeze→bundle→adopt→`context use`; local side uses core primitives,
  remote side uses the migrate HTTP endpoints. Surfaces `frozen` through observe's `RunModel`
  (`read.ts`/`types.ts`) so the freeze-wait detects the park identically local + remote. Wired `migrate` verb
  into `context.ts`. All I/O boundaries injectable; upload/download/already-done flows tested.
- `412fc90` **P5 Fly image** — `deploy/control-vm/{Dockerfile,fly.toml,smoke-live.mjs,README.md,.dockerignore,
  e2e-template}`. Multi-stage build shipping the BUILT WORKSPACE (the handlers resolve `gui/scripts/lib` +
  `packages/core/dist` via findUp at request time — a bare npm-global won't work). node22+pi+claude-code+git+
  ripgrep+**bubblewrap**; CMD = `piflowctl serve --host 0.0.0.0 --port 8080 --token $PIFLOW_TOKEN
  --allow-templates …`, fails closed w/o the token. smoke = ordered A(401/200)→B(start 202)→C(SSE done)→D(run-
  view artifact)→E(sandbox=local jailed + in-VM bwrap/subscription probes).
- `091a49a` **P6 server endpoints** (`packages/server/src/migrate.ts`) — `POST …/migrate/<run>/freeze`,
  `GET …/bundle`, `POST …/adopt` (unpack + detached resume, allow-list gated like start-run).
- `e7a62b2` **P7 CLI redirect** (`packages/cli/src/remote.ts`) — the active/`--context` redirects
  `status`/`watch`/`run` to a remote serve over SSE/HTTP (remoteRunModel takes the first `{kind:snapshot}`;
  remoteUpdates feeds watch's `updates` seam; startRemoteRun → POST /api/runs/start). Bearer token on every call.
- `b75235d` **P5 server auth** — template allow-listing on `POST /api/runs/start` (403 before spawn;
  `isTemplateAllowed` pure; `--allow-templates`/`PIFLOW_ALLOWED_TEMPLATES`). Bearer gate was ALREADY correct.
- `fb1695f` + `ea4e200` **P6 core primitives** — `run.lock` lease (`lease.ts`), freeze-at-node-boundary
  (`runner.ts` + `migrate.ts`, `RunStatus.frozen`), gzipped run-dir bundle (`migrate.ts`). Full migrate loop
  proven at the core level (freeze→bundle→adopt-elsewhere→resume-via-journal).

Every new test was verified to FAIL under a deliberate mutation (lease staleness, freeze setter, bundle
exclude, allow-list gate, SSE parser, freeze-wait). +62 tests over the 1366 baseline.

## NEXT STEPS — to COMPLETE the vision (in order)
1. **A3 — `piflowctl cloud up|down` — DONE (`d9cfd63`).** `packages/cli/src/cloud.ts`: pure
   `mintCloudSecrets`/`buildFlyDeployPlan`/`renderPlan` + injected-boundary `runCloudUp`/`runCloudDown`; wired
   `case 'cloud'` + HELP. `cloud up` is PLAN-only by default (mint the bearer, register the `cloud` context row,
   print the fly runbook — touches fly NEVER); `--execute` runs it + `context use`s on a green smoke. Credentials
   are PROJECTED like a node sandbox: a custom `--provider`'s `~/.pi/agent/models.json` entry (secret-free) is
   staged as the non-secret `PIFLOW_PI_MODELS_JSON` (the image writes it to `~/.pi/agent/models.json` at boot —
   Dockerfile CMD updated) and its cred vars + the Claude OAuth token are Fly secrets (reuses `parsePiProvider` +
   `cloudCredEnvAdditions` + `resolveClaudeOAuthToken`, all now core-barrel-exported). ANTHROPIC_* is never staged.
   22 tests; redaction/billing-guard/halt mutation-verified. `cloud down` = `fly apps destroy` + drop the context.
2. **D1 — GUI one-click migrate — DONE (`1933da4` server, `94e87e0` gui).** Found + fixed a prerequisite: the GUI
   had NO token handling but the cloud serve bearer-gates everything → `gui/src/data/apiBase.ts` is now a runtime
   `{baseUrl,token}` store (seed token from `?token=`, `apiFetch` sets Bearer, `sse`/`apiUrl` append `?token=`;
   repointable via `setEndpoint` + a `useSyncExternalStore` hook; index/run-view/stream hooks list the endpoint in
   their deps → reconnect on switch). Server-orchestrated (browser-orchestrated is blocked by no-CORS): added
   `GET /api/contexts` (names+baseUrls, NEVER tokens) + `POST /api/migrate {run,target}` (spawns `piflowctl context
   migrate`, 202 with the target endpoint incl. token). MenuBar migrate button → `MigrateRunPanel` → on 202 the
   canvas `setEndpoint(target)` + `selectRun`. 14 tests; bearer-propagation/token-omission/argv mutation-verified.
   NOTE: UPLOAD (local→cloud) is the one-click path; a cloud→laptop DOWNLOAD stays a CLI op (`piflowctl context
   migrate local <run>` from the laptop) — a cloud VM can't reach your localhost.
3. **GO LIVE — the ONLY remaining work (hand the paid/outward steps to the user; you author + gate):**
   - The one-click: `piflowctl cloud up --provider <gw>` (PLAN — free) to review, then **the user** runs
     `piflowctl cloud up --provider <gw> --execute` (spends money: `fly secrets set` → `fly deploy` → smoke) OR
     the manual `deploy/control-vm/README.md` runbook. Prereq: `fly auth login` + a Fly account.
   - `deploy/control-vm/smoke-live.mjs` (env `PIFLOW_CLOUD_URL`+`PIFLOW_TOKEN`) must PASS — the P5 gate.
   - Verify in-VM: bwrap userns probe passes (`--sandbox local` jails, not fail-closed) + a `claude-code` node
     used the OAuth subscription (not API billing).
   - **Live migrate e2e**: start a run local → open the GUI → click **Migrate → cloud** (or CLI `piflowctl context
     migrate cloud <run>`) mid-run → confirm it froze at a node boundary, bundled up, resumed on the VM via the
     journal, lease never double-written; the GUI re-points to the cloud automatically. Then `piflowctl context
     migrate local <run>` back down from the laptop.

## OPEN THREADS / RISKS
- **bwrap in Fly** must allow userns or `--sandbox local` fails closed — the smoke's E-probe covers it; run it.
- **headless `claude -p` on Linux** with only `CLAUDE_CODE_OAUTH_TOKEN` — live-verify in the VM (never set
  `ANTHROPIC_API_KEY` as a Fly secret; a non-empty API key outranks the OAuth token → per-token billing).
- **Migrate template resolution on the target**: `migrate` derives product/workflow from the source run's
  identity (or `--product/--workflow`). The TARGET must have that template (cloud: baked+allow-listed; laptop:
  it originated there). The demo `greet` works out of the box; document/verify for a real product.
- **`.dockerignore` only applies at the CONTEXT ROOT** — the README makes copying it up REQUIRED; `cloud up`
  (A3) should automate that copy so the operator can't forget.
- **Single-writer lease** guards the journal double-write — do NOT weaken it. The source releases on freeze;
  the target acquires fresh on resume (proven in `migrate-loop.test.ts`).

## DECISIONS + WHY (do not relitigate)
- **serve + context are orthogonal** (Modal/vite `serve` = process; kubectl/docker `use-context` = the switch).
  Ladder: `--context` flag > `PIFLOW_CONTEXT` env > current > `local`. `local`/`cloud` are rows in
  `~/.piflow/contexts.json`.
- **Exposure = one process, one port, same-origin**: `piflowctl serve` on the VM serves GUI+API+SSE on
  `https://<app>.fly.dev` (Fly `[http_service] internal_port`); the browser talks straight to the VM (no
  reattach proxy). SSE authenticates via `?token=` (EventSource can't set headers); everything else via Bearer.
- **Migration = checkpoint→reprovision→reload with a stable run-id, NOT live teleport** (SkyPilot model). Resume
  rides the existing journal (`seedFromJournal` REUSEs done nodes), not a live memory move.
- **Fly.io** for the control VM (durable public host + real bwrap jail; Daytona blocks bwrap, E2B is ephemeral).
- **Per-node agents run `--sandbox local` INSIDE the VM** (bwrap), NOT nested cloud sandboxes (that's v2). So
  the VM needs the bearer token + model/OAuth creds, NOT E2B/Daytona keys.

## HOW TO WORK (process the user expects)
- Own the git loop: commit per coherent unit (one idea, no "and"), push as you go, `--no-ff` merge to `main`
  when the track is done+verified. End messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Delegate disjoint bounded work to named sub-agents** (this session used server-authz/cloud-image/cli-redirect
  successfully — verify EVERY agent against the diff + build + tests + a test-the-test mutation, NEVER its report).
- **Tests must fail when the code is wrong** (test-discipline); a live smoke gates the server/cloud glue.
- Confirm before outward-facing/irreversible actions (the real `fly deploy`, `fly secrets set`).

## SUGGESTED SKILLS (load as relevant)
`piflow-start` (run/monitor) · `agentic-prompt-design` (before ANY sub-agent/handoff prompt) · `test-discipline`
(before any test) · `okf-slices` (FIND the runner/sandbox/observe/cloud slices) · `piflow-overlord`.

## ARTIFACTS
- Plan: `/Users/tk/.claude/plans/sunny-inventing-pudding.md`
- This handoff: `docs/handoff-cloud-control-plane.md`
- The migrate spine: `packages/core/src/runner/{lease,migrate}.ts`, `packages/server/src/migrate.ts`,
  `packages/cli/src/{migrate,remote}.ts`; the image: `deploy/control-vm/`.
- Cloud-cred seams to reuse for A3: `packages/core/src/runner/env-staging.ts` (`cloudCredEnvAdditions`,
  `CLOUD_KINDS`), `SecretResolver{isCloud:true}`; the e2b deploy for the smoke pattern: `deploy/e2b/`.
</content>
