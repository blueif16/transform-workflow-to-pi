# Worktree isolation (opt-in physical isolation for parallel runs)

When a fleet of runs share ONE working tree, a cheap model in run A can wander into run B's files —
read them as "reference", or worse, write into them. The Output Contract (`artifact-contract.md`)
makes the *silent-failure* half loud (a node that produced nothing for its own lane fails as
`blocked`). Worktree isolation closes the other half: it makes the *wander itself impossible* by
giving each run its own full checkout.

## What `--worktree` does

`node pi-runner/run.mjs --run <id> --worktree …` (or `PI_RUNNER_WORKTREE=1`):

1. **Creates a per-run git worktree** — `git worktree add -B pi/<id> <sibling>/.pi-worktrees/<id> HEAD`.
   A full, separate checkout on its own branch, at a sibling dir OUTSIDE the repo (no gitignore, no
   recursion). It starts from committed `HEAD` — a clean room. Uncommitted main-tree changes are
   intentionally absent, so **pass the run's input via `--arg`/`--brief`/`--arg-file`** rather than
   relying on an uncommitted file.
2. **Symlinks `node_modules`** from the main checkout (it is gitignored, so the fresh checkout has
   none) for **every package in the repo** — each tracked `package.json`'s dir (discovered via
   `git ls-files`) plus the repo root and cwd. A multi-package repo (e.g. a `packages/verify`
   harness with its own deps) thus has all its scripts runnable inside the worktree; a single-package
   repo links just root.
3. **Remaps execution** — `ROOT`/`RUN_CWD` (where pi runs + where artifacts resolve) point at the
   worktree. Each node's prompt has the workflow's hardcoded absolute paths rewritten
   `BASE_ROOT→<worktree>` ONCE, so the agent writes INTO the worktree AND the driver's own marker
   checks (`DRIVER-PREFLIGHT` / `DRIVER-ARTIFACTS` / `DRIVER-OWNS`) resolve there too. Paths outside
   the repo (shared kits, etc.) are left untouched.
4. **Keeps status + logs in the MAIN tree** — `out/<id>/run-status.json`, `_pi/*.events.jsonl`,
   prompt files. So `status.mjs` / `watch.mjs` / polling are unaffected and survive teardown.
5. **On finish** — commits the lesson SOURCE to branch `pi/<id>`, copies the deliverable
   `out/<id>/` back to the main tree (it is gitignored, so it would vanish with the worktree), then
   removes the worktree (the branch persists for a human-gated merge). On failure (or
   `--keep-worktree`) the worktree is KEPT for inspection.

## Why it needs auto-discovered registration

Worktree isolation's one cost is **merge-back**: N branches that each hand-appended to a shared file
(e.g. a Remotion `Root.tsx` `<Composition>` list) collide on it. The companion change — **auto-discovered
registration** (the composer registers a lesson by exporting a descriptor from its OWN file; a
generated index discovers it; nobody edits the shared list) — makes every per-lesson change a set of
DISJOINT paths. Then merge-back is a conflict-free union:

```
# integrate a finished lesson branch onto main (human-gated):
git checkout main
git merge --no-edit pi/<id>          # disjoint lesson files → no conflict
npm run lessons:registry             # (+ registry:build if the lesson minted a new primitive)
git commit -am "integrate <id>"      # regenerate shared catalogs, don't hand-merge them
```

The generated catalogs (lesson registry, primitive registry) are the only non-disjoint files; they
are **regenerated** on main, never hand-merged — exactly how the primitive registry already behaves
when two lessons both add a primitive.

## Verification status

The git mechanics (create / symlink / teardown), the `--worktree` arg plumbing, the dry-run
skip, and the prompt-rewrite (BASE_ROOT→worktree retargets the contract markers; kit paths
untouched) are all verified. The full end-to-end (a real isolated pi render producing an MP4) must be
validated on a machine with a Remotion-compatible Node — it is the "validation = a real clean-room
run" rule, and it is the natural next step the first time the fleet runs with `--worktree`.
