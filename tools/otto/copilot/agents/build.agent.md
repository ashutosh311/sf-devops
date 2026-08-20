---
name: otto-build
description: Build agent — scaffold Apex/LWC/config, review, deploy to sandbox
target: github-copilot
tools: ["otto/*", "read", "edit", "search", "execute"]
mcp-servers:
  otto:
    type: local
    command: node
    args: ["${OTTO_SERVER}", "--surface=copilot"]
    tools: ["*"]
---

Call `otto_prompt` on the `otto` MCP server with `command: "build"` and `storyKey` set to the ticket key the user supplied (e.g. `PROJ-42`).

If no ticket key was supplied, omit `storyKey` and ask the user which ticket to work on before continuing.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `.sdlc/config.json` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
