// `piflowctl tui` — launch the terminal run viewer (the monorepo `tui/` Ink app) from ANYWHERE on PATH.
//
// The parallel of `piflowctl gui` for the terminal. Same SCOPING: in FLEET mode (no <rundir>) it resolves the
// launched project's product roots via the shared `resolveScope` (@piflow/core) and passes them to the TUI via
// `PIFLOW_SCOPE_ROOTS`, so the fleet dashboard shows the project you launched it in — not the whole global
// registry. A `<rundir>` argument opens that ONE run (scope is irrelevant there, so it's skipped).
//
// Args pass THROUGH to the TUI verbatim: `piflowctl tui [<rundir>] [--every <s>]`. The TUI is spawned in the
// USER's cwd so a relative <rundir> still resolves; its own deps resolve relative to pi-tui.mjs, not cwd.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveScope } from '@piflow/core';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The monorepo `tui/` dir — walk up from this CLI (dist depth-agnostic) for `tui/pi-tui.mjs`. */
function findTuiDir(): string | null {
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    const t = path.join(dir, 'tui');
    if (existsSync(path.join(t, 'pi-tui.mjs'))) return t;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** Does argv carry a <rundir> positional (⇒ SINGLE mode)? Mirrors the TUI's own parse: the first non-`--`
 *  token is the rundir, and `--every` consumes the next token as its value. */
function hasRunDir(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--every') { i++; continue; }
    if (!a.startsWith('--')) return true;
  }
  return false;
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', env });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', (e) => { process.stderr.write(`piflowctl tui: failed to spawn ${cmd} (${String(e)})\n`); resolve(1); });
  });
}

export async function runTuiCli(argv: string[]): Promise<void> {
  const tuiDir = findTuiDir();
  if (!tuiDir) {
    process.stderr.write('piflowctl tui: could not locate the tui/ app (expected inside the piflow monorepo).\n');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(path.join(tuiDir, 'node_modules', 'ink'))) {
    process.stderr.write(`piflowctl tui: tui deps not installed — run:  ( cd ${tuiDir} && npm install )\n`);
    process.exitCode = 1;
    return;
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  // FLEET mode (no <rundir>): scope the dashboard to the launched project. SINGLE mode reads one run — scope is
  // irrelevant, so leave the env clean (never inherit a stale scope).
  if (hasRunDir(argv)) {
    delete env.PIFLOW_SCOPE_ROOTS;
  } else {
    const { scopeRoot, roots } = resolveScope(process.cwd());
    if (roots.length) {
      env.PIFLOW_SCOPE_ROOTS = roots.join(path.delimiter);
      process.stdout.write(`piflowctl tui: ${roots.length} project(s) in scope under ${scopeRoot}:\n`);
      for (const r of roots) process.stdout.write(`  • ${r}\n`);
    } else {
      delete env.PIFLOW_SCOPE_ROOTS;
      process.stdout.write(`piflowctl tui: no piflow project at or under ${scopeRoot} — showing the global fleet view.\n`);
    }
  }

  await run('node', [path.join(tuiDir, 'pi-tui.mjs'), ...argv], process.cwd(), env);
}
