---
name: omnistudio-docgen-workflow
description: "Coordinate an OmniStudio Document Generation implementation end to end — discovery, Data Mappers, DOCX template, headless render, record-page launcher, QA. Use when the user wants document generation built or proven for any record type (Quote, Order, Contract, …), or when a DocGen problem needs routing to the right sibling omnistudio-docgen-* skill."
metadata:
  kind: workflow
  domain: omnistudio-document-generation
  provenance: "Newly authored 2026-07-17 from the ARMAF DocGen spike evidence; replaces the former medtech-arm-docgen-orchestrator wrapper (generalized)."
---

> **Vendored into slalom-sdlc.** This Revenue Cloud skill was adapted from
> `Slalom/arm-build-agents`. Deterministic operations that the upstream skill ran
> through standalone CLIs (e.g. `.agents/skills/.../scripts/*.ts`) are exposed here as
> in-process **RCA MCP tools** (`rca_*`) on the slalom-sdlc MCP server — no external
> clone or PATH setup is required. Deep-dive `references/*` files named below live in the
> upstream skill and are being progressively inlined; treat them as optional context, not
> as files guaranteed to exist in this repo. This skill is only loaded when
> `revenueCloud.enabled` is set in `.sdlc/config.json`.

# OmniStudio Document Generation — end-to-end workflow

Coordinate a complete DocGen implementation. Each phase has a dedicated sibling
skill; this skill owns sequencing, gates, and the evidence trail.

## Scope

In scope: server-side OmniStudio Document Generation with DOCX (Microsoft Word)
templates driven by Extract/Transform Data Mappers or explicit token data, the
out-of-the-box (OOB) generate-document OmniScript, and record-page invocation.
Any source object (Quote, Order, Contract, Opportunity, Account, custom) and any
industry.

Out of scope: CLM/e-signature, approval-routing design, client-side DocGen,
PPTX (untested on this path), and regulatory/legal content approval.

## Phase sequence

Phases 1–5 are the **spine** — the fully automatable path that must be proven
before anything else; phase 6 layers UI on top of a proven spine. Run the
phases in order; every later phase depends on org facts discovery establishes.

1. **Discover** — `omnistudio-docgen-discover`. Read-only. Establish package,
   namespace, DocGen object availability, server-side enablement, existing
   templates/mappers as reference patterns, and permission posture. Output:
   discovery evidence JSON with blocker codes.
2. **Design the data contract** — `omnistudio-docgen-data-mapper` (design
   section). Agree the token names, repeating collections, grouping, and
   formatting the document needs before touching the org.
3. **Build and validate Data Mappers** — `omnistudio-docgen-data-mapper`.
   Extract + Transform, validated through the Data Mapper REST API against a
   real record. Gate: the live Transform response must contain every token
   path the template will use. `hasErrors=false` alone is NOT sufficient.
4. **Build and wire the template** — `omnistudio-docgen-template`. Author the
   DOCX, lint it, create/activate the DocumentTemplate wiring chain.
5. **Prove the render headlessly** — `omnistudio-docgen-render`. Insert a
   `DocumentGenerationProcess`, verify `Status=Success`, download and inspect
   the outputs. This is the reliability baseline; do it before any UI work.
6. **Configure invocation (optional but usual)** — `omnistudio-docgen-launcher`.
   Customize the OOB OmniScript and add the record-page action. Contains
   unavoidable manual Designer steps — schedule them with the operator.
7. **QA and evidence** — `omnistudio-docgen-qa`. Static lint, rendered-output
   checks, evidence pack, cleanup manifest, and the troubleshooting matrix for
   anything that failed.

## Execution states and approval gates

Operate in explicit states: `preflight → plan → confirm → apply → verify`.

- Discovery (phase 1) is read-only and needs no write approval.
- Everything from phase 3 onward writes to the org (records, files,
  OmniStudio components). Before the first write, confirm: target org alias,
  environment class (scratch/sandbox/dev/production), and the exact scope of
  writes. Refuse production writes by default.
- Fixture data (test Accounts/Quotes/lines) follows the `salesforce-demo-data`
  skill's guardrails when that skill is available: net-new records,
  distinctive naming, cleanup manifest with delete order.
- Never generate a customer-facing release document from real customer data
  during implementation. Render against fixtures or explicitly approved
  records only.
- Record every org mutation in the evidence pack as you go, not at the end.

## Granting DocGen access (prerequisite for phases 5–6)

The user who renders — or clicks the record-page action — must hold the DocGen
permission sets (typically `DocGenUser` + `OmniStudioExecution`; discovery
lists what the org exposes). Granting is an org write, so it sits behind the
same approval gate. Mechanics retained from the former sf-skills
`dx-org-permission-set-assign` import:

```sh
sf org assign permset --name DocGenUser --name OmniStudioExecution \
  --on-behalf-of <username> --target-org <alias> --json
```

- `--on-behalf-of` targets a specific user; omit it to assign to the
  authenticated CLI user.
- Permission set names are case-sensitive exact API names.
- `--target-org`/`--on-behalf-of` take CLI aliases (`sf alias set`), not the
  User object's `Alias` field.
- If assignment succeeds but the user still lacks access, check
  `<hasActivationRequired>` in the permission set metadata — some sets need
  manual activation in Setup.
- A `Duplicate PermissionSetAssignment` error is proof the user already has
  the set (see `omnistudio-docgen-discover` for read-only posture checks).

## Release gate (for production-bound documents)

Before a rendered document may be treated as releasable, verify: the source
record's approval state satisfies the org's policy; the template version is the
approved one; the render input record has not changed since approval; and the
output is attached to the correct record. If any check fails, produce a blocked
plan and evidence record instead of the document. (Retained concept from the
superseded medtech orchestrator, generalized.)

## What is automatable vs. what is not

Automatable end-to-end (proven): discovery, Data Mapper creation/validation,
DOCX authoring, template wiring/activation/versioning, headless server-side
rendering, output download and verification, WebLink deployment.

Requires a human or the Designer UI (proven limits):

- OmniScript compile/activation lifecycle: only the OmniStudio Designer
  generates `OmniProcessCompilation` and the runtime-compatible LWC
  ("Deploy Standard Runtime Compatible LWC"). CLI/REST `IsActive` flips do not.
- Page-layout/action placement when existing layout metadata is invalid.
- Org catalog/config decisions (e.g. populating a real `Product2.Family`
  picklist) — never fabricate global config.
- Final visual sign-off that the document is customer-appropriate.
- Anything the org gates behind interactive auth or credential exposure
  (e.g. `sf org display` may be policy-blocked).

## Known open limitations (do not claim these work)

- Data Mapper formula (`IF(...)`) result paths were never emitted by the
  standard-runtime REST Transform response, so value-driven conditional
  template sections are configured-but-unproven. Treat them as a gate.
- Currency formatting via `OutputFieldFormat=Currency` returns display strings,
  not numbers.
- The interactive OmniScript path can hang on "Loading…" without creating a
  process even when fully compiled and deployed; the headless render is the
  fallback.

## Handoff criteria

The workflow is done when: the evidence pack shows a successful live render
with dynamic line data for the target record type; local fixture tests pass;
open blockers are explicitly listed with owners; and the cleanup manifest
covers every fixture record created.
