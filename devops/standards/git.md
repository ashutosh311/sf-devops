---
title: Git Standards
description: GitFlow branching model, branch naming, rebase conventions, PR rules, Conventional Commits specification, and commitlint setup.
scope: git, devops
enforce: always
---

# Git Standards

---

## 1. Branching Model: GitFlow

```
main          ←── production-ready only; tags = releases
  └─ release/x.y.z
develop       ←── integration branch; always deployable to QA
  └─ feature/{ticket}-{short-description}
  └─ bugfix/{ticket}-{short-description}
  └─ chore/{ticket}-{short-description}
hotfix/{ticket}-{short-description}   ←── branches from main, merges to main AND develop
```

### Branch Types

| Branch | Branches From | Merges To | Purpose |
|--------|-------------|---------|---------|
| `main` | — | — | Production. Protected. PR only. |
| `develop` | `main` (initial) | — | Integration. Protected. PR only. |
| `feature/*` | `develop` | `develop` | New feature work |
| `bugfix/*` | `develop` | `develop` | Bug fixes found in QA/dev |
| `hotfix/*` | `main` | `main` AND `develop` | Critical production fixes |
| `release/*` | `develop` | `main` AND `develop` | Release preparation |
| `chore/*` | `develop` | `develop` | CI config, tooling, docs |

### Branch Naming

```
{type}/{jira-ticket-key}-{short-description-in-kebab-case}

Examples:
  feature/PROJ-123-account-pricing-engine
  bugfix/PROJ-456-fix-null-pointer-in-trigger
  hotfix/PROJ-789-prod-order-submission-failure
  release/2.4.0
```

- JIRA ticket key is mandatory for `feature`, `bugfix`, and `hotfix` branches.
- NEVER use personal names in branch names.

---

## 2. Rebase, Not Merge

**Use `git rebase` to keep feature branches up to date with `develop`. Never use `git merge develop` into a feature branch.**

```bash
git fetch origin
git rebase origin/develop

# On conflict:
git add <resolved-files>
git rebase --continue

# Force-push your feature branch only:
git push --force-with-lease origin feature/PROJ-123-account-pricing-engine
```

- `--force-with-lease` is the safe force push — fails if someone else pushed since your last fetch.
- NEVER force-push to `develop` or `main`.
- NEVER rebase a shared branch other developers have checked out.

### Squash Before PR

```bash
git rebase -i HEAD~N
```

WIP commits (`wip`, `fix typo`, `testing`) MUST be squashed before opening a PR.

---

## 3. Environment Alignment

| Environment | Branch | Deployment Trigger |
|-------------|--------|-------------------|
| Developer Sandbox | `feature/*` | Manual (SFDX CLI) |
| QA Sandbox | `develop` | CI on merge to `develop` |
| UAT Sandbox | `release/*` | CI on push to `release/*` |
| Production | `main` | CI on merge to `main` (manual approval gate) |

---

## 4. Pull Request Rules

1. PR title MUST reference the JIRA ticket: `feat(PROJ-123): add account pricing engine`.
2. PRs targeting `develop` require **minimum 2 reviewer approvals** (one manually added, one representing automated code quality analysis).
3. PRs targeting `main` require 2 reviewer approvals + passing CI.
4. All CI checks MUST pass before merge — peer review MUST NOT begin until automated code quality checks have passed.
5. High-risk components (e.g. randomisation algorithms, security-sensitive logic) MUST be tagged to require an additional reviewer.
6. Use **Squash and Merge** for `feature/*` → `develop`.
7. Use **Merge Commit** for `release/*` → `main`.
8. Delete the source branch after merge.

### PR Reviewer Checklist

Before approving a pull request, reviewers MUST verify:

- [ ] Unit testing has been performed using the specified test data
- [ ] Automated code analysis has completed with no errors to resolve
- [ ] Deployment validation to the target Salesforce environment has passed
- [ ] Code complies with the Development Standards, Accessibility Standards, and UX guidelines
- [ ] Apex test classes have sufficient coverage — minimum 75%, target ≥85%
- [ ] Build components are documented on the User Story in JIRA
- [ ] Any pre/post deployment steps are documented in the Deployment Guide
- [ ] Detailed Design document in Confluence has been updated (if required)
- [ ] Data model and data dictionary updated (if required)

### Multiple User Stories in One PR

A single pull request may cover multiple User Stories where:
- It makes functional and technical sense to bundle the work together.
- All stories are owned by the same developer, ensuring clear ownership.
- The combined work remains relatively small — short-lived branches. Avoid raising a single large PR at the end of a sprint.

---

## 5. Commit Conventions (Conventional Commits)

```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

### Commit Types

| Type | When to Use |
|------|------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or correcting tests |
| `chore` | Build system, CI config, dependency updates |
| `docs` | Documentation only |
| `style` | Formatting, whitespace — no logic change |
| `perf` | Performance improvement |
| `ci` | CI/CD pipeline changes (pipelines, scripts, tooling) |

### Scopes

| Scope | Covers |
|-------|--------|
| `apex` | Apex classes, triggers |
| `lwc` | Lightning Web Components |
| `omni` | OmniScripts, IPs, DataRaptors |
| `config` | Declarative config (flows, validation rules) |
| `data-model` | Custom objects, fields |
| `ci` | CI/CD pipelines, scripts, tooling |
| `{JIRA-KEY}` | Link commits to a story |

### Examples

```
feat(apex): add CMT-based trigger framework

Implements TriggerHandler base class and TriggerSettingSelector.

Closes PROJ-123
```

```
fix(lwc): handle null recordId in accountSummaryCard

Fixes PROJ-456
```

```
feat(PROJ-789)!: replace legacy pricing engine with strategy pattern

BREAKING CHANGE: PricingService constructor now requires a PricingStrategy.
Callers must use PricingServiceFactory.create().
```

### Commit Message Rules

- Summary line: ≤72 characters, imperative mood ("add feature" not "added feature"), no trailing period.
- Breaking changes: add `!` after type/scope AND a `BREAKING CHANGE:` footer.
- Reference JIRA tickets in footer: `Closes PROJ-123` or `Ref PROJ-123`.

---

## 6. Pre-commit Hook Setup

Hooks live in `.hooks/` and are registered via `core.hooksPath` — no Node.js dependency, works with any git host (GitHub, GitLab, Azure DevOps, Bitbucket, etc.).

### Install (once after cloning)

```bash
sh devops/scripts/install-hooks.sh
```

This runs `git config core.hooksPath .hooks` and makes all hooks executable.

### `.hooks/pre-commit` — Apex quality checks

Runs on every `git commit`. Blocks the commit if:

- `System.debug` is found in any staged `.cls` or `.trigger` file
- A `.trigger` file contains more than one line of logic (must delegate to handler only)

### `.hooks/commit-msg` — Conventional Commits format

Runs on every `git commit`. Blocks the commit if the message first line does not match:

```
type(scope): summary   ← ≤72 chars, imperative mood, no trailing period
```

Warns (but does not block) if no JIRA ticket reference is found.

### Adding new checks

Add a new executable shell script to `.hooks/` following the same pattern. Re-run `devops/scripts/install-hooks.sh` to ensure it is executable.
