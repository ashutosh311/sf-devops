---
name: project-inventory
description: Use this skill when the user needs repo-side Salesforce project grounding, package-root discovery, metadata family footprint, candidate domain signals, or architecture hotspots for a local Salesforce codebase before broader discovery or workshop prep.
---

> **Vendored into slalom-sdlc.** This Revenue Cloud skill was adapted from
> `Slalom/arm-build-agents`. Deterministic operations that the upstream skill ran
> through standalone CLIs (e.g. `.agents/skills/.../scripts/*.ts`) are exposed here as
> in-process **RCA MCP tools** (`rca_*`) on the slalom-sdlc MCP server — no external
> clone or PATH setup is required. Deep-dive `references/*` files named below live in the
> upstream skill and are being progressively inlined; treat them as optional context, not
> as files guaranteed to exist in this repo. This skill is only loaded when
> `revenueCloud.enabled` is set in `.sdlc/config.json`.

# Salesforce Project Inventory

## Purpose
Produce repo-side Salesforce grounding by preferring the canonical `sfx discover project-inventory` command, then interpreting its artifacts carefully enough to support next-step routing without absorbing org-baseline or discovery-brief work.

## Required context
- A local repo path to inspect. Default to the current repo only when that is the obvious target.
- Ability to run the shared Salesforce discovery CLI in the repo environment.
- If appending into an existing discovery chain, the relevant `run_id`.

If the repo path or run context is missing, retrieve or validate it through the preferred deterministic path before broad manual reading.

## Output contract
This skill should yield the canonical output from `sfx discover project-inventory` plus a concise interpretation that stays within the payload and evidence contract. Expected result surface:
- the latest relevant `discover-project-inventory` output artifact for the active `run_id`
- evidence-backed repo-grounding observations about package roots, metadata-family counts, candidate domains, hotspots, and next-step routing
- explicit handoff guidance when the next action belongs to `org-capability-baseline` or `discovery-brief-generator`

Do not redefine payload schemas here; use the canonical contract in `docs/architecture/payloads/salesforce-discovery-discover-project-inventory-payload-spec.md`.

## Operating rules
- Prefer `sfx discover project-inventory` over manual repo traversal.
- Keep `SKILL.md` thin; open only the narrow reference leaves needed for the task.
- Treat the CLI output JSON as canonical and markdown/prose as secondary.
- Cite artifacted evidence for non-trivial claims; do not infer major domain conclusions from filenames alone without supporting evidence refs.
- Distinguish observed repo facts from interpretations and tentative domain signals.
- Do not absorb org-baseline responsibilities.
- Do not absorb discovery-brief synthesis responsibilities.
- Do not invent alternate payload, envelope, or artifact names.

## Default workflow
1. Validate repo path, CLI availability expectations, and whether a `run_id` was supplied.
2. Read `references/command-sequencing.md` and run the preferred deterministic command.
3. Read `references/evidence-interpretation.md` only as needed to interpret payload fields and warnings without overclaiming.
4. Return concise repo-grounding findings tied to the output artifact and evidence refs.
5. Hand off to `org-capability-baseline` or `discovery-brief-generator` when the task crosses this skill's boundary.

## Context routing guide
| If you mainly need... | Read this next | Then do this |
|---|---|---|
| whether the skill applies, required context, or scope checks | `references/inputs-and-prereqs.md` | validate scope before running anything |
| how to read metadata counts, hotspots, domains, and evidence refs | `references/evidence-interpretation.md` | interpret only what the artifact supports |
| warnings, mixed repos, partial results, or when not to overreach | `references/common-failure-modes.md` | apply caution and handoff rules |

## Deterministic command and artifact preference
Prefer this command first:
- `sfx discover project-inventory --repo <repo-path> --json`

If continuing an existing run:
- `sfx discover project-inventory --repo <repo-path> --run-id <run_id> --json`

Prefer the latest relevant `discover-project-inventory` artifact for the active `run_id` when the task is interpretation-only and fresh retrieval is not needed.

## Tool routing (RCA MCP tools)
The `sfx` discovery surface is exposed in-process on the slalom-sdlc MCP server —
no external CLI install. Prefer this tool over shelling out:

| MCP tool | Use for | Key inputs |
|---|---|---|
| `rca_sfx_project_inventory` | Scan a repo for Salesforce package roots, metadata families, and discovery hotspots | `repo` (required path), `detail` (`low`/`standard`/`deep`) |
| `rca_sfx_commands` | List the discovery command surface for orchestration | (none) |

Returns the canonical JSON result envelope (`status`, `summary`, `result`,
`warnings`, `errors`, `meta`, `evidence`). Read-only; operates on local files.

## Optional adjacent-skill boundaries
- `org-capability-baseline`: hand off when the next question is about live org packages, capabilities, auth posture, or org automation surfaces.
- `discovery-brief-generator`: hand off when the job is to synthesize workshop-ready facts, interpretations, hypotheses, open questions, and next-best questions across saved artifacts.
- Later domain skills: hand off only after repo grounding is complete and the domain-specific investigation is the primary job.
- Agent handoff: only justify an agent if the repo is unusually large, multi-root, or branchy enough that evidence volume would exceed normal thread discipline.

## Reference routing map
- `references/index.md` — first router for deeper guidance
- `references/inputs-and-prereqs.md` — applicability, context expectations, and scope checks
- `references/command-sequencing.md` — preferred command, flags, and artifact-first sequence
- `references/evidence-interpretation.md` — how to interpret payload outputs without redefining the schema
- `references/common-failure-modes.md` — edge cases, warnings, and boundary-preserving responses
