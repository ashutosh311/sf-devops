---
title: Salesforce Development Standards
description: Agent-readable index of all development standards. Reference these documents during analysis, design, implementation, and review stages.
scope: all
---

# Salesforce Development Standards

Prescriptive standards for Salesforce projects. Each document is structured for both human and agent consumption. During any SDLC phase, agents MUST reference relevant standards before generating code, designs, or test plans.

## Standards Index

| File | Covers |
|------|--------|
| [apex.md](apex.md) | Trigger framework, feature toggles, logging, design patterns, testing |
| [lwc.md](lwc.md) | Component structure, naming, wire/imperative, error handling, JEST testing |
| [omniscript.md](omniscript.md) | OmniScript design, IP/DR patterns, DataRaptor rules, Apex testing wrappers |
| [configuration.md](configuration.md) | Metadata naming, profiles vs permission sets, validation rules, flows |
| [data-model.md](data-model.md) | Object/field naming, relationships, indexing, external IDs, governance |
| [ux-accessibility.md](ux-accessibility.md) | WCAG 2.1 conformance, SLDS usage, progressive disclosure, mobile, i18n |
| [git.md](git.md) | GitFlow branching, rebase conventions, PR rules, Conventional Commits |

## How Agents Should Use These Documents

- **During `/sf-discover`**: Reference `data-model.md` and `configuration.md` to evaluate org patterns against standards.
- **During `/design`**: Reference `apex.md`, `lwc.md`, `omniscript.md`, and `ux-accessibility.md` to ensure the solution design conforms.
- **During `/implement`**: Enforce all applicable standards when generating Apex, LWC, OmniScript, or custom UI. Flag any deviation explicitly.
- **During `/test-plan`**: Reference the testing sections in `apex.md`, `lwc.md`, and `omniscript.md`, and the accessibility checklist in `ux-accessibility.md §8`.
- **During code review**: Flag any deviation from these standards as a blocking issue.

## Non-Negotiable Rules

1. Every Apex trigger MUST use the `TriggerHandler` framework (Kevin O'Hara `sfdc-trigger-framework`) — no logic in `.trigger` files.
2. Feature flags MUST be implemented via Custom Metadata — never hardcoded `if` statements.
3. All Apex classes MUST use the logging framework — no `System.debug` in production code.
4. Test classes MUST follow the non-DML pattern where possible; 85% coverage minimum.
5. All commits MUST follow the Conventional Commits specification.
6. No direct SOQL in trigger handlers — all queries go through Selector classes.
7. LWC components MUST have a corresponding JEST test file achieving ≥85% line coverage.
8. Only one automation tool per object — Flows OR Apex Triggers, never both.
9. All Flows, triggers, and validation rules MUST implement a bypass check via the `EnableAutomation__c` hierarchical custom setting (or the `BypassAutomation` / `BypassValidation` custom permissions).
10. Never hardcode Salesforce record Ids or environment-specific values — use Custom Metadata, Custom Settings, or query by name.
11. All static text in LWC and Flow MUST use Custom Labels.
12. New Aura components are prohibited — use LWC; wrap in Aura only with Lead Architect approval.
13. Visualforce is prohibited for new development.
14. All custom UI MUST conform to WCAG 2.1 Level AA; prefer standard `lightning-*` components over raw HTML.
