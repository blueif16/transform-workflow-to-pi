// (expert-representations · "Judge expansion") materializeJudgeNodes — the LOAD-TIME transform that turns
// an authored `judgeGate` on a producer node into a REAL judge pi node wired into the DAG.
//
// THE GAP this closes: `lowerGates`/`compileNodeBase` already emit a `judgeNode` SHAPE + a producer-side
// `rerouteTo` op, but nothing inserted that node into the compiled WorkflowSpec — so a judge gate ran no
// judge. This module is the missing consumer: a PURE intent→intent spec transform (the `expandReroute`/
// `expandFusion` precedent) that, for every node carrying a `judgeGate`:
//
//   1. RE-USES the SA-B lowering (`lowerGates([gate], producerId)`) — never reinvents the prompt/reroute math;
//   2. INSERTS a real `<producer>__judge` NodeIntent — agentType:'judge', tier=judgeTier, prompt=the rubric,
//      `io.reads` = the producer's produced artifacts, `io.produces` = a verdict artifact (so the
//      reads⋈produces join orders it AFTER the producer);
//   3. ATTACHES the producer-side `rerouteTo(producer, max)` op (the judge-fail loop) onto the producer's `op[]`;
//   4. RE-POINTS the producer's downstream CONSUMERS to also depend on the judge (via `io.dependsOn`), so the
//      judge GATES the hand-off — a consumer never runs before the verdict exists;
//   5. GUARDS the design invariant: the judge tier MUST DIFFER from the producer's tier (no self-judging —
//      self-verifiers false-accept per TeamBench). A same-tier judge is a loud `JudgeConfigError`.
//
// Runs at LOAD time (in `loadTemplate`, before the spec is returned) — NOT a workflow.json mutation. The
// runner needs ZERO changes: the judge is a normal pi node and `rerouteTo` is an existing dispatched action.
//
// FILE FENCE: additive; consumes gate-authoring.ts (`lowerGates`) + types.ts. Does NOT touch the runner,
// the CLI, or index.ts.

import type { WorkflowSpec, NodeIntent } from '../../types.js';
import { lowerGates } from '../gate-authoring.js';
import type { GateAuthorSpec } from '../gate-authoring.js';
import { slugify } from '../../dag.js';

/** Thrown when a judge gate is unbuildable (the judge tier equals the producer tier). Loud, never silent. */
export class JudgeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeConfigError';
  }
}

/** The verdict artifact a materialized judge produces (RUN-relative). One per producer, namespaced by id. */
function verdictPath(producerLabel: string): string {
  return `_judge/${producerLabel}/verdict.json`;
}

/**
 * Build the materialized judge `NodeIntent` for one producer carrying a `judgeGate`.
 * REUSES `lowerGates` for the prompt + threshold (never reinvents the math). The caller wires consumers.
 *
 * @returns `{ judge, rerouteOp }` — the judge node to insert + the producer-side reroute op to append.
 */
function buildJudge(producer: NodeIntent): { judge: NodeIntent; rerouteOp: NonNullable<NodeIntent['op']>[number] } {
  const gate = producer.judgeGate!;
  // GUARD the design invariant up front (a same-tier judge is forbidden — self-judging false-accepts).
  if (producer.tier !== undefined && producer.tier === gate.judgeTier) {
    throw new JudgeConfigError(
      `judge gate on "${producer.label}": judgeTier "${gate.judgeTier}" must DIFFER from the producer's ` +
        `tier "${producer.tier}" — a judge MUST be a different model than the producer (no self-judging).`,
    );
  }

  // REUSE the SA-B lowering: emits the judge prompt (rubric + acceptance bar) and the rerouteTo op.
  const authored: GateAuthorSpec = {
    kind: 'judge',
    judgeTier: gate.judgeTier,
    rubric: gate.rubric,
    ...(gate.threshold !== undefined ? { threshold: gate.threshold } : {}),
    ...(gate.policy !== undefined ? { policy: gate.policy } : {}),
  };
  const lowered = lowerGates([authored], producer.label);
  const jn = lowered.judgeNode!; // a judge gate always materializes a judgeNode (gate-authoring.ts)
  const rerouteOp = lowered.ops.find((o) => (o.action as { kind?: string } | undefined)?.kind === 'rerouteTo')!;

  const producedByProducer = producer.io.produces ?? [];
  const verdict = verdictPath(producer.label);

  const judge: NodeIntent = {
    label: `${producer.label}__judge`,
    prompt: jn.prompt,
    agentType: 'judge',
    tier: jn.tier,
    tools: {},
    phase: producer.phase,
    io: {
      // READ the producer's produced artifact(s) → the reads⋈produces join orders the judge AFTER the producer.
      reads: [...producedByProducer],
      // PRODUCE a verdict artifact → a real output the downstream consumers gate on.
      produces: [verdict],
      externalInputs: [],
      // Explicit dep on the producer too, so a producer with zero declared artifacts still orders correctly.
      // `dependsOn` resolves against SLUG ids (dag.ts), so reference the producer by its slug id.
      dependsOn: [slugify(producer.label, 0)],
      artifacts: [{ path: verdict }],
      // The judge is a zero-artifact-gate-ish node: it MUST return a verdict (the runner enforces a return).
      returnMode: 'required',
    },
    sandbox: {
      // Read the run dir (where the producer's artifacts live); write only its own verdict namespace.
      read: producedByProducer.length ? [...producedByProducer] : [],
      write: [verdict],
    },
  };
  return { judge, rerouteOp };
}

/**
 * Expand every `judgeGate`-bearing producer in a WorkflowSpec into a materialized `<producer>__judge` node
 * wired into the DAG (deps after the producer; the producer's downstream consumers re-pointed to depend on
 * the judge; the producer-side `rerouteTo` judge-fail loop attached). A spec with no `judgeGate` is returned
 * REFERENTIALLY UNCHANGED (the additivity early-return). PURE — no I/O, no model calls. Runs at LOAD time.
 *
 * Throws `JudgeConfigError` when a judge's tier equals its producer's tier (the no-self-judge invariant).
 */
export function materializeJudgeNodes(spec: WorkflowSpec): WorkflowSpec {
  if (!spec.nodes.some((n) => n.judgeGate)) return spec;

  const generated: NodeIntent[] = [];
  // producer label → the judge label its downstream consumers must now depend on.
  const judgeForProducer = new Map<string, string>();
  // producer label → the reroute op to append onto that producer's op[].
  const rerouteForProducer = new Map<string, NonNullable<NodeIntent['op']>[number]>();
  // the set of artifacts each judged producer produces — used to find its downstream consumers.
  const producedByJudged = new Map<string, Set<string>>();

  for (const node of spec.nodes) {
    if (!node.judgeGate) continue;
    const { judge, rerouteOp } = buildJudge(node);
    generated.push(judge);
    judgeForProducer.set(node.label, judge.label);
    rerouteForProducer.set(node.label, rerouteOp);
    producedByJudged.set(node.label, new Set(node.io.produces ?? []));
  }

  // A consumer of a judged producer = a node (other than the producer / the judge) that READS one of the
  // producer's produced artifacts. Such a consumer must now order AFTER the judge → add an explicit dep.
  const judgeLabels = new Set(generated.map((g) => g.label));

  const nodes: NodeIntent[] = spec.nodes.map((n) => {
    let next = n;

    // (a) The producer itself: strip the consumed `judgeGate` + append the producer-side reroute op.
    if (rerouteForProducer.has(n.label)) {
      const rerouteOp = rerouteForProducer.get(n.label)!;
      const { judgeGate: _drop, ...rest } = next;
      next = { ...(rest as NodeIntent), op: [...(next.op ?? []), rerouteOp] };
    }

    // (b) A downstream consumer of a judged producer: re-point it to depend on that producer's judge so the
    //     judge GATES the hand-off. A consumer connects to the producer EITHER by reading one of its
    //     produced files OR by an explicit `io.dependsOn` on the producer label — rewire BOTH. (Never the
    //     producer itself, never a judge node.) The judge already `dependsOn` the producer, so the chain
    //     stays producer → judge → consumer (no edge is dropped — only the consumer is pushed after the judge).
    if (!judgeLabels.has(next.label)) {
      const extraDeps: string[] = [];
      for (const [producerLabel, produced] of producedByJudged) {
        if (next.label === producerLabel) continue;
        const judgeLabel = judgeForProducer.get(producerLabel)!;
        const readsProduced = (next.io.reads ?? []).some((r) => produced.has(r));
        const dependsOnProducer = (next.io.dependsOn ?? []).includes(producerLabel);
        // `compile`/`inferEdges` resolve `dependsOn` against SLUG ids (dag.ts:slugify), so reference the
        // judge by its slug id (the `w0-classify__judge` label slugs to `w0-classify-judge`) — the reroute
        // expansion precedent (reroute/expand.ts:171 uses `slugify(...)` for in-slice label deps).
        if (readsProduced || dependsOnProducer) extraDeps.push(slugify(judgeLabel, 0));
      }
      if (extraDeps.length) {
        const existing = next.io.dependsOn ?? [];
        const merged = [...new Set([...existing, ...extraDeps])];
        next = { ...next, io: { ...next.io, dependsOn: merged } };
      }
    }

    return next;
  });

  return { ...spec, nodes: [...nodes, ...generated] };
}
