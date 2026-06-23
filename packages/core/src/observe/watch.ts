// ── watchRun — the single live STREAM ───────────────────────────────────────────────────────────────
// One async iterable every live view drives: it yields a full `{kind:'snapshot'}` FIRST, then the
// deltas — `{kind:'node-status'}` when a node's DERIVED status changes, `{kind:'node-event'}` for each
// NEW `.pi/nodes/<id>/events.jsonl` line, and `{kind:'done'}` when the run completes — and stops
// cleanly on `opts.signal` abort. It polls the engine-owned `.pi/` layout (the writer publishes
// `run.json` atomically, so a poll never reads a torn file) at `opts.pollMs`.
//
// The event tail REUSES the byte-offset + carry-partial-line technique `followRun` (logs.ts) uses — we
// read only the bytes appended since the last poll, split into whole lines, JSON.parse each, and carry
// the trailing partial — so we never re-emit a line and never duplicate the firehose-distiller logic.

import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { nodeEventsFile } from '../runner/layout.js';
import type { PiEvent } from '../runner/events.js';
import type { NodeStatus } from '../runner/status.js';
import { readRunModel } from './read.js';
import type { RunUpdate } from './types.js';

export interface WatchOpts {
  /** Abort the stream — the iterator returns promptly (no hang) on abort. */
  signal?: AbortSignal;
  /** Poll interval (ms). Default 700 (the `followRun` cadence). */
  pollMs?: number;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Resolve immediately on abort so a long pollMs can't delay teardown.
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

/** Read the bytes appended to a node's events file since `from`; returns the parsed NEW events + the
 * new byte offset + the trailing partial line to carry. Pure over the file (no state). */
function tailEvents(
  file: string,
  from: number,
  carry: string,
): { events: PiEvent[]; offset: number; carry: string } {
  if (!existsSync(file)) return { events: [], offset: from, carry };
  const size = statSync(file).size;
  if (size <= from) return { events: [], offset: from, carry };
  const fd = openSync(file, 'r');
  const buf = Buffer.alloc(size - from);
  readSync(fd, buf, 0, buf.length, from);
  closeSync(fd);
  const lines = (carry + buf.toString('utf8')).split('\n');
  const nextCarry = lines.pop() ?? '';
  const events: PiEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line) as PiEvent); } catch { /* skip a torn line */ }
  }
  return { events, offset: size, carry: nextCarry };
}

/**
 * Tail a run live. Yields a snapshot, then status/event/done deltas, until the run is `done` or the
 * signal aborts. SAFE to start before the run has written anything: the first readable run.json
 * produces the snapshot; until then it polls (and an abort still returns promptly).
 */
export async function* watchRun(runDir: string, opts: WatchOpts = {}): AsyncIterable<RunUpdate> {
  const pollMs = opts.pollMs ?? 700;
  const signal = opts.signal;

  const aborted = (): boolean => !!signal?.aborted;
  if (aborted()) return; // already-aborted ⇒ yield nothing, return immediately

  const lastStatus = new Map<string, NodeStatus>(); // per-node DERIVED status, for change detection
  const offsets = new Map<string, number>();        // per-node consumed byte offset of events.jsonl
  const carry = new Map<string, string>();          // per-node trailing partial line
  let sentSnapshot = false;

  for (;;) {
    if (aborted()) return;

    // 1) snapshot/poll the model (atomic run.json ⇒ never torn). Skip a poll cleanly if run.json absent.
    let model;
    try {
      model = await readRunModel(runDir);
    } catch {
      await sleep(pollMs, signal);
      continue;
    }

    if (!sentSnapshot) {
      // Seed the per-node status baseline + the event offsets from the CURRENT files, so the snapshot's
      // node-event/status deltas are only what arrives AFTER it (the snapshot already carries the state).
      for (const n of model.nodes) {
        lastStatus.set(n.id, n.status);
        const file = nodeEventsFile(runDir, n.id);
        offsets.set(n.id, existsSync(file) ? statSync(file).size : 0);
      }
      sentSnapshot = true;
      yield { kind: 'snapshot', model };
    } else {
      // 2) node-status deltas — a node whose DERIVED status changed since last poll. A node that first
      //    APPEARS after the snapshot (prev undefined) only seeds the baseline — no spurious delta.
      for (const n of model.nodes) {
        const prev = lastStatus.get(n.id);
        if (prev === n.status) continue;
        lastStatus.set(n.id, n.status);
        if (prev !== undefined) yield { kind: 'node-status', id: n.id, status: n.status };
      }
    }

    // 3) node-event deltas — new events.jsonl lines per node (offset tail).
    for (const n of model.nodes) {
      const file = nodeEventsFile(runDir, n.id);
      const from = offsets.get(n.id) ?? 0;
      const { events, offset, carry: nextCarry } = tailEvents(file, from, carry.get(n.id) ?? '');
      offsets.set(n.id, offset);
      carry.set(n.id, nextCarry);
      for (const event of events) {
        if (aborted()) return;
        yield { kind: 'node-event', id: n.id, event };
      }
    }

    // 4) done — terminal. Emit a final snapshot-consistent `done` and stop.
    if (model.done) {
      yield { kind: 'done' };
      return;
    }

    await sleep(pollMs, signal);
  }
}
