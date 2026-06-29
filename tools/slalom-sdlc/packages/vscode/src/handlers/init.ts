import * as vscode from "vscode";
import * as path from "path";
import { scaffoldRepo, type SdlcConfig } from "@sdlc/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { runVSCodeInterview } from "../interview";

export async function handleInit(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  extContext: vscode.ExtensionContext
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

  const token = await resolveBitbucketToken(extContext, stream);
  if (!token) return;

  stream.markdown("Scaffolding project files...\n\n");
  const result = await scaffoldRepo(config, root, token);

  stream.markdown(buildSummary(config, result, isReconfigure));
}

async function resolveBitbucketToken(
  context: vscode.ExtensionContext,
  stream: vscode.ChatResponseStream
): Promise<string | undefined> {
  const SECRET_KEY = "BITBUCKET_TOKEN";
  const stored = await context.secrets.get(SECRET_KEY);
  if (stored) return stored;

  const entered = await vscode.window.showInputBox({
    title: "Bitbucket HTTP Access Token",
    prompt:
      "Required to fetch the latest Slalom standards from sf-uki-devops. " +
      "Generate one at bitbucket.org → Personal settings → App passwords (Repository: Read scope).",
    password: true,
    ignoreFocusOut: true,
  });

  if (!entered) {
    stream.markdown(
      "⛔ Setup cancelled — a Bitbucket token is required to fetch the development standards from sf-uki-devops. " +
      "Generate an app password with **Repository: Read** scope and run `/init` again."
    );
    return undefined;
  }

  await context.secrets.store(SECRET_KEY, entered);
  return entered;
}

function buildSummary(
  config: SdlcConfig,
  result: { created: string[]; updated: string[]; preserved: string[] },
  isReconfigure: boolean
): string {
  const lines: string[] = [];

  lines.push(`## ${isReconfigure ? "Reconfigured" : "Initialised"}: ${config.project.name}\n`);
  lines.push(`- **JIRA**: [${config.project.jiraKey}](${config.project.jiraSite}/jira/software/projects/${config.project.jiraKey}/boards)`);
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
