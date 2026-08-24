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
}): Promise<void> {
  const { root, phase, phaseLabel, mcpName, fullPrompt, stream } = opts;

  const configDirName = path.basename(resolveConfigDir(root));
  const generatedPromptPath = path.join(root, configDirName, "prompts", `${phase}.md`);
  try {
    fs.mkdirSync(path.dirname(generatedPromptPath), { recursive: true });
    fs.writeFileSync(generatedPromptPath, fullPrompt, "utf-8");
  } catch {
    // non-fatal — best-effort
  }

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
      `- Verify the **${mcpName} MCP** is listed in the tools section — without it the agent will fall back to local mode\n\n` +
      `Then press **Enter** to run.`
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
      `3. Type: \`Read ${configDirName}/prompts/${phase}.md and follow its instructions.\`\n`
    );
  }
}
