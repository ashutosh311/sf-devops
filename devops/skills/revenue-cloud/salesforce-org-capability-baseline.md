---
name: org-capability-baseline
description: Use this skill when the job is to baseline an authenticated Salesforce org before broader discovery, validate org-side prerequisites, run the canonical preflight-first command chain, and interpret compact org capability outputs without drifting into domain exploration or final synthesis.
---

> **Vendored into Otto.** This Revenue Cloud skill was adapted from
> `Slalom/arm-build-agents`. Deterministic operations that the upstream skill ran
> through standalone CLIs (e.g. `.agents/skills/.../scripts/*.ts`) are exposed here as
> in-process **RCA MCP tools** (`rca_*`) on the otto MCP server — no external
> clone or PATH setup is required. Deep-dive `references/*` files named below live in the
> upstream skill and are being progressively inlined; treat them as optional context, not
> as files guaranteed to exist in this repo. This skill is only loaded when
> `revenueCloud.enabled` is set in `.sdlc/config.json`.

# Org Capability Baseline

## Purpose
Produce a compact, evidence-backed baseline of an authenticated Salesforce org by validating the CLI/auth environment first, then running the canonical org-grounding command and reporting org capability/package/automation/security signals with appropriate caveats.

## Required context
- Authenticated Salesforce org alias or equivalent selector accepted by `sfx discover org-baseline`.
- Access to the shared `sfx` CLI substrate.
- If continuing an existing chain, the current `run_id` so artifacts append to the same run.
- If interpreting existing output instead of running live commands, the relevant run-scoped `doctor-sf-cli` and/or `discover-org-baseline` output artifact for a specific `command_execution_id`.

If the org alias, auth posture, or run context is missing, retrieve or validate it through the deterministic preflight path first.

## Output contract
- Preferred deliverable: canonical `sfx doctor sf-cli` output followed by canonical `sfx discover org-baseline` output in the same run.
- Optional concise interpretation: org readiness status, capability/package snapshot, automation/security hints, warnings, limitations, and next recommended action.
- Interpretation must stay artifact-backed and execution-aware.

## Operating rules
- Prefer `sfx doctor sf-cli` before `sfx discover org-baseline`.
- Do not skip preflight for normal org-baseline execution unless the user explicitly supplies and wants interpretation of an existing artifact only.
- Follow canonical CLI and payload contracts in `docs/architecture/`; do not invent alternate schemas.
- Distinguish observed facts from interpretation, and treat warnings/limitations as first-class output.
- Keep scope to org grounding; do not silently expand into domain exploration, repo analysis, or synthesis.

## Default workflow
1. Validate the org alias, run context, and whether the job is live execution or artifact interpretation.
2. Read `references/inputs-and-prereqs.md` if context completeness or allowed scope is unclear.
3. Run or inspect `sfx doctor sf-cli` first.
4. If doctor output is acceptable for proceeding, run or inspect `sfx discover org-baseline`.
5. Read only the narrow interpretation/failure references needed for the current output state.
6. Return the baseline result with caveats and, if needed, hand off to the adjacent skill that matches the next job.

## Context routing guide
| If you mainly need... | Read this next | Then do this |
|---|---|---|
| accepted context, live-vs-artifact mode, or preconditions | `references/inputs-and-prereqs.md` | validate org alias, run context, and scope |
| reading packages, capabilities, automation, or security hints from artifacts | `references/evidence-interpretation.md` | cite payload fields and keep claims bounded |
| warnings, limitations, partial outputs, or inability to proceed | `references/common-failure-modes.md` | apply caution rules and route to fix/handoff |

## Deterministic command and artifact preference
- First choice for live work: `sfx doctor sf-cli --json`
- Second choice for live org grounding: `sfx discover org-baseline --org <org_alias> --json`
- If continuing a chain: append `--run-id <run_id>` to preserve artifact continuity.
- If the user provides existing artifacts, prefer reading the relevant run-scoped `outputs/doctor-sf-cli--<command_execution_id>.json` and `outputs/discover-org-baseline--<command_execution_id>.json` rather than re-running commands.

## Tool routing (RCA MCP tools)
The `sfx` discovery surface is exposed in-process on the otto MCP server —
no external CLI install. Prefer these tools over shelling out:

| MCP tool | Use for | Key inputs |
|---|---|---|
| `rca_sfx_doctor` | Preflight: assess `sf` CLI readiness before org grounding | (none) |
| `rca_sfx_org_baseline` | Read-only org capability/package/automation/security baseline | `org` (required alias/username), `detail` (`low`/`standard`/`deep`) |
| `rca_sfx_commands` | List the discovery command surface for orchestration | (none) |

Each returns the canonical JSON result envelope (`status`, `summary`, `result`,
`warnings`, `errors`, `meta`, `evidence`). `rca_sfx_org_baseline` and
`rca_sfx_doctor` invoke the Salesforce `sf` CLI internally (read-only) — the same
`sf`/authed-org prerequisite normal discovery already needs.

## Optional adjacent-skill boundaries
- `project-inventory`: if the main need is repo/package/codebase grounding, hand off rather than broadening this skill.
- `discovery-brief-generator`: if the job is to combine repo and org findings into facts/interpretations/hypotheses/open questions, hand off to synthesis.
- Domain exploration skills: if baseline signals suggest a focused domain follow-up, stop at recommending the next command/skill instead of performing the deeper analysis here.
- Agent escalation is justified only when org discovery becomes unusually broad or branchy; routine Phase 1 org grounding should stay in the main thread.

## Reference routing map
- `references/index.md` — router for which narrow leaf to open next
- `references/inputs-and-prereqs.md` — accepted context, preflight expectations, and artifact-vs-live rules
- `references/command-sequencing.md` — canonical preflight-first command sequence and proceed/stop logic
- `references/evidence-interpretation.md` — how to interpret payload fields without overclaiming
- `references/common-failure-modes.md` — warning, limitation, and partial-output handling
