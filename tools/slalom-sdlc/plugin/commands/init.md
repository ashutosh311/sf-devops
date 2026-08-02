---
description: Set up or reconfigure the Slalom SDLC for this Salesforce project
allowed-tools: ["mcp__plugin_slalom-sdlc_slalom-sdlc__sdlc_prompt", "mcp__plugin_slalom-sdlc_slalom-sdlc__sdlc_scaffold"]
---

Call `sdlc_prompt` on the `slalom-sdlc` MCP server with `command: "init"`.

Follow the returned setup interview verbatim, then call `sdlc_scaffold` with the answers you collected. Do not write `.sdlc/config.json` yourself — `sdlc_scaffold` owns that file and the rest of the scaffold.
