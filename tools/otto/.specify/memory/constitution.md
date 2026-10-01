<!--
Sync Impact Report
- Version change: template → 1.0.0 (initial ratification)
- Principles added: I–VII (all new)
- Sections added: Scope, Technology & Security Constraints, Development Workflow, Governance
- Templates reviewed: plan-template.md (Constitution Check reads this file — no change needed),
  spec-template.md (project override added at tools/otto/.specify/templates/overrides/spec-template.md),
  tasks-template.md (no change needed)
- Follow-up TODOs: add `packages/core` render tests to CI (.github/workflows/ci.yml) so Principle V
  is enforced automatically, not only by reviewers.
-->

# Otto Constitution

## Scope

This Spec Kit project is rooted at `tools/otto/`; paths below are relative to it unless marked
*repo-root*.

This constitution governs the **development and maintenance of Otto itself**: the pnpm/TypeScript
workspace in `tools/otto/` and everything it ships or generates — `copilot/`, `plugin/`, and
the *repo-root* `devops/instructions/`, `.github/agents/`, `.github/plugin/marketplace.json`,
`.claude-plugin/marketplace.json`, and `.github/workflows/` release/CI workflows.

It does **not** govern Salesforce delivery work under `force-app/`, `artifacts/`, `manifests/`, or
`pipeline-scripts/`. Those are governed by `AGENTS.md`, `.github/copilot-instructions.md`, and
`devops/standards/`. The Salesforce rules there (Apex/LWC/trigger rules, `{type}/{JIRA-KEY}-…`
branches) apply to Otto only where Otto's prompt templates **encode** them — the content Otto
tells agents to follow MUST stay consistent with `devops/standards/`.

## Core Principles

### I. Core Is the Single Source of Truth

All behaviour lives in `packages/core` (`@otto/core`). `packages/vscode`, `packages/mcp`, and
`packages/cli` are thin front ends that call into it.

- A new command, phase, or sub-skill MUST start in `packages/core/src/` and then be exposed from
  each front end (`packages/vscode/src/handlers/`, `packages/mcp/src/tools.ts` + `prompts.ts`,
  `packages/cli/src/index.ts`) as applicable.
- An `OttoConfig` MUST only be assembled by `buildOttoConfig` from the single `QUESTIONS` list.
  No front end may build config, ask its own `/init` questions, or fork prompt logic.
- Config shape changes MUST go through the Zod schema in `packages/core/src/schema.ts`.

*Rationale: duplicated logic across front ends is how PM-tool support previously diverged
between surfaces.*

### II. Surface & PM-Tool Parity

Every change MUST state its impact on each delivery surface — VS Code extension, Claude Code
plugin (MCP server), GitHub Copilot pack/plugin (MCP server + `.agent.md` wrappers), and CLI —
and on each PM mode — JIRA, ADO, and LOCAL.

- A feature MAY ship to a subset of surfaces or PM modes only if the spec says so explicitly
  and the unsupported surfaces fail gracefully with a clear message.
- Only the VS Code extension performs the daily instruction sync. Changes to instructions or
  templates MUST account for MCP/CLI users receiving them only via a new release.

### III. IP Protection Is Non-Negotiable

Slalom's delivery procedures (phase templates in `packages/core/src/templates/` and fragments in
`devops/instructions/`) MUST be compiled into the shipped bundles.

- Otto MUST NOT write procedure/template text into a client project as plain files.
- New distribution channels MUST preserve both protection layers described in
  `README.md` → *IP Protection* (compiled bundle + private-repo-gated updates).
- Usage tracking MUST NOT transmit prompt or response text, and its endpoint MUST remain a
  CI-injected secret.

### IV. Generated & CI-Owned Artifacts Are Never Hand-Edited

- *Repo-root* `.github/agents/*.agent.md` MUST be generated from `copilot/agents/` via
  `node scripts/generate-copilot-agents.mjs` — never edited directly.
- The `plugin-dist` and `copilot-dist` branches are CI-owned: never commit to, merge, or delete them.
- Build output (`dist/`, `binaries/`, `*.vsix`, the built MCP `server.js`) MUST NOT be committed.
- Package versions and `TOOL_VERSION` stay at the `0.0.0` placeholder; the git tag is the only
  source of the release version.

### V. Verify Before Done (NON-NEGOTIABLE)

A task, feature, or bug fix is not complete until these pass locally from `tools/otto/`:

1. `pnpm -r build`
2. `pnpm -r typecheck`
3. `cd packages/core && npm test` — required whenever `packages/core/src/templates/`,
   `engine.ts`, `schema.ts`, or `devops/instructions/` change.
4. `node scripts/generate-copilot-agents.mjs --check` — required whenever `copilot/agents/` changes.

In addition:

- New or changed template behaviour MUST add or update assertions in
  `packages/core/test/render.test.mjs` (render against JIRA, ADO, and LOCAL configs).
- Prompt behaviour that cannot be asserted by render tests MUST have a manual verification
  scenario written in the spec (or bug report) and its result recorded before the PR is raised,
  naming the surface and model used.
- `/speckit-converge` (features) or `/speckit-bug-test` (bugs) MUST report converged/verified.

### VI. Stable Public Surface & Phase Boundaries

Otto's public surface is: the `.otto/config.json` schema, the scaffolded `artifacts/` layout,
phase commands and their menus, CLI flags, and MCP tool names/signatures.

- Every spec MUST classify its change as MAJOR, MINOR, or PATCH per `README.md` →
  *Versioning*. MAJOR changes MUST include a migration path for already-scaffolded projects.
- Otto's SDLC phase boundaries are product invariants: `/discover` and `/refine` produce no
  technical design; `/design` is the only phase that produces solution designs and sub-tasks;
  `/build` is the only phase that writes to `force-app/`; only Test's `execute` sub-skill may
  transition a story to Done. Changes MUST NOT blur these boundaries unless the spec explicitly
  redefines them.

### VII. Simplicity & Surgical Change

- Make the smallest complete change that satisfies the spec; no unrequested refactors.
- New dependencies MUST be justified in the plan (purpose, licence, bundle-size impact) and
  pinned via `pnpm-lock.yaml`.
- Complexity that violates a principle MUST be recorded in the plan's *Complexity Tracking* table.

## Technology & Security Constraints

- **Stack**: TypeScript 5, Node.js 20+, pnpm 9+ workspace (`packages/*`, `packages/rca/*`),
  Handlebars templates, Zod schemas, tsup/esbuild bundling.
- **No secrets in source**: credentials, tokens, and endpoints are supplied at runtime or
  injected by CI.
- **Security fixes** to dependencies (e.g. advisories raised by Dependabot) take priority over
  feature work and follow the bug workflow.
- **Documentation** that describes changed behaviour MUST be updated in the same PR:
  `README.md`, `DESIGN.md`, `DESIGN-mcp.md`, `QUICK-START*.md`, and *repo-root* `CLAUDE.md`.

## Development Workflow

- **Backlog**: GitHub Issues on `Slalom/salesforce-devops` is the single backlog for Otto.
  Every spec or bug report MUST link its issue.
- **Features / enhancements**: `/speckit-specify` → (`/speckit-clarify`) → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` → `/speckit-converge` (repeat
  until converged). Artifacts live in `tools/otto/specs/NNN-short-name/`.
- **Bugs**: `/speckit-bug-assess` → `/speckit-bug-fix` → `/speckit-bug-test`. Reports live in
  `tools/otto/.specify/bugs/<slug>/`.
- **Exempt changes** (no spec required, issue still recommended): typo/doc-only changes,
  dependency bumps with no code change, and CI-only tweaks. When in doubt, write a spec.
- **Branches**: `{type}/GH-{issue}-{short-description}` (e.g. `feat/GH-86-configurable-status-transitions`).
- **Commits**: Conventional Commits, `type(scope): summary` ≤72 chars; scope is `otto` or the
  affected phase/package (e.g. `refine`, `mcp`, `vscode`).
- **Pull requests**: link the issue (`Closes #N`) and the spec or bug folder; include the spec
  and code in the same PR; CI MUST be green before review.
- **Spec persistence**: completed `specs/` folders are immutable historical records. The living
  architecture is `DESIGN.md` / `DESIGN-mcp.md`, which MUST be reconciled when a feature changes
  architecture.

## Governance

- This constitution supersedes ad-hoc practice for Otto development. `/speckit-plan` and
  `/speckit-analyze` MUST check compliance; reviewers MUST verify it on every PR.
- Amendments are made by PR using `/speckit-constitution`, with the version bumped by SemVer:
  MAJOR for removing or redefining a principle, MINOR for adding a principle or section, PATCH
  for clarifications.
- Runtime development guidance: *repo-root* `CLAUDE.md`, `README.md`, and `CONTRIBUTING.md`.

**Version**: 1.0.0 | **Ratified**: 2026-09-30 | **Last Amended**: 2026-09-30
