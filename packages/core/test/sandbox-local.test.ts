import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalSandbox, LocalSandboxProvider } from '../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// LocalSandboxProvider — the IN-PLACE sandbox: the node runs directly in a REAL
// existing directory (the user's working tree), the semantic OPPOSITE of
// InMemorySandbox (which mkdtemps a throwaway workspace and wipes it on dispose).
//
// Every fixture roots the sandbox at a THROWAWAY OS temp dir it creates and nukes
// in a finally — never the real cwd. The point of the provider is that it does NOT
// delete its root, so the TEST owns cleanup of the dir it hands in.
// ─────────────────────────────────────────────────────────────────────────────

async function tmpWork(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'piflow-local-fixture-'));
}

// ── 1. GAP-1: root IS resolve(workdir), NOT a mkdtemp child (the load-bearing assertion) ─────────────

describe('LocalSandbox — roots in-place at workdir (the GAP-1 regression guard)', () => {
  it('create({workdir}) sets root === resolve(workdir) and is NOT a tmpdir child', async () => {
    // The whole point of the in-place provider: the sandbox root IS the directory the caller named, so
    // the node runs in the user's real tree — NOT a fresh mkdtemp under os.tmpdir() the way InMemory does.
    // If create() regressed to mkdtemp-ing a child (the GAP-1 bug), root would live under os.tmpdir() and
    // would NOT equal resolve(workdir) — both assertions below would then fail.
    const work = await tmpWork();
    try {
      const sb = await LocalSandbox.create({ readScope: [], outputDir: 'out', workdir: work });
      expect(sb.root).toBe(path.resolve(work));
      // It is NOT a mkdtemp child: the root is exactly `work`, not some `os.tmpdir()/piflow-*` dir nested
      // under it (a mkdtemp child would be a DIFFERENT, deeper path that merely starts with tmpdir()).
      const realTmp = await fs.realpath(os.tmpdir());
      const realRoot = await fs.realpath(sb.root);
      const realWork = await fs.realpath(work);
      expect(realRoot).toBe(realWork);
      // The mkdtemp regression would nest root strictly BELOW work (work/piflow-xxxx); assert it doesn't.
      expect(path.dirname(realRoot)).not.toBe(realWork);
      // (realTmp referenced so the intent — "lives at work, not under a tmpdir child" — is explicit.)
      expect(realRoot.startsWith(realTmp)).toBe(true); // work itself is under tmpdir; root === work, not deeper
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
});

// ── 2. writeFile → readFile round-trips on the REAL tree ─────────────────────────────────────────────

describe('LocalSandbox — operates on the real tree at root', () => {
  it('writeFile then readFile round-trips, and the bytes land on disk at root/<path>', async () => {
    // write/read resolve under the REAL root, so a file written through the sandbox is the same file on
    // disk at <root>/<path> — assert BOTH the sandbox read-back AND the raw on-disk path agree.
    const work = await tmpWork();
    try {
      const sb = await LocalSandbox.create({ readScope: [], outputDir: 'out', workdir: work });
      await sb.writeFile('sub/in.txt', 'hello-real-tree');
      expect(await sb.readFile('sub/in.txt', { encoding: 'utf8' })).toBe('hello-real-tree');
      // It is the REAL tree: the byte file exists at the host path, readable WITHOUT the sandbox.
      expect(await fs.readFile(path.join(work, 'sub', 'in.txt'), 'utf8')).toBe('hello-real-tree');
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
});

// ── 3. dispose PRESERVES the tree (the never-delete-the-user's-tree invariant) ───────────────────────

describe('LocalSandbox — dispose preserves the tree (NEVER deletes the root)', () => {
  it('a file written before dispose is STILL readable on disk after dispose', async () => {
    // The load-bearing OPPOSITE of InMemory: dispose must be a NO-OP that leaves the real workspace
    // intact. Write a file, dispose, then read it straight off disk — it must still be there. If dispose
    // regressed to `fs.rm(root, {recursive:true})` (the InMemory behavior), the file — and the dir —
    // would be gone and the on-disk read below would reject.
    const work = await tmpWork();
    try {
      const sb = await LocalSandbox.create({ readScope: [], outputDir: 'out', workdir: work });
      await sb.writeFile('keep.txt', 'survives-dispose');
      await sb.dispose();
      // The root dir still exists AND the file is still readable on disk (dispose preserved the tree).
      expect((await fs.stat(work)).isDirectory()).toBe(true);
      expect(await fs.readFile(path.join(work, 'keep.txt'), 'utf8')).toBe('survives-dispose');
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
});

// ── 4. downloadDir is GUARDED IDENTITY: no-op when same realpath, THROW on a real mismatch ───────────

describe('LocalSandbox — downloadDir is guarded identity (no-op same path, throw on mismatch)', () => {
  it('is a no-op when remote and local resolve to the SAME real path (output already on disk)', async () => {
    // In-place: the output already lives at the host location, so collecting it to ITSELF is a no-op
    // (NOT a copy — a self-copy would error or clone a dir into itself). Point remote and local at the
    // same real dir and assert it resolves WITHOUT throwing and WITHOUT altering the tree.
    const work = await tmpWork();
    try {
      const sb = await LocalSandbox.create({ readScope: [], outputDir: 'out', workdir: work });
      await sb.writeFile('out/done.txt', 'collected');
      // remote 'out' resolves under root; local = the SAME absolute dir → identity no-op.
      await expect(sb.downloadDir('out', path.join(work, 'out'))).resolves.toBeUndefined();
      // The file is untouched (no clone-into-itself corruption).
      expect(await fs.readFile(path.join(work, 'out', 'done.txt'), 'utf8')).toBe('collected');
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it('THROWS on a real mismatch (a non-identity collection target is a misuse, not a silent no-op)', async () => {
    // A real mismatch means the caller asked to collect the output somewhere it does NOT already live —
    // for an in-place sandbox that is a MISUSE, and a silent no-op would drop the deliverable. So it must
    // THROW. If downloadDir were an unconditional no-op (the run.mjs reference behavior we DROPPED), this
    // would resolve and the assertion would fail.
    const work = await tmpWork();
    const other = await tmpWork(); // a DIFFERENT real dir
    try {
      const sb = await LocalSandbox.create({ readScope: [], outputDir: 'out', workdir: work });
      await sb.writeFile('out/done.txt', 'collected');
      await expect(sb.downloadDir('out', path.join(other, 'out'))).rejects.toThrow(/identity|mismatch/i);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
      await fs.rm(other, { recursive: true, force: true });
    }
  });
});

// ── 5. exec: nonzero exit surfaced; a signal reaps the whole process group ───────────────────────────

describe('LocalSandbox — exec contract (nonzero exit, process-group kill on signal)', () => {
  it('surfaces a nonzero exit code', async () => {
    const work = await tmpWork();
    try {
      const sb = await LocalSandbox.create({ readScope: [], outputDir: 'out', workdir: work });
      expect((await sb.exec('exit 3')).code).toBe(3);
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });

  it('aborting the signal reaps the whole group: a grandchild deferred write never lands', async () => {
    // Mirror of the SeatbeltSandbox signal-kill test. A HOST marker OUTSIDE the sandbox root: the command
    // sleeps then would `touch` it — but we abort mid-sleep, which SIGTERMs the process GROUP (`-pid`,
    // sh → sleep). With detached:true the whole group dies → `sleep` is reaped → the deferred `touch`
    // never runs → the marker never appears, and exec resolves PROMPTLY (124) rather than blocking the
    // full sleep. If exec did NOT make the child a group leader (detached:false), kill(-pid) is a no-op,
    // the orphaned sleep runs to completion, the marker appears, AND exec resolves only after the full
    // sleep — both assertions below then fail.
    const work = await tmpWork();
    const marker = path.join(os.tmpdir(), `piflow-local-latekill-${Date.now()}.marker`);
    try {
      const sb = await LocalSandbox.create({ readScope: [], outputDir: 'out', workdir: work });
      const ac = new AbortController();
      const t0 = Date.now();
      const execP = sb.exec(`sleep 2 && touch ${marker}`, { signal: ac.signal });
      setTimeout(() => ac.abort(), 100); // abort well before the 2s sleep ends
      const r = await execP;
      const elapsed = Date.now() - t0;

      // (a) exec resolved PROMPTLY — the group was killed, not waited out (the orphan would take ~2s).
      expect(elapsed).toBeLessThan(1500);
      expect(r.code).not.toBe(0); // signal-killed child surfaces nonzero (124)

      // (b) wait well past the would-be 2s touch; the marker must NOT appear (the grandchild was reaped).
      await new Promise((res) => setTimeout(res, 2200));
      await expect(fs.access(marker)).rejects.toThrow();
    } finally {
      await fs.rm(marker, { force: true }).catch(() => {});
      await fs.rm(work, { recursive: true, force: true });
    }
  }, 15000);
});
