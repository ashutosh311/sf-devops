# Slalom AI SDLC — Quick-Start Guide

## Purpose

The Slalom AI SDLC tool embeds Slalom UK&I's Salesforce delivery methodology directly into developer workflows. It provides a suite of AI agents—one per delivery phase—that guide teams from initial discovery through to production release, enforcing coding standards and managing JIRA transitions without context-switching.

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

## Step 5 — Set up the Atlassian MCP Server

The SDLC tool connects to JIRA to read story details and update ticket statuses. This is done via an MCP (Model Context Protocol) server that handles Atlassian OAuth. You configure this once per project.

After running `/init` (Step 7), a file `.vscode/mcp.json` will be created in your project repository. VS Code reads this file automatically.

To connect:

1. Open the Copilot Chat panel in VS Code.
2. Click the **Tools** icon (plug icon) at the bottom of the chat input.
3. Find the **Atlassian** MCP server in the list and click **Connect**.
4. A browser window will open asking you to authorise access to your Atlassian account. Log in and approve.

Once connected, the SDLC agents can read your JIRA board and update ticket statuses as stories move through phases.

> If the Atlassian server does not appear in the Tools list, confirm that `.vscode/mcp.json` exists in your project root and that VS Code has reloaded since it was created.

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

---

## Step 7 — Initialise Your Project (`/init`)

Run the setup wizard once per project. This creates the project configuration file, fetches the Slalom coding standards, and sets up the artefact folder structure in your repository.

Open the Copilot Chat panel and run:

```
@slalom-sdlc /init
```

The wizard will ask for the following:

| Setting | Example |
|---|---|
| Project / client name | Acme Corp |
| JIRA project key | ACME |
| JIRA site URL | https://acme.atlassian.net |
| JIRA email address | you@acme.com |
| Salesforce sandbox alias | `dev` (as shown in `sf org list`) |
| Sprint length (weeks) | 2 |
| Estimation approach | Team vote / TA assigns / Both |
| Apex coverage threshold | 85% |
| JIRA status names | Matching names from your board (one per phase) |

After completion, the following is created in your project repository:

```
.sdlc/config.json          ← project configuration
.vscode/mcp.json           ← Atlassian MCP server config
artifacts/                 ← discovery and story artefacts (agent outputs go here)
devops/standards/          ← Apex, LWC, configuration, git, and UX standards
```

Commit all of these to source control — they are shared across the team.

---

## Usage — Running the Agents

Invoke agents in the Copilot Chat panel by tagging `@slalom-sdlc` followed by the phase command. Run them in order as a story moves through the board.

| Phase | Command | What it produces |
|---|---|---|
| Discovery | `/discover` | Capability map, epic/story list, sprint allocation plan |
| Refinement | `/refine <STORY-KEY>` | Gherkin acceptance criteria, INVEST validation, effort estimate |
| Design | `/design <STORY-KEY>` | Org discovery, solution design doc, JIRA sub-tasks |
| Build | `/build <STORY-KEY>` | Apex / LWC scaffolding, deployment to sandbox |
| Test | `/test <STORY-KEY>` | Apex test classes, Jest tests, coverage validation |
| Release | `/release` | Deployment runbook, handover checklist, JIRA transitions |

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

Replace `ACME-42` with the JIRA key of the story you are working on.

---

## Agent Boundaries

Each agent has a defined remit and will not take actions outside its phase.

| Agent | In scope | Out of scope |
|---|---|---|
| `/refine` | Acceptance criteria, INVEST validation, effort estimate | Technical decisions, code |
| `/design` | Org discovery, solution design, JIRA sub-tasks | Implementation code, deployments |
| `/build` | Code scaffolding, deployment to sandbox | Refinement, design changes |
| `/test` | Test generation, coverage validation | Implementation changes |
| `/release` | Deployment runbook, JIRA transitions | Code generation, testing |

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
├── discovery/
│   ├── capability-map.md
│   ├── epic-story-list.md
│   ├── sprint-allocation-plan.md
│   └── hl-solution-design.md
└── ACME-42/
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
| `/init` fails to fetch standards | Confirm you have access to the `sf-uki-devops` Bitbucket repository |
| JIRA transitions not working | Re-connect the Atlassian MCP server via the Tools icon in Copilot Chat |
| Atlassian server not in Tools list | Confirm `.vscode/mcp.json` exists and reload VS Code |
| Sandbox deploy fails | Run `sf org list` and confirm the alias in `.sdlc/config.json` is correct |
| Copilot Chat not responding | Confirm your GitHub Copilot subscription is active and you are signed in |
