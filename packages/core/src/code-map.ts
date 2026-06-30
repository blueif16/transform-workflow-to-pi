// code-map — Leg B of the memory layer (piflow-memory-v1 §2/§5b): the OPTIMIZER's understanding of the
// PRODUCT CODE in a node's scope. A SEPARATE leg from memory (self/history): different concern, different
// file, different module — code-map is the comparatively fixed reference slice; `memory.md` is the rich,
// customizable standing state. v1 is Tier 0: each node's `code-map.md` is exactly ONE OKF reference slice
// (pointers + semantics, NEVER a copy of the source). Tier 1 (opt-in codegraph) later fans this out to a
// product-global OKF index with `slice@sha` anchors. Self-contained: this module imports nothing from memory/.

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** The result of a create-if-absent seed (mirrors memory's `SeedResult`; the legs share no code). */
export interface CodeMapSeedResult {
  path: string;
  created: boolean;
}

/** Write `content` to `filePath` ONLY when it does not already exist — the optimizer curates the slice. */
async function writeIfAbsent(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false; // already present — never overwrite a curated slice.
  } catch {
    /* absent → seed it */
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  return true;
}

/**
 * The per-node `code-map.md` seed — a Tier-0 OKF reference slice for THIS node's scope. Records HOW the
 * product code the node operates on actually works (the flow, the seams/contracts, the gotchas) as pointers
 * + semantics, never a copy. OPTIMIZER-FACING; NEVER injected into the node's runtime prompt. Pure.
 */
export function buildNodeCodeMap(id: string): string {
  return `# node: ${id} — code-map
<!-- Leg B · OPTIMIZER-FACING · Tier 0 = exactly ONE OKF reference slice for ${id}'s scope.
     Records pointers + semantics, NEVER a copy of the source. NEVER injected into ${id}'s runtime prompt.
     OKF-standard; Tier 1 (opt-in codegraph) later adds slice@sha + a product-global index. -->

type: reference
scope: <the product code in ${id}'s io.reads / owns / readScope>

## What this code does
<!-- the functionality + the whole flow running inside ${id}, end to end. -->

## Seams & contracts
<!-- entry points + key files (pointers, not copies) + the contracts between them. -->

## Gotchas
<!-- the non-obvious behavior — what bit us; nothing deducible from the source in 5s. -->

## Freshness
<!-- Tier 0: refresh lazily when ${id}'s scope-files change. -->
`;
}

/** Seed `<dir>/code-map.md` from `buildNodeCodeMap(id)`, create-if-absent. */
export async function seedNodeCodeMap(dir: string, id: string): Promise<CodeMapSeedResult> {
  const p = path.join(dir, 'code-map.md');
  return { path: p, created: await writeIfAbsent(p, buildNodeCodeMap(id)) };
}
