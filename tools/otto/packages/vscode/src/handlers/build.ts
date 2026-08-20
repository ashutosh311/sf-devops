import * as vscode from "vscode";
import * as path from "node:path";
import { resolveAlmTool, resolveProjectKey, type OttoConfig } from "@otto/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { isDataDictionaryToken, openDataDictionary } from "./data-dictionary";
import { scanEligibleStories, pickStoryScope, storyFolderPath } from "./backlog-scope";
import { runPhaseAgent } from "./run-phase-agent";

/**
 * Build agent — menu-first, mirroring Design/Refine: an explicit action + mode
 * gate up front instead of the agent asking in-flow which mode to run in. Build
 * also owns the **Physical** fidelity refresh of the data dictionary (it's the
 * only agent that writes to `force-app/`), so Data Dictionary is offered as a
 * top-level action alongside the build flow itself.
 */

const INLINE_KEY_RE = /[A-Za-z][A-Za-z0-9]+-\d+/;

export async function handleBuild(
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

  // Data dictionary token → run immediately.
  if (isDataDictionaryToken(request.prompt)) {
    return openDataDictionary(root, config, request, stream, "build");
  }

  // Inline PM key → skip all menus, direct ALM invocation.
  if (INLINE_KEY_RE.test(request.prompt)) {
    return runPhaseAgent("build", config, request, stream, token, request.prompt.trim());
  }

  // ── Top-level action menu ──────────────────────────────────────────────────
  const action = await vscode.window.showQuickPick(
    [
      { label: "$(tools) Build a story", description: "scaffold, test, and deploy a Ready-for-Build story", value: "build" as const },
      { label: "$(book) Data Dictionary", description: "reconcile object-reference docs against deployed metadata + org (Physical fidelity)", value: "data-dictionary" as const },
    ],
    { title: "Build Agent", placeHolder: "What would you like to do?", ignoreFocusOut: true }
  );
  if (!action) { stream.markdown("Build cancelled."); return; }

  if (action.value === "data-dictionary") {
    return openDataDictionary(root, config, request, stream, "build");
  }

  // ── Mode picker ─────────────────────────────────────────────────────────────
  const modePick = await vscode.window.showQuickPick(
    [
      { label: "$(folder) Local mode", description: "work from solution-design.md — no PM tool required", value: "local" as const },
      { label: "$(cloud) ALM mode", description: "fetch story status, deploy, transition in JIRA/ADO", value: "alm" as const },
    ],
    { title: "Build Agent", placeHolder: "How would you like to run the build?", ignoreFocusOut: true }
  );
  if (!modePick) { stream.markdown("Build cancelled."); return; }

  if (modePick.value === "local") {
    return runLocalMode(root, config, request, stream, token);
  }
  return runAlmMode(config, request, stream, token);
}

// ── Local mode ────────────────────────────────────────────────────────────────

async function runLocalMode(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const { eligible, backlogPath, backlogExists } = await scanEligibleStories(root, config, {
    requireFiles: ["solution-design.md"],
    excludeFiles: ["implementation-record.md"],
  });

  if (!backlogExists) {
    stream.markdown(
      `⛔ No backlog found at \`${backlogPath}\`.\n\n` +
      "Run `@otto /discover manage-backlog` to generate the backlog first."
    );
    return;
  }
  if (eligible.length === 0) {
    stream.markdown(
      "ℹ️ No stories are eligible for local build.\n\n" +
      "A story is eligible when it has `solution-design.md` but no `implementation-record.md` yet.\n\n" +
      "Run `@otto /design` to produce a solution design first."
    );
    return;
  }

  const scoped = await pickStoryScope(eligible, "Build Agent — Local Mode");
  if (!scoped) { stream.markdown("Build cancelled."); return; }

  const storyList = scoped
    .map((s) => {
      const folder = path.relative(root, storyFolderPath(root, config, s));
      return (
        `- **${s.storyKey}**: ${s.user_story?.slice(0, 100) ?? "(no description)"}\n` +
        `  Solution design: \`${path.join(folder, "solution-design.md")}\`\n` +
        `  Write implementation record to: \`${path.join(folder, "implementation-record.md")}\``
      );
    })
    .join("\n");

  const userMessage =
    `Run local build (no PM tool). Stories to build:\n\n${storyList}\n\n` +
    `For each story: read its \`solution-design.md\`, implement the components in ` +
    `dependency order, deploy to the sandbox org, and write \`implementation-record.md\` ` +
    `in the same folder (no JIRA/ADO transitions).`;

  return runPhaseAgent("build", config, request, stream, token, userMessage);
}

// ── ALM mode ──────────────────────────────────────────────────────────────────

async function runAlmMode(
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const almTool = resolveAlmTool(config);
  const projectKey = resolveProjectKey(config);

  const scopePick = await vscode.window.showQuickPick(
    [
      { label: "$(list-ordered) Specific story", description: `enter a ${almTool} key`, value: "key" as const },
      { label: "$(checklist) All stories in Ready for Build status", description: `build everything eligible in ${almTool}`, value: "all" as const },
    ],
    { title: "Build Agent — ALM Mode", placeHolder: "What would you like to build?", ignoreFocusOut: true }
  );
  if (!scopePick) { stream.markdown("Build cancelled."); return; }

  let userMessage: string;
  if (scopePick.value === "key") {
    const key = await vscode.window.showInputBox({
      title: "Build Agent — ALM Mode",
      prompt: `Enter the ${almTool} story key`,
      placeHolder: `${projectKey}-123`,
      ignoreFocusOut: true,
    });
    if (!key?.trim()) { stream.markdown("Build cancelled."); return; }
    userMessage = key.trim();
  } else {
    userMessage = `Build all stories currently in Ready for Build status in project ${projectKey}.`;
  }

  return runPhaseAgent("build", config, request, stream, token, userMessage);
}
