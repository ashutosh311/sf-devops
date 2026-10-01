# Verification record — GH #90

Manual and scripted verification of `spec.md` → *Verification Approach* (Constitution V). Written
2026-10-01. "Not run" means exactly that; nothing here is inferred.

## Gates (from `tools/otto/`)

| Gate | Result |
|---|---|
| `pnpm -r build` | pass |
| `pnpm -r typecheck` | pass |
| `cd packages/core && npm test` | pass — 107 tests |
| `node scripts/generate-copilot-agents.mjs --check` | pass — 8 agents in sync |
| `node scripts/package-instructions.mjs`, `package-plugin.mjs`, `package-copilot.mjs` | build without error |

## Manual scenarios

| # | Scenario | Surface | Model | Result |
|---|---|---|---|---|
| 1 | Picker sequence, PDF choice, cancel; four files written | VS Code (Copilot Chat agent mode), `.vsix` built from commit 5c35db2 | not recorded | **Run by the author on 2026-10-01: "worked as expected."** Sub-cases (with/without PDF, cancel at each step) were not itemised. The VS Code handler was then changed by review fixes (commit 1e1feff: typed-release pre-selection, Esc on the sources step, multi-root path, shared pre-selection) — **re-test with a rebuilt `.vsix`: not run.** |
| 2 | Form with release pre-selected from the command; cancel; bad "Other" | Claude Code plugin | n/a | **Scripted only**, with an MCP test client that supports forms, in plugin surface mode: form shown with the release pre-selected; accepted → confirmed-inputs block appended; declined → cancelled message, no instructions; form request failing → instructions returned for chat. **Not run in a live Claude Code session.** |
| 3 | Form where supported, otherwise chat fallback | Copilot CLI and VS Code | n/a | **Scripted only** (`--surface=copilot`), same results as scenario 2, and no-form-support returns unchanged instructions. **Whether live Copilot clients support MCP forms: unknown — not run.** |
| 4 | PDF route with no browser tool | any | — | **Not run.** Conversion with `markitdown` and the title check are agent behaviour; not exercised live. |
| 5 | Truncated section and index-only finding cannot exceed Medium | any | — | **Covered by tests only** (schema rules and template wording). Not run live. |
| 6 | Repository-only run that omits connected apps: blind spots, chat re-offer, verification pack | VS Code (author's run; to be confirmed) | not recorded | **Run** — see *Real run*. Blind spots and verification pack present; the chat re-offer is not evidenced by the files. |
| 7 | Re-run on the reference project and compare length and findings with the first report (SC-009) | VS Code (author's run; to be confirmed) | not recorded | **Run** — markdown 40.2% shorter; every finding from the first report still appears, but several are now rated lower (see divergence 3). |

## Real run — reference project (2026-10-01)

The author ran the skill against the reference project (a client repository; no client data is
reproduced here) with the VS Code build and supplied a release-notes PDF. Output inspected by the
reviewer: four files, `impact-assessment.{md,findings.json,html,pdf}`. Model and surface were not
recorded by the run and are to be confirmed by the author.

| Check | Result |
|---|---|
| All four files written under `artifacts/releases/salesforce-winter-27/` | pass |
| Deck PDF | pass — 14 landscape 16:9 pages (18 findings, 8 featured, 22 sources); executive and top-findings slides inspected |
| Markdown follows the new outline; no repeated priority/traceability tables | pass — each finding once (12 detailed, 5 compact Opportunities, 1 Not-applicable line) |
| SC-009: markdown shorter than the first report | pass, narrowly — 39,182 → 23,413 bytes (−40.2%) |
| Rating and tier follow the rubric | pass — 0 mismatches against the schema's rubric check |
| Markdown and register agree on ratings and "in N days" wording | pass — 0 mismatches |
| Confirmed exposure cites a search and a count | pass — 3 of 3 (sharing: `GroupMember` grep, 4 classes; Visualforce PDF: `renderAs="pdf"`, 1 page; guest self-registration, 11 classes) |
| Visualforce now in the inventory | pass — the Visualforce PDF page was found; the first report missed the area entirely |
| Blind spots stated up front with a verification pack, Setup paths only | pass — 6 blind spots, no org object names |
| PDF route | ran — 1 PDF source (+ 3 converted) alongside 18 fetched pages, so this was **not** a "no browser tool" run (scenario 4 still open) |
| Partial source recorded when extraction was cut off | pass — S-22 recorded as partial with the truncated part named |
| Live-check re-offer in chat | not evidenced by the output files |

### Divergences from the rules found in the real run

1. **Schema violations (8)** when the produced register is validated: three `area` values over 60
   characters (61, 61, 71) and one `evidence` over 320 (332). The agent exceeds field limits by a few
   characters; nothing validates the register at run time.
2. **Partial sources not carried to findings.** Source S-20 is partial (a long multi-cloud table, only
   the relevant rows read) and is cited by F-04 and F-05, both rated Medium with caveat `none` and no
   "Read the full source to confirm" action. The agent judged the unread part irrelevant to those
   findings. The schema, and the template's wording, treat any cited partial source as Provisional.
   FR-008's own wording ("the part that determines who is affected was read in full") is per finding,
   so source-level completeness is coarser than the rule it serves.
3. **Unknown exposure lowers severity.** Because the rubric treats Unknown like Possible, items
   hidden behind a blind spot rate Low/Medium (for example "Migrate connected apps to external client
   apps" is Low; OAuth flow retirements are Medium; the first report rated both Critical). The
   blind-spot section, the conditions and the verification pack carry the warning, but the rating
   alone under-signals.

**Resolved in follow-up commits (tasks T060–T063):** (1) text limits are soft on the slide — long text is clipped, and the self-check says "shorten it, never exceed it"; (2) a finding may cite a partial source without being capped when it records `decidingPartRead`; (3) the executive slide and the markdown now state how many findings could break existing behaviour but have unknown exposure, and list them (on the real register: 8). The real register still fails validation until the agent re-runs with the updated instructions; the re-run is not yet done.

## Deck and PDF (scripted)

- Sample register → 8 slides; maximum-length register (28 findings, every field at its limit, 8
  featured, 2 Critical overflow, 12 sources, 7 blind spots) → 14 slides, exactly one landscape
  16:9 PDF page per slide, no overflow, colours printed, readable in greyscale (every rating and
  exposure also shown as text). Verified with headless Google Chrome on macOS only.
- A register with hostile values in `rating` and `recommendation` renders inertly (no markup or
  attribute injection).
- Sample deck reviewed and accepted by the author as a preview (2026-10-01). SC-006 (one-minute
  read) and SC-010 (presentable without editing) have **not** been measured on a real assessment.

## Documentation

`README.md` updated. `DESIGN.md` and `DESIGN-mcp.md` were not changed: neither describes the Release
skills, and the architecture is unchanged (no new layer, tool or package), so the plan's "CHANGE"
for them is satisfied by this note. `QUICK-START*.md` do not describe impact-assessment inputs.

## Open before release (not blocking the PR)

- **T052** Slalom brand tokens are from a personal slide template, not confirmed against brand
  guidelines.
- **T053** Org object names for the verification pack are untested; the pack uses Setup paths only.
- **T054** Scenario 1 re-test of the rebuilt `.vsix`; scenario 4 (no browser tool); scenario 5 live; live Claude Code and Copilot runs. Scenarios 6 and 7 were run (above).
