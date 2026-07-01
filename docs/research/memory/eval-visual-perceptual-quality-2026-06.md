# Visual / perceptual quality evaluation by models (2026-06)

## 0. Sources & recency note

All sources gathered via Exa (`web_search_exa`, `web_search_advanced_exa`, `web_fetch_exa`); no fallback to WebSearch/WebFetch was needed. Priority on 2026 (esp. H1 2026 and explicit June-2026 arXiv submissions); pre-2026 work is flagged **[background]**. arXiv ids in the 26xx series are 2026 submissions (e.g. `2606.*` = June 2026, `2602.*` = Feb 2026). A note on labels: **[MEASURED]** = a number reported in a paper against a human-labeled ground truth; **[CLAIMED]** = a design assertion or mechanism description not yet pinned to a human-agreement number in the source excerpt. Several 2026 preprints show "0 citations" because they are weeks old; treat magnitudes as directionally reliable, exact decimals as preprint-grade.

Recurring caveat across the literature: a VLM judge's **own reported number is a claim until checked against human labels under position-swap and chance-correction** — the field's 2026 meta-evaluations (Focus, "Reliability without Validity") show raw exact-match agreement overstates real discriminative skill by 30–40 points once you apply Cohen's κ.

---

## 1. VLM-as-judge: how it's done + where it diverges from humans (with numbers)

**How it's done.** Three paradigms dominate: (i) **absolute / pointwise scoring** (1–5 or 1–10 scalar per image or per attribute), (ii) **pairwise comparison** (A-vs-B forced choice), (iii) **batch ranking** (order K candidates). The judge is either a frontier general VLM (GPT-4o/4V, Gemini-2.5-Pro, Qwen3-VL, InternVL3) prompted with a rubric, or a fine-tuned perceptual scorer (§2). Correlation with humans is measured by Pearson/Spearman (scoring), accuracy/F1 (pairwise), and normalized Levenshtein (ranking).

**The baseline correlation is moderate, not high.**
- **MLLM-as-a-Judge** (mllm-judge.github.io, Chen et al., NeurIPS 2024 **[background]**): GPT-4V ~70% human agreement overall; **pairwise 78–79.3%** (strongest), scoring ~70% (peaking 79.9% on MS-COCO), **batch ranking collapses to 69% (GPT-4V) / 47% (Gemini)**. Pairwise > scoring > ranking is the consistent ordering. **[MEASURED]**
- **"VLM Judges Can Rank but Cannot Score"** (arXiv 2604.25235, 2026): on the MLLM-as-a-Judge benchmark, SOTA VLM judges hit only **32–34% exact agreement** with human ratings on a 5-point scale; **24–30% of judgments deviate by ≥2 points**; per-instance correlation ρ=0.30–0.46. Judges can *order* responses but not assign trustworthy *absolute* scores ("ranking–scoring decoupling"). **[MEASURED]**

**Where it diverges from humans — the hard, measured failure modes:**
- **Fine-grained / spatial / compositional / physical:** "Seeing Isn't Believing: Uncovering Blind Spots in Evaluator VLMs" (**Focus** benchmark, arXiv 2604.21523, 2026; 4000+ perturbed instances, 40 perturbation dimensions, gold via gemini-3-pro-image) — evaluators **fail to detect quality-degrading perturbations in some cases >50%**, notably worse for **text-to-image than image-to-text**, with failures concentrated in fine-grained visual grounding, compositional reasoning, and physical plausibility. Increasing reasoning budget does **not** consistently help; judges sometimes **name the error in their justification but don't reflect it in the score**. **[MEASURED]**
- **Counting, attribute/color binding, text rendering, anatomy:** **FineGRAIN** (arXiv 2512.02161; finegrainbench.ai) — 27 T2I failure modes across Flux/SD3.x, judged by Molmo/InternVL3/Pixtral. Overall VLM–human **boolean agreement ~67.4%** (Molmo best ~66.1%, InternVL3 ~63.8%), beating VQAScore by ~10pts, but **VLMs declared insufficiently reliable for reward modeling, esp. counting and anatomy**. **[MEASURED]**
- **Anatomical accuracy specifically:** "What Makes a Good Generated Image?" (arXiv 2509.12750, 2025 **[background]**) — humans easily judge aesthetics, artifacts, anatomy, composition, object-adherence, style; for MLLMs the inter-attribute relationships are far weaker and **anatomical accuracy is the hardest attribute for MLLMs to learn to judge**. **[MEASURED]**
- **Text-in-image:** **TIQA** (arXiv 2603.07119, 2026) — VLM judges (Qwen3-VL-235B, GLM-4.6V) under-capture *perceptual* text quality (stroke breaks, kerning, baseline instability) because OCR rewards decodability and VLMs are prompt/seed/version-drift sensitive; a dedicated fine-tuned model beats GPT-4V-style judges on perceptual text artifacts. **[MEASURED]** WeGenBench (arXiv 2606.20100, Jun 2026) similarly shows CLIPScore "rewards the mere presence" of keywords and fails on spatial relations, counting, attribute binding. **[MEASURED]**
- **Low-level perceptual attributes are attribute-dependent:** "Vision-Language Models vs Human: Perceptual IQA" (arXiv 2603.24578, 2026) — across 6 VLMs, **human alignment for colorfulness reaches ρ up to 0.93 but the same models underperform on contrast** (and vice-versa). Critically, **human–VLM agreement rises with perceptual separability** — VLMs are reliable only when the difference is clearly expressed. **[MEASURED]**
- **Order/layout shortcut:** OTS-Bench ("Order Is Not Layout", arXiv 2603.03714, 2026) — to even *select* a usable judge they had to validate against humans; Qwen3-VL-8B reached Cohen's κ=0.81 on a 3-class layout task only after curation. **[MEASURED]**

**Takeaway for §1:** a single VLM doing **absolute scoring of a fine visual defect** is the weakest configuration — exact agreement in the low-30s%, >50% miss rate on injected defects, worst on counting/anatomy/text/spatial.

---

## 2. Mechanisms that raise agreement with human perception

Ranked by strength of the measured lift:

1. **Pairwise / comparative over absolute scoring (the single biggest, cheapest lever).**
   - **GenArena** (arXiv 2602.06013, Feb 2026): switching pointwise→pairwise **boosts evaluation accuracy >20% and lifts Spearman correlation with the LMArena human leaderboard from 0.36 → 0.86**; the protocol alone lets off-the-shelf open models beat top proprietary judges. **[MEASURED]**
   - **VAB / Visual Aesthetic Benchmark** (arXiv 2605.12684, 2026): in a controlled human study, **direct comparative ranking yields 42 percentage points higher inter-annotator agreement than score-derived rankings** — comparison is a more primitive, lower-cognitive-load operation (Thurstone). **[MEASURED]** Confirmed by **iDiff** (arXiv 2605.19522) and **Focus** (pairwise = most reliable paradigm).
   - Nuance: pairwise carries **position bias** (must be corrected — see §4).

2. **Rubric decomposition into atomic, binary, checkable visual attributes.**
   - **DeltaRubric** (arXiv 2605.09269, 2026): a "Disagreement Planner → Checklist Verifier" two-step that isolates factual divergences as a neutral checklist, then verifies each item against the image; substantially outperforms no-rubric and static-rubric baselines and reduces "lazy judging." **[CLAIMED/MEASURED-vs-baselines]**
   - **Auto-Rubric as Reward (ARR)** (arXiv 2605.08354): inference-time generate-verify-refine of ~5 prompt-conditioned binary criteria (object presence, attribute accuracy, spatial layout, aesthetics); reduces positional bias and reward hacking; rubric quality scales with judge strength. **[CLAIMED]**
   - **RRD** (arXiv 2602.05125, Feb 2026): recursive decompose-filter with correlation-aware weighting — **+up to 17.7 pts on JudgeBench**; as a reward source boosts RFT reward up to 160%. **[MEASURED]** (text-domain but the decomposition principle transfers.)
   - **RULERS** (arXiv 2601.08654, Jan 2026): compile the rubric into a *locked, immutable* JSON checklist + evidence-anchored verbatim quoting to kill prompt-sensitivity/rubric-instability. **[CLAIMED]**
   - **Prometheus-Vision** (arXiv 2401.06591, 2024 **[background]**): the original open VLM evaluator trained on 15K score rubrics — highest Pearson with human raters among open models at the time.
   - Caveat: **mllm-ui-judge** (GitHub, applied study) found checklist verdicts *unstable on perceptual checks* ("does the grid feel like a card wall?") even as they help on factual ones — rubrics fix factual misses, not taste.

3. **Render-and-diff / programmatic visual checks (replace eyeballing with measurement).**
   - For anything with a structural ground truth, extract structured data on both sides and diff deterministically; **let the VLM judge only the residual that needs taste.** **Verity** (GitHub, design-to-code): extract Figma + rendered DOM into one structured-style representation, diff per-attribute + by geometric boundary distance; "the AI compares data and says it's off by N px" rather than eyeballing — faster, quantifiable, locatable. **one-shot-ui** (GitHub): extract→capture→compare→fix loop drives builds to ~2.5% pixel mismatch and labels *irreducible* deltas (anti-aliasing) so the agent doesn't chase ghosts. **parity-studio** (GitHub): 16-row deterministic rubric returns a **bounded enum** (`verified|needs_review|needs_iteration|failed|unavailable`) and honestly marks rows the deterministic layer *cannot* evaluate as `unavailable` rather than faking a pass — explicitly avoids "floating-point hallucination scores." **[CLAIMED, applied]**
   - For 3D: **SceneCritic** (arXiv 2604.13035) — a *symbolic* evaluator over a spatial ontology (SceneOnto) **aligns substantially better with humans than VLM-from-rendered-views**, and text-only LLMs over the layout can beat VLMs on semantic layout. The lesson: when a non-perceptual ground truth exists (geometry, DOM, collision), prefer it.

4. **Grounding / region-pointing / self-reference (force the judge to look).**
   - **BIRCH** ("When VLMs Judge Without Seeing," ACL 2026 long.703): VLMs get distracted by *informativeness* and stop attending to the image; having the judge first generate its *own* answer as a reference, then build a truthful+informative "anchor" from the candidates, refocuses attention on image consistency and reduces informativeness bias. **[MEASURED-vs-baseline]**
   - VAUQ's core-region masking and the general "describe-then-judge / extra reasoning on the image first" trick (MLLM-as-a-Judge CoT ablation) both mitigate hallucination in judging.

5. **Ensembles / multi-judge panels + position-swap (reliability, with a caveat).**
   - "Judging the Judges" (arXiv 2604.23178, 2026): position-swap (AB+BA, keep only consistent verdicts, else tie) is the most common mitigation; diverse multi-model panels improve reliability — **but more perspectives can amplify some biases**, so ensembles must be curated, not indiscriminate (echoed by the VLM-narrative-coherence study: bad judges in the ensemble *degrade* it).

6. **Fine-tuned perceptual scorers & human-preference reward models for images.**
   - **HPSv3** (ICCV 2025 **[background-but-current]**, arXiv 2508.03789): Qwen2-VL backbone trained on **HPDv3 (1.08M pairs, 1.17M pairwise comparisons)** with an uncertainty-aware ranking loss; SOTA preference accuracy (72.8 PickScore / 85.4 HPDv2 / 76.9 HPDv3), far above CLIP. **[MEASURED]**
   - **HPSv3++** (arXiv 2606.14657, Jun 2026): capability-aware + RL-iteration-aware via FiLM conditioning + HPDv3++ (212K dual-axis: text-fidelity & aesthetics, annotated with Qwen-Image); **+9.8% over HPSv3 on HPDv3**, addresses reward drift as generators improve. **[MEASURED]**
   - **DiT-Reward** (arXiv 2606.23626, Jun 2026): reuses SD3.5's MMDiT backbone as the reward feature extractor; **beats HPSv3 on all four benchmarks under the same training data** (e.g. 77.6 vs 76.9 HPDv3). **[MEASURED]**
   - Lineage **[background]**: CLIPScore → ImageReward (NeurIPS 2023) → PickScore → HPS/HPSv2 → MPS → **VisionReward** (THUDM, fine-grained multi-dimensional, the ImageReward successor). **VQAScore** (CLIP-FlanT5) computes "P(Yes)" to a "Does this show {text}?" question and beats bag-of-words CLIPScore on attribute binding / spatial / negation.

---

## 3. Domain-specific: UI / front-end / game-scene / layout evaluation

**UI / front-end (most active 2026 area):**
- **Vision-Guided Iterative Refinement for Frontend Code** (arXiv 2604.05839, Amazon AGI, 2026): a critic-in-the-loop where a VLM visual critic inspects the *rendered* webpage and scores **four dimensions on 1–10** (two from rendering+query, two from code+query — so non-visual interactivity is still covered). Validated against human preference data; **up to +17.8% quality over 3 cycles, best solution within 1+ cycles for 86% of tasks**; LoRA distillation internalizes ~25% of the gain in one pass. Critiques cluster on *visual aesthetics and functionality*. **[MEASURED]**
- **FrontCoder** (ACL Findings 2026, .220): RL with **vision-grounded reward** — render HTML/CSS in headless Chromium, screenshot, query Qwen2.5-VL-72B with (question, code, screenshot) for a scalar fidelity reward. Two independent judges (Qwen2.5-VL-72B vs Gemini-2.5-Pro) show **strong rank agreement, Kendall's τ-b = 0.717**, i.e. stable *relative* ordering across judge families even on different absolute scales. **[MEASURED]**
- **DiffSpot** (arXiv 2605.29615): spot-the-difference on near-identical rendered web UIs, ground truth from programmatic CSS mutation records (13 operators × 3 tiers + 500 no-diff pairs for false-positive control). Across 13 frontier VLMs, **the strongest identifies only 40.7% of true visual changes; Hard-tier recall <23% for every model**; failures are property-specific; a sensitivity↔restraint tradeoff on no-diff pairs. The blunt verdict on fine UI perception. **[MEASURED]**
- **DesignCoder** (ScienceDirect, Jun 2026): mockup→code with a vision-guided render-and-compare self-correction loop; on 300 Figma/EGFE mockups, **−37.6% MSE, +9.5% CLIP, +6.0% SSIM** vs strongest baseline, corroborated by a 5-engineer user study. Explicitly notes pixel similarity ≠ quality. **[MEASURED]**
- **VisRefiner** (arXiv 2602.05998, Feb 2026): trains the generator to *learn from visual differences* between rendered prediction and reference (difference-aligned supervision + RL self-refinement) on Design2Code / Design2Code-HARD. **[MEASURED]**
- Applied/open-source signals: **mllm-ui-judge** (the most honest negative result — absolute scores clustered 3.5–4 on 8/10 UIs; pairwise showed position bias in 2/3 swaps; checklist unstable on perceptual layout; **"the parser decides facts, the vision judge inspects appearance, the human decides taste"**). **Verity**, **one-shot-ui**, **parity-studio**, **Gemma-4 Visual Patch Agent** (see §2.3).

**Game / QA:**
- **VideoGameQA-Bench** (NeurIPS 2025 **[background, directly relevant]**): VLMs for game QA — visual unit testing, visual regression, needle-in-a-haystack, **glitch detection**, bug-report generation over images and video.

**3D / scene layout:**
- **SceneEval** (WACV 2026 Oral, arXiv 2503.14756): VLM (GPT-4o) metrics for object count/attribute/relationship/support/accessibility vs text; **human agreement 83.5–94.6%, Cohen's κ 0.56–0.77** depending on metric (object count strong, attribute weak), plus non-VLM geometric checks (collision, navigability, clearance). **[MEASURED]**
- **SceneCritic** (arXiv 2604.13035): symbolic evaluator beats VLM-from-renders; VLM scores are **viewpoint- and prompt-unstable and method rankings reverse with viewpoint** under Gemini-2.5-Pro. **[MEASURED]**
- **IR3D-Bench** (ir3d-bench.github.io): "understanding-by-creating" — VLMs reconstruct 3D scene JSON to match a GT image; current VLMs grasp attributes but **struggle with precise spatial control**.
- **3D-mesh judging** (arXiv 2606.18451, Jun 2026): cross-model, position-bias-corrected VLM-judge over a fixed 24-view render rig — two judge families agree **Cohen's κ=0.66**, and the protocol *beats* render-CLIP (at chance) and geometry proxies; the de-biased judge is recommended as the reliable human-free evaluator. **[MEASURED]**

---

## 4. False confidence & miscalibration on visual judgment — and detection mechanisms

**Evidence of false confidence / miscalibration (the team's exact worry):**
- **Perceptual Judgment Bias** (arXiv 2606.02578, Jun 2026; perception-judge.github.io): the precise mechanism behind "it reflects, misses the defect, and says it's fine." A judge fails to penalize a response whose visual claims contradict the image **even when its own perception is correct** — it anchors on the fluent text. Decomposition: **response-anchoring (14.1%) is a *larger* error source than pure perception failure (9.4%)**; baselines reject bad reasoning but **miss fluent visual errors**. **[MEASURED]**
- **VLMs output near-100% confidence on hallucinated objects** (Zhao et al., cited in arXiv 2603.26769) **[background]**; "Edge Reliability Gap" (arXiv 2603.26769) shows Qwen2.5-VL-7B emits a **constant ≈0.999 confidence on VQAv2 at 55.6% accuracy (ECE=0.443)** — a confidence gate is then equivalent to no gate. **[MEASURED]**
- **Overconfidence persists across families/scales and is not fixed by scaling or CoT/verbalized-confidence prompting** (Medical-VQA calibration study, arXiv 2604.02543, Apr 2026). **[MEASURED]**
- **Metacognitive calibration** (CVPR 2026 CogVL workshop, OpenReview Oi3EtoKWEX): self-reflective prompting helps but **models still express high confidence in ~half of their errors**. **[MEASURED]**
- **SalArt-VQA** (arXiv 2606.12671, Jun 2026): the sharpest false-confidence diagnostic for *generated-image defects* — the strongest VLM reaches **99.37% artifact-detection recall but answers all four grounded questions correctly on only 53.26% of images**; a **sensitivity↔calibration tradeoff** — sensitive models make unsupported artifact claims, conservative models miss real defects. "High detection accuracy does not imply grounded artifact understanding." **[MEASURED]**

**Mechanisms that detect "the judge is wrong":**
- **Position-swap as a confidence filter (best practical detector).** Query both orders; keep only order-consistent verdicts, drop the rest as position-biased. In the 3D-judge work this *doubles* as a confidence filter: same-quality pairs flip and get dropped — exactly the desired behavior (arXiv 2606.20364 / 2606.18451). **[MEASURED]**
- **Conformal prediction wrappers** (VLM-Judge-Uncertainty, GitHub; arXiv 2604.25235): attach calibrated prediction intervals (R2CCP) to a judge's score from the score-token logits; **recovers 97.8% of judge errors**, intervals 4.5× narrower on clean multi-annotator data than noisy single-annotator data, and interval width is **task-determined** (narrow on aesthetics, wide on charts/infographics). A usable per-instance "trust this score?" signal without retraining. **[MEASURED]**
- **Vision-grounded confidence decoupling.** **VL-Calibration** (ACL 2026 long.2074): split confidence into *visual* vs *reasoning*; estimate visual certainty via **KL-divergence under image perturbation + token entropy**; reduces calibration error and improves accuracy across 13 benchmarks. **VAUQ** (ACL Findings 2026, .1321): Image-Information Score = uncertainty reduction attributable to the image, with core-region masking — **+13.3% self-eval AUROC** in counterfactual cases. **HAC** (arXiv 2604.02543): feed a hallucination-detection score into post-hoc calibration — improves both ECE and AUROC. **[MEASURED]**
- **Multi-view / repeated-eval consistency.** SceneCritic explicitly measures score variance across viewpoints/repeats to expose VLM instability; multi-view agreement (or its absence) is a wrongness signal.
- **Post-hoc scale calibration** (Platt scaling) reduces ECE but **cannot improve discrimination/AUROC** (monotonic), and standard calibration can even *hurt* misclassification detection (ICLR 2026 d8WMoi571f). So calibration ≠ knowing-when-wrong; the orthogonal hallucination/visual-grounding signal is what adds detection power.

---

## 5. Verdict — what's trustable as ground truth vs human-in-the-loop, and what raises the trustable fraction

**Trust a VLM as ground truth (with the mechanisms below) for:**
- **Coarse, separable comparisons** — A-vs-B "which is clearly better" when the gap is perceptually salient (human agreement rises with perceptual separability; pairwise correlation 0.78–0.86 with humans). Use it as a **ranker, not a scorer**.
- **Attribute-checkable semantic facts with a rubric** — object presence, declared object count at small N, attribute/color binding, gross instruction adherence, "is there a navbar / does the scene contain the requested objects" (SceneEval κ 0.72–0.77 on count/relations; rubric+pairwise judges).
- **Anything with a non-perceptual ground truth** — design-to-code fidelity, layout collisions, text *content* (OCR), pixel/structural regressions. Here the *right* tool is render-and-diff / symbolic checks, with the VLM judging only the residual taste.

**Keep a human in the loop (do NOT treat VLM as ground truth) for:**
- **Absolute single-image quality scores** (exact agreement low-30s%, constant-confidence failures).
- **Fine visual defects** — anatomy, small-object counting at high N, perceptual text quality (kerning/strokes), fine spatial relations, physics plausibility, near-identical spot-the-difference (DiffSpot: <41% recall), and **subtle layout taste** ("does this grid feel like a monotonous card wall," "does the UI read as premium") — checklists are unstable here.
- **The exact false-confidence regime the team fears:** a defect that is real but the model's text-prior says "looks fine." A bare VLM will confidently miss it (SalArt-VQA 53% grounded; response-anchoring is the dominant error).

**What raises the trustable fraction (in priority order):**
1. **Reframe scoring as pairwise/comparative** — biggest single lift (ρ 0.36→0.86), turns weak absolute judges into reliable rankers.
2. **Mandatory position-swap, keep-only-consistent** — both debiases *and* acts as a free abstention/confidence filter; discard flips.
3. **Decompose into atomic binary visual checks** (DeltaRubric/ARR/RRD) and **offload every check that has a deterministic ground truth to render-and-diff or symbolic verification** — reserve the VLM for genuine taste.
4. **Attach a per-instance reliability gate**: conformal interval (recovers ~98% of errors) or vision-grounded uncertainty (VL-Calibration / VAUQ); **abstain/route-to-human when the interval is wide or visual-grounding is low** — do not gate on raw verbalized confidence (it's near-constant ≈0.999 on hallucinations).
5. **Use a fine-tuned perceptual reward model** (HPSv3++/DiT-Reward) instead of a prompted general VLM where a learned scorer fits the axis (aesthetics, human preference).
6. **Cross-family judge agreement + curated ensemble** as a final reliability check (τ-b 0.717 / κ 0.66 across families = trustable ranking; disagreement = escalate).

**One-line verdict:** A VLM is trustworthy as ground truth only as a *position-swapped pairwise ranker on perceptually separable, rubric-decomposed, deterministically-groundable judgments with an uncertainty gate that abstains* — for fine visual defects and absolute quality it is confidently unreliable and a human must stay in the loop.
