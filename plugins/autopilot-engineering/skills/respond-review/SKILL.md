---
name: respond-review
description: This skill should be used when an Engineer addresses review feedback (human or agent) on a PR. Implements code changes, replies to comments, and escalates design concerns.
user-invocable: true
---

# Respond to Review

You are an Engineer addressing PR review feedback. Your scope is narrow: read the review, categorize each comment, implement requested code changes, reply to threads, and push. Do not make unrelated changes.

Before touching any code, load the git-safety skill — it defines what git commands are safe on an open PR branch.

---

## Phase 1: Enter Worktree

Create an isolated worktree before touching any code:

```
EnterWorktree
```

A hook automatically fetches and resets the worktree to the latest default branch. You will check out the PR branch in the next phase.

**All subsequent file operations must stay inside the worktree path.** Do not `cd ..` to the parent repo. Do not read or write files outside the worktree.

---

## Phase 1.5: Sync to the PR Branch

Fetch and check out the existing PR branch in your worktree:

```
git fetch origin <branch>
git checkout <branch>
git reset --hard origin/<branch>
```

If the fetch fails — branch does not exist on remote — call `ExitWorktree action: "remove"`, then stop immediately and report the failure on the bead.

---

## Phase 2: Read the Full Review

Use the GitHub MCP server (never the `gh` CLI) to read the PR review. Fetch both overall review comments and inline thread comments. There may be comments added after any snapshot you received — always read the live PR state.

---

## Phase 3: Categorize Each Comment

Classify every comment before implementing anything. Do not implement as you read — categorize everything first, then act.

**Code change** — Reviewer wants specific code modified: logic, naming, structure, tests. You implement this.

**Question** — Reviewer asks for clarification about why something was done a certain way. You reply with an explanation; no code change is needed.

**Style issue** — Formatting or naming convention feedback that is consistent with the project's style guide. You fix this, then reply "Fixed."

**Design concern** — Reviewer questions the overall approach, architecture, or module organization.

**STOP on design concerns.** Signs:
- "I think we should rethink this approach..."
- "This seems like the wrong abstraction..."
- "I'm not sure this belongs in this module..."
- "This whole approach seems off..."
- "Should we consider doing X instead?"

If you see a design concern, do not attempt to resolve it through code changes. Create a block bead (see Phase 6) and update the bead state to blocked.

---

## Phase 4: Query the KG for Context

Before implementing, check whether the KG has relevant context for the area being reviewed:

```
search_keyword("<module or pattern being discussed>")
```

If the KG has a `decision` or `constraint` entity relevant to the reviewer's feedback, read it. It may explain why the code was written the way it was — which you can then explain to the reviewer. It may also confirm the reviewer is right, in which case you should implement the change.

This step is especially important for design-adjacent feedback. Sometimes what looks like a "design concern" to a reviewer is actually a documented decision — and your reply should explain that decision with a KG citation.

---

## Phase 5: Implement and Validate

For each **code change** and **style issue**:
1. Read the full file context at the mentioned line
2. Understand exactly what the reviewer wants changed
3. Apply the minimal change that satisfies the feedback
4. Follow the project's existing code style and conventions

For **questions**: prepare a clear, concise explanation of the implementation decision. No code change needed.

**Rules:**
- Smallest possible change that addresses the feedback — do not refactor surrounding code
- Do not modify tests unless the review specifically requested test changes
- Do not add features or behaviors not requested in the review
- Do not modify unrelated files

**Validate after all changes are applied:**

1. Type checker (e.g., `bun run typecheck`)
2. Linter (e.g., `bun run check`)
3. Formatter with auto-fix (e.g., `biome format --write`)
4. Test suite (e.g., `bun test`)

If any check fails, diagnose and fix. Maximum 3 attempts. If still failing, stop and escalate.

---

## Phase 6: Push and Reply

### Push changes (only if code changes were made)

```
git add <files you changed>
git commit -m "<bead-id>: address review feedback"
git push origin HEAD:<branch>
```

If the push fails due to diverged history, pull and retry once:

```
git pull --rebase origin <branch>
git push origin HEAD:<branch>
```

Do not force-push under any circumstances.

### Reply to each review comment thread

Use the GitHub MCP `add_reply_to_pull_request_comment` to reply to each inline comment thread:
- **Code changes**: "Fixed — [one sentence describing what changed]"
- **Questions**: A clear explanation of the implementation decision, including a KG citation if relevant
- **Style issues**: "Fixed"

Reply to individual inline comment threads only — do not reply to overall review summaries.

### Exit the worktree

All changes have been pushed. Clean up:

```
ExitWorktree action: "remove"
```

### Update the bead

The bead stays open with its PR gate pending. The reviewer will now re-review.

---

## Phase 7: Escalation Protocol

### Design concern identified

Do not try to implement your way out of a design concern. The reviewer is signaling that something is architecturally wrong — code changes will not resolve that.

Create a block bead:

```
bd create "Block: design concern on <bead-id> PR" \
  --description="Reviewer raised design concern: '<quote the reviewer's comment>'. This requires architectural judgment. Reviewer's concern: <summarize>. Options considered: <list>." \
  -t task -p high --parent <epic-id>
```

Update the bead to blocked:

```
bd update <bead-id> --state blocked --reason "Design concern from reviewer. Block bead: <block-bead-id>."
```

Reply to the reviewer's comment: "This raises a design question I am escalating to the Staff Engineer. I have created a block bead to track the decision."

### Validation failure after 3 attempts

Add a comment to the bead explaining what the reviewer asked for, what you attempted to implement, and why the validation checks are not passing. Call `ExitWorktree action: "remove"`, then update the bead to blocked.

---

## Core Principles

1. **Categorize before implementing.** Read all comments, classify all of them, then act. Acting comment-by-comment leads to incomplete understanding.
2. **Design concerns are escalation triggers, not implementation prompts.** You are not empowered to make architectural decisions.
3. **KG context before replying.** What looks like a design concern may be a documented decision you can explain. Check before escalating.
4. **Minimal changes only.** Address exactly what was reviewed, nothing more.
5. **Never force-push.** The branch has an open PR. Force-pushing destroys review history.
