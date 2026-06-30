import * as vscode from "vscode";
import { handleInit } from "./handlers/init";
import { handleAgent } from "./handlers/agent";
import { handleForceSync, handleSyncStatus } from "./handlers/sync";
import { InstructionSyncService } from "./sync";

export function activate(context: vscode.ExtensionContext): void {
  const syncService = new InstructionSyncService();

  // Kick off a background sync on activation — fire and forget, never blocks
  syncService.syncIfDue(context).catch(() => { /* errors recorded in metadata.json */ });

  const participant = vscode.chat.createChatParticipant(
    "slalom-sdlc",
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      try {
        if (request.command === "init") {
          await handleInit(request, chatContext, stream, context);
        } else if (request.command === "about") {
          stream.markdown(ABOUT_TEXT);
        } else {
          await handleAgent(request, chatContext, stream, token);
        }
      } catch (err) {
        stream.markdown(`⛔ Unexpected error: ${String(err)}`);
      }
    }
  );

  participant.iconPath = new vscode.ThemeIcon("rocket");

  context.subscriptions.push(
    participant,
    vscode.commands.registerCommand("slalom-sdlc.syncInstructions", () =>
      handleForceSync(syncService, context)
    ),
    vscode.commands.registerCommand("slalom-sdlc.instructionStatus", () =>
      handleSyncStatus(syncService)
    )
  );
}

export function deactivate(): void {}

const ABOUT_TEXT = `
# Slalom SDLC — AI-Assisted Delivery for Salesforce

**\`@slalom-sdlc\`** is a GitHub Copilot Chat participant that brings Slalom's Salesforce delivery process directly into VS Code. Each command activates a purpose-built AI agent that understands a specific phase of the SDLC — from discovery through to release — and works within your project's standards, JIRA board, and Salesforce org without you having to switch context.

---

## Prerequisites

- VS Code with **GitHub Copilot** (active subscription)
- A Salesforce project folder open in VS Code
- Atlassian account access to your JIRA project (OAuth login on first use — no tokens needed)
- Salesforce CLI (\`sf\`) installed for build and deployment commands

---

## Getting Started

**First time on a project:**

\`\`\`
@slalom-sdlc /init
\`\`\`

This walks you through a short setup (project name, JIRA key, sprint config, org alias) and scaffolds your project with:
- Development standards (\`devops/standards/\`)
- Artifact directories (\`artifacts/\`)
- Trigger framework placeholder (\`force-app/\`)
- VS Code MCP config for Atlassian OAuth (\`.vscode/mcp.json\`)

Run \`/init\` again at any time to update the config — existing files are preserved.

---

## Commands

| Command | What it does |
|---|---|
| \`/about\` | Show this help |
| \`/init\` | Set up or reconfigure the SDLC for this project |
| \`/discover\` | Discovery agent — maps requirements, identifies unknowns, drafts epics and stories |
| \`/refine PROJ-42\` | Refines a JIRA story — acceptance criteria, open questions, effort estimate |
| \`/design PROJ-42\` | Technical design agent — solution approach, data model, component breakdown, sub-tasks |
| \`/build PROJ-42\` | Build agent — scaffolds Apex, LWC, config; reviews with you; deploys to your sandbox |
| \`/test PROJ-42\` | Test agent — generates test classes and JEST tests, validates coverage |
| \`/release\` | Release agent — deployment notes, checklist, JIRA transitions |

---

## How It Works

**Agents are context-aware.** Before doing anything, each agent:
1. Checks for local artifact files (\`artifacts/{STORY-KEY}/\`) first
2. Falls back to reading the JIRA story and its parent epic
3. Looks for linked Confluence pages if no local design exists
4. Asks you to point to the design if none is found

**Standards are built in.** Every agent knows and enforces the project's Apex, LWC, OmniStudio, Configuration, Data Model, Git, UX/Accessibility, and Deployment standards. You don't need to reference them — the agent checks them automatically.

**JIRA is connected via OAuth.** On first use, VS Code will prompt you to authorise with Atlassian. After that, agents can read stories, transition statuses, and check Confluence without any API keys or tokens.

**Instructions stay inside the tool.** The instructions that drive each agent are compiled into the extension — they are never written to your repo. They are refreshed daily from GitHub Releases using your existing VS Code GitHub login. Run **Slalom SDLC: Instruction Status** from the Command Palette to see the active version.

---

## Typical Sprint Workflow

\`\`\`
@slalom-sdlc /discover          ← start of sprint: map requirements, create stories
@slalom-sdlc /refine PROJ-42    ← refine each story before the sprint
@slalom-sdlc /design PROJ-42    ← technical design, produces solution-design.md
@slalom-sdlc /build PROJ-42     ← scaffold, test, deploy, raise PR
@slalom-sdlc /test PROJ-42      ← test coverage and validation
@slalom-sdlc /release           ← release notes and deployment checklist
\`\`\`

---

## Project Layout (after \`/init\`)

\`\`\`
.vscode/
  mcp.json                  ← Atlassian MCP (OAuth)
.sdlc/
  config.json               ← project config written by /init
artifacts/
  {STORY-KEY}/
    sf-discovery.md         ← discovery notes
    solution-design.md      ← technical design
    implementation-record.md← build record
devops/standards/           ← development standards (referenced by agents)
force-app/                  ← Salesforce metadata
\`\`\`

---

Built by Slalom UK&I · [salesforce-devops](https://github.com/Slalom/salesforce-devops)
`.trim();
