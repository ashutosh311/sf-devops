import * as vscode from "vscode";
import { handleInit } from "./handlers/init";
import { handleAgent } from "./handlers/agent";
import { handleDiscover } from "./handlers/discover";
import { handleDesign } from "./handlers/design";
import { handleRefine } from "./handlers/refine";
import { handleForceSync, handleSyncStatus } from "./handlers/sync";
import { InstructionSyncService } from "./sync";
import { maybeShowSyncNudge } from "./syncNudge";

export function activate(context: vscode.ExtensionContext): void {
  const syncService = new InstructionSyncService();

  // Kick off a background sync on activation — fire and forget, never blocks activation.
  // Once it settles, check whether sync is silently stuck and nudge the user if so.
  void (async () => {
    try {
      await syncService.syncIfDue(context);
    } catch {
      // errors recorded in metadata.json
    }
    try {
      await maybeShowSyncNudge(syncService, context);
    } catch {
      // never let a notification failure affect activation
    }
  })();

  const participant = vscode.chat.createChatParticipant(
    "slalom.slalom-sdlc",
    async (
      request: vscode.ChatRequest,
      chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      try {
        if (request.command === "init") {
          await handleInit(request, chatContext, stream);
        } else if (request.command === "about") {
          stream.markdown(buildAboutText(context, syncService));
        } else if (request.command === "discover") {
          await handleDiscover(request, chatContext, stream, token);
        } else if (request.command === "refine") {
          await handleRefine(request, chatContext, stream, token);
        } else if (request.command === "design") {
          await handleDesign(request, chatContext, stream, token);
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

function buildAboutText(context: vscode.ExtensionContext, syncService: InstructionSyncService): string {
  const extensionVersion = context.extension.packageJSON.version as string;
  const status = syncService.getStatus();
  const instructionsLine =
    status.usingCache && status.activeVersion
      ? `${status.activeVersion} (synced ${status.lastSuccessfulSync ? new Date(status.lastSuccessfulSync).toLocaleDateString() : "unknown date"})`
      : "bundled (no remote sync yet)";

  return ABOUT_TEXT.replace("{EXTENSION_VERSION}", extensionVersion).replace(
    "{INSTRUCTIONS_STATUS}",
    instructionsLine
  );
}

const ABOUT_TEXT = `
# Slalom SDLC — AI-Assisted Delivery for Salesforce

**\`@slalom-sdlc\`** is a GitHub Copilot Chat participant that brings Slalom's Salesforce delivery process directly into VS Code. Each command activates a purpose-built AI agent that understands a specific phase of the SDLC — from discovery through to release — and works within your project's standards, JIRA board, and Salesforce org without you having to switch context.

**Extension version:** {EXTENSION_VERSION} · **Instructions:** {INSTRUCTIONS_STATUS}

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
| \`/discover\` | Discovery agent — runs a 4-phase engagement (Prepare→Learn→Ideate→Plan); use \`/discover <skill>\` for targeted tasks (e.g. \`process-session\`, \`manage-backlog\`, \`push-backlog\`) |
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

## Discovery Skills (\`/discover <skill>\`)

The discovery agent has targeted sub-commands. Run \`/discover\` on its own to be guided, or jump straight to a skill:

| Skill | What it does |
|---|---|
| \`setup\` | Onboard project, organise inbox, initialise registers |
| \`process-session\` | Turn a workshop transcript into a session note + register entries |
| \`synthesize\` | Registers → narrative current-state document |
| \`analyze\` | Gap analysis, prioritisation, traceability |
| \`generate-backlog\` | BA-owned backlog generation flow |
| \`generate-functional-requirements\` | SA-owned update of \`functional_requirements\` only |
| \`generate-solution-comments\` | TA-owned update of \`solution_notes\` only |
| \`manage-backlog\` | Evidence → epic/story rows seeded into Excel |
| \`stories-refined\` | Backlog → per-story \`refinement-notes.md\` (business context + AC) for the design phase — no JIRA required |
| \`push-backlog\` | Excel → JIRA items + archive (⚠️ irreversible — JIRA becomes source of truth) |
| \`sync-jira\` | Pull JIRA status back as a read-only snapshot |
| \`compose-deliverable\` | Executive readout or technical handoff document |
| \`conflict-check\` | Find contradictions across registers |
| \`prep-workshop\` | Pre-session briefing materials |
| \`hub-audit\` | Phase-gate readiness check |
| \`whats-next\` | "Where are we and what's the next step?" orientation |

---

## Typical Sprint Workflow

\`\`\`
@slalom-sdlc /discover setup        ← onboard project, set up knowledge hub
@slalom-sdlc /discover process-session  ← after each workshop
@slalom-sdlc /discover manage-backlog   ← build evidence-backed backlog
@slalom-sdlc /discover push-backlog     ← push to JIRA (review Excel first)
@slalom-sdlc /discover stories-refined  ← backlog → refinement-notes.md (no JIRA needed)
@slalom-sdlc /refine PROJ-42        ← refine each story before the sprint (JIRA)
@slalom-sdlc /design PROJ-42        ← technical design, produces solution-design.md
@slalom-sdlc /build PROJ-42         ← scaffold, test, deploy, raise PR
@slalom-sdlc /test PROJ-42          ← test coverage and validation
@slalom-sdlc /release               ← release notes and deployment checklist
\`\`\`

---

## Project Layout (after \`/init\`)

\`\`\`
.vscode/
  mcp.json                  ← Atlassian MCP (OAuth)
.sdlc/
  config.json               ← project config written by /init
artifacts/
  discovery/
    00 - Project/           ← project overview, phase context, timeline
    00 - Inbox/             ← drop raw files here first
    00 - Registers/         ← pain points, stakeholders, systems, RAID
    01 - Sessions/          ← processed workshop notes
    02 - Current State/     ← synthesized narratives
    03 - Future State/      ← solution directions, MVP scope
    04 - Backlog/           ← Backlog Tracker.xlsx + epic-story-list.md
      pushed/               ← archived Excel after JIRA push
    06 - Reference/         ← client docs, handover materials
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
