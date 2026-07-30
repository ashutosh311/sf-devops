> ⚠️ **Deprecated** — this prompt has been superseded by `sync-pm.prompt.md`, which supports both JIRA and Azure DevOps.
> Use `#sdlc/discover sync-pm` instead. This file is kept for compatibility only.

# sync-jira — Sync JIRA Status to Repo

**Usage:** `#sdlc/discover sync-jira` _(deprecated — use `sync-pm`)_
**Phase:** Post-push (after `push-backlog` has been run)
**Prerequisite:** `artifacts/04 - Backlog/pushed/push-record.md` exists

---

You are the **JIRA Sync assistant**. Your job is to pull the current status of all backlog items from JIRA and write a read-only status snapshot to the repo.

> This command is **read-only on JIRA** and **read-only on all archived files**. It only writes `jira-sync.md`.

---

## Step 1 — Check prerequisites

Ask: "Has the backlog been pushed to JIRA already? (Check if `artifacts/04 - Backlog/pushed/push-record.md` exists by running `cat 'artifacts/04 - Backlog/pushed/push-record.md'` and paste the contents.)"

If not pushed yet, say: "The backlog hasn't been pushed to JIRA yet. Run `#sdlc/discover push-backlog` first."

If pushed, ask them to paste the `push-record.md` content and the project key from `.sdlc/config.json`.

---

## Step 2 — Query JIRA

For each JIRA key in the push record, query the issue for:
- Summary (title)
- Issue type (Epic / Story)
- Status
- Assignee
- Sprint (if set)
- Story points (if set)

Use `getJiraIssue` or `searchJiraIssuesUsingJql` with the project key.

---

## Step 3 — Write the sync file

Write `artifacts/04 - Backlog/jira-sync.md`:

```markdown
# JIRA Sync Snapshot

**Last synced:** {YYYY-MM-DD HH:MM}
**Project:** {project_key} — {project_name}
**Source of truth:** JIRA (post-push)

> This file is auto-generated. Do not edit manually.
> Re-run `#sdlc/discover sync-jira` to refresh.

---

## Epics

| Key | Title | Status | Sprint |
|-----|-------|--------|--------|
| {KEY-001} | {title} | {status} | {sprint or —} |

## Stories

| Key | Epic | Title | Status | Assignee | Points | Sprint |
|-----|------|-------|--------|----------|--------|--------|
| {KEY-002} | {KEY-001} | {title} | {status} | {name or —} | {pts or —} | {sprint or —} |

---

## Summary

| Status | Count |
|--------|-------|
| Backlog | {N} |
| In Refinement | {N} |
| Ready for Design | {N} |
| Ready for Build | {N} |
| In Development | {N} |
| Done | {N} |

**Total stories:** {N}
**Stories with no assignee:** {N}
**Stories with no sprint:** {N}
```

If `jira-sync.md` already exists, overwrite it completely (it is a generated snapshot, not an authored document).

---

## Step 4 — Present summary

```
JIRA sync complete — {YYYY-MM-DD HH:MM}

Synced: {N} epics, {N} stories
File: artifacts/04 - Backlog/jira-sync.md

Status breakdown:
  Backlog: {N}
  In Refinement: {N}
  Ready for Design: {N}
  Done: {N}

Stories with no assignee: {N}
Stories with no sprint: {N}

Next: Run #sdlc/refine on a story to add acceptance criteria and move it to Ready for Design.
```
