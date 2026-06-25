// (G5 — HITL) The pure courier core for `POST /__piflow/checkpoint/<run>` — shared by the Vite plugin
// (gui/vite.config.ts `piflowCheckpointReply`) and its test, so the slug-containment + write-path contract
// is unit-testable without standing up Vite. The plugin owns HTTP (route match, run resolution, body read);
// THIS owns the two load-bearing decisions: is the nodeId a safe slug, and what exact bytes land where.
//
// DUMB COURIER: zero semantic validation (the RUNNER re-validates the echoed hash + kind/choices/shape and
// ignores a bad/stale reply). We only refuse a nodeId that could escape `.pi/checkpoints/`.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// A safe node-id slug: starts alnum, then letters/digits/_/-/. only, no `..` segment — so the join below
// can never escape the checkpoints dir.
const SAFE_NODE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** True iff `id` is a containment-safe node id (the write stays inside `.pi/checkpoints/`). */
export function isSafeNodeId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 200 && SAFE_NODE_ID.test(id) && !id.includes("..");
}

/** The run-relative path the reply file lands at — the SAME file the runner watches. */
export function replyPathFor(runDir, nodeId) {
  return join(runDir, ".pi", "checkpoints", `${nodeId}.reply.json`);
}

/**
 * Write a checkpoint reply into the run dir. Returns `{ ok, status, body }` mirroring the HTTP response the
 * plugin sends, so a test asserts the SAME decisions the endpoint makes:
 *  - 400 on an unsafe nodeId or a non-string hash (the only shape the runner needs to match its marker);
 *  - 202 + the written file path on success.
 * The on-disk bytes are `{ nodeId, hash, value, by, at }` — exactly what `readReply` parses on the runner side.
 */
export async function writeCheckpointReply(runDir, { nodeId, hash, value }, by = "gui") {
  if (!isSafeNodeId(nodeId)) return { ok: false, status: 400, body: { error: "missing or unsafe nodeId" } };
  if (typeof hash !== "string") return { ok: false, status: 400, body: { error: "missing hash (echo the marker hash)" } };
  const dir = join(runDir, ".pi", "checkpoints");
  const file = join(dir, `${nodeId}.reply.json`);
  const payload = { nodeId, hash, value, by, at: new Date().toISOString() };
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify(payload));
  return { ok: true, status: 202, body: { ok: true }, file };
}
