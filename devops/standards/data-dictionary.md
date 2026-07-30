---
title: Salesforce Data Dictionary Standard
description: Canonical object-reference format for the project data dictionary — one file per object, a lean field table, and a fidelity ladder that lets Discover, Refine, Design, and Build all contribute at the level of detail available to them.
scope: data-model, architecture, documentation
enforce: always
---

# Data Dictionary Standard

The **data dictionary** is the project's living reference for every object and field
in scope — written in the **object-reference style** used by the Salesforce
[Object Reference](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_account.htm)
(one page per object: a description, supported operations, then a field table).

It is produced and maintained by the shared **`#sdlc/data-dictionary`** sub-command,
which any agent (Discover, Refine, Design, Build) can invoke. The dictionary is a
**single accumulating source of truth** — later phases *upgrade* the same files
rather than starting new ones.

---

## 1. Storage layout — one file per object

```
artifacts/
  data-dictionary/
    _index.md                     # object catalogue: object, type, domain, fidelity, last updated
    objects/
      Account.md                  # standard object (only if extended/in scope)
      OrderLine__c.md             # one file per object, named by API name
      BillingCycle__c.md
```

- **One markdown file per object**, named exactly by the object **API name**
  (`OrderLine__c.md`, `Account.md`).
- `_index.md` is the catalogue — every object file MUST have a row in it.
- Never split one object across multiple files; never combine multiple objects
  into one file.

---

## 2. Fidelity ladder

The dictionary is built incrementally. Each object file declares a **fidelity
level** in its header, reflecting the best information available when it was last
written. A lower-fidelity run MUST NOT overwrite or delete higher-fidelity content
(see §6 Merge rules).

| Fidelity | Produced by | Contains | Field API names? | Permission Sets? |
|----------|-------------|----------|------------------|------------------|
| **Conceptual** | Discover | Business entities + attributes, source systems, ownership | ❌ business names only | ❌ |
| **Inferred** | Refine | Attributes implied by acceptance criteria | ❌ proposed names only, marked `(proposed)` | ❌ |
| **Logical** | Design | Objects/fields from `solution-design.md` + `sf-discovery.md`, proposed API names & types | ⚠️ proposed, marked `(proposed)` | ⚠️ intended access |
| **Physical** | Build | Reconciled against deployed metadata / live org | ✅ authoritative | ✅ actual |

> **Discover boundary.** At Conceptual fidelity the dictionary MUST stay
> business-level: business entity and attribute names, source systems, and data
> ownership only. No `__c` API names, no Salesforce field types, no permission
> sets, no automation — those belong to Design (Logical) and Build (Physical).

---

## 3. Per-object file format

Every object file MUST follow this exact structure.

```markdown
# {Object Label} (`{ObjectApiName}`)

> **Fidelity**: Physical · **Last updated**: 2026-07-28 · **Source**: org (alias `qa`)
> **Type**: Custom · **Domain**: Order · **Linked**: EPIC-02 / PROJ-42

## Description

What this object represents, which business domain owns it, and how it is used.
(For standard objects, describe only the project-relevant usage and customisations.)

## Sharing

- **OWD**: Private
- **Sharing**: Sales Reps see own records; Managers see team records via Role Hierarchy.
- **Manual Sharing**: Support team granted Read per-case.

## Supported Operations

| Create | Read | Update | Delete | Query | Search |
|:------:|:----:|:------:|:------:|:-----:|:------:|
|   ✅   |  ✅  |   ✅   |   ❌   |  ✅   |   ✅   |

## Fields

| Field Label | API Name | Type | Description | Permission Sets | Field-level Validation |
|-------------|----------|------|-------------|-----------------|------------------------|
| External Reference Id | `ExternalReferenceId__c` | Text(255), External ID, Unique | Upsert key from the source ERP. | `Order_Manager` (Edit), `Order_ReadOnly` (Read) | Required; must match `^ORD-\d{6}$` (VR `Order_ExternalRef_Format`) |
| Billing Start Date | `BillingStartDate__c` | Date | First day of the billing cycle. | `Order_Manager` (Edit) | Must be ≤ `BillingEndDate__c` (VR `Order_Billing_DateOrder`) |
| Is Active | `IsActive__c` | Checkbox (default false) | Soft-delete flag; queries filter `IsActive__c = true`. | `Order_Manager` (Edit) | — |

## Relationships

| Field | Type | Related To | Delete Behaviour | Notes |
|-------|------|------------|------------------|-------|
| `Order__c` | Master-Detail | `Order__c` | Cascade | Line meaningless without parent. |
| `ParentOrderLine__c` | Lookup (self) | `OrderLine__c` | Don't allow | Hierarchy; never circular. |

## Picklist Values

### `Status__c` (Global Value Set: `OrderStatus`)
| Value | Label | Default | Notes |
|-------|-------|:-------:|-------|
| `Draft` | Draft | ✅ | |
| `Confirmed` | Confirmed | | |

## Change Log

| Date | Fidelity | Change | Source |
|------|----------|--------|--------|
| 2026-07-28 | Physical | Reconciled from org; added `IsActive__c`. | `#sdlc/data-dictionary` (Build) |
| 2026-07-20 | Logical | Initial design from PROJ-42 solution design. | `#sdlc/data-dictionary` (Design) |
```

### Column rules (lean Slalom set)

The **Fields** table uses exactly these six columns — do not add or reorder:

1. **Field Label** — human-readable label. At Conceptual/Inferred fidelity, use the
   business attribute name.
2. **API Name** — the field API name in backticks. Mark unbuilt fields
   `(proposed)`; leave blank (`—`) at Conceptual fidelity.
3. **Type** — Salesforce field type + key modifiers (length, External ID, Unique,
   default). At Conceptual fidelity, use the business data type (e.g. "date",
   "money", "free text").
4. **Description** — what the field holds, its source system (if any), and valid
   value range / units. This maps to the field's Help Text at Physical fidelity.
5. **Permission Sets** — permission sets that grant access and the level, e.g.
   `Order_Manager` (Edit), `Order_ReadOnly` (Read). `—` until known.
6. **Field-level Validation** — any validation affecting the field, with the
   validation-rule API name in parentheses. Includes required-ness, format,
   cross-field rules. `—` if none.

Unknown cells use an em dash (`—`) — never leave a cell empty or omit the column.

---

## 4. `_index.md` format

```markdown
# Data Dictionary — Object Index

| Object | API Name | Type | Domain | Fidelity | Last Updated | File |
|--------|----------|------|--------|----------|--------------|------|
| Order Line | `OrderLine__c` | Custom | Order | Physical | 2026-07-28 | [OrderLine__c.md](objects/OrderLine__c.md) |
| Billing Cycle | `BillingCycle__c` | Custom | Billing | Logical | 2026-07-20 | [BillingCycle__c.md](objects/BillingCycle__c.md) |
```

---

## 5. Cross-linking

- Design's `solution-design.md` MUST link to each affected object file under the
  **Data Model Changes** section.
- Discover's current/future-state documents SHOULD link to the object files they
  seeded at Conceptual fidelity.
- Build's `implementation-record.md` SHOULD note which object files it promoted to
  Physical fidelity.

---

## 6. Merge rules (no-downgrade)

When `#sdlc/data-dictionary` runs against an object that already has a file:

1. **Never downgrade.** A run that resolves lower fidelity than the file's current
   header MUST NOT overwrite existing higher-fidelity cells. It may only fill cells
   currently `—` and append to the Change Log.
2. **Upgrade in place.** A higher-fidelity run replaces the file's cells, raises the
   `Fidelity` header, and adds a Change Log row.
3. **Flag conflicts, don't silently overwrite.** If a higher-fidelity run finds a
   value that contradicts existing content (e.g. a field renamed, a type changed),
   apply the authoritative value **and** record the change explicitly in the Change
   Log with both old and new values.
4. **Never delete on a partial run.** A run scoped to one story must not remove
   fields/objects it simply didn't look at. Only a Physical, full-org reconciliation
   may mark a field as **Removed** (strike through and note in the Change Log) —
   never hard-delete history.

---

## 7. Non-negotiable rules

1. One file per object, named by API name, catalogued in `_index.md`.
2. The Fields table uses exactly the six lean columns in §3 — no additions.
3. Every object file header declares **Fidelity**, **Last updated**, and **Source**.
4. Conceptual (Discover) content stays business-level — no `__c`, no permission
   sets, no field types.
5. Lower-fidelity runs never overwrite or delete higher-fidelity content.
6. Physical fidelity means reconciled against deployed metadata and/or the live org
   — not assumed.
