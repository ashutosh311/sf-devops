---
title: Salesforce Data Model Standards
description: Custom object/field naming, field type selection, relationship design, indexing, external IDs, data governance, and sharing model documentation.
scope: data-model, architecture
enforce: always
---

# Data Model Standards

---

## 1. Object Naming

```
{Domain}{Entity}__c

Domain  — the business domain owning this object (e.g., Order, Billing, Product)
Entity  — the specific concept (e.g., Line, Schedule, Configuration)

Examples:
  OrderLine__c
  BillingCycle__c
  ProductBundle__c
```

- Domain and Entity MUST be singular nouns.
- Avoid generic names like `Data__c`, `Info__c`, `Record__c`.

---

## 2. Field Naming and Types

### Naming

```
{Descriptor}__c

Examples:
  ExternalReferenceId__c
  BillingStartDate__c
  IsActive__c
  UnitPrice__c
```

- Boolean fields MUST start with `Is` or `Has`.
- Date fields MUST end in `Date__c`; DateTime fields in `DateTime__c`.
- Currency fields MUST have help text describing the currency and precision expectation.
- Picklist fields MUST have a global value set unless values are object-specific.
- Global Picklist Value Set API names MUST use `PascalCase` with **no underscores**. An optional domain prefix may be used to indicate the area of the system (e.g., `SalesTerritory`, `OrderStatus`, `BillingCycle`). Never use snake_case for global picklist names (e.g., ~~`Sales_Territory`~~).

### Field Type Selection

| Data | Correct Type | Notes |
|------|-------------|-------|
| External system identifiers | `Text(255)` with External ID | Enables upsert |
| Yes/No flags | `Checkbox` | Default to `false` |
| Monetary values | `Currency` | Never `Number` for money |
| Percentage | `Percent` | Never `Number` |
| Long free-form text | `Long Text Area` | Do not use `Text Area` |
| Sequences / counts | `Number(18,0)` | Auto-Number if system-generated |

---

## 3. Relationship Design

### Lookup vs Master-Detail

| Use Lookup | Use Master-Detail |
|-----------|------------------|
| Child can exist without parent | Child record meaningless without parent |
| Parent deletion should not cascade | Cascade delete is correct behaviour |
| Roll-up summaries not needed | Roll-up summaries needed |

### Junction Objects

- Named `{ParentA}{ParentB}__c` — e.g., `AccountProduct__c`.
- Both Master-Detail relationships go on the junction.
- Junction objects MUST NOT carry significant business logic.

### Self-Relationships (Hierarchies)

- Use `Lookup` to the same object.
- Field name: `Parent{Entity}__c` — e.g., `ParentAccount__c`.
- NEVER create circular references.

---

## 4. Indexing

| Field Characteristic | Index Type |
|---------------------|------------|
| Used in WHERE with high selectivity | Standard Index (mark as External ID or Unique) |
| Used in WHERE with low selectivity (<30% distinct values) | Do not index |
| Foreign keys (Lookup, M-D) | Automatically indexed by Salesforce |
| External system IDs | External ID checkbox |

- Avoid SOQL `LIKE '%value%'` — leading wildcards bypass indexes.

---

## 5. External IDs

Every custom object that interacts with an external system MUST have an External ID field:

```
ExternalId__c    Text(255)    External ID ✓    Unique ✓
```

- Used as the upsert key in DataRaptor Loads and data migration scripts.
- NEVER use Salesforce record IDs as external system keys.

---

## 6. Data Governance

### Required Fields on All Custom Objects

| Field | Type | Purpose |
|-------|------|---------|
| `ExternalId__c` | Text(255), ExtID | Upsert key |
| `IsActive__c` | Checkbox | Soft delete flag |
| `SourceSystem__c` | Picklist | Data lineage |

### Soft Delete Pattern

Do not hard-delete records referenced by other objects or external systems. Set `IsActive__c = false`. All queries MUST filter `IsActive__c = true` unless intentionally reporting on inactive records.

### Record Types

- Use Record Types only when field layout, picklist values, or business process differ significantly.
- Record Type DeveloperNames MUST follow `PascalCase` — e.g., `ResidentialCustomer`.

---

## 7. Sharing Model Documentation

Every object MUST have its sharing model documented in the object's Description field:

```
OWD: Private
Sharing: Sales Reps see own records; Managers see team records via Role Hierarchy.
Manual Sharing: Support team can be granted Read access on a per-case basis.
```

- Document OWD, Role Hierarchy impact, Sharing Rules, and any Apex Managed Sharing.
- Sharing model changes require an architecture review sign-off.

---

## 8. Schema Documentation

All custom objects and fields MUST have Description/Help Text populated:

- **Object Description**: What the object represents, which domain owns it, linked JIRA epic.
- **Field Help Text**: What the field contains, source system origin (if any), valid value range.

Fields without Help Text will be flagged in code review.
