import * as vscode from "vscode";
import {
  renderPrompt,
  CACHE_CURRENT_DIR,
  DEFAULT_PATHS,
  DEFAULT_STANDARDS,
  CONFIG_VERSION,
  TOOL_VERSION,
  type SdlcConfig,
} from "@sdlc/core";
import { getWorkspaceRoot, loadConfig } from "../config";

// Sensible defaults for JIRA status names — cover the majority of Jira Cloud
// setups without requiring a full /init. Users with custom status names can
// run /init to persist their overrides.
const DEFAULT_STATUS_MAP: SdlcConfig["jira"]["statusMap"] = {
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

export async function handleRefine(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  // Try to load the project config — not required; fall back to a minimal
  // config built from just the JIRA site and project key.
  const root = getWorkspaceRoot();
  const existingConfig = root ? await loadConfig(root) : undefined;

  let config: SdlcConfig;

  if (existingConfig) {
    config = existingConfig;
  } else {
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
      return;
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
      return;
    }

    config = buildMinimalConfig(jiraSite.trim(), jiraKey.trim().toUpperCase());
  }

  let systemPrompt: string;
  try {
    systemPrompt = renderPrompt("refine", config, { cacheDir: CACHE_CURRENT_DIR });
  } catch (err) {
    stream.markdown(`⛔ Could not render refine prompt: ${String(err)}`);
    return;
  }

  // Substitute the story key if the user provided one (e.g. /refine PROJ-42)
  const storyKey = extractStoryKey(request.prompt, config.project.jiraKey);
  if (storyKey) {
    systemPrompt = systemPrompt
      .replace(/\{STORY_KEY\}/g, storyKey)
      .replace(/\{TICKET_KEY\}/g, storyKey);
  }

  const model = request.model;
  const userMessage = request.prompt.trim() || "Run the refine agent.";

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

function extractStoryKey(text: string, projectKey: string): string | undefined {
  const pattern = new RegExp(`\\b${projectKey}-\\d+\\b`, "i");
  const match = text.match(pattern);
  return match?.[0].toUpperCase();
}
