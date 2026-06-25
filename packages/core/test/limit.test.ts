import { describe, it, expect } from 'vitest';
import { createLimiter, normalizeConcurrent } from '../src/runner/limit.js';

// ── createLimiter — the counting-semaphore invariant (pure logic) ────────────────────────────────

describe('createLimiter — peak concurrency never exceeds the limit', () => {
  it('admits at most `limit` fns at once even when many are queued, and runs them all', async () => {
    const limit = 3;
    const run = createLimiter(limit);

    let inFlight = 0;
    let peak = 0;
    let completed = 0;
    // Each fn parks on a manually-released deferred so admitted lanes PILE UP (the only way peak can
    // be observed). The limiter must hold the in-flight set at `limit`; releasing one admits one.
    const releases: Array<() => void> = [];
    const tasks = Array.from({ length: 10 }, () =>
      run(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => releases.push(resolve));
        inFlight--;
        completed++;
      }),
    );

    // Let the first wave be admitted; only `limit` of them can be in-flight.
    await new Promise((r) => setTimeout(r, 10));
    expect(inFlight).toBe(limit);
    expect(peak).toBe(limit);

    // Drain: each release admits exactly one queued lane; peak must never climb past `limit`.
    while (releases.length) {
      releases.shift()!();
      await new Promise((r) => setTimeout(r, 2));
      expect(peak).toBe(limit);
    }
    await Promise.all(tasks);
    expect(completed).toBe(10);
    expect(inFlight).toBe(0);
  });

  it('releases its slot on a REJECTING fn (finally), so the queue still drains', async () => {
    const run = createLimiter(1);
    let secondRan = false;
    const first = run(async () => {
      throw new Error('boom');
    });
    const second = run(async () => {
      secondRan = true;
    });
    await expect(first).rejects.toThrow('boom');
    await second;
    expect(secondRan).toBe(true); // the rejecting lane's slot was freed
  });
});

// ── normalizeConcurrent — the default derivation (clamped & CPU-derived) ──────────────────────────

describe('normalizeConcurrent — default 8, clamped to [1, 16]', () => {
  it('returns the fixed default of 8 when value is undefined', () => {
    expect(normalizeConcurrent(undefined)).toBe(8);
  });

  it('normalizes 0, negative, and NaN to 1 (never unbounded, never deadlocked)', () => {
    expect(normalizeConcurrent(0)).toBe(1);
    expect(normalizeConcurrent(-5)).toBe(1);
    expect(normalizeConcurrent(NaN)).toBe(1);
  });

  it('clamps a too-large value to the ceiling of 16', () => {
    expect(normalizeConcurrent(100)).toBe(16);
    expect(normalizeConcurrent(17)).toBe(16);
  });

  it('passes an in-range explicit value through, floored', () => {
    expect(normalizeConcurrent(3)).toBe(3);
    expect(normalizeConcurrent(16)).toBe(16);
    expect(normalizeConcurrent(1)).toBe(1);
    expect(normalizeConcurrent(4.9)).toBe(4);
  });

  // NOTE: the locked decision is a FIXED default of 8 (NOT os.cpus()-2). On a host with 10 cores
  // those coincide (cpus-2 === 8), so the `toBe(8)` assertion above can only DISTINGUISH them on a
  // host whose core count ≠ 10 (e.g. a 4-core CI box would make a cpus-2 default 2 → RED). It is the
  // strongest hardware-independent guard available; see the report's self-check note.
});
