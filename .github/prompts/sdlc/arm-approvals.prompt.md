# ARM Approvals — Domain Playbook (Advanced Approvals)

**Persona**: Tech Architect / Tech Lead (design) · Developer (build)
**Phase**: Used **inside** Sprint -1 `#sdlc/design` and Sprint `#sdlc/build` — this is a domain
playbook, **not** a standalone SDLC gate
**Input**: A client discount-approval matrix (spreadsheet or prose) plus the target Salesforce org
**Output**: A validated approval matrix, a matrix-driven three-tier Flow Approval Process design and,
when authorized, generated metadata + matrix records under the owning story

> 📓 **Read the standard first.** Before doing anything, read
> [`devops/standards/arm.md`](../../../devops/standards/arm.md). It is the source of truth for the
> approval contract, Salesforce mappings, matrix data model, component build map, and test catalog.
> Also read `apex.md`, `configuration.md`, and `data-model.md` for the framework rules ARM inherits.

---

You are building a **deterministic, configuration-driven** Salesforce Revenue Cloud Advanced
Approvals solution. **You** own requirements, metadata, matrix records, and verification. The
**Salesforce Flow Approval Process** owns runtime approval decisions.

> ⛔ **Hard boundaries — do not cross:**
> - This playbook does **not** replace `#sdlc/design` or `#sdlc/build`, create JIRA items, or
>   transition ticket statuses. It runs *within* those phases and respects their gates.
> - **Never infer permission to deploy metadata or create records** from a request to design,
>   explain, audit, or validate. Deployment and data creation require explicit user authorization;
>   production **always** requires explicit sign-off.
> - Do **not** hand-author opaque Flow Approval Process orchestration XML from memory. Retrieve a
>   compatible baseline (API 62.0) or use the supported builder/CLI, then apply narrow changes.
> - Do **not** generate a bespoke orchestration per client. Prefer one matrix header + tier rows
>   driving a fixed three-tier process, unless a verified platform limitation prevents it.

---

## Step 0 — Establish the target

Confirm or discover:

- Salesforce project root and target-org alias.
- Target API version (project standard **62.0**) and whether Advanced Approvals / Flow Approval
  Processes are enabled.
- Existing matrix object and field API names, if any.
- The scope of the request: **design only**, source generation, deployment validation, deployment,
  or data creation. Do not widen scope.

If no target org or project is available, produce a design/source plan and clearly label unverified
assumptions. Never invent deployment success.

## Step 1 — Inspect before generating

Use the installed Salesforce CLI and project source as the authority.

- In `#sdlc/design`, run org discovery and record findings in `sf-discovery.md`.
- In `#sdlc/build`, consume the existing `sf-discovery.md` and `solution-design.md` as inputs. If
  either is missing, stop and hand back to `#sdlc/design`. Build mode must not perform design-phase
  discovery or rewrite design artifacts.

- Describe `Quote`, `QuoteLineItem`, `Product2`, `User`, `Group`, and any existing matrix objects.
- Retrieve/inspect relevant fields, flows, permission sets, queues, and approval-process metadata.
- Verify `Quote.Discount` exists — do not silently substitute a quote-line or calculated field.
- Preserve namespace, folder conventions, API version, and unrelated changes.

## Step 2 — Normalize & validate the matrix

Convert spreadsheet/prose input into the JSON shape in
[`artifacts/samples/arm/client-scenario.example.json`](../../../artifacts/samples/arm/client-scenario.example.json).
Store thresholds without `%`; use the strict `>` operator. Then run:

```sh
node devops/scripts/validate-arm-matrix.mjs path/to/scenario.json
```

Resolve **every error** before generating records. Review warnings with the user when they affect
routing. Reject tiers outside `1..3`. Use the printed **simulations** to confirm boundary routing.

## Step 3 — Design the reusable solution

Apply the fixed contract in `arm.md §1`: strict `>`; tiers 1–3 sequential; parallel-unanimous within
a tier; queue = one requirement completed by first eligible member; resolve Product Family Managers
across all quote lines and deduplicate by User ID; **fail closed** on any missing/inactive approver,
queue, matrix, or field. Use the component build map in `arm.md §6` (recommended API names,
helper-flow contracts, three-tier process shape).

- In `#sdlc/design`, record the design in the story's `solution-design.md`.
- In `#sdlc/build`, treat `solution-design.md` as authoritative implementation input and do not
  rewrite it unless explicitly requested.

## Step 4 — Generate metadata safely (only within authorized scope)

- Create only the missing object/field/queue/permission-set/helper-flow/approval-process source in
  the requested scope.
- Prefer **portable** usernames and Group/Queue `DeveloperName`s over org-specific Ids. Pass record
  Ids into helper flows and query current records inside the flow.
- Add fault paths to every element that reads or changes data. Keep Get Records and DML **out of
  loops** — collect Ids and operate on collections. Make evaluation outputs explicit and typed.
- Apex helpers follow `apex.md` (Selector-only SOQL, `UnitOfWork` DML, `Logger`, no `System.debug`).
- Flows follow `configuration.md` (bypass check, Custom Labels, no hardcoded Ids, one automation per
  object).

## Step 5 — Prepare records

Show the proposed matrix header and tier rows **before** creating data — operating unit, tier + strict
threshold, static/dynamic type, resolution strategy, portable reference, completion behaviour. Check
for overlapping active headers and duplicate tier requirements. After explicit approval, create
headers first, tier rows second (with returned header Ids), then re-query and compare to the
normalized scenario.

## Step 6 — Verify & deploy

Run the test catalog in `arm.md §8`. At minimum:

- Validate the scenario with `validate-arm-matrix.mjs`.
- Validate metadata with the Salesforce CLI against the named target org (explicit
  `--source-dir` / `--metadata` / `--manifest` scope).
- Run relevant Flow and Apex tests.
- Simulate exact thresholds and values immediately above them.
- Test missing and duplicate dynamic approvers.
- Activate helper flows and the approval process **only after** tests pass.

Never deploy to production or create production data without explicit user authorization.

---

## Completion report

Report:

- Normalized matrix and assumptions.
- Components created or changed.
- Validation and test results.
- Records created (with Ids) when authorized.
- Unverified org dependencies or manual builder steps.
- Whether work is **local, validated, deployed, or activated**.

Do **not** call the solution complete while the Flow Approval Process, helper flows, permissions,
queue membership, or client records remain unverified. Hand back to `#sdlc/build` (or `#sdlc/test`)
to progress the owning ticket through its normal gates.
