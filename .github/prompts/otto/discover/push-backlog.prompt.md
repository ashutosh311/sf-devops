# push-backlog — Push Backlog to PM Tool

**Usage:** `#otto/discover push-backlog`
**Phase:** Plan (after the backlog has been reviewed in the workbook)
**Prerequisite:** `artifacts/04 - Backlog/Backlog Tracker.xlsx` exists and has been reviewed

> ⚠️ Once pushed, **the PM tool becomes the source of truth.** The local markdown +
> manifest are kept as a diff-able mirror. Review carefully before proceeding.

---

You are the **Backlog Push assistant**. This command is **progressive** — it runs
the whole chain in one go: auto-sync from the workbook → create/update PM tool items
→ write the returned keys back → archive.

Items are **created** when they have no PM key yet and **updated** when they
already carry one, so re-running never duplicates work.

---

## Step 0 — Determine PM tool

Read `.sdlc/config.json`. Check `alm.tool`:
- If `alm.tool = "ADO"` → follow **Section A (Azure DevOps)** below.
- Otherwise (JIRA or absent) → follow **Section B (JIRA)** below.

---

## Step 1 — Auto-sync from the workbook (always first)

The `.xlsx` is the human review/edit surface. Before anything else, reconcile the
local markdown + manifest with it so a push always reflects the latest edits.

1. Read `artifacts/04 - Backlog/Backlog Tracker.xlsx` using
   `devops/scripts/excel/excel_read.py` — the **Epics**, **Features**,
   **User Stories**, and **Open Questions** sheets. Each sheet has a stable
   **ID** column (first) and a **PM Key** column (last before Disregarded).
2. Re-render the split markdown to match:
   - `artifacts/04 - Backlog/_index.md` (overview + epics table)
   - `artifacts/04 - Backlog/epics/<EPIC-ID> - <name>.md` (one per epic)
   - `artifacts/04 - Backlog/open-questions.md`
3. Update `artifacts/04 - Backlog/_manifest.json` (the ID + PM-key
   registry), preserving every existing `pmKey` by ID.

If the workbook cannot be read, stop and report the error. Do not proceed.

---

## Step 2 — Plan the push and confirm

Compare each item's **PM Key** column against the manifest:

- **No key** → will be **created**.
- **Has a key** → will be **updated** in place (never recreated).

Exclude items where `Disregarded = Y`.

Show the user the plan and wait for explicit confirmation:

> "Here's the push plan. Type **yes** to proceed, or **no** to stop.
> ```
> Create: {N} epics, {N} features, {N} stories
> Update: {N} items already in PM tool
> Skip:   {N} disregarded items
> ```"

Wait for **yes** before writing to the PM tool.

---

## Section A — Azure DevOps push

_Follow this section when `alm.tool = "ADO"`._

Read from `.sdlc/config.json`:
- `alm.organization` — ADO org URL (e.g. `https://dev.azure.com/your-org`)
- `alm.project` — ADO project name

**Hierarchy used:** Epic → User Story only (no Feature tier in ADO for this project).
Features in the workbook are grouped under their parent epic — their stories are
linked directly to the Epic work item.

### A1 — Create / update Epics

For each workbook Epic with no PM key:
- Call `create_work_item` with work item type `Epic`.
- Fields:
  - `System.Title` = epic name
  - `System.Description` = narrative goal + business outcome
- Capture the returned numeric ID; store as `#<id>` (e.g. `#1234`).

For epics that already have a PM key (`#<id>`):
- Call `update_work_item` to update title and description if changed.

### A2 — Create / update User Stories

For each workbook Story with no PM key:
- Call `create_work_item` with work item type `User Story`.
- Fields:
  - `System.Title` = user story text (first 200 chars if longer)
  - `System.Description` = functional requirements (FR1, FR2, …)
  - `Microsoft.VSTS.Common.AcceptanceCriteria` = acceptance criteria (AC1, AC2, …)
  - `Microsoft.VSTS.Scheduling.StoryPoints` = size mapped: XS→1, S→2, M→3, L→5, XL→8
  - `System.AreaPath` = `alm.project` (default area)
- After creation, set parent relation to the Epic work item ID using `update_work_item`
  (add a `System.LinkTypes.Hierarchy-Reverse` relation to the parent Epic's ID).
- Capture the returned numeric ID; store as `#<id>`.

For stories that already have a PM key:
- Call `update_work_item` to update fields if changed.

If a create/update fails, log it, skip it, and continue. Report all failures.

### A3 — Write PM keys back

For every created/updated item, write its `#<id>` key back:

1. `artifacts/04 - Backlog/_manifest.json` — set `pmKey` on the
   matching entry; set `pushedAt` to the current timestamp.
2. The workbook's **PM Key** column — write `#<id>` on each row, keyed by ID.
3. The markdown — `_index.md` epics table (PM Key column) and the per-epic
   files (`**PM Key:** #<id>` lines).

### A4 — Archive and record

1. Copy the workbook to
   `artifacts/04 - Backlog/pushed/Backlog Tracker - {YYYY-MM-DD}.xlsx`.
2. Write `artifacts/04 - Backlog/pushed/push-record.md`:

```markdown
# Push Record

**Date:** {YYYY-MM-DD HH:MM}
**PM tool:** Azure DevOps — {alm.project} ({alm.organization})

## Items Created / Updated

| PM Key  | Type  | ID       | Title | Action  |
|---------|-------|----------|-------|---------|
| #1234   | Epic  | EPIC-01  | …     | created |
| #1235   | Story | STORY-007| …     | updated |

## Failures (if any)

| ID | Item | Error |
|----|------|-------|
```

3. Update `artifacts/00 - Project/Phase Context.md` to note the push,
   set status to "Pushed to Azure DevOps (source of truth)", and record the timestamp.

---

## Section B — JIRA push

_Follow this section when `alm.tool = "JIRA"` or when `alm` is absent._

Read from `.sdlc/config.json`:
- `alm.site` or `project.jiraSite` — JIRA site URL
- `alm.projectKey` or `project.jiraKey` — JIRA project key

Follow `.github/instructions/jira-item-protocol.instructions.md` for all formatting.

### B1 — Order

1. Epics first (issue type `Epic`) — create if no key, else update.
2. Features next if the project uses them, each linked to its parent epic key.
3. Stories last (issue type `Story`), parented to the epic key.

For each item, capture the returned JIRA key (e.g. `PROJ-42`).

### B2 — Story description (ADF)

- **User Story** — "As a {role}, I want {goal}, so that {benefit}"
- **Acceptance Criteria** — verbatim from the workbook
- **Functional Requirements** — verbatim from the workbook
- **Solution Notes** — implementation guidance from the workbook
- **Traceability** — requirement IDs / pain-point IDs
- **Size** — T-shirt size

### B3 — Write PM keys back

For every created/updated item, write its key (e.g. `PROJ-42`) back:

1. `artifacts/04 - Backlog/_manifest.json` — set `pmKey`; set `pushedAt`.
2. The workbook's **PM Key** column — write the key on each row, keyed by ID.
3. The markdown — `_index.md` epics table and per-epic files (`**PM Key:** PROJ-42`).

### B4 — Archive and record

1. Copy workbook to `artifacts/04 - Backlog/pushed/Backlog Tracker - {YYYY-MM-DD}.xlsx`.
2. Write `push-record.md` (same format as Section A4, using JIRA keys like `PROJ-42`).
3. Update `Phase Context.md` to note push and set status to "Pushed to JIRA (source of truth)".

---

## Step 6 — Summary

```
Push complete — {YYYY-MM-DD}

PM tool:  {ADO — <project> | JIRA — <project-key>}
Created:  {N} epics, {N} features/stories
Updated:  {N} items already in PM tool
Skipped:  {N} disregarded items
Failures: {N} (see push-record.md)

Keys written back to: _manifest.json, Backlog Tracker.xlsx, _index.md, epics/*.md

The PM tool is now the source of truth for the backlog.

Next:
  → Pull PM status back to the repo: #otto/discover sync-pm
  → Begin story refinement: #otto/refine
```

---

## Feedback

After the summary, invite one line of quick feedback and append it to
`artifacts/00 - Project/Feedback Log.md`.
