# Full-Run Simulation & E2E — the spec our tests derive from

**Status:** design · **Date:** 2026-07-01 · **Scope:** the cloud control plane's *actual run* path
(console → dispatch → sandboxed agent → contract → run-view/GUI), and the layered test suite that
proves it works. This doc is the **source of truth**; every E2E/smoke/journey test derives its
assertions FROM the scenarios and the rubric here (spec-driven — see §9). If a test and this doc
disagree, the doc wins or the doc changes — never a silent divergence.

---

## 1. The failure this prevents (why this doc exists)

The Railway control plane reported its deploy smoke **7/7 green** while a real run could not execute a
single node. That was not a missing test — it was a test asserting the **wrong thing**:

- `deploy/control-vm/smoke-live.mjs:203-208` (check D): `hasArtifact = /greeting\.txt/.test(blob) || /out\/greet/.test(blob)`.
  Those strings are in the node's **contract/config** (`node.json`: `artifacts:["greeting.txt"]`,
  `owns:["out/**"]`) — they appear in the serialized run-view **whether or not a file was produced**.
- `deploy/control-vm/smoke-live.mjs:170,182,231` (checks C/E): pass on the SSE reaching `{kind:"done"}`.
  A run reaches `done` even when its node **blocks / fails-closed**. `done` is a *scheduler* fact, not an
  *outcome* fact.
- `packages/server/src/start-run.ts:88-101` (esp. `:90`): the HTTP layer appends `--sandbox` **only if**
  the POST body carries one; omit it and the spawned `piflowctl run` defaults to `inmemory`
  (`packages/cli/src/run.ts:242`) — *no `pi`, no model, structural dry-run* — which can still reach
  `done`/`ok`. A full-run test that forgets `sandbox` verifies **nothing**.

This is a **named, recurring failure class**, not a one-off. Independently rediscovered by OpenClaw
(codex `exit 0` while a sandbox denied the write → orchestration recorded phantom success —
[PR #39460](https://github.com/openclaw/openclaw/pull/39460)), a claude-code postToolUse hook
(exit 0 + a sandbox-denial on stderr), and the "Signum" trust-boundary writeup
([ctxt.dev](https://ctxt.dev/posts/en/signum-trust-boundary/) — an orchestrator trusted a `status:SUCCESS`
that was a *presence-grep for a string that could appear anywhere*: structurally identical to our bug).

**The lesson (the whole doc in one line):** *green must mean the node actually ran and produced a
verifiable artifact — proven by a probe of real state that is external to the agent and independent of
config/scheduler text.*

---

## 2. The reference full-run journey (the canonical trace)

One ordered spine. Every layer of the test suite exercises some contiguous slice of it; the top tier
exercises all of it.

```
[console/GUI]  POST /api/runs/start { product, workflow, sandbox:<MODE>, executor, args }
      │            handler: packages/server/src/start-run.ts:108  (buildStartRunArgv :88, spawn detached :129)
      ▼
[control plane] spawns:  piflowctl run <templateDir> --run <id> --sandbox <MODE> …
      │            dispatch: packages/cli/src/run.ts  (resolveRunSandbox :775, provider factories)
      ▼
[sandbox MODE] node executes on HOST:
      │   • local/bwrap  → in-VM jail  (packages/core/src/sandbox/{local,bwrap}.ts)
      │   • e2b/daytona  → nested cloud VM  (packages/{e2b,daytona}/…, template/image from env)
      │   • docker       → local container mirror  (packages/docker/…)
      │   • danger-full-access → in-VM unsandboxed (IN_PLACE)  (env-staging.ts:50 effectiveSandboxLocation)
      ▼
[agent] real pi / claude-code writes declared artifacts into the node's output dir
      ▼
[collect] isolated providers copy out → run dir; IN_PLACE skips collection  (node-lifecycle.ts:482-486)
      ▼
[contract] host-stat verifies declared artifacts exist + parse  (node-lifecycle.ts:552-567)  → node verdict ok|gap|error
      ▼
[run-view] core distills .pi → run-view.json  (observe/buildRunView, gui/vite.config.ts:165)
      ▼
[SSE] observe.watchRun streams updates  (gui/vite.config.ts:90, client gui/src/data/runStream.ts:103)
      ▼
[GUI] console renders per-node status + artifact  (gui/src/components/WorkflowCanvas.tsx, runView.ts)
```

A "full run works" claim is only meaningful when the tier making it exercises the slice **through the
agent+contract hop** in a **non-`inmemory`** mode. Everything short of that is a plumbing test (still
valuable — see the tiers in §6 — but it must not be *reported* as "the E2E passed").

---

## 3. The journey catalog (organize the DAGs/journeys as positive + negative twins)

Spec-driven testing (§9) says: don't hand-write ad-hoc checks — **derive** them from the spec, and for
every positive scenario derive its **negative twin** (the failure mode the spec implies). Each journey
below carries: trigger · mode×host · the **falsifiable** assertion · the **red-test companion** (the
fault we inject to prove the assertion can go red — test-discipline §4).

Positive:

| ID | Journey | Falsifiable assertion (the observable that only holds if the node truly ran) |
|----|---------|------------------------------------------------------------------------------|
| **J1** | Happy full run (greet writes `greeting.txt`) | node verdict `ok` **AND** the declared artifact exists on disk with `mtime > run.startedAt` **AND** content byte-matches expected (`CONTROL-VM-OK`), read by a probe *outside* the agent — the `deploy/docker/smoke-live.mjs:85-93` D2 shape, not a substring of the run-view blob |
| **J2** | GUI user-journey (console → run → SSE → artifact) | Playwright: run-status DOM reaches `ok` within a realistic timeout **AND** ≥1 SSE event per node transition **AND** the artifact shown in run-view matches (path+hash) the J1-verified file |
| **J3** | Multi-node chain (producer → consumer) | consumer's input hash == recomputed hash of producer's output (blocks forged intermediates) — `deploy/docker/smoke-live.mjs` producer/consumer shape |

Negative twins (each MUST currently go RED, and stay RED-when-broken forever — these are the tests that
would have caught Railway):

| ID | Injected fault | Assertion that must fail LOUD |
|----|----------------|-------------------------------|
| **N-127** | e2b boots a pi-less base image (no `E2B_TEMPLATE`) → `pi: command not found` (exit 127) | run does NOT report success; node verdict ≠ ok; the rubric (§5) fails |
| **N-126** | `--sandbox local` on a host without userns → bwrap fails-closed (exit 126) | same — a fail-closed jail is a FAILED run, never a "done→ok" |
| **N-breach** | in-place `danger-full-access` writes `out/greet/greeting.txt` but contract checks `greeting.txt` at run root | node verdict `gap`/blocked, artifact-missing surfaced — not green |
| **N-inmemory** | POST omits `sandbox` → silent `inmemory` no-op reaches `done`/`ok` | the full-run test asserts the executed provider kind ≠ `inmemory` and REJECTS the run as non-proving |
| **N-ratelimit** | a `rate_limit_event` mid-run | verdict maps to `gap`, NOT misread as `ok` (guards the shipped `parseClaudeResult` fix) |
| **N-mutant** | a node that *cannot* produce its artifact, run through the real pipeline | the rubric FAILS it — if it passes, the rubric is broken and every other green is untrustworthy ("mutant proves teeth", already used in the overlord eval) |

> The three current blockers ARE N-127, N-126, N-breach. §8 ships each fix **with** its red-test.

---

## 4. The mode × host support matrix (the fork, resolved as data — not a blind pick)

The "which execution model on Railway?" question is not a guess; it's a cell in this table. `N/A` cells
carry their structural reason so no test wastes a run on them.

| MODE \ HOST | laptop (dev) | Fly.io | Railway | GH-hosted CI | self-hosted CI |
|-------------|--------------|--------|---------|--------------|----------------|
| **local / bwrap** | ✅ (macOS seatbelt) | ✅ (Debian trixie allows userns) | **N/A — userns blocked** (bwrap 126) | **N/A** (GH runner can't userns) | ✅ if runner allows userns |
| **e2b** (nested) | ✅ (needs `E2B_TEMPLATE`) | ✅ | ✅ **← recommended Railway default** | ✅ (nightly, cost-capped) | ✅ |
| **docker** (local mirror) | ✅ | n/a (VM-in-VM) | n/a | ✅ **← the free PR-tier cell** | ✅ |
| **danger-full-access** | ✅ (dev only) | ✅ (trusted single-tenant) | ✅ (trusted only; needs N-breach fix) | **excluded** (never unsandboxed in CI) | excluded |
| **inmemory** | ✅ structural only | ✅ | ✅ | ✅ (L0/L1 tiers) | ✅ |

**Consequence for Railway:** the original design (nodes in-VM under bwrap) is structurally impossible
there. The robust default is **e2b, with the control plane assigning the pi-baked template** (§8, fix 1).
`danger-full-access` in-VM is the "simplest, trusted-only, no external dep" alternative but needs the
N-breach fix and gives no isolation. Encode this table as a CI matrix `exclude` list
([GH matrix docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)),
and ideally generate it from the same `context {host, worker}` registry the CLI uses, so CI never drifts
from what the CLI considers supported.

---

## 5. The rubric — "did the full run actually succeed?" (reward-hack-proof, the LAW)

Every assertion in every tier obeys this. Each check is computed by a process **outside the agent's
sandbox/context**, against **real state**, never the agent's self-report or the run's scheduler state.
(Grounded in [hud.ai verifier design](https://www.hud.ai/resources/verifier-reward-design-rl-environments),
[agentpatterns anti-reward-hacking](https://agentpatterns.ai/verification/anti-reward-hacking/), and the
reward-hacking benchmark's hash-recomputation rule [arXiv 2605.02964](https://arxiv.org/html/2605.02964).)

```
FULL-RUN PASS  ⇔  ALL of:

1. PROCESS
   [ ] executed provider kind ≠ 'inmemory'         (else it proved nothing — guards N-inmemory)
   [ ] agent process terminal verdict == expected   (piflow's ok|gap|error mapping, NOT bare exit 0;
                                                      a rate_limit_event ⇒ gap, never ok — guards N-ratelimit)
   [ ] wall-clock < configured timeout, no watchdog abort (killedTimeout/killedStall == false)

2. NODE (per DAG node)
   [ ] node verdict == 'ok'  in the distilled run-view  (not 'gap', not 'error')
   [ ] EVERY contract-declared artifact EXISTS on disk (host stat), mtime > run.startedAt
   [ ] each artifact PARSES per its declared schema (non-empty; JSON validates if declared)
   [ ] chained input hash == recomputed hash of upstream output   (blocks forged intermediates — J3)

3. USER-JOURNEY (Playwright, independent process)
   [ ] run-status DOM reaches 'ok' within a realistic timeout (polled, never a fixed sleep)
   [ ] ≥1 SSE event observed per node transition (the derived GUI state actually changed)
   [ ] artifact shown in run-view matches (path + hash) the artifact verified in (2)

4. GUARDRAIL (negative control, periodic — not every PR)
   [ ] N-mutant (a node that cannot succeed) is run through the SAME pipeline and is asserted to FAIL.
       If the guardrail passes, the rubric is broken → every other green is void.

No partial credit. No LLM-judge may OVERRIDE this binary layer. An LLM judge, if ever added, is a
SEPARATE non-gating quality signal — never the detector of "did it run." (LLM judges are empirically
*fooled* by confident-sounding false success: AUROC ≤ 0.65, [arXiv 2606.09863](https://arxiv.org/html/2606.09863).)
```

**The 5 standards every test author must obey** (each is reviewer-checkable against a diff):

1. **No assertion may read a value fixed by config/template/contract text or by scheduler state alone.**
   Litmus: *"would this assertion still pass if I stubbed the executor to a no-op?"* If yes → it's theater.
2. **Node pass/fail is computed from independent post-hoc probes** (fs mtime/hash, exit-code verdict,
   declared artifact) — never the agent's log, never `run.status == "done"`.
3. **Every check has a committed red-test companion** reproducing a real silent-failure mode (N-*), asserted
   to go RED. (Hand-run mutation testing at the E2E layer.)
4. **Live model-calling runs are tiered by cost/cadence.** A cassette-replay run may NEVER be reported to
   humans as "the E2E passed" without the qualifier that it touched no real sandbox.
5. **Any LLM judge is calibrated + strictly additive** — never the sole success detector.

---

## 6. Test taxonomy → CI cadence (pragmatic 2026: deterministic-in-PR, live-in-nightly)

Five layers. The lower ones gate every push (fast, free); the expensive live tier is fenced to
nightly/dispatch/pre-release. Reuse the seams the recon found — **build on, don't rebuild**.

| Layer | What it proves | Cadence / CI trigger | Cost | Reuse seam (file:line) |
|-------|----------------|----------------------|------|------------------------|
| **L0 unit** | pure logic: `buildStartRunArgv`, contract checker, `resolveRunSandbox`, verdict mapping | every push (`vitest --project default`) | free | already green; `start-run.ts:88` is already pure+unit-tested |
| **L1 lifecycle (fakes)** | `runFromTemplate` bind→stage→exec→collect→verify with a **falsifiable content assertion** | every push | free | `InMemorySandboxProvider` (`core/src/sandbox/index.ts:113`) + `stubBuilder` (`core/test/runner.test.ts:48`) + `ExecRunner` fake (`exec-runner.ts:9`, exemplar `runner.test.ts:507-538`) |
| **L2 full-run replay** | the **HTTP** path: POST `/api/runs/start` → SSE → run-view, with a recorded agent trace; **force `sandbox≠inmemory`** | every PR (to `main`, path-filtered) | free (no model) | cassette/VCR-for-agents pattern; fake cloud SDK as host tmp dir (`e2b/test/sandbox-e2b-parity.test.ts:41-60`) |
| **L3 live full-run** | the real thing: real `pi`/`claude-code` in a real sandbox MODE×HOST cell | nightly + `workflow_dispatch` + **required in `release.yml`** | capped (§7) | wire the existing `vitest --project live` (`vitest.config.ts:18-22`, `package.json:12`); `probePi()` self-skip (`runner-live-tool-e2e.test.ts:68-80`) |
| **L4 user-journey** | J2 in a real browser (console→run→SSE→artifact) | PR = replay; nightly = live | free (PR) / capped (nightly) | **new** Playwright in `gui/`; `webServer = piflowctl serve`; `?token=` bearer already shipped |

**Only L3 (and the live half of L4) may be called "the E2E smoke."** L1/L2 are the fast guardrails that
keep PRs green; they are explicitly labeled "no real sandbox."

CI wiring (concrete, [labels-are-a-broken-gate](https://mergify.com/blog/stop-using-labels-to-control-ci-in-github-actions)):
- Add jobs to `.github/workflows/ci.yml` (today: `verify` `:16`, `test` `:42`, `smoke` `:98` — none run live).
- L2 → `pull_request` targeting `main`, `paths: [packages/**, gui/**, '**/.piflow/**']`.
- L3 → `push: [main]` + `schedule` (nightly) + `workflow_dispatch`; **never a PR label as the only path**
  (a skipped-because-no-label required check reports green). Fail LOUD: no `continue-on-error` on assertion
  steps; a separate `workflow_run` notifier + a heartbeat-on-success so a *missed* nightly is also caught.
- Matrix from §4 with `exclude`; `max-parallel: 2` on cells that hit a real cloud sandbox (rate limits);
  `fail-fast: false`. Upload Playwright trace + failing run-view `if: failure()`, `retention-days: 14`.

---

## 7. Cost, limits, and model policy (the rubric the user asked for)

The user's stance: fine to spend on testing, but there must be a **clear ceiling**. Concrete, countable:

- **Per live full-run:** ≤ **$1.00** spend · **`timeout-minutes: 15`** (GH-native) · **`--max-turns N`** on
  the agent CLI · **0 retries** on the live tier (a retry = a whole new paid session — treat one failure as
  signal, fail loud), **≤2 retries** on the Playwright DOM tier. Pre-flight reject (cap *before* the call,
  [llm-cost-cap](https://github.com/MukundaKatta/llm-cost-cap)); `on-budget-exceeded: fail` on the live job.
- **Bounded blast:** nightly (1×/day) × $1 ≈ **≤ $30/mo** worst case — cheap vs a shipped regression.
- **Model tier — the load-bearing call:** the agent-under-test in L3 uses **the production tier the node
  would really use**, NOT an artificial downgrade. A full run exercises rich tool-use + multi-turn
  file-writing, exactly where cheap models degrade
  ([PolicyAI](https://rescrv.net/w/2025/10/15/policyai-sonnet-v-haiku)); downgrading changes *what is being
  verified*. Use the **cheap tier only for harness bookkeeping** (and never as the success detector). This
  is consistent with our standing rule (Sonnet-not-Opus for *bulk/eval fan-outs* — a different thing from
  the agent-under-test).
- **Deterministic-first cascade:** the primary "did it work" signal is always a deterministic probe (§5);
  trajectory/LLM-judge layers are additive and non-gating.

---

## 8. Immediate remediation — the 3 blockers, each shipped WITH its red-test

Test-first (test-discipline Iron Law): the red-test lands first and must fail for the right reason, then
the fix makes it green.

1. **N-127 · control plane assigns the sandbox backend (the real unblock).** `cloud up`'s `mintCloudSecrets`
   (`packages/cli/src/cloud.ts:163-223`) projects the model cred + OAuth but **not** the sandbox backend
   config. Fix: for a `worker=e2b` context, project the pi-baked `E2B_TEMPLATE` (+`E2B_API_KEY`/`E2B_DOMAIN`)
   onto the control VM, exactly as it projects the model cred. Template id is **deploy config** (stays out of
   `@piflow/core` per the SDK boundary), carried across by the plane — never hand-set on the VM again.
   *Red-test:* an e2b run with no template resolvable must fail the §5 rubric (not silently boot base → 127).
2. **N-126 · bwrap guidance (message only; the 126 itself is correct on Railway).** The fail-closed 126 is
   *right* — Railway blocks userns. Only the guidance is wrong: `packages/core/src/sandbox/bwrap.ts:138-144`
   suggests only `danger-full-access`; add the cloud fallbacks (`--sandbox e2b/docker/daytona`). Better: the
   control plane refuses to configure `worker=local` on a host that can't userns and steers to e2b.
   *Red-test:* on a no-userns host, the message lists the cloud fallbacks.
3. **N-breach · in-place/isolated output-path parity.** The greet prompt hardcodes `out/greet/greeting.txt`
   (`deploy/control-vm/e2e-template/.piflow/greet/template/nodes/greet/prompt.md:5`); under IN_PLACE
   (`env-staging.ts:50-57`, `outputDir:'.'`) collection is skipped (`node-lifecycle.ts:482-484`) so the file
   lands nested while the contract stats `greeting.txt` at run root (`node-lifecycle.ts:553`). Isolated e2b
   flattens and passes; in-place breaches. Fix: make the write path the agent is told match where the
   contract checks across ALL provider kinds (render the output path from the effective location, or
   normalize the in-place collect). *Red-test:* the greet node passes under BOTH `danger-full-access` and
   `e2b` (parity), and N-breach injection reds.

**Also fix the false-green itself:** rewrite `deploy/control-vm/smoke-live.mjs` checks D/E to the §5 rubric
(force `sandbox≠inmemory`; assert node verdict `ok` + artifact `exists` + content/hash — the
`deploy/docker/smoke-live.mjs:85-93` shape), or replace the driver with the L3 vitest test.

---

## 9. Method: programmatic + spec-driven (June 2026 pragmatics)

- **Spec-driven, not ad-hoc.** This doc is the spec; scenarios (§3) + rubric (§5) are the source of truth;
  tests — including the **negative twins** — derive FROM them, and evolve WITH the code (not discarded after
  first implementation). This is the named "simulation-doc → derive tests" practice (SDD /
  `.feature`-as-truth / negative-scenario derivation).
- **Programmatic + native (no ad-hoc bash).** Operational test capability lives in the SDK/CLI + vitest +
  Playwright config, never throwaway scripts: wire the existing `test:live` vitest project into CI; add the
  L2 full-run vitest test reusing the fakes; add Playwright to `gui/`. Optionally expose a first-class
  `piflowctl e2e|simulate` verb so a full run is reproducible with one command (parity with `run`/`observe`/
  `optimize`) — a candidate, not a requirement.
- **VCR-for-agents for the replay tiers.** Record ONE golden trace of a real node run (LLM + tool calls +
  SSE) and replay it deterministically in L2/L4-PR; strict-mode **fail-closed on cassette miss** (never
  silently fall through to a live paid call); a periodic `rerecord/drift` pass keeps the cassette honest.
- **Mutation-verify the suite.** For each N-* companion, confirm reverting the fix reds the test — the suite
  must *demonstrably* have caught Railway.

---

## 10. Build order (what to do, in sequence)

1. **Make green honest (highest value, lowest risk):** rewrite the control-vm smoke to the §5 rubric +
   force non-`inmemory`; add the L1 falsifiable lifecycle test if not already covered. *Kills the root cause.*
2. **Ship the 3 blocker fixes** (§8), each test-first with its N-* red-test. Unblocks Railway (N-127 is THE
   unblock).
3. **Wire L3 into CI:** connect the existing `vitest --project live` to a nightly + `workflow_dispatch` job
   with the §4 matrix (`exclude`) and §7 caps; make it required in `release.yml`.
4. **Add L2 replay** (HTTP path, cassette, PR-gating) and **L4 Playwright** journey (`gui/`, `webServer =
   piflowctl serve`, `?token=`).
5. **Guardrail:** land N-mutant as the standing negative control.

**Open decision (now a data-backed pick, not a blind fork):** the Railway default worker — **e2b**
(recommended: real isolation, plane-assigned template) vs **danger-full-access** (simplest, trusted-only,
needs N-breach) vs **move control-VM execution to Fly/self-host** (keeps bwrap). §4 is the evidence.
```
