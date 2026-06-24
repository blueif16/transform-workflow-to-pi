// ─────────────────────────────────────────────────────────────────────────────
// DRIVER-SEED-CONTRACT (the per-node SEEDED-CONTRACT projection family) — the bind-template interpreter
// that DERIVES each downstream node's contract from a FROZEN on-disk blueprint. Ported from game-omni
// pi-runner/hooks/seed-contract.mjs; the pure interpreter (drillArrayField | coreObservables |
// gatherEntityIds | resolveNodeContract) is BYTE-FAITHFUL — every concrete value is drilled from `spec`,
// the catalog supplies only the SHAPE; ZERO game/archetype literals live here.
//
// The state change (the whole point of the canonical SDK): the run.mjs RUN_CWD/ROOT/here path-fallback
// chain is RETIRED — exactly as project.ts/merge.ts dropped it. `runSeedContract(proj, projectBase)`
// resolves a relative `proj.source`/`proj.catalog` under the explicit `projectBase` (absolute paths used
// as-is); there is NO `ctx` parameter. A missing/unreadable catalog or source degrades gracefully to
// `{ skipped: '<reason>' }`, never throws (the engine law).
//
// SCOPE NOTE (flagged, not silently stubbed): the `driverSeedContract` marker parser is NOT ported —
// it is a base64-line parser, a runner-wiring concern, not part of this executor's interpreter core.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import { projJson, drillPath, absUnder, readJsonSafe } from './util.js';

/** dedup + lexical sort, stringifying each element (local — the markers.mjs helper). */
const dedupSort = (xs: unknown[]): string[] => [...new Set(xs.map(String))].sort();

/**
 * "a[].b" → collect each element's drilled `b`; a plain dotted path with a non-array value → [value]; an
 * array value → the array. GENERIC — no field name is hard-coded.
 */
export function drillArrayField(obj: unknown, spec: string): unknown[] {
  const m = /^(.+?)\[\]\.(.+)$/.exec(spec);
  if (m) {
    const arr = drillPath(obj, m[1]);
    if (!Array.isArray(arr)) return [];
    return arr.map((e) => (e == null ? undefined : drillPath(e, m[2]))).filter((v) => v != null);
  }
  const v = drillPath(obj, spec);
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

/** The catalog's `observables` palette: a `base` list + meta-scalar-gated additions. */
interface ObservablePalette {
  base?: unknown[];
  whenScalar?: Record<string, { unless?: unknown[]; add?: unknown[]; map?: Record<string, unknown> }>;
}

/**
 * The CORE OBSERVABLE set, computed ONCE per source from the catalog's `observables` palette (base + the
 * meta-scalar-gated additions). The ONLY archetype knowledge is DATA in the catalog. Returns a deduped
 * (insertion-order) array.
 */
export function coreObservables(spec: unknown, palette: ObservablePalette | undefined): string[] {
  if (!palette || typeof palette !== 'object') return [];
  const out: unknown[] = [...(Array.isArray(palette.base) ? palette.base : [])];
  for (const [scalarPath, rule] of Object.entries(palette.whenScalar || {})) {
    const val = drillPath(spec, scalarPath);
    if (rule && Array.isArray(rule.unless)) {
      if (!rule.unless.includes(val)) for (const a of rule.add || []) out.push(a);
    } else if (rule && rule.map && typeof rule.map === 'object') {
      const mapped = rule.map[val as string];
      if (mapped != null) out.push(mapped);
    }
  }
  return [...new Set(out.map(String))];
}

/**
 * Gather the POSITIONED entity ids from a list of dotted paths (each a single object with `.id`, OR an
 * array of {id}) — in path order, then array order.
 */
export function gatherEntityIds(spec: unknown, paths: string[] | undefined): string[] {
  const ids: string[] = [];
  for (const p of paths || []) {
    const v = drillPath(spec, p);
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const e of v) if (e && (e as Record<string, unknown>).id != null) ids.push(String((e as Record<string, unknown>).id));
    } else if ((v as Record<string, unknown>).id != null) {
      ids.push(String((v as Record<string, unknown>).id));
    }
  }
  return ids;
}

/** One node-TYPE's catalog entry: the declarative bind-template + owns/demand/tone/scalars. */
export interface NodeCatalogEntry {
  owns?: string[];
  bind?: { segments?: Record<string, unknown>[] };
  scalars?: Record<string, { from?: string; default?: unknown; fromEntityIds?: string[] }>;
  demand?: { template?: string };
  tone?: { from?: string[]; default?: string };
}

/**
 * Resolve ONE node-TYPE's catalog entry against the frozen source → its contract object
 * { owns, bind, demand, tone, ...scalars }. Pure data-interpretation; the catalog supplies only the SHAPE.
 */
export function resolveNodeContract(
  spec: unknown,
  entry: NodeCatalogEntry,
  palette: ObservablePalette | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(entry.owns)) out.owns = entry.owns.slice();
  // ---- bind: ordered segments → one concatenated handle list ----
  const obs = coreObservables(spec, palette);
  const bind: string[] = [];
  for (const seg of (entry.bind && entry.bind.segments) || []) {
    const s = seg as Record<string, unknown>;
    if (s.kind === 'observables') {
      let xs = obs.slice();
      if (typeof s.with === 'string') xs.push(s.with);
      else if (Array.isArray(s.with)) xs.push(...(s.with as string[]));
      if (s.sort === 'dedup-sort') xs = dedupSort(xs);
      bind.push(...xs);
    } else if (s.kind === 'literals') {
      bind.push(...((s.values as string[]) || []));
    } else if (s.kind === 'events') {
      let xs = drillArrayField(spec, s.from as string).map(String);
      if (s.sort === 'dedup-sort') xs = dedupSort(xs);
      bind.push(...xs);
    } else if (s.kind === 'anchors') {
      const ids = gatherEntityIds(spec, s.entityIdsFrom as string[]);
      bind.push(...ids.map((i) => `near:${i}`), ...ids.map((i) => `${i}.position`));
    } else if (s.kind === 'tokens') {
      const xs = drillArrayField(spec, s.from as string).map(String);
      bind.push(...xs.map((v) => `${s.prefix as string}${v}`));
    } else if (s.kind === 'slots') {
      const xs: string[] = [];
      for (const f of (s.from as string[]) || []) for (const v of drillArrayField(spec, f)) xs.push(String(v));
      bind.push(...[...new Set(xs)]);
    }
  }
  out.bind = bind;
  // ---- scalars: extra top-level fields copied/derived verbatim (nodeContract is additionalProperties:true) ----
  for (const [field, sc] of Object.entries(entry.scalars || {})) {
    if (sc && Array.isArray(sc.fromEntityIds)) out[field] = gatherEntityIds(spec, sc.fromEntityIds);
    else if (sc && typeof sc.from === 'string') {
      const v = drillPath(spec, sc.from);
      out[field] = v == null ? sc.default ?? '' : v;
    }
  }
  // ---- the templated demand + tone context (generic token grammar; values all drilled from spec) ----
  const scoringModel = drillPath(spec, 'meta.scoringModel') ?? 'none';
  const failModel = (drillPath(spec, 'meta.failModel') ?? 'none') as string;
  const ctx = {
    coreVerb: drillPath(spec, 'meta.coreVerb') ?? '',
    goalId: ((drillPath(spec, 'layout.goal') as Record<string, unknown>) || {}).id ?? '',
    firstMilestone: (() => {
      const ms = drillArrayField(spec, 'milestones[].id');
      return ms.length ? ms[0] : 'M1';
    })(),
    slotCount: (() => {
      let n = 0;
      for (const seg of (entry.bind && entry.bind.segments) || [])
        if ((seg as Record<string, unknown>).kind === 'slots') n = bind.length;
      return n;
    })(),
  } as Record<string, unknown>;
  const renderDemand = (tmpl: string | undefined): string =>
    String(tmpl || '')
      .replace(/\{scoring\?([^:}]*):([^}]*)\}/g, (_, a, b) => (scoringModel !== 'none' ? a : b))
      .replace(/\{failResource\}/g, () => (['none', 'respawn'].includes(failModel) ? '' : ` + the ${failModel} resource`))
      .replace(/\{gameOver\?\}/g, () => (['none', 'respawn'].includes(failModel) ? 'out' : ''))
      .replace(/\{(coreVerb|goalId|firstMilestone|slotCount)\}/g, (_, k) => String(ctx[k] ?? ''));
  if (entry.demand && typeof entry.demand.template === 'string') out.demand = renderDemand(entry.demand.template);
  // ---- tone: first-present coalesce over dotted paths, with a default ----
  if (entry.tone && Array.isArray(entry.tone.from)) {
    let tone: unknown;
    for (const p of entry.tone.from) {
      const v = drillPath(spec, p);
      if (v != null && v !== '') {
        tone = v;
        break;
      }
    }
    out.tone = tone == null ? entry.tone.default ?? '' : tone;
  }
  return out;
}

/** A DRIVER-SEED-CONTRACT projection: read the catalog + frozen source, seed source.<into>.<node>. */
export interface SeedContractSpec {
  source: string;
  catalog: string;
  into?: string;
}

/** The result of one seed-contract run. `skipped` carries the graceful (never-thrown) reason. */
export interface SeedContractResult {
  source?: string;
  catalog?: string;
  into?: string;
  nodes?: string[];
  skipped?: string;
}

/**
 * Run a node's DRIVER-SEED-CONTRACT (POST-node): read the drift-gated `catalog` (its `nodes` map of
 * bind-templates + the `observables` palette), resolve each node-TYPE against the frozen `source` JSON,
 * write source.<into>.<node> = the resolved contract, then write the source back. Returns a summary; a
 * missing/unreadable catalog or source returns `{ skipped }` (graceful degrade — the engine law).
 *
 * Path resolution: a relative `proj.catalog`/`proj.source` resolves under `projectBase` via `absUnder`
 * (absolute paths used as-is). The retired RUN_CWD/ROOT/here fallback chain is DROPPED.
 */
export async function runSeedContract(
  proj: SeedContractSpec | null | undefined,
  projectBase: string,
): Promise<SeedContractResult | null> {
  if (!proj) return null;
  const catalogAbs = absUnder(projectBase, proj.catalog);
  const catalog = (await readJsonSafe(catalogAbs)) as { nodes?: Record<string, NodeCatalogEntry>; observables?: ObservablePalette } | undefined;
  if (!catalog) return { skipped: `catalog not found: ${proj.catalog}` };
  if (typeof catalog.nodes !== 'object') return { skipped: 'catalog has no `nodes` map (inert)' };
  const srcAbs = absUnder(projectBase, proj.source);
  const spec = (await readJsonSafe(srcAbs)) as Record<string, unknown> | undefined;
  if (!spec) return { skipped: `source unreadable: ${proj.source}` };
  const into = proj.into || 'contracts';
  if (!spec[into] || typeof spec[into] !== 'object' || Array.isArray(spec[into])) spec[into] = {};
  const intoMap = spec[into] as Record<string, unknown>;
  const done: string[] = [];
  for (const [node, entry] of Object.entries(catalog.nodes)) {
    if (node.startsWith('$')) continue; // skip $comment-style keys
    try {
      intoMap[node] = resolveNodeContract(spec, entry, catalog.observables);
      done.push(node);
    } catch {
      /* graceful: a single node's failure skips THAT node, never the run */
    }
  }
  await fs.writeFile(srcAbs, projJson(spec));
  return { source: proj.source, catalog: proj.catalog, into, nodes: done };
}
