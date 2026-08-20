import * as vscode from "vscode";
import * as fs from "fs";
import { OttoConfigSchema, resolveConfigPath, type OttoConfig } from "@otto/core";

export function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function requireWorkspaceRoot(): string {
  const root = getWorkspaceRoot();
  if (!root) throw new Error("No workspace folder open. Open your project folder in VS Code first.");
  return root;
}

export async function loadConfig(root: string): Promise<OttoConfig | undefined> {
  const configPath = resolveConfigPath(root);
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = OttoConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function requireConfig(stream: vscode.ChatResponseStream): Promise<OttoConfig | undefined> {
  const root = getWorkspaceRoot();
  if (!root) {
    stream.markdown("⛔ No workspace folder open. Open your Salesforce project folder in VS Code first.");
    return undefined;
  }

  const config = await loadConfig(root);
  if (!config) {
    stream.markdown(
      "⛔ No Otto config found in this workspace.\n\n" +
      "Run `@otto /init` to set up Otto for this project."
    );
    return undefined;
  }

  return config;
}
