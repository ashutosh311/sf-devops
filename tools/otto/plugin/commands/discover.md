---
description: Discovery agent — map requirements, identify unknowns, draft epics and stories
argument-hint: "[skill]"
# No allowed-tools restriction: several skills (synthesize, analyze, hub-audit,
# etc.) read discovery artifact files under paths.artifacts via Read/Glob, and
# push-backlog/sync-pm call out to whatever ALM MCP the host has configured
# (Atlassian, ADO) — an explicit allowlist here would silently strip that access.
# Mirrors the Copilot pack's tools: ["*"] for this same agent.
---

Parse `$1` for an optional **skill** — one of: `synthesize`, `analyze`, `conflict-check`, `compose-deliverable`, `prep-workshop`, `hub-audit`, `whats-next`, `registers-to-stories`.

Call `otto_prompt` on the `otto` MCP server with `command: "discover"`, plus `skill` if one was given.

If no skill was given, present the menu the returned instructions describe and ask the user to pick before continuing. Once they pick, **call `otto_prompt` again** with `command: "discover"` and `skill` set to their choice — the menu is a routing index and does not contain any skill's procedure.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `Otto config` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
