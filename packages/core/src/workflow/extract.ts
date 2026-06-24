// ─────────────────────────────────────────────────────────────────────────────
// extractWorkflow — execute-and-record extractor (TS port of pi-runner/extract.mjs).
//
// A `.claude/workflows/<name>.js` Claude Code Workflow is the SINGLE SOURCE OF TRUTH.
// We run its body under recording stubs for the Workflow hooks (`agent` / `parallel` /
// `pipeline` / `phase` / `log` / `budget`) and capture the EXACT realized prompts + the
// structural DAG. No second copy of the wave text, no codegen, no drift.
//
// The ONLY transform is mechanical: de-export `meta` and wrap the body in an AsyncFunction
// — the Workflow runtime wraps the script the same way, which is why a workflow script
// legally uses top-level `return` / `await`. Wave prose, paths, skill refs and control flow
// run verbatim.
//
// WHY THIS WORKS: a workflow's control flow is data-INdependent at the structural level —
// the set of agent() calls and their parallel grouping is fixed; only their RESULTS vary.
// So we run the script once with stubbed hooks that (a) record each agent() prompt and (b)
// return a generic success-shaped object, which makes every data-dependent branch take its
// happy path. The recording IS the DAG. (A workflow that branches on agent RESULTS to decide
// WHICH agents to spawn — loop-until-dry — extracts only the happy-path expansion.)
//
// This is the RAW recorded structure ONLY — mapping it to a WorkflowSpec is the bridge's job.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';

/** One recorded `agent()` call — the realized values the stub captured at the call site. */
export interface ExtractedRecord {
  /** The `phase()` in effect at the call site (null before the first phase()). */
  phase: string | null;
  /** `opts.label` if passed, else null. */
  label: string | null;
  /** `opts.agentType` if passed, else null. */
  agentType: string | null;
  /** The parallel group id (a positive int) the call ran inside, or null when serial. */
  group: number | null;
  /** Whether `opts.schema` was passed. */
  hasSchema: boolean;
  /** The realized prompt (a string[] is joined with newlines, mirroring the runtime). */
  prompt: string;
}

/** A topological stage: consecutive same-group records. Serial records (group=null) each get their own. */
export interface ExtractedStage {
  /** The parallel group id shared by `nodes`, or null for a serial stage. */
  group: number | null;
  /** The phase the stage's records ran under. */
  phase: string | null;
  /** The records grouped into this stage (1 for serial, ≥1 for a parallel lane set). */
  nodes: ExtractedRecord[];
}

/** A workflow's `export const meta` literal (a pure object literal by the Workflow contract). */
export interface ExtractedMeta {
  name?: string;
  description?: string;
  phases?: { id?: string; detail?: string }[];
  [k: string]: unknown;
}

/** The raw recorded structure: the realized agent records, their stage grouping, the body's return, and meta. */
export interface ExtractResult {
  /** Every recorded `agent()` call, in call order. */
  records: ExtractedRecord[];
  /** Records grouped into topological stages (parallel lanes coalesced; serial = own stage). */
  stages: ExtractedStage[];
  /** Whatever the workflow body returned (the happy-path aggregate). */
  aggregate: unknown;
  /** The extracted `meta` literal, or null if absent/unparseable. */
  meta: ExtractedMeta | null;
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as {
  new (...args: string[]): (...args: unknown[]) => Promise<unknown>;
};

/**
 * Pull the `meta = { … }` object literal out of the source and evaluate it on its own. `meta` is a
 * PURE literal by the Workflow contract (no vars/calls/spreads), so this is deterministic and safe —
 * it gives us each phase's human description (meta.phases[].detail) without running the body. Returns
 * null on any failure (older workflows, parse error): callers treat meta as optional.
 */
function extractMeta(src: string): ExtractedMeta | null {
  const m = src.match(/\bmeta\s*=\s*\{/);
  if (!m || m.index == null) return null;
  let i = m.index + m[0].length - 1; // at the opening brace
  let depth = 0;
  let str: string | null = null;
  let esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === str) str = null;
    } else if (c === '"' || c === "'" || c === '`') str = c;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  const startBrace = src.indexOf('{', m.index);
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function(`return (${src.slice(startBrace, i)})`)() as ExtractedMeta;
  } catch {
    return null;
  }
}

/**
 * Run a workflow `.js` under recording stubs and capture the realized agent records + DAG.
 * Pure extraction — no model calls, no fs side effects beyond reading `workflowPath`.
 */
export async function extractWorkflow(
  workflowPath: string,
  args: Record<string, unknown> = {},
): Promise<ExtractResult> {
  const src = fs.readFileSync(workflowPath, 'utf8');
  const meta = extractMeta(src);
  // de-export meta so the body is legal inside a function; nothing else is touched.
  const body = src.replace(/^[ \t]*export[ \t]+const[ \t]+meta\b/m, 'const meta');

  const records: ExtractedRecord[] = [];
  let curPhase: string | null = null;
  let curGroup: number | null = null;
  let groupSeq = 0;

  // Success-shaped result so every data-dependent branch (preflight ok, accepted, …) takes the
  // happy path and ALL nodes are recorded. Mirror the keys the JS reference returns.
  const GENERIC = {
    node: '',
    status: 'ok',
    outputArtifacts: [],
    summary: '',
    issues: [],
    pipelineFindings: [],
    accepted: true,
    ok: true,
    missing: [],
    findings: [],
  };

  const agent = async (prompt: unknown, opts: Record<string, unknown> = {}) => {
    records.push({
      phase: curPhase,
      label: (opts.label as string) || null,
      agentType: (opts.agentType as string) || null,
      group: curGroup,
      hasSchema: !!opts.schema,
      prompt: Array.isArray(prompt) ? prompt.join('\n') : String(prompt),
    });
    return GENERIC;
  };

  const parallel = async (thunks: Array<() => unknown>) => {
    const g = ++groupSeq;
    const prev = curGroup;
    curGroup = g;
    try {
      return await Promise.all(thunks.map((t) => t()));
    } finally {
      curGroup = prev;
    }
  };

  const pipeline = async (
    items: unknown[],
    ...stages: Array<(v: unknown, item: unknown, i: number) => unknown>
  ) => {
    const out: unknown[] = [];
    for (let i = 0; i < items.length; i++) {
      let v: unknown = items[i];
      for (const s of stages) v = await s(v, items[i], i);
      out.push(v);
    }
    return out;
  };

  const phase = (t: string) => {
    curPhase = t;
  };
  const log = () => {};
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };

  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', body);
  const aggregate = await fn(agent, parallel, pipeline, phase, log, args, budget);

  // Group consecutive same-group records into stages; serial (group=null) = its own stage.
  const stages: ExtractedStage[] = [];
  for (const r of records) {
    const last = stages[stages.length - 1];
    if (r.group != null && last && last.group === r.group) last.nodes.push(r);
    else stages.push({ group: r.group, phase: r.phase, nodes: [r] });
  }
  return { records, stages, aggregate, meta };
}
