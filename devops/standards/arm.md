---
title: Advanced Approvals (ARM) Standards
description: Reusable, matrix-driven Salesforce Revenue Cloud Advanced Approvals (ARM). Fixed approval contract, data model, component build map, and test catalog for three-tier Flow Approval Processes. Reference before designing or building any discount-approval solution.
scope: arm, approvals, revenue-cloud, flow
enforce: always
---

# Advanced Approvals (ARM) Standards

Build **deterministic, configuration-driven** discount-approval solutions from a client's approval
matrix. The **agent** owns requirements, metadata, matrix records, and verification. The **Salesforce
Flow Approval Process** owns runtime approval decisions. Prefer configuration (matrix header + tier
rows) over client-specific flow branches — never generate a bespoke orchestration per client unless a
verified platform limitation prevents the configuration-driven design.

> Companion prompt: `#sdlc/arm-approvals` (see `.github/prompts/sdlc/arm-approvals.prompt.md`).
> This standard is a **domain playbook** used *inside* the `/design` and `/build` phases — it does
> not cross SDLC phase boundaries on its own.

---

## 1. Approval Contract — fixed runtime semantics

These semantics are non-negotiable and identical across clients:

- Evaluate discounts with **strict greater-than** logic (`>`). Equality does **not** qualify.
- Support **tiers 1–3 only**. Reject tier 0 and any tier > 3.
- Execute qualifying tiers **sequentially** in ascending order.
- Execute multiple qualifying individual requirements **within a tier in parallel**.
- Require **every** qualifying requirement in a tier to approve (unanimous).
- Treat a **queue** assignment as one requirement; the **first eligible** queue member response
  completes it.
- **Stop** later tiers when any requirement rejects.
- **Fail closed** when required configuration or an approver cannot be resolved (missing/inactive
  manager, VP, queue, matrix, or field). Never fail open.

---

## 2. Salesforce mappings

Treat these as requested **defaults, not proof** the metadata already exists. Always describe the org
(`#sdlc/design` discovery) before querying or deploying. Verify `Quote.Discount` specifically — do
not silently substitute a quote-line discount or a calculated field.

| Purpose | API mapping |
|---|---|
| Quote | `Quote` |
| Quote discount | `Quote.Discount` |
| Quote lines | `QuoteLineItem` via `QuoteLineItem.QuoteId` |
| Product | `QuoteLineItem.Product2Id` |
| Product Family Manager | `Product2.Product_Family_Manager__c` — `Lookup(User)` |
| Sales representative | `Quote.OwnerId` |
| Owner manager | `Quote.Owner.ManagerId` |
| Second-level manager | `Quote.Owner.Manager.ManagerId` |
| VP of Sales | `Quote.Owner.VP_of_Sales__c`; `User.VP_of_Sales__c` is a Hierarchical Relationship |
| Finance queue | Label `Finance Approvers`; DeveloperName `Finance_Approvers` |

---

## 3. Matrix data model

Keep matrix **data separate from metadata** so client scenarios load without changing the package.
Field/object API names follow `data-model.md` (`PascalCase`, `__c` suffix). Prefer these objects when
no compatible model already exists:

### `ApprovalMatrix__c` (header)

| Field | Type / purpose |
|---|---|
| `Name` | Client-readable matrix name |
| `OperatingUnit__c` | Controlled operating-unit key |
| `IsActive__c` | Eligibility flag |
| `Priority__c` | Deterministic precedence |
| `EffectiveFromDate__c` | Optional start date |
| `EffectiveThroughDate__c` | Optional end date |

### `ApprovalMatrixTier__c` (child)

| Field | Type / purpose |
|---|---|
| `ApprovalMatrix__c` | Master-detail or lookup to header |
| `Tier__c` | Number, restricted to 1–3 |
| `ThresholdValue__c` | Numeric percentage threshold (store **without** `%`) |
| `ComparisonOperator__c` | Picklist; `Greater Than` in v1 |
| `ApproverType__c` | `Static` or `Dynamic` |
| `ApproverStrategy__c` | Resolution strategy (see §5) |
| `ApproverReference__c` | Username, DeveloperName, or field-path reference |
| `CompletionMode__c` | `Unanimous` or queue first-response |
| `SortOrder__c` | Stable ordering within a tier |
| `IsActive__c` | Eligibility flag |

If an existing implementation requires `MaxDiscount__c`, store the numeric **exclusive** threshold
and consistently evaluate `Quote.Discount > MaxDiscount__c`. Never store values such as `>10%` in a
numeric field.

### Reference matrix

| Operating unit | Tier | Threshold | Type | Strategy | Reference |
|---|---:|---:|---|---|---|
| Cardio US | 1 | `> 10` | Dynamic | `QuoteOwnerManager` | `Quote.Owner.ManagerId` |
| Cardio US | 2 | `> 0` | Dynamic | `ProductFamilyManager` | `Product2.Product_Family_Manager__c` |
| Cardio US | 2 | `> 20` | Dynamic | `SecondLevelManager` | `Quote.Owner.Manager.ManagerId` |
| Cardio US | 3 | `> 30` | Dynamic | `QuoteOwnerVP` | `Quote.Owner.VP_of_Sales__c` |
| Ortho US | 1 | `> 10` | Static | `Queue` | `Finance_Approvers` |
| Ortho US | 2 | `> 25` | Dynamic | `QuoteOwnerVP` | `Quote.Owner.VP_of_Sales__c` |

---

## 4. Scenario normalization & validation

Convert spreadsheet or prose input into the JSON shape in
[`artifacts/samples/arm/client-scenario.example.json`](../../artifacts/samples/arm/client-scenario.example.json).
Store numeric thresholds without `%` and use the strict `>` operator. Then validate.

Preferred — through the slalom-sdlc tool (works in any client project, no repo
checkout, cross-platform), call the MCP tool:

```
rca_validate_arm_matrix { "path": "path/to/scenario.json" }
```

It returns `{ valid, errors, warnings, simulations }` and flags the call as an
error when the scenario is invalid. If you have a checkout of the
`salesforce-devops` repo, the same validator is runnable directly:

```sh
node devops/scripts/validate-arm-matrix.mjs path/to/scenario.json
```

Resolve **every error** before generating records. Review warnings with the user when they affect
routing. The validator also prints per-operating-unit routing **simulations** at each threshold and
just above it — use these to confirm boundary behaviour before any metadata is generated.

---

## 5. Dynamic resolution rules

**Product Family Managers:**

1. Query all `QuoteLineItem` records for the Quote ID.
2. Collect distinct `Product2Id` values.
3. Query/traverse `Product2.Product_Family_Manager__c`.
4. **Block submission** if any applicable product has no active manager.
5. Deduplicate resolved manager User IDs.
6. Require every distinct resolved manager to approve.

**VP of Sales:** resolve the hierarchical `User` field from the quote owner. Never use a static
person name.

Supported strategies: `QuoteOwnerManager`, `ProductFamilyManager`, `SecondLevelManager`,
`QuoteOwnerVP`, `Queue`, `User`, `PublicGroup`, `RecordField`.

---

## 6. Component build map

Use recommended API names; inspect the org first and preserve existing names/namespace/conventions.

| Component | Recommended API name | Responsibility |
|---|---|---|
| Matrix header object | `Approval_Matrix__c` | Scope, precedence, activation, effective dates |
| Tier object | `Approval_Matrix_Tier__c` | Threshold and approver requirement |
| Product field | `Product2.Product_Family_Manager__c` | Dynamic Product Family Manager |
| User field | `User.VP_of_Sales__c` | Dynamic VP of Sales |
| Queue | `Finance_Approvers` | Finance first-response approval |
| Submission flow | `ARM_Request_Quote_Approval` | Validate and request approval |
| Matrix resolver | `ARM_Resolve_Approval_Matrix` | Select one active matrix + qualifying requirements |
| Approver resolver | `ARM_Resolve_Approvers` | Resolve and deduplicate users/groups/queues |
| Context validator | `ARM_Validate_Approval_Context` | Fail closed on configuration defects |
| Work screen | `ARM_Approval_Work_Screen` | Display context, capture decision/comments |
| Approval finalizer | `ARM_Finalize_Approved` | Apply approved state and actions |
| Rejection finalizer | `ARM_Finalize_Rejected` | Apply rejected state and actions |
| Audit logger | `ARM_Log_Approval_Evaluation` | Persist route selection and faults |
| Approval process | `ARM_Quote_Approval_Process` | Coordinate three conditional tiers |

### Helper-flow contracts

**`ARM_Resolve_Approval_Matrix`** — In: `recordId` (Quote ID). Out: `matrixId`,
`tier1RequirementIds` / `tier2RequirementIds` / `tier3RequirementIds` (ID collections), `hasTier1` /
`hasTier2` / `hasTier3` (Boolean), `isValid` (Boolean), `errorMessage` (Text). Select exactly one
active header using operating unit, effective date, and priority. Return an error for an unresolved
precedence tie.

**`ARM_Resolve_Approvers`** — In: `recordId` (Quote ID), `requirementIds` (qualifying tier-row IDs).
Out: `usernames` (distinct active), `groupOrQueueDeveloperNames` (distinct portable), `isValid`
(Boolean), `errorMessage` (Text). Resolve each strategy independently, then deduplicate by User ID or
Group ID. Never return the Automated Process User or an inactive user.

**Evaluation flows** — Initialize `isOrchestrationConditionMet` to `false` and set it `true` only
when the explicit requirement is satisfied. Cover skipped tiers in stage-exit logic so a tier with no
qualifying work does not deadlock the stage.

### Three-tier process shape

1. Background step: resolve and validate the matrix.
2. Tier 1 stage: start only when `hasTier1` is true; all individual requirements must approve.
3. Tier 2 stage: start only after Tier 1 completes or is skipped, and when `hasTier2` is true.
4. Tier 3 stage: start only after Tier 2 completes or is skipped, and when `hasTier3` is true.
5. Decision: approved, rejected, or error.
6. Background step: finalize and log.

Use separate work items when dynamic resolution produces multiple individual users. Assign a native
queue as one work item unless the client explicitly requires every queue member to approve.

---

## 7. Alignment with project standards

ARM helper logic that runs in **Apex** (adapters, invocable resolvers) MUST follow `apex.md`:

- No SOQL in trigger handlers/services/domain classes — all queries via **Selector** classes.
- No direct DML — register through `UnitOfWork`.
- No `System.debug` — use `Logger.info/warn/error`.
- Keep Get Records / DML **out of loops**; collect IDs and operate on collections; add fault paths
  to every element that reads or changes data.

Declarative components follow `configuration.md`:

- One automation tool per object (Flows **or** Apex triggers, never both).
- Every Flow implements a **bypass** check (`BypassAutomation` custom permission or
  `EnableAutomation__c` hierarchical custom setting).
- All static text uses **Custom Labels**. Never hardcode record Ids or environment-specific values.
- Use **portable** usernames and Group/Queue `DeveloperName`s in assignee resources — never record
  Ids. Pass record Ids into helper flows and query current records inside the flow.

Data model changes follow `data-model.md`. Branching, commits, and PRs follow `git.md`.

**Flow Approval Process XML** changes across Salesforce releases. Do **not** hand-author opaque
orchestration XML from memory — retrieve a compatible baseline from the target API version (project
standard **62.0**) or build it through the supported builder/CLI workflow, then apply narrow,
reviewable changes. If no compatible baseline is available, produce exact builder steps + helper-flow
source rather than fabricating deployable XML.

---

## 8. Test catalog

Run before declaring the solution ready.

### Matrix boundaries

| Scenario | Expected route |
|---|---|
| Cardio, 0% | No approval |
| Cardio, exactly 10% | Product Family Manager(s) only |
| Cardio, 10.01% | Owner Manager, then Product Family Manager(s) |
| Cardio, exactly 20% | Owner Manager, then Product Family Manager(s) |
| Cardio, 20.01% | Owner Manager, then PFM(s) and Second-level Manager in parallel/unanimous |
| Cardio, exactly 30% | Owner Manager, then PFM(s) and Second-level Manager |
| Cardio, 30.01% | Previous tiers, then VP of Sales |
| Ortho, exactly 10% | No approval |
| Ortho, 10.01% | Finance Approvers queue |
| Ortho, exactly 25% | Finance Approvers queue |
| Ortho, 25.01% | Finance Approvers queue, then VP of Sales |

### Dynamic routing

- Two product families, different managers → require both managers.
- Two product families, same manager → one deduplicated work item.
- Product without a Product Family Manager → block submission.
- Inactive Product Family Manager → block submission.
- Quote owner without a manager when manager approval qualifies → block submission.
- Quote owner without a VP when VP approval qualifies → block submission.
- Circular User hierarchy → block deployment/data setup or submission.

### Configuration integrity

- Reject tier 0 and tiers > 3.
- Reject unsupported comparison operators.
- Reject duplicate requirements.
- Reject ambiguous active-matrix precedence.
- Reject a static queue without a DeveloperName.
- Warn when a tier can activate while an earlier-numbered tier is skipped; verify stage-exit logic
  covers the path.
- Verify exact-threshold equality does **not** qualify.

### Runtime outcomes

- All same-tier individual approvals approved → advance.
- One same-tier individual approval rejected → reject and withdraw remaining work.
- First eligible Finance queue member approves → complete the queue requirement.
- Final tier approved → update the Quote and audit record exactly once.
- Helper-flow fault → produce an Error outcome and preserve diagnostic context.
- Recall/resubmit → do not reuse stale approver resolution.

### Deployment checks

- Validate metadata against the intended target org and API version (explicit
  `--source-dir` / `--metadata` / `--manifest` scope).
- Confirm Advanced Approvals / Flow Approval Processes are enabled.
- Confirm required licenses and permissions.
- Confirm queue membership and email behaviour.
- Confirm the approval work component is available on the Quote page.
- Activate helper flows and the Flow Approval Process **only after** tests pass.

---

## 9. Non-negotiable rules

1. Strict `>` thresholds; equality never qualifies.
2. Tiers 1–3 only; sequential tiers; parallel-unanimous within a tier.
3. **Fail closed** on any missing/inactive approver, queue, matrix, or field.
4. Keep matrix **data separate** from metadata; load scenarios without changing the package.
5. Validate every scenario with the `rca_validate_arm_matrix` MCP tool (or
   `devops/scripts/validate-arm-matrix.mjs` in a repo checkout) before generating records.
6. Never infer permission to deploy or create records from a request to design, audit, or validate.
   Never deploy to production or create production data without explicit user authorization.
7. Apex follows `apex.md`; declarative follows `configuration.md`; data model follows
   `data-model.md`; git follows `git.md`.
