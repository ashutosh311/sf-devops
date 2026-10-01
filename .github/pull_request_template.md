## Summary

<!-- What does this PR change and why? -->

Closes #
<!-- Otto: the GitHub issue number. Salesforce delivery: the JIRA/ADO key (e.g. PROJ-123) in the title/branch is enough. -->

**Type of change**: Otto | Salesforce delivery

- **Otto**: `tools/otto/`, plus the Otto-owned files outside it: the repo-root `devops/instructions/` (compiled into Otto's bundles), `.github/agents/`, `.github/plugin/marketplace.json`, `.claude-plugin/marketplace.json`, and the release/CI workflows in `.github/workflows/`.
- **Salesforce delivery**: `force-app/`, `manifests/`, `config/`, `pipeline-scripts/`, and the rest of `devops/` (e.g. `devops/standards/`).

<!-- Keep the ONE section below that matches your change and delete the other. -->

## Otto change

<!-- Link the Spec Kit artifacts. Remove the line that does not apply.
     Exempt changes (typo/docs-only, dependency bump with no code change, CI-only): write "Exempt — <reason>". -->

- Spec: `tools/otto/specs/NNN-short-name/`
- Bug report: `tools/otto/.specify/bugs/<slug>/`

**Release impact**: MAJOR | MINOR | PATCH | NONE (exempt changes only)

- [ ] `/speckit-converge` reports **Converged** (feature) or `/speckit-bug-test` reports **verified** (bug)
- [ ] `pnpm -r build` and `pnpm -r typecheck` pass (from `tools/otto/`)
- [ ] `cd packages/core && npm test` passes (required if templates, `engine.ts`, `schema.ts`, or `devops/instructions/` changed)
- [ ] `node scripts/generate-copilot-agents.mjs --check` passes (required if `copilot/agents/` changed)
- [ ] Surface impact covered: VS Code · Claude plugin · Copilot pack · CLI
- [ ] PM-mode impact covered: JIRA · ADO · LOCAL
- [ ] Manual verification scenarios from the spec run and recorded
- [ ] Docs updated where behaviour changed (`README.md`, `DESIGN*.md`, `QUICK-START*.md`, `CLAUDE.md`)
- [ ] No generated or build output committed (`.github/agents/` regenerated, not hand-edited; no `dist/`)

## Salesforce delivery change

<!-- Reviewer checklist from devops/standards/git.md (§ PR Reviewer Checklist). Mark N/A items with ~~strikethrough~~. -->

- [ ] Branch and commits follow `devops/standards/git.md` (`{type}/{JIRA-KEY}-{description}`, Conventional Commits)
- [ ] Unit testing performed using the specified test data
- [ ] Automated code analysis completed with no errors to resolve
- [ ] Deployment validation to the target Salesforce environment passed
- [ ] Code complies with `devops/standards/`, Accessibility Standards, and UX guidelines
- [ ] Apex test coverage ≥85% (minimum 75%); LWC JEST coverage ≥85%
- [ ] Build components documented on the User Story in JIRA/ADO
- [ ] Pre/post deployment steps documented in the Deployment Guide
- [ ] Detailed Design (Confluence) updated, if required
- [ ] Data model and data dictionary updated, if required
