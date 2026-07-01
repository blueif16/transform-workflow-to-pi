// `piflowctl gui` — launch the run viewer (the monorepo `gui/` Vite app) from ANYWHERE on PATH.
//
// The viewer is SCOPED TO THE LAUNCHED PROJECT: it shows the project you're in (or, from a parent dir, every
// project beneath you) — never the whole accumulated global registry. Flow:
//   (1) locate `gui/` relative to this CLI (so a globally-linked `piflowctl` still finds it),
//   (2) resolve the DISPLAY SCOPE via the shared `resolveScope` (@piflow/core): the enclosing project (walk up
//       to the nearest real `.piflow/`) OR, if launched outside a project, cwd; then every product AT/UNDER it,
//   (3) start the GUI server, passing the scope via `PIFLOW_SCOPE_ROOTS` so the Vite middleware builds its
//       snapshot from EXACTLY those roots (gui/vite.config.ts → core's `loadScopedRegistry`) — WITHOUT writing
//       to the global ~/.piflow registry. The env channel is required because the spawned Vite server's own cwd
//       is `gui/`, not the user's project, so it can't self-resolve the scope.
//
// The viewer is the Vite dev server (it carries the index/products/stream middleware + HMR). It runs in the
// foreground; Ctrl-C stops it. (`piflowctl tui` is the parallel front door for the terminal viewer.)

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveScope } from '@piflow/core';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The monorepo `gui/` dir — walk up from this CLI (dist depth-agnostic) for `gui/scripts/build-index.mjs`. */
function findGuiDir(): string | null {
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    const g = path.join(dir, 'gui');
    if (existsSync(path.join(g, 'scripts', 'build-index.mjs'))) return g;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', env });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', (e) => { process.stderr.write(`piflowctl gui: failed to spawn ${cmd} (${String(e)})\n`); resolve(1); });
  });
}

export async function runGuiCli(argv: string[]): Promise<void> {
  let port: string | undefined;
  let open = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') port = argv[++i];
    else if (a === '--no-open') open = false;
    else if (a === '--open') open = true;
  }

  const guiDir = findGuiDir();
  if (!guiDir) {
    process.stderr.write('piflowctl gui: could not locate the gui/ app (expected inside the piflow monorepo).\n');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(path.join(guiDir, 'node_modules', 'vite'))) {
    process.stderr.write(`piflowctl gui: gui deps not installed — run:  ( cd ${guiDir} && npm install )\n`);
    process.exitCode = 1;
    return;
  }

  // 1) resolve the DISPLAY SCOPE — the launched project (+ nested products), or every product under cwd. Pass
  //    it to the viewer via PIFLOW_SCOPE_ROOTS so the middleware serves EXACTLY this set (no global-registry write).
  const { scopeRoot, roots } = resolveScope(process.cwd());
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (roots.length) {
    env.PIFLOW_SCOPE_ROOTS = roots.join(path.delimiter);
    process.stdout.write(`piflowctl gui: ${roots.length} project(s) in scope under ${scopeRoot}:\n`);
    for (const r of roots) process.stdout.write(`  • ${r}\n`);
  } else {
    delete env.PIFLOW_SCOPE_ROOTS; // never inherit a stale scope
    process.stdout.write(`piflowctl gui: no piflow project at or under ${scopeRoot} — showing the global fleet view.\n`);
  }

  // 2) start the viewer (Vite dev server: serves /__piflow/index|products.json + /__piflow/stream/<run>,
  //    scoped to PIFLOW_SCOPE_ROOTS when set).
  const devArgs = ['run', 'dev', '--'];
  if (port) devArgs.push('--port', port);
  if (open) devArgs.push('--open');
  process.stdout.write('piflowctl gui: starting the viewer…  (Ctrl-C to stop)\n');
  await run('npm', devArgs, guiDir, env);
}
