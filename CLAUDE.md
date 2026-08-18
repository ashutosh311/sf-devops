# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Two distinct things live side by side here:

1. **A Salesforce consulting delivery repo** (Slalom UK&I) — `force-app/` (SFDX metadata), `devops/standards/` (prescriptive coding standards), `artifacts/` (generated SDLC deliverables), `manifests/`, `config/`, `pipeline-scripts/` (Bitbucket CI). This is the shape a client project takes after running the SDLC tooling below.
2. **`tools/slalom-sdlc/`** — the actual software product: a pnpm/TypeScript monorepo that implements the "Agentic SDLC" — phase-based AI agents (`/discover`, `/refine`, `/design`, `/build`, `/test`, `/release`) shipped as a VS Code/GitHub Copilot extension (primary, supported), as a Claude Code plugin, and as a GitHub Copilot pack (CLI + desktop app) — the latter two wrapping the MCP server. **Most Claude Code work in this repo happens inside `tools/slalom-sdlc/`.**

Full behavioral rules for AI agents operating on a *client* project (non-negotiable Apex/LWC rules, commit/branch format, standards-file routing) are in [AGENTS.md](AGENTS.md) and its GitHub Copilot equivalent `.github/copilot-instructions.md` — read those before generating Apex, LWC, OmniStudio, or config metadata under `force-app/`.

## Commands

### `tools/slalom-sdlc/` (the tool itself — pnpm workspace)

```bash
cd tools/slalom-sdlc
pnpm install
pnpm build                              # builds all packages (core → mcp/vscode/cli)
pnpm typecheck                          # tsc --noEmit across all packages
pnpm -r --filter @sdlc/core build       # build a single package
pnpm -r --filter @sdlc/core typecheck

cd packages/vscode && pnpm package      # → slalom-sdlc-x.x.x.vsix
cd packages/cli && pnpm package         # → native binaries (macOS/Windows/Linux via pkg)

node scripts/package-instructions.mjs --version x.x.x   # build instructions.zip + manifest.json for a GitHub Release
```

There is no automated test suite in `tools/slalom-sdlc` (no jest/vitest configured) — typecheck is the correctness gate. Always run `pnpm typecheck` after editing `packages/core` since `mcp`, `vscode`, and `cli` all depend on it via `workspace:*`.

To run the MCP server locally against a Claude Code session: `cd tools/slalom-sdlc/packages/mcp && ./setup.sh`.

### Root repo (Salesforce delivery content)

```bash
sh devops/scripts/install-hooks.sh                                  # register .hooks/ via core.hooksPath (run once after cloning)
sf project deploy start --source-dir force-app/                     # deploy metadata to default org
sf apex run test --test-level RunLocalTests --result-format human   # Apex tests
npm run test:unit                                                   # LWC JEST tests (sfdx-lwc-jest)
npm run lint / npm run lintFix                                      # ESLint
```

## Architecture of `tools/slalom-sdlc`

```
packages/
  core/     @sdlc/core   — single source of truth: config schema (Zod), Handlebars prompt templates,
                            scaffold logic, JIRA client, standards loader, instruction-cache reader
  vscode/   slalom-sdlc  — VS Code extension, GitHub Copilot chat participant (@slalom-sdlc) — PRIMARY, SUPPORTED
  mcp/      slalom-sdlc-mcp — Claude Code MCP server, shipped inside the plugin (no daily instruction sync of its own)
  cli/      @sdlc/cli    — standalone init/reconfigure CLI, packaged as native binaries
plugin/     Claude Code plugin source (manifest, .mcp.json, commands/) — the built
            server is added by scripts/package-plugin.mjs, never committed
copilot/    GitHub Copilot pack source (agents/ templates + pack/install.sh) — the
            built server is added by scripts/package-copilot.mjs, never committed
```

The repo-root `.claude-plugin/marketplace.json` publishes that plugin. Its source points at the **`plugin-dist` branch**, which `.github/workflows/release.yml` republishes on every `vX.Y.Z` tag with the assembled plugin (including the built `server/server.js`). `plugin-dist` is CI-owned: never commit to it, merge it, or delete it.

The repo-root `.github/agents/*.agent.md` are the GitHub Copilot equivalent of the plugin's `commands/*.md` — thin wrappers that let the `copilot` CLI and desktop app discover the SDLC commands. They are generated from `copilot/agents/` by `scripts/generate-copilot-agents.mjs` (run `--check` in CI to catch drift), and shipped to consultants as `slalom-sdlc-copilot.zip`. When editing a Copilot wrapper, edit the template under `copilot/agents/` and regenerate — never hand-edit `.github/agents/`.

`core` contains all the logic; `vscode`, `mcp`, and `cli` are thin front ends that call into it. When adding a new SDLC command/phase, the work almost always starts in `packages/core/src/`, then gets exposed from each front end (`packages/vscode/src/handlers/`, `packages/mcp/src/tools.ts` + `prompts.ts`, `packages/cli/src/index.ts`).

### The `/init` interview

`packages/core/src/questions.ts` (`QUESTIONS`) is the single question list, and `config-builder.ts` (`buildSdlcConfig`) is the single answers→config assembler. Every front end walks the same list and calls the same builder — only the widget layer differs: `packages/vscode/src/interview.ts` uses `showInputBox`/`showQuickPick`, `packages/mcp/src/elicit.ts` uses MCP elicitation forms. Add a question to `QUESTIONS` and both surfaces pick it up (the MCP side asks anything it hasn't explicitly grouped in a final catch-all form). Never assemble an `SdlcConfig` anywhere else — doing so is how `sdlc_scaffold` ended up JIRA-only while the VS Code path had supported ADO and LOCAL for months.

### Prompt rendering pipeline

1. `/init` (via `sdlc_scaffold` in the MCP, or the VS Code interview) writes `.sdlc/config.json` into the *client* project — JIRA key/site, status-name mappings, sprint length, org alias, enabled phases. Schema is `packages/core/src/schema.ts`.
2. `packages/core/src/engine.ts` → `renderPrompt(phase, config)` compiles the phase's Handlebars template (`packages/core/src/templates/*.ts` — one export per phase, e.g. `discoverTemplate`) with the resolved config, exposing `phases.<name>` boolean flags and an `instructions` object.
3. `instructions.deployment` / `.orgImpactAssessment` / `.prerequisiteCheck` are markdown fragments imported **directly from `devops/instructions/*.md` at build time** (`import x from "../../../../../devops/instructions/x.md"`) and compiled into the JS bundle as string constants — not read from disk at runtime.

Two "instructions" locations exist and are not interchangeable:
- `devops/standards/` — coding standards docs (apex.md, lwc.md, git.md, etc.), referenced by the non-negotiable rules in AGENTS.md when generating Salesforce code.
- `devops/instructions/` — SDLC-agent instruction fragments (deployment.md, org-impact-assessment.md, prerequisite-check.md), compiled directly into `packages/core`'s prompt templates by `engine.ts`. Editing these requires rebuilding `core` (and downstream packages) to take effect.

### Instruction auto-update / IP protection

- Templates and instructions are compiled into the extension bundle (`dist/extension.js`), not shipped as plain files in the client's repo — this is deliberate IP protection (see `tools/slalom-sdlc/README.md`).
- The **VS Code extension only** (`packages/vscode/src/sync.ts`) checks GitHub Releases on `Slalom/salesforce-devops` daily and populates `~/.slalom-sdlc/instructions-cache/current/` (validated against `manifest.json` via SHA-256 checksums, see `packages/core/src/cache.ts`).
- `engine.ts`'s `renderPrompt`/instruction lookups prefer `readCachedTemplate`/`readCachedInstruction` from that cache dir and fall back to the bundled constant if absent or invalid.
- The MCP server and CLI **never perform the sync themselves** — they only benefit from a warm cache if the VS Code extension already populated it on the same machine. On their own they always run on whatever was bundled at their last build. Keep this asymmetry in mind when changing anything under `devops/instructions/` or the cache logic — a fix that "just works" in `vscode` needs a separate build/release for `mcp`/`cli` users to see it. For plugin users the release itself is the fix: every release rebuilds and republishes the plugin, so `claude plugin update slalom-sdlc@slalom` picks up new instructions.
- `scripts/package-instructions.mjs` packages `devops/instructions/*.md` + the phase templates into `instructions.zip` (with a checksummed `manifest.json`) for upload to a GitHub Release — this is the file the sync mechanism above downloads.

### JIRA integration

`packages/core/src/jira.ts` is the only ALM integration currently implemented (JIRA REST via the `atlassian` MCP server / API credentials from `.sdlc/config.json`). Status-name mapping (e.g. "Ready for Design") is per-project and stored in `.sdlc/config.json`, not hardcoded, so templates reference `{{project.storyStatusMap.readyForDesign}}`-style fields rather than literal strings.

## MCP servers configured for this repo (`.mcp.json`)

- `Salesforce_DX` — `@salesforce/mcp`, org/metadata/data/user tools against `DEFAULT_TARGET_ORG`
- `atlassian` — JIRA/Confluence via `mcp-remote`
- `slalom-sdlc` — the locally-built MCP server at `tools/slalom-sdlc/packages/mcp/dist/server.js` (must run `pnpm build` in `tools/slalom-sdlc` after changing `core` or `mcp` source for this to reflect changes)
