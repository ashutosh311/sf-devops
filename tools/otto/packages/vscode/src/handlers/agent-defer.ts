import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveConfigDir } from "@otto/core";

/**
 * Human-readable name of the PM tool's MCP, for the agent-mode banner.
 */
export function mcpDisplayName(almTool: string): string {
  return almTool === "ADO" ? "Azure DevOps" : "Atlassian";
}

/**
 * Open a fully-rendered phase prompt, pre-filled, in the Copilot Chat panel so the
 * user can run it in **Agent mode** with tool access.
 *
 * ALM-mode refine/design/build must fetch from / update the PM tool (JIRA/ADO) and
 * read/write/delete local artifact files. A bare `model.sendRequest` inside a chat
 * participant has **no** tool access, so it can only narrate those steps. This is the
 * same deferred pattern used by push-backlog / sync-pm / data-dictionary: render the
 * prompt, inject context, and hand it to the agent-mode session that does have tools.
 *
 * The prompt is also persisted under the project's active config dir so the run
 * survives if the chat-open command is unavailable on this VS Code / Copilot version.
 */
export async function openPromptInAgentMode(opts: {
  root: string;
  phase: string;
  phaseLabel: string;
  mcpName: string;
  fullPrompt: string;
  stream: vscode.ChatResponseStream;
  /** Extra tool-scope note appended to the banner (e.g. Confluence/wiki write access for design publishing). */
  extraToolsNote?: string;
}): Promise<void> {
  const { root, phase, phaseLabel, mcpName, fullPrompt, stream, extraToolsNote } = opts;

  const configDirName = path.basename(resolveConfigDir(root));
  const generatedPromptPath = path.join(root, configDirName, "prompts", `${phase}.md`);
  try {
    fs.mkdirSync(path.dirname(generatedPromptPath), { recursive: true });
    fs.writeFileSync(generatedPromptPath, fullPrompt, "utf-8");
  } catch {
    // non-fatal — best-effort
  }

  // Lightweight size guard on the injected prompt. The batch expansion happens at
  // agent runtime, so length is only a proxy for the real risk. Measured renders:
  // design ≈ 11.5k tokens, or ≈ 21k with the Revenue Cloud skills inlined; every
  // other phase is under 8k. The threshold sits between the two so it fires on the
  // genuinely heavy configurations instead of never (40k) or always (12k).
  const approxTokens = Math.round(fullPrompt.length / 4);
  const sizeNote =
    approxTokens >= 16000
      ? `\n\n⚠️ The rendered prompt is large (~${approxTokens.toLocaleString()} tokens). For an epic/sprint batch, prefer a model with a large context window and consider designing in smaller scopes if the agent runs short on context.`
      : "";

  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: fullPrompt,
      isPartialQuery: true,
    });
    stream.markdown(
      `### ${phaseLabel} — opened in Copilot Chat (ALM mode)\n\n` +
      `The prompt has been pre-filled in the Copilot Chat panel with your project context injected.\n\n` +
      `**Before pressing Enter:**\n` +
      `- Switch to the **Copilot Chat** panel (it should now be in focus)\n` +
      `- Make sure **Agent mode** is selected (not Ask or Edit) so it can fetch/update ${mcpName} and read, write, and delete local artifact files\n` +
      `- Verify the **${mcpName} MCP** is listed in the tools section — without it the agent will fall back to local mode\n` +
      (extraToolsNote ? `- ${extraToolsNote}\n` : "") +
      `\nThen press **Enter** to run.` +
      sizeNote
    );
  } catch {
    // Fallback: the command may not exist or have a different signature on some
    // VS Code / Copilot versions. Point the user to the generated file instead.
    stream.markdown(
      `### ${phaseLabel} — run manually in agent mode\n\n` +
      `The prompt has been saved to \`${configDirName}/prompts/${phase}.md\`.\n\n` +
      `**To run it:**\n` +
      `1. Open **Copilot Chat** and switch to **Agent mode**\n` +
      `2. Verify the **${mcpName} MCP** is connected\n` +
      (extraToolsNote ? `   - ${extraToolsNote}\n` : "") +
      `3. Type: \`Read ${configDirName}/prompts/${phase}.md and follow its instructions.\`\n` +
      sizeNote
    );
  }
}
