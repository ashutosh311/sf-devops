import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { renderPrompt, CACHE_CURRENT_DIR } from "@sdlc/core";
import { requireConfig } from "./config.js";

const STORY_KEY_SCHEMA = z.object({
  storyKey: z.string().optional().describe("JIRA story key, e.g. PROJ-42"),
});
type StoryKeyArgs = z.infer<typeof STORY_KEY_SCHEMA>;

const PHASE_DESCRIPTIONS: Record<string, string> = {
  discover: "Discovery agent — maps requirements, identifies unknowns, drafts epics and stories",
  refine:   "Refinement agent — acceptance criteria, open questions, effort estimate for a JIRA story",
  design:   "Technical design agent — solution approach, data model, component breakdown, sub-tasks",
  build:    "Build agent — scaffolds Apex, LWC, config metadata; reviews with you; deploys to sandbox",
  test:     "Test agent — generates Apex test classes and JEST tests, validates coverage",
  release:  "Release agent — deployment notes, checklist, JIRA transitions",
};

// Phases that take an optional storyKey argument
const PHASES_WITH_KEY = ["refine", "design", "build", "test"] as const;

// Phases with no arguments
const PHASES_STORYLESS = ["discover", "release"] as const;

export function registerPrompts(server: McpServer): void {
  registerAbout(server);
  registerInit(server);

  for (const phase of PHASES_STORYLESS) {
    registerStoryles(server, phase);
  }
  for (const phase of PHASES_WITH_KEY) {
    registerWithStoryKey(server, phase);
  }
}

function registerAbout(server: McpServer): void {
  server.prompt("about", "What is this tool, how to use it, and all available commands", async () => ({
    messages: [{ role: "user" as const, content: { type: "text" as const, text: ABOUT_TEXT } }],
  }));
}

function registerInit(server: McpServer): void {
  server.prompt(
    "init",
    "Set up and scaffold the SDLC for this Salesforce project",
    async () => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: INIT_PROMPT } }],
    })
  );
}

function registerStoryles(server: McpServer, phase: string): void {
  server.prompt(phase, PHASE_DESCRIPTIONS[phase], async () => {
    try {
      const { config } = await requireConfig();
      if (!config.phases.includes(phase as any)) {
        return noPhaseResponse(phase, config.phases);
      }
      const text = renderPrompt(phase, config, { cacheDir: CACHE_CURRENT_DIR });
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    } catch (err) {
      return errorResponse(err);
    }
  });
}

function registerWithStoryKey(server: McpServer, phase: string): void {
  server.prompt(
    phase,
    PHASE_DESCRIPTIONS[phase],
    STORY_KEY_SCHEMA.shape,
    async ({ storyKey }: StoryKeyArgs) => {
      try {
        const { config } = await requireConfig();
        if (!config.phases.includes(phase as any)) {
          return noPhaseResponse(phase, config.phases);
        }
        let text = renderPrompt(phase, config, { cacheDir: CACHE_CURRENT_DIR });
        if (storyKey) {
          text = text
            .replace(/\{STORY_KEY\}/g, storyKey.toUpperCase())
            .replace(/\{TICKET_KEY\}/g, storyKey.toUpperCase());
        }
        return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
      } catch (err) {
        return errorResponse(err);
      }
    }
  );
}

function noPhaseResponse(phase: string, enabledPhases: string[]) {
  return {
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: `The "${phase}" phase is not enabled for this project. Enabled phases: ${enabledPhases.join(", ")}.`,
      },
    }],
  };
}

function errorResponse(err: unknown) {
  return {
    messages: [{
      role: "user" as const,
      content: { type: "text" as const, text: `⛔ ${String(err)}` },
    }],
  };
}

// ── Static text ───────────────────────────────────────────────────────────────

const ABOUT_TEXT = `
# Slalom SDLC — AI-Assisted Delivery for Salesforce

**\`@slalom-sdlc\`** is a Claude Code MCP server that brings Slalom's Salesforce delivery process directly into your agent. Each command activates a purpose-built AI agent for a specific SDLC phase — discovery, refinement, design, build, test, and release — working within your project's JIRA board, Salesforce org, and coding standards.

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
/mcp__slalom-sdlc__init
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
| \`/mcp__slalom-sdlc__about\` | Show this help |
| \`/mcp__slalom-sdlc__init\` | Set up or reconfigure the SDLC for this project |
| \`/mcp__slalom-sdlc__discover\` | Discovery agent — maps requirements, creates epics and stories |
| \`/mcp__slalom-sdlc__refine PROJ-42\` | Refines a JIRA story — AC, open questions, effort |
| \`/mcp__slalom-sdlc__design PROJ-42\` | Technical design — solution approach, data model, sub-tasks |
| \`/mcp__slalom-sdlc__build PROJ-42\` | Build agent — scaffolds Apex/LWC/config, deploys to sandbox |
| \`/mcp__slalom-sdlc__test PROJ-42\` | Test agent — Apex test classes, JEST tests, coverage validation |
| \`/mcp__slalom-sdlc__release\` | Release agent — deployment notes, checklist, JIRA transitions |

---

## Typical Sprint Workflow

\`\`\`
/mcp__slalom-sdlc__discover          ← start of sprint: map requirements
/mcp__slalom-sdlc__refine PROJ-42    ← refine each story before the sprint
/mcp__slalom-sdlc__design PROJ-42    ← technical design, produces solution-design.md
/mcp__slalom-sdlc__build PROJ-42     ← scaffold, deploy, raise PR
/mcp__slalom-sdlc__test PROJ-42      ← test coverage and validation
/mcp__slalom-sdlc__release           ← release notes and deployment checklist
\`\`\`

---

## How It Works

Each agent reads \`.sdlc/config.json\`, renders the full instruction set for that phase (with your project's JIRA key, status names, paths, and standards already resolved), and executes the procedure using Claude Code's connected tools — including the Atlassian MCP for JIRA/Confluence and the Salesforce MCP for org operations.

**Prompts stay inside the tool.** The instructions that drive each agent are compiled into the server binary — they are never written to your repo.

---

Built by Slalom UK&I
`.trim();

const INIT_PROMPT = `
# Slalom SDLC — Project Setup

You are setting up the Slalom SDLC for a Salesforce project. Your job is to conduct a brief interview, collect the project configuration, then call the \`sdlc_scaffold\` tool to write the config and scaffold the project.

## Interview steps

Work through these in order. State which section you're on. Suggest sensible defaults.

### 1 — Project
- **Client / project name** — e.g. "Acme CRM"
- **JIRA project key** — e.g. \`ACME\` (uppercase letters/numbers only)
- **JIRA site URL** — e.g. \`https://acme.atlassian.net\`
- **Atlassian account email** — email used for JIRA/Confluence access

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

### 6 — JIRA Status Names
Ask: *"Do you want to customise JIRA status names, or use the defaults?"*
- **Use defaults** — proceed immediately, all status fields will use the built-in defaults.
- **Customise** — collect the 15 status names (story: 8 gates, epic: 3, sub-task: 4). Show the gate label next to each prompt so the user knows what each status represents.

## After collecting all answers

Check whether \`.sdlc/config.json\` already exists. If it does, inform the user this is a **reconfigure** — existing standards files and artifact directories will be preserved.

Call \`sdlc_scaffold\` with all collected values. Use the built-in defaults for any JIRA status names the user did not customise.

After scaffolding completes, summarise what was created/updated and remind the user to run \`/mcp__slalom-sdlc__discover\` to start a discovery session.
`.trim();
