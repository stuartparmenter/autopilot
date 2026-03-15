# Autopilot v3: Strategy-Driven Autonomous Development

## Current State

**v3 milestone 2 is complete (2026-03-14).** Plugin architecture with multi-level planning (vision, strategy, epic). Each level is a plugin with a planner agent (Opus) and sub-agents (Sonnet). The MADE methodology and gk conventions are shared skills in autopilot-core. All levels run end-to-end producing structured CycleOutput. Agents properly load gk guides, read prior cycle data, and validate after writing. Cost ~$4-5 per vision run, ~$2-3 per strategy/epic run. See `docs/superpowers/specs/2026-03-13-ap3-initial-build-design.md` for the original spec and `CLAUDE.md` for current architecture.

Key learnings from milestone 2:
- Plugin agents must use full namespace (`autopilot-vision:planner`, not `planner`)
- Task tool renamed to Agent in Claude Code v2.1.63
- Skills must be preloaded via `skills:` in agent frontmatter (auto-triggering is ~50% reliable)
- Abstraction gates needed at each level to prevent vision→strategy→epic level bleed
- gk guides must be read via ReadMcpResourceTool before any gk operations
- Four levels (vision, strategy, epic, task) with fixed abstraction boundaries but dynamic cadence

**v1** is a working orchestration loop (TypeScript/Bun, Linear-backed) that spawns Claude Code agents to implement issues. The CTO agent produces reasonable strategic thinking in initiative updates, but those insights aren't fed back into the system — they're written and ignored. The system executes but doesn't learn from its own strategic output.

**v2** introduced beads (Dolt-backed task tracking), a knowledge graph (gk), persona+skill separation, and a 9-role org chart. It's architecturally sound on paper but unfinished, has bugs, and is hard to test. The migration from v1 is partially complete. v3 skips directly past v2, carrying forward the infrastructure that works (gk, Agent SDK) and replacing the parts that don't (the rigid orchestration pipeline, the org chart overhead).

## What We're Trying to Solve

Across v1 and v2, there are fundamental gaps:

1. **No strategic direction.** The system executes a backlog but doesn't generate one. A human must decide what to build, decompose it into issues, and feed them in. The system is a builder, not a product team.

2. **No product thinking.** The system evaluates work through infrastructure metrics — tests pass, CI green, types check. It has no concept of whether what it built is good as a product: whether the UX makes sense, whether the feature solves a real problem, whether the API is intuitive, whether the error messages help users recover.

3. **No market awareness.** The system has no idea what competitors offer, what users want, what the space looks like, or where opportunities exist. Without this, it iterates for the sake of iterating — producing a well-tested, well-linted codebase that nobody wants to use.

4. **No feedback loops.** Planning happens when the backlog is low (a reactive trigger). Work gets done. The CTO agent curates the knowledge graph at post-flight. But nothing re-evaluates the strategy that produced the work. There's no mechanism for "we completed this initiative — did it actually produce the outcome we expected? Should we change direction?"

5. **Organizational overhead without proportional value.** v2 proposed a 9-role org chart (CEO, CTO, Director, Staff Engineer, Principal Engineer, Engineer, Security, Product, QA) with a multi-stage pipeline. Each role adds synchronization overhead. The planning pipeline (CTO plans → Director grooms → Staff Engineer decomposes → Principal Engineer cross-checks) must be traversed for every batch of work. This is modeled on human organizations where fixed headcount and expensive coordination justify batched planning. With agents, throughput is elastic, planning is cheap, and calendar-based cadences don't apply.

6. **Agents are orchestrated, not leveraged.** v2's orchestrator is a condition table: "if backlog low, spawn CTO with planning-cycle skill." The agents answer questions and produce artifacts, but the composition logic is hardcoded in the orchestrator. The system doesn't leverage what agents are actually good at — open-ended exploration, judgment, adaptation — in a way that's structurally different from "loop an agent with subagents."

7. **No evaluation/reward system for strategic decisions.** The system has no way to score whether a vision is good, whether a quarterly plan advances the vision, or whether a sprint outcome validates the quarterly thesis. Without evaluation, the loop is blind — it generates ideas and executes them but can't distinguish good strategic decisions from bad ones. This is the core unsolved problem.

## The Goal

A human kicks off a project with an initial conversation: "here's what we're building and why, here's the repo." From that point, the system runs autonomously. It:

- Researches the market and competitive landscape
- Forms a product strategy connected to real opportunities
- Explores the codebase and understands the current state
- Evaluates the product by actually using it (Playwright, simulators, CLI)
- Identifies the highest-impact work across all dimensions (infrastructure, product quality, new features, market differentiation)
- Executes that work
- Measures whether the outcomes matched expectations
- Feeds learnings back into better strategy and better value estimation
- Evolves its own evaluation criteria over time

The human can check in whenever they want but doesn't need to. The system doesn't wait for human input, human retrospectives, or human planning cycles.

## The Core Idea: One Function, Every Level

The system applies the same function recursively at every level of a planning hierarchy:

```
f(context, children_learnings) → decisions, learnings, work_for_children
```

At the **vision** level: context is market research + codebase state + seed from human. Candidates are possible product directions. Output is selected direction + what was learned about the landscape. Work for children = strategy-level goals.

At the **strategy** level (analogous to "annual plan"): context is the selected vision + market findings + past strategy outcomes. Candidates are possible strategic bets. Output is selected bets + learnings about feasibility. Work for children = quarterly-level goals.

At the **quarterly** level: context is the strategic bets + sprint outcomes + codebase state. Candidates are possible quarterly goals. Output is selected goals + learnings about what's achievable. Work for children = sprint-level tasks.

At the **sprint** level: context is quarterly goal + codebase state. Candidates are possible tasks. Output is selected tasks + learnings about the code. Work for children = execution work.

At the **execution** level: context is task definition + codebase. Output is implementation result + **observations discovered while doing the work** (e.g., "there's no rate limiting anywhere," "the error messages all say 'internal server error'," "found three different HTTP client wrappers"). Work for children is empty — this is the leaf.

**Learnings flow up.** Execution observations become context for sprint-level decisions. Sprint outcomes become context for quarterly evaluation. Quarterly results inform strategy. Strategy outcomes test the vision thesis. The hierarchy is inherently bidirectional.

**Bootstrapping is bottom-up.** On a new/empty codebase, you don't start at the vision level and work down — there's nothing to have a vision about. You start at execution (explore the code, run it, poke at it) and learnings bubble up. The first vision cycle has rich context from below instead of generating direction in a vacuum.

### Inside the Function: Generate, Decompose, Evaluate, Select

Each invocation of the function follows the same internal pattern:

1. **Generate** diverse candidates. Not "generate 10, pick the best" — generate candidates that are meaningfully different from each other along specified dimensions (quality-diversity search). The diversity pressure prevents collapsing to one mediocre idea.

2. **Decompose** the evaluation into binary sub-requirements. Don't ask "is this a good vision?" (high-variance, unreliable). Instead decompose into: "Does this identify a real market gap?", "Is it achievable with this codebase?", "Does it differentiate from competitors?", "Is there community demand?" Each binary judgment is individually high-accuracy.

3. **Evaluate** each candidate against the decomposed criteria. Binary scoring per criterion, aggregate into a fitness signal. If a criterion is satisfied by too many candidates (not discriminative enough), recursively decompose it into finer-grained criteria.

4. **Select** using correlation-aware weighting — rubrics that measure the same underlying dimension get down-weighted so they don't double-count.

5. **Distill** learnings into guiding principles ("market sizing improved our vision accuracy") and cautionary principles ("ignoring infrastructure debt led to failed sprints"). Quality-score principles over time; prune ones that don't correlate with good outcomes.

### Where Zapcode/Monty Fits

The sandboxed interpreter isn't the runtime for the whole strategy (the earlier "strategy program" framing was wrong — prescribing a program structure fights against the goal of agent autonomy). Instead, Zapcode/Monty is a **tool the constant function uses for precise data processing**:

- Sorting and ranking candidates by multi-criteria scores
- Weighting and aggregating binary rubric results with correlation awareness
- Cross-referencing exploration outputs (47 components × complexity scores × test coverage)
- Computing fitness signals from decomposed evaluations
- Tracking prediction accuracy over time

Strategic reasoning — "should we focus on webhooks or auth?" — stays with the LLM (Opus). Data processing — "weight these 20 rubric scores, de-correlate, rank 8 candidates" — runs as code. The LLM generates the code; Zapcode executes it. The LLM makes judgments; code makes calculations.

External function suspension still matters: when the code calls `explore_market(...)`, the VM suspends, an agent runs, and the VM resumes with structured results. Snapshotting enables speculative evaluation — fork at a decision point, explore two directions cheaply, commit to the better one.

## Key Insights from Research

### Original Sources (from v1/v2 exploration)

- [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) — Autonomous ML experimentation loop
- [uditgoenka/autoresearch](https://github.com/uditgoenka/autoresearch) — Generalized autoresearch as a Claude Code skill
- [Slate: moving beyond ReAct and RLM](https://randomlabs.ai/blog/slate) — Thread weaving, episodic memory, knowledge overhang, strategy vs. tactics (see detailed review below)
- [Cognition: don't build multi-agents](https://cognition.ai/blog/dont-build-multi-agents) — Case against parallel multi-agent architectures
- [Manus: context engineering for AI agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) — Context management patterns, compress-at-boundaries
- [Geoffrey Huntley: the Ralph loop](https://ghuntley.com/ralph/) — Speed of the wheel, eventual consistency over per-step perfection
- [RLM — Recursive Language Models](https://arxiv.org/pdf/2512.24601v1) — REPL-based recursive decomposition (caveat: over-decomposes without depth limits)
- [ADaPT: as-needed decomposition and planning](https://arxiv.org/pdf/2311.05772) — Adaptive decomposition depth
- [Pydantic Monty](https://github.com/pydantic/monty) — Secure Python interpreter for AI-generated code
- [Zapcode](https://github.com/TheUncharted/zapcode) — Secure TypeScript interpreter for AI-generated code

### Papers Read in Depth (March 2026)

These papers were fetched and read carefully (methods sections, algorithms, limitations), not just abstracts.

#### MADE: Evolution without an Oracle (Nov 2025)
[arxiv.org/abs/2511.19489](https://arxiv.org/abs/2511.19489) — Zhao et al. (Stanford/Princeton)

**The most directly relevant paper to our evaluation problem.** Core mechanism: a "Requirement Decomposer Agent" takes a vague instruction and decomposes it into k independently verifiable binary sub-requirements. Each sub-requirement is scored binary {0, 1} by a Judge Agent. Fitness = mean of binary scores. This transforms one high-variance holistic judgment into an aggregation of many low-variance binary judgments.

Key findings:
- Decomposition alone (before any evolution) beat all baselines: 48.49% vs 39.89% (GPT-Pilot)
- Evolution added another 13 points (48.49% → 61.92%) in just 3 generations with population size 4
- 14x cheaper and 4x faster than the best baseline
- Judge reliability: ICC = 0.933 under perturbation. High-quality solutions get consistent scores; low-quality solutions get volatile scores (desirable — selection pressure is strongest at the top)
- Uses gpt-4o for judging, gpt-4.1-nano for generating. Deliberate asymmetry: expensive judgment, cheap generation

Limitations we noted:
- Task Solve Rate was actually lower (1.82% vs 5.45%) — satisfies more individual requirements but completes fewer full tasks. Decomposition may lose holistic coherence
- Requirement decomposition quality is unvalidated — if the decomposer produces bad sub-requirements, the entire fitness landscape is wrong
- Small populations (4) and few generations (3) — unclear if it scales
- No crossover operator — relies entirely on directed mutation via semantic feedback

**How it informs our design:** The constant function's "evaluate" step uses MADE's approach — decompose holistic evaluation into binary sub-requirements at each level. This routes around the discriminator quality problem (see below).

#### RRD: Recursive Rubric Decomposition (Feb 2026)
[arxiv.org/abs/2602.05125](https://arxiv.org/abs/2602.05125) — Shen et al.

Extends MADE's decomposition insight with recursive refinement and correlation handling.

Core mechanism:
- Start with initial rubric criteria for a task
- If a rubric is satisfied by too many candidates (>2), it's not discriminative enough → recursively decompose into two finer-grained sub-rubrics
- Filter out misaligned rubrics (ones that prefer weaker models over stronger ones) and redundant rubrics (>70% semantic overlap)
- Apply "whitened uniform weighting": use the inverse square root of the covariance matrix to de-correlate rubrics so redundant dimensions don't dominate
- Early stopping when rejected proposals exceed threshold (task-adaptive depth)

Results: +17.7 points on JudgeBench (55.6% → 73.3% for GPT-4o). Reward signal improvement of ~160% during RL fine-tuning vs. flat rubrics. Crucially, naively generated rubrics actually *degraded* judgment (55.6% → 42.9%) — bad rubrics are worse than no rubrics.

**How it informs our design:** The constant function's rubric decomposition should be recursive and adaptive. Vision-level evaluation naturally needs deeper decomposition than sprint-level. Correlation-aware weighting prevents the evaluation from over-indexing on one dimension.

#### STRATEGIST: Bi-Level Tree Search (Aug 2024)
[arxiv.org/abs/2408.10635](https://arxiv.org/abs/2408.10635) — Light et al.

Bi-level search: high-level strategies (represented as Python code — value heuristic functions) are searched/evolved by an LLM, while low-level execution uses MCTS. Strategies evolve through:
- **Idea generation**: LLM proposes improvement ideas based on "key states" — positions where the current strategy's estimate diverged most from MCTS-refined values
- **Idea queue with UCB scoring**: Ideas that lead to improvements get higher scores. Ideas are modular and reusable across strategies. UCB balances exploitation (proven ideas) vs. exploration (untested ideas)
- **Population self-play**: Round-robin tournaments among top 10 strategies provide win rates as fitness

Key finding: the idea queue with UCB scoring outperformed all alternative search strategies (line search, greedy, BFS). The modular improvement ideas that transfer across strategies are the key mechanism.

Limitations: only works because games have clear win/lose feedback. The entire loop depends on self-play win rates as the fitness signal.

**How it informs our design:** The "improvement idea queue with UCB scoring" is a mechanism for the constant function to learn what types of modifications improve outputs at each level. Track ideas like "add market sizing to vision candidates" or "include infrastructure cost estimates in quarterly plans" and score them by whether they correlate with better downstream outcomes.

#### QDAIF: Quality-Diversity through AI Feedback (ICLR 2024)
[arxiv.org/abs/2310.13032](https://arxiv.org/abs/2310.13032) — MAP-Elites with LLM feedback

Maintains a discretized grid archive where each cell corresponds to a region of behavior space. MAP-Elites doesn't optimize for a single "best" — it fills an archive of diverse high-quality solutions.

Key implementation details:
- Generator and evaluator are **different models** (base model generates, finetuned instruction model evaluates)
- Diversity dimensions must be **human-specified in advance** — the system cannot discover them
- Non-uniform binning is critical (LLM logit distributions are non-linear)
- Reward hacking documented at high fitness ranges (fitness > 0.995 stops correlating with human judgment)
- Quality-diversity tradeoff: QDAIF achieves better coverage but slightly lower average quality than fixed-few-shot

**How it informs our design:** The "generate" step should produce diverse candidates, not just multiple ones. We need to pre-specify diversity axes at each level (vision: market positioning × technical ambition × user focus; sprint: effort × risk × learning value). Reward hacking risk means we shouldn't fully trust high-confidence evaluations.

#### "When is Tree Search Useful for LLM Planning?" (ACL 2024)
[aclanthology.org/2024.acl-long.738/](https://aclanthology.org/2024.acl-long.738/) — Chen et al. (Ohio State/UT Austin)

**The critical constraint on our entire approach.** Through controlled simulation with oracle discriminators at varying accuracy levels:

- Below ~80% discriminator accuracy: tree search **hurts** (worse than simple re-ranking)
- 80-90%: negligible benefit over best-of-N
- Above 90%: tree search starts helping ("sharp increase")
- Tree search is **10-20x slower** regardless of discriminator quality

Real LLM discriminator accuracy:
- 50-80% on most tasks without execution feedback
- Up to 93% with execution feedback, but only on the simplest task (GSM8K answer checking)
- Self-evaluation is especially unreliable — CodeLlama as self-corrector dropped from 39.4% to 10.2%

The mechanism: when incorrect candidates receive high discriminator scores, tree search commits to them and can't recover. Search amplifies discriminator errors.

**Critical implication:** If our "reduce" function (LLM-as-judge evaluating candidates) isn't >90% accurate, sophisticated search doesn't help more than simple best-of-N. **But MADE's decomposition offers a workaround**: by converting holistic judgment into many binary sub-judgments, each individual judgment can be >90% accurate even when the holistic judgment would fail. "Is this chart a scatter plot?" is ~99% accurate. "Is this chart good?" is ~70%.

Environmental/execution feedback dramatically improves discriminator accuracy (up to +30 points). For our system: actually running the software (Playwright), running tests, checking metrics provides the execution feedback that pushes accuracy above the threshold.

#### AFlow: Automating Agentic Workflow Generation (ICLR 2025 Oral)
[arxiv.org/abs/2410.10762](https://arxiv.org/abs/2410.10762) — Zhang et al.

MCTS over *workflow architectures* (not actions within a workflow). Each tree node is a complete workflow (Python class). An LLM optimizer modifies workflows based on per-parent experience history. Key mechanism: experience backpropagation is per-parent history read by the LLM as context, with deduplication to avoid retrying failed modifications.

Smaller models outperformed GPT-4o via sophisticated multi-step workflows (93.9% vs 93.9% on HumanEval at 4.55% cost). But: workflows are model-specific and don't transfer well across models.

**How it informs our design:** The constant function *itself* could evolve via AFlow's approach — not just the inputs/outputs, but the decomposition strategy, the rubric generation approach, the selection mechanism. Meta-level optimization of the evaluation pipeline. However, requires numerical evaluation on a validation set, which is hard for open-ended strategic evaluation.

#### EvolveR: Self-Evolving Agents through Experience (Oct 2025)
[arxiv.org/abs/2510.16079](https://arxiv.org/abs/2510.16079) — Wu et al.

Self-distillation of agent experiences into reusable principles:
- Successful trajectories → "Guiding Principles" (what strategy worked)
- Failed trajectories → "Cautionary Principles" (what mistake to avoid)
- Each principle: one-sentence description + structured (subject, predicate, object) triples
- Quality scoring: Laplace-smoothed success rate `(successes + 1) / (uses + 2)`, pruned below 0.3
- Retrieval: BGE-M3 embeddings, cosine similarity, top-3
- Deduplication: embedding similarity + LLM semantic equivalence check

Key finding: self-distillation quality is bounded by model capability. At 3B parameters, self-distillation actually outperformed teacher-distillation with GPT-4o-mini. At 0.5B it was significantly worse. **With frontier models (Opus for planning), self-distillation should work well.**

Policy evolution via GRPO (Group Relative Policy Optimization) using outcome + format rewards on the collected trajectories.

**How it informs our design:** The "distill learnings" step of the constant function uses EvolveR's approach — extract guiding/cautionary principles from outcomes, quality-score them, prune bad ones, retrieve relevant ones as context for the next cycle. This is how children's learnings become actionable context for parents.

### Key Insights from the Slate Article

The Slate article (randomlabs.ai/blog/slate) contains several insights that inform the architecture directly:

**Knowledge overhang**: The gap between what a model knows and what it can access through direct prompting. Our "generate" phase is a sampling mechanism to explore this overhang — diverse prompting strategies (different angles, priors, temperatures) sample more broadly. Better prompting accesses more of the model's latent strategic knowledge.

**Compression-at-boundaries IS evaluation**: When a sprint completes and its outcome is compressed for quarterly review, the compression itself decides what mattered. The model at each level decides what's important to retain for the level above. Evaluation isn't a separate step — it's built into the boundary between levels.

**Strategy vs. tactics (AlphaZero analogy)**: Sprint-level execution is tactics (policy network). Vision/strategy is strategy (value network). The AlphaZero training progression — tactics first, strategy later, sophisticated trade-offs last — suggests our system should learn to evaluate tactical execution first and develop strategic evaluation later as evidence accumulates.

**Synchronization as the core problem**: Every architecture reviewed (RLM, Devin, Manus, Claude Code, task trees) fails at synchronization in some way. The solution is frequent bounded synchronization via episodes, not infrequent comprehensive replanning. Our feedback loops should be frequent and bounded — learnings flow up after every sprint, not every quarter.

**Context rot**: Hong et al. (2025) showed that all frontier models degrade non-uniformly as input grows. Longer context actively hurts performance. This is empirical justification for bounded episodes at every planning level — not just for efficiency but for correctness.

### Papers Surveyed (summaries only, not read in depth)

These were identified by research agents and summarized from abstracts/web results. Listed for reference but findings should be verified before building on them:

- **Evolving Interpretable Constitutions** (Jan 2026, arxiv 2602.00755) — LLM-guided evolutionary search to discover behavioral norms. 123% higher coordination than human-designed baselines. Suggests evaluation criteria themselves should evolve.
- **SAMULE** (EMNLP 2025) — Three-level reflection: micro (within task), meso (across tasks), macro (transferable strategic lessons). Potentially relevant to multi-level learning.
- **Agent-Pro** (ACL 2024) — Policy-level strategic reflection (not just action-level). Learns "our approach to X is wrong," not just "that API call failed."
- **D3: Debate, Deliberate, Decide** (Oct 2024, arxiv 2410.04663) — Cost-aware adversarial debate for evaluation. Useful for comparing candidate strategies.
- **ARMAP** (ICLR 2025, arxiv 2502.12130) — Learns reward models from environment interactions without human labels, then uses MCTS for planning.
- **Self-Improving AI Agents through Self-Play** (Dec 2025, arxiv 2512.02731) — Formalizes agent self-improvement with a "Variance Inequality" convergence condition.
- **SE-Agent** (Aug 2025, NeurIPS, arxiv 2508.02085) — Evolutionary operators on agent trajectories: revision, recombination, refinement. 55% improvement on SWE-bench.
- **EvoFlow** (Feb 2025, arxiv 2502.07373) — Niching evolutionary algorithms to maintain diverse population of workflows.
- **Agentic AI in Product Management: A Co-Evolutionary Model** (Jul 2025, arxiv 2507.01069) — The only paper found addressing AI for product strategy. Conceptual/theoretical, not implemented.

### What the Literature Tells Us

1. **Nobody has solved autonomous strategic planning.** No published system autonomously decides what to build. Everyone works on "how to execute better." We're in genuinely novel territory.

2. **Decomposition is the key to evaluation.** You can't reliably judge "is this vision good?" (holistic, ~70% accuracy). You can reliably judge "does this identify a real market gap?" (binary, ~95% accuracy). MADE and RRD prove this empirically.

3. **Discriminator quality is the binding constraint.** Sophisticated search only helps if your evaluator is >90% accurate. Below that, best-of-N is equally good at 10-20x lower cost. Binary decomposition + execution feedback are the paths to crossing the threshold.

4. **Evaluation criteria should evolve.** Static rubrics degrade as the system learns. The criteria used to evaluate visions at cycle 1 shouldn't be the same at cycle 50.

5. **Model capability matters more than architecture.** Many of these papers found limitations at 3B-13B parameter models. We're running Opus for planning and Sonnet for execution — frontier models that are substantially more capable than what these papers tested with, and improving rapidly. The discriminator accuracy numbers, the self-distillation quality bounds, the strategy generation quality — all of these should be significantly better with current frontier models.

## Architecture

### The Constant Function

The entire system is one function applied recursively at five levels: vision, strategy, quarterly, sprint, execution.

```typescript
interface CycleInput {
  level: Level                    // vision | strategy | quarterly | sprint | execution
  context: Context                // KG state, parent direction, sibling outcomes
  children_learnings: Learning[]  // observations/principles from the level below
  seed: Seed                      // human-provided vision anchor (constant unless human changes it)
  rubrics: Rubric[]               // evaluation criteria for this level (evolving)
  improvement_ideas: Idea[]       // tracked modifications with UCB scores
}

interface CycleOutput {
  decisions: Decision[]           // what we decided to do at this level
  learnings: Learning[]           // what we observed/learned (flows UP to parent)
  work_for_children: WorkItem[]   // what to pass DOWN to next level
  rubric_updates: RubricUpdate[]  // proposed changes to evaluation criteria
  predictions: Prediction[]       // testable predictions ("if we do X, Y should happen")
}
```

At the execution level, `work_for_children` is empty (it's the leaf). But `learnings` is rich — builder agents report observations alongside implementation results. At the vision level, `children_learnings` drives evidence-based thesis testing.

### Inside the Function

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. GATHER CONTEXT                                               │
│    From KG: current state, past decisions at this level,        │
│    outcome history, accumulated principles.                     │
│    From children: learnings from the level below.               │
│    From parent: the direction/goal set by the level above.      │
│                                                                 │
│ 2. GENERATE DIVERSE CANDIDATES                                  │
│    Opus generates N candidates that are meaningfully different   │
│    along pre-specified diversity axes for this level.            │
│    Apply tracked improvement ideas (UCB-selected) to expand     │
│    the candidate space.                                         │
│                                                                 │
│ 3. DECOMPOSE EVALUATION                                         │
│    Opus decomposes "is this candidate good?" into binary         │
│    sub-requirements specific to this level. Recursively          │
│    refine criteria that aren't discriminative enough.            │
│    Filter misaligned and redundant criteria.                     │
│                                                                 │
│ 4. EVALUATE CANDIDATES                                          │
│    Score each candidate against decomposed binary criteria.      │
│    Where possible, use execution feedback (run tests, run        │
│    Playwright, check metrics) to ground evaluation.              │
│    Aggregate with correlation-aware weighting (Zapcode).         │
│                                                                 │
│ 5. SELECT                                                        │
│    Choose based on weighted scores. Record predictions:          │
│    "we chose X because we predict Y."                            │
│                                                                 │
│ 6. DISTILL LEARNINGS                                             │
│    Extract guiding/cautionary principles from this cycle.        │
│    Quality-score existing principles (did retrieving them        │
│    correlate with good outcomes?). Prune low-scoring ones.       │
│    Update improvement idea scores based on outcomes.             │
│                                                                 │
│ 7. PASS DOWN / PASS UP                                           │
│    Send work items to the level below.                           │
│    Send learnings to the level above.                            │
│    Store predictions for later verification.                     │
└─────────────────────────────────────────────────────────────────┘
```

### Model Assignment

- **Opus**: All planning, evaluation, judgment, and strategic reasoning. Generates candidates, decomposes rubrics, evaluates, distills learnings. This is where model capability matters most — the discriminator quality finding means the evaluation model must be as strong as possible.
- **Sonnet**: All execution. Builder agents implementing tasks, running tests, pushing PRs. Execution quality is high with Sonnet and the cost difference is substantial.
- **Zapcode/Monty**: Data processing within the constant function. Sorting, weighting, cross-referencing, aggregating rubric scores, computing fitness signals. Code for calculations, LLM for judgments.

### Agent Definitions

Five focused agents, each with the right tools for their job. No organizational metaphors, no authority hierarchies. Just capabilities.

| Agent | Tools | Job | Model |
|-------|-------|-----|-------|
| **Explorer** | Serena, Glob, Grep, Read | Explore codebases, return structured findings about architecture, patterns, quality | Sonnet |
| **Product Tester** | Playwright MCP (or simulator) | Explore running apps as a user, simulate journeys, find friction | Sonnet |
| **Market Researcher** | WebSearch, WebFetch, Playwright | Research competitors, analyze market, mine community discussions | Sonnet |
| **Builder** | Read, Write, Edit, Bash, Git | Implement tasks against acceptance criteria, handle CI/PR lifecycle | Sonnet |
| **Evaluator** | Playwright, test runner, checks | Measure whether initiatives achieved their goals, compare before/after | Sonnet |

Each agent returns structured data AND observations. The observations are first-class output that flows up through the hierarchy as learnings.

### External Function API

This is the system's primary API surface. Each function defines a capability the constant function can invoke at any level. The host resolves each call by dispatching an agent with the right tools.

#### Codebase Understanding

```typescript
async function explore_codebase(options?: {
  focus?: string,
  depth?: "overview" | "detailed",
  question?: string,
}): Promise<{
  components: Component[],
  patterns: Pattern[],
  dependencies: Dependency[],
  observations: Observation[],   // first-class learnings
}>
```

#### Product Interaction

```typescript
async function explore_product(options?: {
  entry_point?: string,
  as_persona?: string,
}): Promise<{
  screens: Screen[],
  flows: Flow[],
  observations: Observation[],
}>

async function test_journey(journey: {
  persona: string,
  goal: string,
  starting_point?: string,
  max_steps?: number,
}): Promise<{
  completed: boolean,
  steps: JourneyStep[],
  friction_points: FrictionPoint[],
  time_to_complete: number,
  confidence: number,
}>
```

#### Market and Community Research

```typescript
async function explore_market(options: {
  category: string,
  aspects?: string[],
}): Promise<{
  competitors: Competitor[],
  common_features: Feature[],
  gaps: Gap[],
  trends: Trend[],
}>

async function explore_community(options: {
  topic: string,
  sources?: string[],
}): Promise<{
  pain_points: PainPoint[],
  feature_requests: FeatureRequest[],
  sentiment: SentimentSummary,
}>
```

#### Evaluation

```typescript
async function run_checks(): Promise<{
  tests: TestResult,
  types: TypeCheckResult,
  lint: LintResult,
  benchmarks?: BenchmarkResult,
  coverage?: CoverageResult,
}>

async function evaluate_outcome(initiative_id: string): Promise<{
  criteria_met: CriterionResult[],
  journey_improvements: JourneyComparison[],
  metric_changes: MetricChange[],
  unexpected_effects: Observation[],
}>
```

#### Knowledge (Continuity Across Cycles)

```typescript
async function recall(query: string): Promise<{
  entities: Entity[],
  observations: Observation[],
  relationships: Relationship[],
}>

async function remember(entry: {
  entity: string,
  type: string,
  observations: string[],
  confidence: number,
  relationships?: { to: string, type: string }[],
}): Promise<void>

async function get_history(topic: string): Promise<{
  past_initiatives: Initiative[],
  outcomes: Outcome[],
  lessons: Lesson[],
  prediction_accuracy: number,
}>
```

#### Action

```typescript
async function create_initiative(initiative: {
  title: string,
  rationale: string,
  acceptance_criteria: Criterion[],
  estimated_impact: number,
  estimated_effort: number,
  tasks?: TaskDefinition[],
}): Promise<{ id: string }>

async function execute_task(task_id: string): Promise<{
  status: "completed" | "failed" | "blocked",
  result: TaskResult,
  observations: Observation[],   // first-class learnings from execution
}>
```

### How Feedback Flows

```
VISION ←── learnings ──── STRATEGY ←── learnings ──── QUARTERLY ←── learnings ──── SPRINT ←── learnings ──── EXECUTION
  │                          │                           │                           │                          │
  │ work/direction           │ work/goals                │ work/goals                │ work/tasks               │ (leaf)
  ├────── direction ────────→├────── goals ─────────────→├────── goals ─────────────→├────── tasks ────────────→│
  │                          │                           │                           │                          │
  │ predictions              │ predictions               │ predictions               │ predictions              │
  │ "if we pursue X,         │ "if we build Y,           │ "if we ship Z,            │ "this task should        │
  │  market share should     │  quarterly metric          │  friction at step 3       │  take ~4 hours and       │
  │  grow by N%"             │  should improve"           │  should disappear"        │  fix the 404 bug"        │
  │                          │                           │                           │                          │
  └──── verify predictions ──┘──── verify predictions ───┘──── verify predictions ───┘──── verify predictions ──┘
```

Predictions are stored in the KG with timestamps. Each cycle at each level checks: "did our predictions from last cycle come true?" This prediction accuracy tracking is how the system learns to evaluate better — not by improving a scoring rubric directly, but by accumulating evidence about what types of predictions are reliable.

### How Product Evaluation Works

The system doesn't just read code and have opinions. It actually uses the software:

- **Playwright** for web apps — navigate, fill forms, click buttons, observe what happens
- **Simulators** for mobile apps — iOS Simulator, Android emulator
- **CLI execution** for command-line tools — run commands, observe output
- **HTTP clients** for APIs — call endpoints with valid/invalid/adversarial inputs

Evaluation perspectives:
- **New user**: Can they accomplish the core task? Where do they get confused?
- **Developer integrating**: Can they figure out the API from docs/types alone? Are error responses helpful?
- **Power user**: Are advanced workflows discoverable? Are there missing features?
- **Adversarial**: What happens with empty input, malformed data, concurrent access?

Product evaluation provides the execution feedback that pushes discriminator accuracy above the 90% threshold identified in the literature. "Did the synthetic user complete signup?" is verifiable. "Is the signup flow good?" is not.

### How Market Research Works

The system researches the competitive landscape to inform strategy:

- **Competitor discovery**: Web search for the product category, identify players
- **Feature analysis**: Explore competitor docs, APIs, products (via Playwright on their sites)
- **Community mining**: Search GitHub issues, forums, HN, Reddit for what users complain about and request
- **Trend identification**: What's emerging in the space? What's becoming table stakes?

These findings feed directly into the vision and strategy levels as context for candidate generation.

### What We Keep from v2

- **Knowledge Graph (gk)** — essential for continuity across cycles and levels
- **Beads** — task tracking for initiatives and tasks
- **Agent SDK `query()`** — how we spawn agents
- **Plugin system** — how agents get tools and capabilities
- **Dashboard** — monitoring running agents, costs, progress

### What Changes from v2

| v2 | v3 |
|----|-----|
| Condition-based orchestrator (11 conditions, deterministic routing) | One recursive function applied at every level |
| 9-role org chart with authority hierarchy | 5 focused agents, no organizational metaphor |
| Rigid pipeline: CTO → Director → Staff Eng → Engineer | Same function at every level, different inputs/outputs |
| Planning triggered by "backlog below threshold" | Continuous bidirectional feedback drives replanning |
| Static skills and personas | Evolving evaluation criteria and improvement idea tracking |
| Infrastructure-only evaluation (tests, CI, types) | Product evaluation (Playwright), market research, binary rubric decomposition |
| No market awareness | Active competitive research and community mining |
| No feedback loop on strategy quality | Predictions tracked and verified at every level |
| Top-down only (plan → execute) | Bidirectional: learnings flow up, work flows down |
| "Strategy program" generated as code | LLM reasons strategically; Zapcode processes data |

## Project Structure

```
src/
  loop.ts                       — Runs the constant function at each level,
                                   manages the hierarchy and feedback flow

  function/
    cycle.ts                    — The constant function implementation:
                                   gather context → generate → decompose →
                                   evaluate → select → distill → pass up/down

    generate.ts                 — Diverse candidate generation with quality-diversity
    decompose.ts                — Binary sub-requirement decomposition (MADE-style)
    evaluate.ts                 — Candidate evaluation against decomposed rubrics
    select.ts                   — Correlation-aware weighted selection
    distill.ts                  — Principle extraction from outcomes (EvolveR-style)

  runtime/
    sandbox.ts                  — Zapcode/Monty integration for data processing
                                   (sorting, weighting, aggregation, fitness computation)

    agents/                     — Agent dispatch implementations
      explore-codebase.ts       — Spawns explorer agent → structured findings
      explore-product.ts        — Spawns product tester → journey/screen data
      explore-market.ts         — Spawns market researcher → competitive intelligence
      explore-community.ts      — Spawns market researcher → community pain/requests
      test-journey.ts           — Spawns product tester → friction analysis
      execute-task.ts           — Spawns builder agent → implementation result + observations
      evaluate-outcome.ts       — Spawns evaluator → outcome measurement

    knowledge/                  — KG operations
      recall.ts                 — Query knowledge graph
      remember.ts               — Write to knowledge graph
      get-history.ts            — Query past outcomes and prediction accuracy
      principles.ts             — Principle storage, retrieval, quality scoring, pruning

    checks.ts                   — Direct Bash: test suite, linter, type checker
    beads.ts                    — Initiative and task tracking

  types.ts                      — Shared types for all levels and functions

  agents/                       — Agent persona definitions (.md files)
    explorer.md
    product-tester.md
    market-researcher.md
    builder.md
    evaluator.md

  server.ts                     — Dashboard (from v2)
  state.ts                      — Runtime state tracking (from v2)

plugins/
  autopilot-core/               — Shared hooks, MCP config, safety guardrails
```

## Open Questions

1. **How do we define diversity axes at each level?** QDAIF requires pre-specified diversity dimensions. What are the right axes for vision candidates (market positioning × technical ambition × user segment)? For quarterly goals (effort × risk × learning value)? For sprint tasks? These need to be defined initially and may need to evolve.

2. **How does rubric decomposition bootstrap?** The first time the function runs at the vision level, it needs to decompose "is this a good vision?" into binary sub-requirements. The quality of this decomposition determines the quality of everything downstream. MADE's requirement decomposer is unvalidated — how do we ensure the initial decomposition is good? Possible approach: start with human-provided rubrics and let them evolve.

3. **What's the right cadence at each level?** Vision should be re-evaluated rarely (when accumulated evidence challenges the thesis). Strategy maybe monthly (in wall-clock terms, but much faster in agent-execution terms). Quarterly and sprint are more frequent. How do we operationalize "enough evidence has accumulated to re-evaluate this level"?

4. **How do we handle commitment continuity?** If each cycle generates fresh candidates, the system might thrash — cycle N picks direction A, cycle N+1 picks direction B. Once work is in-flight, the bar for abandoning it should be higher than for not starting it. Need a mechanism for "we committed to this, stay the course unless strong evidence says otherwise."

5. **How does the system bootstrap on a brand new repo?** The first cycle starts at execution level (explore, run, poke). Learnings bubble up. The first vision is generated from below, not imposed from above. But: what does the human seed look like? Is it "here's a repo, figure out what it should become"? Or "here's a repo, I want it to become X"? The seed shapes how much the system needs to discover vs. how much is given.

6. **What prevents the strategy from diverging?** The seed/vision is the anchor. Guardrails: cost budgets per cycle, scope constraints from the seed, diminishing returns detection (if recent initiatives had low impact, surface plateau to human), prediction accuracy tracking (if predictions are consistently wrong, the system's evaluation is broken).

7. **How do we validate the constant function itself?** We can't test this on benchmarks — no benchmark exists for "autonomous product strategy." We need to run it on real projects and evaluate outcomes. What does a minimum viable experiment look like? Possibly: run on autopilot's own codebase and see if it generates sensible direction.

8. **Cost model.** Each level invocation involves: LLM calls for generation, decomposition, and evaluation; agent dispatches for exploration/research; potentially Zapcode execution for data processing. The cost structure differs by level — vision cycles are exploration-heavy (expensive), sprint cycles are execution-heavy (builder agent time). Need to track cost per cycle per level.

9. **How do we handle the holistic coherence problem MADE exposed?** MADE achieved higher requirement satisfaction but lower task solve rate — decomposition may lose holistic coherence. At the vision level, this could mean: all sub-requirements are satisfied but the vision doesn't actually hang together as a coherent product direction. May need both decomposed evaluation AND a holistic coherence check.

10. **Which surveyed papers should we read in depth?** Several papers in the "surveyed but not read" list could be important: Evolving Constitutions (evaluation criteria evolution), SAMULE (multi-level reflection), D3 (adversarial debate for evaluation), ARMAP (learned reward models). Should prioritize based on which open questions they address.

11. **How does the human interface work?** The human provides the seed and can check in. But: can they modify the seed mid-run? Veto an initiative? Force-prioritize? Pause and review? What do they see — a dashboard? The KG? A log? The interaction model for a system making strategic decisions is fundamentally different from one executing a backlog.
