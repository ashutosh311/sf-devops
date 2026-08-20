---
description: Refinement agent — acceptance criteria, open questions, effort estimate
argument-hint: [TICKET-KEY]
allowed-tools: ["mcp__plugin_otto_otto__otto_prompt"]
---

Call `otto_prompt` on the `otto` MCP server with `command: "refine"` and `storyKey: "$1"`.

If no ticket key was supplied, omit `storyKey` and ask the user which ticket to work on before continuing.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `Otto config` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
