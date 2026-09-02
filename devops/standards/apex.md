---
title: Apex Standards
description: Complete Apex development standards — trigger framework, feature toggles, logging, design patterns, and testing. Reference for all Apex code generation and review.
scope: apex
enforce: always
---

# Apex Standards

---

## 1. Trigger Framework

All Salesforce triggers MUST delegate immediately to a handler class. Zero business logic lives in `.trigger` files.

The framework is based on Kevin O'Hara's open-source [`sfdc-trigger-framework`](https://github.com/kevinohara80/sfdc-trigger-framework). It bundles a single `TriggerHandler` base class that all trigger handlers inherit from. The base class includes context-specific methods (`beforeInsert`, `beforeUpdate`, `afterInsert`, `afterUpdate`, etc.) that are automatically called when a trigger executes. It also acts as a supervisor for trigger execution — monitoring activity and providing control over recursion and execution flow.

An important concept underpinning this framework is that the lifetime of an Apex `static` variable is only for as long as the execution context that first initialised it. Once that transaction ends, the value is lost — unlike in other languages where statics persist for the application lifetime. The framework uses this property to track and control recursion within a single transaction.

### Creating a Trigger Handler

To create a trigger handler, create a class that inherits from `TriggerHandler`:

```apex
public class OpportunityTriggerHandler extends TriggerHandler {
```

To add logic to any trigger context, override the corresponding method. Here is how to add logic to a `beforeUpdate` trigger:

```apex
public class OpportunityTriggerHandler extends TriggerHandler {

    public override void beforeUpdate() {
        for (Opportunity o : (List<Opportunity>) Trigger.new) {
            // do something
        }
    }

    // add overrides for other contexts

}
```

> **Note.** When referencing `Trigger` statics from within a handler class, SObjects are returned (not concrete subclasses like `Opportunity`, `Account`, etc.), so casts are required. This can be done in the constructor if preferred:

```apex
public class OpportunityTriggerHandler extends TriggerHandler {

    private Map<Id, Opportunity> newOppMap;

    public OpportunityTriggerHandler() {
        this.newOppMap = (Map<Id, Opportunity>) Trigger.newMap;
    }

    public override void afterUpdate() {
        //
    }
}
```

### Trigger File Template

The trigger file constructs an instance of the handler and calls `run()`. It MUST also check the `EnableAutomation__c` hierarchical custom setting so the trigger can be switched off per user / profile / org without a deployment (see §6 Bypass Pattern):

```apex
trigger OpportunityTrigger on Opportunity (before insert, before update) {
    if (EnableAutomation__c.getInstance().OpportunityTriggers__c) {
        new OpportunityTriggerHandler().run();
    }
}
```

One trigger per SObject. The trigger file contains exactly the bypass check and a single call to the handler's `run()` method — nothing else.

### Trigger Rules

- NEVER put SOQL, DML, or business logic in a `.trigger` file.
- NEVER write more than one trigger per SObject.
- Every trigger MUST include the `EnableAutomation__c.getInstance().<Object>Triggers__c` check before invoking its handler.
- Every handler MUST extend `TriggerHandler` and add logic only via `beforeInsert` / `beforeUpdate` / `afterInsert` / `afterUpdate` / `beforeDelete` / `afterDelete` / `afterUndelete` overrides.

### Bulk Processing Rules

Triggers fire with a **batch** of up to 200 records at once (data loader, API, mass updates). Handler logic MUST process every record in the batch — never assume a single record.

```apex
// BAD — only processes the first record; 199 others silently ignored in a batch
Account acct = Trigger.new[0];
List<Contact> contacts = [SELECT Id FROM Contact WHERE AccountId = :acct.Id];

// GOOD — processes all records using the full keyset
List<Contact> contacts = [SELECT Id, AccountId FROM Contact
                           WHERE AccountId IN :Trigger.newMap.keySet()];
```

- NEVER access `Trigger.new[0]` as if it is the only record.
- SOQL inside handlers MUST use collection-based filters (`IN :Trigger.newMap.keySet()` or `IN :recordIds`) — never a single Id.
- NEVER put SOQL or DML inside a loop — collect into sets/maps first, query/DML once after the loop.
- Bulk tests MUST use 200 records to verify governor limit compliance (see Testing Standards).

---

## 2. Feature Toggles

Feature flags MUST be stored in Custom Metadata so they can be activated or deactivated per environment without a code deployment. Hardcoded `if (someBoolean)` feature flags are prohibited.

### Custom Metadata Type: `FeatureToggle__mdt`

```
Fields:
  FeatureName__c   Text(255)     — Unique key (e.g. "NEW_PRICING_ENGINE") SCREAMING_SNAKE_CASE
  IsEnabled__c     Checkbox      — Toggle on/off
  Description__c   LongTextArea  — What this flag controls (required)
  Owner__c         Text(255)     — Team or story key (e.g. "PROJ-123")
```

### FeatureToggle Service Class

```apex
public class FeatureToggle {

    private static Map<String, Boolean> cache;

    public static Boolean isEnabled(String featureName) {
        loadCache();
        return cache.getOrDefault(featureName.toUpperCase(), false);
    }

    public static Boolean isDisabled(String featureName) {
        return !isEnabled(featureName);
    }

    private static void loadCache() {
        if (cache != null) return;
        cache = new Map<String, Boolean>();
        for (FeatureToggle__mdt ft : [SELECT FeatureName__c, IsEnabled__c FROM FeatureToggle__mdt]) {
            cache.put(ft.FeatureName__c.toUpperCase(), ft.IsEnabled__c);
        }
    }

    @TestVisible
    public static void mockToggle(String featureName, Boolean enabled) {
        if (cache == null) cache = new Map<String, Boolean>();
        cache.put(featureName.toUpperCase(), enabled);
    }

    @TestVisible
    public static void resetCache() { cache = null; }
}
```

### Feature Toggle Rules

- Flag names MUST be `SCREAMING_SNAKE_CASE`.
- Every flag MUST have a `Description__c` and an `Owner__c`.
- Flags are temporary — raise a JIRA ticket to remove the flag once the feature is stable (>30 days).
- Never query `FeatureToggle__mdt` directly — always go through `FeatureToggle.isEnabled()`.
- Tests MUST use `FeatureToggle.mockToggle()` — never insert CMT records in tests.

---

## 3. Logging Framework

`System.debug` is for throwaway local investigation only — it MUST never be committed. All production logging goes through the `Logger` class.

### Log Levels

| Level   | When to Use                                                                                |
| ------- | ------------------------------------------------------------------------------------------ |
| `DEBUG` | Detailed tracing during development (strip before PR merge unless behind a feature toggle) |
| `INFO`  | Normal operational events worth recording                                                  |
| `WARN`  | Something unexpected but recoverable                                                       |
| `ERROR` | An exception was caught, or a critical invariant was violated                              |

### Platform Event: `Log__e`

```
Fields:
  Level__c          Text(10)
  ClassName__c      Text(255)
  MethodName__c     Text(255)
  Message__c        LongTextArea
  StackTrace__c     LongTextArea
  TransactionId__c  Text(255)
  Context__c        LongTextArea  — JSON blob of key-value context
  Timestamp__c      DateTime
```

### Logger Class

```apex
public class Logger {

    public class LogContext {
        private Map<String, Object> data = new Map<String, Object>();
        public LogContext put(String key, Object value) { data.put(key, value); return this; }
        public String toJson() { return JSON.serialize(data); }
    }

    private static final String TRANSACTION_ID = UserInfo.getSessionId()?.left(15)
        ?? EncodingUtil.convertToHex(Crypto.generateAesKey(128)).left(15);

    public static LogContext context() { return new LogContext(); }

    public static void info(Type cls, String method, String message) { info(cls, method, message, null); }
    public static void info(Type cls, String method, String message, LogContext ctx) {
        publish('INFO', cls, method, message, null, ctx);
    }

    public static void warn(Type cls, String method, String message) { warn(cls, method, message, null); }
    public static void warn(Type cls, String method, String message, LogContext ctx) {
        publish('WARN', cls, method, message, null, ctx);
    }

    public static void error(Type cls, String method, String message, Exception ex) {
        error(cls, method, message, ex, null);
    }
    public static void error(Type cls, String method, String message, Exception ex, LogContext ctx) {
        publish('ERROR', cls, method, message, ex, ctx);
    }

    private static void publish(String level, Type cls, String method, String message, Exception ex, LogContext ctx) {
        EventBus.publish(new Log__e(
            Level__c         = level,
            ClassName__c     = cls.getName(),
            MethodName__c    = method,
            Message__c       = message,
            StackTrace__c    = ex?.getStackTraceString(),
            TransactionId__c = TRANSACTION_ID,
            Context__c       = ctx?.toJson(),
            Timestamp__c     = Datetime.now()
        ));
    }
}
```

### Log Retention

| Level | Retention |
| ----- | --------- |
| ERROR | 90 days   |
| WARN  | 30 days   |
| INFO  | 14 days   |
| DEBUG | 3 days    |

### Logging Rules

- `System.debug` is NEVER committed to version control.
- Always pass the class `Type` literal (e.g., `AccountService.class`) — never a string.
- Always log and re-throw exceptions — swallowing exceptions silently is forbidden.
- Use `LogContext` for structured key-value data instead of string concatenation.

---

## 4. Naming Conventions

### Class Naming

Apex class names MUST use `PascalCase`. The first part of the class name MUST refer to the domain or entity it relates to (e.g. `Account`, `Case`, `Integration`) — not the verb or action (e.g. `AccountSyncUtility` not `SyncAccountUtility`). Class names MUST NOT contain underscores and SHOULD be around 5 words or fewer.

| Class Type             | Convention                           | Example                 |
| ---------------------- | ------------------------------------ | ----------------------- |
| Controller Super Class | `<Entity>Ctlr`                       | `CaseCtlr`              |
| Component Controller   | `<ComponentName>Ctlr`                | `AccountMoveCtlr`       |
| Controller Extension   | `<ComponentName>CtlrExt`             | `CustomerMoveCtlrExt`   |
| Utility / Web Service  | Describes purpose/process, no suffix | `AccountSyncUtility`    |
| Test Class             | `<ClassName>Test`                    | `CustomerMoveCtlrTest`  |
| Data Factory           | `<Entity>Factory`                    | `AccountFactory`        |
| Trigger                | `<ObjectName>Trigger`                | `AccountTrigger`        |
| Trigger Handler        | `<ObjectName>TriggerHandler`         | `AccountTriggerHandler` |

> **Note on the controller suffix:** The SFUK UK&I standard uses `Ctlr` (not `Ctrl`). Every controller class name MUST end in `Ctlr`; controller extensions in `CtlrExt`. Do not mix the two conventions within the same org.

### Method and Variable Naming

Methods and variables MUST use `lowerCamelCase`. Method names SHOULD start with an action word.

```apex
// Methods
public String getAccountName() {}
public void setCaseStatus(String status) {}

// Variables — lowerCamelCase
private String accountName { get; set; }

// Constants — UPPER_SNAKE_CASE
public static final Integer NOT_FOUND_ERROR_CODE = 404;
```

### Auto Property Notation

Use auto property notation for properties in Apex controllers:

```apex
// Preferred
String myProperty { get; set; }

// Avoid
String m_Property;
String MyProperty { get { return m_Property; } set { m_Property = value; } }
```

---

## 5. Code Documentation and Style

### Script Header

Every class and trigger MUST have a header element specifying the description, author, creation date, and a revision history for any subsequent changes:

```apex
/***********************************************************************
@author      Bruce Wayne
@date        24.JAN.2022
@description Handles account creation and validation logic.
             Used to set defaults and enrich data on insert.

Revision(s): BW, 24 Feb 2025, Added bulk processing support
             SG, 01 Mar 2025, Fixed edge case on null Rating
***********************************************************************/
public with sharing class AccountService {
}
```

| Block Tag      | Usage                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------- |
| `@description` | Short description of the purpose of the customisation                                         |
| `@author`      | Full name of the original author                                                              |
| `@date`        | Code creation date in `DD.MMM.YYYY` format (e.g. `24.JAN.2022`)                              |
| `Revision(s)`  | One line per change: initials, date, and brief description. Append; never remove prior lines. |

### Comments

Comments MUST focus on **why**, not **how**. Acceptable comment content:

- Explaining the business purpose or logic behind a decision
- Documenting key assumptions or constraints (e.g. governor limit workarounds)
- Providing guidance on framework or configurable options

```apex
// Check if Opportunity is populated — if so, pre-default the account Id
// to avoid an extra lookup in the next step
if (refAct.Opportunity__c == null) {
    return GoToStep2();
}
```

### Indentation and Formatting

- Use **4 spaces** per indent level. Set your editor tab size to 4 spaces.
- Avoid lines longer than **80 characters**; split at commas or operators, aligning continuation with the start of the expression.
- Opening braces MUST be on the **same line** as the statement (for both Apex and JavaScript):

```apex
// Correct
function doSomething() {
    if (condition) {
        // ...
    } else {
        // ...
    }
}
```

---

## 6. General Coding Best Practices

### Constants

Define constants at the **top of the class** where a value is used in multiple places within a class.

Where the same value is reused across multiple classes, a shared location MUST be used instead of duplicating the literal. The two acceptable options are:

- **Custom Metadata Type** (preferred) — for values that may need to change per environment or without a deployment (e.g. integration endpoints, retry thresholds, business thresholds). Custom Metadata supports tokenisation between environments.
- **Dedicated Apex constants class** — for values that will never change independently of the code (e.g. internal key strings, enumerated status values not represented in the data model). Name the class `<Domain>Constants` (e.g. `AccountConstants`, `BillingConstants`).

```apex
// Per-class (preferred when not reused elsewhere)
private static final String STATUS_ACTIVE = 'Active';
private static final Integer MAX_RETRIES  = 3;

// Cross-class — dedicated constants class
public class AccountConstants {
    public static final String DEFAULT_RECORD_TYPE = 'Business';
    public static final String SUPPORT_EMAIL       = 'salesforce.support@clientname.com';
}
```

Constant names MUST use `UPPER_SNAKE_CASE` with words separated by underscores.

### Safe SOQL — Never Assign to a Single Object

A query expecting one record will throw `'List has no rows for assignment to SObject'` if that record does not exist. Always assign to a list or wrap in try/catch:

```apex
// GOOD — assign to list
List<Account> accounts = [SELECT Id, Name FROM Account WHERE Id = :accountId];
if (!accounts.isEmpty()) {
    Account acc = accounts[0];
}

// BAD
Account acc = [SELECT Id FROM Account WHERE Id = :accountId]; // throws if missing
```

### Never Hardcode Ids or Environment-Specific Values

Salesforce record Ids differ between environments. Use Custom Metadata, Custom Settings, or query by DeveloperName/Name instead:

```apex
// BAD
if (acc.RecordTypeId == '012500000009War') { ... }

// GOOD — query by name, cache in a map
List<RecordType> rtypes = [SELECT Name, Id FROM RecordType
                            WHERE SObjectType = 'Account' AND IsActive = true];
Map<String,Id> rtMap = new Map<String,Id>();
for (RecordType rt : rtypes) { rtMap.put(rt.Name, rt.Id); }
```

**Custom Metadata vs Custom Settings:**

- Use **Custom Metadata** first — it is deployable as metadata and environment-consistent.
- Use **Custom Settings** when values must differ per org (e.g. org-specific URLs or Ids).

### Query Optimisation

- Use **relationship subqueries** to retrieve parent/child data in a single SOQL call instead of two separate queries.
- Use **aggregate queries** (`SUM`, `COUNT`) instead of iterating a full result set.
- Use the `Database.getQueryLocator` approach for dynamic queries to get compile-time field validation.

### Lazy Instantiation

Declare and instantiate variables just before they are needed to minimise heap usage:

```apex
// GOOD — only instantiated when needed
if (custType == 'Gold') {
    Task followUp = new Task();
    followUp.Subject = 'New Incentive';
    insert followUp;
}
```

### Initialise Variables with Default Values

Always explicitly initialise local and instance variables to their default values at the point of declaration:

| Type | Default value |
| --------- | ------------- |
| `String` | `null` |
| `Integer` | `0` |
| `Double` | `0.0` |
| `Boolean` | `false` |
| Any Object | `null` |

```apex
Integer count      = 0;
String  status     = null;
Boolean isActive   = false;
Double  totalValue = 0.0;
```

Relying on implicit Apex defaults makes intent unclear and increases the risk of unexpected behaviour if the platform's default behaviour ever changes.

### String Conversion

Use `String.valueOf(var)` instead of `var + ''` to convert primitives to a String.

### Bypass Pattern

Validation rules and triggers MUST be able to be switched off per user, profile, or org without a deployment. Common reasons include data loads that do not meet validation, test data creation that cannot satisfy every required field, and suppressing trigger side-effects during migrations.

Two mechanisms are supported — pick one and apply it consistently:

1. **`EnableAutomation__c` Hierarchical Custom Setting** *(primary mechanism used in the Confluence Frameworks standard)* — contains one `Checkbox` field per object / automation family. The hierarchy resolves User → Profile → Org, so the setting can be overridden for specific users or profiles.
2. **`BypassValidation` / `BypassAutomation` Custom Permissions** — assigned via profile or permission set. Can be checked from formulas or Apex. Useful when bypass should be governed by standard Salesforce permission tooling.

#### Hierarchical Custom Setting: `EnableAutomation__c`

```
Type: Hierarchy
Fields (Checkbox, default = true):
  AccountValidationRules__c
  AccountTriggers__c
  OpportunityValidationRules__c
  OpportunityTriggers__c
  ... one field per SObject × automation family
```

**Validation Rule formula** — reference the relevant field via `$Setup`:

```
AND(
    $Setup.EnableAutomation__c.AccountValidationRules__c = True,
    Name = 'Test'
)
```

**Trigger check** — at the beginning of the trigger (or inside the trigger file before calling the handler's `run()`):

```apex
EnableAutomation__c accounttriggersenabled = EnableAutomation__c.getInstance(UserInfo.getUserId());
if (accounttriggersenabled.AccountTriggers__c) {
    // Trigger logic in here
}
```

Every validation rule MUST include the bypass check and every trigger MUST respect it.

---

## 7. Exception Handling

### Always Handle Potentially-Throwing Code

Any code that has the potential to throw an exception MUST be wrapped in a try/catch block. Environmental changes — new required fields, validation rules, permission changes — can cause previously working DML or SOQL to start failing. Never assume a block of code will execute without error.

```apex
try {
    insert account;
} catch (DmlException e) {
    Logger.error(AccountService.class, 'createAccount', 'Insert failed', e);
    throw e;
}
```

### Catch Specific Exception Types First

When multiple exception types can be thrown, use **successive catch blocks** ordered from most specific to most generic. The general `Exception` type MUST always be the last catch block.

```apex
try {
    insert accnt;
} catch (DmlException e) {
    // handles DML-specific failures (validation rules, required fields, etc.)
    Logger.error(AccountService.class, 'save', 'DML failed', e);
    throw e;
} catch (Exception e) {
    // fallback for any other unexpected exception — must be last
    Logger.error(AccountService.class, 'save', 'Unexpected error', e);
    throw e;
} finally {
    // optional: cleanup logic that must run regardless of outcome
}
```

Catching a specific subclass (e.g. `DmlException`, `QueryException`, `CalloutException`) before the base `Exception` allows different handling strategies per failure type and produces clearer log output.

### Do Not Silently Suppress Exceptions

Catching an exception and doing nothing is forbidden — it creates a false impression that the system is functioning correctly. See the Logging Framework rules: always log and re-throw. An empty or comment-only catch block will be rejected in code review.

```apex
// FORBIDDEN
} catch (QueryException qe) {
    // silent exception
}
```

---

## 8. Design Patterns

### Strategy Pattern

Use when multiple interchangeable algorithms vary independently from the code that uses them.

```apex
public interface PricingStrategy {
    Decimal calculate(Opportunity opp);
}

public class StandardPricing implements PricingStrategy {
    public Decimal calculate(Opportunity opp) { /* ... */ }
}

public class PricingService {
    private final PricingStrategy strategy;
    public PricingService(PricingStrategy strategy) { this.strategy = strategy; }
    public Decimal getPrice(Opportunity opp) { return strategy.calculate(opp); }
}
```

### Factory Pattern

Centralizes object creation and decouples callers from concrete implementations. Factories are the correct place to wire feature toggles.

```apex
public class PricingServiceFactory {
    public static PricingService create() {
        PricingStrategy strategy = FeatureToggle.isEnabled('DISCOUNTED_PRICING')
            ? new DiscountedPricing()
            : new StandardPricing();
        return new PricingService(strategy);
    }
}
```

### Unit of Work Pattern

Accumulate all DML operations across a transaction, then execute them in a single save.

```apex
public class UnitOfWork {
    private List<SObject> toInsert = new List<SObject>();
    private List<SObject> toUpdate = new List<SObject>();
    private List<SObject> toDelete = new List<SObject>();

    public void registerNew(SObject record)     { toInsert.add(record); }
    public void registerDirty(SObject record)   { toUpdate.add(record); }
    public void registerDeleted(SObject record) { toDelete.add(record); }

    public void commitWork() {
        if (!toInsert.isEmpty()) insert toInsert;
        if (!toUpdate.isEmpty()) update toUpdate;
        if (!toDelete.isEmpty()) delete toDelete;
    }
}
```

**Rule**: Service classes register work — they NEVER call DML directly. The trigger handler or top-level orchestrator calls `commitWork()` once.

### SOLID Principles

- **Single Responsibility**: Each class has one reason to change. `LeadService` handles logic, `LeadSelector` handles queries — they are not the same class.
- **Open/Closed**: Use interfaces and inheritance rather than adding `if/else` branches to existing classes.
- **Dependency Inversion**: High-level modules depend on abstractions (interfaces), not concrete implementations. Pass dependencies via constructors.

```apex
// BAD
public class OrderService {
    private OrderSelector sel = new OrderSelector(); // untestable
}

// GOOD
public class OrderService {
    private final IOrderSelector sel;
    public OrderService(IOrderSelector sel) { this.sel = sel; }
}
```

### Data Layer Separation (Selector Pattern)

**All SOQL lives in Selector classes. Never write SOQL inline in service, domain, or trigger handler classes.**

```apex
public class AccountSelector implements IAccountSelector {
    public List<Account> selectById(Set<Id> ids) {
        return [SELECT Id, Name, OwnerId, Rating FROM Account WHERE Id IN :ids];
    }
}

public interface IAccountSelector {
    List<Account> selectById(Set<Id> ids);
}
```

- Selector methods MUST be named `selectBy<Criteria>()`.
- Selectors are the ONLY classes that issue SOQL. No exceptions.
- Service classes receive a Selector via constructor injection.

---

## 9. Testing Standards

Tests MUST be fast, isolated, and deterministic. Use stubs and mock objects wherever production code is decoupled via interfaces.

### Non-DML Test Pattern

```apex
@IsTest
private class AccountServiceTest {

    @IsTest
    static void setDefaultRating_setsRatingOnBlankAccounts() {
        List<Account> accounts = new List<Account>{
            new Account(Name = 'Acme', Rating = null),
            new Account(Name = 'Initech', Rating = 'Hot')
        };

        AccountService svc = new AccountService(new MockAccountSelector());
        svc.setDefaultRating(accounts);

        Assert.areEqual('Warm', accounts[0].Rating);
        Assert.areEqual('Hot',  accounts[1].Rating);
    }
}
```

### When DML Is Permitted

DML is only acceptable when:

1. Testing a Selector class directly.
2. Testing a Flow or Process that cannot be invoked without records.
3. Testing platform-specific behaviour (e.g., duplicate rules, sharing recalculation).

### Stub Pattern (StubProvider)

```apex
public class StubBuilder implements System.StubProvider {

    private Map<String, Object> returnValues = new Map<String, Object>();
    private Map<String, List<Object[]>> callLog = new Map<String, List<Object[]>>();

    public StubBuilder mockReturn(String method, Object returnValue) {
        returnValues.put(method, returnValue);
        return this;
    }

    public Object handleMethodCall(Object stubbedObject, String stubbedMethodName,
        Type returnType, List<Type> listOfParamTypes,
        List<String> listOfParamNames, List<Object> listOfArgs) {
        if (!callLog.containsKey(stubbedMethodName))
            callLog.put(stubbedMethodName, new List<Object[]>());
        callLog.get(stubbedMethodName).add(listOfArgs.toArray());
        return returnValues.get(stubbedMethodName);
    }

    public Integer callCount(String method) {
        return callLog.containsKey(method) ? callLog.get(method).size() : 0;
    }
}
```

### OmniStudio — IP and DR Wrappers

Always wrap `vlocity_cmt.IntegrationProcedureService` behind an interface so it can be stubbed:

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
```

Similarly for Decision Rules:

```apex
public interface IDecisionRuleService {
    Map<String, Object> evaluate(String ruleName, Map<String, Object> context);
}
```

### `@TestSetup` for Shared Data

Use `@TestSetup` to wrap all data creation in a test class. The setup runs once and its data is rolled back and recreated for each test method — sharing the performance cost across all methods in the class.

```apex
@IsTest
private class OrderServiceTest {

    @TestSetup
    static void setup() {
        insert new Account(Name = 'Test Account');
    }

    @IsTest
    static void processOrder_createsLine_whenValidInput() {
        Account acc = [SELECT Id FROM Account LIMIT 1];
        // ...
    }
}
```

### Data Factory Classes

Create Factory classes to centralise test data creation. When a validation rule or required field changes, the fix is in one place:

```apex
public class ContactFactory {
    public static Contact createContact(String firstName, String lastName) {
        return new Contact(FirstName = firstName, LastName = lastName, Country = 'UK');
    }
}
```

Factory classes MUST be postfixed `Factory` (e.g. `AccountFactory`).

### System.runAs — Use Sparingly

`System.runAs` is **not appropriate in unit tests**. If your architecture follows the dependency injection and `StubProvider` patterns defined in these standards, business logic in Service and Handler classes is fully testable without a running user context — sharing and profile behaviour are platform integration concerns, not unit test concerns.

The two cases where `System.runAs` is acceptable are:

1. **`MIXED_DML_OPERATION` resolution** — when a test must create setup objects (User, Queue) alongside transactional objects (Account, Contact). Wrap transactional DML inside `System.runAs` to satisfy the platform constraint. Note: needing this is usually a signal the test has crossed into integration territory.

2. **Explicit sharing enforcement integration tests** — when you are intentionally verifying that a `with sharing` class *does* restrict access for a lower-privileged user. This is an integration test, not a unit test, and should be labelled as such in the test class name or a comment.

```apex
// ACCEPTABLE — resolving MIXED_DML only
User usr = UserFactory.createUser('Standard User');
insert usr;
System.runAs(usr) {
    insert new Account(Name = 'Test');
}
```

If you find yourself reaching for `System.runAs` to make a unit test work, first ask whether the production class should be restructured so the sharing concern is injectable or separated from the logic being tested.

### One Test Method Per Scenario

Each method being tested MUST have its own dedicated test method. Where a method has multiple branches or scenarios, each scenario MUST have its own test method. Do not combine unrelated assertions across scenarios in a single test method — when it fails, the failure message must clearly identify which scenario broke.

```apex
// GOOD — each scenario is independently named and isolated
@IsTest static void getPrice_returnsDiscounted_whenFeatureFlagEnabled() { ... }
@IsTest static void getPrice_returnsStandard_whenFeatureFlagDisabled() { ... }
@IsTest static void getPrice_returnsZero_whenOpportunityAmountIsNull() { ... }

// BAD — multiple scenarios collapsed into one method, failure is ambiguous
@IsTest static void testGetPrice() { ... }
```

### Tests Must Prove Functionality, Not Just Hit Lines

Code coverage percentage is a by-product of good tests, not the goal. Tests that execute lines of code without asserting the output are **coverage-gaming** and will be rejected in code review.

Every test method MUST assert the specific outcome it is named for — not a generic state check. A test that passes on broken code is worse than no test at all because it creates false confidence.

```apex
// BAD — executes the method but asserts nothing meaningful
svc.setDefaultRating(accounts);
Assert.isTrue(true); // meaningless

// GOOD — asserts the exact outcome the test is named for
svc.setDefaultRating(accounts);
Assert.areEqual('Warm', accounts[0].Rating, 'Blank rating should default to Warm');
Assert.areEqual('Hot',  accounts[1].Rating, 'Pre-set rating should not be overwritten');
```

### Negative Testing and Boundary Conditions

Test classes MUST cover:

- Invalid or missing input (null values, empty collections)
- Different branch conditions (e.g. status transitions, record type variations)
- Boundary values (e.g. the last valid date, minimum/maximum counts)

### Governor Limit Checks

Use the `Limits` class in bulk tests to assert the code stays within governor constraints:

| Method                         | Description                              |
| ------------------------------ | ---------------------------------------- |
| `Limits.getDMLRows()`          | Records processed by DML in this context |
| `Limits.getLimitDMLRows()`     | Maximum DML rows allowed                 |
| `Limits.getScriptStatements()` | Apex statements executed so far          |
| `Limits.getQueries()`          | SOQL queries issued                      |
| `Limits.getLimitQueries()`     | Maximum SOQL queries allowed             |

### Coverage and Quality Requirements

| Metric               | Requirement                                                      |
| -------------------- | ---------------------------------------------------------------- |
| Minimum coverage     | 85% per class                                                    |
| Happy path           | Required                                                         |
| Negative/error paths | Required (at least one per catch block)                          |
| Bulk tests           | Required for all trigger-invoked code (200 records)              |
| Assert style         | `Assert.areEqual`, `Assert.isTrue` — NEVER `System.assertEquals` |
| Test method naming   | `methodName_scenarioDescription_expectedOutcome`                 |

### Performance and Volume Testing

The bulk test required in *Coverage and Quality Requirements* (200 records, run inside the class's own `*Test.cls`) proves correctness at the standard trigger-batch ceiling. Logic that is genuinely sensitive to volume — trigger handlers, batch/queueable Apex, services called from bulk data-load or integration contexts — additionally warrants **dedicated performance test classes** that go beyond that ceiling and assert against governor limits explicitly, not just "did it not throw."

- Performance tests live in a **separate class**, named `{Class}PerfTest`, never merged into the correctness `{Class}Test`.
- Not every class needs one — only logic that processes bulk volumes or runs in async/batch contexts. Do not manufacture a perf class for logic that doesn't warrant it.
- Minimum scenario coverage for a `{Class}PerfTest`:
  - **Max-batch bulk** — 200 records through a single trigger context, proving no per-record SOQL/DML.
  - **Multi-batch volume** — 2,000+ records via `Database.executeBatch` or repeated `Test.startTest()`/`stopTest()` cycles, proving the logic scales past one trigger context.
  - **Governor-limit boundary** — explicit `Limits.getQueries()`, `Limits.getDmlStatements()`, `Limits.getCpuTime()` assertions against the platform ceiling for the scenario, not merely an absence of exceptions.
  - **Mixed valid/invalid records in one bulk operation** — proves partial-failure handling doesn't silently drop or double-process rows.
- `@TestSetup` builds the bulk dataset once per class, not per method — building a 2,000-record dataset per test method makes the suite unusably slow.
- Record actual limit consumption (queries, DML, CPU time) against the platform ceiling for each scenario in the story's `apex-perf-plan.md`; flag any result above 80% of a governor ceiling explicitly, even when the test still passes.

### Testing Rules

- Test class names MUST end in `Test`.
- NEVER use `try/catch` inside a test to swallow exceptions — let them surface.
- All test methods MUST have at least one `Assert` statement.
- Use `Test.startTest()` / `Test.stopTest()` when testing async behaviour (batch, scheduled, future) or to get a clean governor limit measurement. Do not use it otherwise.
- NEVER call `vlocity_cmt.IntegrationProcedureService` directly — always go through the adapter interface.
- Test data MUST NOT depend on pre-existing org data — always create it within the test or via `@TestSetup`.
