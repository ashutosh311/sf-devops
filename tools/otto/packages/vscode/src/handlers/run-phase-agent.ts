import * as vscode from "vscode";
import { renderPrompt, CACHE_CURRENT_DIR, resolveProjectKey, extractStoryKey, type OttoConfig } from "@otto/core";
import { openPromptInAgentMode } from "./agent-defer";

/**
 * Shared model-call helper for phase agents that need to run with a custom,
 * pre-crafted user message (e.g. an explicit local-mode story list) rather than
 * the raw chat prompt — used by Build and Test's local-mode flows. Renders the
 * phase's system prompt, substitutes `{STORY_KEY}`/`{TICKET_KEY}` if a key is
 * present, guards against oversized prompts, and streams the response.
 *
 * When `opts.defer` is set, the rendered prompt is opened pre-filled in Copilot
 * Chat for an agent-mode run instead of a bare `model.sendRequest` — required for
 * ALM-mode flows that must fetch/update the PM tool and read/write local files.
 */
export async function runPhaseAgent(
  phase: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  userMessage: string,
  opts?: {
    defer?: { root: string; phaseLabel: string; mcpName: string };
    /** Render a composed sub-skill key (e.g. "test-apex-unit") instead of the
     *  bare phase, while still reporting/labelling the run as `phase`. */
    templateKey?: string;
  }
): Promise<void> {
  let systemPrompt: string;
  try {
    systemPrompt = renderPrompt(opts?.templateKey ?? phase, config, { cacheDir: CACHE_CURRENT_DIR });
  } catch (err) {
    stream.markdown(`⛔ Could not render ${phase} prompt: ${String(err)}`);
    return;
  }

  const storyKey = extractStoryKey(userMessage, resolveProjectKey(config));
  if (storyKey) {
    systemPrompt = systemPrompt
      .replace(/\{STORY_KEY\}/g, storyKey)
      .replace(/\{TICKET_KEY\}/g, storyKey);
  }

  if (opts?.defer) {
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
    return openPromptInAgentMode({
      root: opts.defer.root,
      // Key the generated prompt file by the rendered template, not the bare
      // phase — otherwise all six Test skills overwrite the same
      // `prompts/test.md`, and a second skill silently swaps the instructions
      // under a run still working from the first.
      phase: opts.templateKey ?? phase,
      phaseLabel: opts.defer.phaseLabel,
      mcpName: opts.defer.mcpName,
      fullPrompt,
      stream,
    });
  }

  const model = request.model;
  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
    vscode.LanguageModelChatMessage.User(userMessage),
  ];

  try {
    const promptTokens = await model.countTokens(messages[0], token);
    const userTokens = await model.countTokens(messages[1], token);
    const totalTokens = promptTokens + userTokens;
    const limit = model.maxInputTokens;
    const pct = Math.round((totalTokens / limit) * 100);

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
    const code = (err as { code?: string }).code;
    if (code === "NoPermissions") {
      stream.markdown("⛔ Copilot access is required. Sign in to GitHub Copilot and try again.");
    } else if (code === "Blocked") {
      stream.markdown("⛔ Request blocked — quota or content policy limit reached. Try again shortly or switch model.");
    } else {
      stream.markdown(`⛔ Model error: ${String(err)}`);
    }
  }
}
