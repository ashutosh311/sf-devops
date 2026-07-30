import * as vscode from "vscode";
import * as path from "node:path";
import {
  renderPrompt,
  CACHE_CURRENT_DIR,
  DEFAULT_PATHS,
  DEFAULT_STANDARDS,
  CONFIG_VERSION,
  TOOL_VERSION,
  type SdlcConfig,
  type StoryStatusMap,
  type EpicStatusMap,
  type SubTaskStatusMap,
  resolveProjectKey,
  resolveAlmTool,
  extractStoryKey,
} from "@sdlc/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { isDataDictionaryToken, openDataDictionary } from "./data-dictionary";
import { scanEligibleStories, pickStoryScope, storyFolderPath } from "./backlog-scope";

type JiraStatusMap = { story: StoryStatusMap; epic: EpicStatusMap; subTask: SubTaskStatusMap };

const DEFAULT_STATUS_MAP: JiraStatusMap = {
  story: {
    backlog:          "Backlog",
    refineInProgress: "In Refinement",
    readyForDesign:   "Ready for Design",
    designInProgress: "In Design",
    readyForBuild:    "Ready for Build",
    inDevelopment:    "In Development",
    readyForTest:     "Ready for Test",
    done:             "Done",
  },
  epic:    { notStarted: "To Do", inProgress: "In Progress", done: "Done" },
  subTask: { todo: "To Do", inDevelopment: "In Progress", readyForTest: "In Review", done: "Done" },
};

const INLINE_KEY_RE = /[A-Za-z][A-Za-z0-9]+-\d+/;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function handleRefine(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const root = getWorkspaceRoot();
  const existingConfig = root ? await loadConfig(root) : undefined;

  // Data dictionary token → run immediately, no JIRA/config prompts required.
  if (root && isDataDictionaryToken(request.prompt)) {
    const ddConfig = existingConfig ?? buildMinimalConfig("", path.basename(root));
    return openDataDictionary(root, ddConfig, request, stream, "refine");
  }

  // Inline PM key (e.g. "/refine PROJ-42") → skip all menus, direct ALM invocation.
  if (root && INLINE_KEY_RE.test(request.prompt)) {
    const config = existingConfig ?? await promptForJiraConfig(stream);
    if (!config) return;
    return runRefineAgent(config, request, stream, token, request.prompt.trim());
  }

  if (!root) {
    stream.markdown("⛔ No workspace folder open. Open your project folder in VS Code first.");
    return;
  }

  // ── Top-level action menu ────────────────────────────────────────────────────
  const action = await vscode.window.showQuickPick(
    [
      { label: "$(checklist) Refine a story", description: "add Gherkin acceptance criteria + business context", value: "refine" as const },
      { label: "$(book) Data Dictionary", description: "build/maintain object-reference docs (Inferred fidelity)", value: "data-dictionary" as const },
    ],
    { title: "Refine Agent", placeHolder: "What would you like to do?", ignoreFocusOut: true }
  );
  if (!action) { stream.markdown("Refinement cancelled."); return; }

  if (action.value === "data-dictionary") {
    const ddConfig = existingConfig ?? buildMinimalConfig("", path.basename(root));
    return openDataDictionary(root, ddConfig, request, stream, "refine");
  }

  // ── Mode menu (replaces the model asking "local or ALM?" in-flow) ───────────
  const modePick = await vscode.window.showQuickPick(
    [
      { label: "$(folder) Local mode", description: "work from the local backlog — no PM tool required", value: "local" as const },
      { label: "$(cloud) ALM mode", description: "fetch story status, write AC, transition in JIRA/ADO", value: "alm" as const },
    ],
    { title: "Refine Agent", placeHolder: "How would you like to run refinement?", ignoreFocusOut: true }
  );
  if (!modePick) { stream.markdown("Refinement cancelled."); return; }

  if (modePick.value === "local") {
    return runLocalMode(root, existingConfig ?? buildMinimalConfig("", path.basename(root)), request, stream, token);
  }
  return runAlmMode(root, existingConfig, request, stream, token);
}

// ── Local mode ────────────────────────────────────────────────────────────────

async function runLocalMode(
  root: string,
  config: SdlcConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const { eligible, backlogPath, backlogExists } = await scanEligibleStories(root, config, {
    requireFiles: [],
    excludeFiles: ["refinement-notes.md"],
  });

  if (!backlogExists) {
    stream.markdown(
      `⛔ No backlog found at \`${backlogPath}\`.\n\n` +
      "Run `@slalom-sdlc /discover manage-backlog` to generate the backlog first."
    );
    return;
  }
  if (eligible.length === 0) {
    stream.markdown(
      "ℹ️ No stories are eligible for local refinement.\n\n" +
      "A story is eligible when it doesn't have `refinement-notes.md` yet."
    );
    return;
  }

  const scoped = await pickStoryScope(eligible, "Refine Agent — Local Mode");
  if (!scoped) { stream.markdown("Refinement cancelled."); return; }

  const storyList = scoped
    .map((s) => {
      const notesPath = path.relative(root, path.join(storyFolderPath(root, config, s), "refinement-notes.md"));
      return `- **${s.storyKey}**: ${s.user_story?.slice(0, 100) ?? "(no description)"}\n  Write refinement notes to: \`${notesPath}\``;
    })
    .join("\n");

  const userMessage =
    `Run local refinement (no PM tool). Stories to refine:\n\n${storyList}\n\n` +
    `For each story: validate INVEST, write Gherkin acceptance criteria and business context, ` +
    `and write \`refinement-notes.md\` to the path listed above.`;

  return runRefineAgent(config, request, stream, token, userMessage);
}

// ── ALM mode ──────────────────────────────────────────────────────────────────

async function runAlmMode(
  root: string,
  existingConfig: SdlcConfig | undefined,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const config = existingConfig ?? await promptForJiraConfig(stream);
  if (!config) return;

  const almTool = resolveAlmTool(config);
  const projectKey = resolveProjectKey(config);

  const scopePick = await vscode.window.showQuickPick(
    [
      { label: "$(list-ordered) Specific story", description: `enter a ${almTool} key`, value: "key" as const },
      { label: "$(checklist) All stories in Backlog status", description: `refine everything eligible in ${almTool}`, value: "all" as const },
    ],
    { title: "Refine Agent — ALM Mode", placeHolder: "What would you like to refine?", ignoreFocusOut: true }
  );
  if (!scopePick) { stream.markdown("Refinement cancelled."); return; }

  let userMessage: string;
  if (scopePick.value === "key") {
    const key = await vscode.window.showInputBox({
      title: "Refine Agent — ALM Mode",
      prompt: `Enter the ${almTool} story key`,
      placeHolder: `${projectKey}-123`,
      ignoreFocusOut: true,
    });
    if (!key?.trim()) { stream.markdown("Refinement cancelled."); return; }
    userMessage = key.trim();
  } else {
    userMessage = `Refine all stories currently in Backlog status in project ${projectKey}.`;
  }

  return runRefineAgent(config, request, stream, token, userMessage);
}

// ── Shared model call ────────────────────────────────────────────────────────

async function runRefineAgent(
  config: SdlcConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  userMessage: string
): Promise<void> {
  let systemPrompt: string;
  try {
    systemPrompt = renderPrompt("refine", config, { cacheDir: CACHE_CURRENT_DIR });
  } catch (err) {
    stream.markdown(`⛔ Could not render refine prompt: ${String(err)}`);
    return;
  }

  // Substitute the story key if the user message contains one (e.g. "PROJ-42")
  const storyKey = extractStoryKey(userMessage, resolveProjectKey(config));
  if (storyKey) {
    systemPrompt = systemPrompt
      .replace(/\{STORY_KEY\}/g, storyKey)
      .replace(/\{TICKET_KEY\}/g, storyKey);
  }

  const model = request.model;
  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
    vscode.LanguageModelChatMessage.User(userMessage),
  ];

  try {
    const promptTokens = await model.countTokens(messages[0], token);
    const userTokens   = await model.countTokens(messages[1], token);
    const totalTokens  = promptTokens + userTokens;
    const limit        = model.maxInputTokens;
    const pct          = Math.round((totalTokens / limit) * 100);

    if (pct >= 95) {
      stream.markdown(
        `⛔ Prompt is too large for this model (${totalTokens.toLocaleString()} / ${limit.toLocaleString()} tokens, ${pct}%). ` +
        `Try a model with a larger context window or start a new chat session.`
      );
      return;
    }
    if (pct >= 80) {
      stream.markdown(
        `⚠️ Prompt is using ${pct}% of this model's input limit ` +
        `(${totalTokens.toLocaleString()} / ${limit.toLocaleString()} tokens). ` +
        `Consider starting a new session after this step.\n\n`
      );
    }
  } catch {
    // countTokens not available on all model versions — continue.
  }

  try {
    const response = await model.sendRequest(messages, {}, token);
    for await (const chunk of response.text) {
      stream.markdown(chunk);
    }
  } catch (err) {
    if ((err as { code?: string }).code === "NoPermissions") {
      stream.markdown("⛔ Copilot access is required. Sign in to GitHub Copilot and try again.");
    } else if ((err as { code?: string }).code === "Blocked") {
      stream.markdown("⛔ Request blocked — quota or content policy limit reached. Try again shortly or switch model.");
    } else {
      stream.markdown(`⛔ Model error: ${String(err)}`);
    }
  }
}

// ── Config helpers ───────────────────────────────────────────────────────────

async function promptForJiraConfig(stream: vscode.ChatResponseStream): Promise<SdlcConfig | undefined> {
  stream.markdown(
    "No `.sdlc/config.json` found — running in lightweight mode.\n\n" +
    "JIRA status labels and paths will use defaults. " +
    "Run `@slalom-sdlc /init` any time to persist your project settings.\n\n"
  );

  const jiraSite = await vscode.window.showInputBox({
    title: "JIRA Site URL",
    prompt: "Your Atlassian site URL (e.g. https://mycompany.atlassian.net)",
    placeHolder: "https://mycompany.atlassian.net",
    ignoreFocusOut: true,
    validateInput: (v) => {
      try { new URL(v); return null; } catch { return "Enter a valid URL"; }
    },
  });
  if (!jiraSite) {
    stream.markdown("Refinement cancelled.");
    return undefined;
  }

  const jiraKey = await vscode.window.showInputBox({
    title: "JIRA Project Key",
    prompt: "Your JIRA project key (e.g. PROJ, KAN, SF)",
    placeHolder: "PROJ",
    ignoreFocusOut: true,
    validateInput: (v) => (/^[A-Z0-9]+$/i.test(v.trim()) ? null : "Enter a valid project key (letters/numbers only)"),
  });
  if (!jiraKey) {
    stream.markdown("Refinement cancelled.");
    return undefined;
  }

  return buildMinimalConfig(jiraSite.trim(), jiraKey.trim().toUpperCase());
}

function buildMinimalConfig(jiraSite: string, jiraKey: string): SdlcConfig {
  return {
    version:      CONFIG_VERSION,
    generatedAt:  new Date().toISOString(),
    toolVersion:  TOOL_VERSION,
    project: {
      name:      jiraKey,
      jiraKey,
      jiraSite,
      jiraEmail: "",
    },
    phases:     ["refine"],
    team:       { sprintLengthWeeks: 2, estimationApproach: "ta-assigns" },
    salesforce: { orgs: { sandbox: "sandbox" } },
    standards:  DEFAULT_STANDARDS,
    jira:       { statusMap: DEFAULT_STATUS_MAP },
    branching:  "gitflow",
    paths:      DEFAULT_PATHS,
  };
}
