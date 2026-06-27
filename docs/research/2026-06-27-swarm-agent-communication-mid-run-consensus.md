# Swarm Agent Communication & Mid-Run Consensus — Do We Need It?

**Date:** 2026-06-27
**Scope:** PiFlow multi-agent DAG — whether to add mid-run agent-to-agent communication / debate / consensus among concurrently-running `pi` nodes, given the frozen-plan + filesystem-contract spine.
**Related design:** `docs/design/l1-node-envelope.md` (philosophy #1 filesystem-is-the-contract, #5 producer⊥control), `docs/design/node-action-protocol.md` (fusion + bounded reroute, compile-time unroll).
**Verdict:** **DEFER.** Don't build a live agent-to-agent channel now. For a heterogeneous, differentiated, long-horizon DAG it is close to the documented *worst case*; the ~10% of it that is real (diverse-draft selection on verification-shaped tasks) is already expressible as a static fusion/judge node over the filesystem blackboard.

---

## Executive Summary

- **The question conflates three different mechanisms.** Separating them is the whole analysis:
  1. **Mid-run *plan change* (dynamic DAG / replanning)** — our position (freeze the plan until the DAG finishes; a Hermes/control node changes only the *next* deck) is correct and the literature does not push back on it. **Keep frozen.**
  2. **Mid-run *data sharing* among concurrent agents** — we already do this via `io.reads ⋈ io.produces` over declared files. The surprise: **the filesystem-as-contract we already have IS the "blackboard / shared substrate" the consensus literature is independently converging on.** Not missing — we have the good version.
  3. **Debate/consensus to *improve answer quality*** — the only genuinely new capability, and the part the 2024–2026 evidence has soured on hardest.
- **Most of multi-agent debate's value is majority *voting*, not the debate.** "Debate or Vote" disentangles the two across 7 NLP benchmarks: voting accounts for most of the gain; debate itself is a *martingale* over belief trajectories — it does **not** improve expected correctness, it preserves belief dynamics. The working part needs **no inter-agent channel** — run N diverse drafts, then pick/merge.
- **Debate helps on *judging*, barely on *solving*.** Test-time-scaling analysis (ICLR 2026): only limited advantage over single-agent scaling on solution-finding (math/code); meaningful gains mostly on response-*judging* (safety / "is this correct"). Our producer nodes are solvers.
- **Debate actively *hurts* in heterogeneous fleets — which is our entire thesis.** Mixed strong/weak groups are the most prone to error amplification and reflexive convergence; adding a weaker agent drags the stronger ones down. Our differentiator is *per-node heterogeneous models*. A live debate channel across a heterogeneous fleet is the failure mode, not the showcase.
- **The costs land hardest in our target regime (long-horizon, parallel):** coordination tax grows ~O(n²) for broadcast/peer-to-peer (≈50% of tokens spent coordinating at n≈7); debates *drift off* the original problem the longer they run; a single persuasive agent can override majority vote.
- **We already have the disciplined version of the only part that works:** the **fusion node** (`expandFusion` → `[obligations?, …siblings, judge]`) is static fan-out-to-diverse-producers → a judge that reconciles — capturing the voting/selection win **without** the live channel, the O(n²) tax, the drift, or a back-edge. It compile-time-unrolls, so it never violates the frozen-plan invariant. This is the Anthropic multi-agent-research pattern verbatim (subagents write to the filesystem, return lightweight references, no prose routed through a coordinator).
- **Revisit criterion (we named it ourselves):** consensus earns its cost only when agents become an **undifferentiated swarm redundantly attacking the *same* sub-problem with diverse initial answers**. We don't have that regime — our nodes are differentiated by construction (role, files, tools, model). If we ever do, the in-philosophy move is a **static judge node + selective (confidence-gated) trigger + bounded unroll — never a live message bus, never mid-run replanning.**

---

## A. The three mechanisms hiding under "agents talk to each other"

The original framing ("agents communicate mid-run to settle consensus / debate") bundles three things with *different* answers. Conflating them is what makes mid-run debate "feel" necessary.

| # | Mechanism | What it actually is | PiFlow status | Verdict |
|---|---|---|---|---|
| 1 | **Plan change / replanning** | Mutating the DAG while it runs | Deliberately disallowed; plan frozen at design phase, control node changes the *next* deck | **Keep frozen** — literature gives no reason to unfreeze |
| 2 | **Data sharing** | Concurrent agents reading each other's intermediate outputs | `io.reads ⋈ io.produces` over declared files (philosophy #1) | **Already have it** — it *is* the blackboard the field is converging on |
| 3 | **Debate / consensus** | Diverse hypotheses + cross-critique → reconcile to one answer | Static `expandFusion` (fan-out → judge) | **Defer the *live* form**; the static form is the validated one |

The rest of this brief is mostly about #3, because #1 and #2 are settled.

---

## B. Multi-agent debate — when it helps, when it hurts

The 2024–2026 literature moved from "debate boosts reasoning" to a much narrower, conditional claim. The load-bearing findings:

| Finding | Source | What it says |
|---|---|---|
| **The gain is voting, not debate** | *Debate or Vote* (arXiv 2508.17536) | Disentangles MAD into Majority-Voting + inter-agent Debate across 7 NLP benchmarks; voting accounts for most improvement. Models debate as a stochastic process → a **martingale** over belief trajectories: debate alone does **not** improve expected correctness. Helps only with *targeted/asymmetric* information. |
| **Helps judging, barely solving** | *Revisiting MAD as Test-Time Scaling* (OpenReview xzRGxKmeEG, ICLR 2026) | vs strong single-agent test-time-scaling baselines: only **limited** advantage on solution-finding (math), modest growth with difficulty; gains concentrate on **response-judging** (safety). |
| **Heterogeneous groups degrade** | *Talk Isn't Always Cheap* (arXiv 2509.05396) | Debate can make final answers **worse than a single agent**; agents amplify each other's errors / converge reflexively. **Mixed strong+weak groups are the most prone — adding a weaker agent harms the outcome and drags strong agents down.** |
| **Long debates drift** | *Stay Focused: Problem Drift in MAD* (arXiv 2502.19559) | Longer debates drift off the original problem on complex/long-reasoning tasks; drivers: lack-of-progress (35%), low-quality feedback (26%), lack-of-clarity (25%). Directly the long-horizon regime. |
| **Fragile to one persuader** | *When collaboration fails* (Nature Sci. Reports s41598-026-42705-7) | A single persuasive adversarial agent steers cooperators wrong and **overrides majority voting** (10–40% drops); under adversarial pressure debate underperforms a single robust model. |
| **Works only under conditions** | *Demystifying MAD: Confidence and Diversity* (arXiv 2601.19921) | MAD helps when (a) **initial answer diversity** seeds ≥1 correct hypothesis and (b) agents express **calibrated confidence** and update on it — which breaks the martingale. Harder problems benefit more. |
| **So trigger it selectively** | *iMAD* (AAAI 2026, doi 10.1609/aaai.v40i35.40181) | Fire debate only when a single agent's self-critique shows hesitation; up to **92% token reduction** vs always-on MAD at equal/better accuracy. |
| **Rethink the premise** | *Position: Stop Overvaluing MAD* (OpenReview tMJvb9JDsd) | Calls for re-evaluating MAD and embracing model heterogeneity rather than assuming debate-as-default. |

**Net:** the real mechanism is *diverse hypotheses + selection*. The "debate" wrapper around it is, at best, conditionally useful (judging tasks, diverse + calibrated agents, hard problems) and at worst actively harmful (heterogeneous fleets, long horizons, adversarial/persuasive inputs). Both the upside and the downside point to the same engineering conclusion: get the *diversity + a judge*, skip the *live cross-talk*.

---

## C. Communication overhead — orchestrator/artifacts beats mesh

The coordination *channel* itself has a measured cost, and the field's most credible production write-up lands on exactly our pattern.

- **Quadratic coordination tax.** Broadcast / peer-to-peer mesh communication scales ~O(n²); ≈**50% of tokens are spent on coordination at n≈7** agents. Hierarchical routing is linear but pays a ~23% accuracy drop from the information bottleneck. (*Communication Overhead Grows Quadratically*, clawRxiv 2604.00736 — non-peer-reviewed, directional.)
- **Anthropic's multi-agent research system** (engineering blog, 2025-06-13): subagents **bypass the coordinator by writing outputs to the filesystem and returning lightweight references**, rather than routing prose through a lead agent. This "avoids the game of telephone, preserves fidelity, and saves tokens," and is most effective for structured outputs (code, reports). **This is PiFlow's model verbatim.**
- **Pattern guides converge** (*AgentOrchestra* arXiv 2506.12508; *Swarm vs Mesh vs Hierarchical*; Augment Code orchestration guide): direct agent-to-agent mesh is worth its cost only for a **small group iterating tightly on a shared artifact with real-time feedback**; orchestrator/DAG-through-artifacts wins for **multi-file/service, long-running, traceable** work with independent subtasks. Mesh needs conflict resolution + global state ownership we'd have to build.

**Net:** the validated pattern for differentiated, long-horizon, traceable work is orchestrator-through-artifacts — which we already are. Adding a mesh channel imports an O(n²) bill and a conflict-resolution problem to buy a benefit Section B already showed is mostly illusory here.

---

## D. The blackboard convergence — we already built it

Independent of the debate literature, a second body of 2025–2026 work is reinventing coordination-through-a-shared-store, and it keeps landing on the primitive we already have.

- *Exploring LLM MAS Based on Blackboard Architecture* (arXiv 2507.01701): a central blackboard captures all messages; agents act on board state until **consensus on the board** — competitive with SOTA **using fewer tokens** than message-passing MAS.
- *Terrarium* (arXiv 2510.14312): an **append-only shared log** of proposals/commitments/goals; stigmergic coordination **without bespoke pairwise messaging**.
- *Beyond Text-Passing* (OpenReview RRIw2L4Z1g): replace NL message-passing with a **typed shared world-model + causal graph + budget-arbitrated** substrate.
- *LLM-based Multi-Agent Blackboard for Information Discovery* (OpenReview egTQgf89Lm): central agent posts requests, sub-agents volunteer; **13–57% over master-slave**.
- Secondary/marketing (directional only): *DLBP* (Zenodo 19068474, deterministic blackboard pipeline of Normalizer/Proposer/Critic/Verifier/Correlator), *Token Coherence* (arXiv 2603.15183, MESI-style artifact invalidation), AIONdb white paper (stigmergic substrate w/ transactional coherence + temporal ordering).

**Net:** these papers describe — sometimes with more typing/auditing on top — what PiFlow's **filesystem contract** already is: a shared, append-mostly, auditable store that agents coordinate through by leaving declared marks (philosophy #1). The field is building toward our substrate, not away from it. The credible upgrades on the horizon are *typed state + invariants* and *causal/attribution graphs* on the shared store — additive to our contract, not a message bus.

---

## E. Fit analysis — why this is a poor fit for PiFlow specifically

Three of our load-bearing design choices each make live mid-run debate *worse* for us than for a generic MAS:

1. **Heterogeneous per-node models = the documented worst case for debate.** Our thesis is one-real-pi-per-node with heterogeneous tools/sandbox/model. *Talk Isn't Always Cheap* shows mixed strong/weak debate groups are the most likely to degrade and to drag strong agents down. The exact axis we differentiate on is the axis that breaks debate.
2. **Long-horizon = the regime where debates drift.** *Problem Drift* shows degradation grows with debate length on complex tasks — our target workloads.
3. **Frozen-plan + acyclic DAG = no native home for a debate loop.** A debate round is a back-edge; our loader rejects cycles (`checkCycles`). We'd have to either break the spine or unroll it — and if we unroll it, it's just a fusion/judge fan-out (Section F), not a channel.

What we'd be *adding* (channel, conflict resolution, global state owner, O(n²) tokens, drift, adversarial fragility) buys a benefit that — for solving tasks, in a heterogeneous fleet, over long horizons — the evidence says is near zero or negative.

---

## F. What already covers the real benefit

The legitimate "diverse drafts → reconcile" win maps **one-to-one onto the fusion node**:

- `expandFusion` → `[obligations?, …siblings, judge]` (`packages/core/src/workflow/fusion/expand.ts:68`) is static fan-out to diverse producers → a judge that reconciles. That **is** the voting/selection mechanism — the part Section B says actually works — with **no live channel, no O(n²) tax, no drift, no back-edge.**
- It **compile-time-unrolls**, so it never violates the frozen-plan invariant (#1 above).
- **Bounded debate rounds, if ever wanted, are already expressible:** `expandReroute` (compile-time unroll, no cycles, bounded `k`, `evidence[]` carried into the re-entry clone's `consultPreamble`) is exactly "do another round, feeding the prior round's critique forward." Rounds become unrolled acyclic stages, not a runtime loop.
- Consensus, when needed, is a **node, not a side-channel** — consistent with philosophy #5 ("a candidate hook that needs a model → promote it to a pi node"). The judge/arbiter is a `pi` node fed the diverse drafts as files.

---

## G. Decision & revisit criteria

**Decision: DEFER live agent-to-agent communication / debate.** Do not add a message bus, mesh channel, or mid-run replanning. Keep the plan frozen; keep coordination on the filesystem contract; express any "consensus" as a static fusion/judge node.

**Revisit if and only if** the workload shifts into the **undifferentiated-swarm regime**: many parallel agents redundantly attacking the *same* sub-problem, whose roles are *not* differentiated enough to separate via files/tools/model, where answer quality on a hard, verification-shaped task is the bottleneck. (This is the regime we ourselves identified as the only practical case.)

**Even then, the in-philosophy implementation is *not* a channel:**
1. **Diversity by construction** — N producer nodes with varied model/seed/prompt, writing disjoint draft files (we already do write-disjoint dirs).
2. **A static judge/arbiter node** reconciling the drafts (fusion), optionally with **calibrated-confidence** inputs (the one condition under which debate-style updating beats plain voting — *Demystifying MAD*).
3. **Selective trigger, not always-on** — a `gate` op on a low-confidence verdict routes into a bounded judge round (iMAD's 92%-token-saving lesson), via `expandReroute`.
4. **Bounded, acyclic, compile-time** — never a live bus, never mid-run plan mutation.

This keeps every future "consensus" feature inside the frozen-plan, compile-time-unroll spine, and buys only the part of multi-agent debate that the evidence supports.

---

## References

**Primary (peer-reviewed / arXiv / established lab):**
- Debate or Vote: Which Yields Better Decisions in Multi-Agent LLMs? — arXiv 2508.17536
- Revisiting Multi-Agent Debate as Test-Time Scaling: When Does Multi-Agent Help? — OpenReview xzRGxKmeEG (ICLR 2026)
- Talk Isn't Always Cheap: Understanding Failure Modes in Multi-Agent Debate — arXiv 2509.05396
- Stay Focused: Problem Drift in Multi-Agent Debate — arXiv 2502.19559
- Demystifying Multi-Agent Debate: The Role of Confidence and Diversity — arXiv 2601.19921
- When collaboration fails: persuasion-driven adversarial influence in multi-agent LLM debate — Nature Scientific Reports s41598-026-42705-7
- iMAD: Intelligent Multi-Agent Debate for Efficient and Accurate LLM Inference — AAAI 2026, doi 10.1609/aaai.v40i35.40181
- Position: Stop Overvaluing Multi-Agent Debate — OpenReview tMJvb9JDsd
- How we built our multi-agent research system — Anthropic Engineering, 2025-06-13
- AgentOrchestra: A Hierarchical Multi-Agent Framework for General-Purpose Task Solving — arXiv 2506.12508
- Toward Agentic AI: Task-Oriented Communication for Hierarchical Planning of Long-Horizon Tasks (HiTOC) — arXiv 2601.13685
- Understanding Multi-Agent LLM Frameworks: A Unified Benchmark (MAFBench) — arXiv 2602.03128
- CASTER: Context-Aware Strategy for Task-Efficient Routing — arXiv 2601.19793
- Exploring Advanced LLM Multi-Agent Systems Based on Blackboard Architecture — arXiv 2507.01701
- LLM-based Multi-Agent Blackboard System for Information Discovery in Data Science — OpenReview egTQgf89Lm
- Beyond Text-Passing: Shared Cognitive Substrates for Multi-Agent LLM Coordination — OpenReview RRIw2L4Z1g
- Terrarium: Revisiting the Blackboard for Multi-Agent Safety, Privacy, and Security Studies — arXiv 2510.14312

**Secondary (blog / whitepaper / non-peer-reviewed — directional only):**
- Communication Overhead in Multi-Agent LLM Systems Grows Quadratically with Agent Count — clawRxiv 2604.00736
- Token Coherence: Adapting MESI Cache Protocols to Minimize Synchronization Overhead — arXiv 2603.15183
- Deterministic Blackboard Pipelines with Specialized LLM Knowledge Sources (DLBP) — Zenodo 19068474
- The Shared Substrate — AIONdb White Paper
- Multi-Agent Orchestration: A Practical Architecture Without the Buzzwords — Augment Code
- Agent Orchestration Patterns: Swarm vs Mesh vs Hierarchical — gurusup.com

> **Provenance:** Exa search sweep (2026-06-27) across three axes — multi-agent debate efficacy, inter-agent communication overhead, blackboard/stigmergic coordination — ~23 sources, convergent. Synthesis cross-checked against `docs/design/l1-node-envelope.md` and `docs/design/node-action-protocol.md`.
