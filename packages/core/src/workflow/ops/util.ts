// ─────────────────────────────────────────────────────────────────────────────
// Shared, run.mjs-globals-free pure helpers for the U7 op executors (ported from game-omni
// pi-runner/hooks/markers.mjs — behavior-preserving). Every function is pure JSON/FS plumbing; the
// only re-rooting change vs the original is that path resolution flows through the U7 logical-root
// resolver ({{RUN}}/{{WORKSPACE}}), never the retired RUN_CWD/ROOT/here fallback chain.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** mkdir -p. */
export async function ensureDir(d: string): Promise<void> {
  await fs.mkdir(d, { recursive: true });
}

/** Pretty-print JSON (2-space + trailing newline) — byte-identical to a hand/LLM-written artifact. */
export const projJson = (obj: unknown): string => JSON.stringify(obj, null, 2) + '\n';

/** Drill a dotted path (`a.b.0.c`, array indices allowed) into an object; undefined past a null/absent. */
export const drillPath = (obj: unknown, dotted: string): unknown =>
  String(dotted)
    .split('.')
    .reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), obj);

/** Read + parse a JSON file; returns undefined on any error (graceful — the op degrades, never throws). */
export async function readJsonSafe(abs: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(abs, 'utf8'));
  } catch {
    return undefined;
  }
}

/** True iff the path exists with size ≥ 0 (a readable file). */
export async function fileExists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

/** Join a (possibly-already-absolute) path against a base. */
export const absUnder = (base: string, rel: string): string =>
  path.isAbsolute(rel) ? rel : path.join(base, rel);
