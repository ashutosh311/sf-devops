import { promises as fs } from "fs";
import path from "path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SdlcConfigSchema, type SdlcConfig } from "@sdlc/core";
import { cmd } from "./surface.js";

// Shared server reference — set in index.ts after McpServer is created.
let _server: Server | null = null;

export function setServer(s: Server): void {
  _server = s;
}

export async function resolveProjectRoot(): Promise<string> {
  // 1. Explicit env var (useful for project-level .mcp.json config)
  if (process.env.SDLC_PROJECT_ROOT) {
    return path.resolve(process.env.SDLC_PROJECT_ROOT);
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

export async function loadConfig(): Promise<SdlcConfig | null> {
  const root = await resolveProjectRoot();
  const configPath = path.join(root, ".sdlc", "config.json");
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = SdlcConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function requireConfig(): Promise<{ config: SdlcConfig; root: string }> {
  const root = await resolveProjectRoot();
  const configPath = path.join(root, ".sdlc", "config.json");

  let raw: string;
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No .sdlc/config.json found in this project. Run ${cmd("init")} to set up the project first.`
      );
    }
    throw err;
  }

  const parsed = SdlcConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `Invalid .sdlc/config.json — run ${cmd("init")} to reconfigure the project.`
    );
  }

  return { config: parsed.data, root };
}
