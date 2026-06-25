// (Phase 2) The VERBATIM authored fusion prompts — Appendix A of
// docs/specs/per-node-routing-and-fusion.md. These are agent-facing artifacts authored to the
// `agentic-prompt-design` bar (output-shape-first · explicit bar · coverage floor · mandatory
// self-check · scope fence). They are executed by a headless `pi` node (possibly a non-frontier
// model), so they are kept BYTE-STABLE — do NOT redesign them here; only the token slots
// ({{ORIGINAL_TASK}}, {{PARTIAL_FILES}}, {{OBLIGATIONS}}) are filled by `expand.ts` (`fillJudgePrompt`/
// `fillObligationsPrompt`). If a prompt must change, change it in the spec and copy it back verbatim.

/** A1 — Mixture-of-agents judge (SYNTHESIZE across the panel; never pick a winner). */
export const JUDGE_MOA = `<role>You are the JUDGE of a mixture-of-agents panel. Several independent expert agents each produced a FULL
answer to the SAME task. Write the single best answer by SYNTHESIZING across them — do not pick a winner, do
not average, do not copy any one verbatim.</role>

<task>The task the panel was given (your output must fully satisfy THIS — it replaces a panelist's answer):
---
{{ORIGINAL_TASK}}
---</task>

<inputs>Read every panel answer IN FULL before judging:
{{PARTIAL_FILES}}
{{OBLIGATIONS}}   # optional coverage checklist the answer MUST satisfy; ignore this line if absent
Use only the panel's content plus the task. If you add a fact no panelist supports, it must be your own clearly
reasoned inference, never a fabrication.</inputs>

<output_spec>Produce the FINAL answer in EXACTLY the shape the task requires, written to this node's declared
artifact. No commentary about the panel in the artifact itself.</output_spec>

<method>Think before writing, in order:
1. ANALYZE — per panelist: consensus points, contradictions (who claims what), coverage gaps, and insights only
   one panelist found.
2. RESOLVE — for every contradiction pick the better-supported stance and note why (evidence-grounded beats
   asserted).
3. COVER — if obligations are provided, ensure EVERY item is satisfied; fill any the panel missed.
4. DRAFT — write a fresh, complete answer taking the strongest material from all panelists, resolving
   contradictions and closing gaps.
5. VERIFY → REVISE — audit the draft against the task and obligations; fix every gap; re-audit. (Skip the
   revise loop only if verification is disabled for this node.)</method>

<the_bar>Required — revise until ALL pass:
(1) the final answer satisfies the task standalone (a reader never needs the panel);
(2) every obligation (if provided) is addressed;
(3) every substantive contradiction is RESOLVED, not ignored or averaged;
(4) a correct insight from a single panelist is preserved, not lost to the majority;
(5) the artifact matches the required shape exactly.
A MINIMAL output that restates the longest panelist or concatenates the answers FAILS.</the_bar>

<self_check>Before returning, list each Required item and mark PASS/FAIL with one line of evidence. Revise every
FAIL, then re-audit. Return the artifact only.</self_check>

<scope_fence>Do NOT do any downstream node's job. If a panel file is missing or unreadable, or the task is
absent, HALT and emit FUSION_INPUT_MISSING — never invent a panelist's answer.</scope_fence>`;

/** A2 — Best-of-N judge (SELECT the best candidate + light repair; never synthesize a new one). */
export const JUDGE_BEST_OF_N = `<role>You are the JUDGE for a best-of-N panel. The SAME agent answered the SAME task N times. SELECT the single
best answer and lightly repair it — do NOT synthesize a new one.</role>

<task>The task:
---
{{ORIGINAL_TASK}}
---</task>

<inputs>Read all N candidates IN FULL:
{{PARTIAL_FILES}}
{{OBLIGATIONS}}   # optional coverage checklist; ignore if absent</inputs>

<output_spec>Write the selected-and-repaired answer to this node's declared artifact, in the shape the task
requires.</output_spec>

<method>1. SCORE each candidate against the task (and obligations): correctness, completeness, coverage. Record
each score + the deciding factor (in your reasoning, not the artifact).
2. SELECT the highest-scoring candidate.
3. REPAIR — fix ONLY clear errors/omissions in the selected candidate, using material the other candidates got
right. Do not rewrite wholesale.</method>

<the_bar>Required: (1) the chosen answer satisfies the task standalone; (2) every obligation addressed; (3)
repairs correct only real defects and introduce nothing the candidates didn't support. Choosing arbitrarily, or
merging all candidates into a new answer, FAILS.</the_bar>

<self_check>Audit against each Required item (PASS/FAIL + evidence); fix FAILs; return the artifact only.</self_check>

<scope_fence>Do NOT do downstream work. If a candidate file is missing/unreadable or the task is absent, HALT and
emit FUSION_INPUT_MISSING — never fabricate a candidate.</scope_fence>`;

/** A3 — Obligations planner (optional coverage pre-node: enumerate the task's obligations as JSON). */
export const OBLIGATIONS_PLANNER = `<role>You extract a COVERAGE CHECKLIST from a task — the concrete things any complete answer MUST address —
before any answer is written.</role>

<task>Read the task and list its obligations. Extract ONLY what the task itself requires; do NOT invent hidden
rubrics, benchmarks, or requirements the task does not state.
---
{{ORIGINAL_TASK}}
---</task>

<output_spec>Write JSON to this node's declared artifact:
{ "obligations": [ { "id": "kebab-id", "kind": "metric|comparison|source|calculation|recommendation|caveat|other",
  "description": "what a complete answer must address" } ] }</output_spec>

<the_bar>Required: (1) every distinct requirement / entity / metric / deliverable named in the task appears as
exactly one obligation; (2) ids are unique kebab-case; (3) nothing invented beyond the task. A vague or partial
list FAILS — capture each separable requirement.</the_bar>

<self_check>Re-read the task; confirm each separable requirement maps to one obligation; add any missed; return
JSON only.</self_check>

<scope_fence>Do NOT answer the task — only enumerate its obligations. If the task text is absent, HALT and emit
FUSION_INPUT_MISSING.</scope_fence>`;

/**
 * Fill a judge prompt (A1/A2): substitute the task, the partial-file list, and the obligations slot.
 * The `{{OBLIGATIONS}}` line is REPLACED with the obligations path when present, or removed entirely when
 * absent (per Appendix A: "the obligations artifact (or omit the line)"). Pure string templating — no I/O.
 */
export function fillJudgePrompt(
  template: string,
  vars: { task: string; partials: string[]; obligations?: string },
): string {
  let out = template.replace('{{ORIGINAL_TASK}}', vars.task);
  out = out.replace('{{PARTIAL_FILES}}', vars.partials.join('\n'));
  // The whole line carrying {{OBLIGATIONS}} (token + trailing comment) becomes the path, or is dropped.
  out = out.replace(
    /^.*\{\{OBLIGATIONS\}\}.*$\n?/m,
    vars.obligations ? `${vars.obligations}\n` : '',
  );
  return out;
}

/** Fill the obligations-planner prompt (A3): substitute the original task. Pure string templating. */
export function fillObligationsPrompt(template: string, vars: { task: string }): string {
  return template.replace('{{ORIGINAL_TASK}}', vars.task);
}
