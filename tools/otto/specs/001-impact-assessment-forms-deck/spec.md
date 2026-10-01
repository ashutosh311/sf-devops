# Feature Specification: Release impact-assessment — input forms, evidence-based ratings, presentable deck

**Feature Branch**: `feat/GH-90-impact-assessment-input-forms-and-deck`

**Created**: 2026-10-01

**Status**: Draft

**GitHub Issue**: #90 — feat(otto): release impact-assessment — native input forms, PDF source, evidence-based ratings, presentable PDF/HTML deck

**Release Impact**: MINOR — adds an optional `release` argument to the `otto_prompt` MCP tool and new output files under `artifacts/releases/`; no existing argument, config field, command or menu changes meaning.

**Input**: User description: "Release agent impact-assessment skill improvements: native input collection on every surface with an optional release-notes PDF; evidence-based assessment quality; a presentable colour-coded HTML slide deck and PDF rendered from the same findings as the markdown." Working notes: `tools/otto/docs/impact-assessment-test-observations.md`.

## Background

The Release agent's *impact-assessment* skill assesses a Salesforce seasonal release (for example Winter '27) against what a client org actually contains, and writes an advisory report. A first end-to-end test against a real client repository showed three kinds of problem:

- The user was asked for the release, extra sources and live-org choice as free text in chat, unlike every other Otto skill that collects input through forms or pickers.
- Several ratings were stronger than the evidence behind them (a Critical rating built on a source that had been cut off mid-table; "confirmed exposure" claimed from generic code counts; High ratings taken from an index entry without reading the article; a coverage claim that missed an entire metadata area).
- The only output was a long markdown file that repeated each finding three times and cannot be shown to a client as it is.

## Clarifications

### Session 2026-10-01

- Q: Is it acceptable for the agent to ask mid-run decisions in chat, even though up-front inputs must use a form? → A: Yes — up-front inputs use the form; decisions that depend on what the agent finds mid-run are asked in chat, kept short (yes/no style) with the reason shown.
- Q: What is the highest rating a Provisional (partly read) or Unverified (index-only) finding can receive? → A: Medium, shown with a Provisional/Unverified marker and the action "read the full source to confirm".
- Q: Should the findings register be saved as its own file in the project? → A: Yes — saved as a machine-readable file next to the markdown; the markdown, deck and PDF are all produced from it.
- Q: Which branding should the deck carry? → A: Slalom branding (name and colours) on every deck, alongside the project name, release and assessment date; risk colours must stay clearly distinguishable from the brand colours.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start an assessment without typing answers in chat (Priority: P1)

A consultant starts the impact-assessment skill and is asked for the release, an optional release-notes PDF, any extra release-note sources and whether to also inspect a live sandbox through the same kind of form or picker used elsewhere in Otto, on whichever surface they use. If they already named the release on the command line, it is pre-selected rather than asked from scratch.

**Why this priority**: It is the inconsistency the user hit first, it affects every run, and every later story depends on the inputs being captured reliably.

**Independent Test**: Start the skill on each surface and confirm the four inputs are collected through a form or picker, the agent does not ask for them again, and a cancelled form ends the run cleanly with nothing written.

**Acceptance Scenarios**:

1. **Given** a surface that supports forms, **When** the consultant starts the skill, **Then** one form (or one picker sequence) asks for release, release-notes PDF, extra sources and live-org choice, and the agent proceeds using those answers without asking again.
2. **Given** the consultant typed a release such as "Winter '27" with the command, **When** the form opens, **Then** that release is pre-selected.
3. **Given** a surface or client that does not support forms, **When** the consultant starts the skill, **Then** the agent asks the same four questions conversationally, exactly as before.
4. **Given** the consultant cancels or dismisses the form, **When** the run ends, **Then** no files are written and the consultant is told the assessment was cancelled.
5. **Given** the consultant chooses "Other" and types a release that is not of the form Winter/Spring/Summer plus a two-digit year, **When** they submit, **Then** they are asked to correct it instead of the run continuing with a malformed release.

---

### User Story 2 - Use a release-notes PDF instead of fetching the live pages (Priority: P2)

A consultant who already has Salesforce's release notes as a PDF supplies it as an input. The agent uses it as the primary source, so no browser tool is required and the run is faster and repeatable.

**Why this priority**: Fetching the live pages needs a browser tool, is slow, and is where the truncated-source problem arose. It is an option, not a prerequisite for the rest.

**Independent Test**: Supply a release-notes PDF, run the skill without any browser tool available, and confirm the assessment completes using only the PDF, with the PDF recorded as the source.

**Acceptance Scenarios**:

1. **Given** a valid PDF for the chosen release, **When** the skill runs, **Then** the agent reads it by searching sections relevant to the org rather than loading the whole document, and records the PDF in the sources table.
2. **Given** a PDF that names a different release than the one chosen, **When** the agent checks it, **Then** the agent stops and tells the consultant instead of assessing the wrong release.
3. **Given** a PDF that cannot be converted to readable text, **When** the agent tries, **Then** it says so plainly and falls back to the live pages or asks for a text export.
4. **Given** a PDF path that does not exist, **When** the agent checks it, **Then** it asks for a corrected path.

---

### User Story 3 - Ratings I can defend to the client (Priority: P1)

A consultant reads the assessment and can trust that every rating is backed by evidence the report points to. A finding is only rated above Medium when the part of the source that decides who is affected was actually read in full, and "exposure" is only called Confirmed when a stated search of the project found it.

**Why this priority**: This is the core value of the skill. An over-rated finding sent to a client damages credibility more than a missing one.

**Independent Test**: Run the skill against a source set that includes one deliberately truncated section and one finding whose only source is an index entry; confirm neither can be rated above Medium, and that every Confirmed exposure names the search and result count.

**Acceptance Scenarios**:

1. **Given** a fetched release-note section that appears cut off (for example it ends mid-table or at a round-number size), **When** the agent saves it, **Then** the agent detects this, re-reads it another way, and if it still cannot be read in full, marks any finding that depends on it as Provisional (capped at Medium), naming the unread part and the action "read the full source to confirm".
2. **Given** a finding whose source was only read from a release-updates index entry, **When** the agent rates it, **Then** it is shown as Unverified, capped at Medium with the action "read the full source to confirm", until the article is read.
3. **Given** a release change whose exposure depends on what the org contains, **When** the agent assesses it, **Then** it states the search that would reveal exposure, runs it, and reports exposure as **Confirmed** (search found matches, command and count cited), **Possible** (plausible dependency, no match) or **Unknown** (area not visible).
4. **Given** a generic project count (for example the number of classes declared with sharing), **When** it is offered as exposure evidence, **Then** it is not accepted as evidence unless the report explains the causal link to the change.
5. **Given** every enforced-this-release or enforced-next-release update listed in the release-updates source, **When** the assessment completes, **Then** each has been read in full or is listed as unread with a reason tied to the org's inventory.
6. **Given** the org contains a metadata area the release notes touch (for example Visualforce pages), **When** the inventory is built, **Then** that area appears in the evidence and its related release changes are assessed rather than dismissed.
7. **Given** the report is about to be written, **When** the agent runs its pre-write check, **Then** any Critical lacking a fully read source, any Confirmed lacking a cited search, any contradictory dates or priorities, and any unread enforced-soon update are fixed or explicitly disclosed before writing.

---

### User Story 4 - Know up front what the repository cannot tell us (Priority: P2)

A consultant is told early which parts of the org are invisible to a repository-only review (for example connected apps, OAuth flows, flows, permission sets, profiles when the project's retrieval scope omits them), and, when those blind spots affect the most serious findings, is offered the live-org check again with that evidence even if they chose repository-only.

**Why this priority**: In the test run the most severe findings could not be verified from the repo; the report said so only at the end. Surfacing it early lets the consultant decide with full information.

**Independent Test**: Run repository-only against a project whose retrieval scope omits connected apps; confirm the blind spots are listed before findings are rated, the live-org check is offered again, and the report ends with a verification pack.

**Acceptance Scenarios**:

1. **Given** a project whose retrieval scope omits metadata types the release changes depend on, **When** the inventory completes, **Then** the report lists each blind spot and which findings it affects.
2. **Given** a blind spot affects a finding that would otherwise be Critical or High, **When** the consultant chose repository-only, **Then** they are asked in chat, once, whether to run the live-org check, with the reason shown.
3. **Given** the consultant stays repository-only, **When** the report is written, **Then** it contains a verification pack: for each affected finding, the read-only check to run (queries or Setup paths) and who to ask.
4. **Given** the consultant opts into the live check, **When** it runs, **Then** it stays read-only, defaults to the sandbox, and warns before touching anything that looks like production.

---

### User Story 5 - A report short enough to read, consistent enough to trust (Priority: P2)

A consultant or client reads the assessment and each finding appears once in full, grouped into a small fixed set of tiers, with consistent ratings and consistent dates.

**Why this priority**: The test report was 39 KB with each finding stated three times, and quoted the same deadline as "about a month" and "~3 weeks".

**Independent Test**: Generate a report and check that every finding has one detailed entry, every other view references it by identifier, ratings agree everywhere, and relative-date wording agrees with the stated assessment date.

**Acceptance Scenarios**:

1. **Given** a completed assessment, **When** the report is produced, **Then** all findings come from one list and each is described in full exactly once.
2. **Given** the findings, **When** they are grouped, **Then** they fall into four tiers: act before a date, test in the preview, opportunities, not applicable (the last collapsed to a single line).
3. **Given** two views of the same finding, **When** compared, **Then** rating, exposure label and date are identical.
4. **Given** a deadline, **When** the report mentions how soon it is, **Then** the wording is derived from the assessment date and is the same everywhere it appears.
5. **Given** the rating rubric (exposure × impact × deadline), **When** two analysts rate the same evidence, **Then** the rubric leads them to the same tier.

---

### User Story 6 - A presentable deck and PDF for the client (Priority: P2)

A consultant gets, alongside the markdown, a colour-coded slide deck (one self-contained HTML file) and a PDF of it, suitable for presenting to the client without further editing.

**Why this priority**: The markdown is the working record; clients and sponsors need a polished summary. Depends on Story 5's single findings register.

**Independent Test**: Run the skill to completion and open the deck and PDF with no extra tooling; confirm the executive slide, colour coding and appendix are present and match the markdown.

**Acceptance Scenarios**:

1. **Given** a completed assessment, **When** the skill finishes, **Then** an HTML deck and a PDF exist beside the markdown, both generated from the same findings as the markdown.
2. **Given** the deck's first slide, **When** a stakeholder reads it, **Then** it shows the go / go-with-conditions / not-ready recommendation with its conditions, a rating heatmap, and a decide-by timeline.
3. **Given** the top findings slides, **When** viewed, **Then** at most eight findings are shown, colour-coded by rating, with a distinct marker for exposure that is Possible/Unknown or ratings that are Provisional/Unverified.
4. **Given** the deck, **When** the stakeholder wants detail, **Then** an appendix carries every finding with its evidence and source.
5. **Given** any slide, **When** viewed, **Then** it shows Slalom branding with the project name, release and assessment date, and the risk colours are not confused with the brand colours.
6. **Given** no browser tool is available to produce the PDF, **When** the skill finishes, **Then** the HTML deck is still produced and the consultant is told how to save it as a PDF.
7. **Given** an existing assessment is updated, **When** the consultant chooses to update, **Then** the saved findings register, markdown, deck and PDF are all regenerated together and none is left stale; if the markdown was hand-edited, the consultant is asked in chat which to keep first.
8. **Given** the markdown and the deck, **When** the two are compared, **Then** markdown remains the authoritative record and they never disagree on any rating.

---

### Edge Cases

- A release newer than any listed (e.g. a season two years out) typed under "Other": accepted if well-formed; the derived release number is presented as a proposal to be checked against the loaded notes' title.
- Two sources disagree on a date or API version: both are shown, and the finding is capped at Medium and marked Provisional until the consultant resolves it.
- The PDF is very large or image-only: treated as unreadable (Story 2, scenario 3).
- The consultant cancels midway through the picker sequence in VS Code: nothing is written.
- Every finding is Low or not applicable: the deck still produces an executive slide and states that no action is needed before the upgrade.
- More than eight findings are Critical: the executive section features the eight with the earliest dates, and the executive slide states how many further Critical findings are in the appendix.
- The project has no `artifacts` folder yet: output folders are created beside the markdown, never elsewhere.
- Extra sources include both URLs and local files: both are recorded with their status.
- The markdown was hand-edited after the previous run: an update compares it with the saved findings register and asks before overwriting (FR-027).
- A client-confidential value appears in the evidence: the deck and markdown stay inside the client project and are never written outside it (Otto itself transmits nothing).

## Requirements *(mandatory)*

### Functional Requirements

**Input collection**

- **FR-001**: On every surface that supports forms or pickers, the skill MUST collect release, extra sources, optional release-notes PDF and live-org choice through that mechanism before the agent starts, and MUST NOT ask for those inputs again in chat. Decisions that can only arise from what the agent finds during the run (see FR-016 and the section-shortlist confirmation) are asked in chat, kept to a short yes/no style with the reason shown.
- **FR-002**: Where forms are unsupported, the skill MUST fall back to asking the same questions conversationally with no loss of function.
- **FR-003**: A release named on the command line MUST pre-select the release in the form rather than bypass it.
- **FR-004**: A cancelled or dismissed form MUST end the run with nothing written and a clear message.
- **FR-005**: The list of proposed releases, release-number derivation, release-name validation and the wording of the "already confirmed" inputs MUST come from one shared definition used by all surfaces.
- **FR-006**: A user-supplied release-notes PDF MUST be treated as the primary source: located, checked to name the chosen release, prepared for searching, and read by targeted search, never loaded whole.

**Evidence and ratings**

- **FR-007**: After each release-note section is saved, the skill MUST check it is complete and, if not, re-read it by another route; findings that still depend on an incomplete part MUST be marked Provisional with the unread part named.
- **FR-008**: A finding MUST NOT be rated above Medium unless the part of its source that determines who is affected was read in full; a finding capped for this reason is marked Provisional and names the unread part and the action "read the full source to confirm". A finding that cites a partly read source is not capped when it records which part was read and why that part decides who is affected (the deciding part); this never applies to a source known only from an index entry.
- **FR-009**: A finding sourced only from an index entry MUST be marked Unverified and capped at Medium, with the action "read the full source to confirm", until the article is read.
- **FR-010**: Each finding MUST carry an exposure label: Confirmed (a stated search matched; command and count shown), Possible, or Unknown.
- **FR-011**: Generic project counts MUST NOT be accepted as exposure evidence without a stated causal link to the change.
- **FR-012**: Every update that is enforced in the assessed release or the next MUST be read in full or listed as unread with an inventory-based reason.
- **FR-013**: The project inventory MUST cover Visualforce pages (including PDF rendering), email templates and Sites in addition to its current areas.
- **FR-014**: Before writing, the skill MUST run a self-check covering FR-007 to FR-012, date and priority consistency, and disclose or fix every failure.

**Repository blind spots**

- **FR-015**: Early in the inventory step the skill MUST compare the project's retrieval scope against the metadata types the release changes depend on and list the blind spots with the findings they affect.
- **FR-016**: When a blind spot affects a would-be Critical or High finding and the consultant chose repository-only, the skill MUST offer the live-org check again with that reason.
- **FR-017**: The report MUST include a verification pack for each unresolved blind spot: the read-only check to run and who to ask.
- **FR-018**: Live-org queries MUST remain read-only, default to the sandbox, and require explicit confirmation before touching an org that appears to be production.

**Report shape**

- **FR-019**: The skill MUST keep one list of findings, save it as a machine-readable file beside the markdown, and describe each finding in full exactly once in each document produced from it.
- **FR-020**: Findings MUST be grouped into four tiers — act before a date, test in the preview, opportunities, not applicable (collapsed to one line).
- **FR-021**: Every finding MUST carry one of five ratings — Critical, High, Medium, Low, or Not applicable — assigned by a stated rubric combining exposure, impact and deadline (the rubric table is in the data model and MUST appear in the report). The rubric alone determines the rating before the evidence caps in FR-008 and FR-009 are applied, so two analysts with the same evidence reach the same rating.
- **FR-022**: Relative-date wording MUST be derived from the assessment date and be identical wherever a date is discussed.

**Deck and PDF**

- **FR-023**: The skill MUST produce, beside the markdown, one self-contained HTML slide deck and a PDF of it, both generated from the same findings as the markdown.
- **FR-024**: The deck MUST open with an executive slide (recommendation and conditions, rating heatmap, decide-by timeline), followed by the top findings (at most eight) colour-coded by rating, a slide of questions for the owners of the integrations, and an appendix with every finding. Every slide MUST carry Slalom branding (name and brand colours) with the project name, assessed release and assessment date, and the risk colours MUST stay clearly distinguishable from the brand colours.
- **FR-025**: Exposure labels other than Confirmed, and Provisional/Unverified markers, MUST be visibly distinct in the deck.
- **FR-026**: If the PDF cannot be produced in the consultant's environment, the HTML deck MUST still be produced and the consultant told how to save it as a PDF.
- **FR-027**: On an update of an existing assessment, the saved findings register, markdown, deck and PDF MUST all be regenerated together. If the markdown no longer matches what the saved findings register would produce (for example it was hand-edited), the skill MUST tell the consultant and ask in chat which to keep before overwriting anything.
- **FR-028**: The markdown report MUST remain the authoritative human-readable record; no deck content may be absent from or contradict it, and the saved findings register MUST contain nothing the markdown omits.
- **FR-029**: The skill MUST remain advisory: it writes only under the project's artifacts folder, never changes project source, never deploys, and never creates or transitions tickets.
- **FR-030**: The executive section of the markdown report and the executive slide of the deck MUST state how many findings could break existing behaviour but have unknown exposure (so cannot be ruled out from the repository) and list them, so that severity hidden behind a blind spot is not lost in the ratings.
- **FR-031**: Text fields in the findings register MUST stay within their stated limits, and the deck MUST clip any text that exceeds them rather than let it overflow a slide; the markdown carries the full text.

### Key Entities

- **Finding**: One release change assessed against the org — area, rating, exposure label, evidence, relevant date, recommended action, confidence, source. The single record from which every view is produced.
- **Findings register**: The complete set of findings for one assessed release, saved beside the markdown as a machine-readable file and used to produce the markdown, deck and PDF.
- **Source**: A release-note document or section used — what it is, where from, how obtained, completeness (full / partial / index-only / unavailable), status.
- **Blind spot**: A part of the org not visible to the review, with the findings it affects and the check that would resolve it.
- **Tier**: One of the four groupings a finding falls into.
- **Assessment inputs**: Release, extra sources, release-notes PDF, live-org choice — collected once and passed to the agent as confirmed.

## Otto Surface Impact *(mandatory)*

| Surface | In scope? | Expected behaviour / notes |
|---------|-----------|----------------------------|
| VS Code extension (`@otto`) | Yes | Native pickers and an open-file dialog for the PDF; the same confirmed-inputs text is handed to the agent. Quality rules and deck apply as in the template. |
| Claude Code plugin (MCP server) | Yes | One input form when the skill is requested; chat fallback if the client lacks form support. |
| GitHub Copilot pack / plugin (MCP + `.agent.md`) | Yes | Same form via the MCP server where Copilot supports it; otherwise chat fallback. Support must be confirmed during verification. |
| Raw MCP prompt (`/mcp__otto__release`, hand-registered server) | No (chat only) | The prompt path has no project-root argument and never shows the form; the skill asks the same four questions in one chat message. The form is a feature of the `otto_prompt` tool that the plugin and Copilot agents call. |
| CLI (`otto init`) | No | The CLI only initialises/reconfigures projects; it does not run phase agents. |

| PM mode | In scope? | Expected behaviour / notes |
|---------|-----------|----------------------------|
| JIRA | Yes | Skill is PM-independent; runs in local mode. No ticket reads, writes or transitions. |
| Azure DevOps | Yes | Same. |
| LOCAL | Yes | Same. |

**Public surface changes**: `otto_prompt` gains an optional `release` argument (additive). The Claude plugin release command and the Copilot release agent wrapper gain the same parameter in their instructions (the repo-root generated agent files are regenerated, not hand-edited). New output files `impact-assessment.html`, `impact-assessment.pdf` and a machine-readable findings file appear beside `impact-assessment.md` under `artifacts/releases/salesforce-{season-yy}/` (additive to the scaffolded layout). No config-schema change, no menu change.

**Phase boundaries**: Unchanged. The skill remains advisory and read-only with respect to project source; it writes only under the artifacts folder. The generated deck contains findings about the client org plus the presentation markup (styling and script) needed to render them; this is a generated deliverable, permitted by Constitution Principle III (v1.1.0, "Generated deliverables are not procedure"). It contains no phase-template procedure text, instruction fragments, prompts or agent instructions, and its markup is limited to rendering the findings.

### Verification Approach

- **Render-test assertions** (`packages/core/test/render.test.mjs`): the impact-assessment template renders for JIRA, ADO and LOCAL with no unresolved placeholders and asserts: the confirmed-inputs phrase and PDF path; the exposure vocabulary and rating caps (partial/index-only sources); the completeness check; the retrieval-scope check and verification pack; the four tiers and rubric; the pre-write self-check; the deck and PDF steps including the no-browser fallback; the advisory/read-only boundary and "no ticket transitions" invariant. Shared helper tests cover release list, numbering, validation and the confirmed-inputs text.
- **Manual scenarios** (record surface and model for each before the PR):
  1. VS Code: full picker sequence, with and without a PDF; cancel at each step.
  2. Claude Code: form with the release pre-selected from the command; cancel; "Other" with a bad value.
  3. Copilot (CLI and VS Code): form if supported, chat fallback if not; record which.
  4. PDF route with no browser tool installed.
  5. A deliberately truncated section and an index-only finding: neither reaches Critical/High.
  6. A repository-only run on a project that omits connected apps: blind spots listed, live check re-offered, verification pack present.
  7. Re-run on the reference test project and compare with the first report: findings appear once, ratings follow the rubric, deck and PDF open correctly and agree with the markdown.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a surface that supports forms, 0 of the four inputs (release, release-notes PDF, extra sources, live-org) are asked for in chat; on a surface that does not, all four are asked in a single conversational step.
- **SC-002**: 100% of findings rated High or Critical cite a source whose deciding part was read in full; 100% of findings capped under FR-008/FR-009 carry a Provisional or Unverified marker.
- **SC-003**: 100% of findings labelled Confirmed exposure name the search performed and its result count; 0 rely solely on a generic project count.
- **SC-004**: 100% of updates enforced in the assessed or next release are read in full or listed as unread with a stated reason.
- **SC-005**: Each finding has exactly one detailed entry; the same finding never has two different ratings or dates anywhere in the output.
- **SC-006**: A reader can identify the recommendation, the top risks and the next deadline from the first slide of the deck in under one minute.
- **SC-007**: The executive section of the deck shows no more than 8 findings; all others are in the appendix.
- **SC-008**: When a release-notes PDF is supplied, the assessment completes with no browser tool and no live page fetches; the release is verified against the PDF's own title.
- **SC-009**: Re-running the reference test project produces a markdown report at least 40% shorter than the first run while retaining every finding rated High or above.
- **SC-010**: In consultant review of the first deck produced, it can be presented to the client without manual editing (accepted by the user running the verification scenarios).

## Assumptions

- The deck and PDF are produced for each run by default; consultants do not choose to skip them.
- Slalom's approved brand name and colour palette are available to include in the deck; if they are not, the plan resolves where they come from before implementation. No client logo or per-project theming is supported in this release.
- PDF production uses a browser tool when one is available; otherwise the consultant saves the HTML deck as a PDF. A `.pptx` output is out of scope.
- The four-tier grouping and the rating rubric are fixed by Otto and not configurable per project in this release.
- Only the assessed release's own notes are in scope; comparison across releases is out of scope.
- The live-org check continues to use whichever Salesforce DX capability the host provides; no new credentials are introduced.
- The existing prototype (shared release helpers, MCP form, VS Code pickers, PDF-source instructions) satisfies User Stories 1 and 2 in principle and is to be reviewed against this spec rather than assumed complete.
- The checks that confirm a release-note section was read completely rely on observable signs (sizes, truncated endings); the cause of the truncation seen in testing is not yet established, so the check, not a specific cause, is what this spec requires.
- Salesforce's release-note structure and URL scheme may change; the skill continues to treat the derived release number as a proposal verified against the loaded page title.
- Names, org identifiers and findings from client projects stay in the client project; neither this spec nor Otto's tests contain client data.
