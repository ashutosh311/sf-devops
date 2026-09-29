import * as vscode from "vscode";
import { resolveAlmTool, resolveProjectKey, extractStoryKey, skillTemplateKey, RELEASE_SKILLS, type OttoConfig, type ReleaseSkill } from "@otto/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { runPhaseAgent } from "./run-phase-agent";
import { mcpDisplayName } from "./agent-defer";

/**
 * Release agent — skill-first, mirroring Test/Refine: an explicit skill picker
 * up front. `deploy` keeps the Local/ALM mode gate it always had. Every skill
 * needs tool access (git, the PM tool, the Salesforce DX MCP or a browser) — a
 * bare `model.sendRequest` has none, so this always defers to a Copilot Chat
 * agent-mode session, unlike the generic fallback handler it replaces.
 */

/**
 * Does `text` contain a story reference for THIS project? Deliberately not a
 * generic "letters-dash-digits" match — that would treat `Winter-27` as a ticket.
 * JIRA/LOCAL: `<key>-<n>` (plus LOCAL backlog IDs like `STORY-001`); ADO work
 * items are referenced by number: `#123` / `AB#123`.
 */
function hasStoryRef(text: string, config: OttoConfig): boolean {
  const almTool = resolveAlmTool(config);
  if (almTool === "ADO") return /(?:^|\s)(?:AB)?#\d+\b/i.test(text);
  if (extractStoryKey(text, resolveProjectKey(config))) return true;
  return almTool === "LOCAL" && /\bSTORY-\d+\b/i.test(text);
}

// A lowercase, kebab-case token that looks like an attempted skill id but isn't
// a real one — rejected explicitly so a typo can't fall through to the
// ticket-only shortcut below and silently run `deploy`.
const SKILL_SHAPED_RE = /^[a-z]+(-[a-z]+)+$/;

interface SkillMenuItem extends vscode.QuickPickItem {
  skill: ReleaseSkill;
}

const MENU: SkillMenuItem[] = [
  { skill: "deploy",            label: "$(rocket) Deploy a release",     description: "SFCA quality gate, UAT deploy, sign-off, production deploy" },
  { skill: "release-notes",     label: "$(note) Release notes",          description: "user-facing notes from the git diff and the tickets behind it" },
  { skill: "impact-assessment", label: "$(shield) Impact assessment",    description: "assess a Salesforce seasonal release (e.g. Winter '27) against this org" },
];

const SKILL_IDS = new Set<string>(RELEASE_SKILLS);

export async function handleRelease(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<string | undefined> {
  const root = getWorkspaceRoot();
  if (!root) {
    stream.markdown("⛔ No workspace folder open. Open your project folder in VS Code first.");
    return;
  }

  const config = await loadConfig(root);
  if (!config) {
    stream.markdown("⛔ No Otto config found.\n\nRun `@otto /init` to set up Otto for this project.");
    return;
  }

  const trimmed = request.prompt.trim();
  const tokens = trimmed ? trimmed.split(/\s+/) : [];

  // The skill and story keys may come in either order ("/release deploy PROJ-42",
  // "/release PROJ-42 release-notes"), so the skill slot is the first token that
  // isn't a story reference. Only that slot is checked: a skill word later in
  // free text ("notes for what we deploy") is not a skill selection.
  const slotIdx = tokens.findIndex((t) => !hasStoryRef(t, config));
  const slot = slotIdx === -1 ? undefined : tokens[slotIdx];
  if (slot && SKILL_IDS.has(slot)) {
    const remainder = tokens.filter((_, i) => i !== slotIdx).join(" ");
    return dispatch(slot as ReleaseSkill, root, config, request, stream, token, remainder);
  }

  // An unrecognized kebab-case token in the skill slot — reject rather than guessing.
  if (slot && SKILL_SHAPED_RE.test(slot)) {
    stream.markdown(`⛔ Unknown skill "${slot}". Valid skills: ${RELEASE_SKILLS.join(", ")}.`);
    return;
  }

  // A story reference for this project, no skill → preserve today's behaviour, run deploy.
  if (trimmed && hasStoryRef(trimmed, config)) {
    return dispatch("deploy", root, config, request, stream, token, trimmed);
  }

  const pick = await vscode.window.showQuickPick(MENU, {
    title: "Release Agent",
    placeHolder: "What would you like to do?",
    ignoreFocusOut: true,
  });
  if (!pick) { stream.markdown("Release cancelled."); return; }

  return dispatch(pick.skill, root, config, request, stream, token, "");
}

/** Routes to the right skill flow and returns the composed usage-tracking key. */
async function dispatch(
  skill: ReleaseSkill,
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  remainder: string
): Promise<string> {
  const templateKey = skillTemplateKey("release", skill);

  if (skill === "deploy") {
    const inlineKeys = remainder && hasStoryRef(remainder, config) ? remainder : undefined;
    // A LOCAL project has no PM tool, so ALM mode can't apply — always local mode.
    if (resolveAlmTool(config) === "LOCAL") {
      await runLocalMode(root, config, request, stream, token, templateKey, inlineKeys);
      return templateKey;
    }
    // An inline PM key bypasses the mode sub-picker — direct ALM invocation.
    if (inlineKeys) {
      await runPhaseAgent("release", config, request, stream, token, remainder, {
        defer: { root, phaseLabel: "Release", mode: "alm", mcpName: mcpDisplayName(resolveAlmTool(config)) },
        templateKey,
      });
      return templateKey;
    }
    await runDeployModePicker(root, config, request, stream, token, templateKey);
    return templateKey;
  }

  const userMessage = remainder || describeSkill(skill);

  if (skill === "release-notes") {
    // Reads git and (in ALM mode) the PM tool; writes only release-scope.md and release-notes.md.
    // A LOCAL project has no PM tool, so it runs in local mode with no MCP to verify.
    const almTool = resolveAlmTool(config);
    await runPhaseAgent("release", config, request, stream, token, userMessage, {
      defer: almTool === "LOCAL"
        ? { root, phaseLabel: "Release", mode: "local" }
        : { root, phaseLabel: "Release", mode: "alm", mcpName: mcpDisplayName(almTool) },
      templateKey,
    });
    return templateKey;
  }

  // impact-assessment: repo-first, so no MCP is required. The Salesforce DX MCP
  // (optional live-org queries) and a browser tool (optional live release-note
  // fetch) are nice-to-haves, mentioned in the banner rather than verified.
  await runPhaseAgent("release", config, request, stream, token, userMessage, {
    defer: {
      root,
      phaseLabel: "Release",
      mode: "local",
      extraToolsNote: "Optional: a browser tool (e.g. the **Playwright MCP**) lets the agent read Salesforce's live release notes, and the **Salesforce DX MCP** enables opt-in live-org queries. Without them it works from the repo and asks you to save the notes into the project folder.",
    },
    templateKey,
  });
  return templateKey;
}

function describeSkill(skill: ReleaseSkill): string {
  switch (skill) {
    case "release-notes":     return "Write user-facing release notes for the release I specify.";
    case "impact-assessment": return "Assess the Salesforce seasonal release I specify against this org's customisations.";
    default:                  return "Run this Release skill.";
  }
}

// ── Deploy skill — Local / ALM mode sub-picker ────────────────────────────────

async function runDeployModePicker(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  templateKey: string
): Promise<void> {
  const modePick = await vscode.window.showQuickPick(
    [
      { label: "$(folder) Local mode", description: "release notes from local artifacts — no PM tool required", value: "local" as const },
      { label: "$(cloud) ALM mode", description: "fetch Done stories from JIRA/ADO", value: "alm" as const },
    ],
    { title: "Release Agent", placeHolder: "How would you like to run the release?", ignoreFocusOut: true }
  );
  if (!modePick) { stream.markdown("Release cancelled."); return; }

  if (modePick.value === "local") {
    return runLocalMode(root, config, request, stream, token, templateKey);
  }
  return runAlmMode(root, config, request, stream, token, templateKey);
}

// ── Local mode ────────────────────────────────────────────────────────────────

async function runLocalMode(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  templateKey: string,
  presetKeys?: string
): Promise<void> {
  const keys = presetKeys ?? await vscode.window.showInputBox({
    title: "Release Agent — Local Mode",
    prompt: "Enter the story keys to release (comma or space separated)",
    placeHolder: "PROJ-101, PROJ-102",
    ignoreFocusOut: true,
  });
  if (!keys?.trim()) { stream.markdown("Release cancelled."); return; }

  const userMessage =
    `Run local release (no PM tool). Stories to release: ${keys.trim()}\n\n` +
    `There is no PM status to query — take release notes from the local artifacts under ` +
    `\`${config.paths.artifacts}/04 - Backlog/stories/\` and \`${config.paths.artifacts}/{STORY-KEY}/\`.`;

  return runPhaseAgent("release", config, request, stream, token, userMessage, {
    defer: { root, phaseLabel: "Release", mode: "local", mcpName: "Salesforce DX" },
    templateKey,
  });
}

// ── ALM mode ──────────────────────────────────────────────────────────────────

async function runAlmMode(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  templateKey: string
): Promise<void> {
  const almTool = resolveAlmTool(config);
  const projectKey = resolveProjectKey(config);
  const statusMap = (almTool === "ADO" ? config.ado?.statusMap : config.jira?.statusMap)?.story;
  const doneStatus = statusMap?.done ?? "Done";

  const scopePick = await vscode.window.showQuickPick(
    [
      { label: "$(list-ordered) Specific stories", description: `enter ${almTool} story keys`, value: "keys" as const },
      { label: `$(checklist) All stories in ${doneStatus} status`, description: `release everything eligible in ${almTool}`, value: "all" as const },
    ],
    { title: "Release Agent — ALM Mode", placeHolder: "What would you like to release?", ignoreFocusOut: true }
  );
  if (!scopePick) { stream.markdown("Release cancelled."); return; }

  let userMessage: string;
  if (scopePick.value === "keys") {
    const keys = await vscode.window.showInputBox({
      title: "Release Agent — ALM Mode",
      prompt: `Enter the ${almTool} story keys to release (comma or space separated)`,
      placeHolder: `${projectKey}-101, ${projectKey}-102`,
      ignoreFocusOut: true,
    });
    if (!keys?.trim()) { stream.markdown("Release cancelled."); return; }
    userMessage = `Release the following stories: ${keys.trim()}`;
  } else {
    userMessage = `Release all stories currently in "${doneStatus}" status in project ${projectKey}.`;
  }

  return runPhaseAgent("release", config, request, stream, token, userMessage, {
    defer: { root, phaseLabel: "Release", mode: "alm", mcpName: mcpDisplayName(almTool) },
    templateKey,
  });
}
