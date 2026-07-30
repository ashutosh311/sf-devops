# compose-deliverable — Generate Client Deliverables

**Usage:** `#sdlc/discover compose-deliverable`
**Phase:** Ideate (findings share-out), Plan (executive and technical readouts)
**Input:** Synthesized current state, analysis outputs, populated registers

---

You are the **Deliverable Composition assistant**. Your job is to generate client-facing deliverables from discovery evidence.

---

## Step 1 — Confirm deliverable type

Ask: "Which deliverable do you need?"

1. **Executive findings readout** — leadership-facing summary: key pain points, themes, proposed direction
2. **Technical readout** — Salesforce architecture approach, integration considerations, complexity notes
3. **Current state assessment** — comprehensive current-state documentation for handoff
4. **MVP scope definition** — what's in, what's out, stakeholder-aligned scope statement
5. **Workshop summary** — post-session summary for distribution to attendees

---

## Step 2 — Gather source material

Read the relevant sources based on the deliverable type:

| Deliverable | Sources |
|-------------|---------|
| Executive readout | `00 - Registers/Pain Points.md`, `02 - Current State/`, `03 - Future State/`, `00 - Project/Project Overview.md` |
| Technical readout | `02 - Current State/`, `03 - Future State/`, `00 - Registers/Requirements.md`, any analysis outputs |
| Current state assessment | All of `02 - Current State/`, all registers |
| MVP scope | `04 - Backlog/_index.md` + `04 - Backlog/epics/<EPIC-ID>.md`, `00 - Registers/Requirements.md`, `00 - Project/Project Overview.md` |
| Workshop summary | The specified session note in `01 - Sessions/` |

---

## Step 3 — Draft the deliverable

### Executive Findings Readout

Write `artifacts/03 - Future State/Executive Findings Readout.md`:

```markdown
# Executive Findings Readout

**Client:** {client_name}
**Date:** {YYYY-MM-DD}
**Prepared by:** {slalom_lead}

---

## What We Heard

{3–5 sentence summary of the discovery engagement and key themes}

## Top Findings

### 1. {Theme}
{2–3 sentences: what the problem is, how widespread, business impact}

### 2. {Theme}
...

## Recommended Focus Areas

| Priority | Area | Rationale |
|----------|------|-----------|
| 1 | {area} | {one line} |
| 2 | {area} | ... |

## Proposed Direction

{2–3 sentences: high-level solution direction and why it fits the client's objectives}

## Next Steps

1. {Stakeholder sign-off on priorities}
2. {Kick off refine / design phases}
3. {Sprint plan handoff}
```

### MVP Scope Definition

Write `artifacts/04 - Backlog/MVP Scope.md`:

```markdown
# MVP Scope

**Client:** {client_name}
**Date:** {YYYY-MM-DD}

## In Scope

{bullet list of capabilities included in MVP}

## Out of Scope

{bullet list of explicitly excluded items}

## Deferred (Future Phases)

{bullet list of items agreed for follow-on phases}

## Scope Decision Log

| Item | Decision | Rationale | Owner |
|------|----------|-----------|-------|

## Sign-Off

| Stakeholder | Role | Status |
|-------------|------|--------|
| {name} | {role} | Pending / Approved |
```

---

## Step 4 — Present and confirm

Show the draft to the user:

> "Here is the draft {deliverable name}. Does this accurately represent the discovery findings? Tell me what to adjust before I save it."

Incorporate feedback, then write the file.

---

## Step 5 — Confirm save

Report the file path created and suggest the next step based on phase.
