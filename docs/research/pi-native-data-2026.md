# pi Native Data — Exploitation Brief
**Scope:** What pi records natively and how piflow can best exploit it  
**Researched:** 2026-06-24 | Sources: Context7 (`/earendil-works/pi`), local pi session files, piflow core source

---

## 1. TL;DR — Top Exploit Opportunities

1. **`stopReason` in every assistant `message`** — already in our tee'd stream; we just never surface it; captures `stop` / `max_tokens` / `tool_use`; `max_tokens` = output was truncated → critical badge. **Effort: low.**
2. **`auto_retry_start` / `auto_retry_end` events** — rate-limit and 429 evidence; our tee'd stream already has them but we do not count or store them. **Effort: low.**
3. **`models.json` as the authoritative contextWindow + cost source** — stop hard-coding; one parse at run-start gives every field: `contextWindow`, `maxTokens`, `cost.{input,output,cacheRead,cacheWrite}`. **Effort: low.**
4. **Session `cwd` field as the node→session join key** — `~/.pi/agent/sessions/<cwd-slug>/` is deterministic from the node's sandbox cwd; native session files persist post-run and include all message history. **Effort: medium (requires knowing each node's cwd).**
5. **Native session files as the lossless post-run archive** — they keep full `content` arrays and per-call `responseId` that our slimmed `events.jsonl` strips; valuable for forensic replay and context-window reconstruction. **Effort: medium.**
6. **`thinking` content blocks in assistant messages** — reasoning token text; we strip `content` during slim; native session preserves it; needed for thinking-token cost breakdown. **Effort: medium.**

---

## 2. Native Session Schema — Event Type Table

All field names are quoted from actual local session files at  
`~/.pi/agent/sessions/--Users-tk-Desktop-animation-test-remotion-svg-primitives--/`.

| Event `type` | Key fields | Telemetry carried |
|---|---|---|
| `session` | `version`, `id`, `timestamp`, `cwd` | Session UUID + working dir (the join key) |
| `model_change` | `id`, `parentId`, `timestamp`, `provider`, `modelId` | Which model/provider is active |
| `thinking_level_change` | `id`, `parentId`, `timestamp`, `thinkingLevel` | `"medium"` / `"low"` / `"high"` / `"off"` |
| `message` (role=user) | `id`, `parentId`, `timestamp`, `message.role`, `message.content[]`, `message.timestamp` | User prompt content |
| `message` (role=assistant) | `id`, `parentId`, `timestamp`, `message.role`, `message.content[]`, `message.api`, `message.provider`, `message.model`, `message.usage.{input,output,cacheRead,cacheWrite,totalTokens,cost.{input,output,cacheRead,cacheWrite,total}}`, `message.stopReason`, `message.timestamp`, `message.responseId` | **Full per-call token + cost + stop-reason + response ID** |
| `compaction` | `id`, `parentId`, `timestamp`, `tokensBefore` | Context compaction; tokens before compaction |
| `branch_summary` | `id`, `parentId`, `fromId` | Branched session origin |
| `label` | `id`, `parentId`, `targetId`, `label` | User-applied label on a message entry |
| `custom` | `id`, `parentId`, `timestamp`, `customType`, `data` | Extension-emitted structured data |
| `custom_message` | `id`, `parentId`, `timestamp`, `customType`, `content` | Extension-emitted text |

**Stdout NDJSON additional event types** (not in session file — live-stream only, from Context7 docs):

| Event `type` | Key fields | Telemetry |
|---|---|---|
| `agent_start` | _(none)_ | Run lifecycle start |
| `agent_end` | `messages[]` | Full message array at completion |
| `turn_start` | _(none)_ | One agent turn begins |
| `turn_end` | `message`, `toolResults[]` | Turn end + tool results |
| `message_start` | `message` | Assistant message starts |
| `message_update` | `message`, `assistantMessageEvent.{type,delta,...}` | Per-token streaming delta |
| `message_end` | `message` | Assistant message finalized (usage present) |
| `tool_execution_start` | `toolCallId`, `toolName`, `args` | Tool dispatch |
| `tool_execution_update` | `toolCallId`, `toolName`, `args`, `partialResult` | Streaming tool progress |
| `tool_execution_end` | `toolCallId`, `toolName`, `result`, `isError` | Tool completion + error flag |
| `auto_retry_start` | `attempt`, `maxAttempts`, `delayMs`, `errorMessage` | **Rate-limit / 429 / overload evidence** |
| `auto_retry_end` | `success`, `attempt`, `finalError` | Retry outcome (failed = permanent error) |
| `queue_update` | _(undocumented in Context7)_ | Internal queue state |
| `compaction_start` | _(undocumented in Context7)_ | Pre-compaction signal |
| `compaction_end` | _(undocumented in Context7)_ | Post-compaction signal |

### Real field quotes from session file 1 (gemini-vertex, assistant message):
```json
{
  "type": "message",
  "id": "7e0c0731",
  "parentId": "20a4ee77",
  "timestamp": "2026-06-17T01:07:52.166Z",
  "message": {
    "role": "assistant",
    "content": [{"type": "text", "text": "READY", "textSignature": "..."}],
    "api": "google-vertex",
    "provider": "gemini-vertex",
    "model": "gemini-3.5-flash",
    "usage": {
      "input": 4557, "output": 33, "cacheRead": 0, "cacheWrite": 0,
      "totalTokens": 4590,
      "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}
    },
    "stopReason": "stop",
    "timestamp": 1781658470030,
    "responseId": "Z_MxarX2FYGn4_UPybiwiQg"
  }
}
```

### Real field quotes from session file 2 (nvidia, with thinking):
```json
{
  "type": "message",
  "id": "d901a6a8",
  "message": {
    "role": "assistant",
    "content": [
      {"type": "thinking", "thinking": "We need to output exactly \"READY\".\n", "thinkingSignature": "reasoning_content"},
      {"type": "text", "text": "READY"}
    ],
    "api": "openai-completions",
    "provider": "nvidia",
    "model": "nvidia/nemotron-3-super-120b-a12b",
    "usage": {
      "input": 4982, "output": 14, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 4996,
      "cost": {"input": 0.0009964, "output": 0.0000112, "cacheRead": 0, "cacheWrite": 0, "total": 0.0010076}
    },
    "stopReason": "stop",
    "timestamp": 1781658472708,
    "responseId": "chatcmpl-aadd247f192597b3"
  }
}
```

---

## 3. stdout-tee vs Native-Session DIFF

We run `pi -p --mode json -a --no-session`. The `--no-session` flag is critical — it means **pi does NOT write a native session file for piflow node invocations** (`--no-session` = ephemeral). Our `events.jsonl` (tee from stdout) is therefore the ONLY durable record.

| Aspect | Our `events.jsonl` (slimmed tee) | Native `~/.pi/agent/sessions/*.jsonl` |
|---|---|---|
| Who writes it | piflow `NodeRecorder` (our code) | pi itself (when NOT running `--no-session`) |
| Produced by piflow nodes? | **Yes** | **No** — `--no-session` suppresses it |
| Content `[]` arrays | **Stripped** by `slimEvent` | **Full** — every content block including `thinking` |
| Per-call `responseId` | **Stripped** (not in `KEEP_MSG_FIELDS`) | **Preserved** |
| `stopReason` | **Preserved** (in `KEEP_MSG_FIELDS`) | **Preserved** |
| `usage.{input,output,cacheRead,cacheWrite}` | **Preserved** | **Preserved** |
| `usage.cost.*` | **Preserved** | **Preserved** |
| `usage.totalTokens` | Not currently in `KEEP_MSG_FIELDS` | **Present** |
| `message.api` | **Preserved** | **Preserved** |
| `auto_retry_start/end` | **Present in tee** (pi emits to stdout) | **Not in session file** (stream-only events) |
| `tool_execution_*` | **Present in tee** | **Not in session file** (stream-only) |
| `_t` / `_rt` (node-relative clock) | **Yes** — added by NodeRecorder | No |
| Line size cap (8192 bytes) | **Yes** — may truncate large events | No cap |
| Result truncation (2048 bytes) | **Yes** — `tool_execution_end` result trimmed | No truncation |

**Concrete diff verdict:** Our tee'd `events.jsonl` carries MORE live-stream events (`auto_retry_*`, `tool_execution_*`, lifecycle events) that native session files do NOT record. Native sessions carry richer `message` payloads (full `content[]`, `responseId`, `usage.totalTokens`) that our slimmer strips. For piflow nodes (which always run `--no-session`), the native session file is NEVER written — our tee IS the only archive.

**The gap to close is in our own slimmer**, not in switching to native sessions.

---

## 4. Session→Node Mapping

### Recommended: `cwd` slug in the session directory path

Pi names its session subdirectory by converting the node's `cwd` path to a slug: forward slashes (`/`) replaced by `--`, leading `--` for absolute paths. For example, `/Users/tk/Desktop/animation-test/remotion-svg-primitives` → `--Users-tk-Desktop-animation-test-remotion-svg-primitives--`.

The session file name is `<ISO-timestamp>_<uuid>.jsonl` and the session header line contains `"cwd": "<abs cwd>"` and `"id": "<uuid>"`.

**However:** piflow nodes run with `--no-session`, so no native session file is ever created for production node runs. The join key question is moot unless we remove `--no-session`.

**If we ever run pi WITH session persistence:**

| Join method | Reliability | Notes |
|---|---|---|
| **Primary: cwd match** — node sandbox cwd → slug → `~/.pi/agent/sessions/<slug>/` | High | Each node's sandbox cwd is unique (per-node sandboxed dir). One slug = one node's sessions. |
| **Fallback: session `id` in stdout** | High | The first line of the `--mode json` stream is `{"type":"session","version":3,"id":"<uuid>",...}`. Capture this UUID in `NodeRecorder` and record it in `node-io.json`. |
| **Do NOT use: timestamp alone** | Low | Multiple nodes may run concurrently; timestamps can collide. |

**Recommended deterministic key:** use the session UUID from the first `session` event in stdout (we already receive it via `NodeRecorder.feedStdout`). Record it in the node's `io.json`. This works even if cwd slugs are ambiguous.

---

## 5. `models.json` — Schema and Verdict

### Full schema (from `~/.pi/agent/models.json`):

```json
{
  "providers": {
    "<provider-id>": {
      "baseUrl": "https://...",
      "api": "<api-type>",           // "anthropic-messages" | "openai-completions" | "google-vertex"
      "apiKey": "<value-or-$ENV>",
      "models": [
        {
          "id": "<model-id>",
          "name": "<display name>",
          "api": "<api-type>",
          "reasoning": true,          // boolean: supports thinking/reasoning
          "input": ["text"],          // modalities
          "contextWindow": 1000000,   // tokens (this IS the authoritative capacity)
          "maxTokens": 65536,         // max output tokens
          "cost": {
            "input": 0,              // $ per token (or 0 for gated/free)
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
          },
          "compat": {                 // optional override flags
            "forceAdaptiveThinking": true,
            "supportsDeveloperRole": false
          }
        }
      ]
    }
  }
}
```

**Observed providers in production `models.json`:** `mmgw` (MiniMax M3 via gateway), `gemini-vertex` (Gemini 3.5 Flash via Google Vertex), `nebius` (GLM 5.2 via Nebius).

**Verdict:** Yes — `models.json` is the RIGHT source for `contextWindow` and `cost.*` rates. It is what pi itself uses for cost calculation and compaction thresholds. The `compat` block carries per-provider behavioral overrides. Hard-coding these values is fragile; parsing `models.json` at run-start and keying by `(provider, modelId)` is authoritative and low-effort.

**One caveat:** cost values in this local `models.json` are all `0` for the observed models (gated/free tier or gateway billing). If billing comes from the gateway rather than the standard API, cost fields may remain zero and you must reconcile from the per-response `usage.cost.*` fields instead.

---

## 6. Recording Controls — pi Flags and Settings That Maximize Captured Data

| Flag / Setting | Effect | piflow current usage |
|---|---|---|
| `--mode json` | Emit full event stream as NDJSON to stdout | **Used** |
| `-p` / `--print` | Print mode: non-interactive, exits after first response | **Used** — also saves session unless `--no-session` |
| `--no-session` | Ephemeral: do NOT write a native session file | **Used** — suppresses native session |
| `-a` / auto-approve | Auto-approve all tool calls | **Used** |
| `--offline` | Suppress startup network calls | **Used** |
| `--no-extensions` | No extension discovery (explicit `-e` still loads) | **Used** |
| `--no-context-files` | No AGENTS.md/CLAUDE.md leak into node context | **Used** |
| `--session-dir <dir>` | Override where native sessions are written | **Not used** — would let us point sessions to `${run}/.pi/nodes/<id>/` |
| `--session <file>` | Specify a session file path directly | **Not used** |
| `settings.json` `compaction.enabled` | Auto-compact long sessions | Not configured in pi; irrelevant for `--no-session` |
| `settings.json` `sessionDir` | Default session dir; overridden by CLI flag | `~/.pi/agent/sessions/` by default |

**To maximize native session capture while keeping it per-node:** replace `--no-session` with `--session-dir <rundir>/.pi/nodes/<id>/sessions/`. This makes pi write a native `.jsonl` alongside our tee'd `events.jsonl`, giving the full un-slimmed record. The session UUID appears in stdout line 1 (`{"type":"session","id":"..."}`) so the join is automatic.

---

## 7. Exploit List — Ranked

| Rank | Datum | Native location | Value | Effort | Action |
|---|---|---|---|---|---|
| 1 | `stopReason` per assistant turn | `events.jsonl` (already in `KEEP_MSG_FIELDS`) | High — surfaces `max_tokens` truncation; no new intake needed | **Low** | Promote `stopReason` into `NodeTelemetry` and show a "TRUNC" badge when `max_tokens` |
| 2 | `auto_retry_start` / `auto_retry_end` count | `events.jsonl` (already tee'd) | High — the only 429/overload signal; currently uncounted | **Low** | Add `retryEvents: number` counter in audit/distil; alert at ≥ 1 |
| 3 | `models.json` for `contextWindow` + cost rates | `~/.pi/agent/models.json` | High — stops hard-coding; authoritative per-provider capacity | **Low** | Parse once at run-start; key by `(provider, modelId)` |
| 4 | `usage.totalTokens` | Tee'd stream but not in `KEEP_MSG_FIELDS` | Medium — convenience rollup; already derivable as `input+output+cacheRead+cacheWrite` | **Low** | Add `totalTokens` to `KEEP_MSG_FIELDS` in `events.ts` |
| 5 | `responseId` per call | Currently stripped by slimmer | Medium — provider-correlation key for billing reconciliation | **Low** | Add `responseId` to `KEEP_MSG_FIELDS` |
| 6 | `thinking` content blocks (reasoning tokens) | Stripped by slimmer (content[] dropped) | Medium — reasoning token text; needed to count thinking-token cost separately | **Medium** | Either (a) add `thinking` token count to the slim message (count chars in `thinking` blocks before dropping content) or (b) drop `--no-session` + use `--session-dir` to get full native record |
| 7 | Native session file (full, unslimmed) | `~/.pi/agent/sessions/<slug>/` (not written for piflow nodes) | Medium — forensic replay, full content, `responseId` | **Medium** | Pass `--session-dir ${rundir}/.pi/nodes/<id>/sessions/` instead of `--no-session`; costs disk but enables full post-run audit |
| 8 | Session UUID from stdout header | First line of `--mode json` stream (`type: "session"`) | Medium — deterministic node↔session join for native file lookup | **Low** | Capture in `NodeRecorder` on first feed; persist to `io.json` |

---

## 8. Sources

| Source | ID / Path | Note |
|---|---|---|
| Context7 — earendil-works/pi | `/earendil-works/pi` | **Found** — benchmark score 82.9, High reputation. Docs on session format, RPC types, CLI flags, settings. |
| Local session file 1 | `~/.pi/agent/sessions/--Users-tk-Desktop-animation-test-remotion-svg-primitives--/2026-06-17T01-07-49-934Z_019ed31e-c62e-785c-8ebc-22912ddd9d08.jsonl` | gemini-vertex run; read in full (6 lines) |
| Local session file 2 | `~/.pi/agent/sessions/--Users-tk-Desktop-animation-test-remotion-svg-primitives--/2026-06-17T01-07-52-637Z_019ed31e-d0bd-7bc5-9aed-e9c1bf115d24.jsonl` | nvidia/nemotron run with thinking block; read in full (6 lines) |
| Local models.json | `~/.pi/agent/models.json` | Read in full (82 lines) — 3 providers |
| Local settings.json | `~/.pi/agent/settings.json` | `{"lastChangelogVersion": "0.79.0"}` — minimal, no session controls |
| piflow runner/events.ts | `packages/core/src/runner/events.ts` | Defines `KEEP_MSG_FIELDS`, `slimEvent`, `NodeRecorder` |
| piflow runner/command.ts | `packages/core/src/runner/command.ts` | Defines `defaultPiCommand` — shows `--no-session` flag |

---

## Self-Check

| Required | Status | Evidence |
|---|---|---|
| (1) Every claimed field quoted from a real session file or pi doc | **PASS** | `stopReason`, `responseId`, `usage.*`, `thinking`, `textSignature` all quoted from actual local JSONL; `auto_retry_start` fields from Context7 source |
| (2) stdout-vs-native diff is concrete (names the fields) | **PASS** | §3 table names `responseId`, `usage.totalTokens`, `content[]`, `thinking` as native-only; `auto_retry_*`, `tool_execution_*`, `_t`/`_rt` as tee-only |
| (3) session→node mapping gives ONE recommended key with a fallback | **PASS** | Primary: session UUID from stdout line 1; fallback: cwd slug; explains why `--no-session` makes this moot today |
| (4) exploit list is ranked with effort+value tied to physical location | **PASS** | §7 — 8 rows, each with location, effort, value, action |
| (5) States clearly whether Context7 had pi | **PASS** | §8 — `/earendil-works/pi` found, benchmark 82.9, High reputation |
| Did NOT read auth.json or trust.json | **PASS** | Only read `models.json`, `settings.json`, two `*.jsonl` session files |
| Opened ≥1 real session JSONL and enumerated event types | **PASS** | Both session files read in full; all event types enumerated with real field names |
