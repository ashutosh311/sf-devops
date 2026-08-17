---
name: revenue-management-context-definition-editor
description: Use when editing Agentforce Revenue Management contextDefinition metadata: add context attributes, map fields to context nodes, inspect mappings, or validate context XML.
---

> **Vendored into slalom-sdlc.** This Revenue Cloud skill was adapted from
> `Slalom/arm-build-agents`. Deterministic operations that the upstream skill ran
> through standalone CLIs (e.g. `.agents/skills/.../scripts/*.ts`) are exposed here as
> in-process **RCA MCP tools** (`rca_*`) on the slalom-sdlc MCP server — no external
> clone or PATH setup is required. Deep-dive `references/*` files named below live in the
> upstream skill and are being progressively inlined; treat them as optional context, not
> as files guaranteed to exist in this repo. This skill is only loaded when
> `revenueCloud.enabled` is set in `.sdlc/config.json`.

# Context Definition Editor

Use this skill to inspect, edit, and validate Agentforce Revenue Management context definition XML. Context definitions bridge ARM runtime context nodes to physical SObject storage.

## Tool routing (RCA MCP tools)

The context-definition discovery/validation scripts are vendored into the
slalom-sdlc tool and exposed in-process on the MCP server — no repo clone, no
`node scripts/*.js` invocation, cross-platform. Route all structural work
through these read-only tools:

| MCP tool | Use for | Key inputs |
|---|---|---|
| `rca_context_definition_inspect` | Map structure (nodes, attributes, mappings, remappings) before editing | `path` (to `*.contextDefinition-meta.xml`); optional `output` = `summary` (default) / `json` / `all`; optional `node` for single-node detail |
| `rca_context_definition_validate` | Integrity checks after every coherent edit | `path`; optional `verbose`; optional `checkAttribute` to trace one attribute |

Both are read-only and operate on a local metadata file (no org access). Edits
to the XML are made through the agent's normal file-edit flow; use these tools
to discover before, and validate after.

## Gate

Before editing:

1. Confirm the target is a `*.contextDefinition-meta.xml` file.
2. Identify the target context node and concrete mapping block.
3. Separate node-schema changes from SObject mapping changes.
4. Use the RCA MCP tools for discovery and validation instead of hand-scanning large XML.

## Discovery

Start with a compact structural summary — call `rca_context_definition_inspect`
with just the file `path` (default `output: summary`).

Then inspect the exact node before editing — call
`rca_context_definition_inspect` with `path` and `node: <NodeName>`.

Use `output: all` only for audits or documentation, and `output: json` when you
need the full machine-readable structure.

## Edit Workflow

For a simple custom field:

1. Add a `<contextAttributes>` block to the target `<contextNodes>` entry.
2. Add a matching `<contextAttributeMappings>` block to each concrete entity mapping that should hydrate or persist the field.
3. Validate the file.

For derived or multi-hop fields:

1. Model nested `<contextAttrHydrationDetails>` from the final related object inward.
2. Keep `contextAttribute` and `contextInputAttributeName` aligned unless deliberately remapping.
3. Validate after each coherent edit.

Do not add custom fields to generic platform-managed mapping blocks when an entity-specific mapping exists.

## Validation

Run validation after edits — call `rca_context_definition_validate` with the
file `path` (add `checkAttribute: <AttributeName>` to trace a single attribute,
`verbose: true` for per-node attribute counts).

Use `references/standard-node-reference.md` for standard node names, common SObject targets, data type mapping, tag prefixes, and template details.

## Guardrails

- Custom attributes should not include inherited metadata.
- Data type must match the source SObject field shape.
- Use `inputoutput` for fields that should persist back and `input` for read-only or derived fields.
- Repeat mappings across Quote, Order, Contract, or Sales Agreement blocks only when the field is intentionally supported there.
- Preserve exact XML structure and indentation around nearby sibling blocks.
- Do not infer runtime pricing behavior from context metadata alone; hand off to pricing runtime work when behavior proof is required.
