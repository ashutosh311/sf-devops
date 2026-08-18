---
name: slalom-release
description: Release agent — deployment notes, go-live checklist, ticket transitions
target: github-copilot
tools: ["slalom-sdlc/*", "read", "edit", "search", "execute"]
mcp-servers:
  slalom-sdlc:
    type: local
    command: node
    args: ["tools/slalom-sdlc/packages/mcp/dist/server.js", "--surface=copilot"]
    tools: ["*"]
---
<!-- GENERATED FILE — do not edit. Source: tools/slalom-sdlc/copilot/agents/. Regenerate: node tools/slalom-sdlc/scripts/generate-copilot-agents.mjs -->
Call `sdlc_prompt` on the `slalom-sdlc` MCP server with `command: "release"`.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `.sdlc/config.json` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
