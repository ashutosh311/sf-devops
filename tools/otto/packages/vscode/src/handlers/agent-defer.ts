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
 * Persist a fully-rendered phase prompt to disk, then point the Copilot Chat panel
 * at it (in **Agent mode**) rather than opening it there directly.
 *
 * ALM-mode refine/design/build must fetch from / update the PM tool (JIRA/ADO) and
 * read/write/delete local artifact files. A bare `model.sendRequest` inside a chat
 * participant has **no** tool access, so it can only narrate those steps. This is the
 * same deferred pattern used by push-backlog / sync-pm / data-dictionary: render the
 * prompt, inject context, and hand it to the agent-mode session that does have tools.
 *
 * The chat query itself is a short "read this file" pointer, never the rendered
 * prompt text — pasting the full instructions into the visible, persisted chat
 * transcript would expose Slalom's proprietary SDLC prompt content on the client's
 * screen. Agent mode reads `fullPrompt` from disk itself.
 */
export async function openPromptInAgentMode(opts: {
  root: string;
  phase: string;
  phaseLabel: string;
  /** ALM mode fetches/updates a PM tool; Local mode only needs file + (optionally) Salesforce DX tool access. Drives the banner wording below. */
  mode: "alm" | "local";
  /** MCP the run depends on (PM tool for ALM; e.g. "Salesforce DX" for a local build/design). Omit when the phase needs no specific MCP (e.g. Refine's local mode — file access only). */
  mcpName?: string;
  fullPrompt: string;
  /** Short, non-sensitive task description (e.g. a story key) shown in chat instead of `fullPrompt`. */
  userMessage: string;
  stream: vscode.ChatResponseStream;
  /** Extra tool-scope note appended to the banner (e.g. Confluence/wiki write access for design publishing). */
  extraToolsNote?: string;
}): Promise<void> {
  const { root, phase, phaseLabel, mode, mcpName, fullPrompt, userMessage, stream, extraToolsNote } = opts;

  const configDirName = path.basename(resolveConfigDir(root));
  // posix.join, not join: this path is shown to the user and embedded in the
  // "Read <path>" chat instruction — Windows's path.join would emit backslashes,
  // which the agent may not resolve reliably. fs calls below still work: Node's
  // path.join(root, posixRelPath) normalizes mixed separators to the native form.
  const relativePromptPath = path.posix.join(configDirName, "prompts", `${phase}.md`);
  const generatedPromptPath = path.join(root, relativePromptPath);
  try {
    fs.mkdirSync(path.dirname(generatedPromptPath), { recursive: true });
    fs.writeFileSync(generatedPromptPath, fullPrompt, "utf-8");
  } catch {
    // non-fatal — best-effort
  }

  const chatQuery = `Read ${relativePromptPath} and follow its instructions.\n\n${userMessage}`;

  // Lightweight size guard on the persisted prompt. The batch expansion happens at
  // agent runtime, so length is only a proxy for the real risk. Measured renders:
  // design ≈ 11.5k tokens, or ≈ 21k with the Revenue Cloud skills inlined; every
  // other phase is under 8k. The threshold sits between the two so it fires on the
  // genuinely heavy configurations instead of never (40k) or always (12k).
  const approxTokens = Math.round(fullPrompt.length / 4);
  const sizeNote =
    approxTokens >= 16000
      ? `\n\n⚠️ The rendered prompt is large (~${approxTokens.toLocaleString()} tokens). For an epic/sprint batch, prefer a model with a large context window and consider designing in smaller scopes if the agent runs short on context.`
      : "";

  const toolsPurpose = mode === "local"
    ? (mcpName ? `read, write local artifact files, and use the ${mcpName} MCP` : "read and write local artifact files")
    : `fetch/update ${mcpName ?? "the PM tool"} and read, write, and delete local artifact files`;
  const toolsCheck = !mcpName ? "" :
    mode === "local"
      ? `- Verify the **${mcpName} MCP** is listed in the tools section — without it the agent can't deploy, run tests, or query the org\n`
      : `- Verify the **${mcpName} MCP** is listed in the tools section — without it the agent will fall back to local mode\n`;

  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: chatQuery,
      isPartialQuery: true,
    });
    stream.markdown(
      `### ${phaseLabel} — opened in Copilot Chat (${mode === "local" ? "Local mode" : "ALM mode"})\n\n` +
      `The prompt has been pre-filled in the Copilot Chat panel with your project context injected.\n\n` +
      `**Before pressing Enter:**\n` +
      `- Switch to the **Copilot Chat** panel (it should now be in focus)\n` +
      `- Make sure **Agent mode** is selected (not Ask or Edit) so it can ${toolsPurpose}\n` +
      toolsCheck +
      (extraToolsNote ? `- ${extraToolsNote}\n` : "") +
      `\nThen press **Enter** to run.` +
      sizeNote
    );
  } catch {
    // Fallback: the command may not exist or have a different signature on some
    // VS Code / Copilot versions. Point the user to the generated file instead.
    stream.markdown(
      `### ${phaseLabel} — run manually in agent mode\n\n` +
      `The prompt has been saved to \`${relativePromptPath}\`.\n\n` +
      `**To run it:**\n` +
      `1. Open **Copilot Chat** and switch to **Agent mode**\n` +
      (mcpName ? `2. Verify the **${mcpName} MCP** is connected\n` : "") +
      (extraToolsNote ? `   - ${extraToolsNote}\n` : "") +
      `3. Type: \`Read ${relativePromptPath} and follow its instructions.\`\n` +
      sizeNote
    );
  }
}
