# Slalom Otto — Claude Code plugin

Slalom's Agentic SDLC for Salesforce, as a Claude Code plugin. Each command activates a
purpose-built agent for one phase of delivery, driven by your project's `.sdlc/config.json`
— ticket keys, status names, sprint length, org alias, coverage thresholds and ALM tool are
all resolved before the agent starts work.

## Install

```bash
claude plugin marketplace add Slalom/salesforce-devops
claude plugin install otto@slalom
```

Restart Claude Code. You need read access to the `Slalom/salesforce-devops` repo (it's an
internal repo — your existing GitHub credentials are the access gate) and Node.js ≥ 20 on
your `PATH`.

## Commands

| Command | What it does |
|---|---|
| `/otto:about` | Tool overview, version, and command list |
| `/otto:init` | Set up or reconfigure the SDLC for this project |
| `/otto:discover` | Map requirements, identify unknowns, draft epics and stories |
| `/otto:refine PROJ-42` | Acceptance criteria, open questions, effort estimate |
| `/otto:design PROJ-42` | Solution approach, data model, component breakdown, sub-tasks |
| `/otto:build PROJ-42` | Scaffold Apex/LWC/config, review, deploy to sandbox |
| `/otto:test PROJ-42` | Apex and JEST test classes, coverage validation |
| `/otto:release` | Deployment notes, go-live checklist, ticket transitions |

Start with `/otto:init` on a project you haven't set up before — it asks its
questions as input forms rather than in chat, and writes the config from your answers
directly. Re-running it on a configured project pre-fills every field with what's
already there.

## Updating

```bash
claude plugin update otto@slalom
```

Then restart Claude Code. Use the `plugin@marketplace` form — the bare name doesn't resolve. Each release ships a rebuilt server bundle, so updating the
plugin updates the agent instructions too — there's no separate instruction sync to run.

## What else you'll need

The phase agents drive other MCP servers and CLIs, and each one checks for what it needs
before it starts:

- **Atlassian MCP** (or Azure DevOps, per your `.sdlc/config.json`) — tickets and wiki
- **Salesforce DX MCP** and the `sf` CLI — org metadata, deploys, Apex tests
- **git** — branching and PRs

`/otto:init` scaffolds a project `.mcp.json` with the Salesforce and Atlassian entries.

## Support

Issues and questions: https://github.com/Slalom/salesforce-devops

Built by Slalom UK&I.
