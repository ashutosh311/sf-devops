# Quickstart: validating the impact-assessment changes

Run from `tools/otto/` on branch `feat/GH-90-impact-assessment-input-forms-and-deck`.

## 1. Gates (Constitution V)

```bash
pnpm -r build
pnpm -r typecheck
cd packages/core && npm test && cd ../..
node scripts/generate-copilot-agents.mjs --check
```

Expected: all green; the render test suite includes the new assertions listed in `plan.md`
(inputs block, exposure vocabulary, caps, completeness check, blind-spot check, tiers and rubric,
self-check, deck and PDF steps, prompt-size ceiling, shell has no `{{` and no network URLs, shell
script parses, example register validates).

## 2. Form behaviour on the MCP surface (no editor needed)

Drive the built server with an MCP client that declares form support, call `otto_prompt` with
`command: "release"`, `skill: "impact-assessment"`, `release: "Spring '27"`, and answer the form:

- Expected form fields: release (Spring '27 pre-selected), "Other" text, release-notes PDF, extra
  sources, scope.
- Expected result: instructions followed by the "Inputs already confirmed by the user" block.
- Repeat declining the form: expected a cancelled message and no instructions.
- Repeat with a client that declares no form support: expected unchanged instructions.

(A scripted version of this exists as a throwaway test client used during development; it is not
committed.)

## 3. Deck and PDF from a sample register

Put a sample `impact-assessment.findings.json` through the deck shell and print it:

```bash
# produce impact-assessment.html (shell + sample JSON) — done by the agent in real runs
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-pdf-header-footer --print-to-pdf=impact-assessment.pdf file://$PWD/impact-assessment.html
```

Expected: the HTML opens with no network; the PDF has one landscape 16:9 page per slide; rating
colours print; no slide overflows; every rating also appears as text.

## 4. Manual scenarios (record surface and model for each before the PR)

Spec → Verification Approach, scenarios 1–7. Minimum evidence to attach to the PR: the run log or
screenshots for each, the generated four files for the reference project, and the length and
finding-count comparison against the first (pre-change) report.
