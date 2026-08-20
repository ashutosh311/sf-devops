---
name: otto-init
description: Set up or reconfigure Slalom Otto for this Salesforce project
target: github-copilot
tools: ["otto/*", "read", "edit", "execute"]
mcp-servers:
  otto:
    type: local
    command: node
    args: ["tools/otto/packages/mcp/dist/server.js", "--surface=copilot"]
    tools: ["*"]
---
<!-- GENERATED FILE — do not edit. Source: tools/otto/copilot/agents/. Regenerate: node tools/otto/scripts/generate-copilot-agents.mjs -->
Call `otto_init` on the `otto` MCP server, with no arguments.

It runs the setup interview itself and writes `.sdlc/config.json` plus the rest of the scaffold. Do not ask the setup questions yourself first, and do not write any config file by hand — report what the tool returns.

If it hands back an interview for you to conduct rather than a result, the client doesn't support input forms: work through that interview conversationally, then call `otto_scaffold` with the answers.
