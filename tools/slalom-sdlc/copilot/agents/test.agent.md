---
name: slalom-test
description: Test agent — Apex and JEST test classes, coverage validation
target: github-copilot
tools: ["slalom-sdlc/*", "read", "edit", "search", "execute"]
mcp-servers:
  slalom-sdlc:
    type: local
    command: node
    args: ["${SLALOM_SDLC_SERVER}", "--surface=copilot"]
    tools: ["*"]
---

Call `sdlc_prompt` on the `slalom-sdlc` MCP server with `command: "test"` and `storyKey` set to the ticket key the user supplied (e.g. `PROJ-42`).

If no ticket key was supplied, omit `storyKey` and ask the user which ticket to work on before continuing.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `.sdlc/config.json` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
