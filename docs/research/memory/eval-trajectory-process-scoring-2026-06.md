# Trajectory / process-based scoring from agent telemetry (2026-06)

## 0. Sources & recency note

Research brief on scoring an agent run from its **trace/telemetry** (tokens, thinking
time, tool-call log, retries, escalations) — process/trajectory evaluation, as distinct
from judging the final artifact. Tooling: **Exa** (`web_search_exa`, `web_search_advanced_exa`,
`web_fetch_exa`); no fallback needed. Recency prioritized to **2026 / H1 2026**; pre-2026
work is flagged `[background]`. Throughout, **CLAIMED** = an abstract's assertion;
**MEASURED** = a number from the paper's own evaluation.

Two findings most load-bearing for the consumer's question, both 2026:
- **Consensus ≠ verification** (arXiv 2603.06612): self-reported confidence does **not**
  reliably separate correct from incorrect, and trace-aggregation gives no truth signal in
  unverifiable domains.
- **Process features predict correctness but only weakly, and only as a probability**
  (HTC, arXiv 2601.15778; TRAJEVAL, arXiv 2603.24631): trace signals are a calibrated *risk
  estimate / diagnostic*, not a clean quality grade.

## 1. Process reward models & step verifiers

**What they are.** PRMs score *intermediate* reasoning/agent steps; ORMs score only the
final outcome. Survey: *A Survey of Process Reward Models* (arXiv 2510.08049, v3 2026-04-29)
— CLAIMED PRMs give finer credit assignment and beat ORMs at guiding tree search / Best-of-N,
but data generation (human / Monte-Carlo rollout / LLM-judge) is the central cost and noise
source. Foundational `[background]`: Lightman et al. *Let's Verify Step by Step* (2305.20050);
Wang et al. *Math-Shepherd* (rollout labels).

**Reliability — MEASURED, and it is the cautionary part:**
- **ProcessBench** (Zheng et al., 2024, 3,400 human-labeled items) and **PRMBench** (ACL 2025,
  6,216 problems / 83,456 step labels, arXiv 2501.03124) both find current PRMs miss many
  implicit error types (redundancy, inconsistency, wrong-theorem). PRMBench uses **negative-F1 /
  PRMScore** precisely because class imbalance makes raw accuracy misleading.
- **Out of distribution, out of luck** (EACL 2026 short, aclanthology 2026.eacl-short.31):
  across 7 LLMs, PRMs *help instruct models but fail to help — sometimes degrade — reasoning
  models*. SAE analysis: **80% of the PRM's reasoning features fire on formatting artifacts**
  (whitespace, Unicode, punctuation), not math content. This is direct evidence that a learned
  step-scorer can be a verbosity/format detector in disguise.
- **GR-Ben** (arXiv 2605.01203): PRMs trained on math score **<20%** error-detection on general
  reasoning vs. their high math numbers — i.e. step-scoring **does not transfer across domains**.
- **EST-PRM** (arXiv 2606.00437): under label-preserving structural perturbations (step
  inflation, position shift, confidence perturbation) PRMs degrade systematically — "dense
  supervision expands the attack surface; each step score is a failure point."
- **The Hidden Bias / PRISM** (arXiv 2606.09078): the core PRM tension is the **FPR↔FNR
  trade-off** — you cannot get both low false-positive and low false-negative; reducing one
  raises the other.

**PRM-vs-ORM tradeoff (MEASURED where noted).** Dense PRM signal can be *miscalibrated*:
high local-coherence score on a globally wrong trajectory → reward hacking. **PROGRS** (arXiv
2604.02341) keeps **outcome dominant** and uses process reward only as a *relative* preference
within outcome-defined groups (outcome-conditioned centering). **VPRM** (ACL Findings 2026,
2026.findings-acl.1611 / arXiv 2601.17223): replacing the neural step-judge with a
**deterministic rule-based verifier** gives MEASURED **+6.5% F1 over verifiable outcome reward
and up to +20% over SOTA**, and consistently beats neural PRMs — i.e. *the win comes from
verifiability, not from "process" per se*. Agent-specific: **AgentPRM** (WWW 2026) reframes step
score as **progress-toward-goal** (TD + GAE), not correctness, since agent actions have no
clear-cut right/wrong — MEASURED **8× more compute-efficient**. **WebArbiter / WebPRMBench**
(arXiv 2601.21872) makes the WebPRM emit a *justification + verdict*, beating GPT-5 by 9.1 pts
on its bench. **Sci-PRM** (arXiv 2606.04579) and **GroundedPRM** (MCTS + external-tool
verification, +26% relative on ProcessBench) both show the reliable variants **ground the step
in an external tool/oracle** rather than judging the text alone.

**Takeaway for §5:** step-scoring is reliable *only when each step is checked against an
external verifier/oracle*; learned/LLM-judge PRMs are noisy, format-biased, and do not
generalize across domains.

## 2. Overthinking / test-time-compute — is "time spent" a signal?

**Direct answer: more time is genuinely ambiguous, and the relationship is non-monotonic —
"time spent" is NOT a usable standalone quality signal, but the *shape* of the curve is a
usable risk signal.**

- *Does Thinking More always Help?* (arXiv 2506.04210, v2) `[background→2026]` — MEASURED a
  **non-monotonic** curve: accuracy rises then **degrades past a critical length** ("overthinking");
  early gains are largely **increased variance**, not better reasoning. There is "no reliable
  stopping criterion," so single-trace length is brittle.
- *When More Thinking Hurts* (ACL Findings 2026, 2026.findings-acl.1199 / arXiv 2604.10739) —
  MEASURED **flip-event tracking**: at low budgets positive flips (wrong→right) dominate; **beyond
  ~7K tokens negative flips (right→wrong) dominate (flip ratio > 1)**, statistically significant
  at ≥7K. **Easy problems cross the overthinking threshold at ~2K tokens vs ~8K for hard ones** —
  so the same token count is "good" or "bad" depending on difficulty. Crucially: **overthinking
  indicators predict negative flips at 76.3% precision @ 80% recall** — a usable *diagnostic*,
  not a clean grade.
- *How Much Thinking is Enough?* (arXiv 2605.23926) — proves **over-thinking is a structural
  consequence of length-agnostic outcome rewards** (no finite optimal stopping time); model-,
  algorithm-, and data-independent.
- *Thinking Past the Answer* (arXiv 2606.02835) — MEASURED: stopping at the **first correct
  prefix ("Optimal Length") beats default behavior by ~10%** on multimodal benchmarks;
  distinguishes *verbose* overthinking (still correct) from *harmful* overthinking (drifts to wrong).
- **Detection from the trace:** *Evolution of Thought / RCPD* (ACL 2026, 2026.acl-long.1239)
  finds a **Reasoning Completion Point** (semantic convergence) after which tokens are redundant,
  detectable online via the rank of the stop-token. **ROM** (arXiv 2603.22016) attaches a
  detection head to late-layer hidden states; MEASURED **−47.2% length, +121% efficiency**.
  **THOUGHTTERMINATOR** (arXiv 2504.13367) `[background]`: reasoning models are **poorly
  calibrated, especially on easy problems** (DUMB500). *Do LLMs Really Need 10+ Thoughts*
  (ACL 2026, 2026.acl-long.773): even where thinking helps, **~80% of the extra compute is
  wasted** ("token waste" metric).
- **Verbosity/length bias contaminates any length-based score.** *Judging the Judges*
  (arXiv 2604.23178): MEASURED length-aware verbosity bias is **model-dependent** — Gemini-2.5-Pro
  +0.40, Llama-3.3-70B +0.44 (prefer longer), **Claude Sonnet 4 −0.12 (prefer shorter)**, GPT-4o
  ≈neutral. So a check-model reading "this run is long, score it down" inherits its own bias.
  *BabelJudge* (arXiv 2606.22329), *FiMi-RM* (ACL 2026, 2026.acl-long.133), *Causal-lens length
  debiasing* (AAAI 2026) all confirm reward/judge models reward length "regardless of quality."

**Verdict:** time/tokens are a **diagnostic of *risk* conditioned on difficulty** (steep
post-convergence growth, negative-flip zone, RCP overshoot), never a free-standing quality
score. "More time" is good below the difficulty-dependent threshold and bad above it.

## 3. Hallucination & error detection from traces

**Reliable, with numbers — these are the trustworthy trace signals:**
- **Semantic entropy** (Farquhar/Kuhn, *Nature* 2024) `[background]` — clusters meaning-equivalent
  samples; MEASURED strong **AUROC/AURAC** for detecting confabulations; the canonical baseline.
- **RACE** (AAAI 2026, doi 10.1609/aaai.v40i39.40624) — fuses four trace signals: inter-sample
  reasoning consistency, **semantic-entropy answer uncertainty (SINdex)**, reasoning↔answer
  semantic alignment, and internal reasoning coherence; CLAIMED best-in-class vs SelfCheckGPT /
  semantic entropy / LNPE.
- **ARS** (arXiv 2601.17467, 2026-01-24) — trace-conditioned answer embedding; MEASURED **+19.79%**
  on TruthfulQA, **SOTA 86.64%**; counterfactual-consistency thresholding alone hits **80.7%** on
  GSM8K. Motivation: hallucinated answers sit on **unstable** decoding.
- **Multi-Granular UQ** (doi 10.59543/comdem.v3i.17665, 2026-03) — single-pass features
  (incl. "temporal entropy dynamics"): MEASURED **89.27% AUROC on HaluEval (Llama-3-8B), +2.15pp
  over semantic entropy at 8.2× lower latency** — useful because it avoids the 5–10× sampling cost.
- **RFS-Guard** (ACL 2026, 2026.acl-long.885) — attention-routing-collapse signal; **no external
  tool or resampling**, localizes the hallucinated step. **G-Detector** (OpenReview kkYnOEmA7D) —
  topological signatures of the reasoning graph: MEASURED **88.90% acc / 94.11% AUROC**, and naive
  baselines like AvgEntropy only **56%** — i.e. *generic intrinsic signals fail on long-CoT*.
- **Tool-output grounding:** the reliable PRM variants in §1 (GroundedPRM, Sci-PRM) catch
  tool-misuse by checking the actual tool result, and SentinelRCA's `retrieval_without_grounding`
  detector (empty retrieval → LLM call) is a deterministic hallucination-risk flag.

**Important caveat (2026).** *Sanity Checks for Long-Form Hallucination Detection* (arXiv
2605.08346) warns many "reasoning-aware" detectors actually exploit **endpoint cues, answer
format, or response length** rather than reasoning quality — so a detector's headline AUROC can
overstate that it reads the *process*. Multi-sample methods (SelfCheckGPT, semantic entropy)
also cost **5–10× latency**.

## 4. Agent-trajectory evaluators (scoring from the tool-call log)

- **Agent-as-a-Judge** (arXiv 2410.10934) `[background, foundational]` — agentic system judges
  another's *step-by-step* process; on DevAI MEASURED dramatically > LLM-as-a-Judge and "as
  reliable as human." **Survey** (arXiv 2601.05111, 2026-01). **AJ-Bench** (ACL Findings 2026,
  arXiv 2604.18240): MEASURED Agent-as-a-Judge beats LLM-as-a-Judge by **+0.13 F1** but tops out
  at **0.72 F1 — not saturated**; and **more judge reasoning effort does not reliably help**
  (gpt-5-mini high ≯ medium; deepseek thinking < no-thinking). Failure modes are exactly the
  trace-level ones: missing/incorrect tool calls, misread tool output, right-evidence-wrong-reason.
- **TRAJEVAL** (arXiv 2603.24631, 2026-03-25) — *the* code-agent trajectory diagnostic.
  Decomposes a run into **search / read / edit** stages with precision+recall vs reference patch
  over **16,758 trajectories**. MEASURED: **all agents examine ~22× more functions than necessary**
  (universal inefficiency); distinct failure modes per model (GPT-5 locates but mis-targets edits;
  Qwen-32B fails file discovery). Diagnostics are **predictive (Pass@1 MAE 0.87–2.1%)** and
  **actionable (real-time trajectory feedback: +2.2–4.6 pp accuracy, −20–31% cost)**.
- **AgentProp-Bench** (arXiv 2604.16706) — judge *reliability* audit: **substring judging κ=0.049
  (chance)**; a **3-LLM ensemble only reaches κ=0.432 (moderate)**. A tool-parameter injection
  propagates to a wrong final answer with **~0.62 probability**; **rejection and recovery are
  orthogonal skills (ρ=0.126, p=0.747)**. Lesson: automated trajectory judging is far less
  reliable than assumed.
- **BabelJudge** (arXiv 2606.22329) — adds nine trajectory perturbations (wrong args, swapped
  tools, hallucinated calls, missing steps) + **tool accuracy, hallucination detection,
  trajectory-length bias** metrics; finds a judge with high *text* reliability can have low
  *tool-argument* accuracy.
- **Production tooling (2026, practitioner).** **SentinelRCA** (github sentinelrca/sentinel,
  2026-05) runs **deterministic, LLM-free detectors** over LangSmith/Langfuse/OTel traces:
  `agent_loop` (same agent 3+×), `retry_storm` (3+ retries no backoff), `token_cost_runaway`,
  `missing_termination_condition`, `sequential_tools` (parallelizable). **AWS Bedrock AgentCore
  Observability** (2026-06-29): force termination after **3 identical repeated actions**, alarm on
  token-per-session growth. Retry-amplification analysis (tianpan.co, 2026-04): **90.8% of retries
  in a 200-task benchmark were wasted on non-retryable errors** (e.g. calling nonexistent tools);
  the bounded-recovery consensus is **~3 retries/call, ~2 replans/turn, then escalate**
  (SHIELDA / PALADIN lines). These tool/retry signals are **deterministic and trustworthy** because
  they don't require judging meaning.

## 5. Verdict — quality-score vs diagnostic, and the weight telemetry deserves

**The consumer's intuition is correct: trace signals are a strong DIAGNOSTIC (why a run went
wrong, blame-routing) but a weak and ambiguous QUALITY score.** The decisive evidence:
- **Confidence/consensus from the trace ≠ truth.** *Consensus is Not Verification* (arXiv
  2603.06612): even at **25× inference cost**, polling/aggregation gives **no consistent gain** in
  unverifiable domains and *amplifies shared misconceptions*; **self-reported confidence fails to
  separate correct from incorrect**, so confidence-weighting yields no benefit. *Knowing What You
  Know Is Not Enough* (arXiv 2511.13240): an **action–belief gap** — confidence is orthogonal to
  what the model actually does. So you cannot read quality off the model's own certainty.
- **Process features predict correctness only as a calibrated probability.** *Agentic Confidence
  Calibration / HTC* (OpenReview B1ISNZQHuI, arXiv 2601.15778, 2026-06): macro+micro
  trajectory features (stability, confidence dynamics) give the **best calibration/discrimination**
  and **transfer across domains** — but the deliverable is **P(correct), a risk estimate**, not a
  grade. TRAJEVAL's trace stats predict Pass@1 to ~1% MAE — again a *predictor*, not a verdict.

**Trustworthy enough to ACT on (deterministic, low-ambiguity):**
- **Tool-call-log structure:** loops (same action 3+×), retry storms, redundancy/duplicate calls,
  non-retryable retries, missing-termination, parallelizable serial calls (SentinelRCA, TRAJEVAL's
  22× over-search, AgentCore). These need no semantic judgment.
- **Tool-output grounding:** step verified against the actual tool result (GroundedPRM, Sci-PRM,
  RFS-Guard) — reliable because grounded in an external oracle, not text.
- **Hallucination/uncertainty from sampling:** semantic entropy / RACE / ARS — reliable
  (80–94% AUROC) but cost 5–10× and can latch onto endpoint cues (Sanity Checks caveat).

**Diagnostic-only (route blame, do NOT gate an edit on it):**
- **Tokens / thinking-time / verbosity:** non-monotonic and difficulty-dependent (§2). Usable as a
  *risk flag* (post-RCP growth, ≥7K negative-flip zone, 76% precision on flips) but a check-model
  rating "long = bad" inherits model-specific verbosity bias (Claude −0.12 vs Llama +0.44). Never a
  standalone quality score.
- **Generic learned PRM / LLM-judge step scores:** format-biased (80% artifact features), don't
  transfer across domains (<20% on GR-Ben), FPR↔FNR trade-off — diagnostic hints, not gates.

**Weight telemetry deserves in an overall score:** **low as a direct quality term, high as a
gate and a blame-router.** Treat deterministic process violations (loops, retry storms,
ungrounded tool use, runaway tokens) as **hard guardrails / veto flags and as the explanation of
*why* a run failed**, and use uncertainty signals as a **calibrated abstain/escalate threshold** —
but anchor the actual *quality* judgment on **verifiable outcomes** (the consistent 2026 lesson:
VPRM, PROGRS, GroundedPRM all keep outcome/external-verification dominant and use process signal
only as a relative, grounded supplement). Telemetry tells you *whether to trust and where it
broke*, not *how good the artifact is*.
