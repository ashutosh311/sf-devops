import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderPrompt, CACHE_CURRENT_DIR, type SdlcConfig, resolveProjectKey } from "@sdlc/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { readBacklogWorkbook, type BacklogStory, type BacklogEpic } from "../backlog";

// ── Types ─────────────────────────────────────────────────────────────────────

type DesignMode = "local" | "jira";

interface DesignCtx {
  root: string;
  config: SdlcConfig;
  request: vscode.ChatRequest;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
}

type EligibleStory = BacklogStory & { epicLabel: string };

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
    stream.markdown("⛔ No SDLC config found.\n\nRun `@slalom-sdlc /init` to set up the SDLC for this project.");
    return;
  }

  const ctx: DesignCtx = { root, config, request, stream, token };

  // If the user already typed a PM key in the prompt → skip menu, PM mode
  const inlineKey = extractJiraKey(request.prompt, resolveProjectKey(config));
  if (inlineKey) {
    return runAgent(ctx, request.prompt.trim());
  }

  // ── Mode picker ──────────────────────────────────────────────────────────────
  const modePick = await vscode.window.showQuickPick(
    [
      {
        label: "$(folder) Local mode",
        description: "work from backlog + refinement-notes.md — no JIRA required",
        mode: "local" as DesignMode,
      },
      {
        label: "$(cloud) JIRA mode",
        description: "fetch story status, create sub-tasks, transition in JIRA",
        mode: "jira" as DesignMode,
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

  return runAgent(ctx, userMessage);
}

// ── Local mode ────────────────────────────────────────────────────────────────

async function runLocalMode(ctx: DesignCtx): Promise<void> {
  const { root, config, stream } = ctx;

  const backlogPath = path.join(
    root, config.paths.artifacts, "discovery", "04 - Backlog", "Backlog Tracker.xlsx"
  );
  if (!fs.existsSync(backlogPath)) {
    stream.markdown(
      `⛔ No backlog found at \`${backlogPath}\`.\n\n` +
      "Run `@slalom-sdlc /discover manage-backlog` to generate the backlog first."
    );
    return;
  }

  const data = await readBacklogWorkbook(backlogPath);
  const epicMap = new Map<string, BacklogEpic>(
    (data.epics ?? []).filter((e): e is BacklogEpic & { id: string } => !!e.id).map((e) => [e.id, e])
  );

  // Find eligible stories: have refinement-notes.md but no solution-design.md yet
  const eligible: EligibleStory[] = [];
  for (const story of (data.stories ?? [])) {
    const key = story.pm_key || story.id;
    if (!key) continue;
    const epicId = (story.epic_id || "ungrouped").trim();
    const base = path.join(
      root, config.paths.artifacts, "discovery", "04 - Backlog", "stories", epicId, key
    );
    const hasRefinement = fs.existsSync(path.join(base, "refinement-notes.md"));
    const hasDesign = fs.existsSync(path.join(base, "solution-design.md"));
    if (hasRefinement && !hasDesign) {
      const epic = epicMap.get(story.epic_id ?? "");
      eligible.push({ ...story, epicLabel: epic?.name ?? epicId });
    }
  }

  if (eligible.length === 0) {
    stream.markdown(
      "ℹ️ No stories are eligible for local design.\n\n" +
      "A story is eligible when it has `refinement-notes.md` but no `solution-design.md` yet.\n\n" +
      "Run `@slalom-sdlc /discover stories-refined` to generate refinement notes from the reviewed backlog."
    );
    return;
  }

  // ── Scope picker ─────────────────────────────────────────────────────────────
  const uniqueEpicIds = [...new Set(eligible.map((s) => s.epic_id ?? "ungrouped"))];

  const scopeItems: (vscode.QuickPickItem & { value: string })[] = [
    {
      label: "$(checklist) All eligible stories",
      description: `${eligible.length} story/stories across ${uniqueEpicIds.length} epic(s)`,
      value: "all",
    },
    ...uniqueEpicIds.map((epicId) => {
      const epicStories = eligible.filter((s) => (s.epic_id ?? "ungrouped") === epicId);
      const epicLabel = epicStories[0]?.epicLabel ?? epicId;
      return {
        label: `$(symbol-class) Epic: ${epicLabel}`,
        description: `${epicStories.length} story/stories`,
        value: `epic:${epicId}`,
      };
    }),
    {
      label: "$(list-ordered) Specific story",
      description: "pick a single story",
      value: "story",
    },
  ];

  const scopePick = await vscode.window.showQuickPick(scopeItems, {
    title: "Design Agent — Local Mode",
    placeHolder: "What would you like to design?",
    ignoreFocusOut: true,
  });
  if (!scopePick) { stream.markdown("Design cancelled."); return; }

  let scoped: EligibleStory[];

  if (scopePick.value === "all") {
    scoped = eligible;
  } else if (scopePick.value.startsWith("epic:")) {
    const epicId = scopePick.value.slice(5);
    scoped = eligible.filter((s) => (s.epic_id ?? "ungrouped") === epicId);
  } else {
    // Specific story picker
    const storyItems = eligible.map((s) => ({
      label: `$(symbol-method) ${s.pm_key ?? s.id}`,
      description: s.user_story?.slice(0, 80) ?? "",
      detail: `Epic: ${s.epicLabel}`,
      storyKey: s.pm_key ?? s.id,
    }));
    const storyPick = await vscode.window.showQuickPick(storyItems, {
      title: "Design Agent — Select Story",
      placeHolder: "Choose a story to design",
      matchOnDescription: true,
      ignoreFocusOut: true,
    });
    if (!storyPick) { stream.markdown("Design cancelled."); return; }
    scoped = eligible.filter((s) => (s.pm_key ?? s.id) === storyPick.storyKey);
  }

  // ── Build context message ────────────────────────────────────────────────────
  const storyList = scoped
    .map((s) => {
      const key = s.pm_key ?? s.id;
      const epicId = (s.epic_id ?? "ungrouped").trim();
      const notesPath = `artifacts/discovery/04 - Backlog/stories/${epicId}/${key}/refinement-notes.md`;
      const designPath = `artifacts/discovery/04 - Backlog/stories/${epicId}/${key}/solution-design.md`;
      return (
        `- **${key}**: ${s.user_story?.slice(0, 100) ?? "(no description)"}\n` +
        `  Refinement notes: \`${notesPath}\`\n` +
        `  Write design to: \`${designPath}\``
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

async function runAgent(ctx: DesignCtx, userMessage: string): Promise<void> {
  const { config, request, stream, token } = ctx;

  let systemPrompt: string;
  try {
    systemPrompt = renderPrompt("design", config, { cacheDir: CACHE_CURRENT_DIR });
  } catch (err) {
    stream.markdown(`⛔ Could not render design prompt: ${String(err)}`);
    return;
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

function extractJiraKey(text: string, projectKey: string): string | undefined {
  const pattern = new RegExp(`\\b${projectKey}-\\d+\\b`, "i");
  return text.match(pattern)?.[0].toUpperCase();
}
