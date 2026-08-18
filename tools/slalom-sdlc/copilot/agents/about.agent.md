---
name: slalom-about
description: What the Slalom SDLC is, how to use it, and every available command
target: github-copilot
tools: ["slalom-sdlc/*", "read"]
mcp-servers:
  slalom-sdlc:
    type: local
    command: node
    args: ["${SLALOM_SDLC_SERVER}", "--surface=copilot"]
    tools: ["*"]
---

Call `sdlc_prompt` on the `slalom-sdlc` MCP server with `command: "about"`, then present the returned overview to the user as-is.
