---
name: otto-discover
description: Discovery agent — map requirements, identify unknowns, draft epics and stories
target: github-copilot
tools: ["otto/*", "read", "edit", "search", "execute"]
mcp-servers:
  otto:
    type: local
    command: node
    args: ["${OTTO_SERVER}", "--surface=copilot"]
    tools: ["*"]
---

Call `otto_prompt` on the `otto` MCP server with `command: "discover"`.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `.sdlc/config.json` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
