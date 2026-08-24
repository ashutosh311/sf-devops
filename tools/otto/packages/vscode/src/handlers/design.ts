import * as vscode from "vscode";
import * as path from "node:path";
import { renderPrompt, CACHE_CURRENT_DIR, type OttoConfig, resolveProjectKey, resolveAlmTool, extractStoryKey } from "@otto/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { isDataDictionaryToken, openDataDictionary } from "./data-dictionary";
import { scanEligibleStories, pickStoryScope, storyFolderPath, type EligibleStory } from "./backlog-scope";
import { openPromptInAgentMode, mcpDisplayName } from "./agent-defer";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DesignCtx {
  root: string;
  config: OttoConfig;
  request: vscode.ChatRequest;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function handleDesign(
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

  const ctx: DesignCtx = { root, config, request, stream, token };

  // Data dictionary: explicit token → run immediately.
  if (isDataDictionaryToken(request.prompt)) {
    return openDataDictionary(root, config, request, stream, "design");
  }

  // If the user already typed a PM key in the prompt → skip menu, PM mode
  const inlineKey = extractStoryKey(request.prompt, resolveProjectKey(config));
  if (inlineKey) {
    return runAgent(ctx, request.prompt.trim(), { defer: true });
  }

  // ── Top-level action menu ────────────────────────────────────────────────────
  const action = await vscode.window.showQuickPick(
    [
      { label: "$(rocket) Design a story", description: "solution design, data model, sub-tasks", value: "design" as const },
      { label: "$(book) Data Dictionary", description: "build/maintain object-reference docs (Logical fidelity)", value: "data-dictionary" as const },
    ],
    { title: "Design Agent", placeHolder: "What would you like to do?", ignoreFocusOut: true }
  );
  if (!action) { stream.markdown("Design cancelled."); return; }

  if (action.value === "data-dictionary") {
    return openDataDictionary(root, config, request, stream, "design");
  }

  // ── Mode picker ──────────────────────────────────────────────────────────────
  const modePick = await vscode.window.showQuickPick(
    [
      {
        label: "$(folder) Local mode",
        description: "work from backlog + refinement-notes.md — no JIRA required",
        mode: "local" as const,
      },
      {
        label: "$(cloud) JIRA mode",
        description: "fetch story status, create sub-tasks, transition in JIRA",
        mode: "jira" as const,
      },
    ],
    {
      title: "Design Agent",
      placeHolder: "How would you like to run the design?",
      ignoreFocusOut: true,
    }
  );
  if (!modePick) { stream.markdown("Design cancelled."); return; }

  if (modePick.mode === "jira") {
    return runJiraMode(ctx);
  }
  return runLocalMode(ctx);
}

// ── JIRA mode ─────────────────────────────────────────────────────────────────

async function runJiraMode(ctx: DesignCtx): Promise<void> {
  const { config, stream } = ctx;

  const scopePick = await vscode.window.showQuickPick(
    [
      {
        label: "$(list-ordered) Specific story or epic",
        description: "enter a JIRA key",
        scope: "key",
      },
      {
        label: "$(checklist) All stories in Ready for Design",
        description: "design everything eligible in JIRA",
        scope: "all",
      },
    ],
    {
      title: "Design Agent — JIRA Mode",
      placeHolder: "What would you like to design?",
      ignoreFocusOut: true,
    }
  );
  if (!scopePick) { stream.markdown("Design cancelled."); return; }

  let userMessage: string;
  if (scopePick.scope === "key") {
    const key = await vscode.window.showInputBox({
      title: "Design Agent — JIRA Mode",
      prompt: "Enter the JIRA story or epic key",
    placeHolder: `${resolveProjectKey(config)}-123`,
      ignoreFocusOut: true,
    });
    if (!key?.trim()) { stream.markdown("Design cancelled."); return; }
    userMessage = key.trim();
  } else {
    userMessage = `Design all stories currently in "Ready for Design" status in project ${resolveProjectKey(config)}.`;
  }

  return runAgent(ctx, userMessage, { defer: true });
}

// ── Local mode ────────────────────────────────────────────────────────────────

async function runLocalMode(ctx: DesignCtx): Promise<void> {
  const { root, config, stream } = ctx;

  const { eligible, backlogPath, backlogExists } = await scanEligibleStories(root, config, {
    requireFiles: ["refinement-notes.md"],
    excludeFiles: ["solution-design.md"],
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
      "ℹ️ No stories are eligible for local design.\n\n" +
      "A story is eligible when it has `refinement-notes.md` but no `solution-design.md` yet.\n\n" +
      "Run `@otto /discover stories-refined` to generate refinement notes from the reviewed backlog."
    );
    return;
  }

  const scoped = await pickStoryScope(eligible, "Design Agent — Local Mode");
  if (!scoped) { stream.markdown("Design cancelled."); return; }

  // ── Build context message ────────────────────────────────────────────────────
  const storyList = scoped
    .map((s: EligibleStory) => {
      const folder = path.relative(root, storyFolderPath(root, config, s));
      return (
        `- **${s.storyKey}**: ${s.user_story?.slice(0, 100) ?? "(no description)"}\n` +
        `  Refinement notes: \`${path.join(folder, "refinement-notes.md")}\`\n` +
        `  Write design to: \`${path.join(folder, "solution-design.md")}\``
      );
    })
    .join("\n");

  const userMessage =
    `Run local design (no JIRA). Stories to design:\n\n${storyList}\n\n` +
    `For each story: read its \`refinement-notes.md\`, produce \`solution-design.md\` ` +
    `and \`sf-discovery.md\` in the same folder. Record implementation sub-tasks ` +
    `inside \`solution-design.md\` (no JIRA sub-task creation).`;

  return runAgent(ctx, userMessage);
}

// ── Shared agent runner ───────────────────────────────────────────────────────

async function runAgent(ctx: DesignCtx, userMessage: string, opts?: { defer?: boolean }): Promise<void> {
  const { config, request, stream, token } = ctx;

  let systemPrompt: string;
  try {
    systemPrompt = renderPrompt("design", config, { cacheDir: CACHE_CURRENT_DIR });
  } catch (err) {
    stream.markdown(`⛔ Could not render design prompt: ${String(err)}`);
    return;
  }

  // ALM mode must fetch the latest design from the PM tool, reconcile local working
  // copies, create sub-tasks, and transition the story — work that needs agent-mode
  // tool access. A bare model.sendRequest has no tools, so defer to a Copilot Chat
  // agent session.
  if (opts?.defer) {
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
    return openPromptInAgentMode({
      root: ctx.root,
      phase: "design",
      phaseLabel: "Design",
      mcpName: mcpDisplayName(resolveAlmTool(config)),
      fullPrompt,
      stream,
    });
  }

  const model = request.model;
  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
    vscode.LanguageModelChatMessage.User(userMessage),
  ];

  // Token guard
  try {
    const total =
      (await model.countTokens(messages[0], token)) +
      (await model.countTokens(messages[1], token));
    const pct = Math.round((total / model.maxInputTokens) * 100);
    if (pct >= 95) {
      stream.markdown(
        `⛔ Prompt is too large (${total.toLocaleString()} / ${model.maxInputTokens.toLocaleString()} tokens, ${pct}%). ` +
        `Try a model with a larger context window or start a new chat session.`
      );
      return;
    }
    if (pct >= 80) {
      stream.markdown(
        `⚠️ Prompt is using ${pct}% of this model's input limit. Consider starting a new session after this step.\n\n`
      );
    }
  } catch { /* countTokens not available on all model versions */ }

  try {
    const response = await model.sendRequest(messages, {}, token);
    for await (const chunk of response.text) {
      stream.markdown(chunk);
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "NoPermissions") {
      stream.markdown("⛔ Copilot access required. Sign in to GitHub Copilot and try again.");
    } else if (code === "Blocked") {
      stream.markdown("⛔ Request blocked — quota or content policy limit reached. Try again shortly.");
    } else {
      stream.markdown(`⛔ Model error: ${String(err)}`);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

