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
2. If \`{{paths.artifacts}}/releases/{release-tag}/release-scope.md\` already exists, check it is still an **identical snapshot** before reusing it: run \`git fetch --all --prune\`, then \`git rev-parse {base} {head}\` using the refs recorded in the file, and compare with its recorded **base SHA** and **head SHA**.
   - **Both SHAs match** → reuse it (default). The quality gate and the release notes then describe exactly the same diff.
   - **Either SHA differs, or the file records no SHAs** → the branch has moved (for example, a fix pushed after a blocked gate). The file is **stale**: regenerate it from step 3, carrying over its **Agreed release scope** section. Never reuse a stale file — files added since it was written would skip the quality gate.
3. Otherwise determine the two refs and **confirm them with the user before diffing**:
   - **Head** — the release branch (default: the current branch).
   - **Base** — default: **what production has**, i.e. \`origin/main\` (or \`main\` if there is no remote). Run \`git describe --tags --abbrev=0 origin/main\`: if the latest release tag points at the tip of \`main\`, name the base by that tag (same commit, easier to read); if \`main\` has moved past the tag (e.g. a hotfix), use \`main\`; if there are no tags, use \`main\`.
   - Do **not** default to \`develop\`. A \`release/*\` branch is cut from \`develop\`, so \`develop...{head}\` holds only the fixes made after the cut — the feature work that makes up the release would be neither scanned nor in the notes, yet still deployed. Offer \`develop\` only if the user explicitly wants a narrower, feature-only scope, and say what it leaves out.
   > "I'll diff **{head}** against **{base}** (what production has). Is that the right scope for this release?"
4. Run, and keep the output:
   \`\`\`bash
   git fetch --all --prune
   git rev-parse {base} {head}          # record both SHAs — the snapshot this scope describes
   git diff --name-status --no-renames --diff-filter=AMD {base}...{head} -- {{paths.forceApp}}/
   git log --format="commit %h parents=[%p] author=%an%n%s%n%b%n--" {base}..{head}
   \`\`\`
   (\`{base}...{head}\` — three dots — diffs from the merge base, so unrelated commits on \`{base}\` don't leak into the scope. \`--no-renames\` keeps every status a single letter: a rename appears as a delete of the old path plus an add of the new one, so the new path is always listed as \`A\` and can be scanned.)
5. Extract ticket references and unique them into a list. Search **every** commit's subject and body, the branch names, and PR titles:
   - A commit with **two parents** (\`parents=[a b]\`) is a merge commit. It is **not** a change in itself, but its subject (\`Merge pull request #12 from org/feat/PROJ-123-x\`) and body (the PR title) are often the *only* place the ticket reference appears — so read them, do not skip them. Squash-merge subjects carry the PR title directly.
   - Pull-request titles and source branches: take the PR numbers **from this log only** — GitHub merge subjects \`Merge pull request #N from …\`, GitHub squash subjects ending \`(#N)\`, Azure Repos subjects \`Merged PR N: …\` — so every PR is provably inside \`{base}..{head}\`. If the repository is on GitHub and the \`gh\` CLI or GitHub MCP is available, fetch each one (\`gh pr view N --json number,title,headRefName,body\`) and search its title, branch and body too. Do **not** list PRs by target branch or merge date — that pulls in PRs from outside the range.
   - A pull-request number is **never** a ticket reference, whatever its form (\`#N\`, \`(#N)\`, \`PR N\`).
{{#eq almTool "ADO"}}   - Azure DevOps work items are referenced by **numeric ID**, and \`get_work_item\` takes that number. Do **not** build keys from the project name. Which forms count depends on where the code is hosted — check \`git remote get-url origin\`:
     - \`AB#123\` — always a work item (the Azure Boards link syntax, valid from GitHub and Azure Repos alike). Work-item URLs (\`…/_workitems/edit/123\`) count too.
     - Bare \`#123\` — a work item **only** when the remote is Azure Repos (\`dev.azure.com\` or \`visualstudio.com\`). On GitHub (or any other host) a bare \`#123\` is a PR or issue number — ignore it.
{{else}}{{#eq almTool "LOCAL"}}   - Local mode has no PM tool. Match the backlog **Story IDs** — list the **story** folder names — the second level, \`{{paths.artifacts}}/04 - Backlog/stories/{EPIC-ID}/{STORY-ID}/\` (e.g. \`STORY-001\`; the first level is the epic, not a story) — and search for those exact IDs. Also accept keys of the shape \`{{projectKey}}-<number>\`.
{{else}}   - JIRA keys have the shape \`{{projectKey}}-123\`.
{{/eq}}{{/eq}}
6. Establish the **agreed release scope** — the stories the team *intends* to ship, kept separately from the keys found in the diff so the two can be reconciled:
   - If the **deploy** skill has already confirmed a scope in Step 0 of this session, use that list.
   - Otherwise (for example, release notes run first), ask for it: "Which stories are in this release? Give me the keys, or I'll fetch everything in **{{statusMap.story.done}}** status."{{#eq almTool "LOCAL"}} In Local mode there is no PM status to query, so the keys must be given.{{/eq}}
7. Write \`{{paths.artifacts}}/releases/{release-tag}/release-scope.md\` with these sections: the two refs **and their SHAs** (base SHA, head SHA); the changed-file table (status + path); the commit table (merge commits marked); **Keys found in the diff**; **Agreed release scope**. If the diff is empty, stop and tell the user — there is nothing to release from these refs. If you are *reusing* an existing file that has no **Agreed release scope** section, ask for it and add it.
`;
