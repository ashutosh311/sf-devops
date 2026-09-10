import * as vscode from "vscode";
import { resolveAlmTool, resolveProjectKey, type OttoConfig } from "@otto/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { runPhaseAgent } from "./run-phase-agent";
import { mcpDisplayName } from "./agent-defer";

/**
 * Release agent — menu-first, mirroring Build/Design/Refine: an explicit
 * Local/ALM mode gate up front. Every release deploys via the Salesforce DX
 * MCP and (in ALM mode) queries/transitions the PM tool — a bare
 * `model.sendRequest` has no tool access, so this always defers to a Copilot
 * Chat agent-mode session, unlike the generic fallback handler it replaces.
 */

const INLINE_KEY_RE = /[A-Za-z][A-Za-z0-9]+-\d+/;

export async function handleRelease(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    stream.markdown("⛔ No workspace folder open. Open your project folder in VS Code first.");
    return;
  }

  const config = await loadConfig(root);
  if (!config) {
    stream.markdown("⛔ No Otto config found.\n\nRun `@otto /init` to set up Otto for this project.");
    return;
  }

  // Inline PM key(s) → skip the mode menu, direct ALM invocation.
  if (INLINE_KEY_RE.test(request.prompt)) {
    return runPhaseAgent("release", config, request, stream, token, request.prompt.trim(), {
      defer: { root, phaseLabel: "Release", mode: "alm", mcpName: mcpDisplayName(resolveAlmTool(config)) },
    });
  }

  const modePick = await vscode.window.showQuickPick(
    [
      { label: "$(folder) Local mode", description: "release notes from local artifacts — no PM tool required", value: "local" as const },
      { label: "$(cloud) ALM mode", description: "fetch Done stories from JIRA/ADO", value: "alm" as const },
    ],
    { title: "Release Agent", placeHolder: "How would you like to run the release?", ignoreFocusOut: true }
  );
  if (!modePick) { stream.markdown("Release cancelled."); return; }

  if (modePick.value === "local") {
    return runLocalMode(root, config, request, stream, token);
  }
  return runAlmMode(root, config, request, stream, token);
}

// ── Local mode ────────────────────────────────────────────────────────────────

async function runLocalMode(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const keys = await vscode.window.showInputBox({
    title: "Release Agent — Local Mode",
    prompt: "Enter the story keys to release (comma or space separated)",
    placeHolder: "PROJ-101, PROJ-102",
    ignoreFocusOut: true,
  });
  if (!keys?.trim()) { stream.markdown("Release cancelled."); return; }

  const userMessage =
    `Run local release (no PM tool). Stories to release: ${keys.trim()}\n\n` +
    `There is no PM status to query — take release notes from the local artifacts under ` +
    `\`${config.paths.artifacts}/04 - Backlog/stories/\` and \`${config.paths.artifacts}/{STORY-KEY}/\`.`;

  return runPhaseAgent("release", config, request, stream, token, userMessage, {
    defer: { root, phaseLabel: "Release", mode: "local", mcpName: "Salesforce DX" },
  });
}

// ── ALM mode ──────────────────────────────────────────────────────────────────

async function runAlmMode(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const almTool = resolveAlmTool(config);
  const projectKey = resolveProjectKey(config);
  const statusMap = (almTool === "ADO" ? config.ado?.statusMap : config.jira?.statusMap)?.story;
  const doneStatus = statusMap?.done ?? "Done";

  const scopePick = await vscode.window.showQuickPick(
    [
      { label: "$(list-ordered) Specific stories", description: `enter ${almTool} story keys`, value: "keys" as const },
      { label: `$(checklist) All stories in ${doneStatus} status`, description: `release everything eligible in ${almTool}`, value: "all" as const },
    ],
    { title: "Release Agent — ALM Mode", placeHolder: "What would you like to release?", ignoreFocusOut: true }
  );
  if (!scopePick) { stream.markdown("Release cancelled."); return; }

  let userMessage: string;
  if (scopePick.value === "keys") {
    const keys = await vscode.window.showInputBox({
      title: "Release Agent — ALM Mode",
      prompt: `Enter the ${almTool} story keys to release (comma or space separated)`,
      placeHolder: `${projectKey}-101, ${projectKey}-102`,
      ignoreFocusOut: true,
    });
    if (!keys?.trim()) { stream.markdown("Release cancelled."); return; }
    userMessage = `Release the following stories: ${keys.trim()}`;
  } else {
    userMessage = `Release all stories currently in "${doneStatus}" status in project ${projectKey}.`;
  }

  return runPhaseAgent("release", config, request, stream, token, userMessage, {
    defer: { root, phaseLabel: "Release", mode: "alm", mcpName: mcpDisplayName(almTool) },
  });
}
