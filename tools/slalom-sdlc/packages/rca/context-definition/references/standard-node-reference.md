# Standard RCA Context Node Reference

This reference documents the standard node hierarchy and mapping patterns that exist in every Salesforce Revenue Cloud Advanced (RCA) `SalesTransactionContext` extension. These are inherited from `SalesTransactionContext__stdctx` and are consistent across all orgs.

For org-specific node details (custom attributes, line ranges, mapping counts), run:
```bash
node .agents/skills/revenue-management-context-definition-editor/scripts/discover-context-def.js <path-to-file>
```

## Standard Node Hierarchy

### SalesTransaction Root

The primary root for all quote/order/agreement transactions:

```
SalesTransaction (root)
├── SalesTransactionAction
├── SalesTransactionItem                      (largest node — line items)
│   ├── SalesTrxnAdjustmentGroup
│   ├── SalesTransactionItemDetail
│   ├── SalesTrxnItemRelationship
│   ├── STItemPromotionAdjustment
│   ├── SalesTransactionItemTax
│   ├── SalesTransactionItemAttribute         [TRANSPOSABLE]
│   ├── ContributorPriceDetail
│   ├── SalesTrxnItemRateCardEntry
│   │   └── SalesTrxnItemRateAdjustment
│   ├── MediaPlanLineItem
│   ├── SalesTrxnItemUseRsrcPolicy__std
│   ├── SalesTrxnItemUseRsrcGrant__std
│   └── SalesTransactionItemPriceAdjustment__std
├── SalesTransactionRecipient
├── AppUsageAssignment
├── FulfillmentTransaction
│   └── FulfillmentTransactionItem
│       ├── FulfillmentLineAttribute          [TRANSPOSABLE]
│       ├── FulfillmentLineRel
│       └── LineItemDecomposition
├── SalesTransactionGroup
├── MediaPlan
└── SalesTransactionRecipientGroup__std
    └── SalesTransactionRecipientGroupMember__std
```

### Asset Root

The root for asset lifecycle management:

```
Asset (root)
├── AssetStatePeriod
│   └── ASPAttribute                          [TRANSPOSABLE]
├── AssetRelationship
├── AssetAction
│   └── AssetActionSource
│       └── AssetActionSourceAssetPromotion__std
├── AssetContractRelationship
├── AssetRateCardEntry
│   └── AssetRateAdjustment
├── AssetAppUsageAssignment
├── BindingObjectRateCardEntry__std
│   └── BindingObjectRateAdjustment__std
├── BindingObjUsageRsrcPlcy__std
└── AssetUsageEntitlement__std
```

### Contract Root

The root for contract-related entities:

```
Contract (root)
├── ContractAUA
├── ContractPAS
└── ContractItemPrice
```

## Polymorphic Mapping Pattern

The same abstract context nodes map to different SObjects depending on which entity mapping is active at runtime. Only one mapping is active per transaction.

### Standard Entity Mappings

| Context Node | QuoteEntitiesMapping | OrderEntitiesMapping | SalesAgreementEntitiesMapping |
|-------------|---------------------|---------------------|------------------------------|
| SalesTransaction | Quote | Order | SalesAgreement |
| SalesTransactionItem | QuoteLineItem | OrderItem | SalesAgreementProduct |
| SalesTransactionItemDetail | QuoteLineDetail | OrderItemDetail | — |
| SalesTransactionAction | QuoteAction | OrderAction | SalesAgreementAction |
| SalesTransactionRecipient | QuoteLineRecipient | — | — |
| Asset | Asset | Asset | Asset |
| Contract | Contract | Contract | Contract |

The `QuoteEntitiesMapping` is typically marked `<default>true</default>`.

### Standard Mapping Intents

| Intent | Purpose | Used By |
|--------|---------|---------|
| `hydration` | Load data FROM SObjects INTO context | Entity mappings (Quote, Order, etc.) |
| `persistence` | Save data FROM context INTO SObjects | Entity mappings (Quote, Order, etc.) |
| `association` | Link context nodes to each other or cross-context | ALL mappings; exclusively by association mappings |
| `translation` | Data transformation between formats | Entity mappings (Quote, Order, etc.) |

Entity mappings (Quote, Order, SalesAgreement, Contract) declare all four intents.
Association-only mappings (ProductDiscovery, Asset-to-Transaction, etc.) declare only `association`.

## Transposable Nodes

Three standard nodes are marked `<transposable>true</transposable>`:

1. **SalesTransactionItemAttribute** — Dynamic key-value attributes on line items
2. **ASPAttribute** — Dynamic attributes on Asset State Periods
3. **FulfillmentLineAttribute** — Dynamic attributes on fulfillment lines

Transposable nodes support dynamic attribute collections where the attribute names are not known at design time. They store key-value pairs rather than fixed schemas.

## Naming Conventions

| Pattern | Meaning |
|---------|---------|
| `SalesTransactionContext__stdctx` | Salesforce-managed standard context |
| `SalesTransactionContext_Ext` | Customer extension (common convention) |
| `__std` suffix on nodes/attributes | Salesforce platform extension (added in later API versions) |
| `__c` suffix on attributes | Customer custom field |
| No `<inheritedFrom>` element | Customer-added element |
| `ParentReference` attribute | Parent node relationship (present on all child nodes) |

## Context Attribute Schema

Every `<contextAttributes>` block in a node definition can contain:

| Element | Required | Description |
|---------|----------|-------------|
| `<contextTags><title>` | Recommended | Tag name for `queryTags()` in Apex |
| `<dataType>` | Yes | Data type: string, currency, number, percent, boolean, datetime, picklist, reference, selfreference |
| `<fieldType>` | Yes | Direction: `input` (read-only), `inputoutput` (read-write) |
| `<title>` | Yes | Attribute name (used in mappings) |
| `<key>` | Yes | Whether this is a primary key (`true`/`false`) |
| `<transient>` | Yes | Whether persisted (`false` = persisted, `true` = in-memory only) |
| `<value>` | Yes | Whether this is the value field (`true`/`false`) |
| `<customMappingAllowed>` | Yes | Whether custom mappings are allowed |
| `<displayName>` | Optional | Human-readable label |
| `<inheritedFrom>` | Conditional | Full path from standard context (only on inherited attributes) |
| `<domainSet>` | Conditional | Parent node name (only on `ParentReference` attributes) |

## Hydration Detail Patterns

### Simple Field (1-hop)
```xml
<contextAttrHydrationDetails>
    <objectName>Quote</objectName>
    <queryAttribute>Field_Name__c</queryAttribute>
</contextAttrHydrationDetails>
```

### Relationship Traversal (2-hop)
```xml
<contextAttrHydrationDetails>
    <contextAttrHydrationDetails>
        <objectName>RelatedObject</objectName>
        <queryAttribute>Field_Name__c</queryAttribute>
    </contextAttrHydrationDetails>
    <objectName>StartingObject</objectName>
    <queryAttribute>RelationshipName</queryAttribute>
</contextAttrHydrationDetails>
```

### Deep Traversal (3-hop)
```xml
<contextAttrHydrationDetails>
    <contextAttrHydrationDetails>
        <contextAttrHydrationDetails>
            <objectName>FinalObject</objectName>
            <queryAttribute>Field_Name__c</queryAttribute>
        </contextAttrHydrationDetails>
        <objectName>MiddleObject</objectName>
        <queryAttribute>RelationshipToFinal</queryAttribute>
    </contextAttrHydrationDetails>
    <objectName>StartingObject</objectName>
    <queryAttribute>RelationshipToMiddle</queryAttribute>
</contextAttrHydrationDetails>
```

Nesting reads **inside-out**: innermost = final field to read, outermost = starting object.

