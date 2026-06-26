// (M5 · G13) lowerToOps — the GRAMMAR-UNIFICATION lowering. A pure transform that maps an authored
// `node.json` (its deprecated `inject`/`hooks`/`checks`/`policy` aliases, OR a directly-authored `op`)
// into the ONE canonical `OpSpec[]` envelope (design §2.2 migration table). Runs AT THE LOADER ONLY: the
// dense `NodeSpec` gains exactly the one `op` field; the old keys never survive on it (design §5).
//
// The lowering is byte-faithful to the migration table:
//   • inject:[p]               → { when:'pre', reads:[p] }                                          (#10)
//   • hooks.seed:[{to,from}]   → { when:'pre',  writes:[to], transform:{kind:'seed', from} }
//   • hooks.project:[{to,from}]→ { when:'post', writes:[to], reads:[…from], transform:{kind:'project', from} }
//   • hooks.merge:{ops}        → { when:'post', transform:{kind:'merge', ops} }
//   • hooks.promote:[{…}]      → { when:'post', transform:{kind:'promote', from, to, reducer} }
//   • hooks.registryProject    → { when:'post', transform:{kind:'projectRegistry', …} }
//   • checks.pre:[Check]       → { when:'pre',  gate:{kind,path,param}, onFailure:<from policy/severity> } (#11)
//   • checks.post:[Check]      → { when:'post', gate:{kind,path,param}, onFailure:<from policy/severity> }
// `policy` folds into each gate's `onFailure` (the checks⊥policy split made universal, design §2.4): a
// `fail`-severity check takes `policy.fail` (default 'block'); a `warn`-severity check takes 'warn'.
//
// The order is STABLE: pre reads → pre seeds → pre gates → post transforms → post gates — so the codec /
// edge-inference see a deterministic envelope and the two authorings compare equal as a SET.

import type { OpSpec, OnFailure, Reducer, TransformBody } from '../../types.js';
import type { TemplateNode, TemplateCheck } from './types.js';

/** The consequence a lowered gate carries: a `warn`-severity check warns; a `fail` check takes policy.fail. */
function gateOnFailure(check: TemplateCheck, policy: TemplateNode['policy']): OnFailure {
  if (check.severity === 'warn') return 'warn';
  const fail = (policy?.fail as OnFailure | undefined) ?? 'block';
  return fail;
}

/** Lower one authored check → a `gate` op fired in the given lane. */
function lowerCheck(check: TemplateCheck, when: 'pre' | 'post', policy: TemplateNode['policy']): OpSpec {
  const gate: OpSpec['gate'] = { kind: check.kind };
  if (check.path !== undefined) gate.path = check.path;
  if (check.param !== undefined) gate.param = check.param;
  return { when, gate, onFailure: gateOnFailure(check, policy) };
}

/**
 * Lower a node's deprecated authoring grammars into the canonical `op[]`. If the node ALREADY authors `op`
 * directly, it is returned verbatim (authoring may declare the envelope outright). Returns undefined when
 * the node declares NONE of the lowerable surfaces (so an op-free node stays op-free — additive).
 */
export function lowerToOps(def: TemplateNode): OpSpec[] | undefined {
  if (def.op) return def.op as OpSpec[];

  const ops: OpSpec[] = [];

  // PRE — injected forced reads (#10): each becomes a read-only pre-op whose `reads` fold into the prompt.
  for (const p of def.inject ?? []) ops.push({ when: 'pre', reads: [p] });

  // PRE — seeds (stage a starting artifact before the model).
  for (const s of def.hooks?.seed ?? []) {
    ops.push({ when: 'pre', writes: [s.to], transform: { kind: 'seed', from: s.from } });
  }

  // PRE — checks.pre (#11): a gate that fires BEFORE the model over staged inputs.
  for (const c of def.checks?.pre ?? []) ops.push(lowerCheck(c, 'pre', def.policy));

  // POST — project/merge/promote/registryProject transforms (derive outputs from frozen inputs).
  for (const p of def.hooks?.project ?? []) {
    const reads = Array.isArray(p.from) ? [...p.from] : [p.from];
    ops.push({ when: 'post', writes: [p.to], reads, transform: { kind: 'project', from: p.from } });
  }
  if (def.hooks?.merge) {
    ops.push({ when: 'post', transform: { kind: 'merge', ops: def.hooks.merge.ops } });
  }
  for (const p of def.hooks?.promote ?? []) {
    const t: Extract<TransformBody, { kind: 'promote' }> = { kind: 'promote', from: p.from, to: p.to };
    if (p.merge !== undefined) t.reducer = p.merge as Reducer;
    ops.push({ when: 'post', transform: t });
  }
  if (def.hooks?.registryProject) {
    const rp = def.hooks.registryProject;
    ops.push({ when: 'post', transform: { kind: 'projectRegistry', source: rp.source, mapRef: rp.mapRef, key: rp.key } });
  }

  // POST — checks.post: a gate over produced artifacts.
  for (const c of def.checks?.post ?? []) ops.push(lowerCheck(c, 'post', def.policy));

  return ops.length ? ops : undefined;
}
