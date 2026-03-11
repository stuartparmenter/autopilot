# Autopilot v2: The Full Cycle

One continuous story. Each scene's side effect triggers the next. Branch scenes fork from the main line and rejoin. Read top to bottom for the happy path; branches show what happens when things go sideways.

Graph entities are marked: **Stage**, *Role*, `System`, [Artifact], (Condition), {Decision Point}.

---

## Scene 1: Cold Start

The orchestrator boots against a fresh project. No knowledge, no beads, no history.

**What happens:**
1. Orchestrator polls `Knowledge Graph` via `gk get_stats`
2. (KG Database Empty) → true
3. Orchestrator spawns *Principal Engineer* + `seed-kg` skill
4. Principal Engineer scans the codebase: file structure, module boundaries, entry points, README/doc content, existing architectural decisions in comments
5. Principal Engineer writes to `Knowledge Graph`: component entities, pattern entities, constraint entities. Shallow but wide.
6. Principal Engineer completes → KG has structural knowledge

**Side effect → KG is populated. Planning can proceed.**

---

## Scene 2: First Planning Cycle

The ready queue is empty. The orchestrator needs to create work.

**What happens:**
1. Orchestrator checks (Backlog Below Threshold) → true (queue is empty)
2. Spawns *CTO* + `planning-cycle` skill
3. CTO queries `Knowledge Graph` for current state of the project — what exists, what patterns are established, what constraints are known
4. {Investigation Targeting} — CTO decides where to focus: security gaps? test coverage? feature work?
5. CTO spawns specialists as subagents (Task), collects findings in-context:
   - *Product* + `investigate` — strategic direction, user needs, prioritization
   - *Principal Engineer* + `investigate` — deeper codebase exploration, cross-project patterns
   - *Security* + `investigate` — threat model, vulnerability scan
   - *QA* + `investigate` — test coverage gaps, reliability issues
6. Specialists explore (each reads from `GitHub` + `Knowledge Graph`), return findings directly to CTO's context as subagent output
7. CTO synthesizes findings → creates [Initiative Brief]
8. CTO creates project epics in `Beads`, writes strategic knowledge to `Knowledge Graph`
9. CTO writes [Architectural Contracts] — constraints for the work ahead, stored in KG

**Side effect → Project epics land in Triage state. The system has work to organize.**

---

## Scene 3: Project Grooming

Raw epics need an owner who'll shape them into something implementable.

**What happens:**
1. Orchestrator detects (Project Has Triage Beads) → spawns *Director* + `own-project` skill
2. Director reads from `Beads` (the triage queue) and `Knowledge Graph` (project context, CTO contracts)
3. {Triage Decision} — for each epic: accept, defer, or reject
4. Director accepts an epic → enters **Project Creation** stage
5. {Project Scoping} — Director refines scope, sets acceptance criteria, defines what "done" looks like
6. Director consumes [Initiative Brief] + specialist findings from KG for context
7. Director produces [Project Spec] — refined scope ready for decomposition
8. Director writes [Status Update] to `Knowledge Graph` (first project health observation)
9. Director hands off to Staff Engineer for decomposition

**Side effect → Project Spec exists. Someone needs to break it into implementable pieces.**

---

## Scene 4: Decomposition

The Staff Engineer turns a project spec into a batch of concrete, claimable beads.

**What happens:**
1. *Staff Engineer* + `decompose-epic` skill operates at **Decomposition** stage
2. Consumes [Project Spec]
3. {Decomposition Strategy} — how to split the work:
   - What's the right granularity? (single-session implementable)
   - What depends on what? (dependency chains via `bd dep add`)
   - What touches the same files? (sequence competing changes, don't parallelize them)
4. Staff Engineer creates sub-beads with: approach notes, acceptance criteria, dependency chains, affected modules
5. Produces [Task Batch]
6. For multi-bead batches → Staff Engineer spawns *Principal Engineer* + `cross-check-batch` as subagent
7. Principal Engineer consumes [Task Batch], checks for:
   - Conflicting changes to same modules across beads
   - Missing dependencies between beads
   - Pattern consistency across the batch
   - Cross-project conflicts (if multiple projects in flight)
8. Principal Engineer returns [Cross-Check Verdict] to Staff Engineer's context
9. If approved → beads promoted to **Ready**
10. If concerns raised → back to **Decomposition** (rework loop)

**Side effect → Ready queue has items. The builders can start.**

---

## Scene 5: Implementation

An engineer claims a bead and does the actual work.

**What happens:**
1. Orchestrator checks (Ready Queue Has Items) → true
2. Spawns *Engineer* + `implement-bead` skill → **In Progress**
3. Engineer claims bead atomically (`bd update --claim` — fails if already claimed)
4. Engineer reads:
   - Bead details from `Beads` (what to build, acceptance criteria, approach notes)
   - [Architectural Contracts] from `Knowledge Graph` (CTO's constraints, patterns to follow)
   - Relevant context from `Knowledge Graph` (past decisions affecting this area, component relationships)
5. Engineer implements: understand → plan → code → test → self-review
6. During work: writes tentative observations to `Knowledge Graph` (decisions made, confidence 0.5-0.7)
7. End-of-session subagents (while still in-context):
   - **Rebase** — merge latest main, resolve any conflicts using full knowledge of what changed
   - **/simplify** — code quality pass on changed files
   - **/kg-extract** — structured KG extraction: what was built, decisions made, patterns discovered
8. Engineer pushes branch to `GitHub`, creates PR
9. Produces [Pull Request]
10. Bead moves: **In Progress** → **In Review**

**Side effect → A PR exists. It needs review before merge.**

> **Branch point: what if the engineer hits a problem? → See [Branch A: Escalation](#branch-a-escalation)**

---

## Scene 6: Review

The Staff Engineer decides how thoroughly to review this PR, then collects verdicts.

**What happens:**
1. Orchestrator detects (PR Needs Review) → spawns *Staff Engineer* + `review-batch` skill
2. Staff Engineer consumes [Pull Request]
3. {Review Routing} — decides which specialist legs to trigger based on what changed:

   | PR touches... | Triggers |
   |---|---|
   | Multiple subsystems | *Principal Engineer* + `review-pr` (always for multi-system) |
   | Auth, crypto, user data | *Security* + `review-pr` |
   | User-facing behavior, API changes | *Product* + `review-pr` |
   | Core infra, data layer | *QA* + `review-pr` |
   | Single file, isolated fix | Staff Engineer only |

4. Specialist review legs spawn as subagents (Task) in parallel — each reads from `GitHub` (the diff) and `Knowledge Graph` (relevant patterns/decisions)
5. Each leg returns [Verdict] to Staff Engineer's context — approve, request changes, or block (with rationale)
6. Staff Engineer collects verdicts → makes the call:
   - **All approve** → PR ready to merge
   - **Changes requested** → back to **In Progress** (engineer addresses feedback)
   - **Blocked** → systemic concern; Staff Engineer creates a block bead with rationale. Orchestrator detects and spawns CTO if architectural.
7. Staff Engineer produces [Batch Summary] when a batch of reviews completes, written to KG

**Side effect → PR is approved and merges. Or it doesn't — see branches below.**

> **Branch point: what if CI fails? → See [Branch B: CI Failure](#branch-b-ci-failure)**
> **Branch point: what if a human reviewer comments? → See [Branch C: Human Review](#branch-c-human-review)**

---

## Scene 7: Merge & Done

The PR merges. The bead is complete.

**What happens:**
1. Orchestrator checks (PR Merged) → true
2. Triggers **In Review** → **Done**
3. Bead closed: `bd close <id> --reason "PR #N merged"`

**Side effect → One less bead in the project. Is the project done?**

---

## Scene 8: Project Completion

All beads under the project are closed. Time to wrap up.

**What happens:**
1. Orchestrator checks (Project All Tasks Done) → true
2. Spawns *Director* + `own-project` skill for closure
3. Director writes final [Status Update] — project outcome, what was delivered, what was deferred
4. Director closes the project
5. Orchestrator checks (Batch Complete) → spawns *CTO* + `post-flight` skill
6. CTO runs post-flight:
   - Consumes [Batch Summary] + [Status Updates] from KG
   - Curates `Knowledge Graph`:
     - Validates engineer observations (elevate confirmed patterns, prune noise)
     - Adjusts confidence scores (confirmed decisions → 0.9+, abandoned approaches → 0.3)
     - Cross-references across the batch for emerging patterns
   - Handles any escalations that were deferred
   - Updates roadmap entities — links completed work to strategic goals
   - Writes to `Knowledge Graph`

**Side effect → KG is richer and more accurate. Queue is drained.**

---

## Scene 9: The Cycle Restarts

The queue is empty again. But this time the system is smarter.

**What happens:**
1. Orchestrator checks (Backlog Below Threshold) → true
2. Spawns *CTO* + `planning-cycle` skill
3. Back to Scene 2 — but now CTO queries a KG populated with:
   - Structural knowledge from the seeder (Scene 1)
   - Strategic decisions from the first planning cycle (Scene 2)
   - Implementation observations from engineers (Scene 5)
   - Curated patterns from post-flight (Scene 8)
4. Planning is better because past context is queryable, not reconstructed

**The loop continues. Each cycle the KG gets richer. Planning gets smarter. Fewer conflicts. Fewer rework loops.**

---

## Branch A: Escalation

*Forks from Scene 5, step 5. Rejoins Scene 5, step 5.*

The engineer discovers something that conflicts with an existing architectural decision.

**What happens:**
1. Engineer queries `Knowledge Graph` and finds: "Use SQLite for storage (decided 2026-01-15, confidence 0.9)"
2. But the bead says "add PostgreSQL support for multi-node deployment"
3. Engineer cannot resolve this independently — it's an architectural question above their scope
4. Engineer creates a block bead: `bd create --type block --ref <bead-id> -s "Conflicts with decision: SQLite-only storage"`
5. Bead moves to **Blocked**
6. Orchestrator detects the blocked bead with an architectural concern → spawns *CTO* + appropriate skill
7. CTO reads the block bead, queries KG for full context around the decision
8. CTO resolves: either updates the architectural decision in KG (proceed with change) or confirms the constraint (reject the bead's approach)
9. If proceed → CTO unblocks the bead with updated guidance, engineer continues with new knowledge
10. If reject → bead goes back to Director for re-scoping

**Rejoins Scene 5 (if proceed) or Scene 3 (if reject).**

---

## Branch B: CI Failure

*Forks from Scene 6. Rejoins Scene 6.*

The PR passes review but CI fails.

**What happens:**
1. Orchestrator checks (PR CI Failed) → true
2. Spawns *Engineer* + `fix-pr` skill
3. Engineer reads CI logs from `GitHub`
4. {Fix vs Escalate} — Engineer queries `Knowledge Graph`:
   - First failure on this module? → diagnose, fix, push
   - Same failure pattern as last week? → check if previous fix was incomplete
   - Third CI failure on this bead? → create block bead (something structural needs attention)
5. Engineer fixes the issue, pushes to the PR branch
6. CI re-runs
7. Bead stays **In Review** (back to review pipeline)

**Rejoins Scene 6 — review continues from where it left off.**

---

## Branch C: Human Review

*Forks from Scene 6. Rejoins Scene 6.*

A human reviewer leaves comments on the PR.

**What happens:**
1. Orchestrator detects (PR Review Feedback) → true
2. Spawns *Engineer* + `respond-review` skill
3. Engineer reads review comments from `GitHub`
4. For code change requests → implements changes, replies to comments, pushes
5. For design concerns → STOP. This isn't a code fix, it's an architectural question.
   - Engineer creates a block bead with the design concern
   - Orchestrator detects → spawns *Staff Engineer* to evaluate: local issue or systemic?
   - If systemic → Staff Engineer creates block bead escalating to CTO
   - Bead moves to **Blocked** until resolved
6. For approvals → no action needed

**Rejoins Scene 6 — or Scene 3 if the design concern requires re-scoping.**

---

## Branch D: Merge Conflict

*Forks from Scene 5, step 7 (rebase). Can also fork from Scene 6.*

Two engineers modified the same file. The rebase hits conflicts.

**What happens (in-context, during Scene 5):**
1. Engineer's end-of-session rebase detects conflicts
2. Engineer resolves conflicts in-context — they know exactly what they changed and why
3. Engineer pushes the resolved branch
4. No separate agent needed — the engineer is the best person to resolve their own conflicts

**What happens (post-push, during Scene 6):**
1. Main branch moves forward while PR is in review
2. PR develops merge conflicts
3. Orchestrator detects conflict → spawns *Engineer* + `fix-pr` skill
4. Engineer merges main, resolves conflicts, pushes
5. If resolution is ambiguous → creates block bead for escalation

**Rejoins Scene 5 step 8 (in-context) or Scene 6 (post-push).**

---

## Branch E: External Issue

*Can start at any point. Feeds into Scene 3.*

Someone files a GitHub Issue or a teammate creates a Linear issue.

**What happens:**
1. Orchestrator checks (External Issue Filed) → true
2. External issues land in **Inbox** (never auto-processed — untrusted input)
3. Human launches CEO agent: `bun run ceo <project>`
4. CEO reviews inbox: approves, rejects, or edits issues
5. Approved issues move: **Inbox** → **Triage**
6. Internal issues (from Linear sync with `autopilot:managed` label) go directly to **Triage**

**Feeds into Scene 3 — Director picks up triage items.**

---

## Reading Guide

**Happy path:** Scenes 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → (loop)

**Failure modes:** Each branch forks from the main line, handles the problem, and rejoins. The system never gets permanently stuck — every branch either resolves back to the main path or blocks the bead for human/CTO intervention.

**Key conditions that drive transitions:**

| Condition | Source | Triggers |
|-----------|--------|----------|
| KG Database Empty | gk (`get_stats`) | Scene 1: Principal Engineer + seed-kg |
| Backlog Below Threshold | Beads (count query) | Scene 2: CTO + planning-cycle |
| Project Has Triage Beads | Beads (project query) | Scene 3: Director + own-project |
| Ready Queue Has Items | Beads (`bd ready`) | Scene 5: Engineer + implement-bead |
| PR Needs Review | GitHub (new PR) | Scene 6: Staff Engineer + review-batch |
| PR Merged | GitHub (PR state) | Scene 7: bead → Done |
| Project All Tasks Done | Beads (project query) | Scene 8: Director + own-project (closure) |
| Batch Complete | Beads (batch query) | Scene 8: CTO + post-flight |
| PR CI Failed | GitHub (Checks API) | Branch B: Engineer + fix-pr |
| PR Review Feedback | GitHub (review comments) | Branch C: Engineer + respond-review |
| External Issue Filed | GitHub Issues / Linear sync | Branch E: route to Inbox |

**Communication patterns:**

| Pattern | Mechanism | Example |
|---------|-----------|---------|
| Parent → child | Task() subagent | CTO spawns Security + investigate |
| Peer coordination | TeamCreate() + SendMessage() | (Future: multi-engineer collaboration) |
| Cross-session | Orchestrator condition → new spawn | PR fails CI → new Engineer + fix-pr session |
| Escalation | Block bead + orchestrator detection | Engineer blocks → CTO spawned to resolve |
