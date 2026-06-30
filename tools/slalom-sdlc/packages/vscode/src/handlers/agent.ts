import * as vscode from "vscode";
import { renderPrompt, CACHE_CURRENT_DIR } from "@sdlc/core";
import { requireConfig } from "../config";

const PHASE_COMMANDS = new Set(["discover", "refine", "design", "build", "test", "release"]);

export async function handleAgent(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const command = request.command;
  if (!command || !PHASE_COMMANDS.has(command)) {
    stream.markdown(`Unknown command: \`/${command}\`. Available: ${[...PHASE_COMMANDS].map((c) => `/${c}`).join(", ")}`);
    return;
  }

  const config = await requireConfig(stream);
  if (!config) return;

  let systemPrompt: string;
  try {
    systemPrompt = renderPrompt(command, config, { cacheDir: CACHE_CURRENT_DIR });
  } catch (err) {
    stream.markdown(`⛔ Could not render prompt for phase \`${command}\`: ${String(err)}`);
    return;
  }

  const storyKey = extractStoryKey(request.prompt, config.project.jiraKey);
  if (storyKey) {
    systemPrompt = systemPrompt
      .replace(/\{STORY_KEY\}/g, storyKey)
      .replace(/\{TICKET_KEY\}/g, storyKey);
  }

  const model = request.model;
  const userMessage = request.prompt.trim() || `Run the ${command} agent.`;

  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
    vscode.LanguageModelChatMessage.User(userMessage),
  ];

  // Pre-flight: count tokens and warn if approaching the model's input limit.
  // Threshold is 80% — leaves headroom for conversation history and the model's
  // own response tokens. countTokens uses the model's real tokeniser, not an
  // approximation.
  try {
    const promptTokens  = await model.countTokens(messages[0], token);
    const userTokens    = await model.countTokens(messages[1], token);
    const totalTokens   = promptTokens + userTokens;
    const limit         = model.maxInputTokens;
    const pct           = Math.round((totalTokens / limit) * 100);

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
        `Long responses or continued conversation may hit the limit. Consider starting a new session after this step.\n\n`
      );
    }
  } catch {
    // countTokens is not available on all model versions — continue without the guard.
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

function extractStoryKey(text: string, projectKey: string): string | undefined {
  const pattern = new RegExp(`\\b${projectKey}-\\d+\\b`, "i");
  const match = text.match(pattern);
  return match?.[0].toUpperCase();
}
