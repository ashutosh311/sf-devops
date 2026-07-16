import * as vscode from "vscode";
import * as path from "path";
import { scaffoldRepo, resolveProjectKey, type SdlcConfig } from "@sdlc/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { runVSCodeInterview } from "../interview";

export async function handleInit(
  _request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream
): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    stream.markdown("⛔ No workspace folder open. Open your Salesforce project folder in VS Code first.");
    return;
  }

  const existing = await loadConfig(root);
  const isReconfigure = !!existing;

  if (isReconfigure) {
    stream.markdown(`**Reconfigure mode** — existing config found at \`.sdlc/config.json\`. Your answers will pre-fill from the current config.\n\n`);
  } else {
    stream.markdown(`**SDLC Setup** — scaffolding into \`${path.basename(root)}\`.\n\n`);
  }

  const config = await runVSCodeInterview(existing ?? undefined);
  if (!config) {
    stream.markdown("Setup cancelled.");
    return;
  }

  stream.markdown("Scaffolding project files...\n\n");
  const result = await scaffoldRepo(config, root);

  stream.markdown(buildSummary(config, result, isReconfigure));
}

function buildSummary(
  config: SdlcConfig,
  result: { created: string[]; updated: string[]; preserved: string[] },
  isReconfigure: boolean
): string {
  const lines: string[] = [];

  lines.push(`## ${isReconfigure ? "Reconfigured" : "Initialised"}: ${config.project.name}\n`);
  const pmKey = resolveProjectKey(config);
  if (config.alm?.tool === "LOCAL") {
    lines.push(`- **Work items**: Local files only (prefix \`${pmKey}\`)`);
  } else {
    const pmUrl = config.alm?.tool === "ADO"
      ? config.alm.organization
      : (config.alm?.tool === "JIRA" ? config.alm.site : config.project.jiraSite) ?? "";
    const pmLabel = config.alm?.tool === "ADO" ? "ADO Project" : "JIRA";
    lines.push(`- **${pmLabel}**: [${pmKey}](${pmUrl})`);
  }
  lines.push(`- **Sandbox org**: \`${config.salesforce.orgs.sandbox}\``);
  lines.push(`- **Phases**: ${config.phases.join(", ")}`);
  lines.push(`- **Sprint length**: ${config.team.sprintLengthWeeks} week(s)\n`);

  if (result.created.length) {
    lines.push("**Created:**");
    result.created.forEach((f) => lines.push(`- \`${f}\``));
  }
  if (result.updated.length) {
    lines.push("\n**Updated:**");
    result.updated.forEach((f) => lines.push(`- \`${f}\``));
  }
  if (result.preserved.length) {
    lines.push("\n**Preserved (unchanged):**");
    result.preserved.forEach((f) => lines.push(`- \`${f}\``));
  }

  lines.push(`\n✅ Ready. Use \`@slalom-sdlc /discover\` to start a discovery session.`);
  return lines.join("\n");
}
