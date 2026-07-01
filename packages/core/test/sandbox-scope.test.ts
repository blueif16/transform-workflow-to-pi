import { describe, it, expect } from 'vitest';
import { computeScopeRoots } from '../src/sandbox/scope.js';

// E11a — a `owns`/writeScope entry ending in `/*` or `/**` (or a bare `/`) is a RECURSIVE create-grant
// for that dir, NOT a literal path segment named "*". SBPL and bwrap have no glob expansion, so a raw
// `…/dir/*` becomes a `(subpath "…/dir/*")` / `--bind …/dir/*` for a non-existent dir literally named
// "*" — and creating a NEW child under the real `…/dir` then falls through deny-file-write* → EPERM
// (the live w3b-primitive-build failure: could not create the new primitive .tsx under `…/shape-primitives/*`).
// The policy must strip the trailing glob to the dir BEFORE it becomes a write root.
describe('computeScopeRoots — write-root glob normalization (E11a)', () => {
  it('strips a trailing /* or /** from a writeScope entry down to the recursive dir', () => {
    const { writeRoots } = computeScopeRoots({
      workdir: '/run/dir',
      readScope: [],
      writeScope: ['/x/star/*', '/y/globstar/**'],
    });
    expect(writeRoots).toContain('/x/star');
    expect(writeRoots).toContain('/y/globstar');
    // No `*`-bearing root survives — a `(subpath "…/*")` would grant a bogus dir literally named "*".
    expect(writeRoots.some((r) => r.includes('*'))).toBe(false);
  });

  it('leaves a bare (non-glob) writeScope path unchanged', () => {
    const { writeRoots } = computeScopeRoots({
      workdir: '/run/dir',
      readScope: [],
      writeScope: ['/a/plain/file.txt', '/b/plaindir'],
    });
    expect(writeRoots).toContain('/a/plain/file.txt');
    expect(writeRoots).toContain('/b/plaindir');
  });

  it('always includes the workdir as a write root', () => {
    const { writeRoots } = computeScopeRoots({ workdir: '/run/dir', readScope: [], writeScope: [] });
    expect(writeRoots).toContain('/run/dir');
  });
});
