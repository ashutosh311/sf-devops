---
description: Set up or reconfigure the Slalom SDLC for this Salesforce project
allowed-tools: ["mcp__plugin_slalom-sdlc_slalom-sdlc__sdlc_init", "mcp__plugin_slalom-sdlc_slalom-sdlc__sdlc_scaffold"]
---

Call `sdlc_init` on the `slalom-sdlc` MCP server, with no arguments.

It runs the setup interview itself and writes `.sdlc/config.json` plus the rest of the scaffold. Do not ask the setup questions yourself first, and do not write any config file by hand — report what the tool returns.

If it hands back an interview for you to conduct rather than a result, the client doesn't support input forms: work through that interview conversationally, then call `sdlc_scaffold` with the answers.
