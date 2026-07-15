# Agent Instructions

This file provides operating instructions for AI agents working in this repository.
Read this file in full before taking any action.

---

## What is this repository?

Salesforce development repository for Slalom UK&I projects. It contains:
- An Agentic SDLC workflow covering the full consulting delivery lifecycle
- Prescriptive development standards in `devops/standards/`
- Pre-commit hooks in `.hooks/`
- A Salesforce metadata manifest template in `manifest/`

Salesforce source code lives in `force-app/` (SFDX project structure).
Generated artifacts live in `artifacts/` (created during SDLC workflow).

---

## Agentic SDLC — Phase Overview

This repo uses phase-based agents that map to Slalom's consulting delivery methodology. Each agent covers a delivery phase and can be used by multiple personas.

**AI tooling:** GitHub Copilot (VS Code / IntelliJ) with **Claude Sonnet 4.6** as the recommended model. Agents are invoked via Copilot Chat using `#sdlc/<agent>` syntax.

```
DISCOVER           DELIVER — Sprint -1                    DELIVER — Sprint           TRANSITION
┌──────────┐    ┌────────────┬──────────────┐    ┌──────────────┬──────────┐    ┌──────────┐
│ /discover│───▶│  /refine   │   /design    │───▶│   /build     │  /test   │───▶│ /release │
│          │    │  (BA / FL) │  (TA / TL)   │    │  (Developer) │  (QA)    │    │          │
└──────────┘    └────────────┴──────────────┘    └──────────────┴──────────┘    └──────────┘
```

### Agent responsibilities

| Agent | Phase | Entry gate | Exit gate |
|---|---|---|---|
| `#sdlc/discover` | DISCOVER | Workshop notes / client brief | Backlog pushed to JIRA (`push-record.md` exists), current-state synthesis complete, MVP scope approved |
| `#sdlc/refine` | Sprint -1 (BA / FL) | An ALM story key (JIRA / ADO, status = **To Do**) **or** local `04 - Backlog/` materials (no PM tool) | Story has Gherkin AC — status = **Ready for Design** (ALM mode) or `refinement-notes.md` written into the backlog story folder (Local mode) |
| `#sdlc/design` | Sprint -1 (TA / TL) | Story status = **Ready for Design** | `solution-design.md` written, design posted to JIRA, sub-tasks created, status = **Ready for Build** |
| `#sdlc/build` | Sprint | Story status = **Ready for Build**, solution-design.md exists | Code deployed, PR raised, status = **Ready for Test** |
| `#sdlc/test` | Sprint +1 | Story status = Ready for Test | Test report written, defects in JIRA, status = Done or Defect |
| `#sdlc/release` | TRANSITION | Stories in Done (or risk-accepted) | Deployment runbook, BAU handover signed off, status = Released |

### JIRA status flow

```
To Do → [/refine] → Ready for Design → [/design] → Ready for Build → [/build] → Ready for Test → [/test] → Done / Defect
                                                                                                              ↓
                                                                                                 [/release] → Released
```

### Artifact structure

```
artifacts/
  discovery/                            # Discovery knowledge hub (from /discover)
    00 - Project/                       # Project Overview.md, Phase Context.md, Timeline.md
    00 - Inbox/                         # Raw files to process (drop here first)
    00 - Registers/                     # Pain points, systems, stakeholders, RAID (markdown tables)
    01 - Sessions/                      # Processed workshop notes
    02 - Current State/                 # Synthesized narratives, process diagrams
    03 - Future State/                  # Solution directions, focus areas, MVP scope
    04 - Backlog/                       # Backlog Tracker.xlsx, _index.md, epics/<id>.md, open-questions.md
      pushed/                           # Archived Excel + push-record.md (after JIRA push)
    06 - Reference/                     # Client documents, handover materials
  {STORY-KEY}/                          # Story-level artifacts (from /refine, /build, /test)
    sf-discovery.md
    solution-design.md
    package.xml
    implementation-record.md
    test-plan.md
    test-results.md
  release-{version}/                # Release-level artifacts (from /release)
    deployment-runbook.md
    go-live-checklist.md
    bau-handover.md
    hypercare-log.md
```

---

## Discovery Phase — `/discover`

The `/discover` agent runs a 4-phase structured engagement methodology (Prepare → Learn → Ideate → Plan) backed by a local knowledge hub and a JIRA push flow.

### Engagement phases

| Phase | Timing | Playbook |
|-------|--------|---------|
| Prepare | Weeks 0–1 | `.github/prompts/sdlc/discover/playbooks/01-prepare.md` |
| Learn | Week 2 | `.github/prompts/sdlc/discover/playbooks/02-learn.md` |
| Ideate | Weeks 3–4 | `.github/prompts/sdlc/discover/playbooks/03-ideate.md` |
| Plan | Weeks 5–6 | `.github/prompts/sdlc/discover/playbooks/04-plan.md` |

### Sub-prompts (invoke via `#sdlc/discover <skill>`)

| Skill | What it does |
|-------|-------------|
| `setup` | Project onboarding — organise inbox, initialise registers |
| `process-session` | Process workshop transcript → session note + queued observations |
| `synthesize` | Registers → narrative current-state document |
| `analyze` | Prioritisation, gap analysis, traceability matrix |
| `manage-backlog` | Evidence-backed epic/story construction → seeds `Backlog Tracker.xlsx` |
| `push-backlog` | Reads Excel, updates markdown, creates PM tool items, archives Excel |
| `sync-pm` | Pulls PM tool status back as a read-only `pm-sync.md` snapshot |
| `compose-deliverable` | Executive readout, technical handoff document |
| `conflict-check` | Contradiction and assumption conflict detection |
| `prep-workshop` | Pre-session briefing materials |
| `hub-audit` | Phase-gate readiness check |
| `whats-next` | "Where are we and what's next?" orientation |
| `stories-refined` | Backlog → per-story `refinement-notes.md` for the design phase — no PM tool required |
| `registers-to-stories` | Bridge from registers to story candidates |
| `set-preferences` _(VS Code only)_ | Set authoring style for AC / FR / Solution Notes |
| `feedback` _(VS Code only)_ | Rate the last command and append notes to authoring preferences |

### Backlog push flow

1. Run `manage-backlog` → `Backlog Tracker.xlsx` is seeded with evidence-backed stories
2. User opens and reviews the Excel file
3. Run `push-backlog` → reads Excel, updates `_index.md` + `epics/<id>.md`, creates PM tool items, archives Excel to `04 - Backlog/pushed/`
4. The PM tool is now the source of truth — Excel is archived and immutable
5. Run `sync-pm` at any time to pull current PM tool status back to `pm-sync.md`

---



### 1. Read the relevant standard

Always read the applicable standard from `devops/standards/` before generating code or designs:

| You are working on... | Read this first |
|---|---|
| Apex classes or triggers | `devops/standards/apex.md` |
| Lightning Web Components | `devops/standards/lwc.md` |
| OmniStudio (OmniScript, IP, DR) | `devops/standards/omniscript.md` |
| Flows, validation rules, permission sets | `devops/standards/configuration.md` |
| Custom objects or fields | `devops/standards/data-model.md` |
| Branching, commits, PRs | `devops/standards/git.md` |

### 2. Run the Apex framework checklist

Before writing any Apex, verify these classes exist in `force-app/main/default/classes/`:

- `TriggerHandler.cls`
- `TriggerSettingSelector.cls`
- `Logger.cls`
- `UnitOfWork.cls`
- `StubBuilder.cls`

If any are missing, generate them first from the patterns in `devops/standards/apex.md`.

Also verify this supporting metadata exists in `force-app/main/default/objects/`:
- `TriggerConfiguration__mdt/`

For OmniStudio projects, additionally check for:
- `IIntegrationProcedureService.cls` + `IntegrationProcedureServiceImpl.cls`
- `IDecisionRuleService.cls` + `DecisionRuleServiceImpl.cls`
- `MockIntegrationProcedureService.cls`

---

## Non-Negotiable Rules

These apply to every file generated or modified — no exceptions:

1. **Triggers** — one trigger per SObject, all events declared, exactly one line of logic: `new {Object}TriggerHandler().run();`
2. **No `System.debug`** — use `Logger.info()`, `Logger.warn()`, `Logger.error()` in all Apex
3. **No SOQL outside Selectors** — all queries go through `{Object}Selector` classes only
4. **No direct DML** — all DML registered via `UnitOfWork`; never call `insert`/`update`/`delete` directly
5. **Feature flags** — use `FeatureToggle.isEnabled('FEATURE_NAME')` backed by `FeatureToggle__mdt`; never hardcoded conditionals
6. **Test classes** — non-DML pattern; `StubBuilder` for mocks; `Assert.areEqual` not `System.assertEquals`; 85% coverage minimum; bulk test at 200 records
7. **LWC tests** — every component must have `__tests__/{component}.test.js` at ≥85% line coverage
8. **Commits** — must follow Conventional Commits: `type(scope): summary` (≤72 chars)
9. **Branches** — must follow: `{type}/{JIRA-KEY}-{short-description}`

---

## Repository Structure

```
.hooks/
  pre-commit              # Blocks System.debug and trigger logic violations
  commit-msg              # Validates Conventional Commits format; warns if no JIRA ref
.mcp.json                 # MCP server config — Salesforce DX + Atlassian (JIRA/Confluence)
.github/
  copilot-instructions.md # Project-wide Copilot instructions (loaded automatically)
  instructions/           # File-type-scoped instructions (apex, lwc, git, data-model, omni)
  prompts/                # GitHub Copilot equivalents of the SDLC agents
.github/
  prompts/
    sdlc/
      discover.prompt.md    # #sdlc/discover — DISCOVER phase
      refine.prompt.md      # #sdlc/refine   — Sprint -1 (BA / FL: AC + Ready for Design)
      design.prompt.md      # #sdlc/design   — Sprint -1 (TA / TL: solution design + Ready for Build)
      build.prompt.md       # #sdlc/build    — Sprint
      test.prompt.md        # #sdlc/test     — Sprint +1
      release.prompt.md     # #sdlc/release  — TRANSITION
    project/
      create-jira-item.prompt.md  # #project/create-jira-item — standalone utility
config/
  project-scratch-def.json    # Minimal scratch org definition
  snapshot-scratch-def.json   # Full-feature snapshot-based scratch org definition
devops/
  standards/              # Source-of-truth standards documents
  scripts/
    install-hooks.sh      # Registers .hooks/ via core.hooksPath
manifest/
  package.xml             # Salesforce metadata manifest template
artifacts/                # Generated SDLC artifacts — created at runtime
force-app/                # Salesforce source (SFDX structure) — created during development
pipeline-scripts/
  bronze/                 # Bitbucket Pipelines — basic CI (validate + deploy)
  silver/                 # Bitbucket Pipelines — intermediate CI
  gold/                   # Bitbucket Pipelines — full CI with gates
```

**Salesforce API version:** `62.0` (set in `sfdx-project.json`). Use this version in all `.js-meta.xml` files.

### Usage tracking (VS Code extension)

The `slalom-sdlc` VS Code extension records command and feedback usage to the **Salesforce
DevOps Log** SharePoint list (via a Power Automate HTTP trigger) for adoption reporting. It only
sends `Command, Date, User, Project, Story, Model, Tokens, Comment` — **never** prompt or
response text. It is **Slalom-only** (active only once private-repo instruction sync has
succeeded — never gated on ambient `GITHUB_TOKEN`/`GH_TOKEN` presence) and fully asynchronous
(per-item file queue at `~/.slalom-sdlc/usage-queue/`). The endpoint is a CI-injected secret, never
committed to source. Feedback is captured via `/feedback <comment>`, Copilot thumbs up/down, and
the `/discover` feedback prompt. See `tools/slalom-sdlc/README.md` → **Usage Tracking** for detail.

---

## Useful Commands

```bash
# Install git hooks (run once after cloning)
sh devops/scripts/install-hooks.sh

# Authenticate Salesforce org
sf org login web --alias my-org --set-default

# Deploy metadata to default org
sf project deploy start --source-dir force-app/

# Run Apex tests
sf apex run test --test-level RunLocalTests --result-format human

# Run LWC JEST tests
npm run test:unit
```

---

## Commit and Branch Format

```
# Branch
{type}/{JIRA-KEY}-{short-description-in-kebab-case}

feat/PROJ-123-account-pricing-engine
fix/PROJ-456-null-pointer-in-trigger
chore/PROJ-789-install-framework-classes

# Commit
type(scope): summary

feat(apex): add account pricing trigger handler
fix(lwc): handle null recordId in accountSummaryCard
chore(ci): update deployment pipeline script
```

Valid types: `feat` `fix` `refactor` `test` `chore` `docs` `style` `perf` `revert` `ci`

Valid scopes: `apex` `lwc` `omni` `config` `data-model` `ci` or `{JIRA-KEY}`

---

## What to Avoid

- Do not put logic in `.trigger` files — delegate to a handler immediately
- Do not call `vlocity_cmt.*` directly in OmniStudio Apex — always use the adapter interface
- Do not use `@track` on primitives in LWC
- Do not call Apex inside loops in LWC
- Do not write snapshot tests in JEST
- Do not force-push to `main` or `develop`
- Do not use personal names in branch names
