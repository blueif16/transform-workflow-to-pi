#!/usr/bin/env node
// pack-verify — the pre-publish PACKAGING gate for the 6 @piflow/* publishable packages.
//
// A gate is worthless if it stays GREEN when the published artifact is broken (test-discipline). So for
// EACH publishable package this runs three checks that genuinely fail on a broken package, and exits
// NONZERO if ANY package fails ANY check:
//
//   1. publint  — packaging / exports / bin-shebang correctness (errors only; warnings are allowed).
//   2. attw     — type-resolution correctness on the PACKED tarball, under the `esm-only` profile.
//                 These packages are deliberately ESM-only (`"type":"module"`, only `import`/`types`
//                 export conditions), so the CJS/node10 columns are EXPECTED to be unsupported; the
//                 `esm-only` profile scopes attw to the conditions we actually ship while still catching
//                 a genuinely broken artifact (e.g. a missing/unresolvable `.d.ts` shows 💀 NoResolution
//                 in the ESM/bundler rows and fails the gate). The DEFAULT `strict` profile would
//                 false-fail on the intentional ESM-only design (CJSResolvesToESM + node10 subpaths).
//   3. tarball-content — `npm pack --dry-run --json` in the pkg dir, parse the file list, assert the
//                 built `dist/` ships: `dist/index.js` + `dist/index.d.ts` for every package, and
//                 ADDITIONALLY `dist/cli.js` (the `piflowctl` bin) for @piflow/cli. This catches the
//                 "forgot to build before publish" / "dist excluded from files[]" footgun that publint
//                 and attw can miss when run against a stale-but-present dist.
//
// Assumes packages are already built (CI runs `pnpm run build` first). Run `pnpm run build` yourself to
// test locally.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The 6 PUBLISHABLE packages. dir is relative to repoRoot. `requireFiles` lists tarball paths (relative
 * to the package root) that MUST be present in `npm pack`'s file list.
 *
 * FUTURE HOOK (GUI embed, deferred): once the GUI is embedded into the CLI, add `'dist/gui/index.html'`
 * to @piflow/cli's requireFiles so the gate also asserts the embedded GUI ships. Do NOT require it now
 * — the GUI embed is not yet wired and requiring it would make this gate fail on a CORRECT artifact.
 */
const PACKAGES = [
  { name: '@piflow/core', dir: 'packages/core', requireFiles: ['dist/index.js', 'dist/index.d.ts'] },
  {
    name: '@piflow/cli',
    dir: 'packages/cli',
    requireFiles: ['dist/index.js', 'dist/index.d.ts', 'dist/cli.js' /* , 'dist/gui/index.html' — see FUTURE HOOK */],
  },
  { name: '@piflow/tool-bridge', dir: 'packages/tool-bridge', requireFiles: ['dist/index.js', 'dist/index.d.ts'] },
  { name: '@piflow/langgraph', dir: 'packages/langgraph', requireFiles: ['dist/index.js', 'dist/index.d.ts'] },
  { name: '@piflow/e2b', dir: 'packages/e2b', requireFiles: ['dist/index.js', 'dist/index.d.ts'] },
  { name: '@piflow/daytona', dir: 'packages/daytona', requireFiles: ['dist/index.js', 'dist/index.d.ts'] },
];

/** Run a command, capture output. Returns { ok, output (combined), stdout }. */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: process.env });
  const stdout = r.stdout ?? '';
  const output = `${stdout}${r.stderr ?? ''}`.trimEnd();
  if (r.error) return { ok: false, output: `${output}\n[spawn error] ${r.error.message}`.trim(), stdout };
  return { ok: r.status === 0, output, stdout };
}

/** publint: error-level only (warnings/suggestions don't fail the gate). */
function checkPublint(pkgDir) {
  // `--level error` → only error-level problems are reported AND counted toward a nonzero exit.
  return run('pnpm', ['exec', 'publint', 'run', pkgDir, '--level', 'error'], repoRoot);
}

/** attw on the packed tarball, esm-only profile (see header). */
function checkAttw(pkgDir) {
  return run('pnpm', ['exec', 'attw', '--pack', pkgDir, '--profile', 'esm-only'], repoRoot);
}

/** Assert the built dist ships in the npm tarball. */
function checkTarball(pkgDir, requireFiles) {
  const r = run('npm', ['pack', '--dry-run', '--json'], join(repoRoot, pkgDir));
  if (!r.ok) return { ok: false, output: `npm pack --dry-run failed:\n${r.output}` };
  let entries;
  try {
    // `npm pack --json` prints a JSON array on STDOUT; npm notices/warnings may surround it (and land on
    // stderr), so isolate the array: from the first `[` to the matching last `]` on stdout only.
    const src = r.stdout;
    const start = src.indexOf('[');
    const end = src.lastIndexOf(']');
    if (start < 0 || end < start) throw new Error('no JSON array found on stdout');
    entries = JSON.parse(src.slice(start, end + 1));
  } catch (e) {
    return { ok: false, output: `could not parse npm pack --json output:\n${r.output}\n[parse error] ${e.message}` };
  }
  const files = new Set((entries[0]?.files ?? []).map((f) => f.path));
  const missing = requireFiles.filter((f) => !files.has(f));
  if (missing.length > 0) {
    return {
      ok: false,
      output: `tarball is MISSING required built files: ${missing.join(', ')}\n  (did you run \`pnpm run build\` first, or is \`files[]\` excluding dist?)\n  tarball contained ${files.size} files.`,
    };
  }
  return { ok: true, output: `tarball ships all ${requireFiles.length} required file(s): ${requireFiles.join(', ')}` };
}

const CHECKS = [
  { label: 'publint', fn: (p) => checkPublint(p.dir) },
  { label: 'attw', fn: (p) => checkAttw(p.dir) },
  { label: 'tarball', fn: (p) => checkTarball(p.dir, p.requireFiles) },
];

console.log(`pack-verify: ${PACKAGES.length} publishable package(s) × ${CHECKS.length} checks\n`);

let anyFail = false;
const summary = [];

for (const pkg of PACKAGES) {
  const abs = join(repoRoot, pkg.dir);
  if (!existsSync(join(abs, 'package.json'))) {
    anyFail = true;
    summary.push(`FAIL  ${pkg.name} — package dir not found at ${pkg.dir}`);
    continue;
  }
  let pkgFail = false;
  for (const check of CHECKS) {
    const { ok, output } = check.fn(pkg);
    const tag = ok ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${pkg.name} :: ${check.label}`);
    if (!ok) {
      pkgFail = true;
      anyFail = true;
      // Surface the failing tool's output so the gate is actionable, not a bare nonzero.
      console.log(
        output
          .split('\n')
          .map((l) => `       | ${l}`)
          .join('\n'),
      );
    }
  }
  summary.push(`${pkgFail ? 'FAIL' : 'PASS'}  ${pkg.name}`);
  console.log('');
}

console.log('── pack-verify summary ──');
for (const line of summary) console.log(line);

if (anyFail) {
  console.error('\npack-verify: FAILED — at least one package failed at least one check.');
  process.exit(1);
}
console.log('\npack-verify: all packages PASSED.');
