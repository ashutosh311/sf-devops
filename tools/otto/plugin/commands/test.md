---
description: Test agent — execute AC, author test cases, Apex unit/perf tests, Playwright E2E
argument-hint: "[skill] [TICKET-KEY]"
# No allowed-tools restriction: the returned instructions call out to whatever
# ALM/Salesforce MCP server the host has configured (Atlassian, ADO, Salesforce
# DX) plus Read/Write/Bash — an explicit allowlist here would silently strip
# that access. Mirrors the Copilot pack's tools: ["*"] for this same agent.
---

Parse `$1` and `$2` for an optional **skill** and an optional **ticket key** — either may appear in either position, and both may be omitted.

Valid skills: `execute`, `write-cases`, `apex-unit`, `apex-perf`, `pw-setup`, `pw-write`.

Call `otto_prompt` on the `otto` MCP server with `command: "test"`, plus:
- `skill` — the skill if one was given
- `storyKey` — the ticket key if one was given

If a ticket key was given but no skill, pass `skill: "execute"` — this preserves the command's original ticket-only behaviour.

If neither was given, call `otto_prompt` with `command: "test"` alone and present the menu it returns; ask the user to pick before continuing. Once they pick, **call `otto_prompt` again** with `command: "test"` and `skill` set to their choice — the menu is a routing index and does not contain any skill's procedure. Never run a skill from its one-line menu description.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `Otto config` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
