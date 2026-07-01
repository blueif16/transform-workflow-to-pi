// `piflowctl blueprint list|show` — the init agent's DISCOVER→UNDERSTAND surface over the materialized
// catalog in `~/.piflow/blueprints/`. Tested through the public `runBlueprintCli` with a temp PIFLOW_HOME
// seeded with frontmatter'd fixtures + injected stdout/stderr sinks, so a subcommand is exercised as a pure
// function of (argv, on-disk blueprints) — no real readline, no real ~/.piflow, no subprocess.
//
// The load-bearing behaviors pinned here:
//   • `list` prints EACH blueprint's parsed `id — description` (the discovery line the agent scans).
//   • `list` SKIPS README.md / AUTHORING-GUIDE.md (they carry no frontmatter and are not shapes).
//   • `show <id>` dumps that blueprint's body (the understanding surface).
//   • `show <unknown>` exits non-zero AND lists the available ids (never invents a shape).
// Test-the-test target: corrupt a fixture's frontmatter `description` and the `list` assertion reddens,
// because the assertion pins the EXACT description string lifted from the fixture, not merely the id.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBlueprintCli } from '../src/blueprint.js';

/** A blueprint fixture: frontmatter (id/description) + a body line we can assert `show` returns verbatim. */
function fixture(id: string, description: string, body: string): string {
  return `---\nid: ${id}\ndescription: ${description}\ngolden: .piflow/example-${id}/template/\nparams: [N]\n---\n${body}\n`;
}

let HOME_DIR: string;
let BP_DIR: string;
let SAVED_HOME: string | undefined;

// A captured sink for the injected stdout/stderr — one string per write, joined on read.
function sink(): { text: string; write: (s: string) => void } {
  const parts: string[] = [];
  return {
    write: (s: string) => void parts.push(s),
    get text() {
      return parts.join('');
    },
  };
}

/** Run the verb against the temp home with captured sinks; returns { out, err, code }. */
async function run(...argv: string[]): Promise<{ out: string; err: string; code: number }> {
  const o = sink();
  const e = sink();
  const code = await runBlueprintCli(argv, { out: o.write, err: e.write });
  return { out: o.text, err: e.text, code };
}

beforeEach(async () => {
  HOME_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-bp-home-'));
  BP_DIR = path.join(HOME_DIR, 'blueprints');
  await fs.mkdir(BP_DIR, { recursive: true });
  await fs.writeFile(
    path.join(BP_DIR, 'alpha-shape.md'),
    fixture('alpha-shape', 'the parallel shape for "gather then design"', '# Blueprint: alpha\n\nTOPOLOGY_ALPHA_MARKER'),
  );
  await fs.writeFile(
    path.join(BP_DIR, 'beta-shape.md'),
    fixture('beta-shape', 'the loop shape for "make then gate then fix"', '# Blueprint: beta\n\nTOPOLOGY_BETA_MARKER'),
  );
  SAVED_HOME = process.env.PIFLOW_HOME;
  process.env.PIFLOW_HOME = HOME_DIR;
});

afterEach(async () => {
  if (SAVED_HOME === undefined) delete process.env.PIFLOW_HOME;
  else process.env.PIFLOW_HOME = SAVED_HOME;
  await fs.rm(HOME_DIR, { recursive: true, force: true });
});

describe('blueprint list — the discovery surface', () => {
  it('prints each blueprint id — description, exit 0', async () => {
    const { out, code } = await run('list');
    expect(code).toBe(0);
    // The EXACT id — description line, values lifted from the fixture frontmatter (not paste-the-output).
    expect(out).toContain('alpha-shape — the parallel shape for "gather then design"');
    expect(out).toContain('beta-shape — the loop shape for "make then gate then fix"');
  });

  it('skips README.md placed in the blueprints dir (not a shape)', async () => {
    await fs.writeFile(path.join(BP_DIR, 'README.md'), '# The blueprint layer\n\nnot a shape, no frontmatter.\n');
    const { out, code } = await run('list');
    expect(code).toBe(0);
    // README must NOT surface as a discoverable id, even though it is a *.md in the dir.
    expect(out).not.toContain('README');
    // and the real shapes still list.
    expect(out).toContain('alpha-shape —');
    expect(out).toContain('beta-shape —');
  });

  it('lists ids sorted (alpha before beta)', async () => {
    const { out } = await run('list');
    expect(out.indexOf('alpha-shape')).toBeLessThan(out.indexOf('beta-shape'));
  });
});

describe('blueprint show — the understanding surface', () => {
  it('dumps the requested blueprint body verbatim, exit 0', async () => {
    const { out, code } = await run('show', 'beta-shape');
    expect(code).toBe(0);
    // The full recipe, including the body marker unique to beta — proves it read beta's file, not alpha's.
    expect(out).toContain('TOPOLOGY_BETA_MARKER');
    expect(out).not.toContain('TOPOLOGY_ALPHA_MARKER');
  });

  it('unknown id exits non-zero AND lists the available ids', async () => {
    const { out, err, code } = await run('show', 'no-such-shape');
    expect(code).not.toBe(0);
    // Never invent a shape: the error surfaces the ACTUAL catalog so the agent can pick a real one.
    const combined = out + err;
    expect(combined).toContain('alpha-shape');
    expect(combined).toContain('beta-shape');
  });
});
