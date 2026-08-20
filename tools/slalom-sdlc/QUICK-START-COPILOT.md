# Slalom AI SDLC — GitHub Copilot CLI / Desktop App Quick-Start

## Purpose

The Slalom AI SDLC tool embeds Slalom UK&I's Salesforce delivery methodology into your workflow as a set of custom agents. This guide covers installation for the **GitHub Copilot CLI** and **Copilot desktop app**.

> **Primary experience:** The fully supported install is the VS Code extension (`@slalom-sdlc`). The Copilot CLI / desktop pack is a supported alternative — it shares the same engine and standards.

---

## Step 1 — Install Node.js 20+

The pack runs a local MCP server that requires Node.js.

**Mac:**
```bash
brew install node
```

**Windows / Linux:** Download from [https://nodejs.org](https://nodejs.org) and run the installer. Choose the **LTS** release.

Verify:
```bash
node --version   # should print v20.x.x or higher
```

---

## Step 2 — Install Salesforce CLI

The SDLC agents use `sf` to interact with your sandbox.

**Mac:**
```bash
brew install sf
```

**Windows / Linux:** Download from [https://developer.salesforce.com/tools/salesforcecli](https://developer.salesforce.com/tools/salesforcecli).

Verify:
```bash
sf --version
```

### Authenticate your sandbox

```bash
sf org login web --alias dev --instance-url https://test.salesforce.com
```

This opens a browser login. After authenticating, `dev` refers to that org in all CLI commands.

```bash
sf org list   # confirm it appears
```

---

## Step 3 — Install GitHub Copilot CLI

If you haven't already installed the Copilot CLI, install it via npm:

```bash
npm install -g @githubnext/github-copilot-cli
```

Or follow the instructions at [https://githubnext.com/projects/copilot-cli](https://githubnext.com/projects/copilot-cli).

Authenticate with your GitHub account:
```bash
copilot auth login
```

Confirm your Copilot subscription is active — your GitHub account must have an assigned Copilot licence.

---

## Step 4 — Set up your PM tool MCP Server

The SDLC agents connect to your PM tool to read story details and update statuses via an MCP server. This is only required for the two skills that write to your PM tool (`push-backlog` and `sync-pm`). All other agents work without it.

Which server you need depends on the PM tool you choose during `/init` (Step 6):

### JIRA (Atlassian) projects

Follow the Atlassian MCP setup guide to obtain credentials. You will need your **JIRA site URL** and an **API token**.

### Azure DevOps (ADO) projects

Configure the Azure DevOps MCP server with a Personal Access Token that has work-item read/write scope for your organisation.

> The SDLC `/init` wizard writes the required MCP config for you — see Step 6.

---

## Step 5 — Install the Slalom SDLC Plugin

### Recommended — marketplace plugin

The easiest install is the native Copilot marketplace. Add the Slalom marketplace once, then install the plugin:

```bash
copilot plugin marketplace add Slalom/salesforce-devops
copilot plugin install slalom-sdlc@slalom
```

Both are user-level — the plugin's agents are then available in every project, with no per-project setup. Update anytime with:

```bash
copilot plugin update slalom-sdlc
```

> The plugin's agents are **namespaced** under the plugin name: `slalom-sdlc:about`, `slalom-sdlc:init`, `slalom-sdlc:discover`, and so on. Use those ids everywhere this guide shows `slalom-about` / `slalom-init` etc.

### Verify the install

```bash
copilot
/agent slalom-sdlc:about
```

You should see a help message describing the available SDLC commands.

---

### Alternative — zip pack (manual / air-gapped)

If you can't reach the marketplace (offline, restricted network), install from the release zip instead. This installs **un-namespaced** agents (`slalom-about`, `slalom-init`, …).

1. Download `slalom-sdlc-copilot.zip` from the [latest release](https://github.com/Slalom/salesforce-devops/releases).
2. Unzip and run the installer:

```bash
unzip slalom-sdlc-copilot.zip -d slalom-sdlc-copilot
cd slalom-sdlc-copilot
./install.sh
```

The installer runs fully at **user level** — agents are available in every project with no per-project setup.

#### What the installer does

| Step | What happens |
|------|--------------|
| 1 | Copies the bundled MCP server to `~/.copilot/slalom-sdlc/server.js` |
| 2 | Installs custom agent profiles to `~/.copilot/agents/slalom-*.agent.md` |
| 3 | Registers the `slalom-sdlc` MCP server in `~/.copilot/mcp-config.json` |

All steps are idempotent — re-running `./install.sh` upgrades in place.

#### Install to a non-default Copilot home

```bash
COPILOT_HOME=/path/to/.copilot ./install.sh
```

#### Verify the zip install

```bash
copilot
/agent slalom-about
```

You should see a help message describing the available SDLC commands.

---

## Step 6 — Initialise Your Project

Run the setup wizard once per project. It creates the project configuration file, fetches coding standards, and scaffolds the artefact folder structure.

Open the Copilot CLI from your Salesforce project directory:

```bash
cd /path/to/your/project
copilot
/agent slalom-init
```

The wizard will ask for:

| Setting | Applies to | Example |
|---------|------------|---------|
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
| Status names | Both | Names from your board (one per phase) |

After completion, the following is created in your project repository:

```
.sdlc/config.json          ← project configuration
.vscode/mcp.json           ← Salesforce + PM tool MCP config
artifacts/                 ← discovery and story artefacts
devops/standards/          ← Apex, LWC, configuration, git, and UX standards
```

Commit all of these to source control — they are shared across the team.

---

## Usage — Running the Agents

Invoke agents from inside the `copilot` CLI using `/agent <name>`:

| Agent | Phase | Command |
|-------|-------|---------|
| `slalom-about` | Overview | `/agent slalom-about` |
| `slalom-init` | Initialise project | `/agent slalom-init` |
| `slalom-discover` | Discovery — engagement, backlog | `/agent slalom-discover` |
| `slalom-refine` | Sprint -1 — acceptance criteria | `/agent slalom-refine` |
| `slalom-design` | Sprint -1 — solution design | `/agent slalom-design` |
| `slalom-build` | Sprint — implementation | `/agent slalom-build` |
| `slalom-test` | Sprint +1 — testing | `/agent slalom-test` |
| `slalom-release` | Transition — release | `/agent slalom-release` |

**Example workflow for story ACME-42:**

```
copilot
/agent slalom-refine
```
> When prompted, provide your story key: `ACME-42`

```
/agent slalom-design
```
```
/agent slalom-build
```

### Typical sprint workflow

```
/agent slalom-discover    ← map requirements, create epics and stories
/agent slalom-refine      ← refine each story: AC, estimates, open questions
/agent slalom-design      ← technical design → solution-design.md
/agent slalom-build       ← scaffold, test, deploy, raise PR
/agent slalom-test        ← test coverage and validation
/agent slalom-release     ← release notes and deployment checklist
```

---

## Upgrading

**Marketplace plugin:**

```bash
copilot plugin update slalom-sdlc
```

**Zip pack:** re-run `./install.sh` from the new release zip:

```bash
unzip slalom-sdlc-copilot-<new-version>.zip -d slalom-sdlc-copilot
cd slalom-sdlc-copilot
./install.sh
```

---

## Uninstalling

**Marketplace plugin:**

```bash
copilot plugin uninstall slalom-sdlc
copilot plugin marketplace remove slalom
```

**Zip pack:**

```bash
rm ~/.copilot/agents/slalom-*.agent.md
rm -rf ~/.copilot/slalom-sdlc
```

Then remove the `slalom-sdlc` entry from `~/.copilot/mcp-config.json`.

---

## Agent Boundaries

Each agent has a defined remit and will not take actions outside its phase.

| Agent | In scope | Out of scope |
|-------|----------|--------------|
| `slalom-refine` | Acceptance criteria, INVEST validation, effort estimate | Technical decisions, code |
| `slalom-design` | Org discovery, solution design, PM-tool sub-tasks | Implementation code, deployments |
| `slalom-build` | Code scaffolding, deployment to sandbox | Refinement, design changes |
| `slalom-test` | Test generation, coverage validation | Implementation changes |
| `slalom-release` | Deployment runbook, PM-tool transitions | Code generation, testing |

---

## Where Artefacts Live

All agent outputs are written to `artifacts/` in your project repository and should be committed to source control.

```
artifacts/
├── 00 - Project/          # Project overview, timeline, phase context
├── 00 - Inbox/            # Drop raw workshop transcripts/notes here
├── 00 - Registers/        # Pain points, systems, stakeholders, RAID
├── 01 - Sessions/         # Processed workshop notes
├── 02 - Current State/    # Synthesised narratives, process diagrams
├── 03 - Future State/     # Solution directions, MVP scope
├── 04 - Backlog/          # Backlog Tracker.xlsx, epics, stories
└── ACME-42/               # Story-level outputs
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
|---------|-------|
| `slalom-*` agents not appearing in `/agent` list | **Plugin:** run `copilot plugin list` and confirm `slalom-sdlc@slalom` is installed (agents are namespaced `slalom-sdlc:*`). **Zip:** confirm `~/.copilot/agents/slalom-*.agent.md` files exist; re-run `./install.sh` |
| `node: command not found` during install | Install Node.js 20+ and ensure it is on your `PATH` |
| `/agent slalom-init` does not start | **Plugin:** re-run `copilot plugin update slalom-sdlc`. **Zip:** verify `~/.copilot/mcp-config.json` contains the `slalom-sdlc` entry; re-run the installer |
| `marketplace add` fails | Confirm you have access to `Slalom/salesforce-devops` and are authenticated (`copilot auth login`); the pointer lives on `main` at `.github/plugin/marketplace.json` and resolves the plugin from the `copilot-dist` branch |
| PM tool status updates not working | Confirm your PM tool MCP server is configured and accessible; check credentials |
| `push-backlog` / `sync-pm` report no tools available | Verify the PM tool MCP server is registered in `~/.copilot/mcp-config.json` and your credentials are valid |
| Sandbox deploy fails | Run `sf org list` and confirm the alias in `.sdlc/config.json` matches |
| Copilot CLI not responding | Confirm your GitHub Copilot subscription is active and you are authenticated (`copilot auth login`) |
