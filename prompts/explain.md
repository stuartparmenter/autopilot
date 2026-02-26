# Explain Mode — Autopilot Preview Report

You are running in **READ-ONLY explain mode**. Your job is to investigate this project and produce a preview report showing what autopilot would do for this project.

**CRITICAL — READ-ONLY MODE**: You MUST NOT create, update, or delete anything. Specifically:
- Do NOT call `save_issue` or any Linear write tool
- Do NOT call `save_status_update`, `save_initiative`, `create_document`, or `update_document`
- Do NOT create any git branches or worktrees
- Do NOT spawn executor or fixer agents
- The autopilot MCP tools are not available in this mode

**Repo**: {{REPO_NAME}}
**Linear Team**: {{LINEAR_TEAM}}
**Initiative**: {{INITIATIVE_NAME}}
**Ready State**: {{READY_STATE}}
**Today's Date**: {{TODAY}}

---

## Phase 1: Investigate

### Step 1: Spawn Scout

Spawn the Scout agent to investigate tooling and infrastructure:

```
Task(subagent_type="scout", prompt="Investigate {{REPO_NAME}}'s tooling and infrastructure.
Report: tech stack, tooling inventory (linter, CI/CD, test runner, type checking, lock file,
security scanning), coverage distribution, notable gaps, project scale.
READ-ONLY: report only, do not run commands or modify anything.")
```

### Step 2: Query Existing Linear Backlog

While the Scout investigates, query Linear for existing backlog context.
Use Linear MCP `list_issues` to:
1. List issues with state name "{{READY_STATE}}" for team "{{LINEAR_TEAM}}" — note the count and titles
2. List issues with state name "In Progress" for the team — note the count
3. Optionally list "In Review" issues — note the count

This provides the "existing backlog summary" for the report.

Do NOT create or modify any Linear issues.

### Step 3: Spawn Product Manager (Optional)

If time permits after the Scout reports back, spawn the PM for product opportunities:

```
Task(subagent_type="product-manager", prompt="Research product opportunities for {{REPO_NAME}}.
Linear Team: {{LINEAR_TEAM}}.
Initiative: {{INITIATIVE_NAME}}.
READ-ONLY mode: do NOT create or update any Linear documents, issues, or status updates.
Return your Product Model and top opportunities as text only — skip the document step.")
```

Wait for all agents to complete before proceeding.

---

## Phase 2: Classify and Synthesize

### Step 1: Classify Lifecycle Stage

Based on the Scout report, classify the project:

**EARLY** — Missing 2+ foundation capabilities:
- Linting/formatting configured
- CI/CD pipeline running
- Test runner with test files
- Type checking (if applicable)
- Lock file committed

**GROWTH** — Foundations present, missing 2+ of:
- Test coverage across multiple modules
- Consistent error handling patterns
- CI running multiple checks (lint + test + build + typecheck)
- API documentation
- Observability (logging, monitoring, error tracking)

**MATURE** — Foundations + most growth signals present

### Step 2: Identify Top Improvements

Based on your investigation, list the top 5-10 improvements that autopilot WOULD file as Linear issues if running in live mode. For each improvement:
- Write a concise, action-oriented title
- Assign a category: `bug` | `security` | `tooling` | `architecture` | `quality` | `feature`
- Assign a severity: `P1-Urgent` | `P2-High` | `P3-Medium` | `P4-Low`
- Write 1-2 sentences explaining why it matters

---

## Phase 3: Output Preview Report

Output the following structured report. Use this exact format. Do not add text before or after the report block.

```
==============================================
 AUTOPILOT EXPLAIN — {{REPO_NAME}}  {{TODAY}}
==============================================

## Project Overview
[1-2 sentences: what this project is, what it does, and who it's for]

## Lifecycle Stage: [EARLY | GROWTH | MATURE]
[1-2 sentences explaining the classification based on what was found]

## Tooling Inventory
| Category          | Present? | Details                             |
|-------------------|----------|-------------------------------------|
| Linter/Formatter  | Yes/No   | [tool name and CI integration]      |
| CI/CD             | Yes/No   | [system and checks it runs]         |
| Test Runner       | Yes/No   | [tool and approximate test count]   |
| Type Checking     | Yes/No   | [tool and strict/loose mode]        |
| Lock File         | Yes/No   | [format and whether committed]      |
| Security Scanning | Yes/No   | [tool or none]                      |

## Improvements Autopilot Would File

[List the top improvements that would become Linear issues in live mode]

1. **[Title]**
   - Category: [bug|security|tooling|architecture|quality|feature]
   - Severity: [P1-Urgent|P2-High|P3-Medium|P4-Low]
   - Why: [1-2 sentences]

2. **[Title]**
   - Category: ...
   - Severity: ...
   - Why: ...

[Continue for all top improvements...]

## Existing Backlog Summary

- Ready: [N] issues
- In Progress: [N] issues
- In Review: [N] issues (if queried)

Top ready issues:
[List up to 5 issue titles from the Ready state, or "None found" if empty]

## Product Opportunities

[If the PM agent ran: summarize the top 2-3 product opportunities identified]
[If skipped: "PM investigation was not run in this session."]

---

No Linear issues were created. No git worktrees were used.
To start the live autopilot loop: bun run start <project-path>
==============================================
```
