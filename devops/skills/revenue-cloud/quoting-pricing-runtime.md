---
name: quoting-pricing-runtime
description: Use when planning, preflighting, verifying, or routing Salesforce Revenue Cloud quoting/pricing runtime work through the tracked TypeScript quote-runtime CLI and its persisted-first, evidence-led investigation lanes.
---

> **Vendored into slalom-sdlc.** This Revenue Cloud skill was adapted from
> `Slalom/arm-build-agents`. Deterministic operations that the upstream skill ran
> through standalone CLIs (e.g. `.agents/skills/.../scripts/*.ts`) are exposed here as
> in-process **RCA MCP tools** (`rca_*`) on the slalom-sdlc MCP server — no external
> clone or PATH setup is required. Deep-dive `references/*` files named below live in the
> upstream skill and are being progressively inlined; treat them as optional context, not
> as files guaranteed to exist in this repo. This skill is only loaded when
> `revenueCloud.enabled` is set in `.sdlc/config.json`.

# Quoting/Pricing Runtime

Use this skill for Revenue Cloud quoting/pricing runtime work when you need a scenario-first entrypoint instead of raw API trivia.

This skill is operator-facing and derivative.
For sales-facing transcript-to-quote demos, use the dedicated reference in `references/use-cases/sales-transcript-to-quote-demo.md` before dropping into the technical runtime lanes.
For nontrivial transcript-to-product mapping, use `references/use-cases/product-mix-subagent-prompt.md` as a bounded product-mix delegation prompt.

## Tool routing (RCA MCP tool)
The `quote-runtime` command family is vendored into the slalom-sdlc tool and
exposed in-process on the MCP server — no external CLI, no `arm-setup-cli`, no
PATH setup. Route runtime investigation through the single read-only tool:

| MCP tool | Use for | Key inputs |
|---|---|---|
| `rca_quote_runtime_investigate` | Any read-only quoting/pricing runtime investigation | `command` (one of the read-only commands below), `args` (CLI-style string array, e.g. `["--org-alias","myOrg","--quote-id","0Q0...","--symptom","missing price"]`) |

`command` accepts only the **read-only** investigation surface — `doctor`,
`triage-symptom`, `explain-price`, `explain-missing-price`,
`compare-quote-pricing`, `classify-pricing-outcome`, `inspect-pricing-waterfall`,
`inspect-rlm-context`, `inspect-usage-rate-model`, `inspect-pricing-product-sync`,
`inspect-quote-ready-product`, `inspect-product-catalog-config`,
`inspect-product-config`, `validate-product-config`, `inspect-asset-lifecycle`,
`verify-lifecycle-provenance`, `snapshot-quote`, `snapshot-lines`,
`overlay-actions`, `overlay-relationships`, `discover-products`, `pst-plan`.
Mutating commands (create/upsert/price/apply/activate/repair/deploy/refresh) are
intentionally **not** exposed as tools — perform those through the agent's normal
build + review flow. Every call returns the canonical JSON result envelope.
Org-touching investigators need an authed `sf` org (the normal /build prereq).


## Canonical runtime model

Outcome-first quoting posture:
- target outcome is a verified draft quote or quote update in Salesforce, not a command transcript
- separate transcript facts, seller-note facts, Salesforce-verified facts, inferred mappings, assumptions, blockers, and final verified results
- ask for clarification only when missing information would materially change product choice, commercial terms, target artifact, or destructive mutation scope
- keep mutation PST-only for quote, quote line, relationship, and quote-line attribute work; every write path must dry-run before execute and must prove persisted readback after transport success
- do not create a new quote once a target quote is selected unless the user explicitly asks for a new artifact

GPT-5.5 guidance:
- use medium reasoning for main orchestration unless the quote is trivial or evals prove low is sufficient
- use high reasoning for a product-mix subagent when catalog/product ambiguity is substantial
- stop gathering context once the agent can make a defensible product/configuration choice and execute safely
- keep the final seller response concise: quote id/number/link, verified totals, product/configuration rationale, assumptions, unresolved risks, and next action

Product-mix delegation:
- delegate only when product choice is nontrivial: multiple plausible product families, configured/bundled products, service/hardware/support/add-on mix, careful quantity/term/discount interpretation, or large catalog/config outputs
- the subagent owns semantic product-mix recommendation only; it does not mutate Salesforce, approve writes, or make final quote decisions
- the main agent must sanity-check the recommendation, decide whether ambiguity is material, build the final quote intent, dry-run, execute, price, verify, and produce the seller-facing closeout

Default transcript-to-quote lane:
1. use prompt-guided SF CLI queries from `references/use-cases/sf-cli-data-query-registry.md` to resolve accounts, opportunities, pricebooks, and broad object context
2. use `discover-products` for compact product and pricebook-entry candidates when product intent is known
3. for nontrivial product mix, delegate with `references/use-cases/product-mix-subagent-prompt.md`, then have the main agent own final selection
4. use `inspect-quote-ready-product` for selected candidate products when quote-readiness, term fields, pricebook linkage, or configuration needs must be summarized
5. use `inspect-product-catalog-config` before creating configurable/bundled product lines when deeper catalog/config facts are needed
6. have the agent map transcript/seller intent to explicit Salesforce-returned choices, then use `plan-product-config` to validate those choices
7. build one quote-intent payload and use `pst-apply-quote-intent` as the primary create/patch/append/replace orchestration command
8. use `create-quote`, `upsert-quote-lines`, `build-test-quote`, or `apply-configured-quote` only for narrow operator/debug cases; `apply-configured-quote` creates a new configured quote and is not the default patch path
9. price with `price-quote` unless pricing is already part of the approved `pst-apply-quote-intent` plan
10. verify persisted state via `snapshot-quote`, `snapshot-lines`, `validate-product-config`, and `overlay-relationships`
11. use `inspect-product-config` for runtime configuration messages after quote and line creation
12. use `repair-product-config` only for narrow org-proven post-create child selection repairs; dry-run is default and `--execute` is required for deletes
13. use `capture-post-pst-evidence` and `classify-pricing-outcome` when you need bounded overwrite-aware closeout after execution
14. if the question is causal pricing-step debugging after PST, use `inspect-pricing-waterfall` before `inspect-rlm-context`
15. use `overlay-actions` only for lifecycle provenance
16. use `inspect-rlm-context` only when persisted evidence and waterfall/debug evidence are still insufficient
17. use scenario commands when the operator job is already known

## Current implemented TypeScript command surface

Implemented executable commands:
- `doctor`
- `snapshot-quote`
- `snapshot-lines`
- `overlay-actions`
- `overlay-relationships`
- `inspect-pricing-waterfall`
- `inspect-rlm-context`
- `pst-plan`
- `compare-quote-pricing`
- `triage-symptom`
- `explain-price`
- `explain-missing-price`
- `verify-lifecycle-provenance`
- `test-pricing-change`
- `capture-post-pst-evidence`
- `classify-pricing-outcome`
- `create-quote`
- `upsert-quote-lines`
- `price-quote`
- `build-test-quote`
- `discover-products`
- `inspect-usage-rate-model`
- `inspect-pricing-product-sync`
- `deploy-product-catalog-index`
- `refresh-decision-tables`
- `inspect-quote-ready-product`
- `inspect-product-catalog-config`
- `plan-product-config`
- `apply-configured-quote`
- `pst-apply-quote-intent`
- `inspect-product-config`
- `validate-product-config`
- `repair-product-config`
- `create-lifecycle-scenario`

Implemented helper library:
- `compare-quotes`

Still out of scope here:
- `pst-execute`

Current operator note:
- causal post-PST pricing-step debugging now escalates first to `inspect-pricing-waterfall`
- `inspect-rlm-context` remains a later context-bridge escalation when persisted and waterfall/debug evidence are still insufficient

## Canonical CLI entrypoints

This repo carries the clean handoff/reference surface for the `quote-runtime` command family.
Treat the command forms in this skill as the canonical operator contract.
Treat `tools/salesforce/quote-runtime-cli` as the maintained runtime home.
Treat skill-local runtime files only as implementation/supporting material.

## Quick routing

If the operator says:
- "Can this command run yet?" -> use `doctor --for-command <command>`
- "What selectors do I need?" -> start with `references/contracts/command-taxonomy.md`
- "What does the baseline result look like?" -> `references/contracts/result-schema.md`
- "How do I inspect persisted quote/line state?" -> `snapshot-quote`, `snapshot-lines` (`snapshot-lines` now includes persisted `NetTotalPrice` in its baseline line capture)
- "How do I inspect lifecycle provenance?" -> `overlay-actions`, `verify-lifecycle-provenance`
- "How do I inspect bundle/structure semantics?" -> `overlay-relationships`
- "How do I debug the pricing waterfall or step-by-step pricing behavior after PST?" -> `inspect-pricing-waterfall`
- "How do I inspect the primary context bridge?" -> `inspect-rlm-context` only after persisted evidence and waterfall/debug evidence are still insufficient
- "How do I compare before/after persisted pricing?" -> `compare-quote-pricing` (including persisted line `NetTotalPrice` drift)
- "How do I explain wrong or missing price?" -> `explain-price`, `explain-missing-price`
- "How do I turn a sales transcript into a quote demo?" -> read `references/use-cases/sales-transcript-to-quote-demo.md`; use `discover-products`, `inspect-quote-ready-product`, `inspect-product-catalog-config`, `plan-product-config`, `pst-apply-quote-intent`, `price-quote`, and persisted readback commands for the technical runtime lane
- "When should I delegate product choice?" -> use `references/use-cases/product-mix-subagent-prompt.md` when transcript-to-product mapping is nontrivial; the subagent recommends product mix only, while the main agent owns quote intent, dry-run, execute, price, verify, and seller response
- "How do I resolve account/opportunity/pricebook data?" -> use prompt-guided `sf data query` recipes in `references/use-cases/sf-cli-data-query-registry.md`
- "How do I inspect whether this org has usage/rate pricing objects and records?" -> use `inspect-usage-rate-model`; it is read-only, describe-driven, and can optionally include scrub-worthy samples with `--include-samples`
- "How do I inspect whether usage/rate execution is ready without running PST or writes?" -> use `inspect-usage-rate-model` for org/product usage-rate coverage, then `inspect-pricing-product-sync` for catalog index and DecisionTable readiness; PST child-record payload support is surfaced by `pst-apply-quote-intent` dry-runs
- "How do I inspect product catalog index and pricing/rating decision-table sync readiness?" -> use `inspect-pricing-product-sync`; it is read-only and never runs product index deploy, pricing data sync, decision-table refresh, or quote mutation
- "How do I deploy the product catalog index after preflight?" -> use `deploy-product-catalog-index`; dry-run is default, `--execute` submits only the documented product index deploy route, and it does not run Pricing Data Sync or DecisionTable refresh
- "How do I refresh pricing/rating decision tables after loading pricing data?" -> use `refresh-decision-tables`; dry-run is default, pass one or more `--decision-table-api-name` values, add `--incremental` only when intended, and use `--execute` only after reviewing the planned standard action payload
- "What should happen after pricing data or rate-card data is loaded?" -> resolve the relevant pricing/rating DecisionTable API names, run `refresh-decision-tables` dry-run, get approval for `--execute`, then verify with `inspect-pricing-product-sync --sample-limit 100`; do not present the product as quote/pricing-ready before this checkpoint
- "How do I resolve products/configurable product shape?" -> use `discover-products` for candidates, `inspect-quote-ready-product` for compact quote-readiness, and `inspect-product-catalog-config` for deeper config facts; use SF CLI SOQL from the query registry for broad fallback exploration
- "How do I create, patch, append, or replace quote intent?" -> use `pst-apply-quote-intent`; dry-run is default, target assertions are expected for existing quotes, and scoped `replace_lines` is required for destructive changes
- "How do I run low-level quote or line mutation?" -> use `create-quote`, `upsert-quote-lines`, and `price-quote` only for explicit operator/debug lanes; dry-run is default and `--execute` is required for writes
- "How do I create a new configured quote?" -> inspect product config, plan explicit choices, then use `apply-configured-quote`; validate with `validate-product-config`, `inspect-product-config`, `snapshot-lines`, and `overlay-relationships`

## Evidence discipline

Always separate:
- `documented`
- `repo_proven`
- `org_proven`
- `inferred`
- `unknown`

For overwrite-aware runtime work, also keep these operator rules explicit:
- persisted quote/line proof and runtime step-execution proof are separate gates; do not treat waterfall execution proof as final persisted-outcome proof
- if the changed step fires but a later same-output-family writer may win, treat that as an overwrite-risk classification and use `classify-pricing-outcome` plus targeted waterfall/readback evidence before recommending retargeting
- `capture-post-pst-evidence` is the implemented bounded read-only evidence-packet lane; `classify-pricing-outcome` layers read-only closeout classification on top of it
- mutation commands must validate fields against org describe metadata before execution and still require persisted readback proof after transport success

## References

Start here:
- `references/index.md`
- `references/contracts/result-schema.md`
- `references/contracts/command-taxonomy.md`
- `references/references/core-pricing-waterfall-debug.md`
- `references/use-cases/sales-transcript-to-quote-demo.md`
- `references/use-cases/product-mix-subagent-prompt.md`
- `references/use-cases/configured-quote-prompt-flow.md`
- `references/use-cases/sf-cli-data-query-registry.md`
- `evaluations/scenarios.json`
