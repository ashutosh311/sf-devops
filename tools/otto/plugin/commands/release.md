---
description: Release agent — deploy a release (UAT, sign-off, production, release notes)
argument-hint: "[skill] [TICKET-KEY]"
# No allowed-tools restriction: the returned instructions call out to whatever
# ALM/Salesforce MCP server the host has configured (Atlassian, ADO, Salesforce
# DX) plus Read/Write/Bash — an explicit allowlist here would silently strip
# that access. Mirrors the Copilot pack's tools: ["*"] for this same agent.
---

Parse the input for an optional **skill** and optional **story key(s)** — either may appear in either position, and both may be omitted.

Valid skills: `deploy` (bundle completed stories, deploy to UAT, sign-off, production deploy, release notes).

Call `otto_prompt` on the `otto` MCP server with `command: "release"`, plus:
- `skill` — the skill if one was given
- `storyKey` — the story key(s) if given

If story keys were given but no skill, pass `skill: "deploy"` — this preserves the command's original behaviour.

If neither was given, call `otto_prompt` with `command: "release"` alone and present the menu it returns; ask the user to pick before continuing. Once they pick, **call `otto_prompt` again** with `command: "release"` and `skill` set to their choice — the menu is a routing index and does not contain any skill's procedure. Never run a skill from its one-line menu description.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `Otto config` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
