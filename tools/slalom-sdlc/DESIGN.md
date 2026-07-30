# Slalom SDLC Extension — Design Document

**Version**: 0.2.0  
**Author**: Slalom UK&I  
**Last updated**: 2026-06-30

---

## Contents

1. [Purpose](#1-purpose)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Architecture Overview](#3-architecture-overview)
4. [Core Concepts](#4-core-concepts)
   - 4.1 [VS Code Chat Participant API](#41-vs-code-chat-participant-api)
   - 4.2 [Handlebars Templating](#42-handlebars-templating)
   - 4.3 [esbuild Text Loader](#43-esbuild-text-loader)
   - 4.4 [IP Protection Model](#44-ip-protection-model)
5. [Build Time](#5-build-time)
6. [Runtime Flow](#6-runtime-flow)
7. [Commands](#7-commands)
   - 7.1 [/init](#71-init)
   - 7.2 [/about](#72-about)
   - 7.3 [Phase Commands](#73-phase-commands)
8. [SDLC Phases](#8-sdlc-phases)
9. [Configuration Schema](#9-configuration-schema)
10. [MCP Integration](#10-mcp-integration)
11. [Greenfield vs Brownfield](#11-greenfield-vs-brownfield)
12. [Standards vs Instructions](#12-standards-vs-instructions)
13. [What Lives Where](#13-what-lives-where)
14. [Instruction Sync](#14-instruction-sync)

---

## 1. Purpose

`@slalom-sdlc` is a VS Code Chat Participant (a GitHub Copilot extension) that brings Slalom's Salesforce delivery process directly into the editor. Each slash command activates a purpose-built AI agent for a specific SDLC phase — discovery, refinement, design, build, test, and release — and works within the project's PM tool (**JIRA or Azure DevOps**), Salesforce org, and coding standards without the user needing to switch tools. The PM tool is chosen once at `/init` and every agent adapts its status names, work-item hierarchy, and MCP accordingly.

The extension is a thin orchestration layer. It does not implement the agent logic itself; instead it:

1. Reads the project's configuration from `.sdlc/config.json`
2. Renders a fully-resolved instruction prompt by merging configuration values, project paths, and Slalom's agent procedure text
3. Sends that prompt to the underlying LLM (GitHub Copilot) alongside the user's input
4. Streams the LLM's response back to the VS Code chat panel

The agent procedures — the instructions that tell the LLM how to behave at each SDLC phase — are compiled into the extension binary at build time. They are never written to the client's repo.

---

## 2. Monorepo Structure

The tool is a pnpm workspace monorepo with three packages:

```
tools/slalom-sdlc/
├── package.json                  workspace root
├── pnpm-workspace.yaml
├── .gitignore                    excludes dist/, binaries/, *.vsix
├── render_diagrams.py            architecture diagram generator
└── packages/
    ├── core/                     shared logic — templates, schema, scaffold, engine
    │   ├── src/
    │   │   ├── engine.ts         Handlebars renderer (renderPrompt)
    │   │   ├── scaffold.ts       /init file generation
    │   │   ├── schema.ts         SdlcConfig Zod schema + defaults
    │   │   ├── questions.ts      interview question definitions
    │   │   ├── jira.ts           JIRA status helpers
    │   │   ├── md.d.ts           TypeScript declaration for *.md imports
    │   │   └── templates/
    │   │       ├── discover.ts
    │   │       ├── refine.ts
    │   │       ├── design.ts
    │   │       ├── build.ts
    │   │       ├── test.ts
    │   │       └── release.ts
    │   └── tsup.config.ts        esbuild config — enables .md text loader
    │
    ├── vscode/                   VS Code extension
    │   ├── src/
    │   │   ├── extension.ts      activation + command routing
    │   │   ├── config.ts         config reader / workspace helpers
    │   │   ├── interview.ts      /init wizard (VS Code input boxes)
    │   │   └── handlers/
    │   │       ├── init.ts       /init handler
    │   │       └── agent.ts      all phase command handler
    │   ├── esbuild.mjs           bundles extension.js
    │   └── package.json          contributes chatParticipants declaration
    │
    └── cli/                      standalone CLI binary (slalom-sdlc init)
        └── src/
            └── index.ts          terminal-based /init for non-VS Code use
```

The two **source-of-truth** content directories live outside the tool packages, in the wider repo:

```
devops/
├── standards/          coding standards — scaffolded to client repos on /init
│   ├── apex.md
│   ├── lwc.md
│   ├── configuration.md
│   ├── data-model.md
│   ├── git.md
│   ├── omniscript.md
│   ├── ux-accessibility.md
│   └── README.md
└── instructions/       agent procedure files — Slalom IP, compiled into binary only
    ├── deployment.md
    └── org-impact-assessment.md
```

---

## 3. Architecture Overview

```
╔══════════════════════════════════════════════════════════════════════╗
║              SLALOM SDLC EXTENSION — REPO STRUCTURE                  ║
╚══════════════════════════════════════════════════════════════════════╝

  sf-uki-devops/  (Slalom internal repo)
  ├── devops/
  │   ├── standards/          ← coding standards  →  scaffolded to client repos
  │   │   ├── apex.md
  │   │   ├── lwc.md
  │   │   ├── data-model.md
  │   │   └── ...
  │   └── instructions/       ← Slalom IP  →  compiled into .vsix binary only
  │       ├── deployment.md
  │       └── org-impact-assessment.md
  │
  └── tools/slalom-sdlc/
      └── packages/
          ├── core/src/
          │   ├── engine.ts          Handlebars renderer
          │   ├── scaffold.ts        /init scaffolding logic
          │   └── templates/
          │       ├── design.ts      Handlebars template strings
          │       ├── build.ts           (reference {{{instructions.*}}})
          │       └── ...
          └── vscode/src/
              └── handlers/
                  └── agent.ts       VS Code chat command handler
```

The separation between `devops/standards/` and `devops/instructions/` is intentional and described fully in [§12](#12-standards-vs-instructions).

---

## 4. Core Concepts

### 4.1 VS Code Chat Participant API

GitHub Copilot Chat exposes a [Chat Participant API](https://code.visualstudio.com/api/extension-guides/chat) that allows extensions to register as named chat participants. Users address the participant by prefixing their message with `@<name>` and optionally a slash command: `@slalom-sdlc /design KAN-42`.

The extension registers one participant with the id `slalom-sdlc` in `extension.ts`:

```typescript
const participant = vscode.chat.createChatParticipant(
  "slalom-sdlc",
  async (request, chatContext, stream, token) => {
    if (request.command === "init")   { await handleInit(...); }
    else if (request.command === "about") { stream.markdown(ABOUT_TEXT); }
    else                              { await handleAgent(...); }
  }
);
```

Each time the user sends a message the callback fires with:
- `request.command` — the slash command (`design`, `build`, etc.)
- `request.prompt` — the rest of the user's message (e.g. `KAN-42`)
- `request.model` — the active LLM the user has selected in the chat panel
- `stream` — a write stream for sending markdown back to the panel
- `token` — a cancellation token

The participant is declared in `package.json` under `contributes.chatParticipants`, which tells VS Code to make it discoverable in the chat UI:

```json
{
  "chatParticipants": [{
    "id": "slalom-sdlc",
    "name": "slalom-sdlc",
    "isSticky": true,
    "commands": [
      { "name": "about" },
      { "name": "init" },
      { "name": "discover" },
      { "name": "refine" },
      { "name": "design" },
      { "name": "build" },
      { "name": "test" },
      { "name": "release" }
    ]
  }]
}
```

`isSticky: true` means VS Code keeps `@slalom-sdlc` in the chat input after each turn, so the user doesn't have to re-type it.

---

### 4.2 Handlebars Templating

Each SDLC phase has a dedicated prompt template in `packages/core/src/templates/*.ts`. These are Handlebars template strings — plain TypeScript string constants that contain `{{variable}}` placeholders.

At runtime, `renderPrompt(phase, config)` compiles the template and substitutes all placeholders from the project config:

```typescript
export function renderPrompt(phase: string, config: SdlcConfig): string {
  const instructions = {
    deployment: deploymentInstruction,          // baked-in string
    orgImpactAssessment: orgImpactAssessmentInstruction,
  };
  const compiled = Handlebars.compile(raw, { noEscape: true });
  return compiled({ ...config, phases: phaseFlags, instructions });
}
```

**Single braces** `{{paths.standards}}` — inserts a scalar value from the config (e.g. `"devops/standards"`).

**Triple braces** `{{{instructions.deployment}}}` — inserts a value **without HTML escaping**. Used for multi-line markdown content (backticks, hashes, pipes) that must not be mangled.

**Block helpers** `{{#eq team.estimationApproach "ta-assigns"}}...{{/eq}}` — conditional sections, used to render different estimation instructions depending on team configuration.

The output is a single fully-resolved markdown string — every placeholder is gone. This is what gets sent to the LLM.

---

### 4.3 esbuild Text Loader

TypeScript cannot import `.md` files natively. The `tsup.config.ts` in `packages/core` enables this via an esbuild loader:

```typescript
// packages/core/tsup.config.ts
export default defineConfig({
  entry: ["src/index.ts"],
  loader: { ".md": "text" },
  ...
});
```

With this in place, any `.md` file can be imported as a plain string:

```typescript
import apexMd from "../../../../../devops/standards/apex.md";
// apexMd is now a string containing the full file content
```

esbuild reads the file **at build time** and replaces the import with a JavaScript string literal. The file content is baked into `dist/index.js` — no file I/O happens at runtime.

A TypeScript declaration file (`src/md.d.ts`) tells the TypeScript compiler how to type these imports:

```typescript
declare module "*.md" {
  const content: string;
  export default content;
}
```

---

### 4.4 IP Protection Model

The agent procedure files (`devops/instructions/*.md`) contain Slalom's proprietary SDLC methodology. They must not be exposed in client repos.

The protection is structural, not encrypted — it relies on the build pipeline:

- The files are imported in `engine.ts` using the esbuild text loader
- Their content becomes embedded string constants inside `extension.js`
- `scaffold.ts` (which writes files to the client repo) **never imports them**
- The `.vsix` package ships only `extension.js` — no source files, no `.md` files

A client who installs the extension gets the behaviour driven by these instructions but cannot read or copy them from their repo. The extension binary would need to be reverse-engineered to extract the strings, which is a sufficient deterrent for a proprietary professional services tool.

---

## 5. Build Time

```
╔══════════════════════════════════════════════════════════════════════╗
║              BUILD TIME  —  pnpm build → esbuild                     ║
╚══════════════════════════════════════════════════════════════════════╝

  devops/instructions/deployment.md       ──┐
  devops/instructions/org-impact-…        ──┤  tsup.config.ts:
  devops/standards/apex.md                ──┤  loader: { ".md": "text" }
  devops/standards/lwc.md                 ──┤
  templates/design.ts  (HB template)      ──┤  esbuild reads each file
  templates/build.ts   (HB template)      ──┤  at build time and embeds
  ...all source files...                  ──┘  content as JS string literals

                                    ▼

              ┌──────────────────────────────────────┐
              │          extension.js  (544 KB)       │
              │      inside slalom-sdlc-0.1.0.vsix    │
              │                                       │
              │  deploymentStr      = "# Sandbox…"   │  ← baked in
              │  orgImpactStr       = "# Salesforce…"│  ← baked in
              │  apexMdStr          = "# Apex Stand…"│  ← baked in
              │  designTemplate     = "## Step 0 — …"│  ← baked in
              └──────────────────────────────────────┘

                                    │  distributed to client
                                    ▼

              ┌──────────────────────────────────────┐
              │   Client VS Code  (installs .vsix)   │
              │   No instruction files on disk.       │
              │   All content lives in extension.js.  │
              └──────────────────────────────────────┘
```

The build pipeline is:

```
pnpm --filter @sdlc/core build     →  packages/core/dist/index.js
pnpm --filter slalom-sdlc build    →  packages/vscode/dist/extension.js
vsce package --no-dependencies     →  packages/vscode/slalom-sdlc-0.1.0.vsix
```

The VS Code extension's `esbuild.mjs` bundles `packages/vscode/src/extension.ts` and its `@sdlc/core` dependency into a single `dist/extension.js`. The `--no-dependencies` flag on `vsce package` prevents vsce from trying to bundle `node_modules` (esbuild has already inlined everything needed).

---

## 6. Runtime Flow

```
╔══════════════════════════════════════════════════════════════════════╗
║          RUNTIME — @slalom-sdlc /design KAN-42                       ║
╚══════════════════════════════════════════════════════════════════════╝

  ┌──────────────────────────────────────────────────────────────┐
  │  VS Code Chat Panel                                          │
  │  User: @slalom-sdlc /design KAN-42                          │
  └──────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
                   handleAgent("design", …)
                             │
            ┌────────────────┴────────────────┐
            │                                 │
            ▼                                 ▼
    requireConfig()                   designTemplate  (Handlebars string)
    reads .sdlc/config.json           ┌────────────────────────────┐
    ┌───────────────────┐             │ ## Step 2 — Org discovery  │
    │ paths.artifacts   │             │                            │
    │ paths.standards   │             │ {{{instructions            │
    │ team.sprintLen    │             │    .orgImpactAssessment}}} │
    │ project.jiraKey   │             │                            │
    │ alm / statusMap   │             │ Follow {{paths.standards}} │
    └────────┬──────────┘             │ /apex.md for Apex work…   │
             │                        └──────────────┬─────────────┘
             └──────────────┬──────────────────────────┘
                            │
                            ▼
                     renderPrompt()
            ┌────────────────────────────────┐
            │  Handlebars.compile()          │
            │                               │
            │  {{paths.standards}}          │  →  "devops/standards"
            │                               │
            │  {{{instructions              │  →  full 150-line procedure
            │     .orgImpactAssessment}}}   │     text inlined here
            └──────────────┬────────────────┘
                           │
                           ▼
            ┌────────────────────────────────┐
            │   resolved prompt string       │  fully rendered, ~3000 words
            │   (plain markdown text)        │  no placeholders remaining
            └──────────────┬────────────────┘
                           │
              model.sendRequest([
                Message("…resolved prompt…"),   ← full system instructions
                Message("KAN-42")               ← user input
              ])
                           │
                           ▼
            ┌────────────────────────────────┐
            │    GitHub Copilot / LLM        │
            │                               │
            │  receives all instructions    │
            │  already inlined — no files   │
            │  to read                      │
            └──────────────┬────────────────┘
                           │  streamed response
                           ▼
              stream.markdown(chunk) → chat panel
```

The critical point is that the LLM never reads files. It receives a single long message that contains the full instruction text, the project's config values already substituted, and the user's input — everything it needs in one payload.

---

## 7. Commands

### 7.1 /init

`handleInit` in `packages/vscode/src/handlers/init.ts`.

Runs an interview wizard (VS Code `showInputBox` / `showQuickPick`) to collect project configuration, then calls `scaffoldRepo()` from `@sdlc/core`.

**Reconfigure mode**: if `.sdlc/config.json` already exists, the wizard pre-populates from the existing values and existing scaffold files are preserved rather than overwritten.

What `scaffoldRepo()` writes to the client repo:

```
.sdlc/config.json               project configuration
.vscode/mcp.json                Salesforce + PM tool MCP (Atlassian for JIRA, Azure DevOps for ADO)
devops/standards/               full coding standards library
  apex.md
  lwc.md
  configuration.md
  data-model.md
  git.md
  omniscript.md
  ux-accessibility.md
  README.md
artifacts/
  00 - Project/
  00 - Inbox/
  00 - Registers/
  01 - Sessions/
  02 - Current State/
  03 - Future State/
  04 - Backlog/
    pushed/
  06 - Reference/
  releases/                     (only if release phase is enabled)
force-app/frameworks/
  trigger-framework/classes/    README placeholder
```

What `scaffoldRepo()` does **not** write: `devops/instructions/` — the agent procedure files stay inside the binary.

---

### 7.2 /about

`extension.ts` handles this directly — it streams a static markdown constant (`ABOUT_TEXT`) without invoking the LLM. This is intentional: the about text is fixed documentation, not a generated response.

---

### 7.3 Phase Commands

All phase commands (`discover`, `refine`, `design`, `build`, `test`, `release`) are handled by `handleAgent` in `packages/vscode/src/handlers/agent.ts`.

The handler:

1. Reads `.sdlc/config.json` via `requireConfig()` — aborts with a helpful message if no config is found
2. Calls `renderPrompt(command, config)` to produce the fully resolved instruction string
3. Extracts a story key from the user's message using `resolveProjectKey(config)` as the pattern anchor — a JIRA key such as `KAN-42`, or an Azure DevOps work-item ID such as `#42` for ADO projects
4. Substitutes any `{STORY-KEY}` literals in the rendered prompt
5. Sends two messages to the LLM: the resolved prompt, then the user's original input
6. Streams the LLM response back to the chat panel

```typescript
const messages = [
  vscode.LanguageModelChatMessage.User(systemPrompt),  // full rendered instructions
  vscode.LanguageModelChatMessage.User(userMessage),   // "KAN-42" or whatever the user typed
];
const response = await model.sendRequest(messages, {}, token);
for await (const chunk of response.text) {
  stream.markdown(chunk);
}
```

---

## 8. SDLC Phases

The extension maps each phase to a Handlebars template. Templates define the agent's persona, its step-by-step procedure, and its expected outputs.

| Command | Persona | Key outputs |
|---|---|---|
| `/discover` | Solution Architect / BA | Discovery hub, evidence-backed backlog (Excel + markdown), push to the PM tool |
| `/refine` | SA / Functional Lead / BA | Gherkin AC on the story, `refinement-notes.md` |
| `/design` | Technical Architect / Tech Lead | `sf-discovery.md`, `solution-design.md`, PM-tool sub-tasks |
| `/build` | Developer | Apex / LWC / config metadata, deployed to sandbox, PR raised, `implementation-record.md` |
| `/test` | QA / Developer | Test classes, JEST tests, coverage validation |
| `/release` | Release Manager | Release notes, deployment checklist, PM-tool transitions |

Each template follows the same structural pattern:

- **Step 0** — prerequisite gate (PM-tool status check, local artifact scan, resume check)
- **Steps 1–N** — phase-specific work
- **Final step** — local artifacts written, then PM-tool updates proposed and confirmed before any changes are made

The local-first, review-then-approve pattern is non-negotiable: the agent always writes files and presents them to the user before touching the PM tool.

---

## 9. Configuration Schema

`.sdlc/config.json` is validated against a Zod schema on every command invocation. The shape is:

```typescript
{
  version: string,
  generatedAt: string,
  toolVersion: string,

  project: {
    name: string,
    // Legacy JIRA fields — optional and deprecated. Retained for backward
    // compatibility with configs written before the `alm` block existed.
    // New configs carry the equivalents under `alm` instead.
    jiraKey?: string,        // e.g. "KAN"
    jiraSite?: string,       // e.g. "https://myco.atlassian.net"
    jiraEmail?: string,
  },

  // PM-tool ("ALM") configuration — a discriminated union on `tool`.
  // Chosen at /init. When absent, the tool defaults to JIRA using the legacy
  // project.jira* fields above.
  alm?:
    | { tool: "JIRA", site?: string, projectKey?: string, email?: string }
    | { tool: "ADO",  organization: string, project: string },

  phases: Array<"discover" | "refine" | "design" | "build" | "test" | "release">,

  team: {
    sprintLengthWeeks: number,    // 1–4
    estimationApproach: "ta-assigns" | "team-vote" | "both",
  },

  salesforce: {
    orgs: {
      sandbox: string,     // SF CLI org alias
    },
  },

  standards: {
    apexCoverageThreshold: number,   // default 85
  },

  // Status map for JIRA projects (alm.tool === "JIRA"). Optional.
  jira?: {
    statusMap: {
      story: {
        backlog, refineInProgress, readyForDesign, designInProgress,
        readyForBuild, inDevelopment, readyForTest, done
      },
      epic: { notStarted, inProgress, done },
      subTask: { todo, inDevelopment, readyForTest, done },
    },
  },

  // Status map for Azure DevOps projects (alm.tool === "ADO"). Optional.
  // Same story/epic/subTask shape, mapped to ADO state names.
  ado?: {
    statusMap: {
      story: { /* … same keys as jira.statusMap.story … */ },
      epic:  { notStarted, inProgress, done },
      subTask: { todo, inDevelopment, readyForTest, done },
    },
  },

  branching: "gitflow",

  paths: {
    artifacts: string,     // default "artifacts"
    standards: string,     // default "devops/standards"
    forceApp:  string,     // default "force-app"
  },
}
```

The active PM tool is resolved with the `resolveAlmTool(config)` helper (falls back to `"JIRA"` when `alm` is absent), and a display-safe identifier with `resolveProjectKey(config)` (the ADO project name, the JIRA project key, or the legacy `project.jiraKey`). Status-map values are client-configurable because status names vary per project. The Handlebars templates reference the resolved status map so the correct names flow through to every agent prompt automatically, regardless of which PM tool is in use.

---

## 10. MCP Integration

The extension scaffolds `.vscode/mcp.json` on `/init` with two MCP server definitions. These are read by VS Code Copilot and make the corresponding tools available to the LLM during a chat session.

```json
{
  "servers": {
    "Salesforce_DX": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y", "@salesforce/mcp",
        "--orgs", "DEFAULT_TARGET_ORG",
        "--toolsets", "orgs,metadata,data,users",
        "--tools", "run_apex_test",
        "--allow-non-ga-tools"
      ]
    },
    "atlassian": {
      "type": "http",
      "url": "https://mcp.atlassian.com/v1/mcp"
    }
  }
}
```

**Salesforce MCP** (`@salesforce/mcp`) — runs as a local `npx` child process. Exposes tools for querying org metadata, running Apex tests, and managing deployments. Uses the Salesforce CLI's current authenticated org (`DEFAULT_TARGET_ORG`).

**Atlassian MCP** (`https://mcp.atlassian.com/v1/mcp`) — connects via HTTP. On first use VS Code prompts the user to authorise with their Atlassian account via OAuth. After authorisation, the LLM can read JIRA stories, transition statuses, and read Confluence pages without any API key configuration.

**Azure DevOps MCP** (for ADO projects) — when `alm.tool === "ADO"`, the scaffold writes the `ado` (`@azure-devops/mcp`) server entry into `.vscode/mcp.json` instead of `atlassian`, using the org name extracted from `alm.organization`. The prompt templates reference ADO MCP tools by capability — listing work-item-type fields, creating Epics/User Stories, and linking children to parents.

The agent prompt templates reference the active PM tool's MCP in their instructions — for example the design agent uses the Salesforce MCP to inspect live org metadata and the PM tool MCP to fetch story context and create sub-tasks.

### Discovery skills that write to the PM tool (`push-backlog`, `sync-pm`)

MCP tools are only exposed when Copilot runs in **agent mode**; a plain `model.sendRequest()` call has no tool access. The two discovery skills that must call the PM tool MCP — `push-backlog` and the renamed `sync-pm` (formerly `sync-jira`) — therefore do **not** execute inline. Instead the discover handler builds a context-enriched prompt (rendered template + injected project config + the user's request) and opens it in the Copilot Chat panel via `workbench.action.chat.open` with `isPartialQuery: true`, so the user can confirm agent mode and the correct MCP (Atlassian for JIRA, Azure DevOps for ADO) before pressing Enter. As a fallback, the same prompt is persisted to `.sdlc/prompts/{skill}.md` so it survives if the chat panel can't be opened. `push-backlog` builds a three-tier Epic → Feature → Story hierarchy for JIRA and a two-tier Epic → Story hierarchy for ADO, writing the resulting identifier back to the workbook's single **PM Key** column (and the manifest's `pmKey` field).

---

## 11. Greenfield vs Brownfield

Every phase template supports two operating modes detected automatically from the presence of local artifact files.

| Signal | Mode | Behaviour |
|---|---|---|
| `artifacts/{STORY-KEY}/` exists with files | **Greenfield** | Local files are the primary context source |
| No local artifact directory | **Brownfield** | Full context is gathered from JIRA and Confluence |

**Greenfield** — the story was created through the `/discover` and `/refine` agents in this repo. Artifact files (`refinement-notes.md`, `sf-discovery.md`, `solution-design.md`) provide rich local context. JIRA is used for status checking and updates only.

**Brownfield** — the story exists on a JIRA board from a live or legacy system. There are no local artifacts. The agent works through a structured context-gathering chain:

```
1. JIRA story      — description, AC, comments, attachments, labels, history
2. Parent epic     — goal, linked Confluence pages, sibling stories and their statuses
3. Linked issues   — blocks/is-blocked-by relationships, dependency status
4. Confluence      — existing solution designs, architecture decisions, process maps
5. User prompt     — ask the user if none of the above yields enough context
```

The design agent additionally prompts the user before proceeding:

> "⚠️ KAN-42 is currently in 'In Progress' status rather than Ready for Design. For a brownfield story this may be expected — proceeding with design. Confirm if you'd like to continue."

For brownfield solution designs, an additional **Delta from current state** section is required — explicitly listing what is changing, what is being added, and what is being deprecated, so the developer understands the before/after clearly.

---

## 12. Standards vs Instructions

Two categories of content are bundled into the extension. They have different purposes and different distribution rules.

### Development Standards (`devops/standards/`)

Coding standards that define *how to write code* on Slalom Salesforce projects:

- `apex.md` — Apex coding patterns, trigger framework rules, test requirements
- `lwc.md` — LWC component structure, JEST requirements, accessibility
- `configuration.md` — Flow, validation rule, custom metadata conventions
- `data-model.md` — Object, field, and relationship naming conventions
- `git.md` — Branch naming, commit message format, PR conventions
- `omniscript.md` — OmniStudio development standards
- `ux-accessibility.md` — WCAG compliance, SLDS usage
- `README.md` — Standards index

These are **scaffolded to every client repo** by `/init`. They live in `devops/standards/` on disk in the client's project so developers can read and reference them directly.

### Agent Instructions (`devops/instructions/`)

Procedure files that define *how the AI agent should behave* at specific points:

- `deployment.md` — Sandbox access, authentication, metadata deployment procedure
- `org-impact-assessment.md` — How to assess a proposed solution design against a live Salesforce org (connect to org, discover automation conflicts, report blocking risks, validate design against findings)

These are **Slalom IP** and are **never written to client repos**. They are imported in `engine.ts` at build time via the esbuild text loader and embedded as string constants in `extension.js`. At runtime they are injected into the Handlebars context as `instructions.deployment` and `instructions.orgImpactAssessment`, and inlined into the rendered prompt via `{{{instructions.*}}}`.

The LLM receives the full procedure text directly in its message payload. From the LLM's perspective, the instructions were always just part of the prompt.

---

## 13. What Lives Where

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                      WHAT LIVES WHERE                                            ║
╚══════════════════════════════════════════════════════════════════════════════════╝

  ┌─────────────────────────┬──────────────────────┬──────────────────────────┐
  │                         │   Slalom repo        │   Client repo            │
  │                         │   (internal)         │   (after /init)          │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Agent instructions      │ devops/instructions/ │ ✗ never written          │
  │ deployment,             │ (source of truth)    │   lives in .vsix only    │
  │ org-impact-assessment   │                      │                          │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Coding standards        │ devops/standards/    │ ✓ devops/standards/      │
  │ apex, lwc, data-model…  │ (source of truth)    │   copied on /init        │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Phase prompts /         │ packages/core/src/   │ ✗ never written          │
  │ Handlebars templates    │ templates/*.ts       │   compiled into .vsix    │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Project config          │ ✗                    │ ✓ .sdlc/config.json      │
  │                         │                      │   written on /init       │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ MCP config              │ ✗                    │ ✓ .vscode/mcp.json       │
  │                         │                      │   written on /init       │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ SDLC Artifacts          │ ✗                    │ ✓ artifacts/{STORY}/     │
  │ discovery, design,      │                      │   written by agents      │
  │ implementation records  │                      │   during SDLC phases     │
  └─────────────────────────┴──────────────────────┴──────────────────────────┘
```

---

## 14. Instruction Sync

The extension ships all instruction templates compiled into its bundle as a permanent fallback. A daily background sync can pull updated instruction bundles from GitHub Releases without requiring a new VSIX install.

### 14.1 Template Resolution Order

Every call to `renderPrompt(phase, config, { cacheDir })` applies this precedence:

1. **Remote cache** — `~/.slalom-sdlc/instructions-cache/current/{phase}.md` (downloaded from GitHub Releases)
2. **Bundled constant** — TypeScript string baked into the extension at build time

The same fallback applies to the two embedded instruction files (`deployment.md`, `org-impact-assessment.md`). Prompt rendering never fails due to a sync error.

### 14.2 Authentication

The VS Code extension reuses the user's existing GitHub login. Background syncs are silent; the manual sync command may prompt once for sign-in / scope:

| Priority | Source | Context |
|---|---|---|
| 1 | `vscode.authentication.getSession('github', ['repo'], { silent: true })` — background sync (reuse existing session only, never prompts) | VS Code (Copilot users) |
| 1 | `vscode.authentication.getSession('github', ['repo'], { createIfNone: true })` — manual **Sync Instructions** (may prompt once) | VS Code (Copilot users) |
| 2 | `SLALOM_SDLC_GITHUB_TOKEN` env var | Headless / CI |
| 3 | `GITHUB_TOKEN` env var | Headless / CI |
| 4 | `GH_TOKEN` env var | Headless / CI |

The GitHub token needs **read access to `Slalom/salesforce-devops` repository contents and releases** (the `repo` scope, or a fine-grained token with "Contents: Read").

MCP and CLI consumers do **not** perform GitHub auth — they read from the shared local cache written by the VS Code extension.

### 14.3 Sync Schedule

- Triggered on extension activation (non-blocking — activation never waits for sync)
- Throttled to at most once every 24 hours via `~/.slalom-sdlc/instructions-cache/metadata.json`
- Can be forced at any time via the **Slalom SDLC: Sync Instructions** Command Palette command

### 14.4 Cache Structure

```
~/.slalom-sdlc/instructions-cache/
  current/                    ← active validated instruction set
    discover.md
    refine.md
    design.md
    build.md
    test.md
    release.md
    deployment.md
    org-impact-assessment.md
    manifest.json
  metadata.json               ← { lastCheck, lastSuccessfulSync, activeVersion, lastError }
```

The `current/` directory is updated atomically (rename from a staging dir) so a failed or partial download never corrupts the active cache.

### 14.5 Manifest and Validation

Every downloaded `instructions.zip` must contain a `manifest.json`:

```json
{
  "schemaVersion": "1",
  "version": "1.2.3",
  "publishedAt": "2026-06-30T10:00:00Z",
  "files": {
    "discover.md": { "checksum": "sha256:<hex>", "size": 5213 }
  }
}
```

Before the cache is swapped live, every file listed in the manifest is validated against its SHA-256 checksum and byte size. A single mismatch aborts the update and leaves the previous cache intact.

### 14.6 Operational Commands

| Command Palette entry | What it does |
|---|---|
| **Slalom SDLC: Sync Instructions** | Force an immediate sync regardless of the 24 h window |
| **Slalom SDLC: Instruction Status** | Shows active version, last sync time, last check, and any last error |

### 14.7 Release Asset Build

Run after `pnpm -r build`:

```bash
node scripts/package-instructions.mjs --version 1.2.3
```

Outputs to `dist/release/`:

| File | Contents |
|---|---|
| `instructions.zip` | 8 instruction files + `manifest.json` |
| `manifest.json` | Standalone copy of the manifest |
| `*.vsix` | Copied from `packages/vscode/` if present |

Upload all files as assets to a GitHub Release on `Slalom/salesforce-devops`. The asset named `instructions.zip` is what the extension downloads.

---

*Built by Slalom UK&I · [salesforce-devops](https://github.com/Slalom/salesforce-devops)*
