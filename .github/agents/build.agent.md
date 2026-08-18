---
name: slalom-build
description: Build agent — scaffold Apex/LWC/config, review, deploy to sandbox
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
Call `sdlc_prompt` on the `slalom-sdlc` MCP server with `command: "build"` and `storyKey` set to the ticket key the user supplied (e.g. `PROJ-42`).

If no ticket key was supplied, omit `storyKey` and ask the user which ticket to work on before continuing.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `.sdlc/config.json` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
