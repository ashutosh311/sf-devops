---
description: Test agent — Apex and JEST test classes, coverage validation
argument-hint: [TICKET-KEY]
allowed-tools: ["mcp__plugin_slalom-sdlc_slalom-sdlc__sdlc_prompt"]
---

Call `sdlc_prompt` on the `slalom-sdlc` MCP server with `command: "test"` and `storyKey: "$1"`.

If no ticket key was supplied, omit `storyKey` and ask the user which ticket to work on before continuing.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `.sdlc/config.json` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
