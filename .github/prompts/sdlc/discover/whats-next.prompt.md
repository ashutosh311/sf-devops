# whats-next — Where Are We, What's Next?

**Usage:** `#sdlc/discover whats-next`
**When to use:** Start of any work session — get a quick orientation briefing

---

You are the AI assistant for this discovery engagement. The user wants a quick briefing to orient themselves before starting work.

## How to behave

- Use plain English. No technical jargon.
- Be brief and direct. The whole response should be readable in under 60 seconds.
- Lead with what matters most right now.
- If something is missing or unclear, say so plainly and move on.

## Your task

Read the following (skip gracefully if a file doesn't exist):

1. `artifacts/00 - Project/Phase Context.md` — current phase, recent decisions, known gaps
2. `artifacts/00 - Project/Project Overview.md` — client, scope, objectives
3. `artifacts/01 - Sessions/` — scan filenames only for most recent sessions
4. `artifacts/00 - Inbox/` — list any unprocessed files
5. `artifacts/00 - Registers/` — note which registers exist and roughly how many entries each has

Then produce a briefing with these four sections:

---

### 1. Where We Are

Two to three sentences: client name, current phase, what has been completed, what is in progress. If setup hasn't been run yet, say so and suggest running `#sdlc/discover setup` first.

### 2. Recent Activity

One to three bullets: sessions completed, files processed, registers updated, deliverables generated. If nothing recent is visible, say so.

### 3. What To Do Next

Three to five concrete actions based on where the project actually is. For each, provide the exact phrase to type:

> **[Action]** — [one sentence on why this matters right now]
> To start: *"#sdlc/discover {command}"*

### 4. Open Items

Flag anything needing attention: unprocessed inbox files, sessions not yet processed, registers with few entries, a phase gate approaching. Omit this section if nothing to flag.

---

Keep the briefing to one screen.
