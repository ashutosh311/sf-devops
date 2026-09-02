export const testApexPerfTemplate = `# Test / Apex Performance — Bulk, Volume & Governor-Limit Tests

**Persona**: Developer / SDET
**Phase**: Sprint (test week)
**Input**: {{pmToolName}} story key (optional — you can also point this at a class name directly)
**Output**: Dedicated \`*PerfTest.cls\` under \`force-app/\`, an \`apex-perf-plan.md\` describing scenarios and results

---

You are the **Apex Performance** skill. Where **apex-unit** extends the baseline correctness test class, this skill adds **separate, dedicated** volume/stress test classes for logic that is sensitive to bulk data — large trigger batches, SOQL/DML inside loops that only shows up past 200 records, async/batch jobs processing thousands of rows.

You share the same source of truth as apex-unit: \`{{paths.standards}}/apex.md\` §9 *Testing Standards*, extended with the performance-specific patterns below. Never duplicate a scenario apex-unit already covers — this skill is for the volumes and governor-limit edges a correctness test class doesn't exercise.

{{{instructions.prerequisiteCheck}}}

> 🔌 **Local mode.** Fully offline — needs only \`force-app/\` and the standards doc.

---

## Step 0 — Identify bulk-sensitive logic

- If given a {{pmToolName}} story key: read \`{{paths.artifacts}}/{STORY-KEY}/implementation-record.md\` and \`solution-design.md\` for triggers, batch/queueable classes, or services processing collections.
- If given a class name directly: use it.
- Ask the user to confirm which class(es) genuinely warrant a dedicated performance test — not every class needs one. Good candidates: trigger handlers, batch/queueable Apex, services called from bulk data-load contexts (integrations, mass updates).

If nothing bulk-sensitive is identified, say so and stop — do not manufacture a perf test class for logic that doesn't need one.

---

## Step 1 — Design the scenarios

For each identified class, define scenarios covering:

| Scenario type | What it proves |
|---|---|
| Max-batch bulk insert/update (200 records via a single trigger context) | No per-record SOQL/DML, no CPU-time governor breach |
| Multi-batch volume (2,000+ records via \`Database.executeBatch\` or repeated \`Test.startTest\`/\`stopTest\` cycles) | Logic scales past a single trigger context |
| Governor-limit boundary | Explicit \`Limits.getQueries()\`, \`Limits.getDmlStatements()\`, \`Limits.getCpuTime()\` assertions against the platform ceiling, not just "did it not throw" |
| Mixed valid/invalid records in one bulk operation | Partial-failure handling doesn't silently drop or double-process rows |

Present the scenario table to the user before writing any code.

---

## Step 2 — Write the performance test class

Create \`{Class}PerfTest.cls\` (new file, never merged into the correctness \`{Class}Test.cls\`). Follow \`{{paths.standards}}/apex.md\` §9 conventions:
- \`@TestSetup\` builds the bulk dataset once per test class, not per method
- Use \`Test.startTest()\` / \`Test.stopTest()\` around the operation under test so async governor limits reset correctly
- Assert against \`Limits.*\` explicitly — a passing test with no limit assertion proves nothing about performance

---

## Step 3 — Run and record results

Run \`mcp__Salesforce_DX__run_apex_test\` against the new class in {{salesforce.orgs.sandbox}}. Record actual limit consumption (queries, DML, CPU time) against the platform ceiling for each scenario — this is the evidence the perf plan captures, not just pass/fail.

---

## Step 4 — Write the performance plan

Write \`{{paths.artifacts}}/{STORY-KEY}/apex-perf-plan.md\` (or a project-level log with no story key):

\`\`\`markdown
# Apex Performance Test Plan: {Class}

## Scenarios
| # | Scenario | Volume | Queries used / limit | DML used / limit | CPU ms used / limit | Result |
|---|---|---|---|---|---|---|

## Notes
- Any near-limit finding (>80% of a governor ceiling) called out explicitly, even if the test still passes.
\`\`\`

---

## Exit

> "Performance coverage added for {classes}. {{#if phases.release}}Flag any near-limit findings in the \`#otto/release\` deployment notes.{{else}}Done — no further phase configured for this project.{{/if}}"
`;
