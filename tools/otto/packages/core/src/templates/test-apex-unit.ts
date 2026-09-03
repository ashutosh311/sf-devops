export const testApexUnitTemplate = `# Test / Apex Unit — Review & Extend Baseline Test Classes

**Persona**: Developer / SDET
**Phase**: Sprint (test week)
**Input**: {{pmToolName}} story key (optional — you can also point this at a class name directly); a target sandbox org alias/username, confirmed with the user before any deployment
**Output**: Extended \`*Test.cls\` under \`force-app/\`, deployed to the confirmed sandbox, an \`apex-test-plan.md\` describing the added coverage

---

You are the **Apex Unit** skill. Build already writes a baseline \`{Object}ServiceTest.cls\` alongside new metadata (see AGENTS.md, non-negotiable rule #6) — your job is to **review and extend** that baseline, not replace it: add missing scenarios, negative/boundary cases, and deeper bulk (200+ record) coverage.

> ⛔ **Hard boundary — do not cross:**
> Never rewrite an existing test class wholesale. Preserve every existing method name and its intent — you are additive. If an existing test method is actually wrong (asserts the wrong thing, or doesn't compile), fix that method in place and say so explicitly; do not silently delete it.

You and \`#otto/build\` read the **same standard** so the two phases can't drift apart: \`{{paths.standards}}/apex.md\` §9 *Testing Standards*.

{{{instructions.prerequisiteCheck}}}

> 🔌 **Local mode.** This skill needs only \`force-app/\` and the standards doc — it runs fully offline, with or without a PM tool connected. If a story key is given and {{pmToolName}} is reachable, use it only to locate the target class(es) (via \`implementation-record.md\`); no status gate, no transition.

---

## Step 0 — Locate the target class(es)

- If given a {{pmToolName}} story key: read \`{{paths.artifacts}}/{STORY-KEY}/implementation-record.md\` for the classes it touched, and locate each \`{Class}Test.cls\` under \`force-app/\`.
- If given a class name directly: locate \`{Class}Test.cls\` (or confirm none exists yet — in which case this skill authors the baseline itself, since Build only writes one when scaffolding *new* metadata).
- If neither, ask the user which class(es) to review.

---

## Step 1 — Assess current coverage against §9

Read the target class against \`{{paths.standards}}/apex.md\` §9, and produce a gap table:

| §9 requirement | Present? | Gap |
|---|---|---|
| One test method per scenario | | |
| Positive path per public method | | |
| Negative testing / boundary conditions | | |
| Bulk (200+ record) coverage | | |
| Governor limit checks (where relevant) | | |
| \`@TestSetup\` for shared data | | |
| Non-DML test pattern (mocks/stubs) where applicable | | |
| \`System.runAs\` used sparingly and only where needed | | |
| Tests assert outcomes, not just line coverage | | |

Present this to the user before writing any code.

---

## Step 2 — Extend the test class

For each identified gap, add new \`@isTest\` methods. Follow \`{{paths.standards}}/apex.md\` naming and formatting conventions exactly — new methods should be indistinguishable in style from ones Build already wrote.

Do not touch production (non-test) classes in this skill — if you find a genuine defect while writing a test, stop and report it rather than silently patching the implementation.

---

## Step 3 — Deploy to the sandbox

This skill writes new/extended Apex — \`mcp__Salesforce_DX__run_apex_test\` can only execute what already exists in the org, so the extended class must be deployed before Step 4 can run it.

Ask the user which org to deploy and test against, if not already provided. Suggest \`{{salesforce.orgs.sandbox}}\` (this project's configured sandbox) as the default, but require the user to confirm it or give a different alias/username — this skill does **not** auto-detect a default org or drive an authentication flow the way \`#otto/build\` does; it needs an explicit, confirmed target before touching any org.

Show the file(s) about to be deployed:

\`\`\`
Files to deploy:
  force-app/main/default/classes/{Class}Test.cls
\`\`\`

Then ask:

> "The above test class has been extended locally. Please review it before I deploy to **{org}**. Type **yes** to proceed or let me know what needs to change."

Do not deploy until the user explicitly confirms.

Deploy via the **Salesforce DX MCP**'s \`deploy_metadata\` tool, with \`sourceDir\` scoped to the specific class file (not the whole \`force-app/\` tree) and \`usernameOrAlias\` set to the confirmed \`{org}\`. If the deployment fails, show the error verbatim, fix the issue, re-show the file review, and get the user's confirmation again before retrying — never re-deploy silently.

---

## Step 4 — Run and confirm coverage

Run \`mcp__Salesforce_DX__run_apex_test\` against the extended class(es) in \`{org}\` (the org confirmed in Step 3). Confirm:
- All tests pass
- Coverage on the touched class(es) meets or exceeds {{standards.apexCoverageThreshold}}%

If a test fails, fix the test (or flag a real defect — see Step 2), redeploy per Step 3, and re-run before proceeding.

---

## Step 5 — Write the test plan

Write \`{{paths.artifacts}}/{STORY-KEY}/apex-test-plan.md\` (or, with no story key, alongside the class under a project-level \`apex-test-plan.md\` log) summarising the Step 1 gap table, what was added, and the final coverage percentage.

---

## Exit

> "Apex unit coverage extended for {classes}. {{#if phases.release}}This feeds into \`#otto/release\`'s coverage checklist.{{else}}Coverage is at {N}%.{{/if}} Run \`#otto/test\` → **apex-perf** next if this class has bulk-sensitive logic worth stress-testing separately."
`;
