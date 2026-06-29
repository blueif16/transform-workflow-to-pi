// `piflowctl node <run> <nodeId> --resume [-m "<message>"]` (and `--stop`) — operate on ONE node of an
// existing run.
//
// `--resume` does a CONVERSATIONAL WARM RESUME of the node's stored pi session: piflow persists each
// warm-eligible node's pi session under the RUN dir at `piSessionsDir(runDir)` (= `<runDir>/.pi-sessions`),
// keyed by the node id, and the node's journal entry records `sessionId`/`sessionDir` (commit ecd4df1).
// This command finds that session and re-opens the SAME conversation via pi's native `--session-dir`/
// `--session` flags (mirroring gui/scripts/lib/control-session.mjs's dead-pi resume; NOT its `--mode rpc`
// transport — a node DAG uses `--mode json`). With `-m/--message` it sends one headless message
// (`@<tmpfile>`, the runner's prompt-staging discipline); without one it drops `-p`/`--mode json` for a
// LIVE interactive session.
//
// IMPORTANT — this is a CONVERSATIONAL warm resume of the node's pi session, NOT a full runner-integrated
// re-execution: it does NOT re-stage the node's sandbox/tools/gates or re-run the contract. That heavier,
// runner-driven resume is a follow-up; this command is the thin user surface over the persisted session.
//
// `--stop` STOPS a detached run by signalling its CONTROLLING process group. The runner records the run
// controller's pid into `.pi/run.json` (`controllerPid`) at run start (status.ts), and spawns each node's
// child DETACHED as its own process group (sandbox/worktree.ts:128) — killed via `kill(-pid)`. So `--stop`
// resolves the run dir, reads `controllerPid`, and signals THAT group with the runner's SIGTERM→SIGKILL
// grace (exec-runner's kill semantics). This is a per-RUN stop (group-kill), not per-node: a node's child
// pid is ephemeral and never persisted, but the controller's group reaches the whole tree. A run with NO
// recorded pid (older run, or one that crashed before its first status write) FAILS with an actionable
// message — `--stop` NEVER guesses a pid.

import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { loadJournal as coreLoadJournal, piSessionsDir, piDir, runJsonFile, type Journal, type RunStatus } from '@piflow/core';

/** Shell-quote a single token (paths may contain spaces). Mirrors command.ts `q`. */
function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Inputs to the PURE warm-resume argv builder. Unit-testable WITHOUT spawning pi. */
export interface NodeResumeCommandInput {
  /** The resolved run dir (= `{{RUN}}`). The session lives under `piSessionsDir(runDir)`. */
  runDir: string;
  /** The node id — also the pi session id (warm-resume keys the session by node id). */
  nodeId: string;
  /** In-sandbox path of a staged one-shot message (referenced `@<file>`); omit for an interactive resume. */
  messageFile?: string;
  /** No message ⇒ a LIVE session (drop `-p`/`--mode json`); a message ⇒ headless one-shot. */
  interactive: boolean;
}

/**
 * Build the `pi` command that RESUMES a node's stored session — PURE (no spawn, no fs), so the wiring is
 * unit-tested directly. It addresses the persisted per-node conversation by id under the run's session dir:
 *   - `--session-dir <piSessionsDir(runDir)> --session <nodeId>`  — RESUME (never `--session-id`, which
 *     would CREATE a fresh conversation; warm-resume continues the EXISTING one, command.ts §4a).
 *   - a MESSAGE resume is headless (`-p --mode json -a`) and references the staged message as `@<file>`.
 *   - an INTERACTIVE resume DROPS `-p`/`--mode json` so the user gets a live session (control-session parity).
 * Provider/model are INHERITED from the user's pi config (no `--provider`/`--model`), matching the
 * control-session host — a warm resume must not re-pin a gateway the original run may not have used.
 */
export function buildNodeResumeCommand(input: NodeResumeCommandInput): string {
  const { runDir, nodeId, messageFile, interactive } = input;
  const sessionFlags = ['--session-dir', q(piSessionsDir(runDir)), '--session', q(nodeId)];
  if (interactive) {
    // A LIVE session — no print mode, no json stream. The user drives it.
    return ['pi', ...sessionFlags].join(' ');
  }
  // A headless one-shot message resume: print mode + json event stream + auto-approve, message as @<file>.
  const parts = ['pi', '-p', '--mode', 'json', '-a', ...sessionFlags];
  if (messageFile) parts.push(`@${q(messageFile)}`);
  return parts.join(' ');
}

/** One step of the kill escalation: send `signal` `afterMs` after the stop was issued. */
export interface StopSignalStep {
  signal: 'SIGTERM' | 'SIGKILL';
  /** Delay before this step fires (SIGTERM = 0, SIGKILL = the kill grace, mirroring exec-runner's escalation). */
  afterMs: number;
}

/** The PLAN a `--stop` executes: the pid to signal + the ordered SIGTERM→SIGKILL escalation. */
export type StopAction =
  | { ok: true; pid: number; signalSequence: StopSignalStep[] }
  | { ok: false; reason: string };

/** Inputs to the PURE stop planner. `runState` is the run's `.pi/run.json` digest (it carries the pid). */
export interface BuildStopActionInput {
  runDir: string;
  runState: RunStatus | null;
}

/** ms to wait after SIGTERM before SIGKILL — the same kill grace the exec-runner uses (exec-runner.ts:30). */
export const STOP_KILL_GRACE_MS = 3000;

/**
 * Build the stop PLAN for a run — PURE (no `process.kill`, no fs), so the wiring is unit-tested without
 * killing a real process. It reads the CONTROLLING pid the runner recorded into `.pi/run.json`
 * (`controllerPid`, status.ts) and returns the SIGTERM→SIGKILL escalation to apply to that process group
 * — the SAME grace the runner's watchdog kill uses (exec-runner.ts). When no pid was recorded (an older
 * run, or one that died before its first status write), it returns a NOT-OK plan with an actionable reason
 * — it NEVER guesses a pid. The actual signalling is a thin wrapper around this plan (see `runNodeCli`).
 */
export function buildStopAction(input: BuildStopActionInput): StopAction {
  const pid = input.runState?.controllerPid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return {
      ok: false,
      reason: `no controlling pid is recorded for this run (.pi/run.json carries no controllerPid) — re-run with 'piflowctl run --detach' (which records the pid) to make it stoppable.`,
    };
  }
  return {
    ok: true,
    pid,
    // SIGTERM first (graceful), then SIGKILL after the kill grace — the exec-runner's escalation order.
    signalSequence: [
      { signal: 'SIGTERM', afterMs: 0 },
      { signal: 'SIGKILL', afterMs: STOP_KILL_GRACE_MS },
    ],
  };
}

/** Inputs to `resolveNodeRunDir`. */
export interface ResolveNodeRunInput {
  /** The `<run>` positional — either a direct path to a run dir, OR a run id under `.piflow/<wf>/runs/<id>`. */
  run: string;
  /** Where to anchor an id lookup (default `process.cwd()`). */
  cwd?: string;
}

/**
 * Resolve the `<run>` arg → an existing run dir, REUSING run.ts's `.piflow/<wf>/runs/<id>` convention.
 *   1. A path that is (or contains a `.pi/`) directory ⇒ that dir (resolved absolute).
 *   2. Else treat `run` as a run ID and search every `<cwd>/.piflow/<wf>/runs/<id>` home for a match
 *      (the canonical home run.ts writes into; `out/<id>` is the loose fallback).
 * Throws an actionable error if no run dir is found (naming the run id + where it looked).
 */
export function resolveNodeRunDir(input: ResolveNodeRunInput): string {
  const cwd = input.cwd ?? process.cwd();
  // (1) a direct path to a run dir (it exists OR holds a `.pi/`).
  const asPath = path.resolve(cwd, input.run);
  if (existsSync(piDir(asPath)) || existsSync(asPath)) {
    if (existsSync(piDir(asPath)) || path.isAbsolute(input.run) || input.run.includes(path.sep)) return asPath;
  }
  // (2) a run ID under a canonical home: <cwd>/.piflow/<wf>/runs/<id>.
  const piflowHome = path.join(cwd, '.piflow');
  if (existsSync(piflowHome)) {
    for (const wf of safeReaddir(piflowHome)) {
      const candidate = path.join(piflowHome, wf, 'runs', input.run);
      if (existsSync(piDir(candidate)) || existsSync(candidate)) return candidate;
    }
  }
  // (3) the loose `out/<id>` fallback.
  const outCandidate = path.join(cwd, 'out', input.run);
  if (existsSync(piDir(outCandidate)) || existsSync(outCandidate)) return outCandidate;

  throw new Error(
    `piflowctl node: no run "${input.run}" found — looked for a path, a canonical ${path.join('.piflow', '<wf>', 'runs', input.run)}, and out/${input.run} under ${cwd}.`,
  );
}

/** `readdirSync` that returns [] (never throws) on a missing/unreadable dir. */
function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

/** The injectable seam — defaults are the real fs/core/spawn; a test passes fakes (NO real pi). */
export interface NodeDeps {
  /** Load the run's `.pi/journal.json` (to confirm `nodes.<id>.sessionId`). Default core `loadJournal`. */
  loadJournal?: (runDir: string) => Promise<Journal | null>;
  /** Resolve `<run>` → a run dir. Default `resolveNodeRunDir`. */
  resolveRunDir?: (run: string, cwd?: string) => string;
  /** Spawn the built resume command; returns the child's exit code. Default a real `spawnSync` under a shell. */
  spawnResume?: (cmd: string, runDir: string) => number;
  /** Stage the `-m` message to a temp file and return its path (`@<file>`). Default a real tmp write. */
  writeMessageFile?: (message: string) => Promise<string>;
  /** Read a run's `.pi/run.json` digest (for `--stop`'s recorded pid). Default reads `runJsonFile(runDir)`. */
  loadRunStatus?: (runDir: string) => RunStatus | null;
  /**
   * Signal a process GROUP (the boundary `--stop` mocks under test — NEVER kills a real process there).
   * Default `process.kill(-pid, signal)` (the leading `-` targets the detached group, mirroring
   * sandbox/worktree.ts:141). Returns true if the signal was delivered (false ⇒ already gone / no perms).
   */
  signalProcess?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => boolean;
  /** Sleep `ms` between the SIGTERM and the SIGKILL escalation. Default real `setTimeout`; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  print?: (line: string) => void;
  error?: (line: string) => void;
}

/** The parsed `node` argv. */
export interface ParsedNodeArgs {
  run: string;
  nodeId: string;
  resume: boolean;
  stop: boolean;
  message?: string;
}

/** Parse the flat `node` argv → `{ run, nodeId, resume, stop, message }`. First two positionals = run, nodeId. */
export function parseNodeArgs(argv: string[]): ParsedNodeArgs {
  const out: ParsedNodeArgs = { run: '', nodeId: '', resume: false, stop: false };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--resume') out.resume = true;
    else if (k === '--stop') out.stop = true;
    else if (k === '-m' || k === '--message') out.message = argv[++i];
    else if (!k.startsWith('-')) positionals.push(k);
  }
  out.run = positionals[0] ?? '';
  out.nodeId = positionals[1] ?? '';
  return out;
}

/** The list of node ids that ARE warm-resumable (have a recorded `sessionId`), for the guard's error. */
function resumableNodes(journal: Journal | null): string[] {
  if (!journal) return [];
  return Object.entries(journal.nodes)
    .filter(([, n]) => typeof n.sessionId === 'string' && n.sessionId.length > 0)
    .map(([id]) => id);
}

/**
 * `piflowctl node <run> <nodeId> --resume [-m "<msg>"]` (or `--stop`) — the handler. Returns the process
 * exit code (0 on success). Injectable deps keep it spawn-free under test.
 *
 * --resume: resolve runDir → load the journal → confirm `nodes.<id>.sessionId` exists (else FAIL, naming the
 *           resumable nodes) → build the resume command (PURE) → spawn it. With `-m` the message is staged to
 *           a tmp file and sent headless; without one the resume is interactive (a live session).
 * --stop:   honest not-yet-supported (no per-node PID is recorded by `--detach`) → exit non-zero.
 */
export async function runNodeCli(argv: string[], deps: NodeDeps = {}): Promise<number> {
  const loadJournal = deps.loadJournal ?? coreLoadJournal;
  const resolveRunDir = deps.resolveRunDir ?? ((run: string, cwd?: string) => resolveNodeRunDir({ run, cwd }));
  const spawnResume =
    deps.spawnResume ??
    ((cmd: string, runDir: string) => spawnSync(cmd, { cwd: runDir, stdio: 'inherit', shell: true }).status ?? 1);
  const writeMessageFile =
    deps.writeMessageFile ??
    (async (message: string) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'piflow-node-resume-'));
      const file = path.join(dir, 'message.md');
      await writeFile(file, message);
      return file;
    });
  const loadRunStatus =
    deps.loadRunStatus ??
    ((runDir: string): RunStatus | null => {
      try {
        return JSON.parse(readFileSync(runJsonFile(runDir), 'utf8')) as RunStatus;
      } catch {
        return null;
      }
    });
  const signalProcess =
    deps.signalProcess ??
    ((pid: number, signal: 'SIGTERM' | 'SIGKILL'): boolean => {
      // `-pid` targets the detached process GROUP (the runner spawns each node detached; worktree.ts:141).
      try { process.kill(-pid, signal); return true; } catch { return false; }
    });
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); }));
  const print = deps.print ?? ((s: string) => process.stdout.write(s + '\n'));
  const error = deps.error ?? ((s: string) => process.stderr.write(s + '\n'));

  const parsed = parseNodeArgs(argv);
  if (!parsed.run || !parsed.nodeId) {
    error('piflowctl node: a run and a node id are required (piflowctl node <run> <nodeId> --resume [-m "<message>"]).');
    return 1;
  }
  if (parsed.resume === parsed.stop) {
    // neither, or both — exactly one action is required.
    error('piflowctl node: pass exactly one of --resume or --stop.');
    return 1;
  }

  // ── --stop: signal the run's CONTROLLING process group (per-run group-kill). ──
  if (parsed.stop) {
    let stopRunDir: string;
    try {
      stopRunDir = resolveRunDir(parsed.run);
    } catch (e) {
      error((e as Error).message);
      return 1;
    }
    const runState = loadRunStatus(stopRunDir);
    const action = buildStopAction({ runDir: stopRunDir, runState });
    if (!action.ok) {
      error(
        `piflowctl node ${parsed.run} ${parsed.nodeId} --stop: cannot stop — ${action.reason} (this signals the whole RUN's process group, not just node "${parsed.nodeId}").`,
      );
      return 1;
    }
    print(
      `piflowctl node: stopping run "${parsed.run}" — signalling its controlling process group (pid ${action.pid}) with SIGTERM→SIGKILL. (A per-RUN stop, not just node "${parsed.nodeId}".)`,
    );
    // Send SIGTERM, then escalate to SIGKILL after the kill grace if the group is still alive (the
    // exec-runner's watchdog escalation). `signalProcess` returning false ⇒ the group is already gone.
    let firstAlive = false;
    for (const step of action.signalSequence) {
      if (step.afterMs > 0) {
        if (!firstAlive) break; // SIGTERM already found it gone — no need to escalate.
        await sleep(step.afterMs);
      }
      const delivered = signalProcess(action.pid, step.signal);
      if (step.signal === 'SIGTERM') firstAlive = delivered;
      if (!delivered && step.signal === 'SIGTERM') {
        print(`piflowctl node: pid ${action.pid} was already gone — nothing to stop.`);
        return 0;
      }
    }
    return 0;
  }

  // ── --resume: resolve → guard → spawn. ──
  let runDir: string;
  try {
    runDir = resolveRunDir(parsed.run);
  } catch (e) {
    error((e as Error).message);
    return 1;
  }

  const journal = await loadJournal(runDir);
  const node = journal?.nodes?.[parsed.nodeId];
  if (!node || typeof node.sessionId !== 'string' || !node.sessionId) {
    const resumable = resumableNodes(journal);
    const which = resumable.length
      ? `Resumable nodes (have a stored session): ${resumable.join(', ')}.`
      : `No node in this run has a stored pi session (a cold inmemory/cloud run, or it never ran with --sandbox local).`;
    error(
      `piflowctl node: node "${parsed.nodeId}" has no recorded pi session in ${journalFileHint(runDir)} — cannot warm-resume it. ${which}`,
    );
    return 1;
  }

  const interactive = parsed.message === undefined;
  const messageFile = interactive ? undefined : await writeMessageFile(parsed.message as string);
  const cmd = buildNodeResumeCommand({ runDir, nodeId: parsed.nodeId, messageFile, interactive });

  print(
    interactive
      ? `piflowctl node: warm-resuming "${parsed.nodeId}" (live session) from its stored conversation under ${piSessionsDir(runDir)}. (Conversational resume — NOT a runner re-execution.)`
      : `piflowctl node: warm-resuming "${parsed.nodeId}" with a message from its stored conversation under ${piSessionsDir(runDir)}. (Conversational resume — NOT a runner re-execution.)`,
  );
  const code = spawnResume(cmd, runDir);
  return code;
}

/** A human-friendly pointer to the journal for the guard's error (relative when possible). */
function journalFileHint(runDir: string): string {
  return path.join(runDir, '.pi', 'journal.json');
}
