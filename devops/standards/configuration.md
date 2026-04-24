---
title: Salesforce Configuration Standards
description: Metadata naming conventions, profile vs permission set strategy, validation rules, flows, custom labels, and org-wide defaults.
scope: configuration, metadata, security
enforce: always
---

# Configuration Standards

---

## 0. User Naming Conventions

To ensure a consistent approach across Salesforce environments, the following username formats MUST be used:

| Convention Type              | Format                                      |
| ---------------------------- | ------------------------------------------- |
| Standard user (production)   | `name@__clientName__.co.uk`                 |
| Standard user (sandbox)      | `name@__clientName__.co.uk.{sandboxName}`   |
| Contractor user (production) | `name@ext.__clientName__.co.uk`             |
| Contractor user (sandbox)    | `name@ext.__clientName__.co.uk.{sandboxName}` |

---

## 1. Metadata Naming Conventions

### General Rules

- Use `PascalCase` for all API names (objects, fields, classes, flows).
- Use descriptive names — `Account_Type_Validation` not `Rule_01`.
- Never use spaces or special characters in API names.

### Custom Objects

```
{Domain}{Entity}__c

Examples:
  OrderLine__c
  BillingSchedule__c
  ProductConfiguration__c
```

### Custom Fields

```
{Descriptor}__c

Examples:
  BillingStartDate__c
  IsActive__c
  ExternalReferenceId__c
```

### Flows

```
{SObject}_{TriggerEvent}_{Purpose}

Examples:
  Account_AfterUpdate_SyncToCRM
  Opportunity_BeforeInsert_SetDefaults
  Case_Screen_EscalationProcess
```

### Flow Element Naming

Flow elements MUST use a 3–4 letter prefix denoting the element type, followed by a descriptive PascalCase name:

| Element        | Prefix | Example                    |
| -------------- | ------ | -------------------------- |
| Constants      | `Con`  | `Con_RecordCategoryNew`    |
| Variables      | `Var`  | `Var_CallBackDate`         |
| Screens        | `Scr`  | `Scr_EndCampaignMembers`   |
| Choices        | `Cho`  | `Cho_AttendedManualCall`   |
| Decisions      | `Dec`  | `Dec_GotCampaignRecord`    |
| Record Lookups | `Lkup` | `Lkup_CampaignMember`      |
| Record Updates | `Upd`  | `Upd_CampaignMember`       |

### Validation Rules

Validation Rule API names MUST be a concise, single-word `PascalCase` description of the rule's purpose — not a verbose underscore-delimited name. The name should read as a short sentence describing what the rule enforces.

```
Examples:
  ReasonRequiredWhenClosed
  StartDateAfterEndDate
  StatusMandatoryForStandardUsers
  BillingPostalCodeRequired
  CloseDateMustBeFuture
```

The user-facing error message MUST explain what was wrong and what the user should do — see §3 Validation Rules below.

### Permission Sets

```
{Feature}_{AccessLevel}

Examples:
  OrderManagement_Read
  OrderManagement_Edit
  BillingAdmin_Full
```

### Additional Declarative Components

| Component              | Naming Guidance                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Record Types           | Label should describe what a business user sees when creating a record. Both label and description are visible — description MUST explain the record type in business terms (e.g. `Prospect - A potential customer who is not yet a buyer of company product`). DeveloperName uses `PascalCase`. |
| Page Layouts           | Every object has a default page layout named after the object label. The default layout should remain; do not delete and replace it unless a rename is essential. |
| Custom Buttons & Links | Follow Field and Object naming conventions.                                                                                   |
| Support Processes      | Follow Field and Object naming conventions.                                                                                   |
| Approval Processes     | Follow Field and Object naming conventions.                                                                                   |
| Queues                 | Follow Field and Object naming conventions.                                                                                   |
| Apps                   | Follow Field and Object naming conventions.                                                                                   |
| List Views             | Follow Field and Object naming conventions.                                                                                   |
| Field Sets             | Follow Field and Object naming conventions.                                                                                   |
| Search Layouts         | Search layouts are fixed and cannot be renamed.                                                                               |
| Assignment Rules       | Only one active assignment rule is possible at a time (with multiple conditions). Where multiple areas require assignment, they share an overall rule. |
| Escalation Rules       | Only one active escalation rule is possible at a time — same constraint as Assignment Rules.                                  |
| Related Lookup Filters | Created as constraints on lookup fields to restrict which data is available. Follow Field and Object naming conventions.      |
| Workflow Rules         | Deprecated. Use Flow automation instead.                                                                                      |

---

## 2. Profile vs Permission Set Strategy

**Profiles are minimally permissive. All feature access is granted via Permission Sets.**

| Item | Profiles | Permission Sets |
|------|----------|----------------|
| Object CRUD | Base read access only | Feature-specific CRUD |
| Field-level security | No field access by default | Granted per feature |
| Apex class access | Minimal | Granted per feature |
| LWC access | None | Granted per feature |

### Rules

- NEVER grant object edit/delete access directly on a Profile.
- Every user-facing feature MUST have a corresponding Permission Set.
- Permission Sets MUST be grouped into Permission Set Groups for deployment.
- Use `Permission Set Licenses` for licensed features (e.g., OmniStudio).

---

## 3. Validation Rules

- Every validation rule MUST have a clear error message in plain English.
- Error message format: `{What was wrong}. {What the user should do}.`
  - Good: `Billing Postal Code is required for US accounts. Please enter a 5-digit ZIP code.`
  - Bad: `Validation failed.`
- Rules that apply only to a specific record type MUST check `RecordType.DeveloperName`.
- Deactivate — do not delete — validation rules during data migration windows.

---

## 4. Flows

### Workflow Automation Choice

Do not use the same automation tool and Apex triggers on the same object — having both creates order-of-execution ambiguity and makes debugging significantly harder. Where both are required, ensure the interaction between them is deliberately designed and documented.

**Flows are the preferred automation tool.** Workflow Rules and Process Builder are retired. Use Apex triggers only when Flow cannot support the required logic.

### Flow Naming

Record-triggered flows MUST be named `<Object Name> <Event Type>`:

```
Account Before Insert/Update
Account Before Delete
Account After Insert
```

`Before` is used for Fast Field Updates; `After` is used for Actions and Related Records.

### Flow Types

| Flow Type | Use Case | Notes |
|-----------|----------|-------|
| Record-Triggered | Automate record changes | Preferred over Apex triggers where possible |
| Screen Flow | Guided user input | Replace custom VF pages where possible |
| Autolaunched | Called from Apex / other flows | No UI, reusable logic units |
| Schedule-Triggered | Batch processing | Use Apex batch for >50k records |

### Flow Trigger Automation Strategy

Prefer **multiple smaller, focused Flows** over a single large monolithic Flow on an object. Smaller Flows are easier to maintain, test, and understand independently.

- **Trigger Order MUST be set** on every record-triggered Flow. Use lower numbers for Flows that must run first (e.g. validation, pre-processing) and higher numbers for Flows that depend on earlier updates (e.g. notifications, post-processing).
- Use the **Flow Trigger Explorer** (accessible from Flow Setup or within any record-triggered Flow) to view and manage execution order across all Flows on an object.
- Document the entry criteria clearly in the Flow description so admins know exactly when and why the Flow runs.

### Flow Design Rules

- Never use `Get Records` with no filter — always constrain queries.
- All SOQL inside Flows must be bulkification-safe (use collections).
- Complex logic (>5 decision nodes) should move to Apex for maintainability.
- Screen flows run under the current user's permissions — ensure the user has access to all required records and handle `No Access` scenarios gracefully.

### Flow — Element Descriptions

**Every element in a Flow MUST have its Description field populated.** This is one of the most valuable forms of Flow documentation because it surfaces directly in Flow Builder. Descriptions should explain the *why*, not just the *what*, so future admins and consultants understand the intent. This is especially important for Agentforce, which uses element descriptions to understand how a Flow works and when variables should be used.

### Flow — Documentation

For complex automation, maintain a central documentation entry (e.g. Confluence page or linked JIRA epic) that provides further context on the design decisions, dependencies, and intended behaviour. Reference this in the Flow's own description field.

### Flow — Strict Entry Criteria

Be specific with Flow entry criteria — loose criteria cause Flows to run on record changes that are irrelevant to the automation, consuming governor limits unnecessarily. Use formula-based conditions for complex entry logic rather than chaining multiple decision elements inside the Flow.

### Flow — Bypass Decision

Every record-triggered Flow MUST check the `BypassAutomation` custom permission (or a Hierarchical Custom Setting) in its entry criteria, so Flows can be disabled for data imports and sandbox seeding without a deployment.

### Flow — Before-Save Flows Preferred

Wherever possible, use **Before-Save Flows (Fast Field Updates)** rather than After-Save Flows. Before-Save Flows run before the record is written to the database and are significantly more performant because they avoid a separate DML operation. Reserve After-Save Flows for actions that genuinely require the record to be committed first (e.g. creating related records, sending notifications).

### Flow — Asynchronous Paths

Design actions to run **asynchronously** where the outcome does not need to be immediate. Use Asynchronous Paths to queue actions for later, or Schedule-Triggered Flows to run processing outside of business hours. This reduces transaction load and avoids unnecessary governor limit pressure.

### Flow — No DML Inside Loops

NEVER put DML actions inside loops. Add records to a collection variable inside the loop, then perform the DML action on the collection after the loop completes.

### Flow — Reusable Sub-flows

Use Autolaunched sub-flows to reuse logic across multiple Flows (e.g. error logging, email notification). Where a Flow involves multiple branching processes, a main Flow should launch secondary sub-flows for each branch — this keeps each branch independently maintainable and improves readability.

### Flow — Permission Elevation

Screen Flows run in **user context**. When a step requires elevated access (e.g. querying system objects the user cannot see), isolate those steps in an Autolaunched sub-flow that runs in **system context**. This allows permissions to be elevated at specific, controlled points while keeping the rest of the Flow in user context. Permission elevation MUST be used sparingly and requires a comment explaining why system context is needed.

### Flow — Logic Abstraction

Use Custom Metadata, Custom Settings, or Custom Labels in Flows (rather than hardcoded values) in the following scenarios:

- Application or org data referenced in multiple places (e.g. a support email address).
- Mappings between values (e.g. mapping a record type to a queue, or a state to a tax rate).
- Information that changes frequently (e.g. terms and conditions text, threshold values).
- Frequently used text such as task descriptions, Chatter posts, or notification content.
- Environment-specific variables (URLs, record Ids, or values that differ between orgs).

### Flow — No Hardcoded Ids

Like Apex, never hardcode Salesforce record Ids in Flows. Use Custom Labels, Custom Metadata, or Custom Settings for any values that may vary between orgs or over time.

### Flow — Fault Paths and Exception Handling

- Every DML element MUST have a fault path — never allow a Flow to fail silently.
- Fault paths MUST log the error using the same logging approach as Apex (the `Logger` platform event framework or an equivalent logging tool applied consistently across Apex and Flow).
- When a fault path is in place, Salesforce considers the error *handled* and does not show an error to the user automatically. Therefore, fault paths MUST also include a **Custom Error element** to display a meaningful message to the end user.
- In production, all unhandled Flow exceptions MUST be monitored and the Flow updated to handle those conditions explicitly.

---

## 5. Custom Labels

- Use Custom Labels for **all** static text displayed in Apex, LWC, or Flow — enables translation and centralised updates without touching markup.
- Lightning Component label name: `<ComponentName>_<LabelDescription>` — e.g., `AccountMove_SaveButtonValue`
- Lightning Record Page label name: `<ObjectName>_<LabelDescription>` — e.g., `Account_SiteHierarchyTabName`
- Custom Label **Category**: `{ObjectName}_{UsageType}` — e.g., `Account_Validation` — enables filtering by object in list views.
- NEVER hardcode UI strings in Apex or LWC JS.

---

## 6. Declarative Object Considerations

### Picklists

Any picklist used by multiple objects, or likely to be used by multiple objects in future, MUST be configured as a **Global Picklist Value Set**.

Global Picklist Value Set API names MUST use `PascalCase` with **no underscores**. An optional domain prefix may be used to group related picklists by area of the system:

```
{Domain}{Concept}

Examples:
  SalesTerritory        ✅  (domain: Sales, concept: Territory)
  OrderStatus           ✅  (domain: Order, concept: Status)
  BillingCycle          ✅  (domain: Billing, concept: Cycle)
  Sales_Territory       ❌  (underscores not allowed)
  territory             ❌  (no PascalCase, no domain prefix)
```

### Bypass Custom Permission on Automation

Every validation rule MUST check the `BypassValidation` custom permission so it can be suppressed during data migrations:

```
AND(
    NOT($Permission.BypassValidation),
    <actual validation condition>
)
```

Every Flow and Trigger MUST implement a check against the `BypassAutomation` custom permission (or a Hierarchical Custom Setting) so automation can be disabled per user/profile without a deployment.

---

## 7. Org-Wide Defaults and Sharing

- OWD changes MUST go through security review before implementation.
- Sharing Rules MUST be named: `{Object}_{Criteria}_{AccessLevel}` — e.g., `Account_SameRegion_ReadWrite`.
- Document the sharing model in `data-model.md` alongside the data model.
