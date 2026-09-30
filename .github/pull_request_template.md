## Summary

<!-- What does this PR change and why? -->

Closes #

## Spec / bug report

<!-- Otto changes: link the Spec Kit artifacts. Remove the line that does not apply.
     Exempt changes (typo/docs-only, dependency bump with no code change, CI-only): write "Exempt — <reason>". -->

- Spec: `tools/otto/specs/NNN-short-name/`
- Bug report: `tools/otto/.specify/bugs/<slug>/`

**Release impact**: MAJOR | MINOR | PATCH

## Otto checklist

<!-- Salesforce delivery changes (force-app/, artifacts/, etc.): use the reviewer checklist in devops/standards/git.md instead. -->

- [ ] `/speckit-converge` reports **Converged** (feature) or `/speckit-bug-test` reports **verified** (bug)
- [ ] `pnpm -r build` and `pnpm -r typecheck` pass (from `tools/otto/`)
- [ ] `cd packages/core && npm test` passes (required if templates, `engine.ts`, `schema.ts`, or `devops/instructions/` changed)
- [ ] `node scripts/generate-copilot-agents.mjs --check` passes (required if `copilot/agents/` changed)
- [ ] Surface impact covered: VS Code · Claude plugin · Copilot pack · CLI
- [ ] PM-mode impact covered: JIRA · ADO · LOCAL
- [ ] Manual verification scenarios from the spec run and recorded
- [ ] Docs updated where behaviour changed (`README.md`, `DESIGN*.md`, `QUICK-START*.md`, `CLAUDE.md`)
- [ ] No generated or build output committed (`.github/agents/` regenerated, not hand-edited; no `dist/`)
