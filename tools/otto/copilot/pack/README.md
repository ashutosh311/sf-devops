# Slalom Otto for GitHub Copilot

This pack adds the Slalom Otto commands to **GitHub Copilot CLI** and the
**Copilot desktop app** as custom agents, the same way the VSIX adds them to
VS Code and the plugin adds them to Claude Code.

> **Prefer the marketplace plugin.** The easiest install is the native marketplace
> route — no zip, and it self-updates:
>
> ```bash
> copilot plugin marketplace add Slalom/salesforce-devops
> copilot plugin install otto@slalom
> ```
>
> Its agents are namespaced (`otto:about`, `otto:init`, …) and it
> updates with `copilot plugin update otto`. This zip pack below is the
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
/agent otto-about
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

1. Copies the bundled MCP server to `~/.copilot/otto/server.js`.
2. Installs the agent profiles into `~/.copilot/agents/*.agent.md` (named `otto-*`).
3. Registers the `otto` MCP server in `~/.copilot/mcp-config.json`
   (with `--surface=copilot`).

All steps are idempotent — re-running upgrades in place.

## Uninstall

```bash
rm ~/.copilot/agents/{about,init,discover,refine,design,build,test,release}.agent.md
rm -rf ~/.copilot/otto
# then remove the "otto" entry from ~/.copilot/mcp-config.json
```
