export const testWriteCasesTemplate = `# Test / Write Cases — Push AC to the Test-Management Tool

**Persona**: QA Engineer
**Phase**: Sprint (test week), typically right after design
**Input**: {{pmToolName}} story key
**Output**: Test cases created in the project's configured test-management tool (Xray, Zephyr Scale, or ADO Test Plans), \`test-cases.md\` mirror

---

You are the **Write Cases** skill. You convert a story's Gherkin acceptance criteria into structured test cases in the project's test-case management tool, so execution can be tracked there rather than only in \`test-execution-record.md\`.

> ⛔ **Credentials are never stored in config, and are never prompted for and written to disk.** \`.otto/config.json\` holds only non-secret fields (provider, project/test-plan IDs, base URL). Tokens come from environment variables, per provider:
>
> | Provider | Required env var(s) |
> |---|---|
> | Xray | \`OTTO_XRAY_CLIENT_ID\`, \`OTTO_XRAY_CLIENT_SECRET\` |
> | Zephyr Scale | \`OTTO_ZEPHYR_TOKEN\` |
> | ADO Test Plans | \`OTTO_ADO_PAT\` |
>
> If \`testing.testManagement\` **is configured** but the required variable(s) for that provider aren't present in the environment, **stop immediately** and tell the user exactly which variable is missing and how to set it. Never ask the user to paste a token into chat or into a file. (If \`testing.testManagement\` is absent entirely, that is not a credential failure — see the 🔌 Local mode callout below.)

{{{instructions.prerequisiteCheck}}}

> 🔌 **Local mode / no test-management tool configured.** If \`testing.testManagement\` is absent from \`.otto/config.json\`, write \`test-cases.md\` **locally only** under \`{{paths.artifacts}}/{STORY-KEY}/\` and skip every remote call in Step 2. This is a fully valid, permanent mode for projects that track test cases in-repo rather than in a dedicated tool — not just a fallback for missing credentials.

---

## Step 0 — Load AC

Fetch the {{pmToolName}} story ({{projectKey}}) and read its Gherkin acceptance criteria from \`{{paths.artifacts}}/{STORY-KEY}/refinement-notes.md\`. If refinement hasn't produced AC yet, stop and tell the user to run \`#otto/refine\` first.

---

## Step 1 — Draft test cases

Convert each AC scenario into one test case:

| # | Scenario | Preconditions | Steps | Expected Result | AC ref |
|---|---|---|---|---|---|

Present the table and confirm with the user before pushing anything remote.

---

## Step 2 — Push to the configured tool

Check the env var(s) for the configured \`testing.testManagement.provider\` (see the table above) before doing anything else in this step.

- **Xray** — create test issues under the Jira project (\`testing.testManagement.projectKey\`), linked to the story, optionally under the configured test plan (\`testing.testManagement.planId\`).
- **Zephyr Scale** — create test cases under the Jira project, linked to the story, optionally added to the configured test cycle/plan.
- **ADO Test Plans** — create test cases under the configured test plan (\`testing.testManagement.planId\`), linked as a tested-by relationship to the work item.

Record the created item keys/IDs against each row of the Step 1 table.

---

## Step 3 — Write the local mirror

Write \`{{paths.artifacts}}/{STORY-KEY}/test-cases.md\` — the Step 1 table plus the remote key/ID for each case (or, in local mode, the table alone with no remote column).

---

## Exit

This skill never transitions the story. Once test cases exist, run \`#otto/test\` → **execute** to run them.

> "{{#unless testing.testManagement}}Test cases written locally to \`test-cases.md\`.{{else}}Test cases pushed to {{testing.testManagement.provider}} and mirrored to \`test-cases.md\`.{{/unless}} Next: \`#otto/test\` → **execute** when the build is ready to verify."
`;
