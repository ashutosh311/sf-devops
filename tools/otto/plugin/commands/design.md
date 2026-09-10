---
description: Technical design agent — solution approach, data model, sub-tasks
argument-hint: [TICKET-OR-EPIC-KEY]
# No allowed-tools restriction: the returned instructions call out to whatever
# ALM/Salesforce MCP server the host has configured (Atlassian, ADO, Salesforce
# DX) plus Read/Write/Bash — an explicit allowlist here would silently strip
# that access. Mirrors the Copilot pack's tools: ["*"] for this same agent.
---

Call `otto_prompt` on the `otto` MCP server with `command: "design"` and `storyKey: "$1"`. The argument may be a story key, or an **epic key or sprint** to design every eligible child story and publish an epic-level synthesis design.

If no ticket key was supplied, omit `storyKey` and ask the user which ticket, epic, or sprint to work on before continuing.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `Otto config` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
