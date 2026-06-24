// models.ts — read pi's NATIVE model registry (`~/.pi/agent/models.json`) for per-model capacities +
// price. pi already records the authoritative `contextWindow`, `maxTokens`, and per-token `cost` for
// every model it can run, so we REUSE that instead of hardcoding a table in any view. Shape observed:
//   { providers: { <providerId>: { baseUrl, api, apiKey, models: [ { id, contextWindow, maxTokens,
//                                                                    api, cost:{input,output,...} } ] } } }
//
// SECURITY: `providers.*.apiKey` is a secret — we read it off disk but NEVER copy it into the catalog or
// any returned object. Only capacity/cost/identity fields cross this boundary.

import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ModelCaps {
  id: string;
  provider: string;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}
export type ModelCatalog = Map<string, ModelCaps>; // keyed by model id AND lowercased id

/** Default window for a model absent from pi's registry — the catalog is authoritative when present. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

const piModelsFile = (piHome?: string): string =>
  path.join(piHome || process.env.PI_HOME || path.join(os.homedir(), '.pi'), 'agent', 'models.json');

// mtime-keyed cache so a long-running server picks up a models.json edit without restart, but doesn't
// re-read+parse on every request.
let _cache: { file: string; mtimeMs: number; catalog: ModelCatalog } | null = null;

/** Load pi's model registry → a catalog of capacity/cost (NO secrets). Empty map if absent/unreadable. */
export function loadModelCatalog(piHome?: string): ModelCatalog {
  const file = piModelsFile(piHome);
  let mtimeMs = 0;
  try { mtimeMs = fssync.statSync(file).mtimeMs; } catch { return new Map(); }
  if (_cache && _cache.file === file && _cache.mtimeMs === mtimeMs) return _cache.catalog;

  const catalog: ModelCatalog = new Map();
  try {
    const raw = JSON.parse(fssync.readFileSync(file, 'utf8')) as { providers?: Record<string, { models?: unknown[] }> };
    for (const [providerId, prov] of Object.entries(raw.providers || {})) {
      for (const m of (prov?.models || []) as Record<string, unknown>[]) {
        if (!m || typeof m.id !== 'string') continue;
        const caps: ModelCaps = {
          id: m.id,
          provider: providerId,
          api: typeof m.api === 'string' ? m.api : undefined,
          contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
          maxTokens: typeof m.maxTokens === 'number' ? m.maxTokens : undefined,
          cost: m.cost && typeof m.cost === 'object' ? (m.cost as ModelCaps['cost']) : undefined,
        };
        catalog.set(m.id, caps);
        catalog.set(m.id.toLowerCase(), caps);
      }
    }
  } catch { /* leave catalog empty — callers fall back to the default window */ }

  _cache = { file, mtimeMs, catalog };
  return catalog;
}

/** The context window for a model: pi's registry first (exact, then case-insensitive), else the default. */
export function contextWindowFor(model: string | null | undefined, catalog?: ModelCatalog): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  const cat = catalog ?? loadModelCatalog();
  return cat.get(model)?.contextWindow ?? cat.get(model.toLowerCase())?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}
