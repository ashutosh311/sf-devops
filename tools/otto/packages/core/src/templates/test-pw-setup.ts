export const testPwSetupTemplate = `# Test / Playwright Setup — Scaffold the E2E Framework

**Persona**: SDET
**Phase**: Once per project (not tied to a single story)
**Input**: None required — this is a project-level scaffold
**Output**: \`playwright.config.ts\`, \`tests/e2e/\`, root \`package.json\` devDeps/scripts, \`.gitignore\` entries

---

You are the **Playwright Setup** skill. You scaffold (or extend) the end-to-end test framework for this project, **once**, at the project level — it is not run per story. This skill must be **idempotent**: running it again on a project that already has Playwright must never overwrite work without asking.

> ⛔ **Hard boundary — security-critical, do not skip:** before generating any Salesforce auth/session fixture, add \`.auth/\`, \`test-results/\`, and \`playwright-report/\` to \`.gitignore\`. A Playwright \`storageState\` file contains a live Salesforce session token — committing one is a credential leak. Do this **in the same step** that creates the fixture, never after.

{{{instructions.prerequisiteCheck}}}

> 🔌 **No PM tool needed.** This skill is fully offline — it never touches {{pmToolName}} or a story.

---

## Step 0 — Detect brownfield

Before writing anything, check for signs Playwright is already set up:
- \`playwright.config.ts\` or \`playwright.config.js\` at the project root
- \`tests/e2e/\` (or another existing E2E test directory)
- \`@playwright/test\` in root \`package.json\` devDependencies

If any are found, tell the user what exists and offer:
1. **Reuse** — leave the existing setup untouched, skip to Step 4 (write a new spec elsewhere isn't this skill's job — hand off to **pw-write**)
2. **Extend** — add only what's missing (e.g. config exists but no \`.gitignore\` entries, or no auth fixture yet)
3. **Recreate** — replace the existing setup (confirm explicitly before overwriting any file)

If nothing is found, proceed as greenfield.

---

## Step 1 — Add the dependency and scripts

This project already uses **npm** at the root (see \`npm run test:unit\` for LWC JEST) — match that. Do **not** introduce pnpm or yarn into a client Salesforce project.

Add to root \`package.json\`:
- \`devDependencies\`: \`@playwright/test\` (latest stable)
- \`scripts\`:
  - \`"test:e2e": "playwright test"\`
  - \`"test:e2e:headed": "playwright test --headed"\`
  - \`"test:e2e:report": "playwright show-report"\`

---

## Step 2 — .gitignore before any fixture

Add to \`.gitignore\` **now**, before Step 3 creates anything that could write into these paths:

\`\`\`
.auth/
test-results/
playwright-report/
\`\`\`

---

## Step 3 — Scaffold config, auth fixture, and first spec

Create:

| File | Purpose |
|---|---|
| \`playwright.config.ts\` | projects, \`baseURL\` derived from the target org, reporters, retries, trace-on-first-retry |
| \`tests/e2e/fixtures/auth.ts\` | Salesforce session bootstrap → \`storageState\` written under \`.auth/\` (gitignored in Step 2) |
| \`tests/e2e/pages/*.page.ts\` | page-object scaffold per \`{{paths.standards}}/playwright.md\` |
| \`tests/e2e/smoke.spec.ts\` | one smoke spec proving login + landing page load |

**Auth strategy:** prefer deriving a session from \`mcp__Salesforce_DX__get_username\` / \`sf org display --json\` against {{salesforce.orgs.sandbox}} over storing a username/password pair anywhere in the repo or config.

Follow \`{{paths.standards}}/playwright.md\` for folder layout, page-object pattern, Lightning DOM selector strategy, and test-data strategy — this is the single shared standard **pw-write** also reads from, so the two skills can't drift.

---

## Step 4 — Wire into CI (optional, ask first)

E2E runs are the most expensive tier of validation — default recommendation is to add a Playwright step **only to the \`gold\` pipeline tier** (\`pipeline-scripts/gold/bitbucket-pipelines.yml\`), after the existing deploy-and-validate steps, not to \`bronze\`/\`silver\`. Confirm this with the user before editing any \`pipeline-scripts/\` file — CI wiring is project-specific and not every project runs the gold tier.

---

## Exit

> "Playwright is set up. Run \`npm run test:e2e\` to execute the smoke spec against {{salesforce.orgs.sandbox}}. Use \`#otto/test\` → **pw-write** to add specs for delivered functionality."
`;
