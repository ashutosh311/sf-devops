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
   git diff --name-status --diff-filter=ACMRD {base}...{head} -- {{paths.forceApp}}/
   git log --no-merges --format="%h|%an|%s" {base}..{head}
   \`\`\`
   (\`{base}...{head}\` — three dots — diffs from the merge base, so unrelated commits on \`{base}\` don't leak into the scope.)
5. Extract ticket keys (\`{{projectKey}}-123\` shape) from commit subjects, branch names and PR titles. Unique them into a list.
6. Write \`{{paths.artifacts}}/releases/{release-tag}/release-scope.md\` containing: the two refs, the changed-file table (status + path), the commit table, and the ticket-key list. If the diff is empty, stop and tell the user — there is nothing to release from these refs.
`;
