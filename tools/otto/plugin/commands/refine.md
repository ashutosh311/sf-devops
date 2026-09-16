---
description: Refinement agent — acceptance criteria, business context, generate stories, or gap-check an epic
argument-hint: "[skill] [TICKET-KEY]"
# No allowed-tools restriction: the returned instructions call out to whatever
# ALM/Salesforce MCP server the host has configured (Atlassian, ADO, Salesforce
# DX) plus Read/Write/Bash — an explicit allowlist here would silently strip
# that access. Mirrors the Copilot pack's tools: ["*"] for this same agent.
---

Parse `$1` and `$2` for an optional **skill** and an optional **ticket key** — either may appear in either position, and both may be omitted.

Valid skills: `story` (refine an existing story), `generate-stories` (draft candidate stories under an epic from transcripts/files), `gap-analysis` (cross-reference an epic's existing stories against transcripts/files and report *missing* stories — read-only, creates nothing), `data-dictionary`. Map natural-language requests to a skill: "generate stories", "draft stories", "break this epic into stories" → `generate-stories`; "what stories are missing", "gap analysis", "did we miss any stories", "is this epic complete" → `gap-analysis`. Both take an epic + named files, but differ in output: generate-stories *drafts* the missing stories, gap-analysis *reports* them read-only. If the intent is unclear between the two, ask which they want.

Call `otto_prompt` on the `otto` MCP server with `command: "refine"`, plus:
- `skill` — the skill if one was given
- `storyKey` — the ticket key if one was given (for `story`, the story/epic/sprint key; for `generate-stories` and `gap-analysis`, the epic key)

If a ticket key was given but no skill, pass `skill: "story"` — this preserves the command's original ticket-only behaviour (`$1` may be a story key, an epic key to refine every unrefined story under it, or a sprint).

If neither was given, call `otto_prompt` with `command: "refine"` alone and present the menu it returns; ask the user to pick before continuing. Once they pick, **call `otto_prompt` again** with `command: "refine"` and `skill` set to their choice — the menu is a routing index and does not contain any skill's procedure. Never run a skill from its one-line menu description.

Follow the returned instructions verbatim — they are the authoritative procedure for this phase, already resolved against this project's `Otto config` (ticket keys, status names, paths, coverage thresholds, ALM tool). Do not summarise them, skip steps, or substitute your own approach.
