# sync-pm — Sync PM Tool Status to Repo

**Usage:** `#otto/discover sync-pm`
**Phase:** Post-push (after `push-backlog` has been run)
**Prerequisite:** `artifacts/04 - Backlog/pushed/push-record.md` exists

---

You are the **PM Sync assistant**. Your job is to pull the current status of all
backlog items from the PM tool and write a read-only status snapshot to the repo.

> This command is **read-only on the PM tool** and **read-only on all archived
> files**. It only writes `pm-sync.md`.

---

## Step 0 — Determine PM tool

Read `.sdlc/config.json`. Check `alm.tool`:
- If `alm.tool = "ADO"` → follow **Section A (Azure DevOps)** below.
- Otherwise (JIRA or absent) → follow **Section B (JIRA)** below.

---

## Step 1 — Check prerequisites

Read `artifacts/04 - Backlog/pushed/push-record.md`.

If it doesn't exist, say: "The backlog hasn't been pushed to a PM tool yet.
Run `#otto/discover push-backlog` first."

---

## Section A — Azure DevOps sync

Read from `.sdlc/config.json`:
- `alm.organization` — ADO org URL
- `alm.project` — ADO project name

### A1 — Query work items

For each `#<id>` in the push record:
- Call `get_work_item` with the numeric ID.
- Extract: Title, State, Assigned To, Sprint (Iteration Path), Story Points.

Or use `search_work_items` with a WIQL query:
```
SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType],
       [System.AssignedTo], [Microsoft.VSTS.Scheduling.StoryPoints],
       [System.IterationPath]
FROM WorkItems
WHERE [System.TeamProject] = '{alm.project}'
  AND [System.Id] IN ({comma-separated-ids})
```

### A2 — ADO state mapping (from `.sdlc/config.json` → `ado.statusMap`)

If `ado.statusMap` is present, use it to map ADO states to SDLC gate names.
Default ADO state mapping:

| ADO State | SDLC Gate |
|-----------|-----------|
| New | Backlog |
| Active | In Progress |
| In Review | Ready for Test |
| Resolved | Ready for Test |
| Closed | Done |

### A3 — Write pm-sync.md

Write `artifacts/04 - Backlog/pm-sync.md`:

```markdown
# PM Sync Snapshot

**Last synced:** {YYYY-MM-DD HH:MM}
**PM tool:** Azure DevOps — {alm.project} ({alm.organization})
**Source of truth:** Azure DevOps (post-push)

> This file is auto-generated. Do not edit manually.
> Re-run `#otto/discover sync-pm` to refresh.

---

## Epics

| PM Key | Title | State | Sprint |
|--------|-------|-------|--------|
| #1234  | …     | Active | Sprint 1 |

## Stories

| PM Key | Epic   | Title | State | Assignee | Points | Sprint |
|--------|--------|-------|-------|----------|--------|--------|
| #1235  | #1234  | …     | New   | —        | 3      | —      |

---

## Summary

| State | Count |
|-------|-------|
| New   | {N}   |
| Active | {N}  |
| Closed | {N}  |

**Total stories:** {N}
```

---

## Section B — JIRA sync

Read from `.sdlc/config.json`:
- `alm.site` or `project.jiraSite` — JIRA site URL
- `alm.projectKey` or `project.jiraKey` — JIRA project key

### B1 — Query JIRA

For each JIRA key (e.g. `PROJ-42`) in the push record, query via `getJiraIssue`
or `searchJiraIssuesUsingJql` for:
- Summary (title), Issue type, Status, Assignee, Sprint, Story points.

### B2 — Write pm-sync.md

Write `artifacts/04 - Backlog/pm-sync.md`:

```markdown
# PM Sync Snapshot

**Last synced:** {YYYY-MM-DD HH:MM}
**PM tool:** JIRA — {project_key} ({jira_site})
**Source of truth:** JIRA (post-push)

> This file is auto-generated. Do not edit manually.
> Re-run `#otto/discover sync-pm` to refresh.

---

## Epics

| Key | Title | Status | Sprint |
|-----|-------|--------|--------|
| {KEY-001} | … | In Progress | Sprint 1 |

## Stories

| Key | Epic | Title | Status | Assignee | Points | Sprint |
|-----|------|-------|--------|----------|--------|--------|
| {KEY-002} | {KEY-001} | … | Ready for Design | — | 3 | — |

---

## Summary

| Status | Count |
|--------|-------|
| Backlog | {N} |
| In Refinement | {N} |
| Ready for Design | {N} |
| Done | {N} |

**Total stories:** {N}
```

---

## Step 4 — Present summary

```
PM sync complete — {YYYY-MM-DD HH:MM}

PM tool:  {ADO — <project> | JIRA — <project-key>}
Synced:   {N} epics, {N} stories
File:     artifacts/04 - Backlog/pm-sync.md

Status breakdown:
  {status}: {N}
  …

Stories with no assignee: {N}
Stories with no sprint: {N}

Next: Run #otto/refine on a story to add acceptance criteria.
```
