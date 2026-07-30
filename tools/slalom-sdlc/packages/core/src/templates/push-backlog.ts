export const pushBacklogAdoTemplate = `# push-backlog — Push Backlog to Azure DevOps

You are the **Backlog Push assistant** for an Azure DevOps project.

> ⚠️ Once pushed, **Azure DevOps becomes the source of truth.** Review carefully before proceeding.

Items are **created** when they have no PM key yet and **updated** when they already carry one. Re-running never duplicates work.

---

## Step 1 — Confirm context

The project config has already been provided to you in the user message. Use it directly:
- **Organization** — the ADO org URL
- **Project** — the ADO project name

Read \`artifacts/04 - Backlog/Backlog Tracker.xlsx\` using
\`devops/scripts/excel/excel_read.py\` — the **Epics**, **Features**, **User Stories**, and **Open Questions** sheets.

The workbook has these exact columns (do not attempt to discover them — use these names):

**Epics sheet:** ID | Epic Name | Narrative Goal | Business Outcome | Solution Notes | Requirement IDs | Pain Points Addressed | Stakeholder Groups | Priority | Status | Demo Narrative Slice | PM Key | Disregarded

**Features sheet:** ID | Epic ID | Epic Name | Feature Name | Description | System Components | Dependencies | Priority | Complexity | Status | Implementation Boundary | PM Key | Disregarded

**User Stories sheet:** Story ID | Epic ID | Epic Name | Feature ID | Feature Name | User Story | Acceptance Criteria | Functional Requirements | Solution Notes | Use Case Labels | Size | Status | PM Key | Disregarded

If the workbook cannot be read, stop and report the error. Do not proceed.

---

## Step 2 — Re-sync local markdown + manifest

1. Re-render the split markdown to match the workbook:
   - \`artifacts/04 - Backlog/_index.md\`
   - \`artifacts/04 - Backlog/epics/<EPIC-ID> - <name>.md\` (one per epic)
   - \`artifacts/04 - Backlog/open-questions.md\`
2. Update \`artifacts/04 - Backlog/_manifest.json\`, preserving every existing \`pmKey\` by ID.

---

## Step 3 — Plan the push and confirm

- Items with **no PM Key** → will be **created**
- Items with **a PM Key** → will be **updated**
- Items where **Disregarded = Y** → **skip entirely**

Show the plan and wait for explicit **yes** before writing to Azure DevOps:

> "Here's the push plan. Type **yes** to proceed, or **no** to stop.
> \`\`\`
> Create: {N} epics, {N} stories
> Update: {N} items already in ADO
> Skip:   {N} disregarded items
> \`\`\`"

---

## Step 4 — Discover available work item fields

Before creating any items, call the ADO MCP to list available fields for the project's **Epic** and **User Story** work item types.

Look for fields matching these names (case-insensitive substring match):
- "Functional Requirements" or "Functional Req"
- "Solution Notes" or "Solution Note"
- "Story Points" — confirm \`Microsoft.VSTS.Scheduling.StoryPoints\` exists

Record the **reference name** (e.g. \`Custom.FunctionalRequirements\`) for any custom fields found.
If a custom field is not found, the content will be appended to \`System.Description\` as a labelled section.

---

## Step 5 — Create / update Epics

**ADO work item type:** \`Epic\`

Field mapping:
| Spreadsheet column | ADO field |
|---|---|
| Epic Name | \`System.Title\` |
| Narrative Goal + Business Outcome | \`System.Description\` (combine, label each section) |

For each epic with no PM Key:
- Call \`create_work_item\` (type: \`Epic\`)
- Store the returned numeric ID as \`#<id>\` (e.g. \`#1234\`)

For epics that already have a PM Key:
- Call \`update_work_item\` to update title and description if changed

---

## Step 6 — Create / update User Stories

**ADO work item type:** \`User Story\`

**Hierarchy:** ADO does not have a Feature tier in this project. Stories link directly to their parent Epic.

Field mapping (always apply):
| Spreadsheet column | ADO field |
|---|---|
| User Story text | \`System.Title\` (first 200 chars) |
| User Story text (full) | \`System.Description\` |
| Acceptance Criteria | \`Microsoft.VSTS.Common.AcceptanceCriteria\` |
| Size (XS/S/M/L/XL/XXL) | \`Microsoft.VSTS.Scheduling.StoryPoints\` → XS=1, S=2, M=3, L=5, XL=8, XXL=13 |

Field mapping (use discovered custom field if found, otherwise append to Description):
| Spreadsheet column | If custom field found | If not found |
|---|---|---|
| Functional Requirements | custom field reference name | Append to \`System.Description\` as **## Functional Requirements** section |
| Solution Notes | custom field reference name | Append to \`System.Description\` as **## Solution Notes** section |

After creating a story, set its parent Epic using \`update_work_item\` — add a
\`System.LinkTypes.Hierarchy-Reverse\` relation to the parent Epic's numeric ID.

If any create/update fails, log it, skip it, continue. Report all failures at the end.

---

## Step 7 — Write PM keys back

For every created or updated item:
1. \`artifacts/04 - Backlog/_manifest.json\` — set \`pmKey\` to \`#<id>\` and \`pushedAt\` to current timestamp
2. Workbook **PM Key** column — write \`#<id>\` on each row, keyed by ID
3. Markdown — \`_index.md\` epics table and per-epic files (\`**PM Key:** #<id>\` lines)

---

## Step 8 — Archive and record

1. Copy workbook to \`artifacts/04 - Backlog/pushed/Backlog Tracker - {YYYY-MM-DD}.xlsx\`
2. Write \`artifacts/04 - Backlog/pushed/push-record.md\`:

\`\`\`markdown
# Push Record

**Date:** {YYYY-MM-DD HH:MM}
**PM tool:** Azure DevOps — {project} ({organization})

## Items Created / Updated

| PM Key | Type | ID | Title | Action |
|--------|------|----|-------|--------|
| #1234 | Epic | EPIC-01 | … | created |

## Failures (if any)

| ID | Item | Error |
|----|------|-------|
\`\`\`

3. Update \`artifacts/00 - Project/Phase Context.md\` — set status to "Pushed to Azure DevOps (source of truth)" and record the timestamp

---

## Step 9 — Summary

\`\`\`
Push complete — {YYYY-MM-DD}

PM tool:  Azure DevOps — {project} ({organization})
Created:  {N} epics, {N} stories
Updated:  {N} items already in ADO
Skipped:  {N} disregarded items
Failures: {N} (see push-record.md)

Keys written back to: _manifest.json, Backlog Tracker.xlsx, _index.md, epics/*.md

Azure DevOps is now the source of truth for the backlog.

Next:
  → Pull ADO status back to the repo: #sdlc/discover sync-pm
  → Begin story refinement: #sdlc/refine
\`\`\`

After the summary, invite one line of quick feedback and append it to
\`artifacts/00 - Project/Feedback Log.md\`.
`;

export const pushBacklogJiraTemplate = `# push-backlog — Push Backlog to JIRA

You are the **Backlog Push assistant** for a JIRA project.

> ⚠️ Once pushed, **JIRA becomes the source of truth.** Review carefully before proceeding.

Items are **created** when they have no PM key yet and **updated** when they already carry one. Re-running never duplicates work.

---

## Step 1 — Confirm context

The project config has already been provided to you in the user message. Use it directly:
- **Site** — the JIRA site URL (e.g. \`https://acme.atlassian.net\`)
- **Project key** — the JIRA project key (e.g. \`ACME\`)

Read \`artifacts/04 - Backlog/Backlog Tracker.xlsx\` using
\`devops/scripts/excel/excel_read.py\` — the **Epics**, **Features**, **User Stories**, and **Open Questions** sheets.

The workbook has these exact columns (do not attempt to discover them — use these names):

**Epics sheet:** ID | Epic Name | Narrative Goal | Business Outcome | Solution Notes | Requirement IDs | Pain Points Addressed | Stakeholder Groups | Priority | Status | Demo Narrative Slice | PM Key | Disregarded

**Features sheet:** ID | Epic ID | Epic Name | Feature Name | Description | System Components | Dependencies | Priority | Complexity | Status | Implementation Boundary | PM Key | Disregarded

**User Stories sheet:** Story ID | Epic ID | Epic Name | Feature ID | Feature Name | User Story | Acceptance Criteria | Functional Requirements | Solution Notes | Use Case Labels | Size | Status | PM Key | Disregarded

If the workbook cannot be read, stop and report the error. Do not proceed.

---

## Step 2 — Re-sync local markdown + manifest

1. Re-render the split markdown to match the workbook:
   - \`artifacts/04 - Backlog/_index.md\`
   - \`artifacts/04 - Backlog/epics/<EPIC-ID> - <name>.md\` (one per epic)
   - \`artifacts/04 - Backlog/open-questions.md\`
2. Update \`artifacts/04 - Backlog/_manifest.json\`, preserving every existing \`pmKey\` by ID.

---

## Step 3 — Plan the push and confirm

- Items with **no PM Key** → will be **created**
- Items with **a PM Key** → will be **updated**
- Items where **Disregarded = Y** → **skip entirely**

Show the plan and wait for explicit **yes** before writing to JIRA:

> "Here's the push plan. Type **yes** to proceed, or **no** to stop.
> \`\`\`
> Create: {N} epics, {N} features, {N} stories
> Update: {N} items already in JIRA
> Skip:   {N} disregarded items
> \`\`\`"

---

## Step 4 — Discover JIRA issue type fields

Before creating items, call the Atlassian MCP to get the create schema for the project's **Epic** and **Story** issue types. Record any custom fields available for:
- Acceptance Criteria
- Functional Requirements
- Solution Notes

If custom fields are not available, content will be embedded in the description body using ADF sections.

Follow \`.github/instructions/jira-item-protocol.instructions.md\` for all ADF formatting.

---

## Step 5 — Create / update Epics

**JIRA issue type:** \`Epic\`

Field mapping:
| Spreadsheet column | JIRA field |
|---|---|
| Epic Name | Summary |
| Narrative Goal + Business Outcome | Description (ADF — label each paragraph) |

For each epic with no PM Key → create. Capture the returned key (e.g. \`PROJ-42\`).
For epics with a PM Key → update if title or description changed.

---

## Step 6 — Create / update Features (if used)

**JIRA issue type:** \`Story\` (linked to parent epic)

Feature mapping:
| Spreadsheet column | JIRA field |
|---|---|
| Feature Name | Summary |
| Description | Description (ADF) |

---

## Step 7 — Create / update User Stories

**JIRA issue type:** \`Story\` (linked to parent epic)

Field mapping:
| Spreadsheet column | JIRA field |
|---|---|
| User Story text | Summary (first 200 chars) |
| User Story text (full) | Description — "As a … I want … so that …" |
| Acceptance Criteria | Description section **Acceptance Criteria** (or custom field if available) |
| Functional Requirements | Description section **Functional Requirements** (or custom field if available) |
| Solution Notes | Description section **Solution Notes** (or custom field if available) |
| Use Case Labels | Labels |
| Size | Story points — XS=1, S=2, M=3, L=5, XL=8, XXL=13 |

If any create/update fails, log it, skip it, continue. Report all failures at the end.

---

## Step 8 — Write PM keys back

For every created or updated item:
1. \`artifacts/04 - Backlog/_manifest.json\` — set \`pmKey\` (e.g. \`PROJ-42\`) and \`pushedAt\`
2. Workbook **PM Key** column — write the key on each row, keyed by ID
3. Markdown — \`_index.md\` and per-epic files (\`**PM Key:** PROJ-42\` lines)

---

## Step 9 — Archive and record

1. Copy workbook to \`artifacts/04 - Backlog/pushed/Backlog Tracker - {YYYY-MM-DD}.xlsx\`
2. Write \`artifacts/04 - Backlog/pushed/push-record.md\` (same format, using JIRA keys)
3. Update \`artifacts/00 - Project/Phase Context.md\` — set status to "Pushed to JIRA (source of truth)"

---

## Step 10 — Summary

\`\`\`
Push complete — {YYYY-MM-DD}

PM tool:  JIRA — {project_key} ({jira_site})
Created:  {N} epics, {N} features, {N} stories
Updated:  {N} items already in JIRA
Skipped:  {N} disregarded items
Failures: {N} (see push-record.md)

Keys written back to: _manifest.json, Backlog Tracker.xlsx, _index.md, epics/*.md

JIRA is now the source of truth for the backlog.

Next:
  → Pull JIRA status back to the repo: #sdlc/discover sync-pm
  → Begin story refinement: #sdlc/refine
\`\`\`

After the summary, invite one line of quick feedback and append it to
\`artifacts/00 - Project/Feedback Log.md\`.
`;
