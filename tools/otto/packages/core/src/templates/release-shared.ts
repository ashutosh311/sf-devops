/**
 * Fragments shared by more than one Release skill. Interpolated into the skill
 * templates at module load (plain string concatenation, before Handlebars runs),
 * so they may use `{{...}}` config placeholders like any other template text.
 */

/**
 * Establishes the authoritative release scope — the git diff that both the quality
 * gate (deploy) and the release notes are built from. Whichever skill runs first
 * writes `release-scope.md`; the other reuses it so the two never disagree.
 */
export const releaseScopeDiffFragment = `### Establish the release scope (git diff)

The release scope is the authoritative list of what changed — every later step works from it, not from memory or from the ticket list alone.

1. Ask for the **release tag/name** (e.g. \`v1.4.0\` or \`2026-10-sprint-12\`) → \`{release-tag}\`.
2. If \`{{paths.artifacts}}/releases/{release-tag}/release-scope.md\` already exists, show its refs and file count and ask whether to **reuse** it or regenerate it. Reuse is the default — this keeps the quality gate and the release notes describing the same diff.
3. Otherwise determine the two refs and **confirm them with the user before diffing**:
   - **Head** — the release branch (default: the current branch).
   - **Base** — default \`develop\`. If the diff against \`develop\` is empty, or the user prefers a tag-based scope, offer \`main\` (what production has) or the previous release tag instead (\`git describe --tags --abbrev=0 <head>\`, or ask for the tag).
   > "I'll diff **{head}** against **{base}**. Is that the right scope for this release?"
4. Run, and keep the output:
   \`\`\`bash
   git fetch --all --prune
   git diff --name-status --no-renames --diff-filter=AMD {base}...{head} -- {{paths.forceApp}}/
   git log --format="commit %h parents=[%p] author=%an%n%s%n%b%n--" {base}..{head}
   \`\`\`
   (\`{base}...{head}\` — three dots — diffs from the merge base, so unrelated commits on \`{base}\` don't leak into the scope. \`--no-renames\` keeps every status a single letter: a rename appears as a delete of the old path plus an add of the new one, so the new path is always listed as \`A\` and can be scanned.)
5. Extract ticket references and unique them into a list. Search **every** commit's subject and body, the branch names, and PR titles:
   - A commit with **two parents** (\`parents=[a b]\`) is a merge commit. It is **not** a change in itself, but its subject (\`Merge pull request #12 from org/feat/PROJ-123-x\`) and body (the PR title) are often the *only* place the ticket reference appears — so read them, do not skip them. Squash-merge subjects carry the PR title directly.
   - If the repository is on GitHub and the \`gh\` CLI or GitHub MCP is available, also list the merged PRs in the range (\`gh pr list --state merged --base {base} --json number,title,headRefName,mergedAt\`, keeping those merged after the base..head range began) to pick up PR titles and source branches. Other hosts: use their CLI/MCP if present; otherwise rely on the merge commits.
{{#eq almTool "ADO"}}   - Azure DevOps work items are referenced by **numeric ID** — \`AB#123\` or \`#123\` — and \`get_work_item\` takes that number. Do **not** build keys from the project name.
{{else}}{{#eq almTool "LOCAL"}}   - Local mode has no PM tool. Match the backlog **Story IDs** — list the folder names under \`{{paths.artifacts}}/04 - Backlog/stories/*/\` (e.g. \`STORY-001\`) and search for those exact IDs. Also accept keys of the shape \`{{projectKey}}-<number>\`.
{{else}}   - JIRA keys have the shape \`{{projectKey}}-123\`.
{{/eq}}{{/eq}}
6. Establish the **agreed release scope** — the stories the team *intends* to ship, kept separately from the keys found in the diff so the two can be reconciled:
   - If the **deploy** skill has already confirmed a scope in Step 0 of this session, use that list.
   - Otherwise (for example, release notes run first), ask for it: "Which stories are in this release? Give me the keys, or I'll fetch everything in **{{statusMap.story.done}}** status."{{#eq almTool "LOCAL"}} In Local mode there is no PM status to query, so the keys must be given.{{/eq}}
7. Write \`{{paths.artifacts}}/releases/{release-tag}/release-scope.md\` with these sections: the two refs; the changed-file table (status + path); the commit table (merge commits marked); **Keys found in the diff**; **Agreed release scope**. If the diff is empty, stop and tell the user — there is nothing to release from these refs. If you are *reusing* an existing file that has no **Agreed release scope** section, ask for it and add it.
`;
