# Implementation Plan: Release impact-assessment — input forms, evidence-based ratings, presentable deck

**Branch**: `feat/GH-90-impact-assessment-input-forms-and-deck` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-impact-assessment-forms-deck/spec.md`

## Summary

Make the Release agent's impact-assessment skill collect its inputs through native forms on every
surface, rate findings only as high as the evidence allows, say early what the repository cannot
see, and produce — besides the markdown — a Slalom-branded slide deck and PDF.

Approach (details and rejected alternatives in [research.md](research.md)):

- **Inputs** — release list, release-number maths, validation and the "confirmed inputs" text live
  once in `@otto/core`; VS Code pickers and the MCP form call them. (Prototype exists; reviewed
  against the spec in the tasks.)
- **Quality** — the skill's template gains: a completeness check on fetched sections, an exposure
  vocabulary tied to a stated search, rating caps, a retrieval-scope check with a chat re-offer of
  the live check and a verification pack, a fixed tier/rubric scheme, and a pre-write self-check.
- **One register** — the agent builds a findings register (JSON, schema in core), then writes the
  markdown, the register file, the deck and the PDF from it.
- **Deck** — a fixed, self-contained HTML shell compiled into the template; the agent inserts the
  register and the shell draws every slide from it. PDF via headless Chromium-family browser, with
  ordered fallbacks.

No new MCP tools, no new dependencies, no config-schema change.

## Technical Context

**Language/Version**: TypeScript 5, Node.js 20+, pnpm 9+ workspace (per constitution).

**Primary Dependencies**: existing only — Zod (register schema), Handlebars (templates), MCP SDK
(form), VS Code API (pickers). No additions.

**Storage**: Files in the client project under `{paths.artifacts}/releases/salesforce-{season-yy}/`
(see [contracts/output-files.md](contracts/output-files.md)). No database.

**Testing**: `packages/core/test/render.test.mjs` (Node `node --test`) for template, helper and
schema assertions; manual scenarios for agent behaviour (spec → Verification Approach).

**Target Platform**: VS Code extension, Claude Code plugin (MCP stdio server), GitHub Copilot
pack/plugin (MCP stdio server + agent wrappers). Output opens in any modern browser.

**Project Type**: pnpm monorepo — shared core library plus three thin front ends.

**Performance Goals**: Rendered impact-assessment prompt ≤ 15K tokens (≈ 7.0K before this feature, ≈ 14.1K after; under the
16K warning threshold in `agent-defer.ts`). Register JSON for ~25 findings ≈ 5–7K tokens.

**Constraints**: Deck must open with no network and no external fonts/files; no `{{` inside the
shell (Handlebars); skill remains advisory and writes only under the artifacts folder; no client
data in Otto's repo or tests.

**Scale/Scope**: One assessment per Salesforce release per project; typical 15–30 findings; at
most 8 featured.

All items resolved; the open **Unverified** points are tracked in research.md (R2 non-macOS PDF
route, R5 truncation cause, R7 org object names, R8 brand tokens) and are handled by fallbacks,
by Setup-path-only content, or by explicit sign-off tasks — none blocks the design.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design — still passes, one item recorded.*

| Principle | Assessment |
|---|---|
| I. Core is the single source of truth | Pass. Release helpers, register schema, template and deck shell are in `@otto/core`; VS Code and MCP only supply widgets. No front end assembles inputs text itself. |
| II. Surface & PM parity | Pass. All three surfaces covered; CLI explicitly out (does not run phase agents). PM-independent skill. Chat fallback where forms are unsupported; Copilot form support to be recorded in manual scenario 3. Delivery: template and instruction changes reach MCP, Copilot and Claude users only with the next tagged release (the plugin is republished on tag) and VS Code users via the daily instruction sync — stated in the PR. |
| III. IP protection | Pass under constitution v1.1.0. Procedure text stays compiled into the template. The deck shell is presentation markup written into the client project as part of a generated deliverable, which Principle III's "Generated deliverables are not procedure" clause permits provided it holds no procedure text, instruction fragments, prompts or agent instructions. A render test asserts that. No change to usage tracking. |
| IV. Generated artifacts | Pass. Copilot wrappers edited under `copilot/agents/` and regenerated; no `dist/` or version edits. |
| V. Verify before done | Planned: build, typecheck, core tests, `generate-copilot-agents --check`, new render assertions, manual scenarios with surface and model recorded. |
| VI. Stable public surface | Pass. MINOR: additive `release` argument; additive output files; no config or menu change; phase boundaries unchanged (advisory, artifacts-only). |
| VII. Simplicity | Pass. No new dependency, no new MCP tool; the Zod register schema is justified in research R4; the existing prototype is reviewed, not rewritten. |

### Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Deck shell markup shipped into client projects (permitted by III v1.1.0; recorded for traceability) | The deck must be one self-contained file that opens anywhere; the layout must be identical every run | Agent-written HTML each run is inconsistent and costs 10–15K output tokens; an MCP renderer would not reach the VS Code surface |
| Register written twice (file + embedded in HTML) | A sibling-file load fails for local files in browsers | Single embedded copy would drop the saved register that the spec requires (FR-019) |

## Project Structure

### Documentation (this feature)

```text
specs/001-impact-assessment-forms-deck/
├── spec.md
├── plan.md                         # this file
├── research.md                     # decisions R1–R11
├── data-model.md                   # register, finding, source, blind spot, owner question
├── quickstart.md                   # how to validate
├── contracts/
│   ├── findings-register.md
│   ├── otto-prompt-release-arg.md
│   └── output-files.md
├── checklists/requirements.md
└── tasks.md                        # created by /speckit-tasks
```

### Source code (under `tools/otto/`, repo-root files marked)

```text
packages/core/src/
├── release-inputs.ts               # EXISTS (prototype): releases, parsing, confirmed-inputs text
├── findings.ts                     # NEW: register Zod schema, enums, cross-field rules
├── index.ts                        # export the two modules
└── templates/
    ├── release-impact-assessment.ts      # CHANGE: quality steps, register, self-check, deck + PDF steps
    └── release-impact-deck-shell.ts      # NEW: self-contained HTML shell string (no "{{")

packages/core/test/render.test.mjs        # CHANGE: new assertions (see below)
packages/core/test/fixtures/sample-findings.json   # NEW: valid sample register for tests and the preview helper
scripts/preview-impact-deck.mjs           # NEW, developer-only, not shipped: builds the deck from the shell and a sample register

packages/mcp/src/
├── elicit.ts                       # EXISTS (prototype): form incl. PDF field
└── tools.ts                        # EXISTS (prototype): release arg, form call, cancelled path

packages/vscode/src/handlers/release.ts   # EXISTS (prototype): pickers + file dialog; banner note for Chrome/PDF

plugin/commands/release.md                # EXISTS (prototype): release arg wording
copilot/agents/release.agent.md           # EXISTS (prototype): same
.github/agents/release.agent.md           # repo root, GENERATED from the line above

README.md, DESIGN.md, DESIGN-mcp.md       # CHANGE: release skill outputs and new argument
CLAUDE.md                                 # repo root, CHANGE only if the architecture text becomes inaccurate
```

**Structure Decision**: Extend the existing core + thin front ends layout. New logic goes only in
`packages/core`; the three front ends change only where they gather inputs.

## Test plan (render-test assertions to add)

1. Rendered prompt, for JIRA / ADO / LOCAL configs: no unresolved Handlebars; size ≤ 15K tokens.
2. Contains the confirmed-inputs phrase and the PDF-supplied step with "Skip 2a entirely".
3. Contains exposure vocabulary (Confirmed / Possible / Unknown) and the "command and count" rule.
4. Contains the caps wording: partial → Provisional, index-only → Unverified, both capped at
   Medium, with "read the full source to confirm".
5. Contains the completeness check (round-size signal, ends-mid-table signal) and re-read route.
6. Contains the retrieval-scope check, the chat re-offer of the live check, and the verification
   pack.
7. Contains the four tiers, the rubric, and the pre-write self-check list.
8. Contains the deck and PDF steps in order, and the no-browser fallback sentence.
9. Still read-only/advisory: no ticket transition wording, writes only under artifacts.
10. Deck shell: contains no `{{`, no `http://` or `https://` resource URLs, a single brand-token
    block, its script parses (`new Function`), and it contains no line of 40+ characters that also
    appears in any phase template or `devops/instructions/` fragment (Principle III limit).
11. Register: the template's example validates against the core schema; negative cases (Critical
    with a partial source, Confirmed without a search, 9 featured findings, `na` outside the
    not-applicable tier) fail validation with the expected rule.
12. Release helpers (already added): numbering, parsing, upcoming list, confirmed-inputs text.

## Open items carried into tasks

- Brand tokens (R8): obtain Slalom's approved palette and confirm; until then the shell uses the
  tokens in research.md and the PR notes it.
- Org object names for the verification pack (R7): test in a real org; Setup paths only until then.
- Non-macOS PDF route (R2): verify on Windows/Linux or document as macOS-verified (a task in the final phase).
- Copilot form support: record result of manual scenario 3.
