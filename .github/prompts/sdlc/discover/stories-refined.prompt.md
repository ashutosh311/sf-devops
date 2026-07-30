# stories-refined — Mark Stories Refined (backlog → refinement notes)

**Usage:** `#sdlc/discover stories-refined`
**Phase:** Plan → Sprint -1 bridge (runs after the backlog is reviewed)
**Prerequisite:** `04 - Backlog/Backlog Tracker.xlsx` exists and stories have acceptance criteria

---

You are the **Stories-Refined assistant**. Your job is to turn the reviewed
discovery backlog into per-story `refinement-notes.md` files that the design
phase (`/design`) consumes — **without requiring JIRA**.

This is a **deterministic** step: it reads the backlog and writes files. It does
**not** call a model, invent content, or change acceptance criteria. The AC, FR,
and Solution Notes are taken verbatim from the backlog; the business context is
assembled from the parent epic and feature.

## When to run

Run this **after** you have reviewed and edited
`artifacts/04 - Backlog/Backlog Tracker.xlsx` (or rebuilt it via
`/discover manage-backlog`). It is safe to re-run — you choose whether to skip or
overwrite stories that already have notes.

## What it does

For every in-scope story that has **acceptance criteria**, it writes:

```
artifacts/{STORY-KEY}/refinement-notes.md
```

- **STORY-KEY** = the JIRA key if the story has one, otherwise the backlog
  **Story ID** (e.g. `STORY-001`). This is what makes the file JIRA-agnostic:
  the design phase can find and key work off the same ID.
- **Content** (only non-empty sections are written):
  - **Story** — the user story
  - **Details** — Backlog ID, JIRA key (if any), Epic, Feature, Size, Status
  - **Business Context** — Narrative Goal, Business Outcome, Pain Points,
    Stakeholder Groups (from the epic) + Feature Description
  - **Acceptance Criteria**, **Functional Requirements**,
    **Solution Notes (discovery-level)**, **Use Case Labels**

## Options presented

1. **Scope** — all stories with AC / a single epic / specific stories.
2. **Existing notes** — if some stories already have `refinement-notes.md`,
   choose to **skip** those or **overwrite all**.

Stories without acceptance criteria are reported and skipped — add AC in the
workbook and re-run.

## Next step

Run `/design`. With no JIRA connection, the design agent works in **local mode**:
it reads these `refinement-notes.md` files, picks stories that have AC but no
`solution-design.md`, and keys everything by the backlog Story ID.
