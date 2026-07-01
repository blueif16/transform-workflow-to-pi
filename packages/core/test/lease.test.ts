import { describe, it, expect } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireLease, readLease, lockFile, LeaseHeldError } from '../src/runner/lease.js';

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

async function tmpRun(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'piflow-lease-'));
}

/** A mutable clock so staleness is deterministic (no wall-clock sleeps). */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

// The single-writer lease that stops two runner processes from double-writing the journal (P6 migrate).
describe('run.lock lease — single-writer coordination for mid-run migration', () => {
  it('acquires a fresh lease and writes run.lock with the holder identity', async () => {
    const run = await tmpRun();
    const c = clock();
    const lease = await acquireLease(run, { pid: 4242, host: 'laptop', now: c.now });

    expect(existsSync(lockFile(run))).toBe(true);
    expect(lease.info.pid).toBe(4242);
    expect(lease.info.host).toBe('laptop');
    expect(lease.info.heartbeatAt).toBe(c.now());

    const onDisk = await readLease(run);
    expect(onDisk).toEqual(lease.info);
  });

  it('THROWS LeaseHeldError when a LIVE lease is already held (fresh heartbeat + live pid)', async () => {
    const run = await tmpRun();
    const c = clock();
    // Holder is alive and its heartbeat is recent — a second acquirer must NOT steal it.
    await acquireLease(run, { pid: 111, host: 'cloud', now: c.now, isAlive: () => true, ttlMs: 30_000 });

    c.advance(5_000); // well within the 30s ttl
    await expect(
      acquireLease(run, { pid: 222, host: 'laptop', now: c.now, isAlive: () => true, ttlMs: 30_000 }),
    ).rejects.toMatchObject({ name: 'LeaseHeldError', holder: { pid: 111, host: 'cloud' } });
  });

  it('STEALS a lease whose heartbeat is older than the ttl (the prior runner is gone)', async () => {
    const run = await tmpRun();
    const c = clock();
    await acquireLease(run, { pid: 111, host: 'cloud', now: c.now, isAlive: () => true, ttlMs: 30_000 });

    c.advance(45_000); // heartbeat now stale (> 30s)
    const stolen = await acquireLease(run, { pid: 222, host: 'laptop', now: c.now, isAlive: () => true, ttlMs: 30_000 });
    expect(stolen.info.pid).toBe(222);
    expect((await readLease(run))!.pid).toBe(222);
  });

  it('STEALS a lease whose holder pid is dead even if the heartbeat looks recent', async () => {
    const run = await tmpRun();
    const c = clock();
    await acquireLease(run, { pid: 111, host: 'laptop', now: c.now, isAlive: () => true, ttlMs: 30_000 });

    c.advance(1_000); // heartbeat still fresh...
    // ...but the holder process is dead → the new acquirer wins.
    const stolen = await acquireLease(run, { pid: 222, host: 'laptop', now: c.now, isAlive: () => false, ttlMs: 30_000 });
    expect(stolen.info.pid).toBe(222);
  });

  it('release() removes run.lock so the next acquirer succeeds cleanly (no steal needed)', async () => {
    const run = await tmpRun();
    const c = clock();
    const lease = await acquireLease(run, { pid: 111, host: 'laptop', now: c.now, isAlive: () => true });
    await lease.release();
    expect(existsSync(lockFile(run))).toBe(false);

    // A LIVE-holder acquire would throw; it succeeds only because release() cleared the lock.
    const next = await acquireLease(run, { pid: 222, host: 'laptop', now: c.now, isAlive: () => true });
    expect(next.info.pid).toBe(222);
  });

  it('renew() refreshes the heartbeat so a would-be stealer sees the lease as live', async () => {
    const run = await tmpRun();
    const c = clock();
    const lease = await acquireLease(run, { pid: 111, host: 'cloud', now: c.now, isAlive: () => true, ttlMs: 30_000 });

    c.advance(25_000); // approaching stale...
    await lease.renew(); // ...heartbeat bumped to now
    expect((await readLease(run))!.heartbeatAt).toBe(c.now());

    c.advance(10_000); // 10s since renew — still within ttl thanks to the renew
    await expect(
      acquireLease(run, { pid: 222, host: 'laptop', now: c.now, isAlive: () => true, ttlMs: 30_000 }),
    ).rejects.toMatchObject({ name: 'LeaseHeldError' });
  });
});
