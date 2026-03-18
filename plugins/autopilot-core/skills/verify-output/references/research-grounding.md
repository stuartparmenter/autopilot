# Research Grounding for Verification Checks

Each verification check is grounded in specific findings from the papers that inform the MADE planning methodology. This reference explains *why* each check exists and what evidence supports it.

## Check 2: Candidate Diversity → QDAIF

**Paper:** Quality-Diversity through AI Feedback (ICLR 2024), arxiv.org/abs/2310.13032

QDAIF uses MAP-Elites with LLM feedback to fill an archive of diverse high-quality solutions. The key finding: diversity axes must be specified in advance — the system cannot discover them organically. Without explicit enforcement, LLM generation converges toward a "default mode" that produces superficially different but structurally similar outputs.

The verification check enforces this by examining whether candidates actually span the diversity space rather than clustering. QDAIF also documented reward hacking at high fitness ranges (>0.995), which means high scores alone don't guarantee quality — diversity is an independent axis that must be verified separately.

## Check 4-5: Rubric Discrimination & Independence → RRD

**Paper:** Recursive Rubric Decomposition (Feb 2026), arxiv.org/abs/2602.05125

RRD's central finding: naively generated rubrics actually *degraded* judgment quality (55.6% → 42.9% on JudgeBench for GPT-4o). The mechanism: non-discriminative rubrics add noise, and correlated rubrics create implicit weighting that distorts the fitness landscape.

RRD's fix: recursively decompose non-discriminative rubrics until each one actually differentiates between candidates. Filter out rubrics with >70% semantic overlap. Apply whitened uniform weighting (inverse square root of covariance matrix) to de-correlate.

The verification checks implement the diagnostic half of this — detecting non-discriminative and correlated rubrics. The planning skill's Phase 3 already includes the discrimination filter, but it's commonly skipped or applied superficially. Verification catches what the planner missed.

## Check 6: Score Justifications → MADE

**Paper:** MADE: Evolution without an Oracle (Nov 2025), arxiv.org/abs/2511.19489

MADE's core mechanism transforms one high-variance holistic judgment into many low-variance binary judgments. The reliability depends on each binary judgment being independently accurate. The paper reports ICC = 0.933 under perturbation for high-quality solutions.

But this reliability assumes genuine independent evaluation. If justifications are tautological or absent, the binary judgments become correlated noise rather than independent signals. The verification check ensures each score represents a genuine evaluation, not rubber-stamping.

## Check 7: Holistic Coherence → MADE limitation

**Paper:** MADE: Evolution without an Oracle — Limitations section

MADE's own results showed a tension: Task Solve Rate was lower (1.82% vs 5.45%) despite higher requirement satisfaction. The interpretation: decomposition can lose holistic coherence. A candidate that satisfies many individual requirements may still be internally inconsistent as a whole.

This is the fundamental limitation of decomposition-based evaluation: the parts can be right while the whole is wrong. The verification check addresses this by re-evaluating the selected candidate holistically after the decomposed scoring is complete.

## Check 8: Prediction Falsifiability → EvolveR

**Paper:** EvolveR: Self-Evolving Agents through Experience (Oct 2025), arxiv.org/abs/2510.16079

EvolveR distills successful trajectories into guiding principles and failed trajectories into cautionary principles. The quality scoring mechanism (Laplace-smoothed success rate) only works if outcomes are measurable. Unfalsifiable predictions provide no feedback signal and cannot drive learning.

The discriminator accuracy constraint (from "When is Tree Search Useful for LLM Planning?", ACL 2024) further motivates this: below ~80% discriminator accuracy, sophisticated search hurts. Falsifiable predictions are how the system calibrates its discriminator accuracy over time — without them, the system cannot know if its evaluation quality is above or below the threshold.

## Check 9: Principle Quality → EvolveR

**Paper:** EvolveR — Quality scoring and pruning

EvolveR prunes principles with Laplace-smoothed success rates below 0.3. This prevents the accumulation of low-quality principles that add noise to future cycle context. The verification check front-loads this quality filtering by catching non-actionable or generic principles before they're stored in gk, rather than waiting for statistical pruning over many cycles.
