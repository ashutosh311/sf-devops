---

description: "Task list for GH #90 — Release impact-assessment: input forms, evidence-based ratings, presentable deck"
---

# Tasks: Release impact-assessment — input forms, evidence-based ratings, presentable deck

**Input**: Design documents from `specs/001-impact-assessment-forms-deck/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — the constitution (Principle V) and the spec's Verification Approach require render-test assertions and recorded manual scenarios.

**Organization**: Grouped by user story. All paths are relative to `tools/otto/` unless marked *repo-root*. Stories are listed in priority order (US1, US3 are P1; US2, US4, US5, US6 are P2), so story numbers are not consecutive in the phase list.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- Most template tasks edit the same file (`packages/core/src/templates/release-impact-assessment.ts`), so they are sequential and carry no `[P]`

## Current state

A prototype already exists, uncommitted on this branch: `packages/core/src/release-inputs.ts`, the MCP form (`packages/mcp/src/elicit.ts`, `tools.ts`), the VS Code pickers (`packages/vscode/src/handlers/release.ts`), the template's confirmed-inputs note and PDF-supplied step, and the plugin/Copilot wrapper wording. Tasks below **review that prototype against the spec** and fix gaps; they do not rewrite it.

---

## Phase 1: Setup

- [X] T001 Confirm the baseline is green before changing anything: from `tools/otto/` run `pnpm -r build`, `pnpm -r typecheck`, `cd packages/core && npm test`, `node scripts/generate-copilot-agents.mjs --check`; record results in the PR notes
- [X] T002 Commit the existing prototype and the spec folder as the starting point on branch `feat/GH-90-impact-assessment-input-forms-and-deck` (three commits: `feat(release): prototype impact-assessment input forms and PDF source`; `docs(otto): add spec for GH-90`; `docs: amend constitution to v1.1.0 (generated-deliverables exemption to Principle III)` — remove the scratch Sync Impact Report comment from `.specify/memory/constitution.md` before that commit), each ending with the project's required co-author line

---

## Phase 2: Foundational (blocks the user stories)

**Purpose**: the register contract that US3, US5 and US6 all depend on.

- [X] T003 Create `packages/core/src/findings.ts` with a Zod schema and exported types for the findings register exactly as `data-model.md` states. Quote these constraints verbatim in code comments and enforce them: `schemaVersion` integer starting at 1; `id` matches `F-NN` and is unique; Source `id` matches `S-NN`; `area` ≤ 60 chars; `summary` ≤ 240 chars; `evidence` ≤ 320 chars; `action` ≤ 200 chars; `tier` ∈ `act-before-date | test-in-preview | opportunity | not-applicable`; `rating` ∈ `critical | high | medium | low | na`; `exposure` ∈ `confirmed | possible | unknown`; `caveat` ∈ `none | provisional | unverified`; `confidence` ∈ `high | medium | low`; Source `completeness` ∈ `full | partial | index-only | unavailable` with `unreadPart` required when `partial`; `recommendation` ∈ `go | go-with-conditions | not-ready` with non-empty `conditions` unless `go`; `assessedOn` ISO date; `scope` ∈ `repo | repo+live`; `exposure` ∈ `confirmed | possible | unknown | none` (`none` only with `rating: na`); `ratingBasis` = `{ exposure, impact, deadline }` with `impact` ∈ `breaks | action | improvement` and `deadline` ∈ `now | soon | later`; `featuredOverflow` integer ≥ 0; `featured` boolean; `date` ISO date when present
- [X] T004 In `packages/core/src/findings.ts` add the cross-field rules from `data-model.md` as schema refinements, each with a distinct error message: (1) `critical`/`high` only if every cited Source is `full` and `caveat` is `none`; (2) a `partial` Source forces `caveat: provisional`, an `index-only` Source forces `caveat: unverified`, either caps `rating` at `medium` and the `action` begins "Read the full source to confirm"; (3) `exposure: confirmed` requires `search` with non-empty `command` and integer `matchCount` > 0; (4) `tier: not-applicable` ⇔ `rating: na` ⇔ `exposure: none`; (6) at most 8 `featured: true`, Critical findings featured first by earliest `date`, and `featuredOverflow` equals the number of Critical findings left unfeatured; (7) unique ids and every `sourceIds` entry exists
- [X] T005 Export the new module from `packages/core/src/index.ts` (next to the existing `release-inputs.js` export)
- [X] T006 [P] Create `packages/core/test/fixtures/sample-findings.json`: one valid register containing 3 featured findings across different tiers, one Provisional finding (partial source) and one Not-applicable finding, plus two sources and one blind spot; it is used by T007, T038 and the preview helper T044
- [X] T007 [P] Add schema tests to `packages/core/test/render.test.mjs`: the sample register fixture (new task above) passes; each negative case fails with its own rule message — Critical with a `partial` Source, Confirmed exposure without `search`, 9 featured findings, `rating: na` outside tier `not-applicable`, partial Source without `unreadPart`, duplicate finding ids
- [X] T008 Run `pnpm --filter @otto/core build && cd packages/core && npm test`; fix until green

**Checkpoint**: register contract exists and is tested.

---

## Phase 3: User Story 1 — Start without typing answers in chat (P1) 🎯 MVP

**Goal**: release, sources, PDF and live-org choice are collected by form/picker on every surface, with chat fallback and clean cancel.

**Independent test**: start the skill on each surface; inputs come from a form/picker, the agent does not re-ask, cancel ends cleanly (spec User Story 1 scenarios 1–5).

- [X] T009 [US1] Fix FR-003 in `packages/vscode/src/handlers/release.ts`: today a typed request (`remainder`) bypasses `collectImpactAssessmentInputs`. Change it so a remainder that parses with `parseSeasonalRelease` pre-selects that release in the first picker (or skips only that picker) while the PDF, extra-sources and scope steps are still asked; a remainder that is not a release is passed to the agent as extra context, not as a replacement for the inputs
- [X] T010 [US1] In `packages/vscode/src/handlers/release.ts` confirm every step returns `undefined` on Esc/cancel (release picker, "Other" box, PDF choice, file dialog, scope picker) and that the caller writes "Release cancelled." with nothing else; the optional sources box keeps "Esc means none"
- [X] T011 [P] [US1] In `packages/mcp/src/elicit.ts` review `runElicitedImpactAssessmentInputs` against FR-001–FR-004: release preselect from the `release` argument, "Other" re-prompt up to three attempts then cancel, PDF and sources fields optional, scope default `repo`; adjust the form message wording if it does not match the spec
- [X] T012 [P] [US1] In `packages/mcp/src/tools.ts` review the `otto_prompt` branch: only for `release` + `impact-assessment` and only when `supportsElicitation`; cancelled form returns the plain cancelled message with no instructions; no form support returns the rendered instructions unchanged (FR-002)
- [X] T013 [US1] Add helper tests to `packages/core/test/render.test.mjs` for `release-inputs.ts` beyond the existing ones: PDF line wording (present/absent), extras trimmed, sandbox named only when live, a past release (e.g. Summer '26) parses to the right number, malformed strings rejected
- [X] T014 [US1] Confirm the plugin command and Copilot agent wrapper wording in `plugin/commands/release.md` and `copilot/agents/release.agent.md` describe the optional `release` argument and the no-form fallback; regenerate with `node scripts/generate-copilot-agents.mjs` and verify `--check` passes (*repo-root* `.github/agents/release.agent.md` is generated, never hand-edited)
- [X] T015 [US1] Consolidate the chat fallback in `packages/core/src/templates/release-impact-assessment.ts` (spec SC-001, FR-002): when the request has no "Inputs already confirmed by the user" block, the agent asks release, release-notes PDF, extra sources and live-org choice together in one conversational step instead of at Step 1 item 1, item 3 and Step 3c separately; add a render assertion for the single combined question
- [X] T016 [US1] Re-run the throwaway MCP client check from `quickstart.md` section 2 (form accepted, form declined, no form support) and note the outcomes for the PR

**Checkpoint**: US1 works on VS Code and MCP; can ship as an MVP.

---

## Phase 4: User Story 3 — Ratings I can defend (P1)

**Goal**: ratings never exceed the evidence; exposure is Confirmed/Possible/Unknown tied to a search; the report self-checks before writing.

**Independent test**: a truncated section and an index-only finding cannot be rated above Medium; every Confirmed names its search and count (spec User Story 3 scenarios 1–7).

All tasks edit `packages/core/src/templates/release-impact-assessment.ts` — keep sequential.

- [X] T017 [US3] Add the section completeness check (spec FR-007, research R5) as a new sub-step after the section-fetch instructions: after each save, flag a size equal to a round cap (the observed case was exactly 4096 bytes), text ending mid-sentence or mid-table, or a table showing only its header row; then re-read by a second route (accessibility snapshot, or the supplied PDF); if still incomplete mark dependent findings Provisional naming the unread part
- [X] T018 [US3] Add the exposure vocabulary and search rule (FR-010, FR-011): Confirmed = a stated search matched, with the command and match count cited; Possible = plausible dependency, no match; Unknown = area not visible. State that generic counts (e.g. classes declared `with sharing`) are not evidence without a causal link, and that for each release item the agent names the search that would reveal exposure and runs it
- [X] T019 [US3] Add the rating-cap rules (FR-008, FR-009): a finding rests on a fully read deciding section or is capped at Medium; partly read = Provisional, index-only = Unverified, both carrying the action "Read the full source to confirm"; sources that disagree on a date or API version show both and cap the finding at Medium, Provisional, until resolved; Critical/High require every cited source read in full
- [X] T020 [US3] Replace the template's "Always read" shortlist wording with the FR-012 rule: every update enforced in the assessed release or the next is read in full or listed as unread with a reason tied to the inventory; remove the assertion that unread sections were "not flagged as relevant" and replace it with a per-section term-list check
- [X] T021 [US3] Extend the inventory step (FR-013) to cover Visualforce pages (count, and how many render as PDF), email templates and Sites, and add the matching terms to the term-list derivation
- [X] T022 [US3] Add the pre-write self-check step (FR-014) immediately before the output is written: verify every Critical/High has a fully read source; every Confirmed has a cited search and count; no contradictory dates or priorities; every enforced-soon update was read or disclosed; fix or disclose each failure in the report
- [X] T023 [US3] Add render-test assertions to `packages/core/test/render.test.mjs` for JIRA, ADO and LOCAL configs: completeness check wording (4096 signal, mid-table signal), exposure vocabulary and "command and count", cap rules and the exact phrase "Read the full source to confirm", the enforced-soon read rule, the Visualforce inventory item, the self-check list
- [X] T024 [US3] Run `cd packages/core && npm test`; fix until green

**Checkpoint**: US3 complete; rating rules are in the template and asserted.

---

## Phase 5: User Story 2 — Use a release-notes PDF (P2)

**Goal**: a supplied PDF is the primary source, with no browser needed.

**Independent test**: supply a PDF with no browser tool; the assessment completes from the PDF only (spec User Story 2 scenarios 1–4).

- [X] T025 [US2] In `packages/core/src/templates/release-impact-assessment.ts` complete the "PDF supplied" step against the spec: path check with re-ask on a missing file; verify the release against the PDF's own title and, when a PDF is supplied, do not fetch the official URL to check the page title (it stays as a reference only — SC-008); conversion; stop and tell the user if the converted text names a different release; if conversion yields unreadable text, say so and fall back to the live pages or ask for a text export; never load the converted file whole; record the PDF as a Source in the sources table
- [X] T026 [US2] Add the PDF to the template's Source recording (Step 2c) so `obtained: pdf` and completeness are captured for the register
- [X] T027 [US2] Add render-test assertions for the PDF step: path re-ask, wrong-release stop, unreadable-PDF fallback, "Skip 2a entirely", never-load-whole wording
- [X] T028 [P] [US2] In `packages/vscode/src/handlers/release.ts` verify the file dialog returns a project-relative path inside the workspace and an absolute path otherwise, and that choosing "fetch live" passes no PDF line; add the dialog's default folder to the project's `{paths.artifacts}/06 - Reference` if it exists

**Checkpoint**: US2 complete.

---

## Phase 6: User Story 4 — Know what the repository cannot see (P2)

**Goal**: blind spots listed early; live check re-offered in chat; verification pack in the report.

**Independent test**: repo-only run on a project whose retrieval scope omits connected apps lists the blind spots, asks about the live check, and ends with a verification pack (spec User Story 4 scenarios 1–4).

- [X] T029 [US4] Add the retrieval-scope check (FR-015, research R6) at the start of the inventory step in `packages/core/src/templates/release-impact-assessment.ts`: compare the project's retrieval manifest and present folders with the metadata types the term list needs, using a fixed topic→type mapping held in the template (OAuth/connected apps → connected-app, external-client-app and named-credential types; profile filtering → profile and permission-set types; flows → flow type); list each missing type as a blind spot with the findings it affects
- [X] T030 [US4] Add the chat re-offer (FR-001 clarification, FR-016): when a blind spot affects a would-be Critical/High finding and the user chose repository-only, ask once in chat, short yes/no, showing the reason; keep the existing live-org rules (read-only, default sandbox, confirm before anything that looks like production — FR-018)
- [X] T031 [US4] Add the verification-pack output (FR-017): per unresolved blind spot, the check to run and who to ask. Use Setup paths only — do not write org object or field names into the template until they are tested in a real org (research R7)
- [X] T032 [US4] Add render-test assertions: retrieval-scope check present, topic→type mapping present, chat re-offer wording, verification pack heading and "who to ask", read-only/production-warning wording unchanged

**Checkpoint**: US4 complete.

---

## Phase 7: User Story 5 — A report short enough to read, consistent enough to trust (P2)

**Goal**: one findings register; four fixed tiers; rubric; consistent dates; markdown shows each finding once.

**Independent test**: each finding appears once in full; ratings and dates agree everywhere (spec User Story 5 scenarios 1–5).

- [X] T033 [US5] In `packages/core/src/templates/release-impact-assessment.ts` add a "Build the findings register" step before writing: describe the register fields and limits from `data-model.md`, include one compact example register, and state that the register is written to `{{paths.artifacts}}/releases/salesforce-{season-yy}/impact-assessment.findings.json`
- [X] T034 [US5] Add the four tiers and the tier rule, and the rating rubric table, copied verbatim from `data-model.md` *Rubric (FR-021) and tier rule (FR-020)* (exposure × impact × deadline → rating; `now` = already enforced or within 30 days of the assessment date; the cap rules always override), to the template and to the markdown outline (FR-020, FR-021). Do not invent thresholds — if the table lacks a case, stop and fix `data-model.md` first
- [X] T035 [US5] Add the relative-date rule (FR-022, research R9): store absolute dates and the assessment date; write "in N days (date)" with one computed N per finding and reuse that wording everywhere
- [X] T036 [US5] Restructure the markdown outline in the template: executive assessment (recommendation, conditions, tier counts, rubric); blind spots and verification pack; findings grouped by tier, each finding described once; sources table; coverage (unread sections); validation sequence and regression matrix referring to finding ids; open questions. Remove the separate priority-summary and confirmed-traceability tables that repeat findings
- [X] T037 [US5] Add the update-run behaviour (FR-027): on "update", re-read the register, and if the existing markdown no longer matches what the register would produce, ask in chat which to keep before overwriting; regenerate the register and markdown together (the deck and PDF half of the update is T042)
- [X] T038 [US5] Add a test in `packages/core/test/render.test.mjs` that extracts the template's example register and validates it with the core schema (T003–T004); add render assertions for the tiers, rubric, relative-date rule, register path, the markdown outline headings, and that the old repeated-table headings are gone
- [X] T039 [US5] Run `cd packages/core && npm test`; fix until green

**Checkpoint**: US5 complete; the register exists and drives the markdown.

---

## Phase 8: User Story 6 — Presentable deck and PDF (P2)

**Goal**: a Slalom-branded, colour-coded HTML deck and PDF drawn from the register.

**Independent test**: open the deck and PDF with no extra tooling; executive slide, colour coding, branding and appendix are present and match the markdown (spec User Story 6 scenarios 1–8).

- [X] T040 [US6] Create `packages/core/src/templates/release-impact-deck-shell.ts` exporting one string (use `String.raw`; no backticks and no `${` inside) containing a self-contained HTML page: one brand-token block at the top (navy `#0b1437`, blue `#0C62FB`; rating colours red/orange/gold/green/grey, never blue), an embedded `application/json` block placeholder for the register, `@page` size 1280×720 with print colour adjustment, and a script that draws the slide set from the JSON per `contracts/output-files.md`: title (project, release, assessed date, Slalom branding); executive (recommendation + conditions, tier × rating heatmap, decide-by timeline using the shared day-count rule); top findings (featured, ≤ 8, compact cards); questions for owners; blind spots and verification pack; appendix (compact tables, a fixed number of findings per slide so the length limits cannot overflow) and sources. Behaviour for the edge cases: if every finding is Low or Not applicable, the executive slide says no action is needed before the upgrade; features Critical findings first by earliest date, up to 8, and when `featuredOverflow` > 0 the executive slide says how many further Critical findings are in the appendix. Constraints verbatim: no `{{` anywhere, no network URLs or external files or fonts, every rating shown as text as well as colour, exposure other than Confirmed shown as an outlined chip, Provisional/Unverified shown with a visible marker
- [X] T041 [US6] In `packages/core/src/templates/release-impact-assessment.ts` import the shell and add the "Write the deck and PDF" step: write the register file; write `impact-assessment.html` as the shell with the register inserted (re-emit the JSON, or substitute it with a shell command if Node/Python is available); then produce the PDF in this order — a Chromium-family browser run headless from the shell (`--headless=new --no-pdf-header-footer --print-to-pdf=…`, looked up on PATH and in standard install locations), a browser MCP tool that can save a page as PDF, else leave the HTML and tell the user how to Save as PDF (FR-026); say which route was used
- [X] T042 [US6] Add to the same step: the deck-and-PDF half of the update rule (FR-027; the register and markdown half is T037) so all four files are regenerated together, the rule that the markdown stays the authoritative record and the register holds nothing the markdown omits (FR-028), and that all files are written only under `{{paths.artifacts}}/releases/salesforce-{season-yy}/`
- [X] T043 [US6] Add shell tests to `packages/core/test/render.test.mjs`: shell contains no `{{`; no `http://` or `https://` resource URLs; exactly one brand-token block; rating colours contain no blue; its inline script parses (`new Function`); it contains no line of 40+ characters that also appears in any phase template or `devops/instructions/` fragment (Constitution III v1.1.0 limit on generated deliverables); the all-Low/N-A and >8-Critical behaviours are described; the shell appears verbatim in the rendered prompt; the deck/PDF step order and the no-browser fallback sentence are present
- [X] T044 [P] [US6] Create a developer-only preview helper that is **not** shipped: a short script under `scripts/` (documented in `quickstart.md` section 3) that builds `impact-assessment.html` from the shell and a sample register, so the deck can be opened and printed without running an assessment; it reads the fixture created in Phase 2
- [X] T045 [US6] Use T044 to open the deck in a browser and print it with headless Chrome; check one landscape 16:9 page per slide, colours printed, no overflow with a maximum-length register (every field at its limit, 30 findings, 8 featured), and that readability holds with colour removed (print greyscale); show the executive slide to someone who has not seen the report and record whether they can state the recommendation, top risks and next deadline within one minute (SC-006); fix the shell until it does
- [X] T046 [P] [US6] In `packages/vscode/src/handlers/release.ts` update the impact-assessment banner note to mention that a Chromium-family browser or a browser tool is used to produce the PDF and what happens without one

**Checkpoint**: US6 complete; all six stories done.

---

## Phase 9: Polish and cross-cutting

- [X] T047 Add the prompt-size ceiling test to `packages/core/test/render.test.mjs`: rendered impact-assessment prompt ≤ 14K tokens (characters ÷ 4) for JIRA, ADO and LOCAL (plan R10); if it fails, trim wording, not the shell
- [X] T048 [P] Update `README.md` (release section: the skill's inputs, the four output files, the optional PDF source), `DESIGN.md` and `DESIGN-mcp.md` (the new `release` argument and the form, the findings register and deck shell), and *repo-root* `CLAUDE.md` only if its architecture text is now inaccurate (constitution: docs change in the same PR); state in the release notes/PR that MCP, Copilot and Claude users get this only with the next tagged release, VS Code users via the daily instruction sync (Principle II)
- [X] T049 [P] Confirm `QUICK-START.md` and `QUICK-START-COPILOT.md` do not describe impact-assessment inputs as chat questions; update if they do
- [X] T050 Run all gates from `tools/otto/`: `pnpm -r build`, `pnpm -r typecheck`, `cd packages/core && npm test`, `node scripts/generate-copilot-agents.mjs --check`; fix until green
- [X] T051 Verify the PDF route on Windows and Linux (research R2): confirm the Chromium-family browser lookup paths and the headless print flags, or document in the template and `README.md` that the headless-browser route is verified on macOS only and the other platforms fall back to the browser-tool or Save-as-PDF routes
- [ ] T052 Brand sign-off (research R8): obtain Slalom's approved brand name and palette, compare with the tokens in the shell, update the single token block if they differ, and record the source in the PR; do not release with unconfirmed tokens
- [ ] T053 Org object check (research R7): in a real org, test the read-only queries a verification pack could carry (connected-app list, OAuth token last-used, login history); only then decide whether to add them to the template, otherwise leave Setup paths only; record the outcome
- [ ] T054 Run manual scenarios 1–7 from the spec's Verification Approach, recording for each the surface, model used and result: VS Code (with and without PDF, cancel at each step); Claude Code (preselect, cancel, bad "Other"); Copilot CLI and VS Code (form if supported, else fallback — record which); PDF route with no browser tool; truncated-section and index-only cases; repo-only run that omits connected apps; before re-running, copy the existing first report to a safe location as the baseline; then re-run on the reference project and compare length and findings against that baseline (SC-009), and ask the user to accept or reject the first deck as presentable without editing (SC-010)
- [ ] T055 After implementation run `/speckit-converge` until it reports "Converged" (per CONTRIBUTING.md; `/speckit-analyze` already ran before implementation); then open the PR containing the code and `specs/001-impact-assessment-forms-deck/`, closing #90, with the constitution gates filled in

---

## Dependencies and order

- **Phase 1 → Phase 2 → everything else.** T003–T008 (register contract) block US3's example validation, US5 and US6.
- **P1 stories first**: US1 (Phase 3) and US3 (Phase 4) are independent of each other; US1 touches VS Code/MCP/wrappers, US3 touches the template.
- **The template file is a single point of contention**: Phases 4–8 all edit `release-impact-assessment.ts`, so run them in order. Suggested order is the phase order, which also keeps the template coherent as it grows.
- **US6 depends on US5** (the register and tiers) and on Phase 2 (schema). **US2** can be done any time after Phase 3 but shares the template file.
- **Polish** after all stories; T052 and T053 can start earlier because they wait on people/orgs, not code.

### Parallel opportunities

- Phase 2: T007 (tests) alongside T005 once T004 is done.
- Phase 3: T011 and T012 (different files) in parallel; T028 and T046 (VS Code file) are independent of template work.
- Phase 8: T044 (preview helper) in parallel with T040 once the shell's shape is agreed.
- Polish: T048 and T049 in parallel; T052/T053 can run during Phases 4–8.

## Implementation strategy

1. **MVP** = Phases 1–3 (US1): the original complaint — inputs by form on every surface. Shippable on its own.
2. Add **US3** (Phase 4): trustworthy ratings — the core quality fix.
3. Add **US2, US4, US5** in order, then **US6** (deck) last because it depends on the register.
4. Run the gates after each phase; run the manual scenarios once at the end (T054).

## Task summary

| Phase | Story | Tasks |
|---|---|---|
| 1 Setup | — | T001–T002 (2) |
| 2 Foundational | — | T003–T008 (6) |
| 3 | US1 (P1) | T009–T016 (8) |
| 4 | US3 (P1) | T017–T024 (8) |
| 5 | US2 (P2) | T025–T028 (4) |
| 6 | US4 (P2) | T029–T032 (4) |
| 7 | US5 (P2) | T033–T039 (7) |
| 8 | US6 (P2) | T040–T046 (7) |
| 9 Polish | — | T047–T055 (9) |
| **Total** | | **55** |

---

## Phase 10: Convergence

*Appended by `/speckit-converge` (2026-10-01). T052–T054 above remain open and are not repeated here.*

- [X] T056 CRITICAL: Record the manual verification results (scenario, surface, model used, outcome) in `specs/001-impact-assessment-forms-deck/verification.md`, stating plainly which scenarios were not run, before the PR is raised per Constitution V (missing)
- [X] T057 Add the top-level `sandbox` field of the findings register (alias when `scope` is `repo+live`) to the Register table in `specs/001-impact-assessment-forms-deck/data-model.md`, matching `packages/core/src/findings.ts` per plan: data-model (partial)
- [X] T058 Record in `specs/001-impact-assessment-forms-deck/verification.md` whether `DESIGN.md` and `DESIGN-mcp.md` needed changes (the plan lists them as CHANGE; the release skills are not described there and the architecture is unchanged) per plan: source code layout (partial)
- [X] T059 Resolve the raw MCP prompt `/mcp__otto__release`, which accepts forms-capable clients but never shows the input form: either route it through the same helper or state it as chat-only in the spec's Surface Impact, per FR-001 (partial)

---

## Phase 11: Follow-ups from the reference-project run

*Added 2026-10-01 after inspecting the author's real run (see `verification.md`, "Divergences"). Decisions agreed with the author.*

- [X] T060 Treat register text limits as soft on the slide: clip long text in `packages/core/src/templates/release-impact-deck-shell.ts` (card area/summary/action, appendix area/evidence/action) and add "shorten it, never exceed it" to the pre-write self-check in `packages/core/src/templates/release-impact-assessment.ts` per FR-031
- [X] T061 Add the optional per-finding `decidingPartRead` field (≤ 200 characters) to `packages/core/src/findings.ts`: a partial source then no longer caps the finding; never lifts an index-only source; only valid with a cited partial source; update FR-008, `data-model.md` rules 1–2 and the template's cap wording per FR-008
- [X] T062 Show a "could break but cannot be ruled out from the repository" count and ids (impact `breaks`, exposure Unknown) on the executive slide and require the same sentence in the markdown's executive assessment per FR-030
- [X] T063 Add render and schema tests for T060–T062, raise the prompt-size ceiling test from 14K to 15K tokens with the reason recorded in `research.md` R10, and re-verify the deck at maximum lengths and on the real register per SC-007
