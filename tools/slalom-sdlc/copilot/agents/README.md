# Copilot agents — source of truth

These `*.agent.md` files are the **canonical GitHub Copilot custom-agent profiles** for the
Slalom SDLC. They are the Copilot equivalent of the Claude Code plugin's `plugin/commands/*.md`
and of the VS Code chat participant — a thin wrapper that hands control to the `slalom-sdlc`
MCP server (`sdlc_prompt` / `sdlc_init`).

Copilot CLI and the Copilot desktop app discover custom agents from:

- `.github/agents/*.agent.md` — repository level (this repo, for developing the tool)
- `~/.copilot/agents/*.agent.md` — user level (consultants, across all their projects)

## The `${SLALOM_SDLC_SERVER}` placeholder and the surface arg

Each profile embeds its own MCP server via the `mcp-servers` frontmatter block so the agent is
fully portable. The `args` entry carries a placeholder plus a `--surface=copilot` flag:

```yaml
mcp-servers:
  slalom-sdlc:
    type: local
    command: node
    args: ["${SLALOM_SDLC_SERVER}", "--surface=copilot"]
    tools: ["*"]
```

`--surface=copilot` tells the server which host it's running under, so its prose reads
"GitHub Copilot" (not "Claude Code"). It is passed as a **CLI argument rather than an
environment variable on purpose**: Copilot CLI does not forward the `env` block of a local MCP
server to the spawned process (verified), but it does pass `args`. The server reads the surface
from `--surface=<name>` first, falling back to `SLALOM_SDLC_SURFACE` for the Claude plugin, which
does forward env. See `packages/mcp/src/surface.ts`.

`${SLALOM_SDLC_SERVER}` is substituted at generation time with the correct path for the target:

| Target | Substituted path | Produced by |
|---|---|---|
| Repo `.github/agents/` | `tools/slalom-sdlc/packages/mcp/dist/server.js` (repo-relative) | `scripts/generate-copilot-agents.mjs` |
| Release pack | `<install-dir>/slalom-sdlc/server.js` (absolute, resolved by `install.sh`) | `scripts/package-copilot.mjs` + `install.sh` |

## Regenerating the committed repo agents

```bash
node tools/slalom-sdlc/scripts/generate-copilot-agents.mjs
```

This rewrites `.github/agents/*.agent.md` at the repo root from these templates. CI verifies the
committed output matches the templates, the same way the Claude plugin's command count is verified.
Never hand-edit `.github/agents/` — edit the templates here and regenerate.
