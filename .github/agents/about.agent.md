---
name: slalom-about
description: What the Slalom SDLC is, how to use it, and every available command
target: github-copilot
tools: ["slalom-sdlc/*", "read"]
mcp-servers:
  slalom-sdlc:
    type: local
    command: node
    args: ["tools/slalom-sdlc/packages/mcp/dist/server.js", "--surface=copilot"]
    tools: ["*"]
---
<!-- GENERATED FILE — do not edit. Source: tools/slalom-sdlc/copilot/agents/. Regenerate: node tools/slalom-sdlc/scripts/generate-copilot-agents.mjs -->
Call `sdlc_prompt` on the `slalom-sdlc` MCP server with `command: "about"`, then present the returned overview to the user as-is.
