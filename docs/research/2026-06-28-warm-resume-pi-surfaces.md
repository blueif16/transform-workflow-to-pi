# Warm-resume — pi surfaces & wiring (research)

> **Status:** RESEARCH (2026-06-28). No code edits. Grounded on the **installed** `pi` (`pi --version` →
> **0.79.10**, `/Users/tk/.nvm/versions/node/v24.1.0/bin/pi` → `…/@earendil-works/pi-coding-agent/dist/cli.js`,
> `package.json` `"version": "0.79.10"`), its `pi --help`, the in-repo control-session reference + evidence
> docs, and the **0.80.2 reference package docs** under `/tmp/piapi/earendil-works-pi-coding-agent-0.80.2/package/`
> (`docs/json.md`, `docs/session-format.md`, `docs/sessions.md` — `[doc-derived]`, not run). An installed pi WAS
> found; nothing here is memory-only. The one surface still needing a live run is flagged §5.

---

## 0. Verdict

**Warm-resume is achievable on the node's existing `--mode json` path with confirmed pi surfaces — no mode
change, no second transport.** The blocker the old `TODO[warm-resume]` note assumed ("there is no
`--resume`/`--session`/rpc on this branch") is **false for 0.79.10**: `pi --help` lists `--session <path|id>`,
`--session-id <id>`, `--session-dir <dir>`, and `--name`, and `docs/json.md` confirms the `--mode json` stream's
**first stdout line is the session header `{"type":"session","version":3,"id":"uuid","timestamp":…,"cwd":…}`** —
so the producer's session id is already on the stream the runner buffers (`result.stdout`), and pi's own JSONL
session file persists under a `--session-dir` we pass. Warm-resume is therefore: (1) on attempt 1 drop
`--no-session`, add `--session-dir <dir>`, capture the `type:"session"` id from stdout; (2) on the retry, keep
`--mode json` but add `--session <id>` and deliver ONLY the feedback as the prompt (not the original
`@promptFile` re-run). The ONE thing static reading can't settle (→ §5) is whether `pi -p --mode json --session
<id> @feedbackFile` **appends** the new turn to the resumed tree and exits non-interactively (the docs show `-p`
and `--session` each alone, never combined). If that fails, the mode-compatible fallback is unchanged: keep the
current cold feedback-prefix path (today's SA-D behavior) — no rpc channel is needed for the node lane.

---

## 1. pi session surface (ground-truthed)

All `pi --help` rows are CONFIRMED against the **installed 0.79.10** binary (captured this session). Doc rows
are CONFIRMED-by-doc from the 0.80.2 reference package (the evidence doc §6 notes 0.80.2 docs matched every
0.79.10 frame captured at runtime, but pin a version before shipping — §5).

| Surface | What it does | CONFIRMED / ASSUMED | Source |
|---|---|---|---|
| `--mode <text\|json\|rpc>` | Output mode. `json` = per-line JSON event stream to stdout (the DAG-node mode). `rpc` = full event firehose + stdin command channel (control-session mode). | CONFIRMED | installed `pi --help` ("Output mode: text (default), json, or rpc"); `command.ts:71` uses `--mode json` |
| **`--mode json` first stdout line = session header** | The stream's **first line is `{"type":"session","version":3,"id":"<uuid>","timestamp":…,"cwd":…}`**, then `agent_start`/`turn_*`/`message_*`/`agent_end`. **This is where the runner can read the session id without rpc.** | CONFIRMED (doc) | `0.80.2 docs/json.md` §"Output Format": *"The first line is the session header: `{"type":"session","version":3,"id":"uuid",…}`"* |
| `--session-dir <dir>` | Directory for session storage AND lookup (overrides `PI_CODING_AGENT_SESSION_DIR`). Where the `.jsonl` is written and where `--session <id>` resolves. | CONFIRMED | installed `pi --help`; control-session uses it (`control-session.mjs:165`) |
| `--session <path|id>` | Resume a specific session file or **partial UUID**. | CONFIRMED | installed `pi --help` ("Use specific session file or partial UUID"); control-session dead-pi resume (`control-session.mjs:166`) |
| `--session-id <id>` | Use an **exact** project session id, **creating it if missing**. (Lets the *caller* choose the id up front instead of reading it back off stdout.) | CONFIRMED | installed `pi --help` ("Use exact project session ID, creating it if missing") |
| `--no-session` | Ephemeral — don't save a session. **Mutually exclusive with warm-resume** (nothing to resume). Currently always set: `command.ts:71`. | CONFIRMED | installed `pi --help`; `command.ts:71` |
| `--continue, -c` / `--resume, -r` | Continue most-recent / interactive picker. **`-r` is interactive (a TUI picker) → NOT usable headless**; `-c` resumes *most recent for cwd*, too coarse for a per-node id. Use `--session <id>` instead. | CONFIRMED | installed `pi --help`; `0.80.2 docs/sessions.md` ("`-r` opens the same picker at startup") |
| `--fork <path|id>` | Fork a session into a NEW file (branching). Not needed for in-place warm-resume; relevant only if a retry must branch rather than extend. | CONFIRMED | installed `pi --help`; `docs/session-format.md` (parentSession header) |
| `--name, -n <name>` | Session display name (writes a `session_info` entry). Cosmetic for warm-resume. | CONFIRMED | installed `pi --help` |
| `-p / --print` | Non-interactive: process prompt and exit. Set on every node (`command.ts:71`). **Whether `-p` composes with `--session <id>` to append-and-exit is the one untested combo (§5).** | CONFIRMED (flag); ASSUMED (compose-with-`--session`) | installed `pi --help`; combo untested → §5 |
| `.jsonl` session file format | One JSON object/line; line 1 = `SessionHeader {type:"session",version:3,id,timestamp,cwd[,parentSession]}` (no `id`/`parentId` tree fields); subsequent entries are a tree via `id`/`parentId` (`message`, `model_change`, `thinking_level_change`, `compaction`, `session_info`, …). File path `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl` (relocatable via `--session-dir`). | CONFIRMED (doc) + runtime-corroborated | `0.80.2 docs/session-format.md`; runtime-captured header shape in `control-session.test.mjs:111–115` (`{type:"session",version:3,id,timestamp,cwd}`) |
| `--mode json` event vocabulary | `agent_start/end`, `turn_start/end`, `message_start/update/end` (with `assistantMessageEvent` deltas + `message.usage`), `tool_execution_start/update/end`, `queue_update`, `compaction_*`, `auto_retry_*`. **Events do NOT carry a session id** (only the header line does); **no append-message *event*** — input is via argv/stdin, not an event. | CONFIRMED (doc) | `0.80.2 docs/json.md` §"Event Types"; piflow's own parser keeps only `role/model/provider/api/usage/stopReason` (`events.ts:35`) |
| `switch_session` / `get_session_stats` / `new_session` / `fork` / append-message | **RPC-only commands** (stdin JSON, `--mode rpc`). `get_session_stats.data.sessionId` + `get_state.data.sessionId` surface the id over rpc; `switch_session {sessionPath}` swaps the live conversation. **These are NOT available on `--mode json`** — do not assume them for the node lane. | CONFIRMED | `control-session-streaming-evidence.md` Step 3 (runtime: `get_state…"sessionId":"019f0ade-…"`, `get_session_stats` same); `control-session.mjs:352` (`switch_session`); `0.80.2 docs/rpc.md` per evidence §2 |

**Surface conclusion:** the node lane (`--mode json`) gets the session id from the **header line on stdout** and
resumes via the **`--session <id>` argv flag** — both CONFIRMED. The rpc append/switch commands are a *different
channel* and are NOT needed (and per the locked decision, must NOT be reused) for warm-resume.

---

## 2. control-session reference recipe (reusable vs rpc-specific)

The control-session host is the proven, runtime-verified driver of pi's session primitives. Distilled:

**What it does (the proven recipe):**
- **Spawn** `pi --mode rpc --session-dir <runDir>/.pi-control [--session <id>]`, owning stdio
  (`control-session.mjs:165–170`). `cwd` = the run/work folder (pi has no `--cwd` flag; the launcher sets it —
  evidence §2 Step 1).
- **Session storage** is co-located in a **dedicated subdir** (`.pi-control`, `control-session.mjs:25–26`)
  **specifically to avoid colliding with piflow's own `.pi/` telemetry tree** (`layout.ts:18` `piDir = run/.pi`).
- **Capture the id** over rpc: `get_state` / `get_session_stats` return `data.sessionId` and
  `data.sessionFile` (evidence Step 3); the history list instead **header-parses each `.jsonl`** for
  `{type:"session", id}` (`control-session.mjs:79–113`, `parseSessionHeader`).
- **Resume**: live pi → `switch_session {sessionPath}` rpc (`control-session.mjs:352`); dead pi → respawn with
  `--session <id>` (partial-UUID ok) (`control-session.mjs:166, 362`).
- **Framing**: strict `\n`-JSONL with carry-partial-line; **never `readline`** (`control-session.mjs:42–57`;
  test `control-session.test.mjs:64–81` proves carry-partial is load-bearing).

**Reusable by the runner (node lane):**
- The **`--session-dir` co-location pattern** and the **anti-collision rule** (use a dedicated subdir, NOT
  `.pi/`). For the node lane this argues for e.g. `<runDir>/.pi/nodes/<id>/session/` or a sibling
  `<runDir>/.pi-sessions/<id>/` — never the bare `.pi/` root (see §4d conflict).
- `parseSessionHeader`'s **pure header-parse logic** (`{type:"session"} → id`) is the SAME extraction the
  node lane needs — except the node reads it off **stdout's first line** instead of a file (the file and the
  stdout header carry the same id). The lib lives in `gui/scripts/lib/` (a GUI dev-server artifact) and is
  JS-not-TS; the runner should not import it cross-package (SDK boundary), but it can mirror the ~3-line shape.
- The **`--session <id>` partial-UUID resume** flag — identical flag, just on `--mode json` instead of rpc.

**Rpc-specific — must NOT be copied into the node lane:**
- `--mode rpc` itself, the stdin command channel, and **all rpc verbs** (`prompt`/`steer`/`follow_up`/
  `switch_session`/`new_session`/`get_state`/`get_session_stats`). The streaming spec is explicit:
  *"piflow's DAG nodes run `--mode json`; separate builders, the node path is untouched"*
  (`vite.config.ts:717`; spec `control-session-streaming-spec.md:193–200`). The node lane has no live stdin
  loop — it spawns, streams stdout, exits.
- The dev-server session registry, SSE relay, subscriber fan-out (`control-session.mjs:116–230`) — all
  GUI-runtime infrastructure irrelevant to a one-shot node exec.

---

## 3. runner cold path today (file:line trace + change points)

The retry/feedback flow, exact:

1. **`runNodeWithRetries`** (`runner.ts:851`) reads the gate-authored op action via `actionsFromOp(node.op)`
   (`runner.ts:889`); `l1Active` is set when `retryAction.scope` is `feedback`/`undefined`/`fix`
   (`runner.ts:896`). First attempt: `rec = await runNode(ctx, node, scope)` (`runner.ts:899`).
2. The retry loop (`runner.ts:906–952`): on `error`/`blocked`, classify the captured failure signal
   (`classifyFailure`, `runner.ts:909`); if budget remains and the class is retry-allowed and the **l1Active
   branch** fires:
   **`rec = await runNode(ctx, node, scope, { promptPrefix: consultPreamble(sig) })`** (`runner.ts:929`) — the
   COLD feedback-injected re-invocation. The `TODO[warm-resume]` is `runner.ts:926–928`, the explanatory NOTE
   `runner.ts:869–874`.
3. The **escalation variant** (`runner.ts:934–948`) calls the SAME `runNode` with
   `{ promptPrefix: consultPreamble(sig), model: eff.model, provider: eff.provider }` (`runner.ts:948`).
4. **`runNode`** (`runner.ts:1266`, `over: AttemptOverride` default `{}`): clears prior signals
   (`runner.ts:1272`); binds/resolves tools; stands up the sandbox; resolves+stages the prompt; the
   **prompt-file write** is **`runner.ts:1462`**:
   `await sandbox.writeFile(promptFile, (over.promptPrefix ?? '') + resolvedPrompt + markers)` — i.e. the
   feedback prefix is *prepended to the full original prompt*, a from-scratch re-run.
5. The **command** is built at **`runner.ts:1524`**:
   `ctx.buildCommand(node, resolved, { promptFile, model: effModel, provider: effProvider, extensionFile,
   skillPath }, ctx.commandOpts)` → **`defaultPiCommand`** (`command.ts:68`), which stamps
   `pi -p --mode json -a --no-session --offline --no-extensions --no-context-files --provider … @<promptFile>`.
6. Exec at **`runner.ts:1533`** (`ctx.execRunner(execSandbox, cmd, …)`); `ExecResult` = `{stdout, stderr, code}`
   (`types.ts:516–521`). **`result.stdout` is the full `--mode json` line stream** (which now we know carries the
   `type:"session"` header on line 1) but is consumed ONLY by `lastJsonBlock(result.stdout)` (`runner.ts:1677`)
   for the return handshake, and tee'd to the events archive (`events.ts`, which strips everything but
   telemetry). **No session id is captured anywhere today** (`grep` confirms: the only `sessionId` mentions in
   `runner/*.ts` are the TODO comment itself, `runner.ts:873/927/928`).

**The smallest seam:** the warm-resume change is confined to **`runNodeWithRetries`** (decide warm vs cold and
carry the captured id between attempts), **`runNode`** (capture the id from `result.stdout`; on a resume
attempt, write feedback-only instead of `prefix+full` and pass a resume token to the builder), **the
`AttemptOverride` struct** (`runner.ts:1260`, add a `resumeSessionId`/`sessionDir` field), and **`command.ts`**
(`defaultPiCommand`: drop `--no-session` + add `--session-dir`/`--session` when resuming). No change to the
status ladder, gates, collect, or escalation logic.

---

## 4. warm-resume wiring design (confirmed surfaces only)

### (a) `defaultPiCommand` changes (`command.ts:68`)
- **Add `--session-dir <dir>`** on every node run (so attempt 1's session is persisted and locatable). The dir
  must NOT be `.pi/` (collision, see 4d) — pass a per-node dir, e.g. `<inSandboxNodeStage>/session` (already
  under `_pi/<id>/`, jail-readable by construction) or a run-level `.pi-sessions/<id>/`.
- **Drop `--no-session` when a session dir is in play** (the two are mutually exclusive — §1). Keep `--mode json`
  (unchanged — the header gives the id) and `-p`. This needs CommandContext/PiCommandOptions to carry a
  `sessionDir?` and a `resumeSessionId?` (mirroring how `model`/`provider` already thread through
  `CommandContext`, `command.ts:24–45`).
- **On a resume attempt, add `--session <resumeSessionId>`** (partial-UUID ok — §1). Order is free; place it with
  the other session flags.
- Everything else (`-a --offline --no-extensions --no-context-files --provider --tools …`) is **unchanged** —
  see 4d for the `--no-context-files`/`--offline` interactions (both safe).

### (b) capture the session id on attempt 1, thread it to attempt 2
- **Capture:** in `runNode`, after exec (`runner.ts:1533`), parse the **first `type:"session"` line of
  `result.stdout`** for `.id` (the same shape `parseSessionHeader` reads — `control-session.test.mjs:113`). Store
  it on the returned record (`NodeStatusRecord`) or return it out-of-band. Robustness: scan the first few lines
  (header is line 1 per `docs/json.md`, but tolerate a stray banner) and tolerate absence (→ fall back to cold).
- **Thread:** `runNodeWithRetries` holds the captured id in a local across loop iterations and passes it into the
  retry `runNode` call. The carrier is **a new `AttemptOverride` field** (`runner.ts:1260`), e.g.
  `resumeSessionId?: string` + `sessionDir?: string` — symmetric with the existing `promptPrefix`/`model`/
  `provider` overrides. (`AttemptOverride` is the right struct: it already exists solely to vary one attempt
  from the baseline.) Alternative (cleaner id-lifecycle): use **`--session-id <id>`** with a **runner-minted
  UUID** so attempt 1 *writes to a known id* and the runner never has to read it back off stdout — eliminates the
  capture step entirely. Prefer this if §5's append-on-resume experiment passes, since it removes a stdout-parse
  dependency.

### (c) deliver feedback as an appended message, not a fresh `@promptFile`
- On a resume attempt, the prompt-file write (`runner.ts:1462`) must produce **only the feedback**
  (`consultPreamble(sig)`), NOT `prefix + resolvedPrompt + markers`. The resumed session already holds the
  original prompt + the model's first answer in its tree (`docs/session-format.md` context-building), so re-feeding
  the full prompt would duplicate it. Concretely: when `over.resumeSessionId` is set, write
  `consultPreamble(sig)` (the driver-verified evidence block) as the prompt file and pass it as the single
  `@<file>` message — pi appends it as the next user turn on the resumed leaf. This is exactly decision 5's
  *"append the gate feedback as a new message"* (`build-spec:84–86`).
- Markers (`emitMarkers`, `runner.ts:1460`) are the node-contract block; on a resume they're already in the
  session context from attempt 1, so omit them on the feedback turn (avoid re-injecting).

### (d) interactions / conflicts — every one flagged
- **G4 content-hash journal/resume (`journal.ts`)** — **No conflict, but a NAMING collision to avoid.** G4's
  resume is *between-run* (reuse an unchanged node by envelope+input hash; `journal.ts:1–10`) and writes
  `<run>/.pi/journal.json` (`journal.ts:67`). Warm-resume is *within-run, within-node* (across retry attempts of
  ONE `runNodeWithRetries`). They never overlap in mechanism. **BUT** the pi `--session-dir` must NOT be the
  `<run>/.pi/` tree — that holds `state.json`, `run.json`, `nodes/<id>/events.jsonl`, `journal.json`
  (`layout.ts:18–54`). Dropping pi's `<timestamp>_<uuid>.jsonl` session files into `.pi/` risks confusing the
  observe/journal readers. **Mirror control-session's discipline (`control-session.mjs:21–26`): a dedicated
  subdir.** Also note the journal envelope hashes `op[]` (`journal.ts:53–60`); warm-resume adds no new authoring
  surface, so the envelope hash is unaffected.
- **Sandbox prompt-file mechanism** — **No conflict.** The feedback file is just another file written under
  `_pi/<id>/` and referenced `@<file>` (`runner.ts:1461–1462`, `command.ts:84`). A resume attempt writes a
  smaller file. The session dir, if placed under the node stage, rides into a cloud VM like every other staged
  file; **but** cloud backends (e2b/daytona) run each attempt in a *possibly fresh* sandbox — the session
  `.jsonl` from attempt 1 must survive into attempt 2's sandbox. On **in-place/local** (`IN_PLACE_KINDS`,
  `runner.ts:1559`) the dir persists naturally; on **isolated/cloud** the runner would have to download the
  session dir after attempt 1 and re-stage it before attempt 2 (an extra collect/stage round-trip). **FLAG:
  warm-resume is straightforward on local providers; cloud providers need the session `.jsonl` shuttled between
  attempts — scope the first cut to local, or add a session-dir stage/collect for cloud.**
- **Escalation model/provider override (`runner.ts:948`, M4)** — **Semantic conflict — do NOT warm-resume an
  escalation.** Escalation swaps to a *stronger model/provider*; a session resumed with `--session <id>` carries
  the original model in its tree (`model_change` entries, `docs/session-format.md`) and resuming under a new
  provider mixes providers within one conversation (pi supports `model_change` mid-session, but the escalation's
  intent is a *fresh strong attempt with evidence*, not a continuation). Keep escalation on the **cold**
  feedback-prefix path it uses today (`runner.ts:948`); apply warm-resume ONLY to the same-model L1 retry
  (`runner.ts:929`). This is consistent with decision 5 (L1 = warm-resume) vs the escalate lane being a separate
  cross-family consult.
- **`--no-context-files` / `--offline`** — **No conflict.** `--no-context-files` suppresses AGENTS.md/CLAUDE.md
  discovery (`command.ts:58`); it has nothing to do with session storage and stays on. `--offline` only
  suppresses pi's startup network chatter (`command.ts:56`); session save/resume is local disk I/O, unaffected
  (the control-session ran fine; its spawn doesn't even set `--offline`). Both flags remain.
- **`-a` (auto-approve) / `--no-extensions` / `--tools`** — unchanged; orthogonal to sessions.

---

## 5. Runtime unknowns (each: claim · why unconfirmable statically · the one experiment)

1. **Does `pi -p --mode json --session <id> --session-dir <dir> @feedback.md` APPEND the feedback as a new turn
   on the resumed tree and EXIT?** · The docs show `-p` (print-and-exit) and `--session <id>` (resume) each in
   isolation; `docs/sessions.md` never composes them, and every captured resume in-repo was over `--mode rpc`
   (a long-lived interactive process), not headless `-p`. Whether `-p` + `--session` does append-then-exit (vs
   re-printing history, erroring, or hanging) is unverified. · **Experiment:** run a trivial 2-step cold pair on
   the local zero-cost gateway — `pi -p --mode json --session-dir /tmp/wr "say A"` (capture the header id from
   stdout line 1), then `pi -p --mode json --session-dir /tmp/wr --session <id> "now say B"`; assert the 2nd run
   exits 0, its stdout shows ONE new user turn + assistant "B", and `/tmp/wr/*.jsonl` grew with a `message`
   entry whose `parentId` chains onto the first turn. (One real LLM turn; cheap. NOT a long live session — fits
   the "`--help`/short run OK, no hang risk" bar.)

2. **Is the session id reliably the FIRST stdout line under the full headless flag set
   (`-a --offline --no-extensions --no-context-files --provider cp`)?** · `docs/json.md` states the header is
   line 1, but that example is a bare `pi --mode json "prompt"`; a banner/warning under `--provider cp`/`--offline`
   could precede it, and the doc is 0.80.2 while the binary is 0.79.10. · **Experiment:** in experiment 1's first
   run, dump the raw first 3 stdout lines and confirm `JSON.parse(line).type === "session"` on line 1 (or find
   which line carries it) — settles the parse offset for the capture code.

3. **Does `--session-id <id>` (caller-minted) create-and-write under `--mode json -p` so the runner can skip the
   stdout read-back?** · `pi --help` says "creating it if missing" but gives no headless example; the
   create-if-missing semantics under `-p` + a custom `--session-dir` are unverified. · **Experiment:** `pi -p
   --mode json --session-dir /tmp/wr2 --session-id 11111111-1111-1111-1111-111111111111 "say A"`; assert
   `/tmp/wr2/` contains a `.jsonl` whose header `id` is that exact UUID, then resume it with `--session
   11111111…`. If it works, design 4b's "minted id" variant drops the stdout-parse entirely.

4. **On a cloud/isolated sandbox, does the attempt-1 session `.jsonl` survive into attempt 2?** · Static reading
   shows isolated backends may use a fresh sandbox per `runNode` (`scope.create`, `runner.ts:1376`) and only
   `downloadDir(node.sandbox.output)` is collected back (`runner.ts:1563`) — the session dir, if outside
   `output`, would not round-trip. Can't confirm without the cloud backend's actual per-attempt sandbox
   lifecycle. · **Experiment:** out of scope for a static pass; settle by tracing e2b/daytona `create`/`dispose`
   across two attempts (or simply scope warm-resume to local in the first cut and leave cloud cold).

5. **Version skew 0.79.10 (installed) vs 0.80.2 (docs).** · All session/json surfaces here are doc-derived from
   0.80.2 but the binary is 0.79.10; the evidence doc (§6) warns 0.79.x changed session-replacement semantics
   within the line. · **Experiment:** experiments 1–3 above run on the **installed 0.79.10**, so they ALSO
   settle the skew for the exact surfaces warm-resume uses. Pin a pi version (or feature-detect `--session`)
   before shipping regardless.

---

## Self-check (coverage 1–5)

1. **pi session surface ground-truthed, each CONFIRMED/ASSUMED + source** — **PASS.** §1 table: every row cites
   installed `pi --help`, a `0.80.2 docs/*.md` section, or an in-repo file:line; the load-bearing claim
   (session id on `--mode json` stdout line 1) is CONFIRMED from `docs/json.md` §"Output Format".
2. **control-session resume recipe, reusable vs rpc-specific** — **PASS.** §2 cites `control-session.mjs:25,165,
   166,352` for spawn/dir/resume and separates the rpc verbs (must-not-copy) from the `--session`/`--session-dir`
   + header-parse (reusable).
3. **runner cold path file:line trace + change points** — **PASS.** §3 traces `runner.ts:851→889→896→899→
   906–952→929/948→1266→1462→1524→1533→1677` and names the four change loci (runNodeWithRetries, runNode,
   AttemptOverride@1260, command.ts:68).
4. **warm-resume wiring a–d, each anchored** — **PASS.** §4 (a) `command.ts:68` drop-`--no-session`/add
   `--session-dir`/`--session`; (b) capture from `result.stdout` header + thread via `AttemptOverride`@1260 (or
   minted `--session-id`); (c) feedback-only prompt at `runner.ts:1462`; (d) flags G4 `.pi/` collision
   (`journal.ts:67`/`layout.ts:18`), cloud session-dir shuttle (`runner.ts:1563`), escalation-no-resume
   (`runner.ts:948`), and `--no-context-files`/`--offline` as safe (`command.ts:56–58`).
5. **runtime unknowns, each with the one experiment** — **PASS.** §5 lists 5, headed by the load-bearing
   `-p`+`--session` append-and-exit combo, each with a concrete cheap experiment (no live long session).

**§0 verdict support check:** the verdict rests only on CONFIRMED §1 rows — the `--mode json` header line
(`docs/json.md`), `--session`/`--session-id`/`--session-dir` (`pi --help`), and `--no-session` exclusivity — and
explicitly defers the single ASSUMED-by-composition combo (`-p`+`--session`) to §5. No verdict claim leans on an
unconfirmed flag. All-PASS.
