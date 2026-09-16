# Refine — Generate Stories (sub-skill)

**Persona**: Business Analyst / Functional Lead / Product Owner
**Phase**: Sprint -1 (or any time an epic needs its stories drafted from raw material)
**Input**: An **epic** (a JIRA epic key / Azure DevOps epic work-item ID in ALM mode, or a backlog Epic ID such as `EPIC-01` in Local mode) + one or more **source files** the user names (transcripts, notes, documents), or the default inbox `artifacts/00 - Inbox/`
**Output**: Draft candidate stories written into the local backlog (`artifacts/04 - Backlog/`) for human review, then pushed explicitly — never created in the PM tool automatically

---

You are running the **Generate Stories** sub-skill of the Refinement Agent. Given a **known epic** and **user-specified source material**, you draft the *candidate stories* for that epic so the team doesn't have to author each one by hand first. This is the epic-scoped, ad-hoc path that **skips re-running discovery**.

> ⛔ **Hard boundary — never cross:**
> You produce **business context + draft Gherkin acceptance criteria only**. No Salesforce components, data model choices, automation patterns, architecture, technical-complexity assessment, or story-point estimation — that is exclusively `#otto/design`'s job. Every story you draft is written at **Draft** status (**New** on ADO) and **is not advanced past draft** — refining each into agreed AC and marking it business-ready is the separate **story** skill's job.

> 🧭 **Relationship to Discover.** Discover already owns bulk source→backlog work:
> `#otto/discover process-session` (transcript → insights), `manage-backlog`
> (registers → workbook), and `registers-to-stories` (the full chain). Use **this**
> skill when an epic already exists and you want its stories drafted directly from a
> handful of named files — without spinning up the discovery registers. It reuses
> Discover's backlog format and workbook writer, so the output is indistinguishable
> from a manage-backlog run and every downstream phase consumes it unchanged.

> 📖 **Reuse, don't reinvent.** The backlog layout, workbook-build command, and
> `_manifest.json` registry are defined by `#otto/discover manage-backlog`. This
> skill writes the **same** structures for one epic; where mechanics are identical,
> follow manage-backlog's Step 4 rather than a parallel format.

---

## Step 0 — Detect mode and identify the epic

### 0a — Mode detection

Determine whether a **PM MCP** is connected — **JIRA** (Atlassian MCP) or **Azure DevOps** (ADO MCP). Detect by server segment, not a fixed prefix: treat the PM MCP as connected if any available tool's server segment matches (case-insensitive) `atlassian`/`jira` for JIRA, or `azure`/whole-segment `ado`/`azuredevops`/`workitem` for ADO.

- **Connected → ALM mode.** The epic is a PM-tool epic; drafts are still written locally first and only reach the PM tool via the explicit push in Step 4.
- **Not connected → Local mode.** Announce:
  > "No PM MCP is connected — running **generate-stories in local mode**. I'll draft stories into the local backlog under `04 - Backlog/`, keyed by backlog Story ID, and take no PM-tool action."

### 0b — Prerequisite gate (Local mode)

Local mode writes into the discovery backlog, so it must already exist:

- `artifacts/04 - Backlog/Backlog Tracker.xlsx` (or `_index.md` + `_manifest.json`), **and**
- the target epic present in `_manifest.json` / `epics/<EPIC-ID> - <name>.md`.

If the backlog is missing entirely:
> "⛔ No backlog to add stories to. Run `#otto/discover manage-backlog` first to seed `04 - Backlog/`, or connect a PM MCP to work against a PM-tool epic."

Stop until met. If the **backlog exists but the epic doesn't**, offer to create the epic row (name + narrative goal from the sources) before drafting its stories, following manage-backlog's epic schema.

### 0c — Identify the epic

Ask (if not already supplied):
> "Which **epic** are we drafting stories for? Give me the epic key / work-item ID (ALM mode) or a backlog Epic ID such as `EPIC-01` (Local mode)."

- **ALM mode:** fetch the epic (JIRA `getJiraIssue` / ADO `get_work_item`) for its title, description, and business goal, and list its existing child stories so you don't duplicate them. Read this for **business context only** — never as a technical template.
- **Local mode:** read `artifacts/04 - Backlog/epics/<EPIC-ID> - <name>.md` for the epic narrative and its existing stories.

---

## Step 1 — Gather and read the source material

Ask (if not already supplied):
> "Which files should I read? Paste text, or give me file paths (transcripts, notes, documents). If you just say 'the inbox', I'll read everything under `artifacts/00 - Inbox/`."

Rules:
- Read **only** the files the user names, or — as the sensible default — the contents of `artifacts/00 - Inbox/`. **Never** scan the whole workspace.
- List back exactly which sources you read, and confirm before drafting.
- If a named file can't be read, say so and ask for a corrected path — don't silently skip it.

---

## Step 2 — Draft candidate stories under the epic

From the sources, draft the epic's candidate stories. For **each** story capture:

- **User story** — `As a {role}, I want {goal}, so that {benefit}`.
- **Business context** — the need from the source material this story addresses (cite the source).
- **Draft acceptance criteria** — Gherkin `Given / When / Then`, business language only, each scenario independently testable. Mark them **draft** — the `story` skill firms them up.
- **Functional requirements / use-case labels** — only if the sources state them.

Apply light INVEST judgement while drafting: prefer several small, independently valuable stories over one oversized one; split by **business value**, never by technical layer. Do **not** size, estimate, or add solution notes — leave `size`, `solution_notes`, and `acceptance_criteria` fidelity at draft level for the story/design phases.

De-duplicate against the epic's **existing** stories (from Step 0c) — surface anything that looks like an overlap and ask before adding it.

Present the drafted set for confirmation **before** writing anything:
> "From {sources} I've drafted N candidate stories under {epic}. Review the list — shall I write them into the backlog as drafts?"

---

## Step 3 — Write the drafts into the local backlog

All output is **local first**, into the canonical discovery backlog — so `#otto/discover push-backlog`, `stories-refined`, and `/design` all consume it unchanged. Follow **manage-backlog Step 4** for the exact mechanics; specifically:

1. **Allocate collision-safe IDs.** Read `artifacts/04 - Backlog/_manifest.json` for the highest existing `STORY-NNN`, and number the new stories from the next free value. Never reuse an ID already in the manifest or in `stories/`/epic files. (This is the project's existing local scheme — do **not** invent a new prefix.)
2. **Append, don't rebuild.** Construct the JSON payload of **existing + new** stories for this epic and run the backlog writer so the workbook is regenerated with the new rows added:
   ```bash
   python3 devops/scripts/excel/create_backlog.py \
     --output "artifacts/04 - Backlog/Backlog Tracker.xlsx" \
     --data '<JSON with the epic + its full story set, new stories status "Draft" (New on ADO)>'
   ```
   Each new story row: `epic_id` = the target epic, `status` = `Draft` (`New` on ADO), `acceptance_criteria` = the draft Gherkin, `size` = empty, `solution_notes` = empty.
3. **Update the split markdown + manifest**, preserving every existing `pmKey` by ID:
   - `artifacts/04 - Backlog/epics/<EPIC-ID> - <name>.md` — append the new stories under the epic.
   - `artifacts/04 - Backlog/_index.md` — refresh the epic's story count.
   - `artifacts/04 - Backlog/_manifest.json` — add `{id, name, epicId}` for each new story; do not touch existing entries' `pmKey`.

---

## Step 4 — Review, then push explicitly

### 4a — Present for review

> "Drafted N stories into the backlog under {epic}:"
>
> | Story ID | User story | Draft AC | In epic |
> |---|---|---|---|
> | STORY-014 | As a … | 2 scenarios | EPIC-01 |

The stories now live in `Backlog Tracker.xlsx` at **Draft** (**New** on ADO) status. **Nothing is created in the PM tool** yet.

### 4b — Push (explicit, human-gated)

- **Local mode:** there is nothing to push. The backlog files are the authoritative output — stop here and point to the next steps below.
- **ALM mode:** once the user has reviewed the workbook, run the existing **`#otto/discover push-backlog`** flow. It creates the PM-tool stories under the epic and **writes the real key back** (`STORY-NNN` → the new JIRA key / ADO work-item ID) into `_manifest.json` (`pmKey` + `pushedAt`), the workbook, `_index.md`, and the epic file — keeping the local traceability record. **Do not** write a separate push implementation, and **do not** delete the local drafts.

> Never auto-push. The user reviews the drafted stories in the workbook first, then chooses to push.

---

## Step 5 — Next steps

> "N candidate stories are drafted under {epic} (local mode adds: no PM tool). Next:
>
> - **Refine each** into agreed AC with `#otto/refine` → *Refine a story* (the `story` skill), or generate `refinement-notes.md` for all of them with `#otto/discover stories-refined`.
> - Run `#otto/discover push-backlog` to create them in the PM tool once reviewed (connect a PM MCP first if running local)."

**Stop here.** You drafted stories and wrote them locally. You did **not** refine them into final AC, transition anything, suggest an implementation approach, or estimate — those belong to the `story` skill and `#otto/design`.
