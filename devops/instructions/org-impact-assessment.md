---
title: Salesforce Org Impact Assessment
description: Standard procedure for validating a proposed solution design against a live Salesforce org. Referenced by design and release agents to surface conflicts, risks, and deployment blockers before any metadata is built or deployed.
scope: design, deployment, brownfield
enforce: always
---

# Salesforce Org Impact Assessment

Agents MUST follow this procedure when a live Salesforce org is available and a solution design or set of metadata changes is being proposed. The goal is to surface conflicts, risks, and deployment blockers **before** any code is written or deployed — not during build or at deployment time.

Default target is the **sandbox org**. Production must never be queried for impact assessment unless the user explicitly requests it and confirms.

---

## 1. Connect to the Target Org

### 1a — Identify the org to assess against

Check the current default org:

```bash
sf config get target-org
```

If a default org is set, display the alias and instance URL and ask:

> "I'll run the impact assessment against **{alias}** ({instance URL}). Is this the right org, or would you like to use a different sandbox?"

If no default org is set, ask the user:

> "Which sandbox org should I assess against? Please provide the alias. If you need to authenticate first, I can help with that."

Follow **`deployment.md` §2–4** to authenticate and set the target org if needed.

### 1b — Confirm this is not production

If the instance URL contains `my.salesforce.com` and is not a sandbox (i.e. no `.sandbox.` in the URL or no sandbox suffix), warn the user:

> "⚠️ The connected org appears to be a **production** org. Impact assessment should run against a sandbox that mirrors production. Are you sure you want to continue against production?"

Do not proceed without explicit confirmation.

---

## 2. Discover Relevant Org Metadata

Use the Salesforce MCP to inspect the live org. Scope the discovery to metadata directly relevant to the proposed changes. Do not attempt a full org scan.

### 2a — Objects and fields in scope

For each custom object or standard object referenced in the proposed design:

- List all existing custom fields — note type, required flag, formula dependencies
- Identify fields the solution proposes to add or modify — check for name collisions
- Check record types — confirm any referenced record types exist
- Review picklist values on fields the solution will use or extend

### 2b — Automation on affected objects

For each object in scope, retrieve all active automation:

| Type | What to check |
|---|---|
| Apex Triggers | Which triggers exist, what contexts (before/after insert/update/delete), and whether a TriggerHandler pattern is already in use |
| Record-Triggered Flows | Active flows, their trigger conditions, and whether they run before or after save |
| Validation Rules | Active rules — identify any that may fire on the fields the solution touches |
| Workflow Rules / Process Builder | Flag any that are still active (these are deprecated but may still be live in brownfield orgs) |

Flag any **automation conflicts** — situations where a proposed trigger or flow would fire on the same record event as existing automation, creating order-of-execution risk.

### 2c — Existing Apex classes and tests

For each Apex class or trigger the solution proposes to create or modify:

- Check whether a class with that name already exists
- If it exists, read its current implementation — understand what it does before proposing changes
- Identify existing test classes that cover the same objects or logic — the solution must not reduce their coverage or break their assertions

Report the current org-wide Apex test coverage if retrievable.

### 2d — Integration points

For each object or field the solution touches:

- Check for active outbound integrations (platform events, change data capture, outbound messages, named credentials in use)
- Check for inbound integrations that insert or update records on these objects — a new required field or validation rule could break an existing API integration
- Note any connected apps or OAuth consumers that may be affected by permission set changes

### 2e — Permission sets and sharing

- List existing permission sets that grant access to the objects in scope
- Identify whether the proposed permission set changes overlap with or conflict with existing grants
- Check the object's OWD and sharing rules — confirm the proposed solution does not inadvertently open or restrict access

### 2f — Installed packages

Check for managed or unlocked packages that own or extend the objects and fields in scope:

```bash
sf package installed list --target-org {TARGET_ALIAS}
```

If a managed package owns a field or object the solution intends to modify, flag this as a **blocking risk** — managed package components cannot be overridden.

---

## 3. Impact Assessment Report

Once discovery is complete, produce an impact assessment before any further design decisions are made. Structure it as follows:

```markdown
## Org Impact Assessment — {STORY-KEY}

**Org assessed**: {alias} ({instance URL})
**Assessed on**: {date}

### Objects in scope
{list}

### Findings

#### 🔴 Blocking risks
{Issues that must be resolved before build can proceed — e.g. name collision, managed package conflict, required field breaking existing integration}

#### 🟡 Warnings
{Issues that need careful handling but are not blockers — e.g. existing automation on the same object, coverage risk, deprecated automation still active}

#### 🟢 Clear
{Areas checked with no issues found}

### Recommended design adjustments
{Specific changes to the proposed solution design based on findings — e.g. rename a field to avoid collision, add a bypass check to account for existing flow, extend an existing permission set rather than creating a new one}
```

Present the report to the user and confirm agreement on the recommended adjustments before the solution design is finalised.

---

## 4. Validate Proposed Design Against Findings

After the impact assessment report is accepted, cross-reference the solution design against each finding:

- Every **blocking risk** must have a resolution documented in the solution design before proceeding
- Every **warning** must have an explicit handling note in the solution design (even if the decision is "accepted risk — monitor post-deployment")
- The deployment sequence in the solution design must account for the order-of-execution risks identified

If new blocking risks are identified during this cross-reference that were not in the original assessment, update the report and re-present to the user.

Only once all blocking risks are resolved and warnings are acknowledged should the solution design be marked as final.
