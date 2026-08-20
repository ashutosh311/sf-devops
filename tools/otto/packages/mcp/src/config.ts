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

export async function resolveProjectRoot(): Promise<string> {
  // 1. Explicit env var (useful for project-level .mcp.json config).
  //    Accept the new OTTO_PROJECT_ROOT and the legacy SDLC_PROJECT_ROOT.
  const envRoot = process.env.OTTO_PROJECT_ROOT ?? process.env.SDLC_PROJECT_ROOT;
  if (envRoot) {
    return path.resolve(envRoot);
  }

  // 2. MCP roots/list — Claude Code advertises the open workspace folder here
  if (_server) {
    try {
      const { roots } = await _server.listRoots();
      if (roots.length > 0) {
        const uri = roots[0].uri;
        // Roots arrive as file:// URIs
        const root = uri.startsWith("file://") ? decodeURIComponent(new URL(uri).pathname) : uri;
        if (root) return root;
      }
    } catch {
      // Host doesn't support roots/list — fall through
    }
  }

  // 3. Fallback: cwd of the server process
  return process.cwd();
}

export async function loadConfig(): Promise<OttoConfig | null> {
  const root = await resolveProjectRoot();
  const configPath = resolveConfigPath(root);
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = OttoConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function requireConfig(): Promise<{ config: OttoConfig; root: string }> {
  const root = await resolveProjectRoot();
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
