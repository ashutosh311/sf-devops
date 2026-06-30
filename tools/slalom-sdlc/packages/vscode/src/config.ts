import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { SdlcConfigSchema, type SdlcConfig } from "@sdlc/core";

export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function requireWorkspaceRoot(): string {
  const root = getWorkspaceRoot();
  if (!root) throw new Error("No workspace folder open. Open your project folder in VS Code first.");
  return root;
}

export async function loadConfig(root: string): Promise<SdlcConfig | undefined> {
  const configPath = path.join(root, ".sdlc", "config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = SdlcConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function requireConfig(stream: vscode.ChatResponseStream): Promise<SdlcConfig | undefined> {
  const root = getWorkspaceRoot();
  if (!root) {
    stream.markdown("⛔ No workspace folder open. Open your Salesforce project folder in VS Code first.");
    return undefined;
  }

  const config = await loadConfig(root);
  if (!config) {
    stream.markdown(
      "⛔ No SDLC config found in this workspace.\n\n" +
      "Run `@slalom-sdlc /init` to set up the SDLC for this project."
    );
    return undefined;
  }

  return config;
}
