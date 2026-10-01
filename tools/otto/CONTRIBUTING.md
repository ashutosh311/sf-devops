# Contributing to Otto — Spec-Driven Development

Otto is developed with [GitHub Spec Kit](https://github.com/github/spec-kit): every feature and
bug fix starts from a written, reviewed specification, not from an open-ended chat prompt.

> **Scope.** This guide is for developing **Otto itself** (`tools/otto/` and what it ships).
> Salesforce delivery work (`force-app/`, `artifacts/`) follows `AGENTS.md` and
> `devops/standards/`, and uses Otto's own `/refine` → `/design` → `/build` flow — not Spec Kit.

---

## 1. Tooling

| Tool | Version | Why |
|------|---------|-----|
| Node.js / pnpm | 20+ / 9+ | Build, typecheck, and test Otto |
| Python | 3.11+ | Runs the Spec Kit CLI |
| [uv](https://docs.astral.sh/uv/) | latest | Installs `specify-cli` |
| `specify-cli` | **1.0.13** (pinned — see `.specify/init-options.json`) | Spec Kit scaffolding, extensions, upgrades |
| `gh` CLI | latest, authenticated | Issues, PRs, and reading issues in this INTERNAL repo |
| [GitHub MCP server](https://github.com/github/github-mcp-server) | latest | Only for the optional `/speckit-github-taskstoissues` (it creates issues through MCP tools) |
| AI agent | GitHub Copilot (VS Code / CLI / app) or Claude Code | Runs the `/speckit-*` skills |

The `.specify/scripts/` are POSIX shell. On Windows run the agent from Git Bash or WSL.

One-time install:

```bash
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v1.0.13
specify version
```

Nothing else to initialise — the Spec Kit project files are committed. The Spec Kit project is
rooted at **`tools/otto/`** (not the repo root, which also holds Salesforce delivery and DevOps
content), so all paths below are relative to `tools/otto/`.

### Launch your agent from `tools/otto/`

The `/speckit-*` skills and their scripts resolve `.specify/` relative to the project root, so
start your agent there:

| Agent | How |
|-------|-----|
| Copilot CLI / Claude Code | `cd tools/otto` then `copilot` / `claude` |
| VS Code Copilot | Open `tools/otto` as the workspace folder, or add `tools/otto/.github/skills` to the `chat.agentSkillsLocations` setting |
| GitHub Copilot app | Use a session whose working folder is `tools/otto` |

Sessions started at the repo root do not see the `/speckit-*` skills — by design, so they don't
appear during Salesforce delivery work.

| Path | Contents |
|------|----------|
| `.specify/memory/constitution.md` | **Otto's constitution** — architecture and quality rules every plan is checked against |
| `.specify/templates/` | Spec Kit core templates (managed by the CLI — don't edit) |
| `.specify/templates/overrides/` | Otto-specific template overrides (edit these) |
| `.specify/extensions/` | Installed extensions: `bug`, `github` |
| `.github/skills/speckit-*` | Skills for GitHub Copilot (default integration) |
| `.claude/skills/speckit-*` | Skills for Claude Code |
| `specs/NNN-short-name/` | One folder per feature: `spec.md`, `plan.md`, `tasks.md`, … (created on first use) |
| `.specify/bugs/<slug>/` | One folder per bug: `assessment.md`, `fix.md`, `test.md` (created on first use) |

## 2. Backlog

**GitHub Issues on `Slalom/salesforce-devops` is the single backlog for Otto.** Raise work with
the *Otto — feature / enhancement* or *Otto — bug report* issue forms. Every spec and bug report
links back to its issue, and every PR closes it.

Every bug assessment records its issue in the **Issue** field (`assessment.md`); the PR closes it
with `Closes #<issue>`. The `Source` field only records where the report text came from.

The stock Spec Kit "Full SDD Cycle" workflow is deliberately not installed: it skips `analyze` and
`converge`, which the constitution requires. Run the skills one at a time as described below.

## 3. Feature / enhancement workflow

Run each skill in your agent's chat, **one at a time**, and review the output before moving on.

```text
git switch -c feat/GH-<issue>-<short-description>

/speckit-specify <what and why — paste or reference the issue, e.g. "GH #86: ...">
/speckit-clarify                  # optional, recommended: resolves ambiguities before planning
/speckit-plan <technical direction, e.g. "Implement in core; expose via vscode + mcp">
/speckit-checklist                # optional: extra requirement-quality gate
/speckit-tasks
/speckit-analyze                  # required: spec ↔ plan ↔ tasks consistency + constitution check
/speckit-github-taskstoissues     # optional: mirror tasks as GitHub issues for larger features
/speckit-implement
/speckit-converge                 # repeat implement → converge until it reports "Converged"
```

The current feature is tracked in `.specify/feature.json`, which is per-checkout and gitignored. On a
fresh clone or after switching branches, resume with
`SPECIFY_FEATURE_DIRECTORY=specs/NNN-short-name` set in your environment.

Then raise a PR containing **both** the `tools/otto/specs/NNN-…/` folder and the code. The PR
template walks through the constitution's quality gates.

The Otto spec template (override) adds three mandatory items to every spec:

- **GitHub Issue** link and **Release Impact** (MAJOR / MINOR / PATCH).
- **Otto Surface Impact** — behaviour on VS Code, Claude plugin, Copilot pack, and CLI, and on
  JIRA, ADO, and LOCAL PM modes; public-surface changes; phase-boundary confirmation.
- **Verification Approach** — render-test assertions plus manual scenarios for prompt behaviour
  that tests can't assert.

## 4. Bug workflow

```text
git switch -c fix/GH-<issue>-<short-description>

/speckit-bug-assess <paste the issue text or URL> slug=<short-kebab-slug>
/speckit-bug-fix slug=<slug>
/speckit-bug-test slug=<slug>     # must end "verified" — "partial" or "failed" is not done
```

`Slalom/salesforce-devops` is INTERNAL, so the agent cannot fetch its issue URLs anonymously: paste
the issue text (or `gh issue view <n>` output) instead of the URL, and pass the issue number so it
is recorded in the **Issue** field. Strip client-confidential data before pasting.

Commit the `tools/otto/.specify/bugs/<slug>/` reports with the fix. If assessment shows the
"bug" is really missing behaviour, stop and move to the feature workflow instead.

## 5. Exempt changes

No spec needed (an issue is still recommended): typo or docs-only changes, dependency bumps with
no code change, and CI-only tweaks. Write `Exempt — <reason>` in the PR's *Spec / bug report*
section. **When in doubt, write a spec.**

## 6. Quality gates

From `tools/otto/` — required before raising a PR (Constitution Principle V):

```bash
pnpm -r build
pnpm -r typecheck
cd packages/core && npm test && cd ../..        # if templates / engine.ts / schema.ts / devops/instructions changed
node scripts/generate-copilot-agents.mjs --check # if copilot/agents/ changed
```

## 7. Conventions

- **Branches**: `{type}/GH-{issue}-{short-description}` — e.g. `feat/GH-86-configurable-status-transitions`.
- **Commits**: Conventional Commits, `type(scope): summary` (≤72 chars); scope `otto` or the
  phase/package (`refine`, `mcp`, `vscode`, …).
- **Spec numbering**: Spec Kit numbers `specs/` folders sequentially; the issue number goes in
  the spec header and the branch name.
- **Spec persistence**: completed `specs/` folders are **immutable history**. `DESIGN.md` and
  `DESIGN-mcp.md` are the living architecture — update them when a feature changes it.

## 8. Maintaining Spec Kit

- **Run `specify` commands from `tools/otto/`** — that is where `.specify/` lives.
- **Amend the constitution** with `/speckit-constitution` in a PR; bump its version (MAJOR:
  remove/redefine a principle, MINOR: add one, PATCH: clarify).
- **Customise templates** by adding files to `.specify/templates/overrides/` (same filename as
  the core template). Check what resolves with `specify preset resolve <template-name>`.
- **Check for upgrades** with `specify self check`. To upgrade, re-install the new pinned version
  on every machine, update the pin in this guide, then run `specify integration upgrade` and
  review the diff in a dedicated `chore/` PR.
- **`specify integration status`** reports `error unsafe-multi-install … copilot`. This is
  expected: Spec Kit flags Copilot conservatively because its *commands* mode edits
  `.vscode/settings.json`. This repo uses Copilot's *skills* mode, which writes only to
  `.github/skills/` and does not overlap with Claude's `.claude/skills/`. Any other finding
  (modified or missing managed files) should be investigated.
- **Adding an extension** registers its skills only for the *default* integration (Copilot).
  Register it for Claude Code too:

  ```bash
  specify extension add <name>
  specify integration use claude && specify extension add <name> --force
  specify integration use copilot
  ```

  `tools/otto/.gitignore` tracks only `.claude/skills/speckit-*/`; personal `.claude/` state
  stays ignored.
- The `git` extension is intentionally **not** installed — its `NNN-name` branch naming conflicts
  with this repo's `{type}/GH-{issue}-…` convention.
