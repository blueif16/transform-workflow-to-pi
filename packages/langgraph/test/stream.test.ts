// bridgeToWriter is the load-bearing adapter: it must ground EVERY core RunUpdate into config.writer and
// stop exactly at `done`. These tests inject a deterministic RunUpdate sequence (the same seam cli/watch.ts
// uses) so they assert the adapter logic with no wall-clock/filesystem — and FAIL if it drops a frame,
// runs past `done`, or loses the terminal model.

import { describe, it, expect } from 'vitest';
import { bridgeToWriter } from '../src/stream.js';
import type { RunModel, RunUpdate } from '@piflow/core';

const model = (over: Partial<RunModel> = {}): RunModel =>
  ({ run: 'r1', done: true, ok: true, durationMs: 1, stage: null, totals: null,
     nodes: [], stages: [], edges: [], ...over } as RunModel);

async function* seq(updates: RunUpdate[]): AsyncIterable<RunUpdate> {
  for (const u of updates) yield u;
}

describe('bridgeToWriter', () => {
  it('writes one frame per RunUpdate, in order, and returns the terminal model', async () => {
    const updates: RunUpdate[] = [
      { kind: 'snapshot', model: model() },
      { kind: 'node-status', id: 'w0', status: 'running' },
      { kind: 'node-event', id: 'w0', event: { type: 'tool' } },
      { kind: 'node-status', id: 'w0', status: 'ok' },
      { kind: 'done' },
    ];
    const frames: RunUpdate[] = [];
    const terminal = await bridgeToWriter('/unused', { writer: (c) => frames.push(c as RunUpdate) },
      { updates: seq(updates) });

    // Every update grounded into the writer, in order — drop or reorder one and this fails.
    expect(frames.map((f) => f.kind)).toEqual(['snapshot', 'node-status', 'node-event', 'node-status', 'done']);
    // Terminal model captured from the snapshot (injected path: no filesystem re-read).
    expect(terminal?.run).toBe('r1');
    expect(terminal?.ok).toBe(true);
  });

  it('stops at done — an update after done is never processed', async () => {
    const updates: RunUpdate[] = [
      { kind: 'snapshot', model: model({ done: false, ok: null, durationMs: null }) },
      { kind: 'done' },
      { kind: 'node-status', id: 'x', status: 'ok' }, // past `done` — must NOT reach the writer
    ];
    const frames: RunUpdate[] = [];
    await bridgeToWriter('/unused', { writer: (c) => frames.push(c as RunUpdate) }, { updates: seq(updates) });
    expect(frames.map((f) => f.kind)).toEqual(['snapshot', 'done']);
  });

  it('applies the map transform to every frame', async () => {
    const updates: RunUpdate[] = [{ kind: 'snapshot', model: model() }, { kind: 'done' }];
    const frames: string[] = [];
    await bridgeToWriter('/unused', { writer: (c) => frames.push(c as string) },
      { updates: seq(updates), map: (u) => u.kind });
    expect(frames).toEqual(['snapshot', 'done']);
  });

  it('a throwing writer never breaks the stream (status transport is non-fatal)', async () => {
    const updates: RunUpdate[] = [{ kind: 'snapshot', model: model() }, { kind: 'done' }];
    const terminal = await bridgeToWriter('/unused', { writer: () => { throw new Error('boom'); } },
      { updates: seq(updates) });
    expect(terminal?.run).toBe('r1'); // reached `done` and returned despite the writer throwing
  });
});
