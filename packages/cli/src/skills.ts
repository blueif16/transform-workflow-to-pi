// `piflowctl skills install [targetDir] [--force]` — ship piflow's WORKFLOW-AUTHORING skills (the trio
// piflow-init / piflow-start / piflow-enhance) into ANY target repo's `.claude/skills/`, so a fresh Claude
// Code agent there is equipped to compose workflows against the SDK. The skills ARE the SDK's authoring
// brain; this is how they travel out of this repo.
//
// NO-DRIFT BUNDLING DESIGN (the load-bearing constraint — same discipline as the generated workflow.json):
//   • The CANONICAL skill source is repo-root `.claude/skills/` — the ONE editable copy.
//   • The PACKAGED copy under `packages/cli/skills/` is a GENERATED build artifact: a `prepack` script copies
//     `../../.claude/skills/piflow-{init,start,enhance}` there before `npm pack`, it's in the tarball `files`
//     AND in `.gitignore` (never a committed duplicate that could drift).
//   • `installSkills` is a PURE byte-faithful COPY (never a transform) → an installed SKILL.md is
//     byte-identical to its canonical source. That equality is what the anti-drift test pins.

import { existsSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The workflow-authoring TRIO — the ONLY skills that ship to a consumer repo. EXCLUDES `piflow-release`
// (publishing the SDK itself) and `piflow-web-design` (marketing-site only). The prepack script copies
// exactly these into the packaged dir; the dev fallback applies the same allowlist so dev ≡ packaged.
export const TRIO = ['piflow-init', 'piflow-start', 'piflow-enhance'] as const;

/**
 * Copy each skill SUBDIR of `srcDir` into `<targetDir>/.claude/skills/<name>`, returning the names actually
 * installed. Pure over the filesystem (no path resolution, no argv) so the copy logic is unit-testable
 * independent of where the packaged skills live. Only immediate SUBDIRECTORIES of `srcDir` are skills (a
 * stray file at the src root is ignored); an optional `only` allowlist further restricts to those names.
 * An existing skill dir is SKIPPED unless `force` (then overwritten).
 */
export function installSkills(
  srcDir: string,
  targetDir: string,
  opts: { force: boolean; only?: readonly string[] },
): string[] {
  const skillsRoot = path.join(targetDir, '.claude', 'skills');
  mkdirSync(skillsRoot, { recursive: true });

  const allow = opts.only ? new Set(opts.only) : null;
  const names = readdirSync(srcDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => allow === null || allow.has(n))
    .sort();

  const installed: string[] = [];
  for (const name of names) {
    const dest = path.join(skillsRoot, name);
    if (existsSync(dest) && !opts.force) continue; // keep the user's copy unless --force
    // recursive byte-faithful copy of the whole skill subtree (SKILL.md + references/ + scripts/).
    cpSync(path.join(srcDir, name), dest, { recursive: true, force: true });
    installed.push(name);
  }
  return installed;
}

/**
 * Resolve the SOURCE skills dir for the CLI: the PACKAGED `<packageRoot>/skills` (shipped in the npm tarball,
 * relative to the compiled cli.js/skills.js), with a DEV FALLBACK to the repo-root `.claude/skills` when the
 * packaged dir is absent (a source checkout / the test runner). Both `dist/skills.js` and `src/skills.ts`
 * sit one level under the package root, so `..` = package root and `../../..` = repo root for either.
 */
function resolveSkillsSrc(): { dir: string; isDevFallback: boolean } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packaged = path.join(here, '..', 'skills');
  if (existsSync(packaged)) return { dir: packaged, isDevFallback: false };
  return { dir: path.join(here, '..', '..', '..', '.claude', 'skills'), isDevFallback: true };
}

/** `piflowctl skills install [targetDir] [--force]` — install the trio into a target repo. */
export async function runSkillsCli(argv: string[]): Promise<void> {
  const [action, ...rest] = argv;
  if (action !== 'install') {
    process.stderr.write(`piflowctl skills: unknown action '${action ?? ''}' (expected: install)\n`);
    process.exitCode = 1;
    return;
  }

  const force = rest.includes('--force');
  const targetDir = rest.find((a) => !a.startsWith('-')) ?? process.cwd();

  // The packaged dir is already prepack-filtered to the trio; the dev fallback (full repo-root .claude/skills)
  // applies the TRIO allowlist so a source-checkout install matches the published tarball exactly.
  const { dir: srcDir, isDevFallback } = resolveSkillsSrc();
  const installed = installSkills(srcDir, targetDir, { force, only: isDevFallback ? TRIO : undefined });
  const skillsRoot = path.join(targetDir, '.claude', 'skills');

  if (installed.length === 0) {
    process.stdout.write(
      `piflowctl skills: nothing installed — all skills already present in ${skillsRoot} (re-run with --force to overwrite)\n`,
    );
    return;
  }
  process.stdout.write(
    `piflowctl skills: installed ${installed.length} skill(s) into ${skillsRoot}\n` +
      installed.map((n) => `  • ${n}`).join('\n') +
      '\n',
  );
}
