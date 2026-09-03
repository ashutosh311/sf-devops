import * as vscode from "vscode";
import * as path from "node:path";
import { resolveAlmTool, resolveProjectKey, skillTemplateKey, TEST_SKILLS, type OttoConfig, type TestSkill } from "@otto/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { scanEligibleStories, pickStoryScope, storyFolderPath } from "./backlog-scope";
import { runPhaseAgent } from "./run-phase-agent";
import { mcpDisplayName } from "./agent-defer";

/**
 * Test agent — skill-first, mirroring Discover's menu shape: an explicit skill
 * picker up front rather than the agent asking in-flow which capability to run.
 * `execute` is the only skill that transitions the story, and is the only one
 * that keeps its own Local/ALM mode sub-picker (the richer, story-scoping flow
 * below) — the other five skills are fully offline or read-only against the PM
 * tool and skip straight to a deferred agent-mode run.
 */

const INLINE_KEY_RE = /[A-Za-z][A-Za-z0-9]+-\d+/;

// A lowercase, kebab-case token that *looks like* an attempted skill id but
// isn't one of the six real ones — e.g. a typo like `apex-unt`. Ordinary
// prose and ticket keys never match this shape (tickets contain digits; most
// everyday words aren't hyphenated), so this only ever catches a misspelled
// skill token — it must be rejected explicitly rather than falling through to
// the ticket-only shortcut below just because a real key appears later in the
// message (which would silently run `execute` with the typo baked into the
// message instead).
const SKILL_SHAPED_RE = /^[a-z]+(-[a-z]+)+$/;

interface SkillMenuItem extends vscode.QuickPickItem {
  skill: TestSkill;
}

const MENU: SkillMenuItem[] = [
  { skill: "execute",     label: "$(play) Execute test cases",          description: "run AC in the sandbox, raise defects, close the story" },
  { skill: "write-cases", label: "$(checklist) Write test cases",       description: "push AC to Xray / Zephyr / ADO Test Plans" },
  { skill: "apex-unit",   label: "$(beaker) Apex unit tests",           description: "extend Build's baseline test classes" },
  { skill: "apex-perf",   label: "$(dashboard) Apex performance tests", description: "bulk / volume / governor-limit stress tests" },
  { skill: "pw-setup",    label: "$(tools) Set up Playwright",          description: "scaffold the E2E framework (once per project)" },
  { skill: "pw-write",    label: "$(edit) Write Playwright tests",      description: "specs for delivered functionality" },
];

const SKILL_IDS = new Set<string>(TEST_SKILLS);

export async function handleTest(
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
  const [firstToken, ...rest] = trimmed.split(/\s+/);

  // Leading skill token (e.g. "/test apex-unit PROJ-42") → use it, strip it from the message.
  if (firstToken && SKILL_IDS.has(firstToken)) {
    return dispatch(firstToken as TestSkill, root, config, request, stream, token, rest.join(" ").trim());
  }

  // An unrecognized kebab-case leading token — reject explicitly rather than
  // letting the ticket-only check below match a key elsewhere in the message
  // and silently run execute with the typo along for the ride.
  if (firstToken && SKILL_SHAPED_RE.test(firstToken)) {
    stream.markdown(`⛔ Unknown skill "${firstToken}". Valid skills: ${TEST_SKILLS.join(", ")}.`);
    return;
  }

  // Inline ticket key only, no skill → preserve today's behaviour, run execute.
  if (trimmed && INLINE_KEY_RE.test(trimmed)) {
    return dispatch("execute", root, config, request, stream, token, trimmed);
  }

  // Neither → show the skill picker.
  const pick = await vscode.window.showQuickPick(MENU, {
    title: "Test Agent",
    placeHolder: "What would you like to do?",
    ignoreFocusOut: true,
  });
  if (!pick) { stream.markdown("Test cancelled."); return; }

  return dispatch(pick.skill, root, config, request, stream, token, "");
}

/** Routes to the right skill flow and returns the composed usage-tracking key. */
async function dispatch(
  skill: TestSkill,
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  remainder: string
): Promise<string> {
  const templateKey = skillTemplateKey("test", skill);

  if (skill === "execute") {
    // An inline ticket key bypasses the mode sub-picker entirely — the
    // execute template's own 🔌 local-mode callout handles ALM vs local at
    // agent runtime, exactly as it did before this skill menu existed.
    if (remainder) {
      await runDeferred(root, config, request, stream, token, remainder, templateKey);
      return templateKey;
    }
    await runExecuteModePicker(root, config, request, stream, token);
    return templateKey;
  }

  const userMessage = remainder || describeSkill(skill);
  await runDeferred(root, config, request, stream, token, userMessage, templateKey);
  return templateKey;
}

function describeSkill(skill: TestSkill): string {
  switch (skill) {
    case "write-cases": return "Write test cases for the story I specify.";
    case "apex-unit":   return "Review and extend Apex unit test coverage for the class(es) or story I specify.";
    case "apex-perf":   return "Add Apex performance/volume test coverage for the class(es) I specify.";
    case "pw-setup":    return "Set up the Playwright E2E framework for this project.";
    case "pw-write":    return "Write or update a Playwright spec for the feature I specify.";
    default:            return "Run this Test skill.";
  }
}

/**
 * Every Test skill writes files and/or calls MCPs — a bare `model.sendRequest`
 * (no `defer`) has no tool access and can only narrate the work, not do it.
 * This was a latent bug even for `execute` before this skill menu existed.
 */
async function runDeferred(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  userMessage: string,
  templateKey: string
): Promise<void> {
  const almTool = resolveAlmTool(config);
  return runPhaseAgent("test", config, request, stream, token, userMessage, {
    defer: { root, phaseLabel: "Test", mcpName: mcpDisplayName(almTool) },
    templateKey,
  });
}

// ── Execute skill — Local / ALM mode sub-picker (preserved) ───────────────────

async function runExecuteModePicker(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const modePick = await vscode.window.showQuickPick(
    [
      { label: "$(folder) Local mode", description: "work from implementation-record.md — no PM tool required", value: "local" as const },
      { label: "$(cloud) ALM mode", description: "fetch story status, raise defects, transition in JIRA/ADO", value: "alm" as const },
    ],
    { title: "Test Agent — Execute", placeHolder: "How would you like to run testing?", ignoreFocusOut: true }
  );
  if (!modePick) { stream.markdown("Test cancelled."); return; }

  if (modePick.value === "local") {
    return runLocalMode(root, config, request, stream, token);
  }
  return runAlmMode(root, config, request, stream, token);
}

async function runLocalMode(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const { eligible, backlogPath, backlogExists } = await scanEligibleStories(root, config, {
    requireFiles: ["implementation-record.md"],
    excludeFiles: ["test-execution-record.md"],
  });

  if (!backlogExists) {
    stream.markdown(
      `⛔ No backlog found at \`${backlogPath}\`.\n\n` +
      "Run `@otto /discover manage-backlog` to generate the backlog first."
    );
    return;
  }
  if (eligible.length === 0) {
    stream.markdown(
      "ℹ️ No stories are eligible for local testing.\n\n" +
      "A story is eligible when it has `implementation-record.md` but no `test-execution-record.md` yet.\n\n" +
      "Run `@otto /build` to build the story first."
    );
    return;
  }

  const scoped = await pickStoryScope(eligible, "Test Agent — Local Mode");
  if (!scoped) { stream.markdown("Test cancelled."); return; }

  const storyList = scoped
    .map((s) => {
      const folder = path.relative(root, storyFolderPath(root, config, s));
      return (
        `- **${s.storyKey}**: ${s.user_story?.slice(0, 100) ?? "(no description)"}\n` +
        `  Acceptance criteria: \`${path.join(folder, "refinement-notes.md")}\`\n` +
        `  Implementation record: \`${path.join(folder, "implementation-record.md")}\`\n` +
        `  Write test execution record to: \`${path.join(folder, "test-execution-record.md")}\``
      );
    })
    .join("\n");

  const userMessage =
    `Run local testing (no PM tool). Stories to test:\n\n${storyList}\n\n` +
    `For each story: load its acceptance criteria, execute the test cases in the sandbox org, ` +
    `and write \`test-execution-record.md\` in the same folder (no JIRA/ADO transitions or defect raising).`;

  return runDeferred(root, config, request, stream, token, userMessage, skillTemplateKey("test", "execute"));
}

async function runAlmMode(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const almTool = resolveAlmTool(config);
  const projectKey = resolveProjectKey(config);

  const scopePick = await vscode.window.showQuickPick(
    [
      { label: "$(list-ordered) Specific story", description: `enter a ${almTool} key`, value: "key" as const },
      { label: "$(checklist) All stories in Ready for Test status", description: `test everything eligible in ${almTool}`, value: "all" as const },
    ],
    { title: "Test Agent — ALM Mode", placeHolder: "What would you like to test?", ignoreFocusOut: true }
  );
  if (!scopePick) { stream.markdown("Test cancelled."); return; }

  let userMessage: string;
  if (scopePick.value === "key") {
    const key = await vscode.window.showInputBox({
      title: "Test Agent — ALM Mode",
      prompt: `Enter the ${almTool} story key`,
      placeHolder: `${projectKey}-123`,
      ignoreFocusOut: true,
    });
    if (!key?.trim()) { stream.markdown("Test cancelled."); return; }
    userMessage = key.trim();
  } else {
    userMessage = `Test all stories currently in Ready for Test status in project ${projectKey}.`;
  }

  return runDeferred(root, config, request, stream, token, userMessage, skillTemplateKey("test", "execute"));
}
