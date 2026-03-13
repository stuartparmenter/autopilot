---
name: planning-cycle
description: This skill should be used when the CTO runs a planning cycle. Dispatches specialist subagents (Principal Engineer, Security, Product, QA) for investigation, synthesizes findings, creates strategic initiatives as beads, and writes strategic knowledge to the KG.
user-invocable: true
---

# Planning Cycle

You run a full planning cycle for the project. This is the CTO's primary strategic workflow: understand the current state, dispatch specialists to investigate, synthesize what they find, create strategic initiatives, and document strategic constraints in the knowledge graph so Directors can operationalize them into epics and engineers can start with the right context.

---

## Phase 1: Orient — Read the Knowledge Graph

Before deciding what to investigate, understand what is already known. **This is the most important phase.** Specialists cannot do focused work if you send them in without context.

Query the KG in two layers — structural first, then strategic:

### Layer 1: Understand the System

1. **Project overview**: `get_entity` on the project entity. Read its observations to understand tech stack, purpose, and scale.

2. **All components**: `list_entities` filtered to type `component`. For each component, use `get_entity` to read its observations — what it does, what it depends on, how it fits. You must understand the system's structure before you can reason about its gaps.

3. **Patterns and decisions**: `list_entities` filtered to types `pattern` and `decision`. Read each one. These tell you how the system was built and why. Patterns reveal consistency (or inconsistency). Decisions reveal constraints.

4. **Relationships**: For key components, use `get_neighbors` to understand how they connect. The dependency graph tells you where changes have high blast radius.

**Stop and summarize.** Before moving to Layer 2, write down (in your response, not the KG) a 5-10 sentence summary of what the system is, how it's structured, and what patterns it uses. If you cannot write this summary, you have not read enough.

### Layer 2: Understand Strategic State

5. **Active initiatives**: `list_entities` filtered to type `initiative`. Note what work is already planned or in flight — do not duplicate it.

6. **Constraints**: `list_entities` filtered to type `constraint`. Read each one — these are boundaries engineers must not cross.

7. **Known problem areas**: `search_keyword("risk OR blocker OR debt OR fragile")` to surface flagged concerns.

8. **Recent activity**: `get_timeline` to see what observations have been added recently. Patterns in recent additions signal what the team has been learning.

After both layers, form a mental model: what does the team know, what is uncertain, what is planned, and where are the gaps?

---

## Phase 2: Decide Investigation Targets

Based on the KG orientation, decide where each specialist should focus. Good targeting prevents specialists from duplicating each other or investigating areas already well-covered.

**Targeting heuristics:**

- **Security**: Target authentication flows, external integrations, data handling, permission checks — especially any modules flagged with `risk` observations or that have changed recently without security review.
- **Principal Engineer**: Target modules with high change frequency (from recent git history or KG observations), areas flagged as `fragile` or `debt`, and any architectural questions raised in recent decisions.
- **Product**: Target user-facing workflows, onboarding flows, configuration complexity, and capability gaps relative to what similar products provide.
- **QA**: Target modules with low test coverage (look for `coverage` observations in KG), recent regressions, or areas that have had repeated bugs.

Write one focused target for each specialist — a specific area and the question you want answered. Vague targets produce vague findings.

---

## Phase 3: Dispatch Specialist Subagents

Spawn four specialists in parallel using Task(). Each specialist invokes their own `/investigate` skill with the focus area you've chosen.

```
Task("Investigate security posture: [specific area]", {
  agent: "security",
  prompt: "Invoke /investigate. Focus area: [specific area, e.g., 'authentication flow in src/auth/ and token handling in src/lib/oauth.ts']. KG context: [paste relevant KG entities and observations]. Report themes and patterns — I need to understand categories of risk and their scope, not individual bug fixes."
})

Task("Investigate engineering health: [specific area]", {
  agent: "principal-engineer",
  prompt: "Invoke /investigate. Focus area: [specific area, e.g., 'retry logic and error classification in src/lib/ — assess whether current patterns are consistent and safe']. KG context: [paste relevant KG entities]. Report themes and patterns — I need to understand categories of architectural concern and their scope, not individual code issues."
})

Task("Investigate product gaps: [specific area]", {
  agent: "product",
  prompt: "Invoke /investigate. Focus area: [specific area, e.g., 'onboarding flow and multi-project support limitations']. KG context: [paste relevant strategic goals and roadmap entities]. Report themes and patterns — I need to understand categories of product gaps and their scope, not individual feature requests."
})

Task("Investigate test coverage and reliability: [specific area]", {
  agent: "qa",
  prompt: "Invoke /investigate. Focus area: [specific area, e.g., 'test coverage in executor.ts and monitor.ts — what failure modes are untested?']. KG context: [paste relevant coverage observations]. Report themes and patterns — I need to understand categories of quality gaps and their scope, not individual missing tests."
})
```

**Provide context to each specialist.** Don't send specialists in blind — paste the relevant KG entities and observations into the prompt. This prevents them from re-discovering what is already known and helps them focus on genuine gaps.

---

## Phase 4: Collect and Synthesize Findings

Wait for all four Task() calls to complete. Then synthesize:

**Group related findings across specialists.** A QA finding about no tests for error handling and a Principal Engineer finding about inconsistent error handling are the same underlying problem. Group them into a single theme.

**Identify themes.** Common themes across planning cycles:
- Reliability: error handling gaps, retry issues, test coverage gaps
- Security: auth weaknesses, injection risks, missing validation
- Observability: missing metrics, poor error messages, no audit trail
- Developer experience: onboarding friction, configuration complexity, documentation gaps
- Scalability: hardcoded limits, single-instance assumptions, performance bottlenecks

**Prioritize themes.** Rank by: (1) safety and correctness first, (2) user impact second, (3) maintainability third. A security gap outranks a developer experience improvement.

**Check against active work.** For each theme, verify it is not already covered by an active initiative or project in the KG. If it is partly covered, note what remains.

---

## Phase 5: Create an Initiative Brief

Before creating initiatives, write a brief summary of what this planning cycle found and decided. This provides continuity for the next planning cycle.

Format:

```
## Planning Cycle — [date]

### Investigation Targets
- Security: [what was investigated]
- Engineering: [what was investigated]
- Product: [what was investigated]
- QA: [what was investigated]

### Key Findings
- [theme 1]: [summary of evidence from specialists]
- [theme 2]: [summary]
- [theme 3]: [summary]

### Decisions
- [what was prioritized and why]
- [what was deliberately deferred and why]

### Initiatives Created
- [initiative title] (priority: [P1-P4])
```

Write this brief as a KG observation on the project or initiative entity:
```
add_observations([{
  entity: "<initiative entity name>",
  content: "<the brief above>",
  type: "planning-session",
  confidence: 1.0
}])
```

---

## Phase 6: Create Strategic Initiatives as Beads

For each prioritized theme, create an initiative bead. Initiatives represent high-level strategic direction — Directors will claim them and decompose them into epics.

### Abstraction test — apply before creating every initiative

An initiative is NOT a bug, task, feature, or epic. Before creating each initiative, ask:

1. **Could a single engineer implement this in one PR?** → It's a task, not an initiative.
2. **Does it reference specific files, functions, or line numbers?** → It's a task or bug.
3. **Could it be a child of a broader strategic goal?** → It's an epic, not an initiative.
4. **Does it require a Director to decide HOW to break it down?** → It's an initiative.
5. **Would it produce 3-8 epics when decomposed?** → It's an initiative.

**The pipeline:** Initiative → Director decomposes into epics → Staff Engineer decomposes epics into tasks/features/bugs → Engineers implement. If you skip levels, the downstream roles have nothing to do and the work lacks structure.

**Examples:**

| Initiative (correct) | NOT an initiative (too tactical) |
|---|---|
| "Establish trust boundaries for untrusted project repos" | "Validate gk_command against an allowlist" |
| "Harden the orchestrator for unattended multi-day operation" | "Fix stale bead recovery in poll loop" |
| "Build the autonomous code review pipeline" | "Wire respond-review dispatcher handler" |
| "Eliminate class of input sanitization gaps across all surfaces" | "Fix XSS in server.ts:895" |

### Creating initiatives

Use the beads MCP `create` tool:

```
create(title="<Initiative Title>", type="initiative", priority=<1-4>,
       description="<2-3 sentence description of strategic intent and desired outcome>")
```

**Priority mapping:**
- `p1` — Security vulnerabilities, correctness bugs, data integrity issues
- `p2` — Reliability gaps, foundational tooling, significant technical debt
- `p3` — Quality improvements, test coverage, observability
- `p4` — Developer experience, documentation, nice-to-have features

**Initiative title format:** Start with a verb. State the strategic outcome, not the tactical task.

**Initiative description format:**
- Sentence 1: What strategic problem this addresses and why it matters now
- Sentence 2: What areas of the system are affected
- Sentence 3: What success looks like (the outcome Directors should drive toward)
- Do NOT include file paths, function names, or implementation details — those belong in epics and tasks

Limit to 2-4 initiatives per planning cycle. Quality over quantity — a well-framed initiative that Directors can operationalize into concrete epics is more valuable than ten vague ones that sit untouched.

---

## Phase 7: Write Architectural Contracts to the KG

For each initiative, write the constraints that engineers must follow when implementing the resulting work. These are the pre-conditions for the batch — Directors and engineers will read them when operationalizing initiatives into epics and issues.

**Constraint format:**

```
add_observations([{
  entity: "<affected module or component entity>",
  content: "CONSTRAINT: [specific rule engineers must follow]. Rationale: [why this constraint exists]. Applies to: [initiative title or bead ID].",
  type: "constraint",
  confidence: 0.9
}])
```

**What makes a good constraint:**
- Specific enough to be checkable (not "be careful with auth")
- Tied to a rationale (engineers who understand why a constraint exists follow it better)
- Scoped to a module or component (global constraints are too vague to enforce)

**Example constraints:**
- "CONSTRAINT: All new retry logic must use withRetry() from src/lib/retry.ts, not manual setTimeout loops. Rationale: withRetry() handles Retry-After headers and jitter; manual loops do not."
- "CONSTRAINT: State transition logging must call insertStateTransition() immediately after the bead status update, in the same try block. Rationale: Partial logging (bead updated, DB not) creates audit gaps."
- "CONSTRAINT: No new SQLite tables may be added without a corresponding migration in src/lib/db/migrations/. Rationale: Schema drift between environments breaks production upgrades."

Write 1-3 constraints per initiative. More than that suggests the initiative is too broad or too vague.

---

## Phase 8: Write Strategic Knowledge to the KG

Update the KG with what this planning cycle learned strategically — decisions that will matter in future cycles.

**Strategic observations to write:**

1. **Deferred decisions**: What was found but deliberately not acted on, and why. Future planning cycles should know this was considered.

2. **Pattern discoveries**: If specialists surfaced a recurring pattern (e.g., "four different modules retry in four different ways"), note it as a known pattern so future investigators build on it.

3. **Roadmap updates**: If the initiatives created advance a strategic goal, link them:
   ```
   add_relationships([{
     source: "<initiative entity>",
     target: "<roadmap goal entity>",
     relationship: "advances",
     confidence: 0.9
   }])
   ```

4. **Risk updates**: If investigation surfaced a risk that was not acted on (deferred), update the risk entity's confidence or add an observation explaining why it was deferred.

---

## Rules

- **Read before writing.** Never create initiatives without first reading the KG. Duplicate initiatives are noise.
- **Target specialists precisely.** A focused investigation produces actionable findings. Broad mandates produce generic advice.
- **Synthesize, don't relay.** The value of the planning cycle is identifying themes across specialists — not just concatenating their reports.
- **Write constraints for engineers, not yourself.** Constraints must be specific enough that an engineer who has never spoken to you can follow them.
- **2-4 initiatives maximum.** A planning cycle that produces 10 initiatives has not prioritized — it has delegated the prioritization problem downstream.
- **Defer honestly.** When something real is found but not acted on, document why. The next planning cycle should build on your reasoning, not re-discover the same issue.
