# Research: Release impact-assessment — forms, evidence-based ratings, deck

Decisions that the spec deferred to planning. Each was checked against the codebase or a small
throwaway experiment on 2026-10-01; items I could not verify are marked **Unverified**.

## R1 — How the HTML deck is produced

**Decision**: A fixed HTML "deck shell" (CSS + a small script, no external resources) is compiled
into the impact-assessment template. The agent copies the shell verbatim and inserts the findings
list as a JSON block; the shell's script draws every slide from that JSON in the browser.

**Rationale**
- Styling and layout are identical on every run (the agent supplies data, not design).
- Deck content cannot drift from the register: both come from the same JSON.
- Works on every surface with no tool beyond file writing. A renderer exposed as an MCP tool would
  not reach the VS Code surface — `agent-defer.ts` hands the prompt to a Copilot Chat agent-mode
  session that only has the MCP servers the user registered there; Otto's MCP server is not
  guaranteed to be one of them.
- Verified: a prototype page that builds its slides from an embedded JSON block printed with
  headless Chrome to one PDF page per slide (4 pages for a title slide plus 3 findings), with the
  script executed and the risk colours preserved.

**Alternatives considered**
- *Agent writes the whole HTML each run*: inconsistent look, and ~10–15K output tokens per run for
  markup that carries no information.
- *Renderer shipped as an MCP tool*: rejected for the VS Code reason above; also adds a public
  tool name.
- *Renderer script run by the agent (`node -e`)*: needs a runtime the template currently treats as
  optional, and pushes a large script through shell quoting.
- *pptx*: out of scope per the spec.

## R2 — How the PDF is produced

**Decision**: Try in this order, and say which was used: (1) a Chromium-family browser run
headless from the shell (`--headless=new --no-pdf-header-footer --print-to-pdf=…`), looked up on
PATH and in the standard install locations; (2) a browser MCP tool that can save a page as PDF,
if one is exposed; (3) leave the HTML and tell the consultant to use Print → Save as PDF.

**Rationale**: Option 1 was verified on macOS with Google Chrome (Edge is also installed).
Slide size is set in the page's print rules (`@page` 1280×720) so the PDF is landscape 16:9.

**Unverified**: Windows and Linux install paths and flag behaviour; whether the Playwright MCP
exposes a PDF tool in a given configuration (it is capability-gated in some versions). Hence the
ordered fallback and the guaranteed third step.

## R3 — Register file versus deck data (duplication)

**Decision**: The agent writes `impact-assessment.findings.json` (the register, per FR-019), then
writes the deck HTML with the same JSON inlined. If a shell with Node or Python is available the
agent MAY inline it by substitution instead of re-emitting it; this is an optimisation, not a
requirement.

**Rationale**: A deck that loads the sibling file at open time fails for local files in browsers
(blocked cross-file reads) and would no longer be self-contained. The cost is emitting the JSON
twice (about 5–7K tokens each for ~25 findings), which is less than the ~10K tokens the old
markdown cost and buys a reusable register.

**Mitigation**: Schema limits on field lengths (R7) keep the JSON compact.

## R4 — Where the invariants are enforced

**Decision**: Enforced by the template's pre-write self-check (agent-applied) and asserted at
build time by tests against a sample register: a Zod schema in core defines the format and the
cross-field rules; the render test validates the template's embedded example against it.

**Rationale**: No surface can run code on the agent's behalf, so a runtime validator would need a
new tool. The schema still earns its place: it is the single definition of the register contract,
it guards the example the agent copies, and it is the foundation if a validator tool is added
later (out of scope).

**Alternative rejected**: a new `otto_validate_findings` MCP tool — same VS Code reach problem as
R1 and a new public tool name for a check the agent can do from instructions.

## R5 — Detecting an incomplete fetched section (FR-007)

**Decision**: After each section is saved, the agent checks: size is not a round cap value
(the observed truncation was exactly 4,096 bytes), the text ends on a sentence or a complete table
row, and tables have more than their header row where the page showed more. If any check fails it
re-extracts (second route: accessibility snapshot, or the PDF), and if that also fails marks
dependent findings Provisional.

**Rationale**: The cause of the truncation is not established (**Unverified**) — it may be a limit
in the browser tool's save option. A symptom-based check works whatever the cause. A supplied PDF
avoids the route entirely.

## R6 — Retrieval-scope check (FR-015)

**Decision**: Compare the project's retrieval manifest (and the folders actually present) with the
metadata types the term list needs, using a fixed mapping of release topic → metadata type held in
the template (e.g. OAuth/connected apps → `ConnectedApp`, `ExternalClientApplication`,
`NamedCredential`; profile filtering → `Profile`, `PermissionSet`; flows → `Flow`). Missing types
become blind spots tied to the findings whose topic needs them.

**Rationale**: In the test run the information was in the manifest but only surfaced as a caveat at
the end. The mapping is small and static; it does not need the org.

## R7 — Verification pack content (FR-017) and register size limits

**Decision**: For each blind spot the pack gives a Setup path and, where useful, a read-only query.
Candidate objects: `ConnectedApplication`, `OauthToken` (last-used date), `LoginHistory`.
**Unverified**: exact object and field names and their availability by edition and API version —
they must be tested in a real org before they are written into the template; until then the pack
uses Setup paths only. Register fields carry length limits (summary ≤ 240 characters, evidence ≤
320, action ≤ 200) so the appendix slides fit and the JSON stays small; full detail lives in the
markdown.

## R8 — Brand and colour

**Decision**: Brand tokens live in one block at the top of the shell: navy `#0b1437` and blue
`#0C62FB`, taken from the existing Slalom presentation template in the author's vault. Rating
colours are deliberately not blue: Critical red, High orange, Medium gold, Low green, Not
applicable grey. Every rating is also shown as a text label, and exposure other than Confirmed is
shown with an outlined (not filled) chip, so meaning never depends on colour alone.

**Unverified**: that these tokens match Slalom's official brand guidelines. They come from a
personal template, not a brand-guidelines source. Must be confirmed before release; the single
token block makes the change one edit.

## R9 — Relative dates (FR-022)

**Decision**: The register stores absolute dates plus the assessment date. The agent states
"in N days (date)" using one computed number per finding and reuses that wording everywhere; the
deck shell computes the same number from the two dates, so the deck cannot disagree with itself.

## R10 — Prompt size

**Decision**: Budget the rendered impact-assessment prompt at ≤ 15K tokens (raised from 14K on 2026-10-01 when the deciding-part rule, field-limit wording and the unknown-exposure callout were added; it measures ≈ 14.1K, and the VS Code size warning is at 16K). Today it is ≈ 7.0K
(27.9K characters, measured). The deck shell is estimated at 2.5–3K tokens; the new steps and
register description at 2–3K. This stays under the 16K token warning threshold in
`agent-defer.ts`. A render test asserts the ceiling so growth is caught.

## R11 — Spec Kit scripts on this machine

`.specify/scripts/bash/*.sh` are not executable and fail under `sh` here; they run under `bash`.
Not part of the feature; noted so the next person is not surprised.
