// (M7 · #23) CI-style grep guard — the STALE provider path `templates/pi-runner/providers/coding-plan.ts`
// must NOT appear anywhere under `docs/` or `packages/`. The real file relocated to
// `templates/legacy/providers/coding-plan.ts` (the SDK no longer owns the runner), so every brief/doc that
// still cites the old `pi-runner/...` location is a dead path. This guard fails the build the moment the
// stale literal reappears — a pure source-text assertion, no behavior under test.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const STALE_PATH = 'templates/pi-runner/providers/coding-plan.ts';
const SCAN_ROOTS = ['docs', 'packages'];
// Skip generated/vendored trees and this guard file itself (which names the literal to assert on).
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const SELF = fileURLToPath(import.meta.url);

function* walk(dir: string): Generator<string> {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      yield* walk(full);
    } else if (ent.isFile()) {
      yield full;
    }
  }
}

describe('doc/path guard (M7 · #23) — stale coding-plan.ts path is gone', () => {
  it('finds no `templates/pi-runner/providers/coding-plan.ts` under docs/ or packages/', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = path.join(REPO_ROOT, root);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        if (file === SELF) continue;
        let text: string;
        try {
          text = fs.readFileSync(file, 'utf8');
        } catch {
          continue; // unreadable/binary — not a doc citation
        }
        if (text.includes(STALE_PATH)) {
          offenders.push(path.relative(REPO_ROOT, file));
        }
      }
    }
    expect(offenders, `stale path "${STALE_PATH}" still cited in:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
