from PIL import Image, ImageDraw, ImageFont
import os

FONT_PATH = "/System/Library/Fonts/Menlo.ttc"
FONT_SIZE = 15
PADDING = 40
BG = (18, 18, 24)        # near-black
FG = (220, 220, 220)     # light grey text
ACCENT = (100, 180, 255) # blue for box chars
LINE_H = 20              # line height

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))


def render(filename: str, text: str) -> None:
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    lines = text.split("\n")

    # Measure
    dummy = Image.new("RGB", (1, 1))
    dc = ImageDraw.Draw(dummy)
    max_w = max(dc.textlength(line, font=font) for line in lines)
    w = int(max_w) + PADDING * 2
    h = len(lines) * LINE_H + PADDING * 2

    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)

    for i, line in enumerate(lines):
        y = PADDING + i * LINE_H
        # colour box-drawing / border chars differently
        colour = ACCENT if any(c in line for c in "╔╗╚╝║═━┌┐└┘├┤┬┴┼─│▼") else FG
        d.text((PADDING, y), line, font=font, fill=colour)

    out = os.path.join(OUTPUT_DIR, filename)
    img.save(out)
    print(f"  ✓ {out}  ({w}×{h}px)")


# ── Diagram 1: Repo Structure ────────────────────────────────────────────────
REPO_STRUCTURE = """
╔══════════════════════════════════════════════════════════════════════╗
║              SLALOM OTTO EXTENSION — REPO STRUCTURE                 ║
╚══════════════════════════════════════════════════════════════════════╝

  sf-uki-devops/  (Slalom internal repo)
  ├── devops/
  │   ├── standards/          ← coding standards  →  scaffolded to client repos
  │   │   ├── apex.md
  │   │   ├── lwc.md
  │   │   ├── data-model.md
  │   │   └── ...
  │   └── instructions/       ← Slalom IP  →  compiled into .vsix binary only
  │       ├── deployment.md
  │       └── org-impact-assessment.md
  │
  └── tools/otto/
      └── packages/
          ├── core/src/
          │   ├── engine.ts          Handlebars renderer
          │   ├── scaffold.ts        /init scaffolding logic
          │   └── templates/
          │       ├── design.ts      Handlebars template strings
          │       ├── build.ts           (reference {{{instructions.*}}})
          │       └── ...
          └── vscode/src/
              └── handlers/
                  └── agent.ts       VS Code chat command handler
"""

# ── Diagram 2: Build Time ────────────────────────────────────────────────────
BUILD_TIME = """
╔══════════════════════════════════════════════════════════════════════╗
║              BUILD TIME  —  pnpm build → esbuild                    ║
╚══════════════════════════════════════════════════════════════════════╝

  devops/instructions/deployment.md       ──┐
  devops/instructions/org-impact-…        ──┤  tsup.config.ts:
  devops/standards/apex.md                ──┤  loader: { ".md": "text" }
  devops/standards/lwc.md                 ──┤
  templates/design.ts  (HB template)      ──┤  esbuild reads each file
  templates/build.ts   (HB template)      ──┤  at build time and embeds
  ...all source files...                  ──┘  content as JS string literals

                                    ▼

              ┌──────────────────────────────────────┐
              │          extension.js  (544 KB)       │
              │      inside slalom-sdlc-1.0.0.vsix    │
              │                                       │
              │  deploymentStr      = "# Sandbox…"   │ ← full markdown, baked in
              │  orgImpactStr       = "# Salesforce…"│ ← full markdown, baked in
              │  apexMdStr          = "# Apex Stand…"│ ← standards, baked in
              │  designTemplate     = "## Step 0 — …"│ ← HB template, baked in
              └──────────────────────────────────────┘

                                    │  distributed to client
                                    ▼

              ┌──────────────────────────────────────┐
              │   Client VS Code  (installs .vsix)   │
              │   No instruction files on disk.       │
              │   All content lives in extension.js.  │
              └──────────────────────────────────────┘
"""

# ── Diagram 3: /init scaffold ────────────────────────────────────────────────
INIT_FLOW = """
╔══════════════════════════════════════════════════════════════════════╗
║              /init  —  ONE-TIME REPO SETUP                          ║
╚══════════════════════════════════════════════════════════════════════╝

  User types: @otto /init
        │
        ▼
  Interview wizard
  (project key, JIRA URL, team size, sprint length, paths…)
        │
        ▼
  scaffoldRepo() writes to CLIENT repo:

  ├── .otto/config.json           team + project settings
  ├── .vscode/mcp.json            Salesforce + Atlassian MCP config
  ├── devops/standards/           coding standards (dev team reads these)
  │   ├── apex.md
  │   ├── lwc.md
  │   └── ...
  └── force-app/frameworks/
      └── trigger-framework/      placeholder for TriggerHandler etc.

  ✗  devops/instructions/  is NOT written to client repo
     (stays inside the .vsix binary — Slalom IP protected)
"""

# ── Diagram 4: Runtime flow ──────────────────────────────────────────────────
RUNTIME_FLOW = """
╔══════════════════════════════════════════════════════════════════════╗
║          RUNTIME — @otto /design KAN-42                      ║
╚══════════════════════════════════════════════════════════════════════╝

  ┌────────────────────────────────────────────────────────────────┐
  │  VS Code Chat Panel                                            │
  │  User: @otto /design KAN-42                            │
  └────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
                 handleAgent("design", …)
                           │
          ┌────────────────┴────────────────┐
          │                                 │
          ▼                                 ▼
  requireConfig()                   designTemplate  (Handlebars string)
  reads .otto/config.json           ┌────────────────────────────┐
  ┌───────────────────┐             │ ## Step 2 — Org discovery  │
  │ paths.artifacts   │             │                            │
  │ paths.standards   │             │ {{{instructions            │
  │ team.sprintLen    │             │    .orgImpactAssessment}}} │
  │ project.jiraKey   │             │                            │
  │ jira.statusMap    │             │ Follow {{paths.standards}} │
  └────────┬──────────┘             │ /apex.md for Apex work…   │
           │                        └──────────────┬─────────────┘
           └──────────────┬─────────────────────────┘
                          │
                          ▼
                   renderPrompt()
          ┌────────────────────────────────┐
          │  Handlebars.compile()          │
          │                               │
          │  {{paths.standards}}          │  →  "devops/standards"
          │                               │
          │  {{{instructions              │  →  full 150-line procedure
          │     .orgImpactAssessment}}}   │     text inlined here
          └──────────────┬────────────────┘
                         │
                         ▼
          ┌────────────────────────────────┐
          │   resolved prompt string       │  fully rendered, ~3000 words
          │   (plain markdown text)        │  no placeholders remaining
          └──────────────┬────────────────┘
                         │
            model.sendRequest([
              Message("…resolved prompt…"),   ← full instructions
              Message("KAN-42")               ← user input
            ])
                         │
                         ▼
          ┌────────────────────────────────┐
          │    GitHub Copilot / LLM        │
          │                               │
          │  receives one long message    │
          │  with all instructions        │
          │  already inlined — no files   │
          │  to read                      │
          └──────────────┬────────────────┘
                         │  streamed response
                         ▼
            stream.markdown(chunk) → chat panel
"""

# ── Diagram 5: What Lives Where ─────────────────────────────────────────────
WHAT_LIVES_WHERE = """
╔══════════════════════════════════════════════════════════════════════════════════╗
║                      WHAT LIVES WHERE                                          ║
╚══════════════════════════════════════════════════════════════════════════════════╝

  ┌─────────────────────────┬──────────────────────┬──────────────────────────┐
  │                         │   Slalom repo        │   Client repo            │
  │                         │   (internal)         │   (after /init)          │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Agent instructions      │ devops/instructions/ │ ✗ never written          │
  │ deployment,             │ (source of truth)    │   lives in .vsix only    │
  │ org-impact-assessment   │                      │                          │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Coding standards        │ devops/standards/    │ ✓ devops/standards/      │
  │ apex, lwc, data-model…  │ (source of truth)    │   copied on /init        │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Phase prompts /         │ packages/core/src/   │ ✗ never written          │
  │ Handlebars templates    │ templates/*.ts       │   compiled into .vsix    │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ Project config          │ ✗                    │ ✓ .otto/config.json      │
  │                         │                      │   written on /init       │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ MCP config              │ ✗                    │ ✓ .vscode/mcp.json       │
  │                         │                      │   written on /init       │
  ├─────────────────────────┼──────────────────────┼──────────────────────────┤
  │ SDLC Artifacts          │ ✗                    │ ✓ artifacts/{STORY}/     │
  │ discovery, design,      │                      │   written by agents      │
  │ implementation records  │                      │   during SDLC phases     │
  └─────────────────────────┴──────────────────────┴──────────────────────────┘
"""

diagrams = [
    ("diagram-1-repo-structure.png", REPO_STRUCTURE),
    ("diagram-2-build-time.png",     BUILD_TIME),
    ("diagram-3-init-scaffold.png",  INIT_FLOW),
    ("diagram-4-runtime-flow.png",   RUNTIME_FLOW),
    ("diagram-5-what-lives-where.png", WHAT_LIVES_WHERE),
]

print("Rendering diagrams…")
for fname, text in diagrams:
    render(fname, text)
print("Done.")
