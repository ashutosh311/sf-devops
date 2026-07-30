# Slalom AI SDLC — Quick-Start Guide

## Purpose

The Slalom AI SDLC tool embeds Slalom UK&I's Salesforce delivery methodology directly into developer workflows. It provides a suite of AI agents—one per delivery phase—that guide teams from initial discovery through to production release, enforcing coding standards and managing project-management (PM) tool transitions without context-switching.

The tool is **PM-tool agnostic**: it works with either **JIRA (Atlassian)** or **Azure DevOps (ADO)**. You choose your PM tool once when you run `/init`, and every agent adapts automatically — status names, work-item hierarchy, and the MCP it talks to.

The tool runs as a GitHub Copilot chat participant inside VS Code. You invoke it by tagging `@slalom-sdlc` in the Copilot chat panel and running a phase command. Agents are phase-gated: each has a defined scope and will not cross into adjacent phases, ensuring clean handovers and traceable artefacts.

---

## Step 1 — Install VS Code

If you do not already have VS Code installed:

1. Go to [https://code.visualstudio.com](https://code.visualstudio.com) and download the installer for your operating system.
2. Run the installer and follow the prompts.
3. Open VS Code once installation is complete.

> VS Code 1.90 or later is required.

---

## Step 2 — Install the Salesforce Extension Pack

The Salesforce Extension Pack adds Apex syntax highlighting, code completion, org management, and deployment tooling to VS Code.

1. Open the Extensions panel (`Cmd+Shift+X` on Mac, `Ctrl+Shift+X` on Windows/Linux).
2. Search for **Salesforce Extension Pack**.
3. Click **Install** on the result published by Salesforce.
4. Reload VS Code when prompted.

This installs several extensions together, including Apex language support and the Salesforce CLI integration.

---

## Step 3 — Install Salesforce CLI

The Salesforce CLI (`sf`) is a command-line tool for authenticating to orgs, deploying metadata, and running tests. The SDLC tool uses it to interact with your sandbox.

**Mac:**
```bash
brew install sf
```

**Windows / Linux:** Download the installer from [https://developer.salesforce.com/tools/salesforcecli](https://developer.salesforce.com/tools/salesforcecli).

Verify the install by opening a terminal and running:
```bash
sf --version
```

### Authenticate your sandbox

Run the following to log in to your development sandbox and give it an alias:

```bash
sf org login web --alias dev --instance-url https://test.salesforce.com
```

This opens a browser login. After authenticating, the alias `dev` refers to that org in all CLI commands.

To check your authenticated orgs at any time:
```bash
sf org list
```

---

## Step 4 — Set up GitHub Copilot

The Slalom SDLC extension runs inside GitHub Copilot chat. You need an active Copilot subscription.

1. In VS Code, open the Extensions panel and search for **GitHub Copilot**.
2. Install both **GitHub Copilot** and **GitHub Copilot Chat** (published by GitHub).
3. Click the Copilot icon in the activity bar and sign in with your GitHub account.
4. Confirm your subscription is active — if your organisation provides Copilot licences, your account needs to be assigned one.

Once signed in, you can open the Copilot Chat panel with `Ctrl+Alt+I` (Mac: `Cmd+Alt+I`) or via the chat icon in the activity bar.

---

## Step 5 — Set up your PM tool MCP Server

The SDLC tool connects to your PM tool to read story details and update work-item statuses. This is done via an MCP (Model Context Protocol) server. Which server you need depends on the PM tool you select in `/init`.

After running `/init` (Step 7), a file `.vscode/mcp.json` will be created in your project repository. VS Code reads this file automatically.

### JIRA (Atlassian) projects

`/init` writes the **Atlassian** MCP server into `.vscode/mcp.json` for you. To connect:

1. Open the Copilot Chat panel in VS Code.
2. Click the **Tools** icon (plug icon) at the bottom of the chat input.
3. Find the **Atlassian** MCP server in the list and click **Connect**.
4. A browser window will open asking you to authorise access to your Atlassian account. Log in and approve.

Once connected, the SDLC agents can read your JIRA board and update ticket statuses as stories move through phases.

> If the Atlassian server does not appear in the Tools list, confirm that `.vscode/mcp.json` exists in your project root and that VS Code has reloaded since it was created.

### Azure DevOps (ADO) projects

ADO uses the **Azure DevOps MCP** server. Add it to the `servers` block of `.vscode/mcp.json` (alongside the Salesforce server that `/init` writes), then connect it from the **Tools** icon in Copilot Chat the same way. Refer to your Azure DevOps MCP provider's setup for the exact server entry and authentication (typically a Personal Access Token with work-item read/write scope for your organisation).

> Only the two discovery skills that write to your PM tool — `push-backlog` and `sync-pm` — require the PM tool MCP. Every other agent and skill works without it.

---

## Step 6 — Install the Slalom SDLC Extension

1. Obtain the `slalom-sdlc-*.vsix` file from your delivery lead or technical architect.
2. Open the Extensions panel in VS Code (`Cmd+Shift+X` / `Ctrl+Shift+X`).
3. Click the `...` menu in the top-right corner of the Extensions panel.
4. Select **Install from VSIX…** and choose the file.
5. Reload VS Code when prompted.

Verify the install by opening the Copilot Chat panel and typing:

```
@slalom-sdlc /about
```

You should see a help message describing the available commands.

> **Instructions stay up to date automatically.** The methodology that drives each agent is compiled into the extension and refreshed daily in the background from the `Slalom/salesforce-devops` GitHub repository, using your existing VS Code GitHub login. No reinstall is needed when Slalom improves a phase. If you have no GitHub access (for example, a client team), the instructions bundled into your VSIX are used as-is and work fully offline. See [Keeping Instructions Up to Date](#keeping-instructions-up-to-date) below.

---

## Step 7 — Initialise Your Project (`/init`)

Run the setup wizard once per project. This creates the project configuration file, fetches the Slalom coding standards, and sets up the artefact folder structure in your repository.

Open the Copilot Chat panel and run:

```
@slalom-sdlc /init
```

The wizard will ask for the following. It first asks which **PM tool** you use, then only the fields relevant to that tool:

| Setting | Applies to | Example |
|---|---|---|
| Project / client name | Both | Acme Corp |
| **PM tool** | Both | JIRA (Atlassian) / Azure DevOps |
| JIRA project key | JIRA | ACME |
| JIRA site URL | JIRA | https://acme.atlassian.net |
| JIRA account email | JIRA | you@acme.com |
| Azure DevOps org URL | ADO | https://dev.azure.com/acme |
| Azure DevOps project name | ADO | MyProject |
| Salesforce sandbox alias | Both | `dev` (as shown in `sf org list`) |
| Sprint length (weeks) | Both | 2 |
| Estimation approach | Both | Team vote / TA assigns / Both |
| Apex coverage threshold | Both | 85% |
| Status names | Both | Matching names from your board (one per phase) — accept the defaults or customise |

After completion, the following is created in your project repository:

```
.sdlc/config.json          ← project configuration (includes your PM tool choice)
.vscode/mcp.json           ← Salesforce + PM tool MCP (Atlassian for JIRA / Azure DevOps for ADO)
artifacts/                 ← discovery and story artefacts (agent outputs go here)
devops/standards/          ← Apex, LWC, configuration, git, and UX standards
```

Commit all of these to source control — they are shared across the team.

---

## Usage — Running the Agents

Invoke agents in the Copilot Chat panel by tagging `@slalom-sdlc` followed by the phase command. Run them in order as a story moves through the board.

| Phase | Command | What it produces |
|---|---|---|
| Discovery | `/discover` | Discovery hub artefacts, evidence-backed backlog (Excel + markdown), and a push to your PM tool |
| Refinement | `/refine <STORY-KEY>` | Gherkin acceptance criteria, INVEST validation, effort estimate |
| Design | `/design <STORY-KEY>` | Org discovery, solution design doc, sub-tasks in your PM tool |
| Build | `/build <STORY-KEY>` | Apex / LWC scaffolding, deployment to sandbox |
| Test | `/test <STORY-KEY>` | Apex test classes, Jest tests, coverage validation |
| Release | `/release` | Deployment runbook, handover checklist, PM-tool transitions |

**Example for story ACME-42:**

```
@slalom-sdlc /refine ACME-42
```
```
@slalom-sdlc /design ACME-42
```
```
@slalom-sdlc /build ACME-42
```

Replace `ACME-42` with the work-item key of the story you are working on (a JIRA key such as `ACME-42`, or an ADO work-item ID such as `#42`).

### Pushing the discovery backlog to your PM tool

Inside `/discover`, two skills write to your PM tool: **`push-backlog`** (create/update epics and stories) and **`sync-pm`** (pull current status back as a read-only snapshot). Because MCP tools are only available when Copilot runs in **agent mode**, these two skills don't run inline — instead the agent **pre-fills the Copilot Chat panel** with a context-enriched prompt. Before pressing Enter:

1. Switch to the **Copilot Chat** panel (it is brought into focus for you).
2. Make sure **Agent mode** is selected (not Ask or Edit).
3. Confirm the correct PM tool MCP is listed in the tools section — **Atlassian** for JIRA, **Azure DevOps** for ADO.

Then press **Enter** to run. If the chat panel can't be opened automatically, the prompt is saved to `.sdlc/prompts/{skill}.md` and you're shown how to run it manually in agent mode.

> **PM tool differences.** `push-backlog` builds a three-tier **Epic → Feature → Story** hierarchy in JIRA, and a two-tier **Epic → Story** hierarchy in Azure DevOps (ADO has no Feature tier in this workflow). The backlog workbook uses a single **PM Key** column that holds either a JIRA key or an ADO work-item ID once pushed.

---

## Keeping Instructions Up to Date

Slalom's delivery methodology improves over time. The instructions that drive each agent are **never written into your project** — they live inside the extension and refresh automatically, so you stay on the latest best practice without reinstalling.

| What | How it works |
|---|---|
| **Automatic refresh** | On startup the extension silently checks (at most once every 24 hours) for a newer instruction release on `Slalom/salesforce-devops`. If found, it downloads, verifies checksums, and activates it atomically. |
| **Offline fallback** | If there is no internet, GitHub access, or sign-in, the instructions compiled into your installed VSIX are used. Your work is never interrupted. |
| **Authentication** | Background refresh reuses your existing VS Code GitHub login silently. The first time you run **Slalom SDLC: Sync Instructions** manually, VS Code may prompt you once to sign in / grant repository access. |

Two commands are available from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | What it does |
|---|---|
| **Slalom SDLC: Instruction Status** | Shows the active instruction version, last sync time, and any errors |
| **Slalom SDLC: Sync Instructions** | Forces an immediate refresh without waiting for the 24-hour window |

> **For client / non-Slalom teams:** a VSIX works fully offline. The instructions bundled into the build you were given are available immediately — no GitHub access or internet connection is required, and the sync simply does nothing.

---

## Agent Boundaries

Each agent has a defined remit and will not take actions outside its phase.

| Agent | In scope | Out of scope |
|---|---|---|
| `/refine` | Acceptance criteria, INVEST validation, effort estimate | Technical decisions, code |
| `/design` | Org discovery, solution design, PM-tool sub-tasks | Implementation code, deployments |
| `/build` | Code scaffolding, deployment to sandbox | Refinement, design changes |
| `/test` | Test generation, coverage validation | Implementation changes |
| `/release` | Deployment runbook, PM-tool transitions | Code generation, testing |

---

## Coding Standards Summary

The standards scaffolded into `devops/standards/` are enforced by the build and test agents. Key rules:

- **Triggers** — one per SObject, all events declared in a single trigger, one handler call
- **Logging** — `Logger.info/warn/error()` only; no `System.debug`
- **SOQL** — in Selector classes only; never inline
- **DML** — via `UnitOfWork` only; never direct
- **Feature flags** — `FeatureToggle__mdt` custom metadata; no hardcoded conditionals
- **Test classes** — non-DML pattern, `StubBuilder` mocks, bulk tested at 200 records, ≥85% coverage
- **Commits** — Conventional Commits format: `type(scope): summary` (72 chars max)
- **Branches** — `type/JIRA-KEY-description` (e.g. `feat/ACME-42-opportunity-trigger`)

Full detail is in `devops/standards/` after running `/init`.

---

## Where Artefacts Live

All agent outputs are written to the `artifacts/` folder at the root of your project repository and should be committed to source control — they serve as the delivery record.

```
artifacts/
├── 00 - Project/          # Project overview, timeline, phase context
├── 00 - Inbox/            # Drop raw workshop transcripts/notes here
├── 00 - Registers/        # Pain points, systems, stakeholders, RAID
├── 01 - Sessions/         # Processed workshop notes
├── 02 - Current State/    # Synthesised narratives, process diagrams
├── 03 - Future State/     # Solution directions, MVP scope
├── 04 - Backlog/          # Backlog Tracker.xlsx, epics, stories
│   └── stories/
│       └── EPIC-1/
│           └── ACME-42/
│               ├── refinement-notes.md
│               └── solution-design.md
├── 06 - Reference/        # Client documents, handover materials
└── ACME-42/               # Story-level outputs (sf-discovery, design, tests)
    ├── sf-discovery.md
    ├── solution-design.md
    ├── package.xml
    ├── implementation-record.md
    ├── test-plan.md
    └── test-results.md
```

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `@slalom-sdlc` not appearing in chat | Reload VS Code; confirm the extension shows as enabled in the Extensions panel |
| `/init` fails to fetch standards | Confirm you have access to the `Slalom/salesforce-devops` GitHub repository |
| Instructions out of date / sync failing | Run **Slalom SDLC: Instruction Status** from the Command Palette. If sign-in is needed, run **Slalom SDLC: Sync Instructions** and approve the GitHub prompt |
| PM tool status updates not working | Re-connect your PM tool MCP (Atlassian for JIRA, Azure DevOps for ADO) via the Tools icon in Copilot Chat |
| PM tool MCP not in Tools list | Confirm `.vscode/mcp.json` exists and reload VS Code. For ADO, confirm you added the Azure DevOps MCP server entry (it is not scaffolded automatically) |
| `push-backlog` / `sync-pm` say no tools available | These run in **agent mode** — switch the pre-filled Copilot Chat to Agent mode and confirm the PM tool MCP is connected before pressing Enter |
| Sandbox deploy fails | Run `sf org list` and confirm the alias in `.sdlc/config.json` is correct |
| Copilot Chat not responding | Confirm your GitHub Copilot subscription is active and you are signed in |
