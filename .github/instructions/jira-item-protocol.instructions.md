---
applyTo: "none"
---

# JIRA Item Creation Protocol

> Shared protocol referenced by `create-jira-item.prompt.md` and any other prompt that needs to create a JIRA work item. Include this file via `#file:.github/instructions/jira-item-protocol.instructions.md` in the calling prompt.

---

## Non-Negotiable Formatting Rule

**Always use `contentFormat: adf`** when creating or updating any JIRA item description. Never pass a plain string with `\n` characters — the JIRA API renders these literally instead of as line breaks.

Every description must be built as an ADF JSON object (`{ "version": 1, "type": "doc", "content": [...] }`). The templates below for each item type show the correct structure. Apply the same rule to any description not covered by a template: use `heading`, `paragraph`, `bulletList`, `orderedList`, or `table` nodes as appropriate — never raw newlines.

---

## Step 1 — Identify the JIRA project

If the JIRA project key is not already known:
- Ask: "Which JIRA project should this be created in? (e.g. `KAN`)"
- Use `getVisibleJiraProjects` to validate the key and confirm the project name.

---

## Step 2 — Identify the work item type

If not already known, ask:
> "What type of work item? Choose one: **feature**, **story**, **bug**, or **task**"

---

## Work Item Type: Feature (Epic)

### Collect these fields one at a time:
1. Title — short, outcome-focused
2. Business Objective — what problem does this solve?
3. Target Users / Personas
4. Success Metrics — KPIs or observable outcomes
5. Scope — what is in scope? what is explicitly out of scope?
6. Priority — Critical / High / Medium / Low
7. Target Quarter / Milestone — or "not set"
8. Parent Initiative — JIRA key or "none"

### Create with:
- Issue type: `Epic`
- Labels: `feature`
- contentFormat: `adf`
- Description built as ADF JSON:

```json
{
  "version": 1, "type": "doc",
  "content": [
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Business Objective"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "{business_objective}"}]},
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Target Users / Personas"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "{target_users}"}]},
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Success Metrics"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "{success_metrics}"}]},
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Scope"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "In Scope:", "marks": [{"type": "strong"}]}]},
    {"type": "bulletList", "content": [{"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "{in_scope_item}"}]}]}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "Out of Scope:", "marks": [{"type": "strong"}]}]},
    {"type": "bulletList", "content": [{"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "{out_of_scope_item}"}]}]}]},
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Target Milestone"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "{target_quarter}"}]}
  ]
}
```

### Variant: Sprint Epic (created by `#otto/discover`)

When creating an Epic that represents a **sprint container** (produced by the Discovery agent from a Sprint Allocation Plan), use this ADF structure instead:

```json
{
  "version": 1, "type": "doc",
  "content": [
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Sprint Goal"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "{sprint_goal}"}]},
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Sprint Dates"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "{sprint_dates}"}]},
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Exit Criteria"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "{exit_criteria}"}]},
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Stories"}]},
    {
      "type": "table",
      "attrs": {"isNumberColumnEnabled": false, "layout": "default"},
      "content": [
        {
          "type": "tableRow",
          "content": [
            {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Story"}]}]},
            {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Title"}]}]}
          ]
        }
        // one tableRow per story — repeat the pattern above for each
      ]
    }
  ]
}
```

---

## Work Item Type: Story (User Story)

### INVEST Principles — validate before creating:
- **I**ndependent — deliverable without depending on another story being done first
- **N**egotiable — scope can be refined; not a fixed contract
- **V**aluable — delivers clear, observable value to the user or business
- **E**stimable — scoped clearly enough for the team to size it
- **S**mall — completable within a single sprint
- **T**estable — has unambiguous Gherkin acceptance criteria

If a draft story violates any criterion, flag it and propose a rewrite before proceeding.

### Collect these fields one at a time:
1. Title — short, verb-first
2. User Role — e.g. "Sales Rep", "System Admin"
3. Goal — what the user wants to accomplish
4. Benefit — the business value ("so that...")
5. Acceptance Criteria — in Gherkin format: `Given [context], When [action], Then [outcome]`. Collect one scenario at a time until the user types "done".
6. Parent Feature / Epic — JIRA key or "none"
7. Dependencies — JIRA keys or "none"
8. Story Points — 1, 2, 3, 5, 8, 13, or "unestimated"
9. Priority — Critical / High / Medium / Low
10. Labels / Components — comma-separated or "none"

### Create with:
- Issue type: `Story`
- contentFormat: `adf`
- Description built as ADF JSON — each AC scenario is a separate `listItem`, each Gherkin keyword (**Given**/**When**/**Then**) is bold:

```json
{
  "version": 1, "type": "doc",
  "content": [
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "User Story"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "As a {user_role}, I want {goal}, so that {benefit}."}]},
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Acceptance Criteria"}]},
    {"type": "bulletList", "content": [
      {"type": "listItem", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Given ", "marks": [{"type": "strong"}]}, {"type": "text", "text": "{context}"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "When ", "marks": [{"type": "strong"}]}, {"type": "text", "text": "{action}"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "Then ", "marks": [{"type": "strong"}]}, {"type": "text", "text": "{outcome}"}]}
      ]}
    ]},
    {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Dependencies"}]},
    {"type": "paragraph", "content": [{"type": "text", "text": "{dependencies}"}]}
  ]
}
```

---

## Work Item Type: Bug

### Collect these fields one at a time:
1. Title — one-line description of the defect
2. Environment — Production / UAT / Sandbox / Dev (include org name if known)
3. Steps to Reproduce — step by step
4. Expected Behavior
5. Actual Behavior
6. Severity — Critical / High / Medium / Low
7. Priority — Critical / High / Medium / Low
8. Affected Feature / Story — JIRA key or "none"
9. Additional Context — error messages, screenshots, or "none"

### Create with:
- Issue type: `Bug`
- Labels: `bug`
- contentFormat: `adf`
- Steps to Reproduce rendered as an `orderedList`

---

## Work Item Type: Task

### Collect these fields one at a time:
1. Title — action-oriented
2. Description — what needs to be done and why
3. Done Criteria — observable outcomes that mark this complete
4. Parent Story / Feature — JIRA key or "none"
5. Assignee — JIRA account name/email or "unassigned" (resolve via `lookupJiraAccountId`)
6. Time Estimate — e.g. "2h", "0.5 days", or "unknown"
7. Priority — Critical / High / Medium / Low

### Create with:
- Issue type: `Task`
- contentFormat: `adf`
- Done Criteria rendered as a `bulletList`

---

## Step 3 — Confirm before creating

Display a preview:
```
--- JIRA Item Preview ---
Project:   {PROJECT_KEY}
Type:      {type}
Title:     {title}
Priority:  {priority}
[other key fields]
```

Ask: "Does this look correct? Type **yes** to create, or tell me what to change."

Do **not** call any JIRA API until the user confirms.

---

## Step 4 — Create the issue

Call `createJiraIssue`. If a parent was provided, set the `parent` field or call `createIssueLink` after creation.

---

## Step 5 — Return the result

```
Created: {ISSUE-KEY} — {title}
Type:    {type}
Project: {project_name} ({PROJECT_KEY})
URL:     {issue_url}
```