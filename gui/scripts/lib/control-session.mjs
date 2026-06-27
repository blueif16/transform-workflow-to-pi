// The CONTROL-SESSION host — the dev-server-scoped runtime that holds one interactive `pi` per run and
// frames its stdio. Shared by the Vite plugin (gui/vite.config.ts control endpoints) and its test, so the
// load-bearing FRAMING contract is unit-testable without spawning. The plugin owns HTTP (route match, run
// resolution, SSE/POST courier); THIS owns the two load-bearing decisions: how we spawn the control pi, and
// how stdin/stdout bytes become / leave discrete JSON frames.
//
// TRANSPORT (evidence-verified, docs/design/control-session-streaming-evidence.md): pi's NATIVE `--mode rpc`
// over child stdio — NOT a custom `-e` extension. pi --mode rpc streams the FULL agent event firehose to
// stdout AND accepts JSON commands on stdin. This is SEPARATE from piflow's DAG nodes (which use `--mode
// json`); do NOT reuse the node command builder here.
//
// FRAMING: strict newline-delimited JSONL — split on `\n` ONLY and carry the trailing partial line across
// chunks. NEVER Node `readline` (it also splits on U+2028/U+2029, which is not protocol-compliant — the
// evidence calls this out). Each complete line is one JSON frame. Commands go out one JSON object per
// `\n`-terminated line.

import { spawn } from "node:child_process";

// ----------------------------------------------------------------------------------------------------
// PURE helpers (no child, no I/O) — the framing/serialization contract the test pins.
// ----------------------------------------------------------------------------------------------------

/**
 * Strict `\n`-JSONL parse of one stdout chunk against the carried-over partial line.
 * Returns `{ frames, rest }`:
 *  - `frames`: every COMPLETE line (terminated by `\n`) parsed as JSON, in order. A blank line is skipped;
 *    a line that fails to parse is dropped (the bridge is a relay, not a validator — a single malformed
 *    line must not poison the stream).
 *  - `rest`: the trailing partial line (no terminating `\n` yet) to prepend to the NEXT chunk. A JSON
 *    object split across two `data` events therefore reassembles intact — the whole point of carry-partial.
 * `buffer` is the prior call's `rest` (start with ""); `chunk` is the new bytes as a string.
 */
export function parseJsonlChunk(buffer, chunk) {
  let buf = buffer + chunk;
  const frames = [];
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).replace(/\r$/, ""); // tolerate CRLF; pi emits LF
    buf = buf.slice(i + 1);
    if (!line.trim()) continue; // skip blank/keepalive lines
    try {
      frames.push(JSON.parse(line));
    } catch {
      /* drop a single unparseable line — never throw on the relay path */
    }
  }
  return { frames, rest: buf };
}

/** Serialize one command object to the EXACT bytes written to the child's stdin: one JSON object,
 *  newline-terminated, no embedded newline (JSON.stringify escapes any newline inside string values). */
export function serializeCommand(obj) {
  return JSON.stringify(obj) + "\n";
}

// ----------------------------------------------------------------------------------------------------
// The session registry — one control pi per run, for the dev server's lifetime.
// ----------------------------------------------------------------------------------------------------

/** @typedef {{ v: number; type: string; [k: string]: unknown }} Frame */
/** @typedef {{
 *   run: string; runDir: string; child: import("node:child_process").ChildProcess;
 *   subscribers: Set<(frame: object) => void>; alive: boolean;
 * }} Session */

// Module-scoped: the Vite dev server is one process, so this Map is the live session table. Keyed by run id.
/** @type {Map<string, Session>} */
const sessions = new Map();

/** The snapshot-on-(re)connect commands — replayed to the child whenever a new client subscribes so a late
 *  joiner re-bases from current state, then rides the live deltas. Matches the evidence's snapshot recipe. */
const SNAPSHOT_COMMANDS = [
  { type: "get_state" },
  { type: "get_messages" },
  { type: "get_session_stats" },
];

/** True iff a control session for `run` exists and its child is still alive. */
export function hasSession(run) {
  const s = sessions.get(run);
  return !!s && s.alive;
}

/**
 * Spawn (or reuse) the control pi for a run. cwd = the run folder; provider/model are INHERITED from the
 * user's pi config (~/.pi/agent/settings.json) — we deliberately omit --provider/--model so we never pin the
 * evidence's test gateway. Returns a small handle the start endpoint echoes. Idempotent: a second call for a
 * live run returns the existing handle (the registry holds ONE pi per run).
 */
export function startSession(run, runDir) {
  const existing = sessions.get(run);
  if (existing && existing.alive) return { run, pid: existing.child.pid, reused: true };

  // `pi --mode rpc` ONLY — no -p, no --mode json, no --provider/--model (inherit settings). Owning the
  // child's stdio is the whole transport. `--name` tags the session so it's identifiable on disk/in logs.
  const child = spawn("pi", ["--mode", "rpc", "--name", `control-${run}`], {
    cwd: runDir,
    stdio: ["pipe", "pipe", "pipe"],
  });

  /** @type {Session} */
  const session = { run, runDir, child, subscribers: new Set(), alive: true };
  sessions.set(run, session);

  // DOWN-channel: stdout → strict `\n`-JSONL → fan each frame out to every subscriber. The partial-line
  // carry lives in `rest` across chunks (carry-partial — NOT readline).
  let rest = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const out = parseJsonlChunk(rest, chunk);
    rest = out.rest;
    for (const frame of out.frames) emit(session, frame);
  });

  // stderr is pi's diagnostics, not protocol — relay it as a generic frame so the GUI log can surface a
  // spawn/auth error instead of silently showing nothing.
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) emit(session, { v: 1, type: "stderr", text });
  });

  const teardown = (reason) => {
    if (!session.alive) return;
    session.alive = false;
    emit(session, { v: 1, type: "session_closed", reason });
    sessions.delete(run);
  };
  child.on("exit", (code, signal) => teardown(`exit code=${code} signal=${signal}`));
  child.on("error", (err) => teardown(`spawn error: ${String(err)}`));

  return { run, pid: child.pid, reused: false };
}

/** Forward a frame to every subscriber (best-effort; a throwing/closed subscriber must not break the fan-out
 *  to the others, nor block the agent). */
function emit(session, frame) {
  for (const cb of session.subscribers) {
    try {
      cb(frame);
    } catch {
      /* a slow/closed SSE peer must not poison the stream */
    }
  }
}

/**
 * Subscribe a callback to a session's frames. On subscribe we (re)trigger the snapshot so THIS client
 * re-bases — the child re-answers get_state/get_messages/get_session_stats and those `response` frames flow
 * back through `cb`. Returns an unsubscribe fn (also exported standalone as `unsubscribe`). Throws if no live
 * session — the caller (the stream endpoint) must `startSession` first.
 */
export function subscribe(run, cb) {
  const session = sessions.get(run);
  if (!session || !session.alive) throw new Error(`no live control session for run "${run}"`);
  session.subscribers.add(cb);
  // snapshot-on-connect: ask the child to re-emit current state for the new peer.
  for (const cmd of SNAPSHOT_COMMANDS) writeCommand(session, cmd);
  return () => unsubscribe(run, cb);
}

/** Remove a subscriber. Safe to call after teardown (no-op). */
export function unsubscribe(run, cb) {
  const session = sessions.get(run);
  if (session) session.subscribers.delete(cb);
}

/**
 * Send one command to the control pi's stdin. `obj` is a raw RPC command object (e.g. `{type:"prompt",
 * message}`); it's serialized to exactly one `\n`-terminated line. Returns `{ ok, status, body }` mirroring
 * the HTTP response the message endpoint sends, so the courier stays a dumb relay. We do NO semantic
 * validation of the verb — pi is the authority and answers each `id`-carrying command with a `response`
 * frame on the down-channel.
 */
export function sendCommand(run, obj) {
  const session = sessions.get(run);
  if (!session || !session.alive) return { ok: false, status: 404, body: { error: `no live control session for run "${run}"` } };
  if (!obj || typeof obj !== "object" || typeof obj.type !== "string")
    return { ok: false, status: 400, body: { error: "command must be an object with a string `type`" } };
  const wrote = writeCommand(session, obj);
  if (!wrote) return { ok: false, status: 502, body: { error: "control pi stdin is not writable" } };
  return { ok: true, status: 202, body: { ok: true } };
}

/** Low-level stdin write (one `\n`-terminated line). Returns false if stdin is gone. */
function writeCommand(session, obj) {
  const stdin = session.child.stdin;
  if (!stdin || !stdin.writable) return false;
  try {
    stdin.write(serializeCommand(obj));
    return true;
  } catch {
    return false;
  }
}

/** Stop a session: end stdin, kill the child's process group, drop it from the registry. Idempotent. */
export function stopSession(run) {
  const session = sessions.get(run);
  if (!session) return { ok: true, status: 200, body: { ok: true, already: true } };
  session.alive = false;
  try { session.child.stdin?.end(); } catch { /* already closed */ }
  try { session.child.kill(); } catch { /* already dead */ }
  sessions.delete(run);
  return { ok: true, status: 200, body: { ok: true } };
}
