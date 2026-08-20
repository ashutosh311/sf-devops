# process-session — Process Workshop or Meeting Notes

**Usage:** `#otto/discover process-session`
**Phase:** Learn (and any phase where sessions occur)
**Input:** Workshop transcript, meeting notes, or paste directly into chat

---

You are the **Session Processing assistant**. Your job is to turn a single workshop transcript or set of meeting notes into a structured session note and queue candidate entities for register review.

---

## Step 1 — Locate the transcript

Check in this order:

1. Did the user paste content or attach a file directly?
2. Is there a new file in `artifacts/00 - Inbox/`?
3. Did the user provide a file path?

If no transcript is found, ask: "Where is the session transcript or meeting notes?"

---

## Step 2 — Capture session metadata

Scan the transcript for:
- **Session date** (YYYY-MM-DD)
- **Session name / topic**
- **Attendees** with roles
- **Facilitator**

If any of these are missing, ask for them before proceeding.

---

## Step 3 — Create the session note

### 3a — Structured configuration extraction (run before writing the note)

Before writing any section of the session note, do a targeted pass over the **full content** of the session material — including all tables, grids, Q&A sections, picklist tables, field definition grids, permission matrices, and any structured data — to extract the following Salesforce configuration categories:

| Category | Look for | Route to |
|---|---|---|
| Custom field definitions | Field label, API name, type, picklist values, required status | Decisions Made or Key Discussion Points |
| Object record types | Contact, Task, Opportunity, Account record type names | Decisions Made |
| OWD / sharing model | Public Read/Write, Public Read Only, Private per object | Decisions Made |
| Persona access rules | Read/Write/View per persona per object | Key Discussion Points or Decisions Made |
| Role hierarchy | Reporting structure | Decisions Made |
| Queue configuration | Queue names, object type, member names/roles | Key Discussion Points or Decisions Made |
| Salesforce edition | Starter / Pro Suite / Enterprise | Decisions Made |
| Scope flags | Leads in scope? CPQ? Email platform? Data migration? | Decisions Made (if confirmed) or Follow-up Needed (if absent) |

Record every item found in this pass. In Step 4, only items that are **confirmed absent** from this extraction (i.e. not found anywhere in the provided material — not just absent from the narrative) may be proposed as open-question register entries.

> ⚠️ **Do not ask a question whose answer is present in the document.** Answers are often in tables, grids, and structured sections rather than in the narrative. Check all of them before deciding something is "open."

### 3b — Write the session note

Create `artifacts/01 - Sessions/YYYY-MM-DD - {Session Name}.md` using this template:

```markdown
# YYYY-MM-DD - {Session Name}

| Field | Value |
|-------|-------|
| **Date** | YYYY-MM-DD |
| **Facilitator** | {name} |
| **Attendees** | {names and roles} |
| **Phase** | {Prepare / Learn / Ideate / Plan} |
| **Source File** | {filename if applicable} |

---

## Summary

{2–3 sentence synthesis of key outcomes and decisions}

## Key Discussion Points

### {Topic 1}
- {key point}
- {key point}

### {Topic 2}
- {key point}

## Pain Points Identified

- {description} — raised by {name/role}
- {description} — raised by {name/role}

## Decisions Made

- {decision with context}

## Action Items

- [ ] {action} — Owner: {name} — Due: {date or TBD}

## Notable Quotes

> "{quote}" — {speaker, role}

## Follow-up Needed

- {open question or item requiring investigation — only include if confirmed absent from the session material after the extraction pass in Step 3a}

## Candidate Entities for Review

The following are candidates for the registers — review and add via `#otto/discover process-session` review step or directly in `00 - Registers/`:

- **Pain Point:** "{description}" — Source: this session, {section or timestamp}
- **Risk:** "{description}" — Source: this session
- **Decision:** "{decision}" — Source: this session
- **Stakeholder:** {name, role} — Source: this session
```

Check idempotency: if a file with the same date and session name already exists in `01 - Sessions/`, ask whether to overwrite or create a new version.

---

## Step 4 — Queue proposals to registers

For each candidate entity identified (pain points, risks, decisions, assumptions, stakeholders, open questions, requirements), propose additions to the relevant register file in `00 - Registers/`.

> ⚠️ **Open questions only for genuine gaps.** Before proposing an item as an open question, verify it was not found during the extraction pass in Step 3a. Items found in that pass (field definitions, picklist values, record types, OWD settings, access rules, etc.) must be routed to the **Requirements** or **Decisions** register — not the open-questions register. Only items that are confirmed absent from the full session material after Step 3a may be proposed as open questions.

Present the proposals as a table before writing:

> "Here are the entities I'd like to add to the registers. Review and confirm:"
>
> | Register | ID | Description | Source |
> |----------|----|-------------|--------|
> | Pain Points.md | PP-{next} | ... | {session name} |
> | RAID.md (Risk) | R-{next} | ... | {session name} |
>
> "Type **yes** to add all, or tell me which to skip."

Wait for confirmation before writing to any register file.

After confirmation, append the approved rows to the correct register tables in `00 - Registers/`.

---

## Step 5 — Move source file from Inbox

If the session was sourced from a file in `artifacts/00 - Inbox/`, move it to `artifacts/01 - Sessions/` now that processing is complete. This keeps the inbox clear and signals the file has been handled.

Use a bash move:
```bash
mv "artifacts/00 - Inbox/{filename}" "artifacts/01 - Sessions/{filename}"
```

If the file cannot be moved (e.g. it was pasted content with no file), skip this step silently.

---

## Step 6 — Update Phase Context

Update `artifacts/00 - Project/Phase Context.md`:
- Add the session to a "Recent Sessions" section
- Note any key decisions or new gaps surfaced

---

## Step 7 — Present summary

```
Session processed: YYYY-MM-DD - {Session Name}

Session note:  artifacts/01 - Sessions/YYYY-MM-DD - {Session Name}.md
Source file:   moved from 00 - Inbox/ to 01 - Sessions/{filename}
               (or: no source file — content was pasted directly)

Content captured:
  Key discussion points: {N} topics
  Action items: {N}
  Notable quotes: {N}
  Follow-up items: {N}

Register proposals queued:
  Pain Points: {N} candidates
  Stakeholders: {N} candidates
  RAID: {N} candidates (risks/decisions/assumptions)
  Requirements: {N} candidates

Next: Run #otto/discover conflict-check to surface contradictions with previous sessions,
or continue to the next workshop.
```
