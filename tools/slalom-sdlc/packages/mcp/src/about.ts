import { readSyncMetadata, validateCacheManifest, CACHE_CURRENT_DIR } from "@sdlc/core";
import { cmd } from "./surface.js";

/**
 * Static agent text that isn't rendered from a project's .sdlc/config.json —
 * the tool overview (`about`) and the setup interview (`init`). Kept out of
 * prompts.ts so both the MCP prompts and the `sdlc_prompt` tool can read it.
 */

export function buildAboutText(mcpVersion: string): string {
  const meta = readSyncMetadata(CACHE_CURRENT_DIR);
  const usingCache = validateCacheManifest(CACHE_CURRENT_DIR);
  const instructionsLine = usingCache && meta.activeVersion
    ? `${meta.activeVersion} (synced ${meta.lastSuccessfulSync ? new Date(meta.lastSuccessfulSync).toLocaleDateString() : "unknown date"})`
    : "bundled (no remote instruction sync detected \u2014 sync runs from the VS Code extension)";

  return ABOUT_TEXT
    .replace("{MCP_VERSION}", mcpVersion)
    .replace("{INSTRUCTIONS_STATUS}", instructionsLine);
}

// ── Static text ───────────────────────────────────────────────────────────────

export const ABOUT_TEXT = `
# Slalom SDLC — AI-Assisted Delivery for Salesforce

**Slalom SDLC** brings Slalom's Salesforce delivery process directly into Claude Code. Each command activates a purpose-built AI agent for a specific SDLC phase — discovery, refinement, design, build, test, and release — working within your project's work-item tool (JIRA or Azure DevOps) — or local artifacts for LOCAL projects — plus your Salesforce org and coding standards.

**MCP server version:** {MCP_VERSION} · **Instructions:** {INSTRUCTIONS_STATUS}

---

## Prerequisites

- Claude Code (CLI or IDE extension)
- A Salesforce project folder with this MCP server configured
- Atlassian account access to your JIRA project (via the Atlassian MCP)
- Salesforce CLI (\`sf\`) installed, with sandbox org authenticated

---

## Getting Started

**First time on a project:**

\`\`\`
${cmd("init")}
\`\`\`

Claude will walk you through a short setup and scaffold the project with:
- Configuration (\`.sdlc/config.json\`)
- Development standards (\`devops/standards/\`)
- Artifact directories (\`artifacts/\`)
- MCP config for Atlassian OAuth and Salesforce (\`.mcp.json\`)

---

## Commands

| Command | What it does |
|---|---|
| \`${cmd("about")}\` | Show this help |
| \`${cmd("init")}\` | Set up or reconfigure the SDLC for this project |
| \`${cmd("discover")}\` | Discovery agent — maps requirements, creates epics and stories |
| \`${cmd("refine", "PROJ-42")}\` | Refines a JIRA story — AC, open questions, effort |
| \`${cmd("design", "PROJ-42")}\` | Technical design — solution approach, data model, sub-tasks |
| \`${cmd("build", "PROJ-42")}\` | Build agent — scaffolds Apex/LWC/config, deploys to sandbox |
| \`${cmd("test", "PROJ-42")}\` | Test agent — Apex test classes, JEST tests, coverage validation |
| \`${cmd("release")}\` | Release agent — deployment notes, checklist, JIRA transitions |

---

## Typical Sprint Workflow

\`\`\`
${cmd("discover").padEnd(36)}← start of sprint: map requirements
${cmd("refine", "PROJ-42").padEnd(36)}← refine each story before the sprint
${cmd("design", "PROJ-42").padEnd(36)}← technical design, produces solution-design.md
${cmd("build", "PROJ-42").padEnd(36)}← scaffold, deploy, raise PR
${cmd("test", "PROJ-42").padEnd(36)}← test coverage and validation
${cmd("release").padEnd(36)}← release notes and deployment checklist
\`\`\`

---

## How It Works

Each agent reads \`.sdlc/config.json\`, renders the full instruction set for that phase (with your project's JIRA key, status names, paths, and standards already resolved), and executes the procedure using Claude Code's connected tools — including the Atlassian MCP for JIRA/Confluence and the Salesforce MCP for org operations.

**Prompts stay inside the tool.** The instructions that drive each agent are compiled into the server binary — they are never written to your repo.

---

Built by Slalom UK&I
`.trim();

export const INIT_DISPATCH = `
Call the \`sdlc_init\` tool with no arguments.

It runs the setup interview itself — as native input forms where the client supports
them, or by handing you the interview to conduct if it doesn't — and writes
\`.sdlc/config.json\` plus the rest of the scaffold. Don't ask the setup questions
yourself before calling it, and don't write any config file by hand.
`.trim();

export const INIT_PROMPT = `
# Slalom SDLC — Project Setup

You are setting up the Slalom SDLC for a Salesforce project. Your job is to conduct a brief interview, collect the project configuration, then call the \`sdlc_scaffold\` tool to write the config and scaffold the project.

## Interview steps

Work through these in order. State which section you're on. Suggest sensible defaults.

### 1 — Project
- **Client / project name** — e.g. "Acme CRM"
- **Where do work items live?** — present as a numbered choice:
  1. \`JIRA\` — Atlassian *(default)*
  2. \`ADO\` — Azure DevOps
  3. \`LOCAL\` — local files only, no remote work-item tool

Then ask only the follow-ups for the tool they picked:

- **JIRA** — project key (e.g. \`ACME\`, uppercase letters/numbers), site URL (e.g. \`https://acme.atlassian.net\`), Atlassian account email
- **ADO** — organisation URL (e.g. \`https://dev.azure.com/acme\`), project name
- **LOCAL** — work-item key prefix (default \`LOCAL\`, uppercase letters/numbers)

### 2 — SDLC Phases
Ask which phases are in scope. Default is all six: **discover, refine, design, build, test, release**. Confirm or let the user deselect any.

### 3 — Team
- **Sprint length** (weeks) — default: 2
- **Estimation approach** — present as a numbered choice:
  1. \`ta-assigns\` — TA/TL assigns points during design *(default)*
  2. \`team-vote\` — team votes in sprint planning
  3. \`both\` — either, decided per story

### 4 — Salesforce
- **Sandbox org alias** — the \`sf\` CLI alias (default: \`sandbox\`)

### 5 — Standards
- **Apex test coverage threshold** (%) — default: 85

### 6 — Workflow Status Names
Skip this section entirely for **LOCAL** projects — they never transition a remote work item.

Otherwise ask: *"Do you want to customise status names, or use the defaults?"*
- **Use defaults** — proceed immediately; every status falls back to the built-in default for that tool (Slalom's standard JIRA names, or Azure DevOps' Agile states).
- **Customise** — collect the 15 status names (story: 8 gates, epic: 3, sub-task: 4). Show the gate label next to each prompt so the user knows what each status represents.

## After collecting all answers

Check whether \`.sdlc/config.json\` already exists. If it does, inform the user this is a **reconfigure** — existing standards files and artifact directories will be preserved.

Call \`sdlc_scaffold\` with all collected values, including \`pmTool\`. Omit any status name the user didn't customise — the tool fills in the right default for their PM tool.

After scaffolding completes, summarise what was created/updated and remind the user to run \`${cmd("discover")}\` to start a discovery session.
`.trim();
