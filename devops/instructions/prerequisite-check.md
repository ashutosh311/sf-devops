---
title: Environment and Dependency Check
description: Standard procedure for verifying required tools and MCP servers are available before running any SDLC agent phase, and guiding the user through installation when they are not. Referenced by all SDLC agents.
scope: environment, prerequisites, mcp, tooling
enforce: always
---

# Environment and Dependency Check

Before doing any phase-specific work, confirm the tools this phase depends on are actually available. Do not assume — check, and only check what this phase actually uses.

## 1. Dependencies by phase

| Dependency | Needed by | How to detect |
|---|---|---|
| **Atlassian MCP** (JIRA / Confluence) | discover, refine, design, build, test, release | Look for `mcp__Atlassian__*` (or equivalently named) tools in your available tool list. |
| **Salesforce DX MCP** | design (org discovery), build (deploy/test), test (org validation), release (deploy) | Look for `mcp__Salesforce_DX__*` tools in your available tool list. |
| **Salesforce CLI (`sf`)** | build, release — fallback for the few operations with no MCP equivalent (e.g. `sf org login web`, `sf project deploy start`) | Run `sf --version` via Bash. |
| **Node.js & npm** | build, test — running LWC Jest tests (`npm run test:unit`) | Run `node --version` and `npm --version` via Bash. |
| **Git** | build, release — branching, committing, raising PRs | Run `git --version` via Bash. |
| **Python 3** | only if this project's own scripts (e.g. under `utilities/`) require it | Run `python3 --version` via Bash. |

## 2. Check MCP tool availability

For each MCP dependency the current phase needs, check whether at least one tool matching that server's namespace is present in your available tool list. Do not call the tool speculatively just to test it — only check for its presence.

## 3. Check CLI dependencies

For each CLI dependency the current phase needs, run its version-check command via Bash (see table above). Treat "command not found" or a non-zero exit code as missing.

## 4. Report and advise

If everything the current phase needs is present, note it in one line and move straight on — do not print a full checklist for tools that were found.

If something required is missing, stop before the phase's own Step 0 and tell the user clearly what's missing and how to fix it:

| Missing | Tell the user |
|---|---|
| Atlassian MCP | "The Atlassian MCP isn't connected, so I can't read or write JIRA/Confluence. Add it to your MCP config (`.mcp.json` or `.vscode/mcp.json`) — see your team's Atlassian MCP setup docs, or ask your tech lead for the project's connection details." |
| Salesforce DX MCP | "The Salesforce DX MCP isn't connected, so I can't query or deploy to your org through the structured tool envelope. Install it with `npm install -g @salesforce/mcp`, add it to your MCP config, then authenticate an org with `sf org login web`." |
| Salesforce CLI (`sf`) | "The Salesforce CLI isn't installed. Install it with `npm install -g @salesforce/cli`, then authenticate a sandbox with `sf org login web --alias sandbox --instance-url https://test.salesforce.com`." |
| Node.js / npm | "Node.js isn't installed, so I can't run the Jest test suite for LWC components. Install the LTS release from https://nodejs.org, or via a version manager such as `nvm install --lts`." |
| Git | "Git isn't installed, so I can't branch, commit, or raise a PR. Install it via your OS package manager, e.g. `brew install git` (macOS) or `apt install git` (Linux), or from https://git-scm.com/downloads." |
| Python 3 | "This project's scripts expect Python 3, which isn't installed. Install it via `brew install python3` (macOS), `apt install python3` (Linux), or https://python.org/downloads (Windows)." |

Ask the user to install or connect the missing piece and confirm when ready. If a phase can meaningfully continue with reduced capability (e.g. no JIRA access, falling back to purely local artifacts), say so explicitly and let the user choose — never silently proceed as if the tool were present.
