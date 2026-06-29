# Expert Representations — Build Spec (locked surfaces + subagent contracts)

> 2026-06-28 · BUILD CONTRACT · branch `feat/expert-representations`
> Rationale lives in `expert-representations-worker-types.md`. THIS file is the locked "what to
> build": the final surfaces, the op[] mapping, the base-agent/node split, and per-subagent contracts.

## Locked decisions

1. **Tiers** — use the three already-settled tiers; SA-C seeds `~/.piflow/model-tiers.json`. Pin the
   exact strings from their canonical source (do NOT invent new names).
2. **Gates live in `op[]`** — NOT a new `gates[]` field. The post-lane `op[]` IS the gate pipeline.
3. **No `fallback` policy.** auto = no gate = no policy. Policy vocab = the existing `PolicyAction`
   (`block | warn | stop | retry | escalate`) — zero additions. Degrade-on-fail = `rerouteTo` a default node.
4. **Judge gate auto-expands**, foldable/editable (§Judge expansion).
5. **Retry default = `scope: feedback` (L1) = warm-resume** the same pi (append-message), not cold restart.
6. **L2/L3 stubbed** — leave seams + references; a separate memory system owns them.
7. **Skill manifest = two lists per skill**: `requires[]` (floor) and `allowed[]` (ceiling).
8. **One `AgentBase` schema** (all fields optional, defaulted). A preset is a partial fill (loadout +
   display + default tier); a node is the full fill (+ sandbox + gates). Sandbox & gates are
   **workflow-level**, never baked into a preset.

## The op[] mapping (why the build is small)

`OpSpec` (`packages/core/src/types.ts:122`) already carries the whole gate+policy vocabulary. We add
authoring *kinds* that lower onto it — we do NOT invent a parallel gate system.

| Our concept | Lowers to (exists today) |
| --- | --- |
| execution gate | `op.run` (`RunBody {cmd,args,cwd}`) + `onFailure` |
| deterministic / structural-floor check | `op.gate` (`GateBody` = a `Check` predicate) |
| **judge gate** | a materialized judge **pi node** (`judgeTier`+rubric) + `op.action {kind:'rerouteTo', node, max}` — **auto-expanded** |
| **human gate** (HITL) | the existing **G5 `checkpoint`** (`types.ts:168`; spawns no pi, parks lane, resumes on reply) |
| policy (consequence) | `op.onFailure: PolicyAction` (default `block`) |
| retry (budget) | `op.action {kind:'retry', max}` (or `onFailure:'retry'`) |
| reroute | `op.action {kind:'rerouteTo', node, max}` |
| escalate / notify | `op.action {kind:'escalate'|'notify'}` |

**Net new schema:** `retry.scope` (feedback|fix), the `judge`/`human` authoring kinds + judge
auto-expansion, skill `requires`/`allowed`, `AgentBase`, GUI write-back. That's it.

## Final surfaces

```typescript
// ── A · Skill (the capability atom) ──
interface Skill {
  id: string; body: string;            // SKILL.md
  requires?: string[];                 // FLOOR — tool/MCP/capability ids that MUST bind (auto-wire + preflight)
  allowed?: string[];                  // CEILING — what the running agent MAY touch (Anthropic allowed-tools)
  display?: { label?: string; icon?: string; color?: string };
}
// invariant: requires ⊆ bound ⊆ allowed ⊆ catalog

// ── D · AgentBase (decision 8) — ONE schema; preset = partial fill, node = full fill ──
interface AgentBase {
  id: string;
  display?: { label?: string; icon?: string; color?: string };
  skills?: string[];                   // the loadout
  tools?: ToolSelection;               // extra raw tools beyond what skills pull in
  tier?: string;                       // model CLASS only — NEVER a model id; node override wins
  prompt?: string;                     // role body
  // workflow-level (a PRESET leaves these empty; a NODE fills them):
  sandbox?: SandboxSpec;
  op?: OpSpec[];                        // the gate pipeline lives HERE
}

// ── C · retry scope (the only op extension) ──
// extend ActionBody retry:
type RetryAction = { kind: 'retry'; onVerdict?: 'fail'|'warn'; max?: number;
                     scope?: 'feedback' | 'fix' };   // default 'feedback' (L1 warm-resume); 'fix' = L2 (STUB)
```

The runner still sees only a plain node with `op[]` — **zero new runtime**.

## Judge expansion (decision 4)

`{ gate: judge, judgeTier, rubric, threshold, policy }` compiles (author-time) to:
`producer → judge node (pi @ judgeTier, rubric prompt, emits pass/fail vs threshold) → op.action
rerouteTo(producer, max=budget)`. The judge node is **materialized, foldable, editable** (collapsed
by default; tier/cost on the badge; expand to edit the rubric). The judge model MUST differ from the
producer (no self-judging). GUI "judge" chip = this one action; the subgraph appears folded.

## Self-correction (decision 5,6)

- **L1 retry-with-feedback (DEFAULT, BUILD):** on a gate's `retry` verdict, **warm-resume** the
  producer's pi session with the gate feedback appended as a new message (NOT a cold restart). Cold
  `rerouteTo` is the fallback when a session can't resume.
- **L2 retry-with-fix (`scope:'fix'`) — STUB.** Leave the seam + a comment: "infer problem + consult
  per-workflow fix/issue memory → patch THIS node's prompt/tool-wiring (run-scoped, recorded) → resume.
  Best-effort, no guarantee. Owned by the separate memory system. Promotion to template = L3, held-out
  check + human approve." Reference the loop-engineering research doc.
- **L3 per-DAG optimize — STUB.** Reference Hermes / `piflow-enhance` (between-runs, human-gated).

## Build partition — one subagent per surface group

| Agent | Owns | Depends | Defers |
| --- | --- | --- | --- |
| **SA-A · Skill manifest** | `requires`/`allowed` two-lists on skills · resolver (auto-wire from catalog) · preflight fail-fast at init | catalog (exists) | — |
| **SA-B · Gate authoring → op[]** | recognize gate kinds {execution→`op.run`, judge→node+`rerouteTo` (auto-expand, foldable), human→`checkpoint`, floor→`op.gate`} · `retry.scope` field · cost-ladder ordering · auto-inject floor | op[]/checkpoint/reroute (exist) | — |
| **SA-C · AgentBase + compiler** | `AgentBase` schema (defaulted) · `mergePreset` uniform for presets & nodes · 6 presets → light loadout presets · seed 3-tier vocab | A, B schemas | — |
| **SA-D · Self-correction** | L1 warm-resume + `retry.scope` wiring | B | L2/L3 (stub + refs) |
| **SA-E · GUI write-back** | drag chips (gate/skill/loadout) → `node.json`/`op[]` mutation · template/run edit target · observe badge widen | A,B,C schemas | live mid-run mutation |

**Order:** A + B parallel → C → D + E parallel.

## Remaining to pin (small, before/at build)

- The **three tier strings** (their canonical source) — SA-C.
- The **judge `rubric` format** + `threshold` semantics — SA-B.
- Where `retry.scope` lives on `ActionBody` vs `onFailure` — SA-B (proposal above: on the retry action).
- Preflight error UX (missing `requires`) — SA-A.

## Dispatch contract (per subagent — applies to all)

GO: objective + this spec + the named seam files inline. SCOPE FENCE: build ONLY your row; do NOT
touch another SA's surface; additive/optional schema (don't break the 6 presets or existing op[]
consumers — see memory `op-consumption-two-layer`); read-grounded (cite file:line). VERIFY: typecheck
+ a meaningful test that FAILS without the change (per `test-discipline`); return a CONDENSED diff
summary, not a success claim. If a surface must grow beyond the row or a dependency is missing, HALT
and signal — never invent.
