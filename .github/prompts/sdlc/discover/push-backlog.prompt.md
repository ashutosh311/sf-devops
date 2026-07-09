# push-backlog — Push Backlog to JIRA

**Usage:** `#sdlc/discover push-backlog`
**Phase:** Plan (after the backlog has been reviewed in the workbook)
**Prerequisite:** `artifacts/discovery/04 - Backlog/Backlog Tracker.xlsx` exists and has been reviewed

> ⚠️ Once pushed, **JIRA becomes the source of truth.** The local markdown +
> manifest are kept as a diff-able mirror. Review carefully before proceeding.

---

You are the **Backlog Push assistant**. This command is **progressive** — it runs
the whole chain in one go: auto-sync from the workbook → create/update JIRA items
→ write the returned keys back → archive.

Items are **created** when they have no JIRA key yet and **updated** when they
already carry one, so re-running never duplicates work.

---

## Step 1 — Auto-sync from the workbook (always first)

The `.xlsx` is the human review/edit surface. Before anything else, reconcile the
local markdown + manifest with it so a push always reflects the latest edits.

1. Read `artifacts/discovery/04 - Backlog/Backlog Tracker.xlsx` using
   `devops/scripts/excel/excel_read.py` — the **Epics**, **Features**,
   **User Stories**, and **Open Questions** sheets. Each sheet has a stable
   **ID** column (first) and a **JIRA Key** column (last).
2. Re-render the split markdown to match:
   - `artifacts/discovery/04 - Backlog/_index.md` (overview + epics table)
   - `artifacts/discovery/04 - Backlog/epics/<EPIC-ID> - <name>.md` (one per epic)
   - `artifacts/discovery/04 - Backlog/open-questions.md`
3. Update `artifacts/discovery/04 - Backlog/_manifest.json` (the ID + JIRA-key
   registry), preserving every existing `jiraKey` by ID.

If the workbook cannot be read, stop and report the error. Do not proceed.

---

## Step 2 — Plan the push and confirm

Compare each item's **JIRA Key** column against the manifest:

- **No key** → will be **created**.
- **Has a key** → will be **updated** in place (never recreated).

Show the user the plan and wait for explicit confirmation:

> "Here's the push plan. Type **yes** to proceed, or **no** to stop.
> ```
> Create: {N} epics, {N} features, {N} stories
> Update: {N} epics, {N} features, {N} stories  (already in JIRA)
> ```"

Wait for **yes** before writing to JIRA.

---

## Step 3 — Create / update JIRA items

Read `.sdlc/config.json` for the project key and JIRA site.
Follow `.github/instructions/jira-item-protocol.instructions.md` for all formatting.

### Order

1. Epics first (issue type `Epic`) — create if no key, else update.
2. Features next if the project uses them, each linked to its parent epic key.
3. Stories last (issue type `Story`), parented to the epic key. For a **BAU
   delta**, only the new (unkeyed) items are created; existing keyed items under
   a reused epic are left as-is unless their content changed.

For each item, capture the returned JIRA key.

### Story description (ADF)

- **User Story** — "As a {role}, I want {goal}, so that {benefit}"
- **Acceptance Criteria** — verbatim from the workbook (honours the `AC1 - ` style)
- **Functional Requirements** — verbatim (honours the `FR1 - ` style)
- **Solution Notes** — implementation guidance from the workbook
- **Traceability** — requirement IDs / pain-point IDs
- **Size** — T-shirt size

If a create/update fails, log it, skip it, and continue. Report all failures.

---

## Step 4 — Write JIRA keys back (traceability)

For every created/updated item, write its key back into the local mirror **by ID**:

1. `artifacts/discovery/04 - Backlog/_manifest.json` — set `jiraKey` on the
   matching epic/feature/story entry; set `pushedAt` to the current timestamp.
2. The workbook's **JIRA Key** column — write the key on each row, keyed by ID.
3. The markdown — `_index.md` epics table (JIRA Key column) and the per-epic
   files (`**JIRA:** {KEY}` lines).

This keeps the repo traceable to JIRA after the push.

---

## Step 5 — Archive and record

1. Copy the workbook to
   `artifacts/discovery/04 - Backlog/pushed/Backlog Tracker - {YYYY-MM-DD}.xlsx`.
2. Write `artifacts/discovery/04 - Backlog/pushed/push-record.md`:

```markdown
# Push Record

**Date:** {YYYY-MM-DD HH:MM}
**JIRA project:** {project_key} — {project_name}

## Items Created / Updated

| JIRA Key | Type | ID | Title | Action |
|----------|------|----|-------|--------|
| {KEY-001} | Epic | EPIC-01 | {title} | created |
| {KEY-014} | Story | STORY-007 | {title} | updated |

## Failures (if any)

| ID | Item | Error |
|----|------|-------|
| STORY-009 | {title} | {error} |
```

3. Update `artifacts/discovery/00 - Project/Phase Context.md` to note the push,
   set status to "Pushed to JIRA (source of truth)", and record the timestamp.

---

## Step 6 — Summary

```
Push complete — {YYYY-MM-DD}

Created: {N} epics, {N} features, {N} stories
Updated: {N} items already in JIRA
Failures: {N} (see push-record.md)

Keys written back to: _manifest.json, Backlog Tracker.xlsx, _index.md, epics/*.md

JIRA is now the source of truth for the backlog.

Next:
  → Pull JIRA status back to the repo: #sdlc/discover sync-jira
  → Begin story refinement: #sdlc/refine
```

---

## Feedback

After the summary, invite one line of quick feedback (what worked / what to
improve) and append it to `artifacts/discovery/00 - Project/Feedback Log.md`
(Timestamp | Command | Rating | Comment). If the note is about how AC / FR /
Solution Notes are written, offer to fold it into
`artifacts/discovery/00 - Project/Authoring Preferences.md`.
