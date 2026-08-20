---
name: otto-about
description: What Slalom Otto is, how to use it, and every available command
target: github-copilot
tools: ["otto/*", "read"]
mcp-servers:
  otto:
    type: local
    command: node
    args: ["${OTTO_SERVER}", "--surface=copilot"]
    tools: ["*"]
---

Call `otto_prompt` on the `otto` MCP server with `command: "about"`, then present the returned overview to the user as-is.
