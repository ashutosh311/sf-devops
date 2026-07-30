import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  renderPrompt,
  CACHE_CURRENT_DIR,
  dataDictionaryTemplate,
  resolveProjectKey,
  extractStoryKey,
  type SdlcConfig,
} from "@sdlc/core";

/**
 * Shared `data-dictionary` capability. This is NOT a top-level slash command — it
 * is offered as a menu option inside the Discover, Refine, Design, and Build
 * agents (and can be invoked as `/{phase} data-dictionary`).
 *
 * Because building/maintaining the dictionary needs agent-mode tool access (read
 * `force-app/`, query the org via the Salesforce DX MCP, write artifact files), we
 * use the same **deferred** pattern as push-backlog / sync-pm: render the prompt,
 * inject project context, and open Copilot Chat pre-filled so the user can run it
 * in Agent mode with tools available. A bare `model.sendRequest` has no tool access
 * and cannot do the work.
 */

/** True when the user's message opens with the data-dictionary sub-skill token. */
export function isDataDictionaryToken(prompt: string): boolean {
  const first = prompt.trim().split(/\s+/)[0]?.toLowerCase().replace(/^\//, "");
  return first === "data-dictionary" || first === "datadictionary" || first === "dd";
}

/**
 * Present a two-way action pick for a linear agent: run the phase, or update the
 * data dictionary. Returns "phase" | "data-dictionary" | undefined (cancelled).
 */
export async function pickPhaseOrDataDictionary(
  phaseLabel: string,
  phaseIcon: string,
  phaseDescription: string
): Promise<"phase" | "data-dictionary" | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: `$(${phaseIcon}) ${phaseLabel}`, description: phaseDescription, value: "phase" as const },
      {
        label: "$(book) Data Dictionary",
        description: "build/maintain object-reference docs (one file per object)",
        value: "data-dictionary" as const,
      },
    ],
    {
      title: `${phaseLabel} Agent`,
      placeHolder: "What would you like to do?",
      ignoreFocusOut: true,
    }
  );
  return pick?.value;
}

/**
 * Render the data-dictionary prompt and open it, pre-filled, in Copilot Chat.
 * `phaseHint` names the invoking agent so the prompt can bias its fidelity
 * (Discover → Conceptual, Refine → Inferred, Design → Logical, Build → Physical).
 */
export async function openDataDictionary(
  root: string,
  config: SdlcConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  phaseHint: "discover" | "refine" | "design" | "build" | "standalone"
): Promise<void> {
  let systemPrompt: string;
  try {
    systemPrompt = renderPrompt("data-dictionary", config, { cacheDir: CACHE_CURRENT_DIR });
  } catch {
    systemPrompt = dataDictionaryTemplate;
  }

  const storyKey = extractStoryKey(request.prompt, resolveProjectKey(config));
  const fidelityHint: Record<typeof phaseHint, string> = {
    discover: "Invoked from **Discover** — stay at **Conceptual** fidelity (business entities/attributes only; no `__c` API names, field types, or permission sets).",
    refine: "Invoked from **Refine** — target **Inferred** fidelity (attributes implied by acceptance criteria; API names marked `(proposed)`).",
    design: "Invoked from **Design** — target **Logical** fidelity (proposed API names/types, intended permission-set access, validation rules from the solution design).",
    build: "Invoked from **Build** — target **Physical** fidelity (reconcile against both local `force-app/` metadata and the live org via the Salesforce DX MCP).",
    standalone: "Detect the highest fidelity the available inputs support.",
  };

  const contextLines = [
    `PROJECT: ${config.project.name}`,
    storyKey ? `STORY: ${storyKey}` : undefined,
    fidelityHint[phaseHint],
  ].filter(Boolean);

  const userRequest = request.prompt.trim().replace(/^\/?(data-dictionary|datadictionary|dd)\b\s*/i, "").trim()
    || "Build or update the data dictionary for the objects in scope.";

  const fullPrompt = `${systemPrompt}\n\n---\n\n${contextLines.join("\n")}\n\n---\n\n${userRequest}`;

  // Persist so the run survives if the chat-open call fails.
  const generatedPromptPath = path.join(root, ".sdlc", "prompts", "data-dictionary.md");
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
      `### Data Dictionary — opened in Copilot Chat\n\n` +
      `The prompt has been pre-filled in the Copilot Chat panel with your project context injected.\n\n` +
      `**Before pressing Enter:**\n` +
      `- Switch to the **Copilot Chat** panel (it should now be in focus)\n` +
      `- Make sure **Agent mode** is selected (not Ask or Edit) so it can read files and query the org\n` +
      `- If you want **Physical** fidelity, verify the **Salesforce DX MCP** is connected\n\n` +
      `Then press **Enter** to run.`
    );
  } catch {
    stream.markdown(
      `### Data Dictionary — run manually in agent mode\n\n` +
      `The prompt has been saved to \`.sdlc/prompts/data-dictionary.md\`.\n\n` +
      `**To run it:**\n` +
      `1. Open **Copilot Chat** and switch to **Agent mode**\n` +
      `2. (For Physical fidelity) verify the **Salesforce DX MCP** is connected\n` +
      `3. Type: \`Read .sdlc/prompts/data-dictionary.md and follow its instructions.\`\n`
    );
  }
}
