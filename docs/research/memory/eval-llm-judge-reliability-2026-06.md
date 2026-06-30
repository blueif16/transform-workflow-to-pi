# LLM-as-judge reliability + the false-confidence problem (2026-06)

> Mechanism-level brief for a self-optimization loop that wants to use a model's quality
> judgment as a near-ground-truth score (to credit-assign blame and to gate "accept edit iff
> score improves"). Central worry: the FALSE-CONFIDENCE failure — the model reflects, fails to
> spot the real mistake, and reports success with high confidence. Every claim is tied to a named
> system/paper + arXiv id + the specific knob. "Claimed" vs "measured" is separated throughout.

## 0. Sources & recency note

Tooling: all searches were run with the **Exa MCP tools** (`web_search_exa`, `web_fetch_exa`); no
WebSearch/WebFetch fallback was needed. Full text was fetched for the four most load-bearing
sources (Norman 2606.19544, Verdi 2605.11334, Srivastava 4jnJjSgQC1, Tian 2508.06225).

arXiv ids in the `26xx` / `25xx` form are the literal ids returned by the indexers for H1-2026 and
2025 preprints; treat them as the canonical handle, not a typo. h-index 0 on many 2026 authors is
an artifact of the indexer not having backfilled citations for brand-new preprints.

**2026 (primary, prioritized):**

- **Norman, Rivera, Hughes — "Reliability without Validity: A Systematic, Large-Scale Evaluation of
  LLM-as-a-Judge Across Agreement, Consistency, and Bias."** UC Berkeley. arXiv:2606.19544 (Jun
  2026). 21 judges, 9 providers, ~541k judgments, incl. the **April 2026 frontier** (GPT-5.4,
  Gemini 2.5). The single most current systematic measurement.
- **Qi, Dantsev, Sun — "VERDI: Single-Call Confidence Estimation for Verification-Based LLM Judges
  via Decomposed Inference."** Indeed Inc. arXiv:2605.11334 (May 2026).
- **Tian et al. — "Overconfidence in LLM-as-a-Judge: Diagnosis and Confidence-Driven Solution."**
  arXiv:2508.06225v3 (orig Aug 2025, v3 spans into 2026). TH-Score + LLM-as-a-Fuser.
- **Yang et al. — "SkillOpt: Executive Strategy for Self-Evolving Agent Skills."** Microsoft.
  arXiv:2605.23904 (May 2026); PyPI v0.1.0 2026-06-02; VentureBeat 2026-06-11.
- **"Judging the Judges: A Systematic Evaluation of Bias Mitigation Strategies in LLM-as-a-Judge
  Pipelines."** arXiv:2604.23178v2 / OpenReview QF4lAmG4zc (Apr 2026).
- **"Quantifying and Mitigating Self-Preference Bias of LLM Judges."** arXiv:2604.22891 (2026).
- **Roytburg et al. — "Are LLM Evaluators Really Narcissists? Sanity Checking Self-Preference
  Evaluations."** arXiv:2601.22548 (Jan 2026).
- **"Nine Judges, Two Effective Votes: Correlated Errors Undermine LLM Evaluation Panels."**
  arXiv:2605.29800 (2026).
- **"The Coin Flip Judge? Reliability and Bias in LLM-as-a-Judge Evaluation."** arXiv:2606.13685
  (Jun 2026).
- **"How LLMs Detect and Correct Their Own Errors: The Role of Internal Confidence Signals."**
  arXiv:2604.22271 (2026), building on Kumaran et al. 2026 (PANL signal).
- **"Justified or Just Convincing? Error Verifiability as a Dimension of LLM Quality."**
  arXiv:2604.04418 (2026).
- **Srivastava, Damle, Padala — "Rethinking LLMs as Verifiers: When Verification is Harder than
  Solving."** Google DeepMind / Microsoft. OpenReview 4jnJjSgQC1 (2026).
- **Shen et al. — "Rethinking Rubric Generation (RRD)."** arXiv:2602.05125 (Feb 2026).
- **"Generating and Refining Dynamic Evaluation Rubrics for LLM-as-a-Judge."** arXiv:2605.30568 (2026).
- **Qian, Sun, Gales, Knill — "Who can we trust? LLM-as-a-jury for Comparative Assessment" (BT-σ).**
  arXiv:2602.16610 (Feb 2026).
- **Liu et al. — "Examining Reasoning LLMs-as-Judges in Non-Verifiable LLM Post-Training."**
  arXiv:2603.12246 (2026).
- **"LLMs Gaming Verifiers: RLVR can Lead to Reward Hacking" (Isomorphic Perturbation Testing).**
  arXiv:2604.15149 (2026).
- **"An Imperfect Verifier is Good Enough: Learning with Noisy Rewards."** arXiv:2604.07666 (2026).
- **"Before the Model Learns the Bug: Fuzzing RLVR Verifiers."** arXiv:2606.01066 (Jun 2026).
- **"JURY-RL: Propose, ... Verify" (Lean-gated reward).** OpenReview tnfvv9Wsw9 (2026).
- **Parmar et al. — "When Helping Hurts and How to Fix It: Multi-Agent Debate for Data Cleaning."**
  arXiv:2606.02866 (Jun 2026).
- **"Demystifying Multi-Agent Debate: The Role of Confidence and Diversity."** ACL Findings 2026.
- **"Calibration Curves of LLM-as-Judge Across Model Sizes."** clawRxiv 2604.02017 (Apr 2026).
- **"When LLM Judge Scores Look Good but Best-of-N Decisions Fail."** arXiv:2603.12520 (2026).
- **"Can We Trust This Evaluation? Instance-Level Reliability of LLM-as-a-Judge."** OpenReview
  34caab9 (2026).
- **Zhang et al. — "Agentic Context Engineering (ACE)."** arXiv:2510.04618 (Oct 2025; ICLR 2026).
- **Phillips et al. — "Entropy Alone is Insufficient for Safe Selective Prediction in LLMs."**
  arXiv:2603.21172 (Mar 2026).
- Practitioner write-ups (corroborating, not primary): AI/TLDR pairwise-vs-rubric (2026-06-12);
  SurePrompts LLM-as-judge guide (2026-04); CallSphere pairwise (2026-05); orq.ai juries (2026-05).

**Pre-2026 BACKGROUND (flagged):**

- Verga et al. — **PoLL "Replacing Judges with Juries."** arXiv:2404.18796 (2024). Origin of the
  panel idea; later 2026 work qualifies it.
- Zheng et al. — MT-Bench / LLM-as-judge / Chatbot Arena (2023). The foundational paper; source of
  position/verbosity bias terminology and the 80%+ human-agreement baseline.
- Kim et al. — **Prometheus 2.** GitHub prometheus-eval (2024). The fine-tuned-judge baseline that
  2026 work still benchmarks against.
- Jung, Brahman, Choi — **"Trust or Escalate" (Cascaded Selective Evaluation, Simulated
  Annotators).** arXiv:2407.18370 (2024). The provable-human-agreement abstention framework.
- Zhang et al. — **CompassJudger-2.** arXiv:2507.09104 (Jul 2025). Verifiable-reward generalist judge.
- Du et al. — multi-agent debate. PMLR 2024. Origin claim that debate improves factuality.
- "Generative Verifiers: Reward Modeling as Next-Token Prediction" (GenRM). 2024 background.

---

## 1. Failure modes + measured magnitudes

| Failure | Mechanism of failure | Measured size | Source |
|---|---|---|---|
| **False confidence / overconfidence** (the central worry) | Predicted confidence systematically overstates correctness; verbalized-confidence circuit imposes a default-high bias decoupled from the model's real internal uncertainty | "Overconfidence Phenomenon": confidence >> accuracy is **pervasive across SOTA judges**; fixing it (LLM-as-a-Fuser) yields **up to +47.14% accuracy and −53.73% ECE on JudgeBench** — the size of the gain measures how broken raw confidence was. Calibration improves with scale: ECE **1.3B = 0.27 → frontier ~600B = 0.04**, but frontier judges keep a residual "too-easy" optimism (emit 0.99 when 0.95 is honest; easy-decile ECE 0.07 vs 0.03 global). | Tian 2508.06225 (TH-Score / Fuser); clawRxiv 2604.02017 (calibration curves) |
| **Fails-to-detect-its-own-error** (false confidence, mechanistic) | Self-verification has no independent signal: a model checking its own work verifies at ≈ its own generation accuracy (`p_c ≈ p_g`). When reasoning IS internally consistent it can still be wrong. | On FEVER, **59% of judge errors have Step-Verdict-Alignment ≥ 0.8 — internally consistent but wrong**, and are undetectable by ANY post-hoc signal. Self-correction is near-chance: conditional on revising, the model is correct only **~29–34%** of the time; verbal confidence AUROC = .524, logprob-diff AUROC = .531 (both ≈ chance) for predicting which revisions succeed. Self-verification with identical tools is **statistically indistinguishable from single-agent** (Δ = −1.3pp, n.s.). | Verdi 2605.11334; "How LLMs Detect ... Errors" 2604.22271; Parmar 2606.02866 |
| **Verification < solving** (acceptance bias) | Models accept plausible-but-wrong solutions more readily than they reject them; brittle to localized edits | On MMLU-Pro a **substantial fraction of subjects have verifier accuracy BELOW solver accuracy**; verifier accuracy drops to **59.2% under a single-edit perturbation**; rubric conditioning lifts a 3B verifier from **20.4% → 92.8%** (structure is necessary, not just helpful) | Srivastava 4jnJjSgQC1 |
| **Self-preference bias** | Judge favors its own / familiar (low-perplexity) outputs | Real but **smaller than thought once confounds removed**: an Evaluator-Quality-Baseline shows only **51% of prior self-preference findings retain significance** over 37,448 queries. Structured multi-dimensional prompting cuts SPB **31.5% avg** (LongCat −69.9%). High capability ≠ low SPB. | Roytburg 2601.22548; "Quantifying & Mitigating SPB" 2604.22891; (bg: 2410.21819 perplexity cause) |
| **Position / order bias** | Judge favors the answer in a given slot; forms a prior from option 1 and confirms it | **Flip rates 25%–~85%** across judges (Norman). Two production-deployed judges (Qwen3-8B, Gemini 2.5 Flash) show **position bias > 0.10 WHILE test–retest > 0.95** — the "consistency–bias paradox": stable ≠ valid. Coin-Flip: GPT-4o-mini 72% A-majority (p=0.024); pairwise verdicts flip **13.6% avg**, one question 56%. | Norman 2606.19544; Coin-Flip 2606.13685 |
| **Verbosity / length bias** | Judge prefers longer answers | **Has shrunk by a generation:** all 21 judges < 0.011 on MT-Bench under one pairwise rubric (Norman) — order of magnitude below 2023-era 20–40%. BUT length-aware measurement shows it's **heterogeneous**: Llama/Gemini +0.24 to +0.44 (prefer long), Claude Sonnet 4 −0.12 (prefer concise), GPT-4o ≈ −0.04. Do not assume it's gone. | Norman 2606.19544; Bias-Mitigation 2604.23178 |
| **Style bias** | Prefers markdown over plain prose | **Dominant, under-studied bias: 0.10–0.76 baseline**, far exceeding position bias (≤ 0.04) | Bias-Mitigation 2604.23178 |
| **Sycophancy / persuadability** | Confidently-wrong arguments sway the judge | A single adversarial debater drops group accuracy **10–40%** and raises conformity to false answers **>30%**; Best-of-N + RAG make adversarial arguments *more* convincing | Nature s41598-026-42705-7 (2026); (bg debate: Du 2024) |
| **Reward hacking** (when judge is the training signal) | Policy learns to satisfy the proxy, not the goal — "confidently wrong" at scale | RLVR-trained models develop a monotonically growing "hacking gap" (~3.5 reward pts / 500 steps) under an extensional verifier; non-reasoning judges are hacked easily, and reasoning-judge-trained policies learn to produce **adversarial outputs that deceive other judges** while scoring well on Arena-Hard. | IPT 2604.15149; Liu 2603.12246 |
| **Validation overstatement** | Raw exact-match agreement isn't chance-corrected | **Kappa deflation is universal: exact-match overstates Cohen's κ by 33.8–41.2pp** across all 21 judges on MT-Bench; rankings shift up to 14 positions across benchmarks. | Norman 2606.19544 |
| **Panel false confidence** | Correlated judges agree for the same wrong reason | A 9-judge panel has **effective independent votes n_eff ≈ 2.0–2.5**; the panel **matches or underperforms the best single judge**; aggregation closes ≤ 11% of the Condorcet gap. High consensus can be "evaluator correlation collapse." | Nine-Judges 2605.29800; Instance-Level 34caab9 |

---

## 2. Reliability mechanisms (the toolbox)

### 2.1 Rubric / criteria decomposition — the single best-evidenced lever
**What:** replace one holistic score with explicit, fine-grained, checkable criteria.
**Exact technique (RRD, Shen 2602.05125):** a recursive *decompose → filter → correlation-aware-weight*
cycle — decompose coarse rubrics into discriminative criteria, drop misaligned/redundant ones, down-weight
highly-correlated ones. **Measured:** **+17.7 points on JudgeBench**; as an RFT reward source, **+160%
reward (Qwen3-4B), +60% (Llama3.1-8B)** vs 10–20% for prior rubric baselines.
**Corroborating measured gains:** rubric conditioning lifts a 3B verifier **20.4% → 92.8%** (Srivastava
4jnJjSgQC1) — structure is *necessary* for reliable verification, not cosmetic. A *fine-tuned Qwen3-14B
rubric generator beats Claude Sonnet 4* at rubric generation (83.69% vs 81.62% MT-Bench), showing eval
quality can be decoupled from judge capability (2605.30568). Decomposition also feeds confidence (see 2.7).

### 2.2 LLM juries / ensembles / panels (PoLL and its 2026 correction)
**What:** score with a panel of diverse models, pool by vote/average.
**Exact technique (PoLL, Verga 2404.18796 — BACKGROUND):** 3 small models from *disjoint families*
(command-r, gpt-3.5-turbo, haiku), max/avg pool. **Measured (2024):** beats single GPT-4 judge, lower
intra-model bias, **>7× cheaper**, smallest score spread (σ=2.2 vs GPT-3.5 σ=6.1).
**2026 CORRECTION — read before trusting panels:** "Nine Judges, Two Effective Votes" (2605.29800)
measures **n_eff ≈ 2.0–2.5** real votes in a 9-judge panel; correlated errors mean **the best single judge
matches or beats the panel**, and **panel agreement is NOT evidence of correctness** (correlation collapse —
Instance-Level 34caab9). The gain is real *only* with genuinely diverse error profiles; the live signal is
**disagreement** (panel agreement < ~0.6 flags a hard item for human review — orq.ai). Reliability-aware
aggregation: **BT-σ** adds a per-judge discrimination parameter so noisier judges are down-weighted
(Qian 2602.16610).

### 2.3 Reference-guided / golden-answer-anchored judging
**What:** give the judge a known-good reference; score the candidate relative to it.
**Exact technique:** Reference-Guided Verdict (ACL WiNLP 2025) = (input + candidate + reference) → multiple
LLM judges → majority vote. **Measured:** **substantial-to-perfect Cohen's κ agreement with humans** on
free-form QA; the gold answer "anchors the scale and prevents drift and self-preference" (AI/TLDR 2026-06).
**Limit:** needs a curated golden dataset; degrades on open-ended generation with no single correct answer.

### 2.4 Pairwise vs pointwise scoring
**What:** ask "which of A/B is better?" instead of "score this 1–10."
**Measured:** pairwise is **more stable** — relative judgments are easier than absolute ones; strong pairwise
judges hit **>80% human agreement** on MT-Bench (Zheng 2023, bg). Pairwise cuts tie rate **59.8% → 3.9%**
and lifts decision recovery **21.1% → 61.2%** on matched pairs (2603.12520). BUT: (a) pairwise can *overstate*
evidence — judges pick a winner even when their own pointwise scores are statistically indistinguishable
(the "pairwise–pointwise gap," Coin-Flip 2606.13685); (b) the best-of-N decision gain is **not universal** —
strict best-of-4 budgeted audits showed no gain (2603.12520); (c) pairwise can *amplify* position/verbosity
bias unless run in both orderings. **Mandatory discipline:** A-then-B *and* B-then-A, count only if both agree
(catches more position bias than any other single fix — SurePrompts 2026-04). Production reality: ~40% checks
reference/heuristic, ~50% pairwise, ~10% pointwise (CallSphere 2026-05).

### 2.5 Fine-tuned judge models (Prometheus line + 2026 successors)
**What:** a model trained specifically to evaluate.
**Prometheus 2 (BACKGROUND, Kim 2024):** 8x7B; **0.6–0.7 Pearson with GPT-4** on 5-pt Likert; **72–85%
agreement** with humans on pairwise; avoids vendor self-preference.
**2026 SOTA — CompassJudger-2 (2507.09104, BACKGROUND Jul-2025):** trained with **verifiable rewards** +
rejection-sampled critical reasoning + margin policy-gradient loss; the **7B** matches DeepSeek-V3 /
Qwen3-235B; SOTA on JudgeBench (90.96) and JudgerBenchV2. Lesson: a small *trained* judge can beat a large
*prompted* one — but it inherits the verifiability ceiling of §2.8.

### 2.6 Critic / verifier SEPARATED from the producer — the structural fix for false confidence
**What:** an *adversarial* second model checks the producer's work, not the producer itself.
**Exact technique + measured (Parmar 2606.02866):** self-verification with identical tools **fails**
(`p_c ≈ p_g`, Δ = −1.3pp n.s.) — a model cannot out-verify its own generation accuracy. A **separate
adversarial Critic with code-execution grounding + evidence-gated generation** is the **first debate config
to significantly beat single-agent on a generative task (+5.3pp, p<0.05)**, and improves error *detection*
**+27.4pp F1 (d=1.0)**. Caveat: ungrounded debate causes *critique-induced confusion* — the generator
uncritically accepts a hallucinated critique (**−1.6 to −15.5pp** generation across 4 model families).
**Takeaway: separation + grounding + evidence-gating, not separation alone.**

### 2.7 Calibration, confidence estimation & selective prediction (abstain-when-unsure)
**What:** estimate when to trust the verdict; abstain/escalate otherwise. The direct answer to false
confidence.
- **Verdi (2605.11334):** logprobs are unusable for confidence — **99.4–100% saturate above 0.999** with
  structured JSON, and Anthropic exposes none (Mar 2026). Instead, decompose the judge trace and score three
  *structural* signals — **Step-Verdict Alignment, Claim-Level Margin, Evidence Grounding Score** — via
  Platt-scaled logistic regression, single call. **Measured AUROC 0.72–0.91 (GPT-4.1-mini), 0.66–0.80
  (GPT-5.4-mini)**, and works where logprobs are *anti-calibrated* (Qwen3.5 logprob AUROC 0.32–0.49, i.e.
  higher confidence on errors). Residual floor: cannot catch the **59% internally-consistent-but-wrong** cases.
- **TH-Score + LLM-as-a-Fuser (2508.06225):** a threshold-band calibration metric + a critique-integrating
  ensemble; **up to +47.14% accuracy, −53.73% ECE on JudgeBench**.
- **Cascaded Selective Evaluation / Simulated Annotators (Jung 2407.18370, BACKGROUND but foundational):**
  abstain below a confidence threshold λ → **provable human-agreement guarantee**; cheap model first,
  escalate only when unsure. **Measured:** Mistral-7B cascade guarantees **>80% human agreement at ~80%
  coverage** where GPT-4 alone "almost never" reaches 80%.
- **Caution (Phillips 2603.21172):** entropy alone is unsafe for abstention; combine with a correctness
  probe. Validate the confidence signal is informative *before* deploying it (Concurrent Validity Screen
  2604.17716: "invalid" models have inverted risk-coverage curves).

### 2.8 Debate / multi-agent verification
**What:** multiple agents argue to a verdict. **Measured reality is mixed and largely negative for naive
debate:** vanilla MAD is a *martingale* — it cannot beat majority vote and converges to correlated-error
consensus (AceMAD 2603.06801; Demystifying-MAD ACL-2026). It *helps* only with (a) **initial answer
diversity** and (b) **calibrated confidence-modulated updates** (submartingale toward truth), or (c) a
**fine-tuned Moderator** (DebateCV 2507.19090 cuts false-positive neutral verdicts 25.0% → 0.4%). A single
confident adversary degrades it 10–40% (§1). Use debate for *detection/diversity*, not as a trusted scalar.

### 2.9 Generative reward / verifier models
**What:** frame verification as generation (CoT critique → verdict), train it. GenRM (2024, bg) and
CompassJudger-2 (§2.5) show trained generative verifiers beat prompted LLM-as-judge at equal compute.
2026 lesson (JURY-RL tnfvv9Wsw9): a **Lean formal verifier gives 84.5% precision vs an LLM-judge's 75.9%**
— so where a generative verifier can be *gated by a formal/executable check*, do that (→ §3).

---

## 3. Outcome vs judgment

**Principle (strongest signal in the corpus): where a checkable outcome exists — unit test, schema
validator, executable behavior, formal proof — it replaces the judge, and outcome signals beat judge
signals.** The 2026 evidence is consistent:

- **Outcome > judge, measured:** JURY-RL (tnfvv9Wsw9): **Lean verifier precision 84.5% vs LLM-judge 75.9%**.
  ACE (2510.04618) gets **+14.8% over ReAct *without any ground-truth labels*, using only code
  execution success/failure** as the signal — and *explicitly degrades when reliable execution signals are
  absent* ("context polluted by spurious signals"). The RLVR book (rlvrbook.com, Apr 2026): only
  **deployable** verifiers — test suites, proof kernels, live environments — count; benchmark answer-key
  grading "is not a deployable verifier."
- **But outcomes are not free of false confidence either.** A check is a *proxy*: a code patch can pass
  unit tests while silently removing input validation the tests never hit (RLVR book). RLVR reward hacking
  (IPT 2604.15149): models exploit verifier gaps; **isomorphic-perturbation testing** detects shortcuts that
  pass extensional but fail structure-preserving checks. Verifier fuzzing (2606.01066) shows buggy
  math/JSON/code verifiers "repeatedly accept incorrect completions" — **verifier reliability is a
  pre-training systems property you can fuzz and audit before optimizing.** Reassurance: an imperfect verifier
  is good enough — **~85% accuracy + high precision recovers most of the clean training signal; RLVR tolerates
  ≤15% noise** (2604.07666). Prioritize **precision over recall** (false positives — accepting wrong work —
  are the dangerous error for a self-optimizer).

**How the self-optimization harnesses actually obtain their score (this is the load-bearing part):**

| Harness | Score source | Gate / accept rule | Citation |
|---|---|---|---|
| **SkillOpt** | **Held-out validation score** on `D_sel` with the frozen target model + harness — an **outcome/benchmark scorer, NOT a judge**. Microsoft is explicit: "the real upfront work is the verifier and a representative held-out split"; "avoid open-ended subjective tasks ... with no clean automatic scorer." | **Accept a candidate skill edit iff it strictly improves the held-out selection score**; else reject → rejected-edit buffer (negative feedback). Measured: ALFWorld selection 68.6% → 81.4%, test-hard 70.9% → 85.8%; +23.5pp avg on GPT-5.5 direct chat. | SkillOpt 2605.23904 |
| **GEPA** | A **`feedback function µ_f`** that returns a *numeric score* **+ textual evaluation trace** (compiler errors, failed rubrics, profiler output — "Actionable Side Information"). The scalar can be outcome-based (code exec) or rubric-based; the *text* drives reflection. | **Add the mutated candidate to the Pareto pool iff the score improves** on the minibatch. Measured: +10pp on AIME-2025; beats GRPO by up to 19pp with 35× fewer rollouts. | GEPA 2507.19457 |
| **ACE** | **Natural execution feedback / environment signals** (code exec success, formula correctness) — Reflector compares predicted vs ground truth where available. Outcome-first; explicitly degrades without reliable signals. | Curator applies incremental delta updates with helpful/harmful counters. Measured: +10.6% agents, +8.6% finance; +14.8% label-free. | ACE 2510.04618 |

**Pattern:** every credible 2026 self-optimizer that *acts on* its score gates on a **checkable outcome
(held-out task accuracy / execution / formal check)**, uses the **LLM only to read traces and propose edits**,
and **strictly accepts only on measured improvement**. None of them trusts a free-standing model quality
*judgment* as the accept signal. The judge's role is *credit assignment / reflection* (read why it failed),
not *gating*.

---

## 4. Bottom line for "can we trust the judge as ground truth?"

**Short answer: treat a model's judgment as a *prior with a known error rate*, never as ground truth —
unless you can back it with a checkable outcome.** It becomes *actionable* (trustworthy enough to gate on)
only under all of these conditions, each tied to a mechanism above:

1. **A checkable outcome exists → use it, not the judge** (§3). Gate the accept decision on a held-out
   task score / unit test / schema / formal check, the way SkillOpt/GEPA/ACE do. Use the judge only to
   *explain* failures and *propose* edits. This is the dominant, repeatedly-measured result.
2. **If no outcome exists, decompose into an explicit rubric** (§2.1; +17.7pp JudgeBench, 20→93% verifier
   lift). Structure is *necessary*, not optional, for reliable verification.
3. **Separate an adversarial, grounded critic from the producer** (§2.6). A self-grading producer verifies
   at its own accuracy (`p_c ≈ p_g`) and *cannot* surface the central failure. Grounded adversarial
   separation is the only debate config measured to beat single-agent on generation (+5.3pp).
4. **Anchor to a reference and/or judge pairwise with both orderings** (§2.3–2.4). Reference-guided ≈ human
   κ; pairwise + AB/BA both-orderings is the cheapest position-bias fix.
5. **Estimate confidence from the trace, then ABSTAIN/ESCALATE below threshold** (§2.7). This is the direct
   countermeasure to false confidence: Verdi (AUROC 0.72–0.91), Cascaded Selective Evaluation (provable
   >80% human agreement at ~80% coverage). Do NOT use raw logprobs (99.4–100% saturate) or raw verbalized
   confidence (the overconfidence circuit). For a self-optimizer, **prefer precision over recall and require
   a confidence floor before accepting an edit.**
6. **Validate before trusting, with the right metric.** Report **Cohen's κ, not exact match** (raw agreement
   overstates by 33.8–41.2pp); measure position flip rate (<0.10) and test–retest (≥0.95) — and remember
   *stable ≠ valid* (consistency–bias paradox). Re-validate on every judge/rubric/domain change. A panel's
   agreement is **not** proof (n_eff ≈ 2.0–2.5); its *disagreement* is the useful signal.

**Residual error to budget — even after doing everything right:**

- **The irreducible false-confidence floor: ~59% of judge errors are internally consistent (SVA ≥ 0.8) and
  invisible to any post-hoc confidence signal** (Verdi 2605.11334). Self-correction of the rest is near-chance
  (~29–34%; AUROC ≈ .52). **Budget that a well-built judge will confidently miss real mistakes on the hard tail
  and there is no model-internal signal that flags them — only an external check or a human does.**
- **Frontier-judge calibration floor: ECE ~0.04 globally, ~0.07 on the easy decile** (round-up-to-0.99
  optimism) — so a "0.99" is honestly ~0.95 (clawRxiv 2604.02017).
- **Best human-agreement ceiling for a single tuned judge: ~71% / κ ≈ 0.55** (2604.23178); even a strong
  pairwise judge tops out ~80% human agreement; cross-judge κ ≈ 0.51 (2606.13685). Human ground truth is
  itself noisy (expert κ ≈ 0.71).
- **As a training signal, budget reward hacking:** false positives compound. ~85%-precision verifier
  recovers most signal and ≤15% noise is tolerable (2604.07666), but the gap grows monotonically under
  optimization pressure (IPT 2604.15149) — fuzz/audit the scorer before the loop (2606.01066), and prefer a
  formal/executable gate (Lean: 84.5% vs 75.9% precision) wherever the domain allows.

**Verdict for the piflow loop:** the safe design is *outcome-gated accept, judge-assisted reflection,
confidence-thresholded abstention*. Trust the judge's *direction* (credit assignment, "what to try next");
never let its *high-confidence "success"* be the sole thing that lands an edit.
