import * as vscode from "vscode";
import * as path from "node:path";
import { resolveAlmTool, resolveProjectKey, type OttoConfig } from "@otto/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { scanEligibleStories, pickStoryScope, storyFolderPath } from "./backlog-scope";
import { runPhaseAgent } from "./run-phase-agent";

/**
 * Test agent — menu-first, mirroring Build/Design/Refine: an explicit mode gate
 * up front instead of the agent asking in-flow which mode to run in. Test has no
 * Data Dictionary option (that stays with Discover/Refine/Design/Build, which own
 * the dictionary's conceptual/inferred/logical/physical fidelity tiers).
 */

const INLINE_KEY_RE = /[A-Za-z][A-Za-z0-9]+-\d+/;

export async function handleTest(
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

  // Inline PM key → skip the menu, direct ALM invocation.
  if (INLINE_KEY_RE.test(request.prompt)) {
    return runPhaseAgent("test", config, request, stream, token, request.prompt.trim());
  }

  // ── Mode picker ─────────────────────────────────────────────────────────────
  const modePick = await vscode.window.showQuickPick(
    [
      { label: "$(folder) Local mode", description: "work from implementation-record.md — no PM tool required", value: "local" as const },
      { label: "$(cloud) ALM mode", description: "fetch story status, raise defects, transition in JIRA/ADO", value: "alm" as const },
    ],
    { title: "Test Agent", placeHolder: "How would you like to run testing?", ignoreFocusOut: true }
  );
  if (!modePick) { stream.markdown("Test cancelled."); return; }

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
    requireFiles: ["implementation-record.md"],
    excludeFiles: ["test-execution-record.md"],
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
      "ℹ️ No stories are eligible for local testing.\n\n" +
      "A story is eligible when it has `implementation-record.md` but no `test-execution-record.md` yet.\n\n" +
      "Run `@otto /build` to build the story first."
    );
    return;
  }

  const scoped = await pickStoryScope(eligible, "Test Agent — Local Mode");
  if (!scoped) { stream.markdown("Test cancelled."); return; }

  const storyList = scoped
    .map((s) => {
      const folder = path.relative(root, storyFolderPath(root, config, s));
      return (
        `- **${s.storyKey}**: ${s.user_story?.slice(0, 100) ?? "(no description)"}\n` +
        `  Acceptance criteria: \`${path.join(folder, "refinement-notes.md")}\`\n` +
        `  Implementation record: \`${path.join(folder, "implementation-record.md")}\`\n` +
        `  Write test execution record to: \`${path.join(folder, "test-execution-record.md")}\``
      );
    })
    .join("\n");

  const userMessage =
    `Run local testing (no PM tool). Stories to test:\n\n${storyList}\n\n` +
    `For each story: load its acceptance criteria, execute the test cases in the sandbox org, ` +
    `and write \`test-execution-record.md\` in the same folder (no JIRA/ADO transitions or defect raising).`;

  return runPhaseAgent("test", config, request, stream, token, userMessage);
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
      { label: "$(checklist) All stories in Ready for Test status", description: `test everything eligible in ${almTool}`, value: "all" as const },
    ],
    { title: "Test Agent — ALM Mode", placeHolder: "What would you like to test?", ignoreFocusOut: true }
  );
  if (!scopePick) { stream.markdown("Test cancelled."); return; }

  let userMessage: string;
  if (scopePick.value === "key") {
    const key = await vscode.window.showInputBox({
      title: "Test Agent — ALM Mode",
      prompt: `Enter the ${almTool} story key`,
      placeHolder: `${projectKey}-123`,
      ignoreFocusOut: true,
    });
    if (!key?.trim()) { stream.markdown("Test cancelled."); return; }
    userMessage = key.trim();
  } else {
    userMessage = `Test all stories currently in Ready for Test status in project ${projectKey}.`;
  }

  return runPhaseAgent("test", config, request, stream, token, userMessage);
}
