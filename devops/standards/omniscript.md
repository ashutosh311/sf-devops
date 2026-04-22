---
title: OmniStudio Standards
description: Complete OmniStudio standards — OmniScript design, naming, Integration Procedure and Decision Rule patterns, DataRaptor rules, and testing approach.
scope: omnistudio, omniscript, testing
enforce: always
---

# OmniStudio Standards

---

## 1. Naming Conventions

| Artifact | Convention | Example |
|----------|-----------|---------|
| OmniScript | `PascalCase` Type + SubType + Language compile to an LWC name — Type and SubType use letters/numbers, no spaces or underscores, max 104 chars | Type=`participant`, SubType=`Randomization`, Language=`English` → LWC `participantRandomizationEnglish` |
| Integration Procedure | Type + SubType combine to a unique identifier (camelCase) | Type=`participant`, SubType=`GetKeyDetails` → `participantGetKeyDetails` |
| Decision Rule | `PascalCase` subject + `DR_` + `PascalCase` name | `Pricing_DR_TierCalculation` |
| DataRaptor Extract | camelCase — prefix, Verb, Object, Detail | `extractGetParticipantDetails` |
| DataRaptor Transform | camelCase — prefix, Verb, Object, Detail | `transformOrderPayload` |
| DataRaptor Load | camelCase — prefix, Verb, Object, Detail | `loadCreateOrderRecord` |
| FlexCard | camelCase with `fc` prefix — Verb, Object, Detail | `fcDisplayParticipantDetails` |

### OmniScript Element Naming

| Convention | Guidance |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Element Names | Short, descriptive names. No spaces, no special characters. |
| Standard field names | Use standard names where they exist: `FirstName`, `LastName`, `Street`, `City`, `PostalCode`, `Email`, `Dob`, `Age`. |
| IDs | Include the object name: `AccountId`, `PolicyAssetId`, `CaseId`. |
| Standard abbreviations | `wk` (week), `wkly` (weekly), `mos` (months), `mnly` (monthly), `yr` (year), `yrly` (yearly), `hrs` (hours), `hh` (household), `bene` (beneficiary), `rel` (relationship). |
| Same object, different party | Prefix with the role to disambiguate: `InsuredStreet`, `ClaimantStreet`, `BeneficiaryStreet`. |
| Action elements | Use `VerbObjectDetail` pattern. Standardise verbs: REST → `Get`/`Post`; DataRaptor → `Create`/`Read`/`Update`; Remote Action → `Invoke`; DocuSign Envelope → `DocuSend`; DocuSign Signature → `DocuSign`; Email → `Send`; Calculation → `Calc`; Set Values/Errors → `Set`; PDF → `PDFGen`. |
| Action element type prefix | Prepend a short type code to action element names: Integration Procedure → `IP`; DataRaptor Extract → `DRE`; DataRaptor Post → `DRP`; DataRaptor Transform → `DRT`; Remote Action → `RA`. |

---

## 2. OmniScript Structure

### Step Organization

```
OmniScript
  Step 1: [Data Gathering]   — read-only, no DML
  Step 2: [User Input]       — form elements
  Step 3: [Validation]       — SetErrors, conditional visibility
  Step n: [Confirmation]     — summary screen (no editable fields)
  Final:  [Submit]           — single IP call that commits all changes
```

- Each step handles one logical concern.
- NEVER mix data gathering and user input in the same step.
- The final Submit step MUST call a single Integration Procedure — not multiple IPs.

### Element Naming

```
{ElementType}_{PurposeName}

Examples:
  Text_AccountName
  Select_ProductTier
  DataJSON_OrderPayload
  Action_SubmitOrder
```

---

## 3. Integration Procedure Standards

### Design Rules

1. One IP per transaction boundary. An IP either reads OR writes — not both, unless atomicity requires it.
2. All Apex callouts from an IP MUST go through a named Apex Action — not inline Apex.
3. IPs MUST be versioned — never modify an active IP in place; clone and increment the version.
4. DataRaptors inside an IP MUST use the specific fields they need — no `SELECT *` equivalents.
5. Always handle the `errorCode` output from each element — propagate errors up to the OmniScript.

### Input/Output Contract

Every IP MUST document its contract in its Description field:

```
Input:
  accountId    (String, required)  — Salesforce Account ID
  productCode  (String, optional)  — Filter by product code

Output:
  products      (List)    — eligible product records
  errorCode     (String)  — 'SUCCESS' or error key
  errorMessage  (String)  — human-readable error
```

### Error Handling Pattern

```
RemoteAction / DataRaptor
  └─ SetValues: errorCode = 'SUCCESS'
  └─ Conditional (on error condition):
       └─ SetValues: errorCode = 'PRODUCT_NOT_FOUND'
       └─ SetValues: errorMessage = 'No eligible products found'
       └─ Return (stop processing)
```

---

## 4. Decision Rule Standards

1. Decision Rules MUST encode only pure business logic — no SOQL, no DML.
2. Each DR tests one decision. Compound decisions use chained DRs.
3. Decision Rule inputs and outputs MUST be typed explicitly.
4. DRs MUST be unit tested via Apex (see Testing section below).

---

## 5. DataRaptor Standards

| Type | Rule |
|------|------|
| Extract | MUST specify explicit field list — no wildcard extraction |
| Transform | MUST be idempotent — same input = same output |
| Load | MUST handle upsert with External ID where available |

---

## 6. Performance Rules

- NEVER call an IP synchronously from another IP for simple lookups — cache in a DataJSON.
- Avoid deeply nested SetValues with formula expressions — move complex logic to an Apex Action.
- Batch DataRaptor Loads when inserting more than 10 records.
- IP timeout threshold: if an IP exceeds 10 seconds in testing, it needs optimisation before release.

---

## 7. Performance Best Practices

### Server-Side

| Best Practice | Description | Impact |
|---------------|-------------|--------|
| Trim JSON requests | Use Send/Response Transformations to minimise JSON payload to server actions | Integration |
| Use IPs to reduce server roundtrips | Use for multiple DataRaptors or multiple server calls between steps. IPs can also be "fire and forget" asynchronous transactions | Integration |
| Perform calls asynchronously where possible | Run actions out of the user flow to navigate quickly between steps | Navigation |
| Distribute actions across OmniScript | If multiple server calls between steps take too long cumulatively, distribute them to other parts of the OmniScript | Design |
| Trim DataRaptor Extract outputs | Don't fetch or return more data than needed | Integration |
| Use Cache for DataRaptor and IP | Allocate Platform Cache Partitions for IP and DataRaptor metadata and responses | Cache |
| Use Action Block where possible | Call actions in parallel from OmniScript | Parallelisation |
| Avoid long-running transactions | Keep server time per transaction under 5 seconds; use Chainable only as a last resort | Limits |
| Avoid chain-on-step on SetValues elements | Prevents unnecessary remote calls that negatively impact performance | Chainable |

### Client-Side

| Best Practice | Description | Impact |
|---------------|-------------|--------|
| Reduce Conditional Views, Merge Fields, Formulas | Implement logic server-side where possible | Design |
| Trim JSON responses | Use Send/Response Transformations to trim API responses | Integration |
| Load OmniOut JSON definitions from CMS | Improves performance for retrieving definitions and displaying the flow | OmniOut |
| Remove spaces from all UI element names | Improves OmniScript load time | Load time |
| Keep element count below 200 | Create child OmniScripts if needed to stay under this limit | Design |
| Run logic on the server where possible | Use Formulas in DataRaptor, Conditional Execution in IPs | Integration |
| Time Tracking Flag | Enable during design and testing for performance measurements. Disable before deploying to production | Logging |

---

## 8. UX Design Principles

| Best Practice | Description |
|---------------|-------------|
| Prefill fields | Reduce user input by prefilling fields using contextual data wherever possible |
| Display only essential information | Remove optional or tangential information to keep steps focused |
| Break processes into shorter steps | Avoid confusing users with steps that contain too many elements |
| Guide the user | Create contextual help text and order input fields logically |

---

## 9. User Interface Guidelines

- Use OOTB OmniScript elements wherever possible. Adding custom HTML/CSS/JavaScript increases processing overhead and maintenance effort.
- Where an OmniScript element needs styling changes, create a **custom LWC that extends the OmniScript element's component** rather than applying inline CSS.
- Apply global branding using the Salesforce Lightning Design System (SLDS/Newport Design System) rather than custom stylesheets.

---

## 10. Business Process and Logic

| Best Practice | Description |
|---------------|-------------|
| One owner per OmniScript | Assign one developer owner per OmniScript to maintain clear accountability |
| Use reusable OmniScripts | When a process repeats across multiple OmniScripts, create a reusable OmniScript and embed it as a child |
| Build a skeleton first | Identify reusable elements by building a skeleton of the full OmniScript before adding logic |
| Document each element | Record the purpose of an element in the element's **Internal Notes** property |
| Avoid changing element names | Renaming elements breaks DataRaptors and Apex class references. If a name must change, update all DataRaptor and Apex references simultaneously |

---

## 11. Testing

OmniScripts, IPs, and DRs are platform-executed configurations — they cannot be unit tested directly in Apex. Instead:

1. **Apex Actions** invoked by IPs are fully unit-tested as regular Apex classes.
2. **Integration Procedures** are tested via an injectable service wrapper.
3. **Decision Rules** are tested via an injectable DR service wrapper.
4. **End-to-end flows** are validated in Salesforce with manual or UI automation tests.

### Testing Apex Actions

```apex
@IsTest
private class GetEligibleProductsActionTest {

    @IsTest
    static void execute_returnsProducts_whenAccountExists() {
        MockProductSelector mockSel = new MockProductSelector();
        mockSel.mockProducts = new List<Product2>{
            new Product2(Name = 'Widget A', ProductCode = 'WA-001')
        };

        GetEligibleProductsAction action = new GetEligibleProductsAction(mockSel);
        Map<String, Object> output = action.execute(
            new Map<String, Object>{ 'accountId' => '001000000000001AAA' }
        );

        Assert.areEqual('SUCCESS', output.get('errorCode'));
    }
}
```

### IP Service Wrapper

```apex
public interface IIntegrationProcedureService {
    Map<String, Object> run(String ipName, Map<String, Object> input);
}

public class IntegrationProcedureServiceImpl implements IIntegrationProcedureService {
    public Map<String, Object> run(String ipName, Map<String, Object> input) {
        return (Map<String, Object>)
            vlocity_cmt.IntegrationProcedureService.runIntegrationService(ipName, input, new Map<String, Object>());
    }
}

@IsTest
public class MockIntegrationProcedureService implements IIntegrationProcedureService {
    public String lastCalledIp;
    public Map<String, Object> mockResponse = new Map<String, Object>{ 'errorCode' => 'SUCCESS' };

    public Map<String, Object> run(String ipName, Map<String, Object> input) {
        lastCalledIp = ipName;
        return mockResponse;
    }
}
```

### DR Service Wrapper

```apex
public interface IDecisionRuleService {
    Map<String, Object> evaluate(String ruleName, Map<String, Object> context);
}

public class DecisionRuleServiceImpl implements IDecisionRuleService {
    public Map<String, Object> evaluate(String ruleName, Map<String, Object> context) {
        return (Map<String, Object>) vlocity_cmt.DecisionMatrixService.evaluate(ruleName, context);
    }
}
```

### Coverage Requirements

| Component | Required Tests |
|-----------|---------------|
| Apex Actions (IP callable) | Happy path + error path per action |
| IP Orchestrators | Verify correct IP name called + input mapping |
| DR Callers | Verify correct DR name + output handling |
| DataRaptor Loads | Integration test in dev sandbox |

### Testing Rules

- NEVER call `vlocity_cmt.IntegrationProcedureService` directly in production Apex — always use the adapter interface.
- All Apex code touching IPs or DRs MUST have ≥85% coverage without DML.
- OmniScript end-to-end regression tests MUST run in a dedicated QA sandbox before promotion to UAT.
