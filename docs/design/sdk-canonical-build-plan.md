# SDK canonical build plan — promote the consumer glue INTO `@piflow/core`

> **Strategy (set 2026-06-23).** Build the robust, canonical version of each "consumer glue" feature
> **in `@piflow/core` upstream, independently** — NOT a port of game-omni's local `pi-runner/sdk/`.
> game-omni's glue *works*, but it carries gap-workarounds and local habits; the upstream version is the
> best-practice basis future updates build on. Every change here is **ADDITIVE** — the existing game-omni
> consumer keeps running unchanged. **Phase 2 (deferred):** once upstream ships these, migrate the local
> repo to consume them (delete its local copies). Do NOT do the consumer opt-in in this phase.
>
> Source: four read-only planning agents (2026-06-23) over the real code; this doc is their synthesis.
> Each unit is test-first (`test-discipline`): a new failing test mirroring the named existing test file,
> then the impl, then a mutation self-check on the load-bearing assertion.

## Load-bearing canonical decisions (the "best version", with rationale)

- **D1 — OPEN-1 is a RUNNER bug, fix it at the root.** The runner stages three FIXED files —
  `_pi/prompt.md` (`runner.ts:444`), `_pi/tools.ts` (`:451`), `_pi/mcp.json` (`:399/459`) — so parallel
  nodes that share a workspace (the in-place case) clobber each other. game-omni worked around it THREE
  times (the `execCwd` decoupling, the absolute `@promptFile`, the `wf.nodes` `sandbox.workspace` mutation).
  **Fix:** namespace the staged files per node — `_pi/<id>/{prompt.md,tools.ts,mcp.json}` — so EVERY
  provider is collision-safe and the three hacks dissolve. Unconditional (strictly safer; InMemory just
  gains a dir level).
- **D2 — in-place sandbox = a first-class `'local'` kind.** `'inmemory'` *means* wipe-on-dispose
  (`InMemorySandbox.dispose` does `fs.rm(root)`); in-place is the semantic opposite (NEVER delete the user's
  tree). Reusing `'inmemory'` (what game-omni does) is a deliberate lie. Add `'local'` to
  `SandboxProviderKind` (the one designed extension point), model in-place as the **trivial `RunScope`**
  (root = repoRoot; per-node `create`; no-op run-level `dispose`), make `downloadDir` **guarded-identity**
  (throw on a real mismatch, not a silent no-op), and **extract the shared `exec` helper** (the 4 providers
  duplicate it).
- **D3 — the registry stays the single tool authority.** game-omni reads `node.tools` directly in its
  command builder and uses a synthetic `nativeToolRegistry` to NO-OP the bind check — both because the
  registry can't resolve the BARE pi names (`read`/`write`) the workflow authors (it addresses builtins as
  `fs:read`). **Fix:** the builtin registry resolves bare pi names (alias) AND `resolve()` returns
  `excludeTools` (from `node.tools.deny`) in `ResolveResult`. Then `defaultPiCommand` derives both
  `--tools` and `--exclude-tools` from `resolved` — no node.tools read, no hack. The dry-run
  `auditWorkflow` keeps the gate-3 whitespace/collision protection.
- **D4 — the two-base distinction is load-bearing → a spine field, not a closure footgun.** Hook POST
  executors need BOTH the repo root (resolves repo-relative marker paths) and the project base
  (`out/<run>`, where ops write). game-omni threads this out-of-band with a `ctx + resolveProjectBase`
  closure whose `?? workspace ?? runCwd` fallback is the silent-misresolve trap. **Fix:** add
  `HookContext.projectBase` (required, explicit); `runHooks` sets it. The DRIVER→Hook codec becomes
  `makeHookCodec(families)` + batteries-included `DRIVER_FAMILIES`; `extractWorkflow`/`extractSpec` promote
  into core; op executors promote with an injected `assetConventions` (the `sprite/tileset/public-assets`
  vocabulary is game-domain — it does NOT go into core); seed-staging consolidates into ONE core executor.
- **D5 — `runFromConfig` is env-agnostic; the CLI owns the convention.** Core ships
  `runFromConfig(resolvedConfig)` (a plain object — no env parsing) so a library consumer passes an object;
  `loadConfig` + the `PI_RUNNER_*` names live in core's CLI layer behind a `piflow run [--dry-run]`
  subcommand. `returnProtocol` generalizes (any pi node needs the write-then-fence handshake) → a default
  `RunOptions.returnProtocol`. **The bridge stays consumer-injected** (it is workflow-dialect-specific):
  `runFromConfig` takes a `workflowSpec`/`buildWorkflowSpec`, it does NOT own the bridge.
- **D6 — node→node values flow through a per-thread RunState, not file-pointers.** Re-pointing at a
  producer's physical file each time (`templates/genres/{out/<run>/spec/classification.json:archetype}.json`)
  couples value · producer-filename/shape · physical location; it resolves only in-place (`resolveSeedTokens`
  → `path.resolve(RUN_CWD, …)`, game-omni `run.mjs:398`) and survives worktree relocation only via a
  `BASE_ROOT→wtRoot` string regex (`run.mjs:331`) that does not cover remote providers. **Fix:** the thread
  carries a LangGraph-style state-channel object (`${RUN}/_state.json`); a POST-hook `promote` op lifts a
  node's output into a channel; consumers reference `${state.<channel>}` plus two engine-resolved logical
  roots — `${WORKSPACE}` (canonical, read-only, OUT-OF-THREAD: skills + registry + components) and `${RUN}`
  (per-thread, mutable, collected). State drives VALUES only (paths/scope/interpolation), resolved at launch
  → static-DAG- and extraction-safe; it never drives ROUTING. **Reshapes U6 + U7.** Full model: the
  *Per-thread RunState* section below.

## Build order (each: additive · test-first · its own commit · mirrors the named test file)

| # | Unit | Files | Test mirror | Effort |
|---|---|---|---|---|
| **U1** | Runner per-node staging `_pi/<id>/{prompt,tools,mcp}` (D1) | `runner.ts` | `test/runner.test.ts` (recording-provider writeFile capture) | S–M |
| **U2** | `LocalSandboxProvider` + `'local'` kind + RunScope + exec-helper extract (D2) | `src/sandbox/local.ts`, `types.ts:44`, `index.ts`, `src/sandbox/index.ts` | `test/sandbox.test.ts`, `test/sandbox-worktree.test.ts` | S–M |
| **U3** | Registry: resolve bare builtins + `excludeTools` in `ResolveResult` (D3) | `src/tools/registry.ts`, `types.ts` (ResolveResult), `src/tools/verify.ts` | `test/tools.test.ts` | M |
| **U4** | `defaultPiCommand(node, resolved, ctx, opts?)` — `thinking`, `extraExtensions`, `--exclude-tools` (D3) | `src/runner/command.ts`, `types.ts` | `test/runner.test.ts` (defaultPiCommand block) | S |
| **U5** | `extractWorkflow` → core (D4-A) | `src/workflow/extract.ts`, `index.ts` | new, vs a fixture workflow | S |
| **U6** | RunState spine: `HookContext.{workspace,projectBase}` logical roots + RunState load/merge/persist + `makeHookCodec`/`DRIVER_FAMILIES` (+`promote`) + `extractSpec` (D4-B, **D6**) | `types.ts`, `src/hooks/index.ts`, `src/workflow/{codec,bridge}.ts` | `test/contract.test.ts`, `test/dag.test.ts`, `test/hooks.test.ts` | M |
| **U7** | Op executors + the `${state.*}`/`${WORKSPACE}`/`${RUN}` resolver + `promote` POST-op + `assetConventions` (retires the `BASE_ROOT→wtRoot` regex + RUN_CWD-relative `{file:field}`) (D4-C, **D6**) | `src/workflow/ops/*` | port game-omni `hooks/test/*` | L |
| **U8** | `runFromConfig` + `loadConfig` + `piflow run [--dry-run]` + `RunOptions.returnProtocol` (D5) | `src/runner/{entry,config}.ts`, `src/cli.ts`, `runner.ts` | `test/runner.test.ts` | M |

Sequence: U1 first (unblocks the clean U2/U4 by killing the hacks); U2/U3/U5 are independent; U4 depends on
U3; U6 depends on U5; U7 depends on U6; U8 composes the rest. U7 is the only L — split further if needed.
**D6 reshapes U6 (the RunState spine + the two logical roots) and U7 (the `${state}`/root resolver + the
`promote` op); U4 is orthogonal to state and unaffected.**

## Per-thread RunState (D6) — the run-level state + addressing model

> Added 2026-06-23 from the design discussion. The earlier "token on the read-scope marker" question is
> SUBSUMED here: archetype-narrowed read-scope is just one CONSUMER of `${state.archetype}`. The per-thread
> filesystem mechanics (worktree canonical-file access + remote workspace staging) are being confirmed by a
> read-only investigation; the subsection below states the model and flags the open items.

**Problem.** Pointing a consumer node at a producer's physical file each run couples three things that must be
independent: the *value* (e.g. `archetype`), the *producer's filename/JSON shape*, and the *physical
location*. The current `{file:field}` token resolves against `RUN_CWD` (in-place only) and only survives a
worktree via a `BASE_ROOT→wtRoot` regex — it breaks on a relocating/remote sandbox. This is the local
workaround the SDK exists to remove.

**Model — LangGraph-style state channels over a per-thread filesystem.** The run (thread) carries a state
object of reusable, tracked channels; nodes read/write channels, not each other's files. Two engine-resolved
logical roots are the ONLY path vocabulary:

- **`${WORKSPACE}`** — the CANONICAL, read-only, OUT-OF-THREAD tree: skills (`packages/skills/`), skill
  systems, the registry + code components (`templates/`, `genres.json`, `templates/modules/<archetype>`),
  shared source. NOT per-thread artifacts — the same canonical inputs for every thread. The engine resolves it
  to the canonical copy for the active provider.
- **`${RUN}`** (= U6 `projectBase`) — the PER-THREAD mutable output namespace (`out/<run>`): every artifact
  the run produces, plus the RunState file. Collected back via the portable `downloadDir` contract
  (`types.ts:49` — "the one mechanism every backend supports").

Every workflow path becomes `${WORKSPACE}/…` or `${RUN}/…`; absolute / `RUN_CWD`-relative literals and the
`BASE_ROOT→wtRoot` regex are retired — re-rooting is just "resolve the two roots per provider."

**RunState.** `${RUN}/_state.json` — the per-thread channel object. The engine STAGES it into each node's
sandbox and COLLECTS the updated copy back after the node, so it rides the existing
`create→stage→exec→collect→dispose` lifecycle (`types.ts:241`) and is portable across local/worktree/remote
with no extra machinery. Per-channel reducer: `set` (default) · `append` · `deepMerge` (covers "reuse AND
edit").

**Produce — a POST-hook `promote` op** (the new sibling of `DRIVER-PROJECT`/`DRIVER-MERGE`, same POST family):
`promote: [{ from: '<artifact>:<dotted.field>' | '@return:<field>', to: '<channel>', merge?: 'set'|'append'|'deepMerge' }]`.
After the node exits, the engine lifts the value (from a produced file field OR the node's structured return)
into the channel. W0: `promote: [{ from: 'spec/classification.json:archetype', to: 'archetype' }]`.

**Consume — a `${state.<channel>}` token** resolved by the driver at NODE LAUNCH from `${RUN}/_state.json` (the
channel exists by then — upstream promoted it and the engine staged it in). Usable in seed `from`, schema,
merge, read-scope, and prompt interpolation — replacing the `RUN_CWD`-relative `{file:field}` for all
CROSS-NODE values. (Intra-node same-file drilling may keep `{file:field}`.)

**Invariants (load-bearing).** `${state.*}`, `${WORKSPACE}`, `${RUN}` are DEFERRED tokens — baked as static
text at extract time, resolved at launch — so `extract.mjs`'s stubbed run never needs a runtime value (same
property as today's token). State drives **values only**; it does NOT drive **routing** (which/how many
nodes) — state-conditioned fan-out is the dynamic-workflow caveat the recording can't see, so the DAG stays
static and channels flow values through it.

**Per-thread filesystem resolution (CONFIRMED by the 2026-06-23 read-only investigation).** The two-root split
already exists de-facto, just unnamed — `RunScope.root`/`RUN_CWD`/`wtPath` is the mutable per-thread root
(`${RUN}`), `outDir` is the host collection namespace, and canonical inputs are a third thing reached
*implicitly by cwd + relative path*, never given a name. Findings:
- **Canonical trees today.** `packages/skills/`, `templates/`, `genres.json`, `templates/modules/*` are
  git-tracked, so under `--worktree` (`git worktree add … HEAD`, `run.mjs:1051`/`worktree.ts:281`) a thread gets
  its OWN PINNED COPY at HEAD; in the in-place `local` default (game-omni's actual posture — no `--worktree`)
  the thread reads the ONE live main checkout by relative path. Only `node_modules` is symlink-shared
  (`run.mjs:1059-74`/`worktree.ts:287-309`).
- **Re-rooting is fragile.** The consumer re-roots a worktree thread with a single `BASE_ROOT→wtRoot` text
  replace on the prompt (`run.mjs:1483`) that fires ONLY for `BASE_ROOT`-absolute strings — so a relative
  `projectDir` (`PROJECT='out/game'`, `game-omni-v1.6.js:97`) and the bare repo-relative skill/template paths
  survive only because cwd happens to be the repo (the documented `projectDir` GOTCHA, `worktree-isolation.md:56-64`,
  still OPEN). The SDK `WorktreeSandboxProvider` does the rewrite NOWHERE — `OpenRunOpts.repoRoot` documents it
  (`types.ts:263-271`) but no code performs it; the SDK relies on cwd + per-node staging of `io.reads`
  (`runner.ts:441-44`). [Unverified whether that absence is a gap or by-design.]
- **The remote gap is load-bearing.** Daytona boots an EMPTY VM (`daytona.ts:507-525`); the runner uploads ONLY
  each node's declared `io.reads`, sourced from `outDir` (`runner.ts:441-44`) — the canonical trees are NOT in
  `io.reads`, so a remote node reaches NEITHER its toolchain deps NOR `templates/`/`packages/skills/`.
  `downloadDir`-out works; canonical upload-IN is ABSENT. (`'e2b'` is a declared kind with no impl.)

**→ Two decisions this forces (for review):**
1. **`${WORKSPACE}` semantics — LIVE vs PINNED — resolve per provider.** `local`/in-place = the LIVE shared tree
   (sees uncommitted canonical edits — what dev + the Hermes self-evolving loop want); `worktree`/remote = a
   PINNED HEAD snapshot (reproducible, parallel-fleet-safe). Same logical root, provider-resolved. A
   `${WORKSPACE}`-rooted reference is then relocation-invariant by construction — no `BASE_ROOT→wtRoot`
   text-replace, no relative-`projectDir` GOTCHA.
2. **`${WORKSPACE}` is the missing remote-staging contract.** Declaring it canonical + read-only is exactly
   what tells a cloud provider to STAGE/upload (or mount/clone) the canonical tree into the VM, distinct from
   `${RUN}` (collected back). Keep `node_modules` symlink/realpath-shared, distinct from canon copy/mount.

### Revised U6 — RunState spine + the two logical roots (was: just `projectBase`)
`HookContext` carries `workspace` (`${WORKSPACE}`) and `projectBase` (`${RUN}`) as the explicit logical roots;
add RunState load/merge/persist helpers over `${RUN}/_state.json`; `makeHookCodec` gains the `promote` family;
the resolver understands `${state.*}`/`${WORKSPACE}`/`${RUN}`. Additive: with no `promote`/`${state}` in a
workflow, `runHooks` + the existing tests stay green (empty state).

### Revised U7 — op executors + the resolver + `promote` (retire the regex)
Promote the op executors AND: (a) the `${state.*}`/`${WORKSPACE}`/`${RUN}` token resolver (generalizes
`resolveSeedTokens` OFF `RUN_CWD` onto the logical roots, replacing the `BASE_ROOT→wtRoot` regex); (b) the
`promote` POST-op; (c) seed/project/merge/schema/read-scope all consume the resolver. `assetConventions`
injection unchanged. **Read-scope narrowing is now just a consumer:**
`readScope: [${RUN}, ${WORKSPACE}/packages/skills/write-gdd, ${WORKSPACE}/templates/modules/${state.archetype}]`.
The within-archetype `src/`-deny remains a separate Seatbelt glob/deny enhancement.

## Out of scope (Phase 2)
The consumer opt-in: game-omni's `pi-runner/sdk/*` switching to import from `@piflow/core` and deleting its
local copies; the `templates/pi-runner/` shrink to ~Tier 1 + a one-line `run.mjs`; the `parse-claude-workflow`
CLI collapsing onto `extractSpec`. Done only AFTER upstream ships U1–U8 and a parity run is green.
