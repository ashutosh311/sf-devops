# AI Agent Behaviour

These rules apply to every interaction — they take precedence over any other guidance in this file.

## Core Principles

1. **Do only what was asked.** Complete the requested task precisely — do not refactor surrounding code, add unrequested features, or improve things that weren't mentioned.
2. **One question per turn.** If clarification is needed, ask the single most important question. Do not present multiple questions at once.
3. **State assumptions before acting.** Before executing a multi-step task, briefly list any assumptions you are making. If an assumption would materially change the outcome, ask instead of assuming.
4. **Precision over verbosity.** Be concise. Avoid restating what the user said, narrating what you are about to do, or summarising what you just did. Let the output speak for itself.
5. **Surface blockers early.** If a prerequisite is missing (e.g. a required artifact doesn't exist, the active org is wrong), stop and say so immediately — do not proceed with incomplete information and correct it later.
6. **Verify before recommending.** Do not suggest that a file, class, or metadata component exists unless you have confirmed it by reading the codebase. Memory of a prior conversation is not confirmation.
7. **Never skip standards.** Before generating any Apex, LWC, or metadata, read the relevant file in `devops/standards/`. No exceptions.

## Interaction Style

- When presenting choices to the user, use a numbered list so they can reply with a number.
- When a task has multiple steps, show progress (e.g. "Step 2 of 5 — writing solution design") so the user knows where you are.
- When you write a file, state the path. When you update an existing file, state what changed.
- Do not apologise for limitations or preface answers with disclaimers. Just answer.

---

# Salesforce Development Standards

When generating any Salesforce code or configuration, you MUST follow the standards defined in `devops/standards/`. Reference the relevant file for the area you are working in before generating output.

## Before You Build — Framework Checklist

Before writing any Apex code for a feature, scan `force-app/main/default/classes/` to check whether the framework classes already exist. If any are missing, create them first using the exact patterns in `devops/standards/apex.md`, then proceed with the feature.

| Class | Purpose | Required before writing... |
|-------|---------|--------------------------|
| `TriggerHandler.cls` | Abstract CMT-driven trigger base | Any trigger or handler |
| `TriggerSettingSelector.cls` | Queries `TriggerConfiguration__mdt` | Any trigger or handler |
| `Logger.cls` | Platform-event-based logging | Any Apex class |
| `FeatureToggle.cls` | CMT-backed feature flags | Any feature flag usage |
| `UnitOfWork.cls` | DML accumulation | Any service class |
| `StubBuilder.cls` | Test stub helper | Any test class |

For OmniStudio projects also check for:
- `IIntegrationProcedureService.cls` + `IntegrationProcedureServiceImpl.cls`
- `IDecisionRuleService.cls` + `DecisionRuleServiceImpl.cls`
- `MockIntegrationProcedureService.cls`

Also verify the supporting **metadata** exists in `force-app/main/default/`:
- `objects/TriggerConfiguration__mdt/` — CMT controlling trigger execution
- `objects/FeatureToggle__mdt/` — CMT controlling feature flags
- `objects/Log__e/` — Platform event for logging

If any metadata is missing, create the object and field files following `devops/standards/apex.md` and `devops/standards/data-model.md` before deploying.

## New Feature Recipe — Apex Trigger Feature

When asked to build a new Apex trigger-based feature, follow these steps in order:

1. **Run the framework checklist above** — create any missing classes/metadata first.
2. **Create `{Object}Selector.cls`** — implements `I{Object}Selector`; all SOQL here only; methods named `selectBy<Criteria>()`.
3. **Create `{Object}Service.cls`** — injected with selector via constructor; registers DML through `UnitOfWork`; uses `Logger`.
4. **Create `{Object}TriggerHandler.cls`** — extends `TriggerHandler`; injects selector + service via constructor.
5. **Create `{Object}Trigger.trigger`** — all events declared; one line only: `new {Object}TriggerHandler().run();`
6. **Create `TriggerConfiguration__mdt` record** — one record for this SObject with appropriate event checkboxes.
7. **Create `{Object}ServiceTest.cls`** — non-DML pattern; `StubBuilder` for mocks; `Assert.areEqual`; 85% min; bulk test at 200 records.

## New Feature Recipe — LWC Component

When asked to build a new LWC component, follow these steps in order:

1. Create folder `camelCase` under `force-app/main/default/lwc/`.
2. Create `.html`, `.js`, `.css`, `.js-meta.xml`, and `__tests__/{component}.test.js`.
3. Use schema tokens for fields — never hardcode strings like `'Account.Name'`.
4. `@wire` for reactive reads; imperative Apex for user-triggered actions.
5. Catch all imperative Apex errors; show `ShowToastEvent`; use `reduceErrors()` from `c/ldsUtils`.
6. JEST test: mock all `@salesforce/apex` imports; `afterEach` cleans DOM + `jest.clearAllMocks()`; `data-id` selectors; `await Promise.resolve()` for async; 85% line coverage.

## Standards Reference

| Area | File |
|------|------|
| Apex (triggers, services, logging, testing) | `devops/standards/apex.md` |
| Lightning Web Components + JEST | `devops/standards/lwc.md` |
| OmniStudio (OmniScript, IP, DR, DataRaptor) | `devops/standards/omniscript.md` |
| Declarative config (flows, validation rules, permissions) | `devops/standards/configuration.md` |
| Data model (objects, fields, relationships) | `devops/standards/data-model.md` |
| Data dictionary (object-reference docs) | `devops/standards/data-dictionary.md` |
| Advanced Approvals (ARM, matrix-driven three-tier approvals) | `devops/standards/arm.md` |
| Playwright E2E tests | `devops/standards/playwright.md` |
| Git (branching, commits, PRs) | `devops/standards/git.md` |

## Non-Negotiable Rules

These rules apply to every piece of code or configuration generated — no exceptions:

1. Every Apex trigger MUST use the CMT-based `TriggerHandler` framework — zero logic in `.trigger` files.
2. Feature flags MUST use `FeatureToggle.isEnabled()` backed by `FeatureToggle__mdt` — never hardcoded `if` statements.
3. All Apex classes MUST use the `Logger` class — `System.debug` is never committed.
4. No SOQL in trigger handlers, services, or domain classes — all queries go through Selector classes.
5. Test classes MUST follow the non-DML pattern; 85% coverage minimum; use `Assert.areEqual` not `System.assertEquals`.
6. LWC components MUST have a `__tests__` directory with JEST tests achieving ≥85% line coverage.
7. All commits MUST follow Conventional Commits: `type(scope): summary`.
8. Branch names MUST follow: `{type}/{JIRA-KEY}-{short-description}`.

## AI-Assisted SDLC Workflow

This project uses a structured, agent-driven delivery workflow. Each agent has a strict scope — do not cross phase boundaries.

### SDLC Agents — run in order

| # | Command | Persona | Output | Phase boundary |
|---|---------|---------|--------|----------------|
| 0 | `@otto /init` | Any | Project scaffold + `sdlc.config.json` | — |
| 1 | `@otto /discover` | BA / SA / FL | Structured 4-phase engagement (Prepare→Learn→Ideate→Plan): session notes, synthesized current state, evidence-backed backlog, JIRA push via `push-backlog`. JIRA items **only** via explicit `push-backlog` command. | High-level only — no component design, no field-level data model, no detailed architecture |
| 2 | `@otto /refine` | SA / FL / BA | `artifacts/{KEY}/refinement-notes.md` with Gherkin AC + business context. Story transitioned to Ready for Design. | Business context + AC only — no org discovery, no solution design, no technical decisions whatsoever |
| 3 | `@otto /design` | TA / TL | `artifacts/{KEY}/sf-discovery.md`, `artifacts/{KEY}/solution-design.md`, JIRA sub-tasks. Story transitioned to Ready for Build. | The only agent that produces detailed solution designs |
| 4 | `@otto /build` | Developer | Salesforce metadata deployed under `force-app/`. | Implementation only — follows `solution-design.md` |
| 5 | `@otto /test` | Tester | `artifacts/{KEY}/test-plan.md`, test results. | Testing only |
| 6 | `@otto /release` | DevOps | Deployment record, release notes. | Release only |

### Phase boundary rules — hard constraints

These rules apply across all agents and override any other instruction:

- **`/discover`** runs a 4-phase engagement (Prepare → Learn → Ideate → Plan). Outputs are local knowledge-hub artefacts only (session notes, registers, current/future-state docs, backlog Excel). JIRA items are **never created automatically** — they are pushed explicitly by the `push-backlog` sub-prompt after human review of the Excel file. No component design, field-level data models, or automation specifications.
- **`/refine`** outputs Gherkin acceptance criteria and business context only. It must not perform org discovery, produce solution designs, or make any Salesforce implementation recommendations. All technical decisions belong in `/design`.
- **`/design`** is the **only agent** that produces detailed solution designs, org discovery (`sf-discovery.md`), and JIRA sub-tasks. It owns all technical decisions.
- **`/build`** is the **only agent** that writes to `force-app/`. No other agent may create or modify Salesforce metadata.
- **Context, not template.** Agents may read other JIRA stories (siblings in the sprint/epic, linked issues, the parent epic) to understand the *wider requirement and business context*. They must **never** copy the *processing pattern* of those stories. Stories already taken through the full pipeline will carry solution designs, sub-tasks, deployed-metadata references, and later-phase comments — that completeness is **history, not a cue to reproduce the same artefacts here**. Each agent produces only the outputs defined for its own gate, no matter how far other stories on the board have progressed. If a sibling story has a full design and you are the refine agent, you still produce AC only.

### Development Prompts — day-to-day coding

| Prompt | When to use |
|--------|-------------|
| `#development/new-apex-feature` | Scaffold a full standards-compliant Apex trigger stack |
| `#development/new-lwc` | Scaffold a full LWC component with JEST tests |
| `#development/code-review` | Run a standards check against a diff or file before raising a PR |

### Project Prompts — utility and onboarding

| Prompt | When to use |
|--------|-------------|
| `#project/onboard` | New developer orientation — environment, framework, standards, SDLC walkthrough |
| `#project/create-jira-item` | Create a JIRA epic, story, bug, or task interactively |

**SDLC dependency chain:** `/init` → `/discover` → `/refine` → `/design` → `/build` → `/test` → `/release`

The shared JIRA item creation protocol is in `.github/instructions/jira-item-protocol.instructions.md`.

Discovery artifacts live directly under `artifacts/` in numbered subfolders (`00 - Project/`, `00 - Inbox/`, `00 - Registers/`, `01 - Sessions/`, `02 - Current State/`, `03 - Future State/`, `04 - Backlog/`, `06 - Reference/`). Story artifacts live under `artifacts/{JIRA-KEY}/` — `refinement-notes.md`, `sf-discovery.md`, `solution-design.md`, `test-plan.md`.

The `/discover` sub-prompts are under `.github/prompts/otto/discover/`. Invoke with `#otto/discover <skill>` (e.g. `#otto/discover process-session`, `#otto/discover push-backlog`). Phase playbooks are at `.github/prompts/otto/discover/playbooks/`.

---

## How to Apply These Standards

- **Writing an Apex class**: Read `devops/standards/apex.md` — apply trigger framework, design patterns, logging, and testing sections as appropriate.
- **Writing an LWC component**: Read `devops/standards/lwc.md` — apply naming, structure, wire/imperative guidance, and generate a matching JEST test file.
- **Writing OmniStudio config or Apex Actions**: Read `devops/standards/omniscript.md` — apply naming, IP/DR patterns, and testing wrappers.
- **Designing a data model change**: Read `devops/standards/data-model.md` — apply naming, field types, external ID, and governance rules.
- **Creating metadata (flows, validation rules, permission sets)**: Read `devops/standards/configuration.md`.
- **Committing or branching**: Read `devops/standards/git.md`.
