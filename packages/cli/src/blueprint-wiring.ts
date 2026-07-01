// The CODE-SIDE wiring map keyed by blueprint id — the deterministic mechanical skeleton `stamp` composes.
//
// Design decision (docs/design/blueprint-compose-verb.md, "Machine-readable wiring rule" + the user steer):
// the wiring rule is a CODE map keyed by blueprint id, NOT frontmatter — a user blueprint without a rule is
// discoverable (list/show) but NOT stampable (stamp exits non-zero, "compose by hand"). Each rule encodes,
// per ROLE, the fixed mechanical fields that reproduce that blueprint's golden `node.json` set BY
// CONSTRUCTION (authored by reading the 2 goldens): the owns glob, the dep pattern (role references), the
// reads, the artifact, on-fail (default block), returnMode, and the reroute {toRole, max-from-lane-plan}.
// It carries ZERO DAG logic — it never draws an edge; `deps` are authored ids and `extract`/`inferEdges`
// still derive the topology from `reads ⋈ produces`. The INTELLIGENT holes (which preset each lane binds,
// how many producer lanes, the ids) come from the agent-authored lane-plan; this map is the fixed function
// of those choices.
//
// This task covers ONLY the 2 canonical linear/fan-out shapes (produce-verify-fix, spec-fanout-build).
// Fusion + quality/verify (the full lane-plan field set) and `insert` are LATER tasks.

/**
 * A dep reference: the ROLE(s) whose lane id(s) become this role's `deps`. Resolved against the lane-plan at
 * stamp time (role → the lane id filling it). `all: true` ⇒ every lane filling that role (the fan-in join).
 */
export interface DepRef {
  role: string;
  all?: boolean;
}

/**
 * The mechanical skeleton for one blueprint ROLE — the fixed fields that reproduce the golden node. Paths are
 * `{{RUN}}`-relative on `reads` and template-relative on `owns`/`artifacts`. `{facet}` in a template is
 * filled from the lane (the parallel producer's disjoint sub-namespace; see `facetOf`).
 */
export interface RoleSkeleton {
  /** Upstream role references → this node's `deps` (resolved to lane ids, in listed order). */
  deps: DepRef[];
  /** Write-authority glob(s); `{facet}` ⇒ the lane's facet (disjoint parallel lane). */
  owns: string[];
  /** Required output artifact(s), template-relative; `{facet}` ⇒ the lane's facet. `[]` ⇒ a return-only gate. */
  artifacts: string[];
  /** Exposed read dirs (`{{RUN}}`-relative) — the OS allow-list + the seam this role consumes. */
  reads: string[];
  /** `required` ⇒ a return-mode gate (verify): the verdict IS the output, no artifact. Omit ⇒ default. */
  returnMode?: 'required';
  /** A bounded reroute back to the `toRole` lane on failure (verify's self-fix loop). `max` = lane-plan K. */
  reroute?: { toRole: string };
  /** policy.fail (default 'block' — every producing/gating node must complete or block). */
  onFail?: 'block' | 'warn' | 'stop';
}

/** A blueprint's full wiring rule: the per-role skeletons + which role fans out into parallel lanes. */
export interface WiringRule {
  /** role name → its mechanical skeleton. */
  roles: Record<string, RoleSkeleton>;
  /**
   * The role that MAY appear as N parallel lanes (each a disjoint `{facet}` producer). Every OTHER role is a
   * single lane. Absent ⇒ a purely linear blueprint (every role is one lane). Used to validate the plan +
   * to know which role's `deps` fan IN.
   */
  parallelRole?: string;
}

/**
 * The facet of a parallel producer lane — its disjoint sub-namespace, the LAST `-`-delimited segment of its
 * id (the golden ids `prod-impl`/`prod-tests`/`prod-types` ⇒ `impl`/`tests`/`types`, filling `frag/impl/**`
 * etc.). A single-segment id is its own facet. PURE; the ONLY id-derived value the map reads.
 */
export function facetOf(id: string): string {
  const i = id.lastIndexOf('-');
  return i < 0 ? id : id.slice(i + 1);
}

/**
 * The wiring rules, keyed by blueprint id. Authored FROM the 2 goldens so rule and fixture agree by
 * construction (each field lifted from the golden's node.json set):
 *   • produce-verify-fix (`.piflow/example-produce-verify-fix/template/`): plan → produce → verify⟲.
 *   • spec-fanout-build  (`.piflow/example-spec-fanout/template/`): design → M×produce ∥ → verify-join → build.
 */
export const WIRING_RULES: Record<string, WiringRule> = {
  'produce-verify-fix': {
    roles: {
      // FIXED head — freezes the spec + the acceptance bar. Root (no dep), reads the raw request.
      plan: { deps: [], owns: ['plan/**'], artifacts: ['plan/plan.md'], reads: ['{{RUN}}'] },
      // The producer — reads the plan, writes the deliverable under out/**.
      produce: { deps: [{ role: 'plan' }], owns: ['out/**'], artifacts: ['out/result.md'], reads: ['{{RUN}}/plan'] },
      // The read-only Critic gate — RETURNS a verdict (no artifact), reroutes to produce on FAIL (bounded K).
      verify: {
        deps: [{ role: 'produce' }],
        owns: ['verify/**'],
        artifacts: [],
        reads: ['{{RUN}}/out'],
        returnMode: 'required',
        reroute: { toRole: 'produce' },
      },
    },
  },
  'spec-fanout-build': {
    parallelRole: 'produce',
    roles: {
      // FREEZES one spec — root, reads the request, writes the strict-JSON blueprint the fan-out reads.
      design: { deps: [], owns: ['spec/**'], artifacts: ['spec/blueprint.json'], reads: ['{{RUN}}'] },
      // M PARALLEL producers — each owns ONE disjoint facet's fragment, all read ONLY the frozen spec.
      produce: {
        deps: [{ role: 'design' }],
        owns: ['frag/{facet}/**'],
        artifacts: ['frag/{facet}/{facet}.md'],
        reads: ['{{RUN}}/spec'],
      },
      // The join gate — deps on EVERY producer, reads all fragments + the spec, RETURNS a PASS/FAIL verdict.
      'verify-join': {
        deps: [{ role: 'produce', all: true }],
        owns: ['verify/**'],
        artifacts: [],
        reads: ['{{RUN}}/frag', '{{RUN}}/spec'],
        returnMode: 'required',
      },
      // Assembles the verified fragments into the final module.
      build: { deps: [{ role: 'verify-join' }], owns: ['out/**'], artifacts: ['out/module.md'], reads: ['{{RUN}}/frag'] },
    },
  },
};

/** The wiring rule for a blueprint id, or `undefined` when the id is not stampable (no code-side rule). */
export function wiringRuleFor(id: string): WiringRule | undefined {
  return WIRING_RULES[id];
}
