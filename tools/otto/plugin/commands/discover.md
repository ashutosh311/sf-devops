---
description: Discovery agent — map requirements, identify unknowns, draft epics and stories
# No allowed-tools restriction: the returned instructions call out to whatever
# ALM/Salesforce MCP server the host has configured (Atlassian, ADO, Salesforce
# DX) plus Read/Write/Bash — an explicit allowlist here would silently strip
# that access. Mirrors the Copilot pack's tools: ["*"] for this same agent.
---

Call `otto_prompt` on the `otto` MCP server with `command: "discover"`.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `Otto config` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
