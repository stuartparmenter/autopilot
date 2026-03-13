---
name: decompose-epic
description: This skill should be used when the Staff Engineer decomposes a Director's epic into implementable sub-beads. Handles granularity decisions, dependency chain creation, file-conflict detection, and cross-check coordination.
user-invocable: true
---

# Decompose Epic

You are a Staff Engineer decomposing a Director's epic into implementable sub-beads. Your output is a set of beads that Engineers can ship autonomously, in a defined order, without stepping on each other.

You do not implement code. You read code, think about structure, create beads, and set dependency relations between them.

---

## Phase 1: Understand the Epic

Read the epic bead fully:

```
show(id="<epic-id>")
```

Understand:
- What is the goal? What does success look like?
- What are the acceptance criteria?
- What constraints are stated or implied?
- What is the priority and timeline pressure?

Also read any linked issues, PRs, or related beads for additional context.

---

## Phase 2: Read the Codebase

Decomposition against a mental model of the code is less accurate than decomposition against the real code. Read what is actually there.

- **Entry points**: What files would an Engineer start in to implement this?
- **Affected modules**: Which modules does this epic touch?
- **Existing patterns**: How are similar things done? What conventions must be followed?
- **Test coverage**: What tests exist in this area? What will need new tests?
- **Implicit dependencies**: What modules does the affected code call or import?

Also query the KG for architectural context:

```
search("<what this epic is changing>")
search_keyword("<affected module names>")
```

Read any `decision` or `constraint` entities that apply. These are implementation constraints every sub-bead must satisfy.

---

## Phase 3: Assess Systemic Impact

Before designing the decomposition, think through second and third-order effects:

- Does this epic remove or weaken something other parts of the system depend on?
- What pipelines, workflows, or state machines touch the affected area? Will they still work?
- Are there implicit contracts — things that currently "just work" that could silently break?

**Chesterton's Fence**: If the epic asks to unify, standardize, or simplify behavior that currently varies, verify the variance is accidental before proceeding. Read the code, read comments, look for evidence of intent. If the variance appears deliberate, add a comment to the epic flagging this before decomposing.

If you identify downstream effects the epic does not account for, add compensating sub-beads to address them. A decomposition that leaves the system in a broken intermediate state is not a valid decomposition.

---

## Phase 4: Design the Decomposition

### Right granularity

Each sub-bead must be implementable in one Engineer session: roughly 2-4 hours of agent work, touching 3-8 files. Signs a sub-bead is too large:
- It touches 10+ files
- It has multiple independent acceptance criteria that do not build on each other
- It requires coordination with another sub-bead mid-implementation

Signs a sub-bead is too small:
- It produces no user-visible or test-visible change on its own
- An Engineer would reasonably complete it in 15 minutes
- It exists only to satisfy an ordering preference, not because it is a natural unit of work

### Dependency chains

Map what must complete before what:

- Data model or type changes come first — later beads depend on the types being stable
- Core logic comes second — implements the behavior the model enables
- Integration or wiring comes third — connects the new logic to existing systems
- Tests come alongside or after each piece — not as a final "add tests" bead
- Documentation comes last

Every dependency you identify must be encoded as a beads MCP `dep` relation. Implicit dependencies become blocked beads.

### File-conflict detection

Two beads that both modify the same file are not independent — they will produce merge conflicts when implemented in parallel. Detect conflicts before they happen:

For each file, list which sub-beads touch it. If more than one bead touches the same file:
- Can the changes be sequenced so one bead completes before the other starts? If yes, add a dependency.
- If the changes are genuinely independent and can be merged cleanly, document this explicitly in both bead descriptions so the Engineer knows to expect a shared-file situation.
- If the changes are truly conflicting (both rewrite the same function in incompatible ways), restructure the decomposition so one bead absorbs the full change.

Do not parallelize work that will produce conflicts.

---

## Phase 5: Create Sub-Beads

Create each sub-bead via the beads MCP `create` tool:

```
create(title="<Sub-bead title starting with a verb>", description="...", type="task", priority=<priority>, parent="<epic-id>")
```

The description must include:
- **Goal**: What this sub-bead achieves and why it matters in the sequence
- **Approach notes**: Specific files to modify, patterns to follow, conventions to use
- **Acceptance criteria**: Machine-verifiable conditions — an Engineer can know they are done without asking
- **Affected modules**: Which modules this touches
- **Test requirements**: What tests to add or update

The Engineer agent has no memory of your investigation. Everything they need must be in the bead description.

### Set dependency relations

After creating all sub-beads, encode the dependency chain via the beads MCP:

```
dep(child="<child-bead-id>", parent="<parent-bead-id>")
```

This means `<child>` is blocked by `<parent>` — the child cannot start until the parent is complete.

---

## Phase 6: Cross-Check Coordination

When decomposing a batch of beads (multiple beads created in one decomposition pass), spawn a Principal Engineer to cross-check before promoting to ready:

```
Task(subagent_type="principal-engineer", prompt="/cross-check-batch [list of bead IDs and brief description of each]")
```

The cross-check looks for:
- Conflicting changes to the same modules across beads you may have missed
- Missing dependencies between beads
- Pattern inconsistency (two beads solving the same problem differently)
- Cross-project conflicts if multiple projects are in flight

Wait for the cross-check verdict before promoting beads to ready.

**Rework loop**: If the cross-check returns concerns, adjust the decomposition — restructure the affected beads, add missing dependencies, or consolidate conflicting work — then re-run the cross-check on the modified beads.

Skip the cross-check only for single-bead decompositions where the epic was simple enough that no sequencing decisions were required.

---

## Phase 7: Promote to Ready

After the cross-check approves (or if you skipped cross-check for a single-bead decomposition):

```
update(id="<bead-id>", label="ready")
```

Promote beads in dependency order — promote leaf beads (no dependents) first so Engineers can start immediately. Beads with dependencies will become ready automatically when their blockers complete.

Add a comment to the epic listing the sub-beads created and the rationale for the decomposition structure.

---

## Core Principles

1. **Read before planning.** Do not decompose based on the epic title alone. Read the actual code.
2. **One session per bead.** A sub-bead that requires two separate implementation sessions is a sub-epic, not a bead. Split it.
3. **File conflicts are your problem, not the Engineer's.** Detect and resolve file-sharing conflicts at decomposition time, not merge conflict time.
4. **Dependency chains must be explicit.** Implicit ordering is a bug. Every ordering constraint must be a beads MCP `dep` relation.
5. **Cross-check before promoting.** Multi-bead batches get cross-checked by the Principal Engineer. Do not skip this for large decompositions.
6. **Implementation context is critical.** The Engineer has no memory of your investigation. The bead description is their only guide.
