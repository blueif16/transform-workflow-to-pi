# The pi-driving capability surface

An authoritative, exhaustive inventory of every capability, knob, and contract piflow's runner
uses to drive ONE `pi` coding-agent process per node. This is the **denominator** for a downstream
coverage analysis (how much of this can Claude Code's headless CLI / Agent SDK satisfy?) and the
basis for a unified executor interface that both `pi` and Claude Code will implement.

All file:line citations are against the worktree
`/Users/tk/Desktop/piflow/.claude/worktrees/feat-claude-code-executor` (branch
`worktree-feat-claude-code-executor`, based on `main`), confirmed by opening each file.

**Classification key**
- **AGNOSTIC** — handled by piflow's runner/sandbox/io layer regardless of which agent runs; an
  alternate executor inherits it for free.
- **PI-CLI** — specific to the `pi` binary's flag/protocol surface; an alternate executor needs its
  OWN equivalent or a translation.
- **BRIDGE** — conceptually shared but the wire shape differs per agent; needs an adapter.

The injection seam that decouples all of this from the `pi` binary is the **`CommandBuilder`**
(`packages/core/src/runner/command.ts:20`, default `defaultPiCommand` at `:69`) plus the
**`ExecRunner`** (`packages/core/src/runner/exec-runner.ts:9`). Everything PI-CLI below is emitted
by `defaultPiCommand`; a new executor swaps `RunOptions.buildCommand` and inherits every AGNOSTIC
row unchanged.

---

## 1. Invocation & lifecycle

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| Headless launch flags | `runner/command.ts:80-83` | The base invocation | `pi -p --mode json -a … --offline --no-extensions --no-context-files --provider <p>` | **PI-CLI** — exact pi flag set; `-p` (print), `-a` (auto-approve), `--offline` are pi-binary semantics |
| Single shell-string command | `runner/command.ts:93-94` | The cmd handed to `Sandbox.exec(cmd)` under `shell:true` | `parts.join(' ')`, prompt appended as `@<file>` | **BRIDGE** — every executor needs an argv, but the assembly is pi-shaped |
| Spawn under watchdog | `runner/node-lifecycle.ts:394`, `exec-runner.ts:65` | Races `sandbox.exec` vs timeout+stall | `ctx.execRunner(execSandbox, cmd, {nodeTimeoutMs, stallMs, killGraceMs, onSpawn})` | **AGNOSTIC** — runner-owned; any cmd is raced the same way |
| Node hard timeout | `node-lifecycle.ts:193`, `exec-runner.ts:25,89` | Wall-clock cap → kill + `error` | `nodeTimeoutMs = node.sandbox.timeoutMs ?? ctx.watchdog.nodeTimeoutMs`; default `1_800_000` (`runner.ts:111`) | **AGNOSTIC** — watchdog wraps any child |
| Silent-stall kill | `exec-runner.ts:27,90-91` | No stdout/stderr for `stallMs` → kill | `stallMs` (0 = off); default `0` (`runner.ts:113`) | **AGNOSTIC** — but depends on the executor emitting a stream to "touch"; see telemetry §12 |
| Kill grace (SIGTERM→SIGKILL) | `exec-runner.ts:29,86`, `types.ts:544` | ms after abort before forced settle | `killGraceMs`; default `3000` (`runner.ts:115`) | **AGNOSTIC** |
| Kill mechanism (AbortSignal → process-group) | `exec-runner.ts:83,96`, `types.ts:540-545` | Real kill of the child's process group on a trip | `ExecOpts.signal` aborted; provider reaps the group | **AGNOSTIC** — provider/runner concern |
| `onSpawn` / pid persistence | `exec-runner.ts:31-37,96`, `node-lifecycle.ts:391-392`, `types.ts:528-539` | Persist the child pid for an external `--stop` | `onSpawn(pid)` → `writeNodePid` → `.pi/nodes/<id>/pid.json` (`layout.ts:82`); only on `IN_PLACE_KINDS` (host-signalable) | **AGNOSTIC** — pid file is piflow's; the spawned binary is irrelevant |
| pid cleared on terminal | `node-lifecycle.ts:819`, `layout.ts:100` | Stale pid removed on every exit | `clearNodePid(outDir, id)` in `finishNode` | **AGNOSTIC** |
| Exit-code → status | `node-lifecycle.ts:398,637-639` | `code !== 0` (or killed) ⇒ `error` | `rec.exitCode = result.code`; nonzero ⇒ `st='error'` | **AGNOSTIC** — any process returns an exit code |
| Stdin closed | `command.ts:64` (doc) | A headless CLI with an open stdin pipe + no TTY hangs forever | runner closes stdin | **PI-CLI** — a known pi-headless invariant; an alternate CLI may have its own stdin contract |
| G2 concurrency cap | `run-context.ts:90`, `runner.ts:124` | Max nodes in flight (one global FIFO limiter) | `maxConcurrent` default 8, clamped `[1,16]`; retries share one slot | **AGNOSTIC** |
| Run-wide node ceiling | `run-context.ts:101-104`, `node-lifecycle.ts:865` (`cappedRecord`) | Fork-bomb valve; (cap+1)-th node → synthetic `error` | `maxNodesPerRun` (`runner.ts:131`) | **AGNOSTIC** |

## 2. Prompt & input staging

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| Prompt staged as a file | `node-lifecycle.ts:307,311`, `command.ts:93` | Multi-KB wave prompts robust as a file ref | written to `_pi/<id>/prompt.md`, referenced `@<promptFile>` | **BRIDGE** — pi's `@<file>` arg-input; another agent may take prompt on stdin/flag/SDK arg |
| `@file` reference syntax | `command.ts:93` | How the prompt path is passed | `@${q(ctx.promptFile)}` | **PI-CLI** — `@`-prefix is pi's file-ref convention |
| Per-node staging dir | `node-lifecycle.ts:120` | Parallel nodes sharing a workspace never clobber | `_pi/<id>/` (`nodeStage`) | **AGNOSTIC** |
| Token resolution in prompt | `node-lifecycle.ts:269-279` | `{{arg.*}}`/`{{WORKSPACE}}`/`{{RUN}}`/`{{state.*}}` made physical | `resolveTokens(node.prompt, resolveCtx)`; missing ⇒ loud throw | **AGNOSTIC** |
| Contract markers appended | `node-lifecycle.ts:306,310` | Machine-readable contract block appended to prompt | `emitMarkers(markersFromNode(node, resolved))` (see §10) | **BRIDGE** — text appended to any prompt, but the DRIVER-* vocab is piflow's own (executor-agnostic text) |
| `promptPrefix` (escalation/consult preamble) | `node-lifecycle.ts:309-310`, `node-lifecycle.ts:64-66` (`AttemptOverride`) | Prepend verified-failure evidence on an escalation re-run | `over.promptPrefix` prepended | **AGNOSTIC** — prompt-text concern |
| Feedback-only resume prompt | `node-lifecycle.ts:308-310` | On a WARM resume the staged prompt is `promptPrefix` ALONE (original prompt+markers already in the resumed session) | `isResume ? (over.promptPrefix ?? '') : prefix+prompt+markers` | **BRIDGE** — depends on a resumable session (§8); the feedback-only shape differs per agent |
| io.reads staged into sandbox | `node-lifecycle.ts:226-229` | Upstream artifacts mirrored in at same rel path | `sandbox.writeFile(rel, data)` for each `node.io.reads` | **AGNOSTIC** |
| Seed PRE ops staged | `node-lifecycle.ts:236-243` | Declared starting artifacts staged + mirrored | `stageSeed(...)` + `stageHostPathIntoSandbox(...)` | **AGNOSTIC** |
| stdin handling | `command.ts:64` (doc only) | Runner closes stdin to avoid a headless hang | (no explicit pipe write) | **PI-CLI** |

## 3. System-prompt / context-file control

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| Context-file suppression | `command.ts:81` | A node runs on ONLY the driver's prompt — no repo `AGENTS.md`/`CLAUDE.md` leak | `--no-context-files` | **PI-CLI** — exact pi flag; an alternate agent needs its own AGENTS.md/CLAUDE.md suppression mechanism |
| Extension auto-load suppression | `command.ts:81` | No ambient extensions load (explicit `-e` still loads) | `--no-extensions` | **PI-CLI** |
| Startup network chatter suppression | `command.ts:81` | Suppress pi's startup chatter (model call still works) | `--offline` | **PI-CLI** |
| `agentType` system-prompt hint | `types.ts:33`, `node-lifecycle.ts:778` | Optional custom sub-agent system-prompt label | `node.agentType` carried to `NodeConfig.agentType` (observe passthrough); **NOT emitted as a pi flag in `defaultPiCommand`** | **BRIDGE** — carried as metadata only today; no append-system-prompt flag is wired |
| append-system-prompt | — | — | **none found** — `defaultPiCommand` (`command.ts:69-95`) emits no `--system`/`--append-system-prompt`; searched `command.ts` + `node-lifecycle.ts` for any system-prompt flag | **n/a** |

## 4. Model / provider / tier / thinking / escalation

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| Effective model resolution | `node-lifecycle.ts:362-367`, `model-routing.ts:66` (`resolveNodeModel`) | The single home of model/provider precedence | precedence: `node.model > tiers[node.tier] > run --model > pi default` (`model-routing.ts:6-8`) | **AGNOSTIC** — resolution is piflow's; the resolved id is fed to any executor |
| `--model` flag | `command.ts:84` | Pin the model (only when resolved) | `--model <ctx.model>` | **BRIDGE** — every agent picks a model, but the flag name/id namespace differs |
| `--provider` flag | `command.ts:82` | The gateway | `--provider <provider>` (default `'cp'`, `command.ts:70`) | **PI-CLI** — pi's provider/gateway concept; Claude Code has no `--provider` equivalent |
| Per-node provider | `types.ts:42`, `model-routing.ts:85-87` | Per-node gateway override | `node.provider` | **BRIDGE** |
| Tier alias | `types.ts:43`, `model-routing.ts:69-82` | `tier` → model via `~/.piflow/model-tiers.json` (when `active`) | `node.tier`; canonical `'fast'|'balanced'|'deep'` (`model-routing.ts:126-128`); unresolvable ⇒ loud throw | **AGNOSTIC** — tier→id mapping is piflow config; resolved id then bridges |
| models.json provider auto-resolve | `model-routing.ts:86,200` (`loadModelsIndex`) | model id → provider from pi's `~/.pi/agent/models.json` | read-only; `m.id → provider` | **PI-CLI** — reads pi's native registry; a non-pi executor has no models.json |
| `--thinking` flag | `command.ts:87`, `types.ts:721` | Reasoning-depth cap | `--thinking <v>` only when `opts.thinking` truthy; `RunOptions.thinking` (`runner.ts:108`) | **PI-CLI** — pi's reasoning knob; maps to a different param per agent |
| Escalation model swap | `node-lifecycle.ts:371-373`, `retry.ts:119-126` | Re-run on a STRONGER model fed failure evidence | `over.model`/`over.provider` override `eff.*`; resolved via `resolveNodeModel` | **AGNOSTIC** — re-run orchestration; the chosen id bridges |
| `AttemptOverride` | `node-lifecycle.ts:64-77` | Per-attempt override carrier (promptPrefix/model/provider/resumeSessionId) | the override record | **AGNOSTIC** (its `resumeSessionId` arm is BRIDGE — see §8) |

## 5. Tool selection & binding

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| `ToolSelection` allow/deny | `types.ts:242-247` | Per-node addressed tool set | `{allow?: string[]; deny?: string[]}`, addresses `ns:name` (`fs:read`, `web:search`, `mcp.github:create_issue`) | **AGNOSTIC** — the selection model is piflow's; resolution differs per agent |
| Pre-node bind check ("verified, not trusted") | `node-lifecycle.ts:93-96`, `tools/verify.ts:38` (`verifyToolBinding`) | Confirms every declared address binds to a unique bare name BEFORE sandbox/spawn | miss or collision ⇒ `blocked`; checks `declared = allow − deny` | **AGNOSTIC** — a registry contract check, executor-independent |
| `registry.resolve` → `piTools` | `node-lifecycle.ts:100`, `tools/registry.ts:69-90` | allow → bare `piName`s | `result.piTools` (deduped bare names) | **BRIDGE** — the bare-name list is what pi's `--tools` consumes; another agent needs its own tool wiring |
| `--tools` flag | `command.ts:85` | The allowed tool set | `--tools <piTools.join(',')>` e.g. `--tools read,write,bash` | **PI-CLI** — pi's flag + bare-name namespace |
| `--exclude-tools` flag (deny) | `command.ts:86`, `tools/registry.ts:93-98` | Denied tools | `--exclude-tools <excludeTools.join(',')>` | **PI-CLI** |
| Builtin tool catalog | `tools/registry.ts:11-19` (`BUILTIN_TOOLS`) | The native pi tool vocabulary | `fs:read→read, fs:write→write, fs:edit→edit, fs:grep→grep, fs:find→find, fs:ls→ls, sh:bash→bash` | **PI-CLI** — these bare names ARE pi's natives; an alternate agent has a different builtin set |
| Generated `-e` extension (sdk/mcp/contract tools) | `node-lifecycle.ts:315-319`, `tools/registry.ts:103`, `tools/compile.ts:266` | Binds non-native tools via a staged `pi.registerTool` extension | `result.extension` staged to `_pi/<id>/tools.ts`, passed as `pi -e <file>` | **PI-CLI** — `pi.registerTool` + `-e` plugin protocol is pi-specific |
| `-e` load order | `command.ts:88-90` | extra extensions FIRST, then staged tool ext | `opts.extraExtensions` then `ctx.extensionFile` | **PI-CLI** |
| Tool sources (builtin/sdk/mcp/contract) | `types.ts:679`, doc `672-679` | How a tool resolves (native vs `-e`-bound vs bridge) | `ToolSource` union | **BRIDGE** — the source taxonomy maps differently per agent |
| `submit_result` contract tool | `tools/contract-tool.ts:20` (`'contract:submit_result'`, piName `submit_result`), `tools/registry.ts:27` | First-party typed terminating return tool, baked into the `-e` ext | opt-in; `terminate:true` execute | **BRIDGE** — the return-handshake tool; another agent needs its own terminating tool/contract |
| `DRIVER-TOOLS`/`DRIVER-EXCLUDE-TOOLS` markers | `contract.ts:120-121` | Tool set echoed into the prompt for self-gating | `DRIVER-TOOLS: <comma list>`, `DRIVER-EXCLUDE-TOOLS: <comma list>` | **BRIDGE** — text marker, executor-agnostic but the names are pi bare names |

**Tool binding** (user-called-out) wiring chain: `node.tools` (`types.ts:49,242`) →
`verifyToolBinding` pre-check (`node-lifecycle.ts:93`) → `registry.resolve` (`node-lifecycle.ts:100`)
→ `piTools`/`excludeTools`/`extension` → `--tools`/`--exclude-tools`/`-e` (`command.ts:85-90`).

## 6. MCP wiring

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| Bridged-tool detection | `env-staging.ts:60` (`selectedBridgedTool`), `node-lifecycle.ts:129` | Did the node select an `mcp.*` / `oc.*` tool? | `address.startsWith('mcp.') || .startsWith('oc.')` survives allow−deny | **AGNOSTIC** — selection inspection |
| `mcpConfig` staging | `node-lifecycle.ts:324-326` | Server map written verbatim into the sandbox | `_pi/<id>/mcp.json` = `JSON.stringify(ctx.mcpConfig)`; carries `$VAR` refs, never literals | **BRIDGE** — MCP config FILE shape differs per agent (pi's bridge vs Claude's `.mcp.json`) |
| `PIFLOW_MCP_CONFIG` env | `env-staging.ts:110`, `node-lifecycle.ts:131-144` | Absolute in-sandbox path of `mcp.json` injected as env | `env.PIFLOW_MCP_CONFIG = configPathAbs` | **PI-CLI** — the pi tool-bridge reads this env var name |
| Referenced secret env vars | `env-staging.ts:66` (`referencedEnvVars`), `env-staging.ts:103` (`mcpEnvAdditions`) | Allowlisted `$VAR`s resolved through the broker and injected | only `$VAR`/`${VAR}` names referenced in the config cross | **AGNOSTIC** — allowlist + broker is runner-owned |
| `RunOptions.mcpConfig` | `runner.ts:164-171` | The run-level server map | `{servers: Record<string, unknown>}`, loose shape (bridge owns validation) | **BRIDGE** |
| OpenClaw (`oc.*`) reserved server | `env-staging.ts:11-12` (doc), `env-staging.ts:62` | `oc.*` selection stages identically via a reserved `openclaw` server | same `mcpConfig.servers` path | **BRIDGE** |

## 7. Skills

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| `node.skill` declaration | `types.ts:32`, `node-lifecycle.ts:336` | The Agent-Skill dir to load | `node.skill` resolved via `resolveSkillStage` | **AGNOSTIC** — the selection is piflow's |
| Skill staged as a forced read-only PRE-stage | `node-lifecycle.ts:334-346` | Copy source to `.pi/skills/<name>/`, mirror into sandbox | `cp` to `.pi/skills/<name>`, `stageHostPathIntoSandbox` | **BRIDGE** — `.pi/skills/` is pi's native discovery dir; another agent has its own skills location |
| `--skill <dir>` flag | `command.ts:91-92`, `command.ts:42` (doc) | Loads the staged skill explicitly (additive even under `--no-skills`) | `--skill <skillPath>` | **PI-CLI** — exact pi flag |
| `CommandContext.skillPath` | `command.ts:38-44` | In-sandbox path passed to the builder | `ctx.skillPath` | **PI-CLI** |

## 8. Sessions & warm resume

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| `--no-session` default | `command.ts:76-78` | Ephemeral by default | `--no-session` (kept when `opts.session` absent) | **PI-CLI** |
| `--session-dir` | `command.ts:77` | Persisted session tree location | `--session-dir <dir>` | **PI-CLI** |
| `--session-id` (CREATE) | `command.ts:77` | First attempt mints the session, caller-minted id | `--session-id <id>` when `!opts.session.resume` | **PI-CLI** — pi's session create/resume flag pair |
| `--session` (RESUME) | `command.ts:77` | Warm L1 retry resumes the existing session | `--session <id>` when `opts.session.resume` | **PI-CLI** |
| Session id = node id | `node-lifecycle.ts:296-299` | Stable, deterministically locatable | `id: node.id` | **AGNOSTIC** |
| Session dir under run dir | `node-lifecycle.ts:296-297`, `layout.ts:37` (`piSessionsDir`) | `<runDir>/.pi-sessions` — sibling of `.pi/`, never inside the journal/state tree | `piSessionsDir(outDir) = path.join(run, '.pi-sessions')` | **AGNOSTIC** — piflow chooses the location |
| Warm-eligibility gate | `node-lifecycle.ts:294-298` | Sessions only on IN_PLACE (local) providers where the `.jsonl` survives between attempts | `warmEligible = IN_PLACE_KINDS.has(providerKind)`; else stays cold (`--no-session`) | **AGNOSTIC** — the decision is runner-owned |
| Warm L1 retry decision | `retry.ts:107`, `node-lifecycle.ts:294-295` | SAME-MODEL retry sets `resumeSessionId` ⇒ this attempt RESUMES + prompt is feedback-only | `runNode(..., {promptPrefix: consultPreamble(sig), resumeSessionId: node.id})` | **BRIDGE** — the concept (resume + feedback-only) ports, but the wire (which flags, what persists) is pi-specific |
| Cold escalation (never resumes) | `retry.ts:126`, `node-lifecycle.ts:293` (doc) | A model swap stays cold (no `resumeSessionId`) | escalation sets `model`/`provider`, leaves `resumeSessionId` undefined | **AGNOSTIC** |
| Session id/dir journaled | `node-lifecycle.ts:848-851` | A future `node <run> <id> --resume` finds the session | `sessionId`/`sessionDir` written into the journal entry | **AGNOSTIC** |
| `PiCommandOptions.session` | `types.ts:725-734` | The builder's session opt shape | `{dir, id, resume?}` | **BRIDGE** |

**Warm resume** (user-called-out) full chain: `retry.ts:107` sets `over.resumeSessionId` →
`node-lifecycle.ts:294-299` builds the `session` opt only on `IN_PLACE_KINDS` →
`node-lifecycle.ts:377` merges it into `commandOpts` → `command.ts:76-78` drops `--no-session` and
emits `--session-dir`/`--session` → session lives at `<runDir>/.pi-sessions` (`layout.ts:37`) → on
resume the prompt is feedback-only (`node-lifecycle.ts:308-310`).

## 9. Sandbox / isolation

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| `SandboxSpec` | `types.ts:216-233` | The per-node where-it-runs envelope | `{provider, workspace, read[], write[], output, image?, env?, timeoutMs?}` | **AGNOSTIC** |
| Provider kinds | `types.ts:209` | The execution backend | `'inmemory'|'local'|'seatbelt'|'worktree'|'daytona'|'e2b'` | **AGNOSTIC** — provider is independent of the agent inside it |
| In-core providers | `sandbox/index.ts:20` (inmemory), `sandbox/local.ts:55,244` (local), `sandbox/seatbelt.ts:223,347` (seatbelt), `sandbox/worktree.ts:80,262` (worktree), `sandbox/bwrap.ts` (Linux backend) | The shipped backends | one class+provider per kind | **AGNOSTIC** |
| daytona/e2b providers | — | Cloud backends | **NOT in core's `sandbox/` dir** — installable `@piflow/*` extensions (confirmed: dir holds inmemory/local/seatbelt/worktree/bwrap/scope/jail/capture only); `CLOUD_KINDS` policy is in-core (`env-staging.ts:18`) | **AGNOSTIC** |
| Read scope (OS-enforced, seatbelt/local) | `node-lifecycle.ts:201` (`readScope: node.sandbox.read`), `sandbox/seatbelt.ts:154` (`buildSeatbeltProfile`), `:203` (`seatbeltExecPlan`), `sandbox/scope.ts:71` (`computeScopeRoots`) | Deny-all-then-allow read jail (Seatbelt SBPL) | `sandbox-exec -f <profile> sh -c <cmd>` (`seatbelt.ts:218`); `read[]` → SBPL `@SCOPE_ALLOWS@` | **AGNOSTIC** — kernel-enforced jail wraps ANY command, agent-blind |
| Write scope / `owns` | `node-lifecycle.ts:202`, `types.ts:502-508` (`CreateOpts.writeScope`), `sandbox/scope.ts:95` | OS-enforced write jail to `{workdir, writeScope, scratch}` | `writeScope: node.sandbox.write` → SBPL `@WRITE_SCOPE_ALLOWS@` | **AGNOSTIC** |
| `enforceReadScope` default-on | `sandbox/local.ts:94,253-256` | Secure-by-default read+write jail; `false` = `danger-full-access` escape hatch | default `true` | **AGNOSTIC** |
| Seatbelt exec plan | `sandbox/seatbelt.ts:203` (`seatbeltExecPlan`) | The single place the macOS kernel jail is applied; `null` off-darwin | returns `{file:'sandbox-exec', argv:['-f',profile,'sh','-c',cmd]}` | **AGNOSTIC** |
| Workspace (cwd) | `types.ts:219`, `node-lifecycle.ts:197` (`effectiveSandboxLocation`), `env-staging.ts:45` | The spawned agent's cwd | IN_PLACE ⇒ cwd = run dir; isolated ⇒ throwaway workspace | **AGNOSTIC** |
| Output dir + `downloadDir` | `types.ts:225,567`, `node-lifecycle.ts:424` | The portable collection contract (every backend) | `sandbox.downloadDir(node.sandbox.output, outDir)` | **AGNOSTIC** |
| Container image | `types.ts:228`, `node-lifecycle.ts:205` | Cloud image | `image: node.sandbox.image` | **AGNOSTIC** |
| Node env | `types.ts:230`, `node-lifecycle.ts:209-211` | Extra env merged with MCP+cred additions | `env: {...node.sandbox.env, ...mcpEnv, ...credEnv}` | **AGNOSTIC** |
| Cloud per-command timeout | `node-lifecycle.ts:212` | E2B's 60s default would kill long nodes; threaded explicitly | `timeoutMs: nodeTimeoutMs` | **AGNOSTIC** |
| Run-scoped lifecycle | `types.ts:597-618` (`RunScope`/`openRun`) | Worktree/VM shared across all nodes | `scope.create(opts)` per node, `scope.dispose()` once | **AGNOSTIC** |

## 10. I/O contract & outputs

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| `NodeIO` | `types.ts:323-388` | The full data contract | `{reads, produces, externalInputs?, dependsOn?, artifacts, checks?, checksPrePost?, policy?, returnSchema?, returnMode?, fillSentinel?, retries?, retry?, escalate?, maxRepairAttempts?}` | **AGNOSTIC** |
| Artifact requirement | `types.ts:252-257` (`ArtifactReq`) | Required output stat'd (and schema-validated) | `node.io.artifacts: {path, schema?}` | **AGNOSTIC** |
| Artifact verify by host-stat | `node-lifecycle.ts:490-493` | A node is `ok` only if declared artifacts exist on disk | `artifactState(resolve(outDir, a.path), a.path)`; missing ⇒ `blocked` | **AGNOSTIC** — output-on-disk verdict is executor-blind |
| Output collection | `node-lifecycle.ts:420-430` | Copy sandbox output dir back to host run dir | `collectMutex(() => sandbox.downloadDir(...))`; in-place skips | **AGNOSTIC** |
| Collect mutex (serialized) | `run-context.ts:91-100`, `node-lifecycle.ts:424` | Parallel lanes copy into shared run dir one-at-a-time | one-slot FIFO | **AGNOSTIC** |
| Schema gate | `node-lifecycle.ts:498-505`, `runner/schema.ts` | present-but-invalid artifact = breach | `validateArtifactSchemas(...)`; draft-2020-12 | **AGNOSTIC** |
| Integrity checks | `node-lifecycle.ts:517-524`, `checks.ts:117` (`evaluateChecks`), `:138` (`effectiveChecks`) | Pure predicates over artifacts → verdict→action policy | kinds: `exists, non-empty, regex-absent, regex-present, json-parses, field-present, count-floor, fenced-tail` (`checks.ts:62-111`) | **AGNOSTIC** |
| Policy (verdict→action) | `node-lifecycle.ts:523`, `checks.ts:154` (`actionForVerdict`), `types.ts:288-291` | What a non-pass verdict DOES | `PolicyAction = 'block'|'warn'|'stop'|'retry'|'escalate'`; default fail→block, warn→warn | **AGNOSTIC** |
| `checksPrePost` (pre-gate) | `node-lifecycle.ts:250-267`, `op-dispatch.ts:103` (`gatesFromOp`) | pre-gates over staged inputs BEFORE the model | blocking pre-gate ⇒ `blocked` without spawning | **AGNOSTIC** |
| op[] protocol | `types.ts:81,116-139`, `runner/op-dispatch.ts:58` (`derivesFromOp`), `:103` (`gatesFromOp`), `:177` (`runOpsFromOp`) | The unified node-op envelope (gate/transform/run/action) | `OpSpec[]` with exactly one body | **AGNOSTIC** |
| Derive ops (project/registryProject/merge/run) | `node-lifecycle.ts:446-485` | Derive outputs from frozen on-disk inputs after collect, before gates | reuse `applyProjectionOp`/`runMerge`/`applyMergeOp` | **AGNOSTIC** |
| Promote (RunState) | `node-lifecycle.ts:697-710`, `op-dispatch.ts` promotes | Lift an OK node's output into a state channel | `ctx.promotesByNode.set(...)`, merged at the stage barrier | **AGNOSTIC** |
| Return handshake parse | `node-lifecycle.ts:538`, `runner/return-parse.ts:9` (`lastJsonBlock`) | Parse the fenced-JSON tail from stdout | `lastJsonBlock(result.stdout)` → `{status?, summary?, issues?}` | **BRIDGE** — parses pi's stdout; the fenced-JSON convention must hold on the alternate agent's output stream |
| Return mode (required/optional) | `node-lifecycle.ts:532`, `types.ts:294` | Whether a missing return is fatal | `returnMode = node.io.returnMode ?? ctx.returnProtocol ?? (artifacts? optional : required)` | **AGNOSTIC** |
| Return schema gate | `node-lifecycle.ts:554-562`, `types.ts:346-352` | Shape of the structured return | `node.io.returnSchema`; validated only under `required` | **AGNOSTIC** |
| `fillSentinel` completeness | `node-lifecycle.ts:518`, `types.ts:355-359` | Unfilled `<FILL:` ⇒ incomplete (auto `regex-absent`) | `node.io.fillSentinel` | **AGNOSTIC** |
| G8 in-sandbox schema repair | `node-lifecycle.ts:564-626` | Re-prompt the live sandbox from {prevOutput, ajvErrors, schema} | `maxRepairAttempts`; re-exec same cmd path | **BRIDGE** — re-prompts via the same `buildCommand`; repair-prompt assembly is executor-blind but re-exec rides the pi cmd |
| Status ladder | `node-lifecycle.ts:635-671` | kill/nonzero → missing → schema → checks → op → returnSchema → self-report → handshake → ok | the ordered verdict | **AGNOSTIC** |
| `run-view.json` / status | `runner/status.ts`, `node-lifecycle.ts:823` (`writeStatus`) | The per-run status record | `.pi/run.json` etc. (`layout.ts:24`) | **AGNOSTIC** |
| io ledger | `types.ts:454-469` (`NodeIo`) | Per-node reads/writes/promotes record | `.pi/nodes/<id>/io.json` | **AGNOSTIC** |

## 11. Env & secrets

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| `SecretResolver` seam | `types.ts:636-642`, `run-context.ts:56` | Per-`$VAR` resolution; broker mints scoped cloud tokens | `(varName, {nodeId, isCloud}) => string|undefined`; default `process.env` | **AGNOSTIC** |
| MCP secret env additions | `env-staging.ts:103` (`mcpEnvAdditions`), `node-lifecycle.ts:137-143` | Referenced `$VAR`s resolved + injected (allowlist) | only referenced names cross; cloud strips non-allowlisted | **AGNOSTIC** |
| Cloud env allowlist policy | `env-staging.ts:18` (`CLOUD_KINDS`), `env-staging.ts:117-121` | Host env never spread wholesale into a VM | daytona/e2b allowlist-only | **AGNOSTIC** |
| Provider-credential parity | `env-staging.ts:141` (`cloudCredEnvAdditions`), `node-lifecycle.ts:149-154` | pi's OWN gateway key crosses into a cloud VM | resolves `cloudSecrets` names (e.g. `ANTHROPIC_API_KEY`, `NEBIUS_API_KEY`); cloud-only | **BRIDGE** — the concept ports, but WHICH key (and that the cmd stamps `--provider`/`--model` but no key) is pi-shaped |
| `RunOptions.cloudSecrets` | `runner.ts:180-189` | The provider-cred allowlist | `string[]` of env var NAMES | **BRIDGE** |
| ANTHROPIC_API_KEY injection condition | `env-staging.ts:148`, `node-lifecycle.ts:149-154` | Forwarded ONLY when `isCloud && cloudSecrets` declared (local inherits process.env) | gated to `isCloud` | **BRIDGE** — for a Claude executor this is the PRIMARY credential, not just one of many providers' |

## 12. Telemetry / observability

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| `--mode json` event stream | `command.ts:80` | pi emits a JSON event stream on stdout | `--mode json` | **PI-CLI** — pi's structured stream; another agent has a different (or no) event protocol |
| Stdout teed to events archive | `node-lifecycle.ts:383-384`, `runner/events.ts:94` (`NodeRecorder`), `:173` (`recordingSandbox`) | Each node's stdout slimmed → `.pi/nodes/<id>/events.jsonl` | line-buffered, slimmed | **AGNOSTIC** (the teeing) / the PARSED FIELDS are PI-CLI |
| Kept event fields | `events.ts:35,43-51` | What survives slimming | `KEEP_MSG_FIELDS = ['role','model','provider','api','usage','stopReason']` | **PI-CLI** — these are pi event-schema fields |
| Cost/token parsing | `observe/distill.ts:120` (`createNodeAccumulator`), `:149-156` (`costScalar`), `:162-170` (`addUsage`), `:183-194` | Sums tokens + cost from the event stream | reads `message.usage` (`input/output/cacheRead/cacheWrite/cost`) at `message_end`; ignores `turn_end` to avoid double-count | **PI-CLI** — pi's `usage`/`cost` object shape |
| Telemetry rollups | `observe/runView.ts:159` (replay events.jsonl), `:413-416`, `observe/telemetry.ts:197-199,305-307,395-398` | Aggregate cost/billable/tokens per run | distilled from `events.jsonl` | **PI-CLI** (consumes the pi stream) |
| model/tool-call counts | `distill.ts:189` (modelCalls), `:205` (toolCalls per `tool_execution_start`) | Per-node call counts | from pi event names | **PI-CLI** |
| Exit code (separate signal) | `node-lifecycle.ts:398`, `checks.ts:183` (`FailureSignals.exitCode`) | Used by the failure classifier, NOT telemetry | `result.code` | **AGNOSTIC** |
| Live event sink | `runner.ts:197-201` (`onEvent`), `node-lifecycle.ts:383` | Push seam for TUI/GUI | `(nodeId, slimmedEvent)` | **AGNOSTIC** (the seam) / payload is PI-CLI-shaped |

**Note:** piflow does NOT rely on exit code alone — it parses cost/tokens from pi's `--mode json`
stream via `observe/distill.ts`. An executor that does not emit a compatible event stream loses all
telemetry (cost/tokens/model-calls/tool-calls) but keeps the exit-code + artifact verdict.

## 13. Injection seams & run config surface (the "outer layer of APIs")

| Capability | Where wired (file:line) | What it controls | Exact shape/contract pi expects | Classification |
|---|---|---|---|---|
| `CommandBuilder` seam | `command.ts:20-22` | The function building the per-node shell command | `(node, resolved, ctx, opts?) => string` | **AGNOSTIC** — THE seam; swap it for a new executor |
| `defaultPiCommand` | `command.ts:69` | The production headless pi command | (all §1-8 pi flags) | **PI-CLI** |
| `CommandContext` | `command.ts:25-45` | What the runner hands the builder | `{promptFile, model?, provider?, extensionFile?, skillPath?}` | **BRIDGE** |
| `PiCommandOptions` | `types.ts:720-735` | Env-free builder opts | `{thinking?, extraExtensions?, session?}` | **BRIDGE** |
| `ExecRunner` seam | `exec-runner.ts:9-21` | The spawn + watchdog primitive | `(sandbox, cmd, {nodeTimeoutMs, stallMs, killGraceMs, onSpawn?}) => Promise<{result, killed}>` | **AGNOSTIC** |
| `RunContext` | `run-context.ts:31-116` | The shared mutable run state threaded to every lane | (35+ fields: wf, registry, buildCommand, execRunner, modelRouting, watchdog, mcpConfig, secretResolver, cloudSecrets, escalator, limiter, …) | **AGNOSTIC** |
| `RunOptions` (the caller-facing API) | `runner.ts:58-218` | Everything a caller sets for a run | see field list below | **AGNOSTIC** (the surface) — individual fields classified in their categories |
| `Sandbox` interface | `types.ts:556-571` | The provider contract (putFiles/writeFile/exec/downloadDir/dispose) | the lifecycle seam | **AGNOSTIC** |
| `SandboxProvider` / `RunScope` | `types.ts:597-619` | Backend + run-scoped lifecycle | `create`/`openRun` | **AGNOSTIC** |
| `ToolRegistry` seam | `types.ts:738-744` | resolve a selection to pi flags | `register/resolve/search/list` | **BRIDGE** — `resolve` emits pi-shaped output |
| `Escalator` seam | `types.ts:663`, `run-context.ts:60` | `notify` host binding | `(notice) => void` | **AGNOSTIC** |
| `CheckpointWaiter` seam | `exec-runner.ts:41-54`, `run-context.ts:115` | HITL reply poll | injectable | **AGNOSTIC** |

**`RunOptions` field index** (`runner/runner.ts`): `run?` :59 · `name?` :66 · `promptId?` :68 ·
`outDir?` :70 · `repoRoot?` :72 · `workspace?` :77 · `args?` :82 · `provider?` :84 · `registry?` :86
· `buildCommand?` :88 · `execRunner?` :90 · `providerName?` :92 · `model?` :94 · `modelRouting?` :100
· `escalator?` :106 · `thinking?` :108 · `extensions?` :110 · `nodeTimeoutMs?` :112 · `stallMs?` :114
· `killGraceMs?` :116 · `maxConcurrent?` :124 · `maxNodesPerRun?` :131 · `returnProtocol?` :139 ·
`from?` :141 · `until?` :143 · `noResume?` :151 · `profile?` :158 · `validateSchema?` :163 ·
`mcpConfig?` :171 · `secretResolver?` :178 · `cloudSecrets?` :189 · `recordEvents?` :196 · `onEvent?`
:201 · `checkpointReply?` :209 · `checkpointWait?` :217.

**Watchdog defaults** (`runner.ts:365-369`): `nodeTimeoutMs ?? 1_800_000` · `stallMs ?? 0` ·
`killGraceMs ?? 3000`. **Default plug-ins:** `buildCommand ?? defaultPiCommand` (`runner.ts:326`),
`execRunner ?? defaultExecRunner` (`runner.ts:327`), `providerName ?? 'cp'` (`runner.ts:328`).

---

## Resume / journal (cross-cutting, supports §1/§8/§10)

| Capability | Where wired (file:line) | What it controls | Classification |
|---|---|---|---|
| Journal-based resume | `runner/journal.ts:210` (`decideResume`), `runner/resume.ts:90` (`seedFromJournal`) | Reuse a node whose envelope hash + every consumed-input content hash match; re-run a changed node + DAG descendants | **AGNOSTIC** |
| `--from`/`--until` window | `runner/window.ts` (`selectWindow`), `runner.ts:141-143` | Manual resume-window override layered on the journal | **AGNOSTIC** |
| Retry FSM | `runner/retry.ts:26` (`runNodeWithRetries`) | Bounded retry-by-failure-class + escalate-with-evidence | **AGNOSTIC** |
| Failure classifier | `checks.ts:203` (`classifyFailure`), `:228` (`consultPreamble`), `:166` (`FailureSignals`) | Empirical class from artifact-stat/schema/checks/watchdog/stderr/return-parse (never a model self-score) | **AGNOSTIC** |
</content>
</invoke>
