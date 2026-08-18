# Slalom SDLC for GitHub Copilot

This pack adds the Slalom SDLC commands to **GitHub Copilot CLI** and the
**Copilot desktop app** as custom agents, the same way the VSIX adds them to
VS Code and the plugin adds them to Claude Code.

> **Prefer the marketplace plugin.** The easiest install is the native marketplace
> route — no zip, and it self-updates:
>
> ```bash
> copilot plugin marketplace add Slalom/salesforce-devops#copilot-dist
> copilot plugin install slalom-sdlc@slalom
> ```
>
> Its agents are namespaced (`slalom-sdlc:about`, `slalom-sdlc:init`, …) and it
> updates with `copilot plugin update slalom-sdlc`. This zip pack below is the
> **manual / air-gapped** alternative; it installs un-namespaced agents
> (`slalom-about`, …) at the user level.

## Install

```bash
./install.sh
```

This installs at the **user level** (`~/.copilot/`), so the agents are available
in every project you open — no per-project setup. To install into a different
Copilot home:

```bash
COPILOT_HOME=/path/to/.copilot ./install.sh
```

`node` must be on your `PATH` (it runs the bundled MCP server).

## Use

Open Copilot in any project and invoke an agent:

```
copilot
/agent slalom-about
```

Available agents:

| Agent | Phase |
|-------|-------|
| `slalom-about`    | What the SDLC is and how to use it |
| `slalom-init`     | Scaffold the SDLC into a project |
| `slalom-discover` | DISCOVER — engagement, backlog |
| `slalom-refine`   | Sprint -1 — acceptance criteria |
| `slalom-design`   | Sprint -1 — solution design |
| `slalom-build`    | Sprint — implementation |
| `slalom-test`     | Sprint +1 — testing |
| `slalom-release`  | TRANSITION — release |

## What the installer does

1. Copies the bundled MCP server to `~/.copilot/slalom-sdlc/server.js`.
2. Installs the agent profiles into `~/.copilot/agents/slalom-*.agent.md`.
3. Registers the `slalom-sdlc` MCP server in `~/.copilot/mcp-config.json`
   (with `--surface=copilot`).

All steps are idempotent — re-running upgrades in place.

## Uninstall

```bash
rm ~/.copilot/agents/slalom-*.agent.md
rm -rf ~/.copilot/slalom-sdlc
# then remove the "slalom-sdlc" entry from ~/.copilot/mcp-config.json
```
