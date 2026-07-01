# Enrich the ported template — the LLM's construction how-to (per-target recipes)

The mechanical port (`parse-claude-workflow.mjs`) gives prompts + DAG + artifacts/tools/sandbox. **This file is
the recipe for the rest — what the LLM constructs to make the template RUN.** Read it with
`parse-claude-workflow.md` → "What the LLM MUST CONSTRUCT" (the WHAT + the miss-nothing bar; this is the HOW).
Worked exemplar throughout: `game-omni` (`.piflow/game-omni/template/`), a 16-node port that runs green.

**The bar (do not declare done until):** a green dry-run (loadTemplate gate + compile, same stage count +
membership as the source) AND a live run where **every op fires and every declared artifact lands**. A
template that compiles but drops an op is a FAILED port.

## 1. op[] — the deterministic action layer (the biggest construct)
Each `DRIVER-*` marker in the source `.js` is a deterministic action the text port drops. Re-express each as an
entry in the node's canonical **`op[]`** array — the ONE authoring surface for a node's non-model work. `op[]`
is a stable-ordered list; each entry has a `when` (`pre`|`post`|`on-success`|`on-failure`|`always`, default
`post`) and EXACTLY ONE body: bare `reads`/`writes` (a forced read/write), `transform` (a DERIVE —
seed/project/merge/promote/projectRegistry), `run` (a shell/fn side-effect), `gate` (a Check predicate), or
`action` (control — retry/escalate/reroute). Optional per entry: `onFailure` (default `block`) and `note`
(author rationale — the one comment slot on a strict node.json).

Tokens the SDK resolves: `{{WORKSPACE}}` = the read-only consumer repo (skills/templates/registry),
`{{RUN}}`/`{project}` = the run/out dir, `{{state.X}}` = a promoted state channel, `{path:field}` = a value
read from an on-disk JSON.

**Source marker → `op[]` entry** (the middle column is the LEGACY `inject`/`hooks` alias each replaces — you
may SEE it in an older template; author the `op[]` form, right):

| source marker | legacy alias (still lowers) | canonical `op[]` entry |
|---|---|---|
| `DRIVER-INJECT` | `inject: [p]` | `{ "when":"pre", "reads":[p] }` — one per path; folds the file into the prompt |
| `DRIVER-SEED` (pre) | `hooks.seed: [{to,from}]` | `{ "when":"pre", "writes":[to], "transform":{ "kind":"seed", "from" } }` |
| `DRIVER-PROJECT` (post) | `hooks.project` / `hooks.registryProject` | `{ "when":"post", "writes":[to], "reads":[…from], "transform":{ "kind":"project"\|"projectRegistry", … } }` |
| `DRIVER-MERGE` fold/concat/reconcile | `hooks.merge:{ops}` | `{ "when":"post", "transform":{ "kind":"merge", "ops":[…] } }` — a no-verdict derive |
| `DRIVER-PROMOTE` | `hooks.promote:[{from,to}]` | `{ "when":"post", "transform":{ "kind":"promote", "from", "to" } }` |
| `DRIVER-MERGE run` as a BLOCKING gate | `hooks.merge:{ops:[{run}]}` | `{ "when":"post", "run":{ cmd, args, cwd }, "onFailure":"block" }` — non-zero exit fails the node |
| generation `run`, NO verdict | `hooks.merge:{ops:[{run}]}` | `{ "when":"post", "transform":{ "kind":"merge", "ops":[{ "run":{ cmd, args, cwd } }] } }` |

**The fork that matters** (the legacy `merge.run` conflates it): a `run` that is a **blocking GATE** — a
non-zero exit must fail the node — is a **top-level `run` op with `onFailure:"block"`**. A `run` that just
GENERATES a file with **no verdict** is a `transform:merge` op carrying the run. Pick by whether a non-zero
exit should block.

**Do NOT mix grammars on one node.** `op[]` is authoritative: a node with an authored `op[]` has its
`inject`/`hooks` IGNORED (they would be silently dropped), so the loader now REJECTS that combo. `checks` /
`policy` / `return` are NOT aliases — they keep their OWN channels (§4) and coexist with `op[]` fine.

**Exemplars (the op[] shapes to author):**
- generate-then-gate: `[{ "when":"pre", "writes":["spec/blueprint.json"], "transform":{ "kind":"seed", "from":"{{WORKSPACE}}/templates/blueprint.json" } }, { "when":"post", "run":{ "cmd":"{{WORKSPACE}}/packages/skills/harden-blueprint/gen/seed-contracts.mjs", "args":["--source","{project}/spec/blueprint.json","--catalog","{{WORKSPACE}}/.agents/node-catalog.json"] }, "onFailure":"block", "note":"contract-seed GATE — non-zero exit fails the node" }]`.
- asset-generation derive (no verdict): `[{ "when":"post", "transform":{ "kind":"merge", "ops":[{ "run":{ "cmd":"{{WORKSPACE}}/packages/skills/assets/gen/.venv/bin/python", "args":["generate_assets.py","--blueprint","{project}/spec/blueprint.json","--out","{project}/public/assets"] } }] } }]`.

_(game-omni's committed template still authors these as `hooks.*` — the LEGACY form the loader still lowers for
existing templates. Author NEW nodes as `op[]`; the middle column above is the migration.)_

## 2. State promotion — make `{{state.X}}` resolvable
Any token a downstream seed/project reads (`{{state.archetype}}`, …) needs a node that PROMOTES it. The port
has no state-channel awareness. Add a promote `op[]` entry (`{ "when":"post", "transform":{ "kind":"promote",
"from", "to" } }`) on the establishing node. Use the `@return:<field>` source form to promote a value from the
node's structured RETURN (no filesystem read); a `<file>:<field>` source reads it from disk.
- Exemplar: `w0-classify` → a promote op reads `classification.json:archetype` → writes `state.archetype`. Every
  downstream `templates/genres/{{state.archetype}}.json` seed and the w2 `registryProject` key depend on it. No
  promote ⇒ those tokens resolve to nothing and the hooks read garbage.

## 3. SDK-vocabulary translation
The source `.js` speaks the Claude/pi-runner marker vocab; the SDK has its own op names. Translate so hooks
bind to `@piflow/core`'s op set, not the legacy monolith's:
- `project` → `registryProject`, `genre` → `key`. (game-omni: the source still says `project:{source,genre,mapRef}`; the template says `registryProject:{source,key,mapRef}` — the SDK shape. The migrate test asserts the SDK shape, not the source's.)
- Generic transforms (e.g. `union`) carry NO domain knowledge in code — the per-key transform DATA lives in the
  registry record (`templates/genres.json` per-archetype `projections`), which `registryProject` resolves.

## 4. Contract decisions — `policy` / `returnMode` / `checks` / `fillSentinel`
The Claude `contract()` emits only `artifacts`/`owns`/`readScope`/tools. Add the rest — these are NOT `op[]`
aliases: they keep their own channels and coexist with an authored `op[]` (unlike `inject`/`hooks`, §1):
- **`policy.fail: "block"`** on EVERY producing node — the artifact gate (a clean exit that didn't produce a
  required artifact is `blocked`, not `ok`). game-omni: 16/16 nodes.
- **`returnMode`** only where the SDK default is wrong. Default = **optional when the node declares artifacts**
  (the file is the proof), **required for a zero-artifact gate** (its return is its only proof). Set explicitly
  if a node deviates.
- **`checks` / `fillSentinel`** where the workflow declared integrity checks (e.g. w1's fenced-tail milestones
  `minItems`) or a fill sentinel. Either default a small standard set or LLM-author per node from the source's
  intent — author them; don't leave a node the source gated as ungated.

## 5. Data-flow (optional upgrade) + the self-check
The port pins recorded order via `io.dependsOn`. To reveal real parallelism, replace it with each node's actual
`io.reads`/`io.produces` (keep `dependsOn` until you do). Then run the **miss-nothing self-check** from
`parse-claude-workflow.md`: every `DRIVER-*` → an `op[]` entry · every `{{state.X}}` → a promoting node · every
producer → `policy.fail` + artifact contract · dry-run stage-parity with the source · live run fires every op
and produces every artifact.
