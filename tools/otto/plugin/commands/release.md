---
description: Release agent — deploy a release, write release notes, or assess a Salesforce seasonal release
argument-hint: "[skill] [TICKET-KEY]"
# No allowed-tools restriction: the returned instructions call out to whatever
# ALM/Salesforce MCP server the host has configured (Atlassian, ADO, Salesforce
# DX) plus Read/Write/Bash — an explicit allowlist here would silently strip
# that access. Mirrors the Copilot pack's tools: ["*"] for this same agent.
---

Parse the input for an optional **skill** and optional **story key(s)** — either may appear in either position, and both may be omitted.

Valid skills: `deploy` (bundle completed stories, run the SFCA code-quality gate, deploy to UAT, sign-off, production deploy), `release-notes` (build user-facing release notes from the git diff and the tickets behind it), `impact-assessment` (assess a **Salesforce seasonal release** such as Winter '27 against this org's customisations — advisory, read-only). Map natural-language requests to a skill: "release notes", "what changed in this release", "changelog" → `release-notes`; "Winter/Spring/Summer release", "seasonal release", "impact of the Salesforce release", "release readiness" → `impact-assessment`; "deploy", "ship", "go live" → `deploy`. If the intent is unclear, ask which they want.

Call `otto_prompt` on the `otto` MCP server with `command: "release"`, plus:
- `skill` — the skill if one was given
- `storyKey` — the story key(s) if given (`deploy` only; `release-notes` gathers what it needs — release tag, refs — by asking)
- `release` — for `impact-assessment` only: the Salesforce seasonal release if the user named one (e.g. `Winter '27`). The returned instructions come with the release, extra sources and live-org choice already collected through an input form where the host supports one; do not ask for them again. If the response does not include an "Inputs already confirmed by the user" block, the skill asks for them itself.

If story keys were given but no skill, pass `skill: "deploy"` — this preserves the command's original behaviour.

If neither was given, call `otto_prompt` with `command: "release"` alone and present the menu it returns; ask the user to pick before continuing. Once they pick, **call `otto_prompt` again** with `command: "release"` and `skill` set to their choice — the menu is a routing index and does not contain any skill's procedure. Never run a skill from its one-line menu description.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `Otto config` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
