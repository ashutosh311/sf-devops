# Slalom Otto — MCP Server Design Document

**Version**: 0.1.1
**Author**: Slalom UK&I
**Last updated**: 2026-06-02
**Status**: Active — companion to the VS Code extension ([DESIGN.md](./DESIGN.md))

---

## Contents

1. [Purpose](#1-purpose)
2. [Why MCP — and the slash-command alternative we rejected](#2-why-mcp--and-the-slash-command-alternative-we-rejected)
3. [Monorepo Structure (with `packages/mcp`)](#3-monorepo-structure-with-packagesmcp)
4. [Architecture Overview](#4-architecture-overview)
5. [Core Concepts](#5-core-concepts)
   - 5.1 [MCP Server Primitives](#51-mcp-server-primitives)
   - 5.2 [Phase Agents as MCP Prompts](#52-phase-agents-as-mcp-prompts)
   - 5.3 [Init / Scaffold as an MCP Tool](#53-init--scaffold-as-an-mcp-tool)
   - 5.4 [Locating the Project Root](#54-locating-the-project-root)
   - 5.5 [IP Protection Model](#55-ip-protection-model)
6. [Build Time](#6-build-time)
7. [Runtime Flow](#7-runtime-flow)
8. [Surface Map](#8-surface-map)
   - 8.1 [Prompts](#81-prompts)
   - 8.2 [Tools](#82-tools)
9. [Installation in Claude Code](#9-installation-in-claude-code)
10. [Configuration Schema](#10-configuration-schema)
11. [MCP-to-MCP: Salesforce and the PM tool](#11-mcp-to-mcp-salesforce-and-the-pm-tool)
12. [VSIX vs MCP — Feature Parity](#12-vsix-vs-mcp--feature-parity)
13. [What Lives Where](#13-what-lives-where)
14. [Open Questions & Risks](#14-open-questions--risks)
15. [Getting Started — Installing the MCP Server](#15-getting-started--installing-the-mcp-server)

---

## 1. Purpose

The Slalom Otto tooling already ships as a **VS Code / GitHub Copilot chat participant** (`@otto`). This document designs a second front-end for the **same engine** that targets **Claude Code** — Anthropic's CLI / IDE agent — via the **Model Context Protocol (MCP)**.

The goal is identical to the VSIX: bring Slalom's Salesforce delivery process — discovery, refinement, design, build, test, release — into the developer's agent of choice, driven by purpose-built phase prompts, while keeping the methodology IP out of the client's repo.

Like the VSIX, the MCP server is a **thin orchestration layer**. It does not implement agent logic; it:

1. Reads the project's configuration from `.sdlc/config.json`
2. Renders a fully-resolved instruction prompt via `@otto/core`'s `renderPrompt()`
3. Hands that prompt to the host LLM (Claude) when the user invokes a phase command
4. Lets Claude execute the agent procedure using its own tools and the connected Salesforce / Atlassian MCPs

The crucial reuse: **`@otto/core` is consumed unchanged**. The MCP package is the same shape as `packages/vscode` — a protocol adapter around the existing engine.

---

## 2. Why MCP — and the slash-command alternative we rejected

There are two realistic ways to extend Claude Code with phase agents:

| Approach | How it ships | IP exposure |
|---|---|---|
| **Custom slash commands** (`.claude/commands/*.md`) | Plain markdown files committed to the client repo | ❌ The full prompt IP sits readable in the repo, forever |
| **MCP server** (this design) | Compiled server bundle distributed via npm / npx | ✅ Templates compiled into the bundle, never written to the repo — same bar as the VSIX |

Slash commands were rejected for the same reason `devops/instructions/` is never scaffolded: they would expose Slalom's proprietary SDLC methodology as readable files in every client repo. The MCP server preserves the VSIX's IP-protection posture (see [§5.5](#55-ip-protection-model)).

**Decision (this design):** phase agents are exposed as **MCP Prompts** (cleanest slash-command UX in Claude Code), and `init` is exposed as an **MCP Tool** (it performs filesystem side effects and is naturally agent-invoked).

---

## 3. Monorepo Structure (with `packages/mcp`)

The MCP server is added as a fourth workspace package, a sibling to `cli`, `core`, and `vscode`. `core` and the `devops/` content directories are untouched.

```
tools/otto/
├── package.json                  workspace root
├── pnpm-workspace.yaml
└── packages/
    ├── core/                     shared logic — UNCHANGED
    │   └── src/
    │       ├── engine.ts         renderPrompt() — reused as-is
    │       ├── scaffold.ts       scaffoldRepo() — reused as-is
    │       ├── schema.ts         OttoConfig Zod schema — reused as-is
    │       ├── questions.ts      interview question definitions — reused
    │       └── templates/*.ts    the prompt IP — reused, still compiled-in
    │
    ├── vscode/                   VS Code extension (existing)
    ├── cli/                      standalone scaffold CLI (existing)
    │
    └── mcp/                      ★ NEW — Claude Code MCP server
        ├── src/
        │   ├── index.ts          server bootstrap + stdio transport
        │   ├── prompts.ts        registers the 6 phase prompts + /about
        │   ├── tools.ts          registers otto_scaffold (+ status helpers)
        │   ├── config.ts         project-root resolution + config loader
        │   └── interview-schema.ts  derives the scaffold tool's input schema
        │                             from core/questions.ts (single source)
        ├── esbuild.mjs           bundles dist/server.js (externalises nothing
        │                         except the node runtime)
        ├── package.json          "bin": { "otto-mcp": "dist/server.js" }
        └── README.md             install instructions for Claude Code
```

The `mcp` package depends on `@otto/core` via `workspace:*`, exactly like `vscode` does.

---

## 4. Architecture Overview

```
╔══════════════════════════════════════════════════════════════════════╗
║                 SLALOM SDLC — MCP SERVER TOPOLOGY                   ║
╚══════════════════════════════════════════════════════════════════════╝

  ┌───────────────────────────────────────────────────────────────┐
  │  Claude Code  (host / LLM)                                     │
  │                                                                │
  │   user: /mcp__otto__refine PROJ-42                     │
  └───────────────┬───────────────────────────────────────────────┘
                  │  MCP (stdio JSON-RPC)
                  ▼
  ┌───────────────────────────────────────────────────────────────┐
  │  otto-mcp   (this package — a local node process)       │
  │                                                                │
  │   prompts/list   →  about, discover, refine, design,          │
  │                     build, test, release                       │
  │   prompts/get    →  reads .sdlc/config.json,                   │
  │                     renderPrompt('refine', config),            │
  │                     returns the finished prompt message         │
  │                                                                │
  │   tools/list     →  otto_scaffold (init), otto_status          │
  │   tools/call     →  scaffoldRepo(config, root)                 │
  │                                                                │
  │   ┌──────────────────────────────────────────────────────┐   │
  │   │  @otto/core  (bundled in)                            │   │
  │   │   templates/*.ts   ← Slalom IP, compiled into bundle │   │
  │   │   instructions/*   ← Slalom IP, compiled into bundle │   │
  │   └──────────────────────────────────────────────────────┘   │
  └───────────────────────────────────────────────────────────────┘
                  │
                  ▼  reads only
  ┌───────────────────────────────────────────────────────────────┐
  │  Client repo:  .sdlc/config.json   (written by otto_scaffold)  │
  └───────────────────────────────────────────────────────────────┘

  Separately, Claude Code also connects to the Salesforce & Atlassian
  MCPs (see §11) — the rendered prompt instructs Claude to use them.
```

The key difference from the VSIX: **the orchestrator is Claude Code, not our code.** In the VSIX our handler calls `model.sendRequest(...)`. In MCP, we only *supply the prompt*; Claude drives the conversation and tool use.

---

## 5. Core Concepts

### 5.1 MCP Server Primitives

The Model Context Protocol lets a server expose three things to a host:

| Primitive | Who triggers it | Used here for |
|---|---|---|
| **Prompts** | The **user** (surfaced as slash commands) | The 6 phase agents + `/about` |
| **Tools** | The **model** (Claude decides to call) | `otto_scaffold` (init), `otto_status` |
| **Resources** | The model / host (read on demand) | *Not used* — would leak IP to the transcript; intentionally avoided |

We build on the official TypeScript SDK, `@modelcontextprotocol/sdk`, over the **stdio** transport (Claude Code launches the server as a child process and speaks JSON-RPC over stdin/stdout).

### 5.2 Phase Agents as MCP Prompts

Each SDLC phase is registered as a named MCP prompt. In Claude Code these appear as slash commands of the form `/mcp__<serverName>__<promptName>`.

```typescript
// packages/mcp/src/prompts.ts  (illustrative)
import { renderPrompt, type OttoConfig } from "@otto/core";

const STORYLESS = new Set(["discover", "release"]);  // no story-key arg

for (const phase of ["discover","refine","design","build","test","release"]) {
  server.registerPrompt(
    phase,
    {
      title: `Slalom Otto — ${phase}`,
      description: PHASE_DESCRIPTIONS[phase],
      argsSchema: STORYLESS.has(phase)
        ? {}
        : { storyKey: z.string().describe("Story key — a JIRA key (e.g. PROJ-42) or an ADO work-item ID (e.g. #42)").optional() },
    },
    async ({ storyKey }) => {
      const config = await loadConfig();              // reads .sdlc/config.json
      let text = renderPrompt(phase, config);         // ← reuse, unchanged
      if (storyKey) {
        text = text.replace(/\{STORY_KEY\}/g, storyKey)
                   .replace(/\{TICKET_KEY\}/g, storyKey);
      }
      return {
        messages: [{ role: "user", content: { type: "text", text } }],
      };
    }
  );
}
```

When the user runs `/mcp__otto__refine PROJ-42`, Claude Code calls `prompts/get` with `{ storyKey: "PROJ-42" }`; the server renders and returns the finished prompt; Claude then executes the procedure. This is the direct analog of `handleAgent` in the VSIX — the same `renderPrompt` + story-key substitution, minus the `model.sendRequest` call (Claude does that itself).

### 5.3 Init / Scaffold as an MCP Tool

The VSIX `/init` runs an interactive wizard of input boxes. MCP prompts are single-shot request/response and can't drive a multi-step wizard. So `init` becomes a **tool** and Claude conducts the interview *conversationally*:

```
User:   /mcp__otto__init        (a thin prompt that kicks this off)
Claude: What's the client / project name?
User:   Acme
Claude: Which PM tool — JIRA or Azure DevOps?  ... (walks the questions from core/questions.ts;
        asks JIRA key/site/email for JIRA, or org URL/project name for ADO)
...
Claude: → calls otto_scaffold({ projectName: "Acme", pmTool: "JIRA", jiraKey: "ACME", ... })
Server: validates with OttoConfigSchema, runs scaffoldRepo(config, root)
Server: ← returns { created: [...], updated: [...], preserved: [...] }
Claude: ✅ Initialised Acme. Created .sdlc/config.json, devops/standards/...
```

The tool's input schema is **derived from `core/questions.ts`** so the question set stays single-sourced across CLI, VSIX, and MCP — including the `pmTool` branch that selects between the JIRA (`jiraKey`/`jiraSite`/`jiraEmail`) and ADO (`adoOrganization`/`adoProject`) question sets. The tool body is essentially the VSIX `handleInit` minus the UI: build `OttoConfig`, `scaffoldRepo(config, root)`, return the `ScaffoldResult`.

A companion `/about` prompt and an optional `/init` kickoff prompt give the interview a discoverable entry point.

### 5.4 Locating the Project Root

The server must find `.sdlc/config.json`. Resolution order:

1. **MCP `roots`** — if the host advertises workspace roots (Claude Code does), query `roots/list` and use the first root. This is the protocol-correct method.
2. **`SDLC_PROJECT_ROOT`** env var — settable in the `.mcp.json` server definition for non-roots hosts.
3. **`process.cwd()`** — fallback; Claude Code launches project-scoped servers with cwd at the project directory.

If no `.sdlc/config.json` is found, prompts return a helpful message telling the user to run the init flow first — mirroring `requireConfig()` in the VSIX.

### 5.5 IP Protection Model

The protection bar is **identical to the VSIX, and for the same structural reason**:

- `templates/*.ts` and `devops/instructions/*.md` are imported by `@otto/core` and **compiled into `dist/server.js`** via the esbuild text loader.
- `scaffoldRepo()` never imports them, so `otto_scaffold` never writes them to the client repo.
- The distributed artifact is the bundled server — no source, no raw `.md`.

> ⚠️ **One honest caveat — runtime visibility.** In *both* the VSIX and this MCP server, the *rendered* prompt is transmitted to a local LLM client at invocation time, so a determined user can capture it (unpack the bundle, log MCP traffic). True hiding from the end user is impossible once instructions must reach a local agent.
>
> There is a minor difference in **where** the rendered text surfaces:
> - **VSIX**: the prompt is sent as a hidden priming message — not rendered into the visible chat panel.
> - **MCP Prompts**: the returned prompt is injected into Claude Code's **visible transcript**, so the user can read the rendered (config-substituted) instructions for that one phase.
>
> This is acceptable for a professional-services tool — the bar is "not casually readable, not committed to the repo," which MCP meets — but it should be a conscious, signed-off decision. If stricter hiding is ever required, the fallback is the Tool variant (instructions land in the tool-result channel rather than as a posted message), at the cost of the clean slash-command UX.

---

## 6. Build Time

```
╔══════════════════════════════════════════════════════════════════════╗
║              BUILD TIME  —  pnpm build → esbuild                     ║
╚══════════════════════════════════════════════════════════════════════╝

  devops/instructions/*.md     ──┐
  devops/standards/*.md        ──┤   esbuild .md text loader (via @otto/core)
  templates/*.ts (HB strings)  ──┤   embeds content as JS string literals
  @otto/core engine + schema   ──┤
  @modelcontextprotocol/sdk    ──┘
                                    ▼
              ┌──────────────────────────────────────┐
              │     dist/server.js   (bundled)        │
              │                                       │
              │  designTemplate    = "## Step 0 — …" │  ← baked in
              │  deploymentStr     = "# Sandbox…"    │  ← baked in
              │  #!/usr/bin/env node  shebang        │  ← bin entry
              └──────────────────────────────────────┘
                                    │
                                    ▼  published to npm  (or run via npx)
              ┌──────────────────────────────────────┐
              │  Client machine                       │
              │  npx otto-mcp                  │
              │  No instruction files on disk.        │
              └──────────────────────────────────────┘
```

Build pipeline:

```
pnpm --filter @otto/core build      →  packages/core/dist/index.js
pnpm --filter otto-mcp build →  packages/mcp/dist/server.js   (esbuild, platform=node, bundle, shebang)
```

Distribution options (pick one):
- **npm package** `@slalom/sdlc-mcp` with a `bin` — users run via `npx @slalom/sdlc-mcp` (private registry to keep it internal).
- **Single-file bundle** committed/released as an artifact, run via `node server.js`.

The `--no-dependencies`/external story is simpler than the VSIX: bundle everything except the Node runtime; the SDK and `@otto/core` are inlined.

---

## 7. Runtime Flow

```
╔══════════════════════════════════════════════════════════════════════╗
║        RUNTIME — /mcp__otto__design PROJ-42                  ║
╚══════════════════════════════════════════════════════════════════════╝

  ┌──────────────────────────────────────────────────────────────┐
  │  Claude Code                                                │
  │  User: /mcp__otto__design PROJ-42                    │
  └──────────────────────────┬───────────────────────────────────┘
                             │  prompts/get { name:"design", args:{storyKey:"PROJ-42"} }
                             ▼
                  otto-mcp server
                             │
            ┌────────────────┴────────────────┐
            │                                 │
            ▼                                 ▼
    loadConfig()                      designTemplate (Handlebars string)
    root via roots/list,              {{{instructions.orgImpactAssessment}}}
    reads .sdlc/config.json           {{paths.standards}} / {{…statusMap…}}
            │                                 │
            └────────────────┬────────────────┘
                             ▼
                      renderPrompt("design", config)   ← @otto/core, unchanged
                             │
                             ▼  replace {STORY_KEY} → PROJ-42
            ┌────────────────────────────────┐
            │  resolved prompt (markdown)    │  no placeholders remaining
            └──────────────┬─────────────────┘
                           │  returned as the prompt's user message
                           ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  Claude Code (LLM) now drives the procedure:                 │
  │   • reads artifacts/PROJ-42/ locally                         │
  │   • calls Atlassian MCP to fetch the story + epic            │
  │   • calls Salesforce MCP for org impact assessment           │
  │   • writes solution-design.md, proposes JIRA updates         │
  └──────────────────────────────────────────────────────────────┘
```

Contrast with the VSIX runtime flow ([DESIGN.md §6](./DESIGN.md#6-runtime-flow)): up to "resolved prompt" the two are identical. After that, the VSIX calls the model itself and streams chunks; here the server **returns** and Claude Code takes over as the orchestrator.

---

## 8. Surface Map

### 8.1 Prompts

| Prompt (slash command) | Args | Backed by |
|---|---|---|
| `about` | — | static text constant |
| `init` | — | kickoff text → instructs Claude to gather answers and call `otto_scaffold` |
| `discover` | — | `renderPrompt("discover", config)` |
| `refine` | `storyKey?` | `renderPrompt("refine", config)` |
| `design` | `storyKey?` | `renderPrompt("design", config)` |
| `build` | `storyKey?` | `renderPrompt("build", config)` |
| `test` | `storyKey?` | `renderPrompt("test", config)` |
| `release` | — | `renderPrompt("release", config)` |

Prompts whose phase is not enabled in `config.phases` are still registered but return a "this phase is not enabled for the project" notice — keeps the slash-command list stable.

### 8.2 Tools

| Tool | Input | Effect |
|---|---|---|
| `otto_scaffold` | full config params (schema derived from `core/questions.ts`) | validates via `OttoConfigSchema`, runs `scaffoldRepo(config, root)`, returns `ScaffoldResult` |
| `otto_status` *(optional)* | — | reports whether `.sdlc/config.json` exists, the enabled phases, and the PM-tool (JIRA or ADO) / sandbox config — useful for Claude to self-orient |

---

## 9. Installation in Claude Code

**Distribution model: setup script from the Slalom repo** (see [§14 Q2](#14-open-questions--risks) and [§15](#15-getting-started--installing-the-mcp-server) for the full rationale and step-by-step guide).

Each Slalom developer clones the internal repo once, builds the server locally, and registers it with Claude Code at user scope. The server binary (`dist/server.js`) is a single self-contained file — no registry, no auth tokens.

```bash
# One-time per machine (or use setup.sh — see §15)
git clone git@github.com:slalom/sf-uki-devops.git ~/otto
cd ~/otto/tools/otto && pnpm install
pnpm --filter @otto/core build
pnpm --filter otto-mcp build

claude mcp add --scope user otto -- \
  node ~/otto/tools/otto/packages/mcp/dist/server.js
```

The server is registered at **user scope** — it is available in every Claude Code session automatically, not just in specific project directories.

After connecting, `/mcp__otto__*` commands appear in Claude Code's slash-command menu. `otto_scaffold` should be added to the project's tool allowlist so init runs without a per-call permission prompt.

**Project-level `.mcp.json`** (written automatically by `otto_scaffold` on `/init`):

```jsonc
// .mcp.json  —  commit this to the client repo so teammates get Salesforce + Atlassian wired up
{
  "mcpServers": {
    "Salesforce_DX": {
      "command": "npx",
      "args": ["-y", "@salesforce/mcp", "--orgs", "DEFAULT_TARGET_ORG",
               "--toolsets", "orgs,metadata,data,users",
               "--tools", "run_apex_test", "--allow-non-ga-tools"]
    },
    "atlassian": { "type": "http", "url": "https://mcp.atlassian.com/v1/mcp" }
  }
}
```

> Note: `otto` is **not** in the project `.mcp.json`. It is registered at user scope via `setup.sh` (see [§15](#15-getting-started--installing-the-mcp-server)) and is therefore already available in every Claude Code session — no per-project entry needed.

> The init flow writes **both** `.vscode/mcp.json` (Salesforce + Atlassian, for the VSIX/Copilot path) **and** `.mcp.json` (for Claude Code), so a single project can be driven from either agent. See [§11](#11-mcp-to-mcp-salesforce-and-the-pm-tool).

---

## 10. Configuration Schema

Unchanged from the VSIX — the **same `.sdlc/config.json`** validated by the same `OttoConfigSchema` in `@otto/core` ([DESIGN.md §9](./DESIGN.md#9-configuration-schema)). A project initialised by the VSIX works with the MCP server and vice-versa; there is one config, one schema, one source of truth.

The only scaffold addition is writing `.mcp.json` next to `.vscode/mcp.json` (see [§11](#11-mcp-to-mcp-salesforce-and-the-pm-tool)).

---

## 11. MCP-to-MCP: Salesforce and the PM tool

The phase prompts instruct Claude to use the Salesforce MCP and the PM-tool MCP for org metadata, Apex tests, and work-item/status operations — exactly as the VSIX templates already do. Those are **separate MCP servers** that Claude Code connects to directly; our server does not proxy them. For JIRA projects the PM-tool MCP is Atlassian (which also serves Confluence); for Azure DevOps projects it is the Azure DevOps MCP, which the scaffold writes automatically (`buildPmMcpEntry()` in `core/scaffold.ts`) — no manual config step needed for either PM tool.

`scaffoldRepo()` is extended to emit a Claude-Code-flavoured `.mcp.json` carrying the same two server definitions it already writes to `.vscode/mcp.json`:

```jsonc
// .mcp.json
{
  "mcpServers": {
    "Salesforce_DX": {
      "command": "npx",
      "args": ["-y","@salesforce/mcp","--orgs","DEFAULT_TARGET_ORG",
               "--toolsets","orgs,metadata,data,users",
               "--tools","run_apex_test","--allow-non-ga-tools"]
    },
    "atlassian": { "type": "http", "url": "https://mcp.atlassian.com/v1/mcp" }
  }
}
```

`otto` is omitted here — it is registered at user scope via `setup.sh` and is available in all sessions without a project entry.

(Format differs slightly from VS Code's `mcp.json`: Claude Code uses the `mcpServers` key and `command/args/env` or `type:"http"+url`. The scaffold writes the correct shape for each target.)

---

## 12. VSIX vs MCP — Feature Parity

| Capability | VSIX (Copilot) | MCP (Claude Code) |
|---|---|---|
| Phase agents | `/discover … /release` slash commands | `/mcp__otto__*` prompts |
| Story-key arg | parsed from message text | typed prompt argument |
| Init / scaffold | interactive input-box wizard | conversational interview → `otto_scaffold` tool |
| About | static markdown | `about` prompt |
| Config | `.sdlc/config.json` | **same file, same schema** |
| Engine | `renderPrompt()` | **same function, reused** |
| IP location | compiled into `extension.js` | compiled into `server.js` |
| Orchestrator | our handler (`model.sendRequest`) | Claude Code itself |
| Token pre-flight guard | yes (`countTokens`) | host-managed (Claude Code) |
| Salesforce / Atlassian MCP | `.vscode/mcp.json` | `.mcp.json` |

The only behavioural delta is **who orchestrates** and the **runtime visibility nuance** of [§5.5](#55-ip-protection-model). Everything downstream of `renderPrompt` is shared.

---

## 13. What Lives Where

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                      WHAT LIVES WHERE  (MCP variant)                             ║
╚══════════════════════════════════════════════════════════════════════════════════╝

  ┌─────────────────────────┬──────────────────────┬──────────────────────────┐
  │                         │   Slalom repo        │   Client repo            │
  │                         │   (internal)         │   (after init)           │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Agent instructions      │ devops/instructions/ │ ✗ never written          │
  │                         │ (source of truth)    │   compiled into server.js │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Phase prompts /         │ packages/core/src/   │ ✗ never written          │
  │ Handlebars templates    │ templates/*.ts       │   compiled into server.js │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Coding standards        │ devops/standards/    │ ✓ devops/standards/      │
  │                         │ (source of truth)    │   copied on init         │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Project config          │ ✗                    │ ✓ .sdlc/config.json      │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Claude Code MCP config  │ ✗                    │ ✓ .mcp.json              │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ VS Code MCP config      │ ✗                    │ ✓ .vscode/mcp.json       │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ SDLC Artifacts          │ ✗                    │ ✓ artifacts/{STORY}/     │
  └─────────────────────────┴──────────────────────┴──────────────────────────┘
```

The IP rows are unchanged from the VSIX matrix — templates and instructions still only ever live inside the distributed binary.

---

## 14. Open Questions & Risks

1. **Runtime transcript visibility** ([§5.5](#55-ip-protection-model)) — accept that the rendered prompt is visible in Claude Code's transcript, or fall back to the Tool surface for stricter hiding?
   > **✅ Decision (v0.1):** Accept. The protection bar — not committed to the repo, not readable without deliberate effort — is sufficient for a Slalom internal tool. Revisit if a client raises it; the Tool surface is the documented fallback.

2. **Distribution channel** — public npm vs Slalom private registry vs setup-script-from-repo.
   > **✅ Decision (v0.1):** Setup script from the internal repo. No registry required. Access is gated by existing Bitbucket/GitHub repo permissions. Each developer clones once, builds locally, and registers via `claude mcp add`. Full steps in [§15](#15-getting-started--installing-the-mcp-server).
   >
   > *Graduate to a private registry when the tool is rolled out to client machines that should not have repo access, or when version pinning across a large team becomes a requirement.*
   >
   > **⛔ Superseded — Claude Code plugin.** Claude Code plugins and plugin marketplaces didn't exist when the v0.1 decision was taken; they solve install *and* update together and make the registry question moot. The server now ships as the `otto` plugin, declared in the repo-root `.claude-plugin/marketplace.json` and published to the generated `plugin-dist` branch by the release workflow:
   >
   > ```bash
   > claude plugin marketplace add Slalom/salesforce-devops
   > claude plugin install otto@slalom
   > claude plugin update otto@slalom     # thereafter
   > ```
   >
   > Access control is unchanged in substance — Claude Code clones the plugin, so read access to the internal repo is still the gate. The clone-and-build path in [§15](#15-getting-started--installing-the-mcp-server) survives as the *development* workflow only; `packages/mcp/setup.sh` says so at the top. See `README.md` → Distribution for the shipping model.

3. **Root resolution across hosts** — confirm Claude Code advertises `roots`; verify the `${workspaceFolder}` expansion in `.mcp.json` env actually resolves (fall back to cwd if not).
   > *Open. The server now implements `roots/list` → `SDLC_PROJECT_ROOT` → `cwd` fallback chain. Needs validation against a live client project.*

4. **Interview UX in chat** — the conversational interview is less rigid than the VSIX wizard. Mitigate by making `otto_scaffold`'s schema strict (Zod) so Claude is forced to collect every required field before the call succeeds.
   > *Open. Schema strictness is implemented. Needs UX testing on first real project setup.*

5. **Phase-not-enabled prompts** — register-but-warn vs hide entirely. Registering keeps the command list stable but clutters the menu; hiding requires re-listing on config change.
   > *Open. Current implementation registers all phases and returns a "not enabled" message if invoked. Monitor whether the cluttered menu is a real usability issue.*

6. **Versioning** — the MCP server, VSIX, and `@otto/core` should share a version line so a `.sdlc/config.json` `toolVersion` remains meaningful across both front-ends.
   > *Open. All three currently sit at `0.2.5` / `1.0.0` independently. Align on a single version bump strategy before v1.0.*

---

## 15. Getting Started — Installing the MCP Server

This section is the canonical reference for getting the Slalom Otto MCP server running on a new machine. It targets Slalom developers who have access to the internal repo.

### Prerequisites

| Requirement | Check |
|---|---|
| Node.js ≥ 20 | `node --version` |
| pnpm ≥ 9 | `pnpm --version` — install via `npm i -g pnpm` if missing |
| Claude Code CLI | `claude --version` — install from [claude.ai/code](https://claude.ai/code) |
| Repo access | SSH key / HTTPS credentials for the internal repo |

---

### Step 1 — Clone and build (one-time per machine)

A `setup.sh` script at `tools/otto/packages/mcp/setup.sh` automates this. Run it once:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/slalom/sf-uki-devops/main/tools/otto/packages/mcp/setup.sh)
```

Or clone manually and run it locally:

```bash
git clone git@github.com:slalom/sf-uki-devops.git ~/otto
bash ~/otto/tools/otto/packages/mcp/setup.sh
```

The script does the following:
1. Installs pnpm workspace dependencies
2. Builds `@otto/core` (bakes prompt templates and instructions into the bundle)
3. Builds `otto-mcp` → `dist/server.js`
4. Registers the server with Claude Code at user scope via `claude mcp add`

After the script completes, the server is available in **every Claude Code session** — no project-level config needed to start using it.

---

### Step 2 — Verify the installation

Open a new terminal and run:

```bash
claude mcp list
```

You should see `otto` with status `✓ Connected`.

Then start Claude Code in any directory and run:

```
/mcp__otto__about
```

If you see the Slalom Otto help text, the server is working.

---

### Step 3 — Set up a Salesforce project

`cd` into the Salesforce project you want to work on and run `claude`. Then:

```
/mcp__otto__init
```

Claude will walk you through a short interview and scaffold the project with:

```
.sdlc/config.json          ← project configuration
.mcp.json                  ← Claude Code MCP config (commit this)
.vscode/mcp.json           ← VS Code / Copilot MCP config (commit this)
devops/standards/          ← coding standards library
artifacts/                 ← SDLC artifact directories
force-app/frameworks/      ← trigger framework placeholder
```

Commit `.mcp.json` and `.vscode/mcp.json` — teammates who clone the client repo get the Salesforce and PM tool MCP servers wired up automatically (Atlassian for JIRA projects, Azure DevOps for ADO projects).

---

### Step 4 — Typical sprint workflow

```
/mcp__otto__discover          ← map requirements, draft epics and stories
/mcp__otto__refine PROJ-42    ← acceptance criteria and open questions
/mcp__otto__design PROJ-42    ← technical design, produces solution-design.md
/mcp__otto__build PROJ-42     ← scaffold Apex/LWC/config, deploy to sandbox
/mcp__otto__test PROJ-42      ← test classes, JEST tests, coverage validation
/mcp__otto__release           ← deployment notes and PM-tool transitions
```

---

### Updating the server

When the Slalom repo has new prompt updates or bug fixes:

```bash
cd ~/otto          # or wherever you cloned the repo
git pull
cd tools/otto
pnpm --filter @otto/core build
pnpm --filter otto-mcp build
```

Claude Code picks up the new `dist/server.js` on the next prompt — no restart or re-registration needed.

---

### Onboarding a new teammate

Share this document and point them to the setup script. They need:
1. Repo access (request via normal Slalom access process)
2. Claude Code installed
3. `bash ~/otto/tools/otto/packages/mcp/setup.sh` — that's it

---

*Built by Slalom UK&I · companion to [DESIGN.md](./DESIGN.md)*
