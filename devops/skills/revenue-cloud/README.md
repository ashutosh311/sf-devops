---
title: Revenue Cloud Advanced (RCA) Skills
description: Domain skill guidance for Salesforce Revenue Cloud Advanced work, vendored from Slalom/arm-build-agents and delivered through the slalom-sdlc render pipeline.
scope: revenue-cloud
---

# Revenue Cloud Advanced (RCA) Skills

Domain playbooks for Salesforce Revenue Cloud Advanced (RCA) / Agentforce Revenue
Management work. They were adapted from `Slalom/arm-build-agents` and vendored into
slalom-sdlc so they ship through the normal tool distribution (VS Code extension,
MCP server, Claude Code plugin) with **no external clone or PATH setup**.

## When these load

These skills are injected into the `#sdlc/design` and `#sdlc/build` agents **only
when `revenueCloud.enabled` is `true`** in `.sdlc/config.json` (set during `/init`).
Non-RCA projects never see them, so there is no prompt bloat. The design/build
agents run a domain classifier and load the matching skill for the story.

Deterministic operations that the upstream repo ran through standalone CLIs are
being exposed as in-process **RCA MCP tools** (`rca_*`) on the slalom-sdlc MCP
server.

## Skills index

| File | Template key | Covers |
|------|--------------|--------|
| [pricing-procedures.md](pricing-procedures.md) | `skills.revenueCloud.pricingProcedures` | Pricing procedures (`ExpressionSetDefinition`, `PricingProcedure`): inspect, trace tags, diff, plan safe edits, validate |
| [quoting-pricing-runtime.md](quoting-pricing-runtime.md) | `skills.revenueCloud.quotingPricingRuntime` | Quote/pricing runtime proof, transcript-to-quote, pricing waterfall debug |
| [revenue-management-context-definition-editor.md](revenue-management-context-definition-editor.md) | `skills.revenueCloud.contextDefinitionEditor` | Context definition inspection and safe editing |
| [omnistudio-docgen-workflow.md](omnistudio-docgen-workflow.md) | `skills.revenueCloud.docgenWorkflow` | OmniStudio DocGen workflow (template, render, QA, data mapper) |
| [salesforce-demo-data.md](salesforce-demo-data.md) | `skills.revenueCloud.demoData` | Demo / seed data generation for RCA scenarios |
| [salesforce-org-capability-baseline.md](salesforce-org-capability-baseline.md) | `skills.revenueCloud.orgCapabilityBaseline` | Org capability baseline discovery |
| [salesforce-project-inventory.md](salesforce-project-inventory.md) | `skills.revenueCloud.projectInventory` | Project metadata inventory discovery |

> The ARM Approvals vertical is a standard, not a skill — see
> [`../../standards/arm.md`](../../standards/arm.md) and the
> `#sdlc/arm-approvals` playbook.

## How they are delivered

- **Bundled** at build time via `packages/core/src/skills.ts` (tsup `.md` loader).
- **Rendered** into design/build prompts by `packages/core/src/engine.ts`
  (`skills.revenueCloud.*`), identically on GHCP and Claude Code.
- **Synced** to existing projects via `scripts/package-instructions.mjs` under the
  cache `skills/` subdirectory (read by `readCachedSkill`).
