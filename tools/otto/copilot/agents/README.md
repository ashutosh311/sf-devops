# Copilot agents — source of truth

These `*.agent.md` files are the **canonical GitHub Copilot custom-agent profiles** for
Slalom Otto. They are the Copilot equivalent of the Claude Code plugin's `plugin/commands/*.md`
and of the VS Code chat participant — a thin wrapper that hands control to the `otto`
MCP server (`otto_prompt` / `otto_init`).

Copilot CLI and the Copilot desktop app discover custom agents from:

- `.github/agents/*.agent.md` — repository level (this repo, for developing the tool)
- `~/.copilot/agents/*.agent.md` — user level (the zip pack, across all their projects)
- an installed **marketplace plugin** — the `otto` plugin served from the `copilot-dist`
  branch (`copilot plugin install otto@slalom`); its agents are namespaced
  `otto:<file>` (e.g. `otto:about`). The plugin's copy of these files is generated
  by `scripts/package-copilot.mjs` with `${OTTO_SERVER}` pointed at `${PLUGIN_ROOT}/server/server.js`.

## The `${OTTO_SERVER}` placeholder and the surface arg

Each profile embeds its own MCP server via the `mcp-servers` frontmatter block so the agent is
fully portable. The `args` entry carries a placeholder plus a `--surface=copilot` flag:

```yaml
mcp-servers:
  otto:
    type: local
    command: node
    args: ["${OTTO_SERVER}", "--surface=copilot"]
    tools: ["*"]
```

`--surface=copilot` tells the server which host it's running under, so its prose reads
"GitHub Copilot" (not "Claude Code"). It is passed as a **CLI argument rather than an
environment variable on purpose**: Copilot CLI does not forward the `env` block of a local MCP
server to the spawned process (verified), but it does pass `args`. The server reads the surface
from `--surface=<name>` first, falling back to `OTTO_SURFACE` (or legacy `SLALOM_SDLC_SURFACE`) for the Claude plugin, which
does forward env. See `packages/mcp/src/surface.ts`.

`${OTTO_SERVER}` is substituted at generation time with the correct path for the target:

| Target | Substituted path | Produced by |
|---|---|---|
| Repo `.github/agents/` | `tools/otto/packages/mcp/dist/server.js` (repo-relative) | `scripts/generate-copilot-agents.mjs` |
| Release pack | `<install-dir>/otto/server.js` (absolute, resolved by `install.sh`) | `scripts/package-copilot.mjs` + `install.sh` |
| Marketplace plugin | `${PLUGIN_ROOT}/server/server.js` (resolved by Copilot at install) | `scripts/package-copilot.mjs` |

## Regenerating the committed repo agents

```bash
node tools/otto/scripts/generate-copilot-agents.mjs
```

This rewrites `.github/agents/*.agent.md` at the repo root from these templates. CI verifies the
committed output matches the templates, the same way the Claude plugin's command count is verified.
Never hand-edit `.github/agents/` — edit the templates here and regenerate.
