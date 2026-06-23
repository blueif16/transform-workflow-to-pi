// ─────────────────────────────────────────────────────────────────────────────
// DRIVER-SEED (the PRE-stage family) — deterministically stage a node's STARTING artifact before the
// model runs. Ported from game-omni pi-runner/hooks/seed.mjs; the ONLY change is that the {file:field}
// drill resolves its file path through the U7 logical-root resolver ({{RUN}}/{{WORKSPACE}}/{{state}})
// instead of the retired RUN_CWD-relative path.resolve — so a seed is relocation-invariant by construction.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolveTokens, type ResolveCtx } from '../resolver.js';
import { drillPath } from './util.js';

/** One parsed seed: stage the artifact at `to` from the (token-bearing) source `from`. */
export interface Seed {
  to: string;
  from: string;
}

/**
 * Parse every `DRIVER-SEED: <dest> <= <src>` line (in order). The trailing boundary is a LOOKAHEAD, never
 * a consumed `\n` — three ADJACENT lines must all match (consuming the separator skips every other one).
 */
export function driverSeed(prompt: string): Seed[] {
  const re = /(?:^|\n)[ \t]*DRIVER-SEED:[ \t]*(\S+)[ \t]*<=[ \t]*(\S+)[ \t]*(?=\n|$)/g;
  const seeds: Seed[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt || ''))) seeds.push({ to: m[1], from: m[2] });
  return seeds;
}

// A `{file:field}` token — only the INNERMOST (no nested braces) matches, so nesting resolves inner→outer.
// `{{…}}` logical-root tokens are stripped FIRST (by the resolver), so by the time this runs the file path
// is already absolute and contains no `{{ }}`; a bare `{x:y}` (one open brace) is what remains.
const oneToken = /\{([^:{}]+):([^{}]+)\}/;

/**
 * Resolve a seed source: first the `{{RUN}}`/`{{WORKSPACE}}`/`{{state.*}}` logical-root tokens (via the
 * shared resolver — so the file path is absolute + relocation-invariant), then drill each `{file:field}`
 * token to a fixpoint (inner→outer). `{file:field}` reads the JSON at `file` and drills `field` as a dotted
 * path. An unresolvable token (missing file / absent field) is left VERBATIM (bounded passes, never throws).
 */
export function resolveSeedTokens(spec: string, ctx: ResolveCtx): string {
  // Phase 1 — the logical roots. A `{{state.*}}` token throws MissingChannelError if the channel is absent
  // (intentional: a seed that names a not-yet-promoted channel is a real wiring error, surfaced loudly).
  let out = resolveTokens(spec, ctx);
  // Phase 2 — the {file:field} drill, to a fixpoint (bounded passes guard a cycle).
  for (let pass = 0; pass < 8 && oneToken.test(out); pass++) {
    out = out.replace(new RegExp(oneToken, 'g'), (whole, file: string, field: string) => {
      try {
        const v = drillPath(JSON.parse(readFileSync(file, 'utf8')), field.trim());
        return v == null ? whole : String(v);
      } catch {
        return whole;
      }
    });
  }
  return out;
}
