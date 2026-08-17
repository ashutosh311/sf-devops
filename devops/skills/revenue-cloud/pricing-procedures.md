---
name: pricing-procedures
description: Use when working with Salesforce Revenue Cloud pricing procedures: identify ExpressionSetDefinition artifacts, inspect structure, trace context tags, diff versions, plan safe edits, and validate with the pricing-procedure CLI.
---

> **Vendored into slalom-sdlc.** This Revenue Cloud skill was adapted from
> `Slalom/arm-build-agents`. Deterministic operations that the upstream skill ran
> through standalone CLIs (e.g. `.agents/skills/.../scripts/*.ts`) are exposed here as
> in-process **RCA MCP tools** (`rca_*`) on the slalom-sdlc MCP server — no external
> clone or PATH setup is required. Deep-dive `references/*` files named below live in the
> upstream skill and are being progressively inlined; treat them as optional context, not
> as files guaranteed to exist in this repo. This skill is only loaded when
> `revenueCloud.enabled` is set in `.sdlc/config.json`.

# Pricing Procedures

Use this skill for Salesforce Revenue Cloud / Agentforce Revenue Management pricing procedures represented as `ExpressionSetDefinition` metadata with `interfaceSourceType=PricingProcedure`.

## Gate

Before analysis or edits, classify the request:

1. Confirm the artifact is a pricing procedure, not just any `ExpressionSetDefinition`.
2. Route adjacent work explicitly:
   - context-definition edits -> `revenue-management-context-definition-editor`
   - runtime quote/pricing proof -> `quoting-pricing-runtime`
   - decision-table dependency tracing -> this skill plus the decision-table reference
3. State evidence boundaries as source, org retrieval, runtime proof, or inference.

## Default Workflow

1. Classify the ask: identify, explain, inspect step, trace tag, crosswalk context, link decision tables, diff versions, plan change, validate, deploy, or troubleshoot.
2. Prefer deterministic tooling over manual scanning.
3. Read only the narrow reference leaf needed for the classified ask.
4. For requested changes, inspect active version, context mappings/tags, decision-table dependencies, and validation implications before proposing edits.
5. For runtime behavior, do not infer from metadata alone; validate or hand off to the runtime skill.

## Tool Routing

Deterministic pricing-procedure analysis runs **in-process on the slalom-sdlc MCP
server** — there is no external CLI to install and no `arm-setup-cli`/PATH step.

Two operations are exposed directly as MCP tools:

| MCP tool | Use for | Key inputs |
|----------|---------|------------|
| `rca_pricing_inspect` | List candidate steps, or return one exact step's details in a chosen version scope | `file` (required), `version`/`activeOnly`, `stepName`/`sequence`/`actionType`/`parentStep`, `listCandidates`, `stepNameContains`, `verbose` |
| `rca_pricing_diff` | Semantic diff between two versions in one file, or two files | `file`+`versionLeft`+`versionRight`, or `left`+`right`; `tag`, `includeChangeBuckets`, `includeRaw`, `verbose` |

Both return the canonical JSON result envelope (`command`, `status`, `summary`,
`result`, `warnings`, `errors`, `meta`, `evidence`). `rca_pricing_diff` reports
`status: "changed"` when meaningful drift exists. Both are read-only.

The full pricing-procedure command surface (below) is vendored in
`packages/rca/pricing-procedure`; `inspect-step` and `diff` are the first two
surfaced as MCP tools. The remainder are reachable via the same in-process
runtime and will be surfaced as tools incrementally:

- `discover`
- `validate`
- `diff` → **`rca_pricing_diff`**
- `summarize`
- `trace-tag`
- `waterfall-model`
- `waterfall-example`
- `render-waterfall-html`
- `plan-change`
- `inspect-step` → **`rca_pricing_inspect`**
- `crosswalk`
- `doctor`
- `explain-error`

## Reference Map

- artifact recognition -> `references/artifact-identification.md`
- procedure fields and step/action semantics -> `references/procedure-structure/index.md`
- context-tag and context-definition linkage -> `references/dependencies/procedure-context-crosswalk/index.md`
- decision-table linkage -> `references/dependencies/decision-table-linkage.md`
- waterfall visualizer workflow -> `references/script-quick-reference.md` section "Build and render a pricing waterfall visual"
- validation, retrieval, compare, and safe investigation -> `references/validation-and-safe-investigation.md`
- live-org deploy and promotion -> `references/live-org-deploy-and-promotion.md`
- unresolved platform behavior -> `references/known-unknowns.md`

## Guardrails

- Do not load broad research artifacts when a narrower reference or CLI result answers the question.
- Do not flatten ambiguous naming families without checking the crosswalk.
- Do not treat comparator or adjacent expression-set families as pricing-core procedures without evidence.
- Do not duplicate context-definition editing mechanics here; explain linkage, then hand off.
