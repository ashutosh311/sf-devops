---
name: otto-discover
description: Discovery agent — map requirements, identify unknowns, draft epics and stories
target: github-copilot
tools: ["otto/*", "read", "edit", "search", "execute"]
mcp-servers:
  otto:
    type: local
    command: node
    args: ["tools/otto/packages/mcp/dist/server.js", "--surface=copilot"]
    tools: ["*"]
---
<!-- GENERATED FILE — do not edit. Source: tools/otto/copilot/agents/. Regenerate: node tools/otto/scripts/generate-copilot-agents.mjs -->
Call `otto_prompt` on the `otto` MCP server with `command: "discover"`.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `.sdlc/config.json` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
