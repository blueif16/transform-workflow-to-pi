import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installSkills, runSkillsCli } from '../src/skills.js';

// `piflowctl skills install` ships the workflow-authoring TRIO (piflow-init/start/enhance) into ANY target
// repo's `.claude/skills/` so a fresh Claude Code agent there is equipped to compose workflows against the
// SDK. The canonical skill SOURCE stays repo-root `.claude/skills/`; the packaged copy is a generated build
// artifact (prepack). The load-bearing invariant these tests pin is ANTI-DRIFT: install is a byte-faithful
// COPY, never a transform — an installed SKILL.md must equal its canonical source byte-for-byte.

// The repo-root canonical skills dir, resolved from this test file (packages/cli/test → repo root).
const REPO_SKILLS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
  '.claude/skills',
);

let TARGET: string;
let SRC: string;
beforeEach(async () => {
  TARGET = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-skills-target-'));
  SRC = await fs.mkdtemp(path.join(os.tmpdir(), 'piflow-skills-src-'));
});
afterEach(async () => {
  await fs.rm(TARGET, { recursive: true, force: true });
  await fs.rm(SRC, { recursive: true, force: true });
});

// Build a fake skill SOURCE dir: two skill subdirs, each a SKILL.md (+ a nested references/ to prove the
// whole subtree is copied, not just the top file).
const seedFixtureSrc = async (): Promise<void> => {
  for (const name of ['alpha-skill', 'beta-skill']) {
    const dir = path.join(SRC, name);
    await fs.mkdir(path.join(dir, 'references'), { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), `# ${name}\nbody for ${name}\n`);
    await fs.writeFile(path.join(dir, 'references', 'r.md'), `ref of ${name}\n`);
  }
  // A stray FILE at the src root (not a skill dir) — must be ignored (only subdirs are skills).
  await fs.writeFile(path.join(SRC, 'README.md'), 'not a skill\n');
};

describe('installSkills — pure copy of each skill subdir into <target>/.claude/skills/', () => {
  it('lands each skill dir (with its subtree) under target/.claude/skills and returns the names', async () => {
    await seedFixtureSrc();

    const installed = installSkills(SRC, TARGET, { force: false });

    // Only the two skill SUBDIRS, not the stray README file.
    expect(installed.sort()).toEqual(['alpha-skill', 'beta-skill']);

    const skillsRoot = path.join(TARGET, '.claude', 'skills');
    // SKILL.md content intact + the nested reference subtree copied.
    expect(await fs.readFile(path.join(skillsRoot, 'alpha-skill', 'SKILL.md'), 'utf8')).toBe(
      '# alpha-skill\nbody for alpha-skill\n',
    );
    expect(await fs.readFile(path.join(skillsRoot, 'beta-skill', 'references', 'r.md'), 'utf8')).toBe(
      'ref of beta-skill\n',
    );
    // The stray non-dir at src root was not installed.
    await expect(fs.access(path.join(skillsRoot, 'README.md'))).rejects.toThrow();
  });

  it('SKIPS an existing skill dir without force, then OVERWRITES it with force:true', async () => {
    await seedFixtureSrc();
    const skillsRoot = path.join(TARGET, '.claude', 'skills');
    // Pre-existing user copy of alpha-skill with DIFFERENT content.
    await fs.mkdir(path.join(skillsRoot, 'alpha-skill'), { recursive: true });
    await fs.writeFile(path.join(skillsRoot, 'alpha-skill', 'SKILL.md'), 'USER EDIT — keep me\n');

    // force:false — alpha is skipped (not in the returned names), beta is installed.
    const installed = installSkills(SRC, TARGET, { force: false });
    expect(installed).toEqual(['beta-skill']);
    expect(await fs.readFile(path.join(skillsRoot, 'alpha-skill', 'SKILL.md'), 'utf8')).toBe(
      'USER EDIT — keep me\n',
    );

    // force:true — alpha is overwritten from source.
    const forced = installSkills(SRC, TARGET, { force: true });
    expect(forced.sort()).toEqual(['alpha-skill', 'beta-skill']);
    expect(await fs.readFile(path.join(skillsRoot, 'alpha-skill', 'SKILL.md'), 'utf8')).toBe(
      '# alpha-skill\nbody for alpha-skill\n',
    );
  });

  it('ANTI-DRIFT: an installed SKILL.md is BYTE-IDENTICAL to its canonical repo-root source', async () => {
    // Copy from the REAL canonical repo-root skills (not the fixture) so this asserts a true copy, not a
    // transform/duplicate. Compare raw bytes (Buffer.equals), the strongest no-drift guard.
    installSkills(REPO_SKILLS, TARGET, { force: false });

    for (const name of ['piflow-init', 'piflow-start', 'piflow-enhance']) {
      const canonical = await fs.readFile(path.join(REPO_SKILLS, name, 'SKILL.md'));
      const installed = await fs.readFile(
        path.join(TARGET, '.claude', 'skills', name, 'SKILL.md'),
      );
      expect(installed.equals(canonical), `${name}/SKILL.md must be a byte-identical copy`).toBe(true);
    }
  });
});

describe('runSkillsCli — install [targetDir] [--force]', () => {
  it('installs EXACTLY the workflow-authoring trio via the dev fallback (dev ≡ packaged)', async () => {
    await runSkillsCli(['install', TARGET]);

    const skillsRoot = path.join(TARGET, '.claude', 'skills');
    // The three workflow-authoring skills landed (proving srcDir resolved to the repo-root via the dev
    // fallback — the packaged skills/ dir is absent in a source checkout).
    for (const name of ['piflow-init', 'piflow-start', 'piflow-enhance']) {
      await expect(fs.access(path.join(skillsRoot, name, 'SKILL.md'))).resolves.toBeUndefined();
    }
    // The dev fallback must install ONLY the trio — not piflow-release (SDK publishing) or piflow-web-design
    // (marketing-site only), even though both sit in repo-root .claude/skills. This keeps the dev fallback
    // byte-equivalent to the prepack-filtered packaged dir, so `skills install` never leaks a non-consumer skill.
    for (const excluded of ['piflow-release', 'piflow-web-design']) {
      await expect(fs.access(path.join(skillsRoot, excluded))).rejects.toThrow();
    }
    // And nothing OUTSIDE the trio at all (e.g. unrelated repo skills like premium-saas-stack).
    const landed = await fs.readdir(skillsRoot);
    expect(landed.sort()).toEqual(['piflow-enhance', 'piflow-init', 'piflow-start']);
  });
});
