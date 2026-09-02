---
title: Playwright E2E Standards
description: End-to-end test standards for Salesforce projects — folder layout, page-object pattern, Salesforce auth, Lightning DOM selector strategy, test-data strategy, CI execution, and flake policy.
scope: e2e, testing, playwright
enforce: always
---

# Playwright E2E Standards

---

## 1. Folder Layout

```
tests/e2e/
  fixtures/
    auth.ts          # Salesforce session bootstrap -> storageState
  pages/
    *.page.ts         # one page object per Lightning page/component
  *.spec.ts           # one spec file per feature/journey
playwright.config.ts   # project root
```

- One page object per distinct Lightning page or reusable component — never one giant page object covering the whole app.
- Specs are named after the feature/journey they cover, not the page (`case-triage.spec.ts`, not `casesPage.spec.ts`).

## 2. Salesforce Auth and Session State

- Prefer deriving a session from `sf org display --json` / the Salesforce MCP's `get_username` over storing a username/password anywhere in the repo or config.
- The bootstrapped session is written to Playwright's `storageState` and reused across specs via `tests/e2e/fixtures/auth.ts` — never re-implement login inside an individual spec.
- A `storageState` file is a **live Salesforce session token**. It MUST NEVER be committed:
  - `.auth/`, `test-results/`, and `playwright-report/` MUST be in `.gitignore` **before** the auth fixture is generated, not added afterward.
  - Never print a `storageState` file's contents to chat, logs, or a PR description.

## 3. Selector Strategy for Lightning DOM

Lightning regenerates CSS class names and DOM structure across releases — a spec built on CSS classes is brittle by construction.

- Prefer, in order: a stable `data-*` test attribute → an ARIA role/name (`getByRole`) → visible text (`getByText`) → CSS class (last resort, and only when nothing else identifies the element uniquely).
- Never select by Lightning's auto-generated ids (`li-*`, generated `aria-describedby` targets, etc.) — they are not stable across orgs or releases.
- When a component under test has no stable selector, add a `data-testid` to it as part of the story's Build work rather than working around the gap in the spec.

## 4. Test-Data Strategy

- Never hardcode a record Id from the target sandbox — sandbox refreshes invalidate them silently, producing flaky failures that look like product regressions.
- Prefer a dedicated test-data factory (Apex `@future`/REST call, or a `Setup`-scoped fixture) that creates and tears down its own records per spec run.
- If a spec must depend on stable reference data (e.g. a Record Type, a picklist value), assert its existence at the start of the spec with a clear failure message rather than assuming it silently.

## 5. Flake Policy

- A spec that passes once and fails on immediate rerun is not finished — run new/changed specs at least twice before considering them done.
- Fix the root cause of a flaky spec (selector drift, a genuine race condition, test-data collision) — never paper over flake with a blanket `waitForTimeout` or a bumped retry count.
- `playwright.config.ts` sets `retries` for CI runs only (to absorb genuine environment flake — network blips, sandbox warm-up), not as a substitute for a correct wait condition.
- Trace-on-first-retry MUST be enabled so a CI flake is debuggable without local reproduction.

## 6. CI Execution

- E2E is the most expensive validation tier — by default it runs only on the project's most mature CI tier (see `pipeline-scripts/`), not on every feature-branch validation build. Confirm the tier with the team before wiring it in; this is a per-project decision, not a fixed rule.
- CI runs use the `npm run test:e2e` script (added by `#otto/test` → **pw-setup**) — never invoke `npx playwright test` directly in a pipeline step, so the local and CI entry points can't drift.
