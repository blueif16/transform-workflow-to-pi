// Per-node stop — the runner persists each node's live `pi` pid to `.pi/nodes/<id>/pid.json` at spawn and
// REMOVES it on finish. The pid file is the home a separate `piflowctl node <run> <id> --stop` reads to
// signal a SPECIFIC node's process group. We assert the BEHAVIOR end-to-end through the runner's injectable
// execRunner seam (no real pi): the runner threads an `onSpawn` into execRunner; firing it must MATERIALIZE
// the pid file (visible DURING exec), and the node finishing must CLEAR it (a stale pid must never be signalled).
//
// Scoped to in-place/local (host-signalable) providers: an inmemory/cloud sandbox's process is NOT a host
// process a separate CLI can signal, so the runner does not persist a misleading host pid there — asserted
// by the second test (an `inmemory` provider writes NO pid file even though onSpawn fires).

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compile, InMemorySandboxProvider } from '../src/index.js';
import type { NodeIntent, WorkflowSpec, Sandbox, CreateOpts, SandboxProvider } from '../src/index.js';
import { runWorkflow, defaultExecRunner } from '../src/runner/runner.js';
import { nodePidFile } from '../src/runner/layout.js';

const wf = (nodes: NodeIntent[]): WorkflowSpec => ({ meta: { name: 't', description: 'd' }, nodes });
const tmpOut = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'piflow-pid-'));

/** A provider that REPORTS `kind:'local'` (⇒ in-place / host-signalable) but backs nodes with inmemory. */
function localKindProvider(): SandboxProvider {
  const base = new InMemorySandboxProvider();
  return { kind: 'local', create: (opts: CreateOpts): Promise<Sandbox> => base.create(opts) };
}

const okNode: NodeIntent = {
  label: 'Producer',
  prompt: 'produce',
  tools: {},
  io: { reads: [], produces: ['out.txt'], artifacts: [{ path: 'out.txt' }] },
};

describe('per-node pid persistence — written at spawn, removed on finish (host-signalable scope)', () => {
  it('a LOCAL node: pid.json exists DURING exec (with {pid,pgid,startedAt}) and is GONE after the node finishes', async () => {
    const g = compile(wf([okNode]));
    const outDir = await tmpOut();
    const pidPath = nodePidFile(outDir, 'producer');

    let seenDuringExec: { exists: boolean; body: string | null } = { exists: false, body: null };

    // The injected execRunner FIRES the runner's onSpawn (simulating a real spawn with a chosen pid), then —
    // STILL "inside" the node's exec — observes the pid file the runner just persisted, before letting the
    // exec resolve (which writes the artifact so the node ends `ok` and finishNode clears the pid).
    const execRunner = async (sandbox: Sandbox, _cmd: string, opts: Parameters<typeof defaultExecRunner>[2]) => {
      opts.onSpawn?.(424242);
      // onSpawn persists the pid asynchronously (fire-and-forget — a real `--stop` reads it much later, so
      // eventual durability suffices). Yield until the atomic write lands before observing it mid-exec.
      for (let i = 0; i < 50 && !(await fs.stat(pidPath).then(() => true, () => false)); i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      try {
        seenDuringExec = { exists: true, body: await fs.readFile(pidPath, 'utf8') };
      } catch {
        seenDuringExec = { exists: false, body: null };
      }
      // Write the declared artifact at its host path so the node verifies `ok` (in-place skips collect).
      await fs.writeFile(path.join(outDir, 'out.txt'), 'done');
      return { result: { stdout: '', stderr: '', code: 0 }, killed: null as const };
    };

    await runWorkflow(g, {
      run: 'pid-local',
      outDir,
      provider: localKindProvider(),
      buildCommand: () => 'true',
      execRunner,
    });

    // PERSISTED at spawn: the file was present mid-exec, carrying the pid we passed + a matching pgid (the
    // detached child is its own group leader) + a startedAt timestamp.
    expect(seenDuringExec.exists, 'pid.json must exist while the node is executing').toBe(true);
    const rec = JSON.parse(seenDuringExec.body as string);
    expect(rec.pid).toBe(424242);
    expect(rec.pgid).toBe(424242); // pid == pgid (group leader) — the value --stop signals via kill(-pid)
    expect(typeof rec.startedAt).toBe('string');

    // CLEARED on finish: the node exited, so the recorded pid is now STALE and MUST be gone (never signalled).
    await expect(fs.stat(pidPath)).rejects.toThrow();

    await fs.rm(outDir, { recursive: true, force: true });
  });

  it('an INMEMORY node: NO pid.json is written even though onSpawn fires (not host-signalable)', async () => {
    const g = compile(wf([okNode]));
    const outDir = await tmpOut();
    const pidPath = nodePidFile(outDir, 'producer');

    let existedDuringExec = true;
    const execRunner = async (sandbox: Sandbox, _cmd: string, opts: Parameters<typeof defaultExecRunner>[2]) => {
      opts.onSpawn?.(515151);
      // Wait a beat (the SAME budget the local test uses to SEE a write) to prove the file STAYS absent —
      // not a timing fluke where a write simply hadn't landed yet. A host-signalable provider WOULD have a
      // file by now; this one (inmemory) must not.
      await new Promise((r) => setTimeout(r, 30));
      existedDuringExec = await fs.stat(pidPath).then(() => true, () => false);
      // collect copies <out> → outDir for an isolated provider; write the artifact in the sandbox.
      await sandbox.writeFile('out/out.txt', 'done');
      return { result: { stdout: '', stderr: '', code: 0 }, killed: null as const };
    };

    await runWorkflow(g, {
      run: 'pid-inmem',
      outDir,
      provider: new InMemorySandboxProvider(), // kind:'inmemory' ⇒ NOT host-signalable
      buildCommand: () => 'true',
      execRunner,
    });

    // The process lives in an ephemeral sandbox the host CLI cannot signal — persisting a host pid would be
    // misleading, so the runner writes NONE.
    expect(existedDuringExec, 'an inmemory (non-host-signalable) node must NOT persist a host pid').toBe(false);
    await expect(fs.stat(pidPath)).rejects.toThrow();

    await fs.rm(outDir, { recursive: true, force: true });
  });
});
