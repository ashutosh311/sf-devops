# Slalom SDLC

AI-assisted SDLC agents for Salesforce delivery, built by Slalom UK&I.

Each slash command activates a purpose-built AI agent for a specific delivery phase — discovery, refinement, design, build, test, and release. The agents work within the project's JIRA board, Salesforce org, and Slalom coding standards without the consultant needing to switch context.

The **primary, fully-supported experience is the VS Code extension running on GitHub Copilot** (`@slalom-sdlc`). A Claude Code MCP server is also included as an **experimental bonus** for teams that prefer Claude Code — it shares the same engine and standards, but is not the supported delivery path and does not receive automatic instruction updates (see [Instruction Updates](#instruction-updates)).

---

## Contents

1. [Quick Start](#quick-start)
2. [Commands](#commands)
3. [How It Works](#how-it-works)
4. [Instruction Updates](#instruction-updates)
5. [Distribution](#distribution)
6. [IP Protection](#ip-protection)
7. [For Slalom Delivery Teams: Publishing an Update](#for-slalom-delivery-teams-publishing-an-update)
8. [Development](#development)

---

## Quick Start

### VS Code (GitHub Copilot) — recommended

1. Install the `.vsix` extension in VS Code
2. Open your Salesforce project folder
3. Open the Copilot Chat panel and run:

```
@slalom-sdlc /init
```

This runs a short setup interview and scaffolds the project with config, standards, and MCP configs.

### Claude Code (MCP) — experimental bonus

> Not the supported delivery path. Provided for teams already standardised on Claude Code. Instruction auto-update is **not** available here (instructions fall back to those bundled at build time).

```bash
cd tools/slalom-sdlc/packages/mcp
./setup.sh
```

Then from any Salesforce project:

```
/mcp__slalom-sdlc__init
```

---

## Commands

The `@slalom-sdlc` (VS Code / GitHub Copilot) column is the supported invocation. The Claude Code (MCP) column is the equivalent experimental command.

| VS Code (supported) | Claude Code (MCP, experimental) | What it does |
|---|---|---|
| `@slalom-sdlc /about` | `/mcp__slalom-sdlc__about` | Tool overview and command list |
| `@slalom-sdlc /init` | `/mcp__slalom-sdlc__init` | Set up or reconfigure a project |
| `@slalom-sdlc /discover` | `/mcp__slalom-sdlc__discover` | Map requirements, identify unknowns, draft epics and stories |
| `@slalom-sdlc /refine PROJ-42` | `/mcp__slalom-sdlc__refine PROJ-42` | Refine a story — AC, open questions, effort estimate |
| `@slalom-sdlc /design PROJ-42` | `/mcp__slalom-sdlc__design PROJ-42` | Technical design — solution, data model, sub-tasks |
| `@slalom-sdlc /build PROJ-42` | `/mcp__slalom-sdlc__build PROJ-42` | Scaffold Apex/LWC/config, deploy to sandbox |
| `@slalom-sdlc /test PROJ-42` | `/mcp__slalom-sdlc__test PROJ-42` | Generate test classes, validate coverage |
| `@slalom-sdlc /release` | `/mcp__slalom-sdlc__release` | Deployment notes, checklist, JIRA transitions |

### Typical sprint workflow

```
/discover          ← start of sprint: map requirements, create epics and stories
/refine PROJ-42    ← refine each story: AC, estimates, open questions
/design PROJ-42    ← technical design → solution-design.md
/build PROJ-42     ← scaffold, test, deploy, raise PR
/test PROJ-42      ← test coverage and validation
/release           ← release notes and deployment checklist
```

---

## How It Works

The extension is a thin orchestration layer. It does not contain agent logic — instead it:

1. Reads `.sdlc/config.json` from the project root (written by `/init`)
2. Loads the instruction set for the requested SDLC phase
3. Renders a fully-resolved prompt by merging project config (JIRA key, status names, org alias, paths, standards) into the instruction template
4. Sends that prompt to the underlying LLM (GitHub Copilot or Claude) along with the user's message
5. Streams the response back

**The instructions that drive each agent are never written to the client's repository.** They live inside the tool.

### Project layout after `/init`

```
.vscode/
  mcp.json                 ← Atlassian OAuth MCP config
.mcp.json                  ← Claude Code MCP config (Salesforce DX + Atlassian)
.sdlc/
  config.json              ← project config (JIRA key, statuses, org, team settings)
artifacts/
  {STORY-KEY}/
    sf-discovery.md        ← discovery notes
    solution-design.md     ← technical design
    implementation-record.md
devops/standards/          ← Slalom coding standards (Apex, LWC, Git, etc.)
force-app/                 ← Salesforce metadata
```

---

## Instruction Updates

Slalom's delivery procedures improve over time. Rather than requiring everyone to reinstall the extension for every update, the VS Code extension automatically refreshes its instruction set daily from GitHub Releases.

### How it works

- On startup, the extension silently checks whether instructions were updated in the last 24 hours
- If a newer release exists on `Slalom/salesforce-devops`, it downloads the bundle, verifies every file's checksum, and activates the new instructions atomically
- If anything goes wrong (no internet, auth issue, checksum mismatch), the tool falls back to the instructions compiled into the extension — no interruption to your work

Instructions are cached at `~/.slalom-sdlc/instructions-cache/current/`.

> **Auto-update is a VS Code feature.** Only the VS Code extension performs the GitHub sync. The Claude Code MCP server and CLI read from the same local cache if the VS Code extension has populated it, but on their own they always fall back to the instructions bundled at build time — they never sync.

### Authentication

**Minimal setup for VS Code users.** The extension reuses your existing GitHub login. Background syncs are silent and never interrupt you — they run only if VS Code already has a GitHub session with the `repo` scope. The first time you run **Slalom SDLC: Sync Instructions** from the Command Palette, VS Code may prompt you once to sign in or grant repository access; after that, daily background syncs work automatically.

For headless or non-VS Code environments, set one of these environment variables:

```
SLALOM_SDLC_GITHUB_TOKEN   ← preferred
GITHUB_TOKEN
GH_TOKEN
```

The token needs read access to the `Slalom/salesforce-devops` private repository.

### Operational commands

Open the VS Code Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | What it does |
|---|---|
| **Slalom SDLC: Instruction Status** | Shows the active instruction version, last sync time, and any errors |
| **Slalom SDLC: Sync Instructions** | Forces an immediate sync without waiting for the 24-hour window |

---

## Distribution

### For Slalom consultants

Install the `.vsix` extension. The extension connects to the private `Slalom/salesforce-devops` GitHub repo using your Copilot login and keeps instructions up to date automatically.

**Required:** Active GitHub Copilot subscription, GitHub account with access to `Slalom/salesforce-devops`.

### For client teams and non-Slalom users

Distribute a `.vsix` directly. The instructions bundled into that release are available immediately — no GitHub access or internet connection required after install. The sync feature is simply a no-op (no token → no sync → bundled instructions used).

Build a client-ready VSIX:

```bash
cd tools/slalom-sdlc
pnpm -r build
cd packages/vscode
pnpm package    # → slalom-sdlc-x.x.x.vsix
```

---

## IP Protection

Slalom's delivery procedures (the instruction templates that drive each agent) are protected in two layers:

**Layer 1 — Compiled into the binary.** Instructions are TypeScript string constants built into the extension's JavaScript bundle (`dist/extension.js`). They are not separate files; they are not written to the client's project or accessible as plain text.

**Layer 2 — Private repository gating for updates.** The daily sync downloads from a private GitHub repository (`Slalom/salesforce-devops`). A user without repository access cannot retrieve updated instructions. Clients who receive a VSIX get the version baked into that binary; they cannot pull future Slalom updates.

This means:
- Consultants on Slalom projects get continuously updated, best-practice instructions
- Clients who receive a VSIX get a point-in-time snapshot with no route to subsequent Slalom IP

---

## For Slalom Delivery Teams: Publishing an Update

When delivery procedures change (e.g. improved design phase, updated deployment steps):

1. Edit the template files in `packages/core/src/templates/` or the instruction markdown in `devops/instructions/`
2. Build and package the release assets:

```bash
pnpm -r build
node scripts/package-instructions.mjs --version 1.2.3
```

This produces `dist/release/`:
- `instructions.zip` — the instruction bundle (8 files + manifest with checksums)
- `manifest.json` — standalone manifest
- `slalom-sdlc-x.x.x.vsix` — current extension binary (if built)

3. Create a new GitHub Release on `Slalom/salesforce-devops` and upload `instructions.zip` as a release asset
4. All consultants with the extension pick up the update within 24 hours automatically

To also ship a new extension version (e.g. when adding new commands or changing the VS Code integration):

```bash
cd packages/vscode
pnpm package    # → slalom-sdlc-x.x.x.vsix
```

Distribute the `.vsix` through your normal channel.

---

## Development

### Prerequisites

- Node.js 20+
- pnpm 9+

### Setup

```bash
cd tools/slalom-sdlc
pnpm install
pnpm build          # builds all packages
pnpm typecheck      # type-checks all packages
```

### Package structure

```
tools/slalom-sdlc/
├── packages/
│   ├── core/       @sdlc/core — templates, engine, config schema, scaffold
│   ├── vscode/     slalom-sdlc — VS Code extension (GitHub Copilot chat participant)
│   ├── mcp/        slalom-sdlc-mcp — Claude Code MCP server
│   └── cli/        @sdlc/cli — standalone CLI for init/reconfigure
└── scripts/
    └── package-instructions.mjs   — release asset builder
```

### Key scripts

| Command | What it does |
|---|---|
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm package` | Build CLI native binaries (macOS/Windows/Linux) |
| `node scripts/package-instructions.mjs --version x.x.x` | Build release assets for GitHub Release |

### Architecture references

- [DESIGN.md](./DESIGN.md) — VS Code extension architecture
- [DESIGN-mcp.md](./DESIGN-mcp.md) — MCP server architecture

---

Built by Slalom UK&I
