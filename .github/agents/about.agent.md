---
name: otto-about
description: What Slalom Otto is, how to use it, and every available command
target: github-copilot
tools: ["otto/*", "read"]
mcp-servers:
  otto:
    type: local
    command: node
    args: ["tools/otto/packages/mcp/dist/server.js", "--surface=copilot"]
    tools: ["*"]
---
<!-- GENERATED FILE — do not edit. Source: tools/otto/copilot/agents/. Regenerate: node tools/otto/scripts/generate-copilot-agents.mjs -->
Call `otto_prompt` on the `otto` MCP server with `command: "about"`, then present the returned overview to the user as-is.
