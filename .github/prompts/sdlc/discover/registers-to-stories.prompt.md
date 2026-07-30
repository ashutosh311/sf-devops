# registers-to-stories — Post-Setup Bridge

**Usage:** `#sdlc/discover registers-to-stories`
**When to use:** After `#sdlc/discover setup` completes and registers are populated — runs synthesize, analyze, and manage-backlog in sequence with a checkpoint at each step.

---

You are picking up immediately after setup finished. The registers in `artifacts/00 - Registers/` are populated. The goal is to produce a reviewed `Backlog Tracker.xlsx` ready for the user to review before pushing to JIRA.

Run the following three stages **in order**. After each stage, pause and ask the user to confirm before continuing.

---

## Stage 1 — Synthesize current state

Run `#sdlc/discover synthesize` (full current state mode) to produce a narrative current-state document in `artifacts/02 - Current State/`.

When done, present:
- A 1-paragraph summary of what was synthesized
- The file path created
- The question: **"Does this narrative reflect what you heard in discovery? Reply 'continue' to move to analysis, or describe any corrections needed."**

Wait for confirmation.

---

## Stage 2 — Analyze priorities and traceability

Run `#sdlc/discover analyze` (prioritization mode) to:
1. Rank pain points by severity and frequency
2. Check which objectives have full coverage and which have gaps
3. Identify the top themes to focus the backlog on

When done, present:
- The top 3–5 themes with brief justification
- Any coverage gaps that should influence backlog scope
- The question: **"Do these themes and priorities match the direction you want the backlog to take? Reply 'continue' to build the backlog, or tell me what to adjust."**

Wait for confirmation.

---

## Stage 3 — Initialize the backlog

Run `#sdlc/discover manage-backlog` (initialize mode) using the registers and analysis from Stage 2.

Seed `artifacts/04 - Backlog/Backlog Tracker.xlsx` with:
- Epics aligned to the top themes
- Stories that trace back to specific pain points and requirements

When done, present:
- Counts: epics, stories
- A sample story with its full traceability chain (pain point → requirement → objective → story)
- The path to the workbook
- The question: **"The backlog is seeded. Open Backlog Tracker.xlsx to review and adjust. When you're happy with it, run `#sdlc/discover push-backlog` to create JIRA items and archive the workbook."**

---

## Stop conditions

Stop and ask the user before continuing if:
- A stage returns no output or an error
- A register appears empty or has fewer than 3 entries
- The user gives a non-confirming answer at any checkpoint
