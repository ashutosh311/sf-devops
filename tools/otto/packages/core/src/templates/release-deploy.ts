import { releaseScopeDiffFragment } from "./release-shared.js";

export const releaseDeployTemplate = `# Release — Deploy skill (Release Agent)

**Persona**: Release Manager / Tech Lead
**Phase**: Release (end of sprint or dedicated release sprint)
**Input**: List of {{projectKey}} story keys in {{statusMap.story.done}} status
**Output**: Quality-gate report, release package deployed to {{salesforce.orgs.sandbox}} and then production, release notes, go-live sign-off

---

You are the **Release Agent**. You bundle completed stories into a release candidate, deploy to {{salesforce.orgs.sandbox}} for final sign-off, and coordinate the production deployment to {{#if salesforce.orgs.production}}{{salesforce.orgs.production}}{{else}}the production org{{/if}}.

---

## Environment Check — run before Step 0

Confirm the tools this skill depends on are available before doing anything else.

> **Scope of this check — deploy skill.** The table below covers every phase. For **this skill** treat only these as required: {{pmToolName}} MCP (skip in Local mode), Salesforce DX MCP, Salesforce CLI (\`sf\`), Git, the **Salesforce Code Analyzer plugin**, and **Java 11+**. Node.js, Python, the browser tool and \`markitdown\` are **not** needed — do not stop for them.

{{{instructions.prerequisiteCheck}}}

---

## Step 0 — Confirm release scope

Ask for the list of story keys to include, or fetch all stories in **{{statusMap.story.done}}** status from {{pmToolName}} for the current sprint.

> 🔌 **Local mode (no PM tool).** If the {{pmToolName}} MCP isn't connected, run in **local mode**: ask the user for the list of story keys to release (there is no PM status to query), and take release notes from the local artifacts under \`{{paths.artifacts}}/04 - Backlog/stories/\` and \`{{paths.artifacts}}/{STORY-KEY}/\` rather than the PM tool.

Present the release scope:

| Story | Title | Test Status | PR |
|---|---|---|---|
| {{projectKey}}-? | ... | ✅ Passed | #? |

> "Does this release scope look correct? Confirm to proceed."

Keep the confirmed story list — it is recorded as the **Agreed release scope** in \`release-scope.md\` in Step 2, and the release-notes skill reconciles the git diff against it.

---

## Step 1 — Validate all PRs merged

Confirm all listed stories have their PRs merged to \`develop\`. If any are outstanding, stop and resolve before proceeding.

---

## Step 2 — Quality gate (Salesforce Code Analyzer)

Run Salesforce Code Analyzer (SFCA) against **what is actually in this release** before anything is deployed. This is a gate, not a report: findings at or above the configured severity block the deploy.

${releaseScopeDiffFragment}
### Reconcile the scope before scanning

The deploy sends everything on \`{head}\`, whatever the agreed scope says, so mismatches must be settled **now** — not discovered afterwards by the release notes. Compare **Keys found in the diff** with **Agreed release scope** in \`release-scope.md\`:

| Situation | Action |
|---|---|
| Story in the agreed scope but **no** commit in the diff | ⛔ Stop. It is not on the release branch — merged to \`develop\` after the cut, or not merged at all. The user either brings it onto \`{head}\` (then regenerate the scope) or removes it from the agreed scope. Never report it as shipped. |
| Key in the diff but **not** in the agreed scope | ⛔ Stop. This change **will** be deployed. The user either adds it to the agreed scope or removes it from \`{head}\` (then regenerate the scope). |
| Commits with **no** ticket key | List them and ask the user to confirm they belong in the release. |

Record every mismatch and its resolution under a **Scope reconciliation** section in \`release-scope.md\` (the release-notes skill reuses it). Do not scan until the agreed scope and the diff agree.

### Pin the working tree to the scanned snapshot

The deploys in Steps 4 and 6 send the **working tree** of \`{{paths.forceApp}}/\`, not a git ref. The gate only means something if what is deployed is exactly what was scanned, and if production still has nothing the release lacks. So before scanning, run the **pin checks**:

\`\`\`bash
git fetch --all --prune
git rev-parse HEAD                                    # must equal the head SHA recorded in release-scope.md
git rev-parse {base}                                  # must equal the base SHA recorded in release-scope.md
git log --oneline HEAD..{base} -- {{paths.forceApp}}/ # must print nothing
git status --porcelain -- {{paths.forceApp}}/         # must print nothing
\`\`\`

- \`HEAD\` is not the recorded head SHA, or there are uncommitted changes under \`{{paths.forceApp}}/\` → stop; ask the user to check out the head ref (or commit/stash the local changes), then regenerate the scope.
- \`{base}\` is not the recorded base SHA → production has moved since the scope was written (for example, a hotfix merged to \`main\`). Stop and regenerate the scope, which re-runs the production-drift check.
- \`git log HEAD..{base}\` prints anything → production has metadata the release branch lacks, and deploying would revert it. Stop; the user merges \`{base}\` into the release branch, then regenerate the scope.

Do not scan or deploy an unpinned tree.

### Scan only the changed files

1. From \`release-scope.md\`, take the changed files with status **A** or **M** under \`{{paths.forceApp}}/\` (status **D** files are deleted and can't be scanned; a renamed file appears as **D** for the old path plus **A** for the new one, so the new path is scanned). If there are none, record "no scannable changes" in the report and go to Step 3.
2. Scan them. The whole source directory is the *workspace* (so rules that need surrounding code still resolve) and only the changed files are the *targets*. Pass at most **50 targets per run**: a single command line listing hundreds of paths exceeds the Windows command-line limit. For more files, run one batch per 50 and number the results files (\`sfca-results-1.json\`, \`sfca-results-2.json\`, …):
   \`\`\`bash
   rm -f {{paths.artifacts}}/releases/{release-tag}/sfca-results*.json {{paths.artifacts}}/releases/{release-tag}/sfca-baseline*.json   # never read a stale result from an earlier run
   sf code-analyzer run --workspace {{paths.forceApp}} --target <changed-file-1> --target <changed-file-2> ... \\
     --output-file {{paths.artifacts}}/releases/{release-tag}/sfca-results-1.json --view table
   \`\`\`
   - Do **not** scan the full org or the full source tree.
   - Use the default rule selector. If the project root has a \`code-analyzer.yml\`, the CLI applies it automatically — do not override it.
   - Do **not** pass \`--severity-threshold\`: the gate is evaluated from the results files below so warnings can be reported alongside blockers. Without it, findings do **not** cause a non-zero exit.
3. The scan is a **tool failure, not a pass or a block**, if any run exits non-zero, if any results file is missing, or if any violation's rule is \`UnexpectedEngineError\` or \`UninstantiableEngineError\`. Code Analyzer records an engine that crashed or could not start (most often PMD with no Java 11+) as a **Critical violation** in the results file, not as an error. Stop, diagnose (see the environment check), fix, and re-run. These are never code findings: do not present them as blocking findings, and they can never be risk-accepted.

### Apply the gate

Combine every results file. Each has \`violationCounts\` (\`sev1\` Critical, \`sev2\` High, \`sev3\` Moderate, \`sev4\` Low, \`sev5\` Info) and a \`violations\` list; each violation's file and line are in \`locations[primaryLocationIndex]\`.

| Tier | Severity levels | Configured by | Effect |
|---|---|---|---|
| **Blocking** | 1 through {{qualityGate.sfca.failOnLevel}} ({{qualityGate.sfca.failOn}} and above) | \`qualityGate.sfca.failOn\` in the Otto config (default High) | ⛔ Do not deploy |
{{#if qualityGate.sfca.warnOn}}| **Warning** | after {{qualityGate.sfca.failOnLevel}} through {{qualityGate.sfca.warnOnLevel}} ({{qualityGate.sfca.warnOn}} and above, but below {{qualityGate.sfca.failOn}}) | \`qualityGate.sfca.warnOn\` (default Moderate) | ⚠️ Report; do not block |
{{/if}}

The gate judges **what this release introduces**, not the legacy code it happens to touch. A modified file is scanned whole, so a blocking-severity finding in one may already be in production. Decide by comparing against a **baseline scan of the same files at \`{base}\`**. Do not decide from line numbers: many rules (complexity, method length, parameter count) report on the method or class declaration, so a violation caused by lines added inside an unchanged method is reported on an unchanged line.

1. Findings in files with status **A** are **introduced** (a renamed file is listed as **A**, so its findings count as introduced too).
2. List the **M** files that have at least one blocking-severity finding. If there are none, skip to the decision.
3. Scan those files as they are at \`{base}\`, in a temporary worktree outside the repository. Run from the repository root, as for the main scan, so the same \`code-analyzer.yml\` applies. Use the same 50-target batching:
   \`\`\`bash
   git worktree add --detach <tmp>/otto-sfca-base {base}
   sf code-analyzer run --workspace <tmp>/otto-sfca-base/{{paths.forceApp}} --target <tmp>/otto-sfca-base/<modified-file-1> ... \\
     --output-file {{paths.artifacts}}/releases/{release-tag}/sfca-baseline-1.json
   git worktree remove --force <tmp>/otto-sfca-base
   \`\`\`
   The tool-failure rules above apply to this run too. Always remove the worktree, including after a failure.
4. Match each blocking-severity finding in the release scan against the baseline by **engine, rule, file and message**. Compare files by their path relative to the repository (strip the \`<tmp>/otto-sfca-base/\` prefix) and ignore line numbers, which shift. Each baseline finding cancels at most one matching release finding.
   - **Unmatched** → **introduced**. It **blocks**. Messages usually carry the measured value (e.g. a complexity score), so a finding that got worse does not match its baseline and counts as introduced.
   - **Matched** → **pre-existing**. It was already in production. Report it in its own section so the team can see the debt. It does **not** block.

Write \`{{paths.artifacts}}/releases/{release-tag}/quality-gate.md\` with: the refs scanned, the files targeted, the counts per severity, every **blocking** finding (rule, \`file:line\`, message), the **pre-existing** blocking-severity findings (same fields){{#if qualityGate.sfca.warnOn}}, every **warning** finding (same fields){{/if}}, and the decision — **PASS**{{#if qualityGate.sfca.warnOn}}, **PASS WITH WARNINGS**{{/if}}, **BLOCKED**, or **RISK-ACCEPTED**.

- **No introduced blocking findings** → record the decision and continue to Step 3.
- **Introduced blocking findings** → ⛔ **Do not proceed to Step 3.** Present them and ask the user to fix them (the fix goes through a normal story/PR, then re-run this step). Only if the user **explicitly** chooses to accept the risk, record the decision as **RISK-ACCEPTED** in \`quality-gate.md\` with who accepted it, why, and the date, and list the accepted findings. Never risk-accept on your own initiative.

---

## Step 3 — Deleted and renamed components

\`sf project deploy start --source-dir\` **never removes anything from the org**. Deleting or renaming a component in git only removes the local file — the old component stays in {{salesforce.orgs.sandbox}} and production unless a *destructive changes* manifest is deployed. So a release with deletions can look complete and still leave the old components live.

1. From \`release-scope.md\`, list every entry with status **D** under \`{{paths.forceApp}}/\`. A rename appears as **D** (old path) plus **A** (new path) — flag those pairs, since the old name will linger.
2. If there are **none**, say so in one line and go to Step 4.
3. Otherwise, map each path to its metadata type and name (e.g. \`classes/Foo.cls\` → \`ApexClass: Foo\`; \`objects/Account/fields/Bar__c.field-meta.xml\` → \`CustomField: Account.Bar__c\`), write them to \`{{paths.artifacts}}/releases/{release-tag}/deleted-components.md\`, and present them.
4. ⛔ **Do not deploy until the user makes an explicit decision.** Never generate or deploy a destructive manifest on your own — removing components can break dependants and cannot always be undone. Offer:
   - **Supply a destructive-changes manifest** — the user provides (or approves a draft of) \`destructiveChangesPre.xml\` / \`destructiveChangesPost.xml\`. The Step 4 and Step 6 deploys then add \`--pre-destructive-changes <file>\` and/or \`--post-destructive-changes <file>\`.
   - **Acknowledge manual removal** — the user confirms the components will be removed by hand (or are intentionally being left in the org). Record who confirmed and when in \`deleted-components.md\`.
5. Record the decision in \`deleted-components.md\`, and carry it through to the production deployment.

---

## Step 4 — Deploy to UAT

\`\`\`bash
sf project deploy start --source-dir {{paths.forceApp}}/ --target-org {{salesforce.orgs.sandbox}}
\`\`\`

**Before running it**, re-run the pin checks from Step 2. If \`HEAD\` or \`{base}\` has moved, production has metadata the release lacks, or \`{{paths.forceApp}}/\` has uncommitted changes, the gate no longer covers what would be deployed — ⛔ go back to Step 2 (the scope will be regenerated and re-scanned).

If the Step 3 decision was a destructive-changes manifest, append its \`--pre-destructive-changes\` / \`--post-destructive-changes\` flag(s) to this command. If deployment fails, diagnose it. A fix that changes metadata is a code change — commit it and ⛔ go back to Step 2 so the fix is scoped and gated too. Do not proceed with a failed UAT deployment.

---

## Step 5 — UAT sign-off

Request business sign-off on the deployed changes in {{salesforce.orgs.sandbox}}. Do not proceed to production without explicit confirmation.

> "Please validate the release in {{salesforce.orgs.sandbox}} and confirm sign-off before I proceed with the production deployment."

---

## Step 6 — Production deployment

Once UAT sign-off is confirmed, re-run the Step 2 pin checks — production must receive exactly what was gated and signed off in UAT, and must not have moved since; if anything moved, ⛔ stop and go back to Step 2.

**Confirm the target is production.** {{#if salesforce.orgs.production}}The configured production org is **{{salesforce.orgs.production}}** (\`salesforce.orgs.production\` in the Otto config).{{else}}No production org is configured (\`salesforce.orgs.production\` in the Otto config is empty). Ask the user for the production org alias; never assume it.{{/if}} Before deploying, query that exact alias — never the default org — using the same alias the deploy below targets: Salesforce DX MCP \`run_soql_query\` with \`usernameOrAlias\` set to it, or:

\`\`\`bash
sf data query --query "SELECT IsSandbox, OrganizationType FROM Organization" --target-org {{#if salesforce.orgs.production}}{{salesforce.orgs.production}}{{else}}<production-org-alias>{{/if}}
\`\`\`

⛔ If \`IsSandbox\` is true, or the alias is {{salesforce.orgs.sandbox}}, stop — that is not production. Then ask the user to confirm the production deploy by name.

Then deploy (add the same destructive-changes flag(s) if Step 3 chose a manifest; if it chose manual removal, remind the user the production removals are still theirs to do):

\`\`\`bash
sf project deploy start --source-dir {{paths.forceApp}}/ --target-org {{#if salesforce.orgs.production}}{{salesforce.orgs.production}}{{else}}<production-org-alias>{{/if}}
\`\`\`

---

## Step 7 — Write release notes

Load the **release-notes** skill and follow it — it builds the notes from the same \`release-scope.md\` this run established, correlates commits to tickets, and writes \`{{paths.artifacts}}/releases/{release-tag}/release-notes.md\`:

- **MCP hosts** (Claude Code, Copilot CLI / desktop) — call \`otto_prompt\` with \`command: "release"\` and \`skill: "release-notes"\`.
- **VS Code** — re-run \`#otto/release release-notes\`.

Add any known issues and rollback steps to the notes if they apply.

> "Release complete. All stories in this release are deployed to production{{#if salesforce.orgs.production}} ({{salesforce.orgs.production}}){{/if}}."
`;
