# DAG Authoring Guide — the canonical text layer for composing piflow workflows

This is the ONE contract for turning a workflow NEED into a runnable DAG by composing reusable topology
recipes. It is read by all three loops, and none of them restates it:

- **build-first** — the init/COMPOSE agent standing up the first workflow (`piflow-init` SKILL.md → here).
- **design-next** — the long-horizon redesign node authoring the NEXT generation's template (it reads a
  generation's run history, then composes a new DAG *by this guide*).
- **improve-prev** — the optimizer reconciling/altering a prior DAG (adding a verify lane, a self-fix loop, a
  fusion node — each an *edit* expressed in this same grammar).

Because designing a new DAG and editing an old one are the same operation here (see §4), one guide drives all
three. Read the layer contract in `README.md` first; this file is the grammar those recipes and edits obey.

---

## 0. Blueprint vs template — and the stamp between them

- A **blueprint** is design-time and *parametric*: a reusable SHAPE with holes, authored once, living in
  `~/.piflow/blueprints/<id>.md`. It is **NOT loadable**. It carries only the **logic** — the topology, the
  wiring rule, and which preset each slot binds to. It is light (≤ ~90 lines).
- A **template** is the *concrete* DAG — the `.piflow/<wf>/template/` that `loadTemplate` runs. It IS loadable.
- **Blueprint → template is the stamp** (runtime, when a user needs the workflow): the agent picks the matching
  blueprint(s), fills the holes (decides N, names the lanes, binds each slot's preset, writes each `prompt.md`),
  and `piflowctl extract` proves the result. The blueprint's job is to carry everything the stamp needs to fill
  those holes correctly — nothing more.

## 1. The slot model — why a blueprint stays light

A blueprint node is not a node; it is a **slot**:

```
slot = { role · agentType(preset) · optional skill ref · I/O seam (reads → writes) }
```

The *weight* — the tool set, the role-prompt, the full agent capability — comes from the **preset** at stamp
time (`--agent-type <id>` folds its tools + skill + branding label). The *craft* — how the work is actually
done — comes from the **skill** the slot references. The blueprint holds neither; it holds the **arrangement**.
So the same four slots (`plan · produce · verify · reroute`) are reusable across every domain — only the preset
bindings and the prompt prose change per stamp.

## 2. The light-blueprint format (every blueprint `.md` has exactly these 6 sections, ≤ ~90 lines)

1. **Topology** — the node shape as an ASCII sketch; mark which parts are parametric vs fixed.
2. **Parametricity rule** — the heuristic for each hole, as a COUNTABLE range (e.g. "N = one worker per
   independent shard, 2–8"), never "some".
3. **Lane → preset map** — a table: `role · preset(agentType) · skill · any extra --tool`. Bind with
   `--agent-type <preset>` (§3); do NOT hand-prepend the role body — the preset's role is inherited by
   reference at render, so each slot's `prompt.md` holds ONLY its task.
4. **Per-node I/O seam** — read-this → write-that per slot, as tokenized paths (§4), with the output SHAPE
   (PROSE for an LLM reader; strict JSON only at a machine boundary). Name which seams are BOUNDARY seams (the
   fragment's first input, its last output) — those are what an insert binds.
5. **Wiring discipline** — the exact `--dep` edges + the disjoint-`owns` rule that makes the stages resolve.
6. **Golden pointer** — a path to a worked, `extract`-green instance realizing every rule above.

Follow with a short **bar** (the enumerable pass list) + a **self-check** (audit each bar item PASS/FAIL with
evidence; the most common FAIL is `extract` red from non-disjoint `owns`). See `research-synthesize-author.md`
for the reference realization.

## 3. Composition — one primitive, three ops (all gated by `extract`)

Everything reduces to `add-node` calls + path binding, and **every compose is re-derived and validated by
`piflowctl extract`** (the model-free oracle: dangling reads, non-disjoint `owns`, cycles). A single DAG is
freely composed from many of these:

- **STAMP** (a whole blueprint → a NEW dir): `piflowctl new <dir>`, then one `piflowctl add-node` per slot with
  the blueprint's flags (`--agent-type <preset>` · `--skill` · `--dep` · disjoint `--owns` · `--artifact` ·
  `--read` · `--on-fail block`), then `Write` each `nodes/<id>/prompt.md` (the task only), then `extract`.
- **INSERT** (a blueprint FRAGMENT → an EXISTING dir, anywhere it's needed): the same `add-node` calls into the
  existing template dir, honoring the 3 insert disciplines (§4). `extract` re-derives the whole graph.
- **HAND-ADD** (one bespoke node): a single `add-node`. Use it to glue fragments or add a one-off.

`workflow.json` is NEVER hand-authored — `loadTemplate` derives stages+edges; `extract` is how you TEST them.

## 4. The file-transfer grammar — the robust wire (this is what makes free composition safe)

**File path IS the wire.** piflow never hand-draws an edge; `inferEdges` derives A→B whenever B's `io.reads`
contains a path in A's `io.produces` (`dag.ts` — the `reads ⋈ produces` join). So specifying data transfer =
declaring paths. There is no separate wiring language to get wrong.

**The token vocabulary** (the single source is `packages/core/src/workflow/template/tokens.ts`):

- `{{RUN}}` — the per-run root, the **transfer bus**: every node's artifacts collect here. The edge join is on
  the `{{RUN}}`-relative path (the `{{RUN}}/` prefix is stripped). Reads/writes/`owns`/`readScope` use it.
- `{{WORKSPACE}}` — the shared, read-only, out-of-thread tree (skills · registry · templates · modules). Reads
  rooted here are **NOT edge-routed** — a slot loading a skill via `{{WORKSPACE}}/...` creates no spurious dep.
- `{{state.*}}` — a DEFERRED dynamic value resolved per-run from `state.json` at launch (e.g.
  `{{RUN}}/spec/{{state.item}}/blueprint.json`). This is how a fragment gets a per-item namespace without a
  hard-coded path.

**Seams.** A slot declares I/O as a seam = `{ role · default tokenized path · boundary? }`. Internal seams
connect *within* the fragment via their default `{{RUN}}/<ns>/...` paths. **Boundary seams** (the fragment's
first input, its last output) are BOUND at insert time to the surrounding DAG — you write the concrete path the
upstream node produces / the downstream node reads. So a blueprint stays reusable (it names the seam
semantically) while the stamp writes the concrete tokenized path.

**The 3 insert disciplines `extract` enforces** (a compose that violates one fails loudly, never silently):

1. **Namespace the fragment's node ids** (a prefix, e.g. `m1-produce`) — an id collision is rejected. (This is
   exactly what subworkflow inlining does.)
2. **Namespace the fragment's writes** under `{{RUN}}/<ns>/...` so `owns` stays WRITE-DISJOINT across every
   parallel lane — the single most common `extract` failure.
3. **Bind the input seam** — the fragment's first read must resolve to either a surrounding node's `produces`
   (the edge auto-forms) OR a declared `externalInput` (a true root input). An unresolved read = a dangling
   ref = `extract` red.

## 5. How each loop uses this guide

- **build-first**: enumerate the task's distinct needs → pick blueprint(s) that match the shape(s) → stamp +
  insert + hand-add until `extract` is green and the DAG solves the task.
- **design-next** (redesign node): read the prior generation's run history + result → decide the next DAG as a
  COMPOSITION of these blueprints → author it into a NEW dir (never overwrite the incumbent), `extract`-gated.
- **improve-prev** (optimizer): an alteration to a live DAG is an INSERT/HAND-ADD in this grammar (add a verify
  slot + reroute, split a node, fuse a lane). Same ops, same `extract` gate. Edits produce a new artifact; the
  loop never mutates a live file in place.

## 6. The bar + self-check (every stamped/inserted DAG)

Required — revise until all PASS:
1. `piflowctl extract <dir>` EXITS 0 and shows the intended stages + edges.
2. Every node dir has BOTH `node.json` AND a non-empty `prompt.md` (task-only when `--agent-type` is used).
3. Every parallel lane has WRITE-DISJOINT `owns`; every producing node has `--on-fail block`.
4. Every read resolves to a produce or a declared `externalInput` (no dangling ref).
5. Inserted fragments have namespaced ids + writes; boundary seams are bound to real surrounding paths.

Self-check: audit each item PASS/FAIL with one line of evidence (for item 1, paste the literal `extract`
output). Fix every FAIL, re-audit, return only when all PASS. If `extract` stays red for a cause you cannot
resolve, HALT and report the exact error — never claim green.
