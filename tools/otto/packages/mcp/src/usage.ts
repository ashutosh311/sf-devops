import * as fs from "node:fs";
import * as path from "node:path";
import { UsageQueue, USAGE_QUEUE_DIR, resolveGitIdentity, type UsageEntry } from "@otto/core";

// ─────────────────────────────────────────────────────────────────────────────
// Command usage tracking for the MCP server — the shared backend for both the
// Claude Code plugin and the GitHub Copilot pack/plugin. Same event shape,
// same queue directory (`~/.otto/usage-queue/`), and same Power Automate
// endpoint as packages/vscode/src/usage.ts, so both surfaces land in the same
// "Salesforce DevOps Log" SharePoint list / Power BI dashboard. Before this,
// adoption on the MCP-backed surfaces was invisible to that dashboard — see
// packages/vscode/src/usage.ts for the full privacy/gating writeup this file
// shares the mechanics of.
//
// PRIVACY: identical envelope to the VS Code tracker — only Command/Date/User/
// Project/Story/Model/Tokens/Comment are ever sent, never prompt or response
// text. `Model` and `Tokens` are always blank here: unlike VS Code's Language
// Model Chat API, the MCP protocol gives a local server no visibility into
// which model the host is running or how many tokens it used, so there is
// nothing honest to report for those two columns from this surface.
//
// GATE: VS Code additionally proves private-repo access via a successful
// instruction sync before enabling tracking. The MCP server has no equivalent
// signal to check — per CLAUDE.md, it never performs its own sync, it only
// ever runs on whatever was bundled at its last build (see "Instruction
// auto-update / IP protection"). So here the gate is simpler and sufficient on
// its own: endpoint presence. The build-time secret is only ever injected by
// the release workflow's "Build packages" step, which is what produces the
// packages/mcp/dist/server.js that scripts/package-plugin.mjs and
// scripts/package-copilot.mjs copy into the Claude/Copilot bundles — a client's
// own fork/rebuild of packages/mcp compiles in "" and stays inert, exactly
// like an unofficial VSIX build.
// ─────────────────────────────────────────────────────────────────────────────

/** Same SAS-URL-as-credential caveats as packages/vscode/src/usage.ts apply
 *  here — see that file for the full writeup. Injected at build time via
 *  esbuild's `define` (see esbuild.mjs), sourced from the same
 *  `OTTO_USAGE_ENDPOINT` env var the VS Code build already consumes. */
const USAGE_ENDPOINT_URL: string =
  typeof __USAGE_ENDPOINT_URL__ === "string" ? __USAGE_ENDPOINT_URL__ : "";

/** Local-developer-only override for manual testing — same variable name as
 *  the VS Code tracker so one override affects either front end you happen to
 *  be running locally. */
const ENDPOINT_ENV_OVERRIDE = "OTTO_USAGE_URL";

const USER_AGENT = "otto-mcp";

/** Same debug var/log as packages/vscode/src/usage.ts — shared queue dir means
 *  a shared log, with lines from either surface interleaved and distinguished
 *  by their `User-Agent`-equivalent context (Command/Project alone usually
 *  make the source obvious; both trackers write the same line shape). */
const DEBUG_ENV_VAR = "OTTO_USAGE_DEBUG";
const DEBUG_LOG_PATH = path.join(USAGE_QUEUE_DIR, ".debug.log");

function isDebugEnabled(): boolean {
  const v = process.env[DEBUG_ENV_VAR]?.trim().toLowerCase();
  return !!v && v !== "0" && v !== "false";
}

function writeDebugLog(line: string): void {
  if (!isDebugEnabled()) return;
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), { recursive: true });
    fs.appendFileSync(DEBUG_LOG_PATH, `${new Date().toISOString()} [mcp] ${line}\n`, "utf-8");
  } catch {
    // debug logging must never disrupt tracking or the user
  }
}

function resolveEndpoint(): string {
  const override = process.env[ENDPOINT_ENV_OVERRIDE]?.trim();
  return override && override.length > 0 ? override : USAGE_ENDPOINT_URL;
}

function isEnabled(): boolean {
  return resolveEndpoint().length > 0;
}

const queue = new UsageQueue();
let cachedUser: string | undefined;

async function resolveUser(cwd: string): Promise<string> {
  if (cachedUser) return cachedUser;
  cachedUser = await resolveGitIdentity(cwd);
  return cachedUser;
}

/**
 * Record one completed command. Fire-and-forget from every call site — never
 * throws, never awaited by the caller, never disrupts the tool response.
 */
export async function trackCommand(fields: {
  command: string;
  project?: string;
  story?: string;
  cwd: string;
}): Promise<void> {
  if (!isEnabled()) return;
  const entry: UsageEntry = {
    Command: fields.command,
    Date: new Date().toISOString(),
    User: await resolveUser(fields.cwd),
    Project: fields.project ?? "",
    Story: fields.story ?? "",
    Model: "",
    Tokens: 0,
    Comment: "",
  };
  queue.enqueue(entry, writeDebugLog);
  void queue.flush(resolveEndpoint(), USER_AGENT, writeDebugLog);
}
