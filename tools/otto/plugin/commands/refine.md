---
description: Refinement agent — acceptance criteria, open questions, effort estimate
argument-hint: [TICKET-KEY]
# No allowed-tools restriction: the returned instructions call out to whatever
# ALM/Salesforce MCP server the host has configured (Atlassian, ADO, Salesforce
# DX) plus Read/Write/Bash — an explicit allowlist here would silently strip
# that access. Mirrors the Copilot pack's tools: ["*"] for this same agent.
---

Call `otto_prompt` on the `otto` MCP server with `command: "refine"` and `storyKey: "$1"`.

`$1` may be a **story key** (refine that one story), an **epic key** (refine every unrefined story under the epic), or a **sprint** (refine every unrefined story in the sprint). If no key was supplied, omit `storyKey` and ask the user which story, epic, or sprint to work on before continuing.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `Otto config` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
