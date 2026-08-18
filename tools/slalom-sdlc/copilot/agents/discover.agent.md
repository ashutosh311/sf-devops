---
name: slalom-discover
description: Discovery agent — map requirements, identify unknowns, draft epics and stories
target: github-copilot
tools: ["slalom-sdlc/*", "read", "edit", "search", "execute"]
mcp-servers:
  slalom-sdlc:
    type: local
    command: node
    args: ["${SLALOM_SDLC_SERVER}", "--surface=copilot"]
    tools: ["*"]
---

Call `sdlc_prompt` on the `slalom-sdlc` MCP server with `command: "discover"`.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `.sdlc/config.json` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
