// ─────────────────────────────────────────────────────────────────────────────
// DRIVER-PROJECT (the POST/DERIVE family) — generic JSON transforms that DERIVE a node's outputs from a
// FROZEN on-disk source. Ported from game-omni pi-runner/hooks/project.mjs; behavior-preserving for the
// GENERIC ops (copy | assemble | merge). The state change: the run.mjs RUN_CWD/ROOT fallback chain is
// retired — the destination resolves under the explicit `projectBase` (= the resolved `{{RUN}}`), and the
// SOURCE spec is read by the caller (runProjection) under the same root.
//
// SCOPE NOTE (flagged, not silently stubbed): the game-omni `union` op is NOT ported — it is the asset-slot
// + genre-record + golden-`blueprint.json` consumer transform (assetDefaultPath, entities[].assetSlot,
// the index.schema ajv gate), all game-omni-specific. The generic engine lives here; `union` stays a
// game-omni consumer op declared in its `genres.json` projections DATA.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ensureDir, projJson, drillPath, absUnder } from './util.js';

/** The result of one projection op. `wrote` is the on-disk effect; `skipped` carries the graceful reason. */
export interface ProjectionResult {
  to: string;
  op: string;
  wrote: boolean;
  skipped?: string;
  modelOwns?: string[];
}

/** A field spec in an `assemble` op: a dotted-path string, an `@entity:` marker, `{value}`, or `{from,default}`. */
type FieldSpec = string | { value: unknown } | { from: string; default?: unknown };

/**
 * Apply ONE generic projection op against the source JSON (`spec`), writing under `projectBase`.
 * Op kinds: `copy` (write a drilled subtree) · `assemble` (spread + deterministic fields, @entity-aware,
 * deterministic-absence drop) · `merge` (.value overwrite of seeded group keys + top-level literal coalesce).
 */
export async function applyProjectionOp(
  name: string,
  opSpec: Record<string, unknown>,
  spec: unknown,
  projectBase: string,
): Promise<ProjectionResult> {
  const toRel = String(opSpec.to);
  const toAbs = absUnder(projectBase, toRel);
  await ensureDir(path.dirname(toAbs));

  // ---- copy: write the drilled subtree verbatim ----
  if (typeof opSpec.copy === 'string') {
    const subtree = drillPath(spec, opSpec.copy);
    if (subtree === undefined)
      return { to: toRel, op: 'copy', wrote: false, skipped: `source path "${opSpec.copy}" not found` };
    await fs.writeFile(toAbs, projJson(subtree));
    return { to: toRel, op: 'copy', wrote: true };
  }

  // ---- assemble: start from the model's on-disk file (preserving @entity weaves), overwrite only the
  // deterministic fields; a deterministic field whose source is ABSENT is DROPPED (no seed leak) ----
  if (opSpec.assemble && typeof opSpec.assemble === 'object') {
    const { spread, fields = {} } = opSpec.assemble as { spread?: string; fields?: Record<string, FieldSpec> };
    let onDisk: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(await fs.readFile(toAbs, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) onDisk = parsed as Record<string, unknown>;
    } catch {
      /* absent ⇒ start from the spread skeleton alone */
    }
    const base = spread ? drillPath(spec, spread) : undefined;
    const det: Record<string, unknown> = {};
    const entityKeys = new Set<string>();
    const dropKeys = new Set<string>();
    for (const [outKey, fieldSpec] of Object.entries(fields)) {
      if (typeof fieldSpec === 'string' && fieldSpec.startsWith('@entity:')) {
        entityKeys.add(outKey);
        continue;
      }
      if (typeof fieldSpec === 'string') {
        const v = drillPath(spec, fieldSpec);
        if (v !== undefined) det[outKey] = v;
        else dropKeys.add(outKey);
      } else if (fieldSpec && typeof fieldSpec === 'object' && 'value' in fieldSpec) {
        det[outKey] = fieldSpec.value;
      } else if (fieldSpec && typeof fieldSpec === 'object' && 'from' in fieldSpec) {
        const v = drillPath(spec, fieldSpec.from);
        if (v !== undefined) det[outKey] = v;
        else if ('default' in fieldSpec) det[outKey] = fieldSpec.default;
        else dropKeys.add(outKey);
      }
    }
    const spreadDet: Record<string, unknown> = {};
    if (base && typeof base === 'object' && !Array.isArray(base))
      for (const k of Object.keys(base as Record<string, unknown>))
        if (!entityKeys.has(k)) spreadDet[k] = (base as Record<string, unknown>)[k];
    const out: Record<string, unknown> = { ...onDisk, ...spreadDet, ...det };
    for (const k of dropKeys) delete out[k];
    await fs.writeFile(toAbs, projJson(out));
    return {
      to: toRel,
      op: 'assemble',
      wrote: true,
      ...(entityKeys.size ? { modelOwns: [...entityKeys] } : {}),
    };
  }

  // ---- merge: overwrite .value of seeded group keys + set top-level literals (coalesce; absent→"") ----
  if (opSpec.merge && typeof opSpec.merge === 'object') {
    const { wrapInto, from, literals = {} } = opSpec.merge as {
      wrapInto: string;
      from: string;
      literals?: Record<string, string | string[]>;
    };
    let target: Record<string, unknown> = {};
    try {
      target = JSON.parse(await fs.readFile(toAbs, 'utf8'));
    } catch {
      /* absent ⇒ empty target */
    }
    const group =
      target[wrapInto] && typeof target[wrapInto] === 'object'
        ? (target[wrapInto] as Record<string, unknown>)
        : ((target[wrapInto] = {}) as Record<string, unknown>);
    const specObj = spec as Record<string, unknown>;
    const src = specObj[from] && typeof specObj[from] === 'object' ? (specObj[from] as Record<string, unknown>) : {};
    for (const k of Object.keys(src)) {
      const cell = group[k];
      if (cell && typeof cell === 'object' && 'value' in cell) (cell as Record<string, unknown>).value = src[k];
    }
    for (const [key, specPath] of Object.entries(literals)) {
      const paths = Array.isArray(specPath) ? specPath : [specPath];
      let v: unknown;
      for (const p of paths) {
        const got = drillPath(spec, p);
        if (got !== undefined) {
          v = got;
          break;
        }
      }
      target[key] = v === undefined ? '' : v;
    }
    await fs.writeFile(toAbs, projJson(target));
    return { to: toRel, op: 'merge', wrote: true };
  }

  return { to: toRel, op: 'unknown', wrote: false, skipped: `no recognized op (copy|assemble|merge) for "${name}"` };
}
