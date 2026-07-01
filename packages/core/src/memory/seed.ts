// Create-if-absent writers for the memory seeds. Memory ACCUMULATES across runs, so a re-seed must NEVER
// clobber the optimizer's curated content — the exact discipline `scaffoldAddNode` already applies to a
// node's `prompt.md`. The writer reports `created` so the scaffolder can tell the human what it actually wrote.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildNodeMemory, buildSystemMemory } from './skeleton.js';

export interface MemorySeedResult {
  /** The file written (or that already existed). */
  path: string;
  /** true ⇔ this call wrote the seed; false ⇔ a file was already there and was left untouched. */
  created: boolean;
}

/** Write `content` to `filePath` ONLY when it does not already exist. Returns whether it wrote. */
export async function writeIfAbsent(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false; // already present — never overwrite curated memory.
  } catch {
    /* absent → seed it */
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return true;
}

/** Seed `<dir>/memory.md` (the per-node Leg-A file) from `buildNodeMemory(id)`, create-if-absent. */
export async function seedNodeMemory(dir: string, id: string): Promise<MemorySeedResult> {
  const p = path.join(dir, 'memory.md');
  return { path: p, created: await writeIfAbsent(p, buildNodeMemory(id)) };
}

/** Seed `<dir>/memory.md` (the template Leg-A reconcile summary) from `buildSystemMemory(wfId)`, create-if-absent. */
export async function seedSystemMemory(dir: string, wfId: string): Promise<MemorySeedResult> {
  const p = path.join(dir, 'memory.md');
  return { path: p, created: await writeIfAbsent(p, buildSystemMemory(wfId)) };
}
