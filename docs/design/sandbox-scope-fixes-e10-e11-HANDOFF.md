# HANDOFF — sandbox scope fixes (E10 exec-scope · E11 write-scope + damage-proofing)

**Status:** DESIGN COMPLETE, source-grounded + externally precedented. NOT YET IMPLEMENTED. This is the
work-order to edit `@piflow/core` in THIS repo. Approved scope = Phase 0 + Phase 1.

**Author context:** produced 2026-06-30 from the FIRST live end-to-end pi run of the ported `lesson-build`
template (`animation-test/.piflow/lesson-build/`). That run also VALIDATED the `hooks`→`op[]` migration
(setup-scaffold's `op[transform:promote]` populated `state.json` live) — the two failures below are
PRE-EXISTING sandbox↔pipeline gaps surfaced by the run, NOT migration regressions.

**Every claim below cites a `file:line` read in `~/Desktop/piflow` or `~/Desktop/animation-test`. Re-verify
line numbers before editing — the repo moves.** All paths are in `packages/core/src` unless noted.

---

## 0. The exact live cases (the "why", reference these when testing)

Run `mig-e2e-1`, template `animation-test/.piflow/lesson-build/template`, provider `nebius`/GLM-5.2,
`--sandbox local` then a `--from w3a --sandbox danger-full-access` resume. Full transcripts:
`animation-test/.piflow/lesson-build/runs/mig-e2e-1/.pi/nodes/<node>/events.jsonl`. Findings write-up:
`learning-records/0002-piflow-init-gaps-from-lesson-build-port.md` §E10, §E11. Three design briefs (deeper
detail, re-openable via `SendMessage`): survey `a027bbbc8138b4393`, E10 `a75b230e223f73545`,
E11 `a73b592238a5d55b4`.

- **E10 — `w3a-voice-asr` blocked under `--sandbox local`.** Its job is `npm run lesson:voice` (TTS+ASR, a
  project-root build). Two EPERMs:
  - `Error: EPERM: operation not permitted, uv_cwd` — the build's child process cwd is the project root
    `…/remotion-svg-primitives` (OUTSIDE the run dir), and the jail grants read-data + the cwd `(literal)`
    only for the run dir.
  - `EPERM … open '/Users/tk/Desktop/shared-narration/bin/generate-voice.mjs'` — the build imports an npm dep
    from a SIBLING repo `../shared-narration`, which is in no read root.
  - Worked ONLY under `--sandbox danger-full-access` (jail fully off) — the sledgehammer we want to retire.

- **E11 — `w3b-primitive-build` blocked AND overwrote a tracked file.**
  - `owns` glob `…/src/shape-primitives/*` was NOT writable — it could not create the new primitive `.tsx` or
    append to the barrel `index.ts` (EPERM).
  - Unable to write there, the model "probed" permissions by overwriting a DIFFERENT owned path,
    `src/component-gallery/demoProps.tsx`, with placeholder content — **1347 → 193 lines, destroyed.**
    Recovered only because it was git-committed (`git checkout`). Pure luck, not a guarantee.

---

## 1. FIX 1 — E10 exec-scope: `execCwd` + `execReads` (keep the jail ON)

**Root cause (proven).** The seatbelt profile grants the cwd `(literal)` (which `getcwd`/`uv_cwd` needs — a
`(deny file-read*)` + `(allow file-read-metadata)` profile denies read-DATA on the cwd dir entry) only for the
run-dir `workdir` (`seatbelt.ts:166-170` `cwdLits` derives from `opts.workdir` ONLY). The exec seam adds only
the AGENT's cwd (`local.ts:120,129` — again `this.workdir`, the run dir), never the build child's project
root. And `readScope`→read roots (`scope.ts:71-97` `computeScopeRoots`, rendered `(subpath …)` at
`seatbelt.ts:165`) never lists `../shared-narration` (a sibling of the workspace, matching no auto-grant).
`w5-render` sidesteps all this only because it's `programmatic:true` → runs UNSANDBOXED on host
(`types.ts:98-102`); `w3a` CANNOT be programmatic — it needs the MODEL to verify ASR + re-roll
(CLAUDE.md "VOICE OUTPUT IS VERIFIED, NOT TRUSTED").

**Design — two additive node.json `contract` fields, honored by the SDK:**
- `execCwd: string` — the dir the node's build runs from (e.g. `{{WORKSPACE}}/remotion-svg-primitives`).
  Passed as exec cwd, unioned into read roots, AND granted as a `(literal)` so `getcwd` succeeds.
- `execReads: string[]` — extra external read roots the build imports (e.g. the sibling kit). Unioned into the
  jail's read `(subpath …)` set (realpath-expanded like every other root).

Additive: a node without them is byte-identical to today. This is exactly Codex `writable_roots` / Bazel
execroot / bubblewrap `--ro-bind` multi-root precedent (survey brief `a027bbbc`).

**Change points (verify line numbers):**
1. `types.ts` — `SandboxSpec` (~226-251): add `execCwd?: string; execReads?: string[];`. `CreateOpts`
   (~518-539): add the same so the runner threads them to the provider.
2. Template loader (`toNodeIntent`, `workflow/template/loader.ts` ~119-145 where `sandbox.read = c.readScope`):
   add `sandbox.execCwd = c.execCwd`, `sandbox.execReads = c.execReads`. Add both to the node.json JSON-Schema
   `contract` `$defs` (string + string[], `minLength:1`). `dag.ts:27-38 materialize` copies `SandboxSpec`
   fields — carry the two new ones there too.
3. **Token resolution (do NOT skip).** `runner/node-lifecycle.ts:181-182` ALREADY resolves
   `read: resolveAll(srcNode.sandbox.read, resolveCtx)` / `write: resolveAll(…)`. **Add `execCwd`/`execReads`
   to that SAME `resolveAll` block** (execCwd via `resolveTokens`, execReads via `resolveAll`) so
   `{{WORKSPACE}}`/`{{arg.*}}`/`{{state.*}}` are physical before `scope.create`. (design-e10 flagged this as an
   open risk assuming sandbox paths weren't resolved — they ARE, at 181-182; just extend it.)
4. `runner/node-lifecycle.ts:217` `scope.create({ readScope: node.sandbox.read, writeScope: node.sandbox.write,
   … })`: also pass `execCwd: node.sandbox.execCwd, execReads: node.sandbox.execReads`.
5. `sandbox/local.ts` — constructor (58-69) + `create` (77-96): store `execCwd`/`execReads`. `exec` (118-133):
   `const cwd = opts.cwd ? this.abs(opts.cwd) : (this.execCwd ?? this.workdir);` and union execReads into the
   read scope: `readScope: [...this.readScope, ...(this.execReads ?? []), cwd]` (extends line 129).
6. `sandbox/seatbelt.ts` — `buildSeatbeltProfile` (154-180): thread `execCwd`; extend `cwdLits` (168-170) to
   include `execCwd` (realpath-expanded) as a `(literal)` — THIS is the `uv_cwd` fix. `execReads` already flow
   as `(subpath …)` via `computeScopeRoots`. No `read-scope.sb` edit — both land at the existing
   `@SCOPE_ALLOWS@` site (`read-scope.sb:76-77`). `process-fork`/`process-exec*` already open
   (`read-scope.sb:39 (allow default)`), so the build can spawn npm/node.
7. `sandbox/bwrap.ts` — `buildBwrapArgs` (216-260): when `execCwd` set, emit `--chdir <execCwd>` (instead of
   the workdir at 253) + ensure it's `--ro-bind`'d; `execReads` render as `--ro-bind` (244). (Linux lane;
   untested on this macOS host — argv construction by symmetry, cited to bwrap(1) `--chdir` + ArchWiki
   npm-in-project-root recipe.)

**Immediate w3a template fix** (`animation-test/.piflow/lesson-build/template/nodes/w3a-voice-asr/node.json`,
add to `contract`):
```jsonc
"execCwd": "{{WORKSPACE}}/remotion-svg-primitives",
"execReads": ["/Users/tk/Desktop/shared-narration"]
```
**Open risks:** (a) the sibling path is machine-specific + violates "no hardcoded paths" — needs a
`{{WORKSPACE_PARENT}}`-style token or the kit vendored under the workspace; (b) UNVERIFIED whether the kit is
imported via a symlinked `node_modules/@studio/narration-kit` whose realpath already resolves under
`readScope` (`scope.ts:34 expandRealpath` grants the realpath) — check BEFORE assuming `execReads` is even
needed for the READ half (the cwd `(literal)` half is definitely needed); (c) if the build `getcwd`s from
INSIDE the sibling kit, that root needs a `(literal)` too, not just a `(subpath)`.

**Why safer than danger-full-access:** the read jail stays ON (danger sets `enforceReadScope:false` →
`local.ts:126` runs BARE, full host read); the node gains ONLY `{execCwd, execReads}`; the write jail is
untouched; the grant is auditable in the node.json diff + the rendered `.sb`.

---

## 2. FIX 2 — E11 write-scope + damage-proofing

### 2a. Glob is not a create-grant (the immediate w3b unblocker — ~1 line)

**Root cause (proven).** `scope.ts:95` `writeRoots = [...new Set([workdir, ...owns].flatMap(expandRealpath))]`.
`expandRealpath` (`scope.ts:34-42`) does `realpathSync`; for `…/src/shape-primitives/*` the literal `*` is a
filename, `realpathSync` throws ENOENT, the `catch` (`scope.ts:39`) returns the literal string WITH the `*`.
`seatbelt.ts:175` then emits `(subpath "/…/src/shape-primitives/*")` — SBPL has NO glob expansion, so this
grants a non-existent dir literally named `*`. Creating `counting.tsx` / a new `.tsx` / writing `index.ts`
under the real dir is NOT under that path → falls through `(deny file-write*)` (`seatbelt.ts:95`) → EPERM.
(`bwrap.ts:182-196 existing()` `statSync`-drops the `/*` literal too — both backends deny.)

**Fix — `scope.ts:95`, one helper:** strip a trailing `/`, `/*`, or `/**` so the DIR becomes a recursive
write subtree (a `(subpath DIR)` inherently authorizes creating children):
```ts
// a trailing "/", "/*", or "/**" ⇒ recursive dir create-grant → strip to the dir; bare path unchanged.
const normalizeWriteRoot = (p: string) => p.replace(/\/(\*\*?|)$/, '') || p;
const writeRoots = [...new Set(
  [workdir, ...(opts.writeScope ?? [])].map(normalizeWriteRoot).flatMap(expandRealpath),
)];
```
Document the convention in `types.ts` (`CreateOpts.writeScope` doc ~520) + the template `contract.owns`
schema: *"an `owns` entry ending in `/` (or `/*`,`/**`) is a recursive create-grant for that dir; a bare path
is a single-file grant."* NO new `owns` grammar (the space-separated `DRIVER-OWNS` codec at `contract.ts:118`
/ `parseMarkers` `spaceList` at `contract.ts:143` assumes plain strings — the suffix convention round-trips
unchanged).

**Immediate w3b template fix** (`…/nodes/w3b-primitive-build/node.json`): change
`…/src/shape-primitives/*` → `…/src/shape-primitives/` (trailing slash). KEEP `demoProps.tsx` in `owns` — w3b
legitimately appends a `demoProps` entry per new primitive (the registration gate requires it); protect it via
2c, don't remove it.

### 2b. `danger-full-access` posture — messaging + a write-only middle ground

**Contradiction RESOLVED (do not re-litigate, but DO confirm the E12 sub-finding).** design-e11 proved from
source that `--sandbox danger-full-access` runs BARE: `run.ts:504-506` → `makeLocalProvider({dangerous:true})`
(`run.ts:359`) → `enforceReadScope:false` → `local.ts:126 if (this.enforceReadScope && cmd)` is false ⇒
`plan=null` ⇒ no `sandbox-exec` wrapper ⇒ NO `(deny file-write*)` ⇒ writes SUCCEED. `enforceReadScope` is a
SINGLE flag gating BOTH jails (`types.ts:524`). So writes are NOT jailed under true danger.
**Why w3b still EPERM'd under our `--from … --sandbox danger-full-access` resume:** the run's
`.pi/run.json` records `"sandbox": "local"` — i.e. the RESUME reused the original launch's persisted `local`
posture for the (resumed) nodes even though the CLI printed the danger banner. So w3b ran JAILED → the glob
(2a) EPERM'd. **NEW finding E12 (verify + likely a separate fix): a `--sandbox` override on a `--from` resume
of an existing run may not re-apply to persisted node config.** This is the ONE thing to confirm empirically
before shipping the posture rename below (5-min: re-run w3b bare vs the run.json record).

**Fix — name both axes; add a write-only mode:**
- Rename the operator-facing text. `run.ts:504-506` danger message → `⚠ DANGER — filesystem isolation
  BYPASSED (read AND write): the agent can read your entire filesystem and write anywhere.` `run.ts:501`
  (`local`) → append `… writes are jailed to each node's owns (create-grants included).`
- Add `fullWrite?: boolean` to `SandboxSpec` (`types.ts:242`, beside `fullAccess`) + `enforceWrite?` to
  `CreateOpts` (~526,535). Split the profile so `seatbelt.ts` (154-180) + `local.ts:125-133` emit the
  read-allow block only when `enforceRead` and the `(deny/allow file-write*)` block only when `enforceWrite`
  (today the template always emits both). Add CLI `--sandbox danger-full-write` (writes free, reads jailed) —
  the exact E11 need (create-heavy node without full disk read). ADD A TEST asserting the emitted SBPL
  contains/omits each block per posture (precedent: `sandbox-bwrap.test.ts` argv assertions).

### 2c. Damage-proof writes — "block WITHOUT side-effects" (the important half)

**Root cause (proven).** The ONLY write gate is the OS jail at `owns` granularity (`seatbelt.ts:95-96,175`);
`artifacts` is stat-only (`runner.ts` existence/schema checks), NEVER a write allowlist; `owns \ artifacts` is
fully writable; `dispose` is a no-op (`local.ts:237-239`); no snapshot/rollback. So the `demoProps.tsx`
overwrite was "within contract" (it's an owned path) and recoverable only by git luck. A failing node has
unrestricted authority to corrupt every file it owns.

**Fix (ship (b)+(d); (c) as a later tightening; (a) as roadmap):**
- **(b) per-node snapshot → restore-on-failure (the load-bearing guarantee).** New seam in
  `runner/node-lifecycle.ts` around `scope.create` (217) / `finishNode` on non-`ok` (~236): BEFORE exec,
  snapshot the node's owned set (for git-tracked owned paths, record `HEAD` + a targeted `git diff` of just
  those paths; for create-grant dirs, record the pre-existing file listing; **for untracked-but-existing owned
  files, content-snapshot (hash/tar) — do NOT lean on git**, or an untracked clobber is unrecoverable). On any
  non-`ok` finish, restore: `git checkout -- <owns∩tracked>` + delete newly-created files under create-grant
  dirs. Gate behind a `damageProof` runner flag, default ON for `--sandbox local`, OFF for cloud (the VM is
  the boundary). Write the snapshot DURABLY before exec (a crash mid-write leaves a small window — (a)/(c)
  close it, at higher cost). Precedent: DeltaBox (arXiv 2605.22781), `gofs`/Mesa git-snapshot-per-action.
- **(d) anti-probe-write preamble clause** (template prompt — the E8 FILE-OP DISCIPLINE clause's neighbor; add
  to BOTH `animation-test/.claude/workflows/lesson-build.js discipline()` AND the extracted `.piflow`
  template prompts): *"NEVER write to an owned path to test permissions. A node that cannot produce its
  declared OUTPUT must BLOCK (status `blocked` + a pipelineFinding) WITHOUT mutating any other owned file.
  Owned paths that are not your declared artifact are inputs you edit ONLY as your real task requires, never
  as scratch."* Advisory (a cheap model already violated the analogous READING LAW, E9) — necessary, not
  sufficient; (b) is the real guarantee.
- **(c) LATER — restrict writes to declared `artifacts` (owns ⊇ artifacts).** Prevents rather than repairs
  (the probe-write EPERMs instead of clobbering), but needs every intended write target enumerated in
  `artifacts`/a new `writeTargets` (w3b legitimately writes `primitive-registry.json`, `catalog-digest.md`,
  `demoProps.tsx` — all owned, none in `artifacts` today, so pure-(c) would break them). Adopt once write
  targets are enumerated.
- **(a) ROADMAP — COW overlay (apply-or-discard).** Gold standard (physical immutability; also subsumes the
  E10 cwd EPERM + the E9 `find /`): writes to a per-node upperdir, committed to the repo only on success.
  Linux `overlayfs`/`fuse-overlayfs` in a mount namespace; macOS has none natively (Turso AgentFS pairs a
  FUSE overlay WITH `sandbox-exec` — the exact primitive piflow uses, so it's buildable). Big cross-platform
  build — not Phase 0/1. On macOS the cheap interim is your existing `EnterWorktree` (git-worktree per node),
  but it does NOT cover gitignored generated files → still need (b)'s content-snapshot for those.

---

## 3. Phasing + acceptance

| Phase | Change | Done when |
|---|---|---|
| **0 — unblockers** | 2a `normalizeWriteRoot` (1 line) · Fix 1 `execCwd`/`execReads` (+ token-resolve at node-lifecycle:181-182) | a live `lesson-build` run of a lesson that needs a NEW primitive completes `w3b` + `w3a` under `--sandbox local` (no `danger`). Re-run `kptest-count-to-two`. |
| **1 — durable safety** | 2c(b) snapshot→restore · 2c(d) anti-probe preamble · 2b posture split + messaging (after confirming E12) | a node forced to fail mid-write leaves every owned file byte-identical (assert on a fixture that clobbers then throws) · console prints read AND write posture. |
| **2 — roadmap** | 2c(a) COW overlay | deferred. |

**TEST-FIRST (test-discipline skill).** Each fix ships with a test that FAILS on the current code:
- 2a: a unit test that `computeScopeRoots({writeScope:['/x/dir/*']})` yields a write root `/x/dir` (not
  `/x/dir/*`), and a seatbelt-profile test that the emitted SBPL contains `(subpath "/x/dir")`.
- Fix 1: a seatbelt-profile test that with `execCwd` set, the profile emits a `(literal <execCwd>)` and a
  `(subpath <execReads[i]>)`; a bwrap argv test for `--chdir <execCwd>`.
- 2c(b): a runner test — a node that writes an owned file then finishes non-`ok` → the file is restored to its
  pre-run bytes (tracked AND untracked cases).
- 2b: SBPL block presence/absence per `{enforceRead, enforceWrite}` posture.

**Discipline:** these are GENERIC mechanisms → they live in `@piflow/core` (never a per-product template
patch) [user directive: generic-mechanisms-go-in-the-SDK]. Additive + product-agnostic + test-backed. Branch
`fix/sandbox-scope-e10-e11`; one commit per coherent unit (2a · Fix1 · 2c(b) · 2b); run the package test suite
green before each commit. The template-side `node.json` edits + the (d) preamble land in `animation-test`
(a separate repo/commit).

---

## 4. References
- Findings: `learning-records/0002-piflow-init-gaps-from-lesson-build-port.md` §E10, §E11 (+ add §E12 for the
  resume-posture finding above).
- Live evidence: `animation-test/.piflow/lesson-build/runs/mig-e2e-1/.pi/` (run.json shows `sandbox:local`;
  `nodes/w3a-voice-asr/events.jsonl` + `nodes/w3b-primitive-build/events.jsonl` for the verbatim EPERMs).
- Design briefs (full `file:line` + 19 cited external sources): `SendMessage` to survey `a027bbbc8138b4393`,
  E10 `a75b230e223f73545`, E11 `a73b592238a5d55b4`.
- External precedent worth reading before implementing: Codex `sandbox_workspace_write.writable_roots` +
  protected-paths-in-writable-roots (developers.openai.com/codex); Bazel execroot (bazel.build/docs/sandboxing);
  bubblewrap `--ro-bind`/`--chdir` (bwrap(1)); Turso AgentFS overlay + sandbox-exec (turso.tech).
