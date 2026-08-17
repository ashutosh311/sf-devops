---
name: salesforce-demo-data
description: This skill should be used when the user asks to create, seed, or plan believable Salesforce demo data for a sandbox, scratch org, UAT org, training org, or pursuit demo, including requests for sample Accounts, Contacts, Opportunities, Cases, Products, Product Catalogs, Quotes, or other org-native records that should fit a client, industry, or scenario. Use it for "seed demo data", "populate this org for a demo", "make synthetic Salesforce records", "create a demo product catalog", or similar asks, not for production migration, broad ETL/backfill work, generic spreadsheet cleanup, or non-Salesforce deliverable generation.
metadata:
  kind: workflow
  domain: accelerated-delivery
---

> **Vendored into slalom-sdlc.** This Revenue Cloud skill was adapted from
> `Slalom/arm-build-agents`. Deterministic operations that the upstream skill ran
> through standalone CLIs (e.g. `.agents/skills/.../scripts/*.ts`) are exposed here as
> in-process **RCA MCP tools** (`rca_*`) on the slalom-sdlc MCP server — no external
> clone or PATH setup is required. Deep-dive `references/*` files named below live in the
> upstream skill and are being progressively inlined; treat them as optional context, not
> as files guaranteed to exist in this repo. This skill is only loaded when
> `revenueCloud.enabled` is set in `.sdlc/config.json`.

# salesforce-demo-data Skill

Use this as the workflow surface for planning and safely creating Salesforce demo data.

## Hard Rules

1. Treat v1 as demo-data-first, not as a generic high-volume seeding system.
2. Confirm `target-org`, environment type, and execution mode before any live sample-record query or write.
3. Keep approval to inspect live sample records separate from approval to mutate data.
4. Default to plan-only until the user explicitly approves writes.
5. Default to net-new creation. Do not update existing records without a second explicit approval after a diff summary.
6. Refuse production writes by default. If the user insists, require a fresh final confirmation immediately before execution.
7. Prefer the narrowest believable object graph that tells the demo story.
8. Do not use generated anonymous Apex writes in v1 unless the repo has explicitly enabled and tested that path.
9. Persist or return a cleanup manifest for anything created.
10. Do not fabricate research-derived real people or casually echo sensitive sample data.


## Workflow

### Step 1: Preflight

Resolve:

- target org alias
- environment class: scratch, sandbox, dev, UAT, or production
- mode: metadata-only, plan-only, or write-enabled
- whether live sample-record queries are allowed
- whether updates to existing records are allowed

Recommended defaults:

- metadata-only and plan-only work is allowed by default
- net-new record creation is allowed only after explicit approval
- updates to existing records require a second explicit approval after a diff summary
- production writes are refused by default

### Step 2: Frame The Demo

Capture or infer:

- audience: sprint demo, pursuit, training, UAT walkthrough, or other
- story being shown
- client or industry to emulate
- core objects likely involved
- what must be pre-seeded before the demo
- what should remain live during the demo
- whether existing demo data or prior seed scripts must be preserved

Ask only the minimum blocking questions. If the user is vague, infer a draft scenario and present it for correction rather than forcing a full upfront brain dump.

### Step 3: Discover The Org

Use discovery to learn the actual org shape before proposing writes.

Minimum discovery actions:

1. Confirm the org alias with `sf org display`.
2. Identify objects in scope with `sf sobject list` and targeted `sf sobject describe`.
3. Inspect fields, lookups, record types, picklists, and requiredness for the likely object graph.
4. Inspect relevant layouts, compact layouts, field sets, or local/retrieved metadata when available to learn which fields users are likely to see.
5. Identify risky unknowns that metadata will not fully answer:
   - duplicate rules
   - triggers and flows
   - ownership and defaulting behavior
   - active pricebooks or setup prerequisites
   - Lightning Dynamic Forms, page assignments, field-level security, or permission sets that may change what users actually see
   - permissions that only fail on insert or update

Treat describe and layout metadata as necessary but not sufficient. Use layouts as a practical signal for which custom fields deserve hydration, but do not assume a field is unimportant just because it is absent from one layout. When risky unknowns remain, call them out in the plan and require a pilot create before broad execution.

Prefer the smallest coherent graph. Do not assume every adjacent object must be created just because it is related.

### Step 3A: Use Case References

Load detailed references only for the matching use case:

- `references/revenue-cloud-product-catalog.md`
  Use when creating or planning Salesforce Revenue Cloud product catalogs, product categories, sellable products, product selling model options, price book entries, configurable attributes, or bundle/component structures. This is the core catalog reference; load it for any Revenue Cloud catalog work.
- `references/revenue-cloud-usage-and-rate-pricing.md`
  Use when the demo needs metered/consumption usage, rate cards, tiered or attribute-based rating, included usage grants, or overage policies. Extends the core catalog reference.
- `references/revenue-cloud-pricing-sync.md`
  Use whenever a write changes pricing/rating source data (price book entries, rate cards, usage resources, catalog membership) and the product must become quote/pricing-ready. Covers the product-index and decision-table refresh workflow.
- `references/sample-record-reconnaissance.md`
  Use when sample-record inspection is approved and would materially improve realism or field selection.
- `references/research-and-realism.md`
  Use when industry or client familiarity materially improves the demo story.

### Step 4: Optional Realism Enrichment

Read optional references only when they are needed. Keep the main plan short, but make it clear which reference guided the object graph or realism choices.

### Step 5: Produce The Plan

Before any write, produce a compact plan with these sections:

1. Target org and environment classification
2. Scenario and audience
3. Assumptions, gaps, and risky unknowns
4. Objects to create
5. Objects proposed for update, if any
6. Representative records by object
7. Layout-visible or seller-visible fields that will be intentionally hydrated
8. Relationship map and dependency order
9. Seeded-versus-live boundary
10. Creation approach
11. Pilot-create requirements for risky objects
12. Verification queries
13. Cleanup approach

If updates are proposed, include a brief diff-style summary before asking for approval.

The plan should be short enough to review quickly but specific enough that the eventual write set is obvious.

For Revenue Cloud usage/rate catalog plans, additionally list:

- discovered usage resources, units of measure, and unit-of-measure classes that will be reused or created
- product usage resources, grants, policies, and binding policies needed for each usage-rated product
- rate cards, pricebook-rate-card visibility, rate entries, tier adjustments, and attribute adjustments
- pricing/product sync prerequisites, including product catalog index status and decision-table pricing/rating sync status
- cleanup manifest coverage for usage/rate children before any parent product cleanup

Do not plan usage/rate writes from labels alone. Usage resources, rate cards, rate entries, and product selling models must resolve to org-proven records, or the plan must stop at approval-gated creation steps.

### Step 6: Execute Safely Or Stop

Apply these write guardrails:

1. Echo the exact `target-org` and environment type.
2. State whether the run is metadata-only, plan-only, or write-enabled.
3. Stop for approval before querying live sample records.
4. Stop for approval before any write.
5. For updates to existing records, require a second explicit approval after showing the proposed change summary.
6. Refuse production writes by default. If the user insists, require a fresh final confirmation immediately before execution.
7. Prefer net-new records with distinctive demo-safe naming and deterministic matching criteria.
8. Keep writes narrow. Do not perform broad reseeding unless the user clearly asks for it.
9. Persist or return a cleanup manifest for created records.
10. When the write creates or changes pricing data, rate-card data, usage/rate data, product-price visibility, or other data that feeds Revenue Cloud pricing/rating decision tables, include a required post-write `refresh-decision-tables` dry-run/approval step for the relevant DecisionTable API names before claiming the product is quote/pricing-ready.

Choose the narrowest safe creation path:

1. `sf data create record` for simple isolated records
2. `sf data upsert bulk` for straightforward repeated rows with deterministic keys
3. Stop at a reviewed plan when the graph is too complex or the supported write seam is unclear

Use pilot creates before broad execution when:

- the object has significant automation risk
- record types or constrained values may be wrong
- package or industry behavior is involved
- the first insert is likely to reveal hidden prerequisites

For orgs with a known authoritative mutation seam, such as a guided Apex router or packaged transaction boundary, treat that seam as a hard constraint. Do not casually mix mutation paths across sensitive object families.

Generated anonymous Apex writes are not the default v1 execution path. Only use them in a later phase if the repo explicitly enables them and the implementation proves:

- approved object whitelist only
- no deletes
- deterministic matching or idempotency keys
- structured execution logs
- clear partial-failure reporting

### Step 7: Verify And Return

After writes, verify with focused SOQL queries.

Verification should prove:

- the intended records exist
- key parent-child links are present
- constrained fields landed as expected
- risky fields or platform seams behaved as expected

If verification fails, say exactly what failed, what was skipped, and whether the org is now in a partial state.

Always return these sections:

## Pre-Write Plan

- target org alias
- environment classification
- mode: metadata-only, plan-only, or write-enabled
- objects in scope
- operation type per object: create or update
- dependency order
- exact commands or files planned
- approval status
- seeded-versus-live boundary

## Execution Summary

- exact commands or files used
- important created record links, using the org instance URL when available
- created ids or deterministic identifiers for the full cleanup/verification set
- updated ids, if any
- warnings, skips, and partial failures

For important created records, prefer clickable Salesforce Lightning links over bare ids. Include links for records a human is likely to open during a demo or handoff, such as key accounts, contacts, opportunities, quotes, catalogs, bundle parents, and other top-level products. Use this shape when the org instance URL is available: `<instanceUrl>/lightning/r/<SObjectApiName>/<recordId>/view`.

## Verification Summary

- verification queries used
- pricing/rating DecisionTable refresh status when pricing data was created or changed
- pass/fail result per check
- follow-up manual checks, if any

## Cleanup Manifest

- cleanup identifiers, files, or commands
- any limitations on cleanup or reversal support

## Forbidden Behaviors

- Do not write to a production org by default.
- Do not query or echo sensitive sample data casually.
- Do not fabricate research-derived real people.
- Do not quietly reseed broad org areas when the user asked for a narrow scenario.
- Do not hide the exact write set behind polished prose.
