---
title: Environment and Dependency Check
description: Standard procedure for verifying required tools and MCP servers are available before running any SDLC agent phase, and guiding the user through installation when they are not. Referenced by all SDLC agents.
scope: environment, prerequisites, mcp, tooling
enforce: always
---

# Environment and Dependency Check

Before doing any phase-specific work, confirm the tools this phase depends on are actually available. Do not assume — check, and only check what this phase actually uses.

## 0. MCP tool naming varies by host — match on the server segment

The **same** MCP tool is exposed under different name shapes depending on the host
you are running in. Do **not** look for one hardcoded prefix. The forms you may see
for a tool `<tool>` on a server `<server>` are:

- `mcp__<server>__<tool>` (Claude Code / Claude plugin)
- `<server>-<tool>` (GitHub Copilot App / CLI)
- `<server>_<tool>` or `<server>.<tool>` (other hosts)

So detect a dependency by testing whether **any** tool in your available list has a
**server segment** that identifies it, matched **case-insensitively**. The server
segment is the part before the tool name in whichever shape above applies — and it
is whatever name the user chose in their MCP config, so it may carry suffixes (e.g.
`atlassian-mcp`, `Salesforce_DX`). To test a **whole-segment** match, split the
server segment on `-`, `_`, and `.` into tokens (e.g. `ado-mcp` → `ado`, `mcp`;
`salesforce-devops` → `salesforce`, `devops`) and check whether the term equals one
of those tokens exactly. Match by identity, not exact equality:

| Dependency | Matches if the server segment… |
|---|---|
| **JIRA / Atlassian** | contains `atlassian` or `jira` (case-insensitive) |
| **Azure DevOps** | contains `azure`, is a **whole segment** `ado` or `azuredevops`, or contains `workitem` |
| **Salesforce DX** | contains `salesforce`, or is a **whole segment** `sf` / `sfdx` / `salesforce_dx` |
| **Browser (Playwright)** | contains `playwright` (case-insensitive), or exposes `browser_navigate` / `browser_evaluate`-style tools |

Anchor the short, generic tokens (`sf`, `ado`) as a **whole segment** — never as a
bare substring — or you will false-match unrelated names (e.g. a project called
`salesforce-devops`, or any `sf`-containing word). Do **not** add a bare `devops`
token for Azure DevOps: `azure-devops` and `azuredevops` already match via `azure`,
and a bare `devops` token would false-match on `salesforce-devops`. The distinctive
tokens (`salesforce`, `atlassian`, `jira`, `azure`) are safe as case-insensitive
substrings.

## 1. Dependencies by phase

| Dependency | Needed by | How to detect |
|---|---|---|
| **PM tool MCP** (Atlassian for JIRA / Azure DevOps for ADO) | refine, design, build, test, release (**deploy** and **release-notes** skills only; not `impact-assessment`); **optional** in discover (only `push-backlog` and `sync-pm` sub-commands use it) | Apply the §0 server-segment match: JIRA → a server segment containing `atlassian`/`jira`; ADO → `azure` / whole-segment `ado`/`azuredevops` / `workitem`. Names appear as `mcp__Atlassian__*`, `atlassian-*`, `atlassian-mcp-*`, etc. — all match. Check `.sdlc/config.json` → `alm.tool` to know which one is expected. |
| **Salesforce DX MCP** | design (org discovery), build (deploy/test), test (org validation), release (**deploy** skill; `impact-assessment` only if the user opts into live-org queries) | Apply the §0 match: a server segment containing `salesforce` or the whole segment `sf`/`sfdx`/`salesforce_dx` (e.g. `mcp__Salesforce_DX__*`, `Salesforce_DX-*`). |
| **Salesforce CLI (`sf`)** | build, release (**deploy** skill) — fallback for the few operations with no MCP equivalent (e.g. `sf org login web`, `sf project deploy start`) | Run `sf --version` via Bash. |
| **Node.js & npm** | build, test — running LWC Jest tests (`npm run test:unit`) | Run `node --version` and `npm --version` via Bash. |
| **Git** | build, release (**deploy** and **release-notes** skills) — branching, committing, raising PRs | Run `git --version` via Bash. |
| **Python 3** | only if this project's own scripts (e.g. under `utilities/`) require it | Run `python3 --version` via Bash. |
| **Salesforce Code Analyzer plugin** (`sf code-analyzer`) | release — **deploy** skill (SFCA quality gate before the UAT deploy). Mandatory for that skill. | Run `sf code-analyzer --help` via Bash. The plugin installs itself on first use, but check explicitly so a missing plugin or network problem fails here rather than mid-gate. |
| **Java (JDK 11+)** | release — **deploy** skill. Code Analyzer's PMD, CPD and Graph engines need it. | Run `java -version` via Bash; the major version must be 11 or higher. |
| **Browser tool** (Playwright MCP) — *optional* | release — **impact-assessment** skill, to read the live Salesforce release notes (a JavaScript app that a plain HTTP fetch can't read). | Apply the §0 match for **Browser (Playwright)**. Absent ⇒ not a blocker: the skill falls back to asking the user to save the notes locally. |
| **`markitdown`** — *optional* | release — **impact-assessment** skill, to convert PDF / PPTX / DOCX release materials to markdown. | Run `markitdown --version`, or `uvx markitdown --version`, via Bash. Absent ⇒ not a blocker: the skill falls back to asking for markdown/text exports. |

## 2. Check MCP tool availability

For each MCP dependency the current phase needs, check whether at least one tool
whose **server segment** identifies that server (per the §0 case-insensitive,
segment-based rules) is present in your available tool list — regardless of whether
your host spells it `mcp__<server>__<tool>`, `<server>-<tool>`, or `<server>_<tool>`.
Do not call the tool speculatively just to test it — only check for its presence.

## 3. Check CLI dependencies

For each CLI dependency the current phase needs, run its version-check command via Bash (see table above). Treat "command not found" or a non-zero exit code as missing.

## 4. Report and advise

If everything the current phase needs is present, note it in one line and move straight on — do not print a full checklist for tools that were found.

If something required is missing, stop before the phase's own Step 0 and tell the user clearly what's missing and how to fix it:

| Missing | Tell the user |
|---|---|
| Atlassian MCP (JIRA projects) | "The Atlassian MCP isn't connected, so I can't read or write JIRA/Confluence. Add it to your MCP config — `.mcp.json`, `.vscode/mcp.json`, or `~/.copilot/mcp-config.json` (GitHub Copilot App) — see your team's Atlassian MCP setup docs, or ask your tech lead. If it *is* declared but I still can't see its tools, the server likely failed to start or hasn't finished auth — restart the app/session and re-run; the tools appear as `atlassian-*` (Copilot) or `mcp__atlassian__*` (Claude Code)." |
| Azure DevOps MCP (ADO projects) | "The Azure DevOps MCP isn't connected, so I can't read or write Azure DevOps work items. Add the `@azure-devops/mcp` server entry to your `.vscode/mcp.json`, `.mcp.json`, or `~/.copilot/mcp-config.json` (Copilot App) and restart the app/session. Your tech lead can provide the exact config for your organisation." |
| Salesforce DX MCP | "The Salesforce DX MCP isn't connected, so I can't query or deploy to your org through the structured tool envelope. Install it with `npm install -g @salesforce/mcp`, add it to your MCP config (`.mcp.json`, `.vscode/mcp.json`, or `~/.copilot/mcp-config.json`), then authenticate an org with `sf org login web`." |
| Salesforce CLI (`sf`) | "The Salesforce CLI isn't installed. Install it with `npm install -g @salesforce/cli`, then authenticate a sandbox with `sf org login web --alias sandbox --instance-url https://test.salesforce.com`." |
| Node.js / npm | "Node.js isn't installed, so I can't run the Jest test suite for LWC components. Install the LTS release from https://nodejs.org, or via a version manager such as `nvm install --lts`." |
| Git | "Git isn't installed, so I can't branch, commit, or raise a PR. Install it via your OS package manager, e.g. `brew install git` (macOS) or `apt install git` (Linux), or from https://git-scm.com/downloads." |
| Salesforce Code Analyzer plugin | "The Salesforce Code Analyzer plugin isn't available, so I can't run the quality gate. Install it with `sf plugins install code-analyzer`, confirm with `sf code-analyzer --help`, and re-run." |
| Java 11+ | "Salesforce Code Analyzer needs a JDK, version 11 or later, and I couldn't find one. Install one (e.g. `brew install openjdk` on macOS, or Azul Zulu / Temurin from your package manager), make sure `java -version` reports 11+, and re-run." |
| Browser tool (Playwright MCP) — optional | "No browser tool is connected, so I can't read the live Salesforce release notes myself. Either add the Playwright MCP (`npx @playwright/mcp@latest`) to your MCP config and restart the session, or save the release notes (browser *Print → Save as PDF*, or Salesforce's PDF) into the project folder and I'll work from those." |
| `markitdown` — optional | "`markitdown` isn't installed, so I can't convert PDF/PPTX release materials to markdown. Install it with `pip install 'markitdown[all]'` (or run it on demand with `uvx markitdown`), or give me markdown/text exports instead." |
| Python 3 | "This project's scripts expect Python 3, which isn't installed. Install it via `brew install python3` (macOS), `apt install python3` (Linux), or https://python.org/downloads (Windows)." |

Ask the user to install or connect the missing piece and confirm when ready. If a phase can meaningfully continue with reduced capability (e.g. no JIRA access, falling back to purely local artifacts), say so explicitly and let the user choose — never silently proceed as if the tool were present.
