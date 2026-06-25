// (G5 — HITL) The reply COURIER contract. The Vite endpoint `POST /__piflow/checkpoint/<run>` writes the
// reply file through the factored pure core (gui/scripts/lib/checkpoint-reply.mjs). This test asserts the
// two load-bearing decisions — slug containment + the exact write path/bytes — AND the cross-boundary
// contract: the bytes the courier writes are EXACTLY what the runner's `readReply`/`validateReply` consume.
// (The HTTP shell — route match, run resolution, body parse — is thin glue the plugin owns; the decisions
// that can corrupt a run live in the factored core, tested here.)
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — the courier core is a plain ESM .mjs in the gui (no .d.ts); imported for the contract test.
import { writeCheckpointReply, isSafeNodeId, replyPathFor } from '../../../gui/scripts/lib/checkpoint-reply.mjs';
import { checkpointReplyFile } from '../src/runner/layout.js';
import { readReply, validateReply, buildMarker } from '../src/runner/checkpoint.js';

async function tmpRun(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'piflow-courier-'));
}

describe('checkpoint reply courier — slug containment (the only thing it validates)', () => {
  it('REJECTS an unsafe nodeId (path escape) and a non-string hash; ACCEPTS a clean slug', async () => {
    expect(isSafeNodeId('approve-plan')).toBe(true);
    expect(isSafeNodeId('w0.classify_2')).toBe(true);
    expect(isSafeNodeId('../etc/passwd')).toBe(false);
    expect(isSafeNodeId('a/b')).toBe(false);
    expect(isSafeNodeId('')).toBe(false);

    const runDir = await tmpRun();
    const bad = await writeCheckpointReply(runDir, { nodeId: '../escape', hash: 'sha256:x', value: 'B' });
    expect(bad.status).toBe(400);
    const noHash = await writeCheckpointReply(runDir, { nodeId: 'gate', hash: 42, value: 'B' });
    expect(noHash.status).toBe(400);
  });
});

describe('checkpoint reply courier — writes the file the RUNNER watches (cross-boundary contract)', () => {
  it('POST writes <run>/.pi/checkpoints/<id>.reply.json with bytes readReply parses + validateReply accepts', async () => {
    const runDir = await tmpRun();
    const marker = buildMarker('gate', 'Gate', { kind: 'select', prompt: 'A or B?', choices: ['A', 'B'], default: 'A' }, 'now');

    const out = await writeCheckpointReply(runDir, { nodeId: 'gate', hash: marker.hash, value: 'B' });
    expect(out.status).toBe(202);

    // The courier wrote EXACTLY at the path the runner's layout helper points to.
    expect(out.file).toBe(checkpointReplyFile(runDir, 'gate'));
    expect(replyPathFor(runDir, 'gate')).toBe(checkpointReplyFile(runDir, 'gate'));

    // The runner's reader parses it, and the runner's authority ACCEPTS it (echoed hash + valid choice).
    const reply = await readReply(runDir, 'gate');
    expect(reply).toMatchObject({ nodeId: 'gate', hash: marker.hash, value: 'B', by: 'gui' });
    expect(validateReply(marker, reply!)).toEqual({ ok: true, value: 'B' });
  });
});
