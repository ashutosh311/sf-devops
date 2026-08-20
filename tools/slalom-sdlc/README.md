# Slalom SDLC

AI-assisted SDLC agents for Salesforce delivery, built by Slalom UK&I.

Each slash command activates a purpose-built AI agent for a specific delivery phase — discovery, refinement, design, build, test, and release. The agents work within the project's PM tool — **JIRA (Atlassian) or Azure DevOps (ADO)** — Salesforce org, and Slalom coding standards without the consultant needing to switch context. You pick the PM tool once during `/init` and every agent adapts to it.

The **primary, fully-supported experience is the VS Code extension running on GitHub Copilot** (`@slalom-sdlc`). A **Claude Code plugin** and a **GitHub Copilot plugin** (for the Copilot CLI and the Copilot desktop app, with a zip pack as an air-gapped fallback) are also published — all share the same engine and standards, install once per user, and update alongside each release (see [Instruction Updates](#instruction-updates)).

---

## Contents

1. [Quick Start](#quick-start)
2. [Commands](#commands)
3. [How It Works](#how-it-works)
4. [Instruction Updates](#instruction-updates)
5. [Distribution](#distribution)
6. [IP Protection](#ip-protection)
7. [For Slalom Delivery Teams: Publishing an Update](#for-slalom-delivery-teams-publishing-an-update)
8. [Versioning](#versioning)
9. [Development](#development)

---

## Quick Start

### VS Code (GitHub Copilot) — recommended

1. Install the `.vsix` extension in VS Code
2. Open your Salesforce project folder
3. Open the Copilot Chat panel and run:

```
@slalom-sdlc /init
```

This runs a short setup interview and scaffolds the project with config, standards, and MCP configs.

### Claude Code (plugin)

> Not the primary delivery path, but a supported install. Requires Node.js 20+ on your `PATH` and read access to `Slalom/salesforce-devops`.

```bash
claude plugin marketplace add Slalom/salesforce-devops
claude plugin install slalom-sdlc@slalom
```

Restart Claude Code, then from any Salesforce project:

```
/slalom-sdlc:init
```

To update later:

```bash
claude plugin update slalom-sdlc@slalom
```

Use the `plugin@marketplace` form — `claude plugin update slalom-sdlc` on its own does not resolve.

If you previously registered the MCP server by hand with `packages/mcp/setup.sh`, remove it first so you don't end up with the same tools twice:

```bash
claude mcp remove slalom-sdlc
```

### GitHub Copilot CLI / desktop app

> A supported install for the `copilot` terminal CLI and the Copilot desktop app. Requires Node.js 20+ on your `PATH`.

**Recommended — marketplace plugin.** Add the Slalom marketplace and install the plugin; it updates in place thereafter:

```bash
copilot plugin marketplace add Slalom/salesforce-devops
copilot plugin install slalom-sdlc@slalom
```

Then, from any Salesforce project:

```
copilot
/agent slalom-sdlc:about
```

Copilot namespaces the plugin's agents under the plugin name (`slalom-sdlc:about`, `slalom-sdlc:init`, `slalom-sdlc:discover`, `slalom-sdlc:refine`, `slalom-sdlc:design`, `slalom-sdlc:build`, `slalom-sdlc:test`, `slalom-sdlc:release`). The bundled MCP server is registered automatically from the plugin. Update anytime with `copilot plugin update slalom-sdlc`.

**Alternative — zip pack (manual / air-gapped).** Download `slalom-sdlc-copilot.zip` from the [latest release](https://github.com/Slalom/salesforce-devops/releases), unzip it, and run the installer:

```bash
unzip slalom-sdlc-copilot.zip -d slalom-sdlc-copilot
cd slalom-sdlc-copilot
./install.sh
```

This installs at the **user level** (`~/.copilot/agents/` + `~/.copilot/mcp-config.json`), surfacing the commands as un-namespaced custom agents (`slalom-about`, `slalom-init`, …). Re-running `./install.sh` from a fresh zip upgrades in place. To install into a non-default Copilot home, set `COPILOT_HOME`. (`slalom-sdlc-copilot-marketplace.zip` is the same plugin as a self-contained marketplace tree for `copilot plugin marketplace add ./<unzipped-dir>`.)

---

## Commands

The `@slalom-sdlc` (VS Code / GitHub Copilot) column is the primary invocation. The Claude Code and Copilot CLI/desktop columns are the equivalent plugin and agent commands.

| VS Code | Claude Code | Copilot CLI / desktop | What it does |
|---|---|---|---|
| `@slalom-sdlc /about` | `/slalom-sdlc:about` | `/agent slalom-about` | Tool overview and command list |
| `@slalom-sdlc /init` | `/slalom-sdlc:init` | `/agent slalom-init` | Set up or reconfigure a project |
| `@slalom-sdlc /discover` | `/slalom-sdlc:discover` | `/agent slalom-discover` | Map requirements, identify unknowns, draft epics and stories |
| `@slalom-sdlc /refine PROJ-42` | `/slalom-sdlc:refine PROJ-42` | `/agent slalom-refine` | Refine a story — AC, open questions, effort estimate |
| `@slalom-sdlc /design PROJ-42` | `/slalom-sdlc:design PROJ-42` | `/agent slalom-design` | Technical design — solution, data model, sub-tasks |
| `@slalom-sdlc /build PROJ-42` | `/slalom-sdlc:build PROJ-42` | `/agent slalom-build` | Scaffold Apex/LWC/config, deploy to sandbox |
| `@slalom-sdlc /test PROJ-42` | `/slalom-sdlc:test PROJ-42` | `/agent slalom-test` | Generate test classes, validate coverage |
| `@slalom-sdlc /release` | `/slalom-sdlc:release` | `/agent slalom-release` | Deployment notes, checklist, PM-tool transitions |
| `@slalom-sdlc /feedback <comment>` | — | — | Send feedback about the tooling (VS Code only) — logged to the usage list |

Registering the MCP server directly instead of installing the plugin or pack (see [Development](#development)) gives the same commands as `/mcp__slalom-sdlc__<name>`. The server detects which surface it's running under and every message it prints uses the matching form.

### Interactive prompts in Claude Code

`/init` asks its questions as **native input forms**, not as a conversation. The server drives them over [MCP elicitation](https://modelcontextprotocol.io/specification/server/elicitation) — the same role `showInputBox`/`showQuickPick` play in the VS Code interview — so the model never conducts the interview and can't paraphrase a question, invent a default, or skip a field. Both surfaces walk the same `QUESTIONS` list in `packages/core/src/questions.ts` and hand the answers to the same `buildSdlcConfig`.

Clients that don't advertise the `elicitation` capability (the standalone CLI, older Claude Code builds) fall back automatically: the server hands the model the interview to conduct in conversation, finishing with a `sdlc_scaffold` call. Same questions, same resulting config, softer guarantees.

The phase commands still use plain numbered menus rendered by the agent — elicitation forms are one-shot, and a menu you can answer with "the third one, but only for PROJ-42" is worth more there than a dropdown.

### Typical sprint workflow

```
/discover          ← start of sprint: map requirements, create epics and stories
/refine PROJ-42    ← refine each story: AC, estimates, open questions
/design PROJ-42    ← technical design → solution-design.md
/build PROJ-42     ← scaffold, test, deploy, raise PR
/test PROJ-42      ← test coverage and validation
/release           ← release notes and deployment checklist
```

---

## How It Works

The extension is a thin orchestration layer. It does not contain agent logic — instead it:

1. Reads `.sdlc/config.json` from the project root (written by `/init`)
2. Loads the instruction set for the requested SDLC phase
3. Renders a fully-resolved prompt by merging project config (PM tool + key/org, status names, org alias, paths, standards) into the instruction template
4. Sends that prompt to the underlying LLM (GitHub Copilot or Claude) along with the user's message
5. Streams the response back

**The instructions that drive each agent are never written to the client's repository.** They live inside the tool.

### Project layout after `/init`

```
.vscode/
  mcp.json                 ← Salesforce + Atlassian MCP config (add the Azure DevOps MCP here for ADO projects)
.mcp.json                  ← Claude Code MCP config (Salesforce DX + Atlassian)
.sdlc/
  config.json              ← project config (PM tool + key/org, statuses, org, team settings)
  prompts/                 ← context-enriched prompts written by push-backlog / sync-pm for agent-mode runs
artifacts/
  {STORY-KEY}/
    sf-discovery.md        ← discovery notes
    solution-design.md     ← technical design
    implementation-record.md
devops/standards/          ← Slalom coding standards (Apex, LWC, Git, etc.)
force-app/                 ← Salesforce metadata
```

---

## Instruction Updates

Slalom's delivery procedures improve over time. Rather than requiring everyone to reinstall the extension for every update, the VS Code extension automatically refreshes its instruction set daily from GitHub Releases.

### How it works

- On startup, the extension silently checks whether instructions were updated in the last 24 hours
- If a newer release exists on `Slalom/salesforce-devops`, it downloads the bundle, verifies every file's checksum, and activates the new instructions atomically
- If anything goes wrong (no internet, auth issue, checksum mismatch), the tool falls back to the instructions compiled into the extension — no interruption to your work

Instructions are cached at `~/.slalom-sdlc/instructions-cache/current/`.

> **The daily GitHub sync is a VS Code feature.** Only the VS Code extension polls for new instruction bundles. The Claude Code plugin and the CLI read from the same local cache if the extension has populated it, but neither syncs on its own.
>
> The Claude Code plugin doesn't need to. Every release republishes the plugin with a freshly built server bundle, and the templates and instructions are compiled into that bundle — so `claude plugin update slalom-sdlc@slalom` updates the agent instructions as a side effect. The CLI is the one surface with no update path of its own: it always runs whatever was bundled when its binary was built.

### Authentication

**Minimal setup for VS Code users.** The extension reuses your existing GitHub login. Background syncs are silent and never interrupt you — they run only if VS Code already has a GitHub session with the `repo` scope. The first time you run **Slalom SDLC: Sync Instructions** from the Command Palette, VS Code may prompt you once to sign in or grant repository access; after that, daily background syncs work automatically.

For headless or non-VS Code environments, set one of these environment variables:

```
SLALOM_SDLC_GITHUB_TOKEN   ← preferred
GITHUB_TOKEN
GH_TOKEN
```

The token needs read access to the `Slalom/salesforce-devops` private repository.

### Operational commands

Open the VS Code Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | What it does |
|---|---|
| **Slalom SDLC: Instruction Status** | Shows the active instruction version, last sync time, and any errors |
| **Slalom SDLC: Sync Instructions** | Forces an immediate sync without waiting for the 24-hour window |

---

## Distribution

### For Slalom consultants — VS Code

Install the `.vsix` extension. The extension connects to the private `Slalom/salesforce-devops` GitHub repo using your Copilot login and keeps instructions up to date automatically.

**Required:** Active GitHub Copilot subscription, GitHub account with access to `Slalom/salesforce-devops`.

### For Slalom consultants — Claude Code

The plugin is published from a marketplace declared at `.claude-plugin/marketplace.json` in this repo's root. Nothing is downloaded from Releases: Claude Code clones the plugin, so repo access *is* the access control, the same way Copilot login gates the VSIX.

The marketplace entry points at the **`plugin-dist` branch**, a generated branch holding only the assembled plugin — manifest, slash commands, and the built `server/server.js`. The release workflow republishes it on every `vX.Y.Z` tag. `main` holds the plugin *source* at `tools/slalom-sdlc/plugin/`; no build output is ever committed there.

**Required:** Node.js 20+ on `PATH`, GitHub account with access to `Slalom/salesforce-devops`.

`slalom-sdlc-plugin.zip` is attached to each release for manual or air-gapped install, but the marketplace route is the normal one — it's the only one that updates.

### For Slalom consultants — GitHub Copilot CLI / desktop

Add the marketplace and install the plugin — a one-time setup that then works across every project, exactly like the VSIX or the Claude plugin:

```bash
copilot plugin marketplace add Slalom/salesforce-devops
copilot plugin install slalom-sdlc@slalom
```

The marketplace pointer lives on `main` at `.github/plugin/marketplace.json`; its one entry's `source` references the generated **`copilot-dist` branch** (`repo` + `path: plugin` + `ref: copilot-dist`), where the assembled `plugin/` (including the built `server/server.js`) is republished by the release workflow on every `vX.Y.Z` tag. `main` holds only the pointer and the plugin *source* at `tools/slalom-sdlc/copilot/plugin/`; no build output is committed there. Update with `copilot plugin update slalom-sdlc`.

**Required:** Node.js 20+ on `PATH`, GitHub Copilot access, GitHub account with access to `Slalom/salesforce-devops`.

`slalom-sdlc-copilot.zip` (the user-level pack + `./install.sh`) and `slalom-sdlc-copilot-marketplace.zip` (a self-contained local marketplace tree) are attached to each release for manual or air-gapped install, but the marketplace route is the normal one — like the plugin, it updates via `copilot plugin update`. The zip pack updates only when you re-run the installer from a fresh zip.

### For client teams and non-Slalom users

Distribute a `.vsix` directly. The instructions bundled into that release are available immediately — no GitHub access or internet connection required after install. The sync feature is simply a no-op (no token → no sync → bundled instructions used).

For a one-off client VSIX outside the normal tag-driven release (see [Local builds](#local-builds)), pass a real version explicitly so it isn't stamped `0.0.0`:

```bash
cd tools/slalom-sdlc
node scripts/sync-version.mjs --version 1.2.3   # not committed — CI working-tree only, normally
pnpm -r build
cd packages/vscode
pnpm package    # → slalom-sdlc-1.2.3.vsix
```

---

## IP Protection

Slalom's delivery procedures (the instruction templates that drive each agent) are protected in two layers:

**Layer 1 — Compiled into the binary.** Instructions are TypeScript string constants built into the extension's JavaScript bundle (`dist/extension.js`). They are not separate files; they are not written to the client's project or accessible as plain text.

**Layer 2 — Private repository gating for updates.** The daily sync downloads from a private GitHub repository (`Slalom/salesforce-devops`). A user without repository access cannot retrieve updated instructions. Clients who receive a VSIX get the version baked into that binary; they cannot pull future Slalom updates.

This means:
- Consultants on Slalom projects get continuously updated, best-practice instructions
- Clients who receive a VSIX get a point-in-time snapshot with no route to subsequent Slalom IP

---

## Usage Tracking

The VS Code extension records **command and feedback usage** so Slalom can understand adoption
by person, project, and agent. Events are pushed to a Power Automate HTTP trigger that writes to
the **Salesforce DevOps Log** SharePoint list (surfaced in Power BI).

### Disclosure

This records a **named individual's identity** (see `User` below) against the commands they run
and any feedback they submit. The resulting data is visible to the Slalom delivery team via Power
BI. Treat it the same as any other internal tooling telemetry/analytics — it is not hidden or
covert, but it is not anonymous either. It does not run for client-distributed builds (see
Slalom-only gate below).

### What is captured

Each event is a single row with these fields only:

| Field | Example | Notes |
|---|---|---|
| `Command` | `build`, `refine`, `Feedback` | The agent command, or `Feedback` for feedback entries |
| `Date` | `2026-07-15T12:34:00Z` | ISO 8601 timestamp |
| `User` | `jane.doe` | GitHub session label, falling back to git `user.name` |
| `Project` | `protas-sc` | From `.sdlc/config.json` |
| `Story` | `PSC-42` | Extracted from the prompt via a strict `KEY-<number>` regex only |
| `Model` | `gpt-4o` | The active Copilot model family |
| `Tokens` | `142` | See limitation below — **input estimate only, not a credit count** |
| `Comment` | free text | Populated only for `Feedback` entries |

**Privacy.** Request prompts and model responses are **never** transmitted — only the fields
above. The single exception is `Comment`, which is the feedback text a user deliberately submits
via `/feedback` or the `/discover` feedback prompt (Copilot's stable thumbs up/down API exposes
only a 👍/👎 `.kind`, not free text, so thumbs feedback carries a fixed placeholder, never user
text — see limitation below).

**Credits/tokens limitation.** The VS Code Language Model API does not expose Copilot
premium-request credits at all. `Tokens` is a best-effort tokeniser count of **the user's own raw
message only** — it does not include the fully-rendered system prompt each agent builds
internally, nor the model's response, so it under-counts the true cost of a command. `Model`
(the active model family) is recorded reliably and is the more useful adoption signal of the two.

### Slalom-only gate

Tracking requires **both** of the following, or it stays fully inert:
1. **A resolvable endpoint.** The Power Automate URL contains a SAS signature (`sig=`) that is
   itself the write credential to the SharePoint list — it is never committed to source. It is
   injected at build time, in CI only, from a GitHub Actions secret (`USAGE_TRACKING_ENDPOINT_URL`)
   via esbuild's `define` (see `packages/vscode/esbuild.mjs` and `src/usage.ts`). Local/dev builds
   compile in an empty string, so tracking is off regardless of anything else.
2. **Proven private-repo access.** The daily instruction sync must have actually succeeded at
   least once (i.e. downloaded a release asset from the private `Slalom/salesforce-devops` repo).
   This is checked directly via the sync service's own status — **not** by checking for the
   presence of `GITHUB_TOKEN`/`GH_TOKEN`/`SLALOM_SDLC_GITHUB_TOKEN` or any other ambient token,
   since a client build can easily have one of those set (e.g. their own CI) with zero access to
   Slalom's private repo. Token *presence* is never treated as proof of being a Slalom consultant.

**Residual risk (accepted trade-off).** Because the endpoint is still compiled into
`dist/extension.js`, it remains extractable from a distributed `.vsix` by unzipping it — this is
inherent to a SAS-URL-as-bearer-token design and was accepted rather than standing up a separate
auth proxy. If this risk profile changes, consider fronting Power Automate with a thin
authenticated proxy (e.g. an Azure Function validating a signed header) instead of relying on the
SAS URL as the sole credential.

### Reliability & storage

Events are written as individual files under `~/.slalom-sdlc/usage-queue/` (one JSON file per
event, not a single shared array) and flushed in the background — pushing is asynchronous and
never blocks a command. A per-file queue avoids a read-modify-write race across multiple VS Code
windows: each enqueue is a single atomic file create, and each flush POSTs and deletes one file at
a time. Failed pushes are left in place and retried on the next flush and on the next activation.
The queue is capped (500 files / 14 days, pruned during flush housekeeping).

### Overriding the endpoint (local testing only)

Set `SLALOM_SDLC_USAGE_URL` (a **runtime** env var, read by the extension when it runs — distinct
from the **build-time** `SLALOM_SDLC_USAGE_ENDPOINT` used by CI) to point at a test endpoint and
force-enable tracking for manual verification of the queue/flush pipeline. This is a deliberate,
explicit action taken by whoever runs the extension — never something a client environment would
have set for itself.

### Debugging tracking

If a queue file is created under `~/.slalom-sdlc/usage-queue/` but never disappears, the flush
(the POST to Power Automate) is failing — by design this fails silently in normal operation so
tracking can never disrupt a user. To see why, opt in to verbose logging:

```
SLALOM_SDLC_USAGE_DEBUG=1 code
```

This appends one line per event to `~/.slalom-sdlc/usage-queue/.debug.log` — `enqueue`,
`flush-skip` (not enabled / already flushing / empty queue), `flush-attempt`, `flush-success`
(with HTTP status), and `flush-error` (with HTTP status or the underlying Node error code, e.g.
`ENOTFOUND`, `ECONNREFUSED`, `ETIMEDOUT`). Watch it live with:

```
tail -f ~/.slalom-sdlc/usage-queue/.debug.log
```

The log **never contains the full endpoint URL or its `sig=` SAS token** (only the hostname) and
never contains entry payload contents — it is safe to share for troubleshooting. The log file
itself is only ever created when `SLALOM_SDLC_USAGE_DEBUG` is set; normal usage has zero extra I/O.

---

## For Slalom Delivery Teams: Publishing an Update

Releases are fully automated and tag-driven — there is no version to bump and no release script to run yourself. Every release ships the same artefacts together: the VS Code extension (`.vsix`), the standalone CLI binaries, the instruction bundle (`instructions.zip` + `manifest.json`), the Claude Code plugin, and the GitHub Copilot plugin + pack (`slalom-sdlc-copilot.zip`, `slalom-sdlc-copilot-marketplace.zip`).

1. Edit whatever needs to change (instruction markdown in `devops/instructions/`, templates in `packages/core/src/templates/`, extension code, etc.) and merge it into `main` as normal.
2. Tag the merged commit with the version you want to release and push the tag:

```bash
git tag v1.2.3
git push origin v1.2.3
```

3. `.github/workflows/release.yml` picks up the tag, verifies it's actually reachable from `main`, builds and typechecks every package, verifies the committed `.github/agents/` are in sync with their templates, stamps `v1.2.3` into each package's `package.json` and `TOOL_VERSION` (this stamping happens only in the CI working tree — nothing is committed back to the repo), packages the VSIX / CLI binaries / instruction bundle / plugin / Copilot pack, republishes the `plugin-dist` and `copilot-dist` branches, and publishes the assets as one GitHub Release.
4. All consultants with the extension pick up the new instructions within 24 hours automatically. Claude Code users get it on their next `claude plugin update slalom-sdlc@slalom`. Copilot CLI/desktop users get it on their next `copilot plugin update slalom-sdlc` (or by re-running `./install.sh` from a fresh `slalom-sdlc-copilot.zip` if they installed the zip pack). Anyone installing a fresh `.vsix` or CLI binary gets `v1.2.3` baked in.

> `plugin-dist` is written by CI only. Don't commit to it, don't merge it into `main`, and don't delete it — deleting it breaks `claude plugin install`/`update` for everyone until the next release recreates it.

If a release run fails for an infrastructure reason (not a code problem), re-run it without re-tagging via **Actions → Release → Run workflow**, supplying the existing tag.

> Tags must look like `vX.Y.Z` (e.g. `v1.2.3`) and must point to a commit on `main` — the workflow rejects anything else.

### Dry-running a release before merging

Finding out a release build breaks *after* merging is worse than finding out before. To validate the exact same pipeline against an unmerged commit — a feature branch, an open PR — tag it with a semver pre-release suffix instead of a plain version, and push that tag:

```bash
git tag v1.3.0-rc.1
git push origin v1.3.0-rc.1
```

Any tag matching `vX.Y.Z-<suffix>` (e.g. `-rc.1`, `-beta.2`) skips the "must be on main" check and runs the full pipeline — build, typecheck, package VSIX/CLI binaries/instructions — from that commit. It still publishes a real GitHub Release so you can download and inspect the actual assets, but as a **prerelease, not marked "latest"** — so it's never picked up by the VS Code extension's background sync or by anyone just grabbing the latest release. For the same reason it does **not** republish `plugin-dist`: the plugin is assembled and verified, but a dry run can never become what Claude Code users install. Once you're confident, merge as normal and tag the merged commit with the real `vX.Y.Z` version.

---

## Versioning

**The git tag is the single source of truth for the release version — nothing else.** There is no version to bump by hand and no sync command to remember to run before tagging.

- Every `package.json` in this workspace (root, `core`, `mcp`, `cli`, `vscode`) and the generated `packages/core/src/version.ts` (`TOOL_VERSION`) are checked into git at a fixed placeholder, **`0.0.0`**. That's not a "current version" — it's an intentionally-fake sentinel so a locally-built artifact can never be mistaken for an official release. It never changes as part of normal development and should never be hand-edited.
- The real version only ever exists transiently, inside the release workflow's CI run: `.github/workflows/release.yml` reads it straight from the pushed tag and stamps it into the working tree with `scripts/sync-version.mjs` before building — that stamp is never committed back.
- Because of this, **version continuity lives entirely in your tag history**, not in any file in the repo. Check `git tag -l` (or the repo's Releases page) before cutting a new one, and bump from whatever the last real tag was — don't restart from `0.0.0`/`0.1.0` just because that's what you see in `package.json`.
- This repo's release history predates this scheme: earlier releases used an `instructions-v*` tag (e.g. `instructions-v0.5.0`) and only shipped the instruction bundle, with each package's version bumped and committed by hand. Those old tags and releases stay as-is. The current workflow only triggers on the new `vX.Y.Z` pattern (no prefix), and the next release should continue the same numeric sequence — e.g. if `instructions-v0.5.0` was the last one shipped, tag the next release `v0.6.0`, not `v0.1.0`.
- `vX.Y.Z-<suffix>` tags (e.g. `v1.3.0-rc.1`) are pipeline dry runs, not real releases — see [Dry-running a release before merging](#dry-running-a-release-before-merging). They don't count against the numeric sequence above; the next *real* release still picks up from the last plain `vX.Y.Z` tag.

### What to bump — MAJOR.MINOR.PATCH conventions

The version is a promise about the tool's **public surface**: `.sdlc/config.json` schema, the scaffolded `artifacts/` layout, phase commands and their menus, CLI flags, and MCP tool signatures. Judge every release against that surface, not against lines-of-code changed.

| Tier | Bump when… | Examples |
|------|------------|----------|
| **MAJOR** | An existing project or integration breaks — someone must edit config, migrate files, or relearn a command to keep working | Rename/remove a `config.json` field; remove or rename a phase command; change an MCP tool signature; a scaffold/path change with no migration path for already-scaffolded projects |
| **MINOR** | New capability, backward-compatible — existing projects keep working untouched | A new sub-command or menu option (e.g. `data-dictionary`); a new optional config field with a sensible default; a new CLI flag; additive template behavior |
| **PATCH** | Fix or polish, no interface change | Prompt wording fixes; bug fixes; typo corrections in an instruction; a purely mechanical, scaffold-only path change with no behavioral effect |

**While the tool is pre-1.0 (`0.y.z`):** there is no stability guarantee — by SemVer convention, any `0.y` release is allowed to include a breaking change. To keep that honest without freezing progress, this repo treats `0.y.z` as:

- **MINOR (`0.y.0`)** — "may include a breaking change" (per the MAJOR criteria above), called out explicitly in the release notes.
- **PATCH (`0.y.z`)** — "safe, no breaking change."

Don't cut `v1.0.0` by accident. Do it deliberately, once `.sdlc/config.json`'s schema and the set of phase commands are stable enough to promise "no breaking change without a major bump" going forward.

**Keep two things separate from the product version:**
- `manifest.json`'s `schemaVersion` field (currently `"1"`) versions the **instructions-sync protocol** between the extension and the instruction bundle — bump it only if the bundle's *format or validation* changes, never for content changes. Conflating it with the product version risks breaking older extensions' auto-sync.
- Pre-release dry-run tags (`vX.Y.Z-rc.N`) validate the pipeline and don't count against the sequence — see above.

---

## Development

### Prerequisites

- Node.js 20+
- pnpm 9+

### Setup

```bash
cd tools/slalom-sdlc
pnpm install
pnpm build          # builds all packages
pnpm typecheck      # type-checks all packages
```

### Package structure

```
tools/slalom-sdlc/
├── packages/
│   ├── core/       @sdlc/core — templates, engine, config schema, scaffold
│   ├── vscode/     slalom-sdlc — VS Code extension (GitHub Copilot chat participant)
│   ├── mcp/        slalom-sdlc-mcp — Claude Code MCP server
│   └── cli/        @sdlc/cli — standalone CLI for init/reconfigure
├── plugin/         Claude Code plugin source — manifest, .mcp.json, commands/
│                   (the built server is added at package time, never committed)
├── copilot/        GitHub Copilot pack + plugin source
│   ├── agents/     canonical *.agent.md templates (one per SDLC command)
│   ├── plugin/     marketplace plugin source — plugin.json, .mcp.json (built server added at package time)
│   ├── marketplace.json  the `slalom` marketplace manifest (version stamped at package time)
│   └── pack/       install.sh + README shipped in the release zip
└── scripts/
    ├── sync-version.mjs           — stamps a version into every package.json + TOOL_VERSION (release workflow only)
    ├── package-instructions.mjs   — release asset builder
    ├── package-plugin.mjs         — assembles plugin/ + the built MCP server into dist/plugin/
    ├── package-copilot.mjs        — assembles copilot/ + the built MCP server into dist/copilot/ (pack) and dist/copilot-plugin/ (marketplace)
    └── generate-copilot-agents.mjs — regenerates the repo's .github/agents/ from copilot/agents/ (--check for CI)
```

The repo-root `.claude-plugin/marketplace.json` is the other half of the Claude plugin — it's what `claude plugin marketplace add Slalom/salesforce-devops` reads. The repo-root `.github/plugin/marketplace.json` is its GitHub Copilot equivalent — what `copilot plugin marketplace add Slalom/salesforce-devops` reads; its plugin `source` points at the generated **`copilot-dist` branch** (`repo` + `path: plugin` + `ref: copilot-dist`), republished by the release workflow. The repo-root `.github/agents/*.agent.md` are generated from `copilot/agents/` by `generate-copilot-agents.mjs`, letting `copilot` discover the SDLC commands directly in this source repo. Regenerate them after editing any template:

```bash
node tools/slalom-sdlc/scripts/generate-copilot-agents.mjs
```

### Local builds

`pnpm build` and `pnpm typecheck` never touch versioning — every package's `package.json` and `TOOL_VERSION` stay at the checked-in `0.0.0` placeholder for local work. See [Versioning](#versioning) for why.

```bash
cd tools/slalom-sdlc
pnpm install
pnpm build          # builds all packages, TOOL_VERSION stays "0.0.0"
pnpm typecheck      # type-checks all packages
```

If you need a one-off local artifact with a real version baked in (e.g. a client VSIX, see [Distribution](#distribution)), stamp it yourself first — it's a local-only, uncommitted change:

```bash
node scripts/sync-version.mjs --version 1.2.3
pnpm -r build
```

### Building a local VSIX for testing

To try your own changes inside a real VS Code window (not just `pnpm typecheck`), build a VSIX and install it directly — no version stamping needed, the placeholder `0.0.0` is fine for this:

```bash
cd tools/slalom-sdlc
pnpm install                      # first time only
pnpm --filter @sdlc/core build    # rebuild core first — vscode depends on it via workspace:*
cd packages/vscode
pnpm package                      # → slalom-sdlc-0.0.0.vsix
```

Then in VS Code: **Extensions panel → `···` → Install from VSIX…** and pick the generated file, or from the integrated terminal:

```bash
code --install-extension slalom-sdlc-0.0.0.vsix
```

Reload the window (**Developer: Reload Window**) to pick up the new build. There's no watch/hot-reload loop for the packaged extension — every code change needs a repackage-and-reinstall cycle. If you only changed instruction markdown under `devops/instructions/` or templates under `packages/core/src/templates/`, you still need to rebuild `@sdlc/core` (step above) before repackaging `vscode`, since both are compiled into the bundle at build time (see [How It Works](#how-it-works)).

If a reload doesn't seem to pick up your rebuild (VS Code can be sticky about reinstalling the same version number), uninstall the extension from the Extensions panel first, then install the freshly-built VSIX again.

### Key scripts

| Command | What it does |
|---|---|
| `pnpm build` | Build all packages (placeholder version) |
| `pnpm typecheck` | Type-check all packages |
| `pnpm package` | Build CLI native binaries (macOS/Windows/Linux) |
| `node scripts/sync-version.mjs --version x.x.x` | Stamp a real version locally (uncommitted) — release workflow does this automatically from the tag |
| `node scripts/package-instructions.mjs --version x.x.x` | Build the instruction bundle for a GitHub Release |
| `node scripts/package-plugin.mjs --version x.x.x` | Assemble the Claude Code plugin into `dist/plugin/` |

### Architecture references

- [DESIGN.md](./DESIGN.md) — VS Code extension architecture
- [DESIGN-mcp.md](./DESIGN-mcp.md) — MCP server architecture

---

Built by Slalom UK&I
