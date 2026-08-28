import { promises as fs } from "fs";
import path from "path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { OttoConfigSchema, resolveConfigPath, type OttoConfig } from "@otto/core";
import { cmd } from "./surface.js";

// Shared server reference — set in index.ts after McpServer is created.
let _server: Server | null = null;

export function setServer(s: Server): void {
  _server = s;
}

// Once a root has been resolved (however it was resolved), it's cached for the
// rest of this process's life. The server is one long-lived stdio subprocess per
// chat session, so every tool call within that session should agree on the same
// project root — otherwise otto_init can scaffold into one directory while a
// later otto_status/otto_prompt call silently resolves a different one and
// reports "not configured". Passing an explicit `projectRoot` (see below)
// refreshes the cache so a later, more reliable answer wins over an earlier
// guess.
let cachedRoot: string | undefined;

/**
 * Resolve the project root.
 *
 * `explicitRoot`, when supplied, is the calling model's own answer — e.g. the
 * absolute working directory it already knows from its own session context —
 * and always wins. This exists because some hosts (notably GitHub Copilot
 * Desktop) do not reliably report the open workspace folder to a local MCP
 * server via either `roots/list` or the spawned process's `cwd`, which
 * otherwise makes this resolver silently pick the wrong directory: every
 * otto_* tool call still "succeeds", but reads and writes end up in whatever
 * directory the host happened to launch the server process from, not the
 * project the user is looking at.
 */
export async function resolveProjectRoot(explicitRoot?: string): Promise<string> {
  if (explicitRoot) {
    cachedRoot = path.resolve(explicitRoot);
    return cachedRoot;
  }
  if (cachedRoot) return cachedRoot;

  // 1. Explicit env var (useful for project-level .mcp.json config).
  //    Accept the new OTTO_PROJECT_ROOT and the legacy SDLC_PROJECT_ROOT.
  const envRoot = process.env.OTTO_PROJECT_ROOT ?? process.env.SDLC_PROJECT_ROOT;
  if (envRoot) {
    cachedRoot = path.resolve(envRoot);
    return cachedRoot;
  }

  // 2. MCP roots/list — Claude Code advertises the open workspace folder here
  if (_server) {
    try {
      const { roots } = await _server.listRoots();
      if (roots.length > 0) {
        const uri = roots[0].uri;
        // Roots arrive as file:// URIs
        const root = uri.startsWith("file://") ? decodeURIComponent(new URL(uri).pathname) : uri;
        if (root) {
          cachedRoot = root;
          return cachedRoot;
        }
      }
    } catch {
      // Host doesn't support roots/list — fall through
    }
  }

  // 3. Fallback: cwd of the server process
  cachedRoot = process.cwd();
  return cachedRoot;
}

export async function loadConfig(explicitRoot?: string): Promise<OttoConfig | null> {
  const root = await resolveProjectRoot(explicitRoot);
  const configPath = resolveConfigPath(root);
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = OttoConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function requireConfig(explicitRoot?: string): Promise<{ config: OttoConfig; root: string }> {
  const root = await resolveProjectRoot(explicitRoot);
  const configPath = resolveConfigPath(root);

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No Otto config found in this project. Run ${cmd("init")} to set up the project first.`
      );
    }
    throw err;
  }

  const parsed = OttoConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `Invalid Otto config — run ${cmd("init")} to reconfigure the project.`
    );
  }

  return { config: parsed.data, root };
}
