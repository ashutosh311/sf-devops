import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  DEFAULT_PATHS,
  DEFAULT_STANDARDS,
  CONFIG_VERSION,
  TOOL_VERSION,
  REFINE_SKILLS,
  type OttoConfig,
  type RefineSkill,
  type StoryStatusMap,
  type EpicStatusMap,
  type SubTaskStatusMap,
  resolveProjectKey,
  resolveAlmTool,
} from "@otto/core";
import { getWorkspaceRoot, loadConfig } from "../config";
import { readBacklogWorkbook } from "../backlog";
import { isDataDictionaryToken, openDataDictionary } from "./data-dictionary";
import { scanEligibleStories, pickStoryScope, storyFolderPath } from "./backlog-scope";
import { runPhaseAgent } from "./run-phase-agent";
import { mcpDisplayName } from "./agent-defer";

type JiraStatusMap = { story: StoryStatusMap; epic: EpicStatusMap; subTask: SubTaskStatusMap };

const DEFAULT_STATUS_MAP: JiraStatusMap = {
  story: {
    backlog:          "Backlog",
    refineInProgress: "In Refinement",
    readyForDesign:   "Ready for Design",
    designInProgress: "In Design",
    readyForBuild:    "Ready for Build",
    inDevelopment:    "In Development",
    readyForTest:     "Ready for Test",
    done:             "Done",
  },
  epic:    { notStarted: "To Do", inProgress: "In Progress", done: "Done" },
  subTask: { todo: "To Do", inDevelopment: "In Progress", readyForTest: "In Review", done: "Done" },
};

const INLINE_KEY_RE = /[A-Za-z][A-Za-z0-9]+-\d+/;

// A lowercase, kebab-case token that *looks like* an attempted skill id but isn't
// one of the real ones (e.g. a typo like `generate-stores`). Ordinary prose and
// ticket keys never match this shape, so it only ever catches a misspelled skill
// token — reject it explicitly rather than falling through to the ticket-only
// shortcut and silently refining the wrong thing.
const SKILL_SHAPED_RE = /^[a-z]+(-[a-z]+)+$/;

const SKILL_IDS = new Set<string>(REFINE_SKILLS);

// ── Entry point ───────────────────────────────────────────────────────────────

export async function handleRefine(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<string | undefined> {
  const root = getWorkspaceRoot();
  const existingConfig = root ? await loadConfig(root) : undefined;

  // Data dictionary token → run immediately, no JIRA/config prompts required.
  if (root && isDataDictionaryToken(request.prompt)) {
    const ddConfig = existingConfig ?? buildMinimalConfig("", path.basename(root));
    await openDataDictionary(root, ddConfig, request, stream, "refine");
    return "data-dictionary";
  }

  const trimmed = request.prompt.trim();
  const [firstToken, ...rest] = trimmed.split(/\s+/);
  const remainder = rest.join(" ").trim();

  // Leading skill token (e.g. "/refine generate-stories" or "/refine story PROJ-42").
  if (root && firstToken && SKILL_IDS.has(firstToken)) {
    return dispatch(firstToken as RefineSkill, root, existingConfig, request, stream, token, remainder);
  }

  // An unrecognized kebab-case leading token — reject rather than letting the
  // ticket-only check below match a key elsewhere and silently run `story`.
  if (root && firstToken && SKILL_SHAPED_RE.test(firstToken)) {
    stream.markdown(`⛔ Unknown skill "${firstToken}". Valid skills: ${REFINE_SKILLS.join(", ")}.`);
    return;
  }

  // Inline PM key (e.g. "/refine PROJ-42") → skip all menus, direct ALM refinement.
  if (root && INLINE_KEY_RE.test(trimmed)) {
    const config = existingConfig ?? await promptForJiraConfig(stream);
    if (!config) return;
    await runRefineAgent(config, request, stream, token, trimmed, { defer: true, root, mode: "alm" });
    return "refine-story";
  }

  if (!root) {
    stream.markdown("⛔ No workspace folder open. Open your project folder in VS Code first.");
    return;
  }

  // ── Top-level action menu ────────────────────────────────────────────────────
  const action = await vscode.window.showQuickPick(
    [
      { label: "$(checklist) Refine a story", description: "add Gherkin acceptance criteria + business context", value: "story" as const },
      { label: "$(sparkle) Generate stories", description: "draft stories under an epic from transcripts/files", value: "generate-stories" as const },
      { label: "$(book) Data Dictionary", description: "build/maintain object-reference docs (Inferred fidelity)", value: "data-dictionary" as const },
    ],
    { title: "Refine Agent", placeHolder: "What would you like to do?", ignoreFocusOut: true }
  );
  if (!action) { stream.markdown("Refinement cancelled."); return; }

  if (action.value === "data-dictionary") {
    const ddConfig = existingConfig ?? buildMinimalConfig("", path.basename(root));
    await openDataDictionary(root, ddConfig, request, stream, "refine");
    return "data-dictionary";
  }

  return dispatch(action.value, root, existingConfig, request, stream, token, "");
}

/** Routes to the right refine skill and returns the composed usage-tracking key. */
async function dispatch(
  skill: RefineSkill,
  root: string,
  existingConfig: OttoConfig | undefined,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  remainder: string
): Promise<string | undefined> {
  if (skill === "generate-stories") {
    return runGenerateStories(root, existingConfig, request, stream, token);
  }

  // "story" — an inline key bypasses the mode picker, exactly as before this menu.
  if (remainder && INLINE_KEY_RE.test(remainder)) {
    const config = existingConfig ?? await promptForJiraConfig(stream);
    if (!config) return;
    await runRefineAgent(config, request, stream, token, remainder, { defer: true, root, mode: "alm" });
    return "refine-story";
  }
  return runStorySkill(root, existingConfig, request, stream, token);
}

// ── Story skill — Local / ALM mode sub-picker ─────────────────────────────────

async function runStorySkill(
  root: string,
  existingConfig: OttoConfig | undefined,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<string | undefined> {
  // ── Mode menu (replaces the model asking "local or ALM?" in-flow) ───────────
  const modePick = await vscode.window.showQuickPick(
    [
      { label: "$(folder) Local mode", description: "work from the local backlog — no PM tool required", value: "local" as const },
      { label: "$(cloud) ALM mode", description: "fetch story status, write AC, transition in JIRA/ADO", value: "alm" as const },
    ],
    { title: "Refine Agent", placeHolder: "How would you like to run refinement?", ignoreFocusOut: true }
  );
  if (!modePick) { stream.markdown("Refinement cancelled."); return; }

  if (modePick.value === "local") {
    await runLocalMode(root, existingConfig ?? buildMinimalConfig("", path.basename(root)), request, stream, token);
    return "refine-story";
  }
  await runAlmMode(root, existingConfig, request, stream, token);
  return "refine-story";
}

// ── Local mode ────────────────────────────────────────────────────────────────

async function runLocalMode(
  root: string,
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const { eligible, backlogPath, backlogExists } = await scanEligibleStories(root, config, {
    requireFiles: [],
    excludeFiles: ["refinement-notes.md"],
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
      "ℹ️ No stories are eligible for local refinement.\n\n" +
      "A story is eligible when it doesn't have `refinement-notes.md` yet."
    );
    return;
  }

  const scoped = await pickStoryScope(eligible, "Refine Agent — Local Mode");
  if (!scoped) { stream.markdown("Refinement cancelled."); return; }

  const storyList = scoped
    .map((s) => {
      const notesPath = path.relative(root, path.join(storyFolderPath(root, config, s), "refinement-notes.md"));
      return `- **${s.storyKey}**: ${s.user_story?.slice(0, 100) ?? "(no description)"}\n  Write refinement notes to: \`${notesPath}\``;
    })
    .join("\n");

  const userMessage =
    `Run local refinement (no PM tool). Stories to refine:\n\n${storyList}\n\n` +
    `For each story: validate INVEST, write Gherkin acceptance criteria and business context, ` +
    `and write \`refinement-notes.md\` to the path listed above.`;

  // Reading the backlog and writing refinement-notes.md needs real file tool
  // access that a bare model.sendRequest doesn't have — defer to Agent mode.
  return runRefineAgent(config, request, stream, token, userMessage, { defer: true, root, mode: "local" });
}

// ── ALM mode ──────────────────────────────────────────────────────────────────

async function runAlmMode(
  root: string,
  existingConfig: OttoConfig | undefined,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const config = existingConfig ?? await promptForJiraConfig(stream);
  if (!config) return;

  const almTool = resolveAlmTool(config);
  const projectKey = resolveProjectKey(config);

  const scopePick = await vscode.window.showQuickPick(
    [
      { label: "$(list-ordered) Specific story", description: `enter a ${almTool} story key`, value: "key" as const },
      { label: "$(symbol-class) Epic", description: `refine every unrefined story under a ${almTool} epic`, value: "epic" as const },
      { label: "$(calendar) Sprint", description: `refine every unrefined story in a ${almTool} sprint`, value: "sprint" as const },
      { label: "$(checklist) All stories in Backlog status", description: `refine everything eligible in ${almTool}`, value: "all" as const },
    ],
    { title: "Refine Agent — ALM Mode", placeHolder: "What would you like to refine?", ignoreFocusOut: true }
  );
  if (!scopePick) { stream.markdown("Refinement cancelled."); return; }

  const eligibleStatuses =
    (almTool === "ADO"
      ? (config.ado?.statusMap ?? config.jira?.statusMap)
      : config.jira?.statusMap ?? config.ado?.statusMap
    )?.story ?? DEFAULT_STATUS_MAP.story;
  const preRefinementStatuses = `"${eligibleStatuses.backlog}" or "${eligibleStatuses.refineInProgress}"`;

  // Batch (epic/sprint) refinement is status-gated; a status map whose pre-refinement
  // and later phases collide cannot tell eligible from refined by status alone. Rather
  // than blocking the run (unreachable on ADO's default Agile process, where every
  // gate is "Active"), flag it to the agent so it degrades to human selection per the
  // status-collision fallback in the refine template.
  const hasStatusCollision = (): boolean => {
    const preRefinementSet = new Set([eligibleStatuses.backlog, eligibleStatuses.refineInProgress]);
    const skipSet = new Set([
      eligibleStatuses.readyForDesign,
      eligibleStatuses.designInProgress,
      eligibleStatuses.readyForBuild,
      eligibleStatuses.inDevelopment,
      eligibleStatuses.readyForTest,
      eligibleStatuses.done,
    ]);
    return [...preRefinementSet].some((s) => skipSet.has(s));
  };
  const collisionNote =
    ` Note: this project's status map cannot distinguish pre-refinement stories from already-refined ones by status alone ` +
    `(e.g. "${eligibleStatuses.refineInProgress}" is used for more than one gate) — list every story in scope with its status ` +
    `and let me choose which ones to refine, per the status-collision fallback.`;

  let userMessage: string;
  if (scopePick.value === "key") {
    const key = await vscode.window.showInputBox({
      title: "Refine Agent — ALM Mode",
      prompt: `Enter the ${almTool} story key`,
      placeHolder: `${projectKey}-123`,
      ignoreFocusOut: true,
    });
    if (!key?.trim()) { stream.markdown("Refinement cancelled."); return; }
    userMessage = key.trim();
  } else if (scopePick.value === "epic") {
    const epicKey = await vscode.window.showInputBox({
      title: "Refine Agent — ALM Mode",
      prompt: `Enter the ${almTool} epic key`,
      placeHolder: `${projectKey}-100`,
      ignoreFocusOut: true,
    });
    if (!epicKey?.trim()) { stream.markdown("Refinement cancelled."); return; }
    userMessage =
      `Refine every unrefined story under epic ${epicKey.trim()}. ` +
      `Expand the epic to its child stories, and treat a story as eligible only when its status is a configured pre-refinement status (${preRefinementStatuses}) — ` +
      `use the ${almTool} status as the source of truth, not any local refinement-notes.md. ` +
      `Skip stories already at "${eligibleStatuses.readyForDesign}" or later. Refine each eligible story in turn and transition it to "${eligibleStatuses.readyForDesign}".` +
      (hasStatusCollision() ? collisionNote : "");
  } else if (scopePick.value === "sprint") {
    const sprint = await vscode.window.showInputBox({
      title: "Refine Agent — ALM Mode",
      prompt: `Enter the ${almTool} sprint name or ID`,
      placeHolder: "Sprint 12",
      ignoreFocusOut: true,
    });
    if (!sprint?.trim()) { stream.markdown("Refinement cancelled."); return; }
    userMessage =
      `Refine every unrefined story in sprint "${sprint.trim()}". ` +
      `Expand the sprint to its stories, and treat a story as eligible only when its status is a configured pre-refinement status (${preRefinementStatuses}) — ` +
      `use the ${almTool} status as the source of truth, not any local refinement-notes.md. ` +
      `Skip stories already at "${eligibleStatuses.readyForDesign}" or later. Refine each eligible story in turn and transition it to "${eligibleStatuses.readyForDesign}".` +
      (hasStatusCollision() ? collisionNote : "");
  } else {
    userMessage = `Refine all stories currently in "${eligibleStatuses.backlog}" status in project ${projectKey}.`;
  }

  return runRefineAgent(config, request, stream, token, userMessage, { defer: true, root, mode: "alm" });
}

// ── Shared model call ────────────────────────────────────────────────────────

/**
 * Renders the `refine-story` template (not the bare `refine` menu) and runs it.
 * Delegates to the shared phase-agent helper so the generated prompt file is
 * keyed by `refine-story` — otherwise it would collide with the `refine-generate-stories`
 * prompt file when both skills run in the same session.
 */
async function runRefineAgent(
  config: OttoConfig,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  userMessage: string,
  opts?: { defer?: boolean; root?: string; mode?: "alm" | "local" }
): Promise<void> {
  const mode = opts?.mode ?? "alm";
  return runPhaseAgent("refine", config, request, stream, token, userMessage, {
    templateKey: "refine-story",
    defer:
      opts?.defer && opts.root
        ? {
            root: opts.root,
            phaseLabel: "Refine",
            mode,
            mcpName: mode === "alm" ? mcpDisplayName(resolveAlmTool(config)) : undefined,
          }
        : undefined,
  });
}

// ── Generate-stories skill ────────────────────────────────────────────────────

async function runGenerateStories(
  root: string,
  existingConfig: OttoConfig | undefined,
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<string | undefined> {
  const modePick = await vscode.window.showQuickPick(
    [
      { label: "$(folder) Local mode", description: "draft into the local backlog under a backlog epic — no PM tool required", value: "local" as const },
      { label: "$(cloud) ALM mode", description: "draft under a JIRA/ADO epic, push explicitly when ready", value: "alm" as const },
    ],
    { title: "Refine Agent — Generate Stories", placeHolder: "How would you like to run generation?", ignoreFocusOut: true }
  );
  if (!modePick) { stream.markdown("Generation cancelled."); return; }

  let config: OttoConfig;
  let epicRef: string;
  const mode = modePick.value;

  if (mode === "local") {
    config = existingConfig ?? buildMinimalConfig("", path.basename(root));
    const backlogPath = path.join(root, config.paths.artifacts, "04 - Backlog", "Backlog Tracker.xlsx");
    if (!fs.existsSync(backlogPath)) {
      stream.markdown(
        `⛔ No backlog found at \`${path.relative(root, backlogPath)}\`.\n\n` +
        "Run `@otto /discover manage-backlog` to generate the backlog first, then pick the epic to draft under."
      );
      return;
    }
    const data = await readBacklogWorkbook(backlogPath);
    const epics = (data.epics ?? []).filter((e): e is typeof e & { id: string } => !!e.id);
    if (epics.length === 0) {
      stream.markdown("ℹ️ The backlog has no epics yet. Run `@otto /discover manage-backlog` to create at least one epic first.");
      return;
    }
    const epicPick = await vscode.window.showQuickPick(
      epics.map((e) => ({ label: `$(symbol-class) ${e.name ?? e.id}`, description: e.id, value: e.id })),
      { title: "Refine Agent — Generate Stories", placeHolder: "Which epic should the new stories sit under?", ignoreFocusOut: true }
    );
    if (!epicPick) { stream.markdown("Generation cancelled."); return; }
    epicRef = epicPick.value;
  } else {
    const almConfig = existingConfig ?? (await promptForJiraConfig(stream));
    if (!almConfig) return;
    config = almConfig;
    const almTool = resolveAlmTool(config);
    const projectKey = resolveProjectKey(config);
    const key = await vscode.window.showInputBox({
      title: "Refine Agent — Generate Stories",
      prompt: `Enter the ${almTool} epic key the new stories should sit under`,
      placeHolder: `${projectKey}-100`,
      ignoreFocusOut: true,
    });
    if (!key?.trim()) { stream.markdown("Generation cancelled."); return; }
    epicRef = key.trim();
  }

  // Source intake — the user points at the transcripts/files to read. Defaults to
  // the inbox so the agent never scans the whole repo.
  const inboxDir = path.join(root, config.paths.artifacts, "00 - Inbox");
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: true,
    openLabel: "Use as source",
    defaultUri: vscode.Uri.file(fs.existsSync(inboxDir) ? inboxDir : root),
    title: "Generate Stories — select source transcripts/files (Cancel to use the inbox)",
  });
  const sources = (picked ?? []).map((u) => path.relative(root, u.fsPath));
  const sourceLine = sources.length
    ? `Read ONLY these source files/folders:\n${sources.map((s) => `- \`${s}\``).join("\n")}`
    : `No specific sources selected — read ONLY the files in \`${path.relative(root, inboxDir)}\`.`;

  const userMessage =
    `Generate candidate stories under epic ${epicRef} (${mode} mode). ${sourceLine}\n\n` +
    `Draft each story with a title, user story, business context, and Gherkin acceptance criteria only — ` +
    `no solution design, org discovery, component/data-model decisions, or story-point estimation. ` +
    `Write the drafts into the local backlog and present them as a review table; do not create any ` +
    `${mode === "alm" ? "PM items" : "records outside the local backlog"} until I explicitly ask to push.`;

  await runPhaseAgent("refine", config, request, stream, token, userMessage, {
    templateKey: "refine-generate-stories",
    defer: {
      root,
      phaseLabel: "Refine",
      mode,
      mcpName: mode === "alm" ? mcpDisplayName(resolveAlmTool(config)) : undefined,
    },
  });
  return "refine-generate-stories";
}


// ── Config helpers ───────────────────────────────────────────────────────────

async function promptForJiraConfig(stream: vscode.ChatResponseStream): Promise<OttoConfig | undefined> {
  stream.markdown(
    "No Otto config found — running in lightweight mode.\n\n" +
    "JIRA status labels and paths will use defaults. " +
    "Run `@otto /init` any time to persist your project settings.\n\n"
  );

  const jiraSite = await vscode.window.showInputBox({
    title: "JIRA Site URL",
    prompt: "Your Atlassian site URL (e.g. https://mycompany.atlassian.net)",
    placeHolder: "https://mycompany.atlassian.net",
    ignoreFocusOut: true,
    validateInput: (v) => {
      try { new URL(v); return null; } catch { return "Enter a valid URL"; }
    },
  });
  if (!jiraSite) {
    stream.markdown("Refinement cancelled.");
    return undefined;
  }

  const jiraKey = await vscode.window.showInputBox({
    title: "JIRA Project Key",
    prompt: "Your JIRA project key (e.g. PROJ, KAN, SF)",
    placeHolder: "PROJ",
    ignoreFocusOut: true,
    validateInput: (v) => (/^[A-Z0-9]+$/i.test(v.trim()) ? null : "Enter a valid project key (letters/numbers only)"),
  });
  if (!jiraKey) {
    stream.markdown("Refinement cancelled.");
    return undefined;
  }

  return buildMinimalConfig(jiraSite.trim(), jiraKey.trim().toUpperCase());
}

function buildMinimalConfig(jiraSite: string, jiraKey: string): OttoConfig {
  return {
    version:      CONFIG_VERSION,
    generatedAt:  new Date().toISOString(),
    toolVersion:  TOOL_VERSION,
    project: {
      name:      jiraKey,
      jiraKey,
      jiraSite,
      jiraEmail: "",
    },
    phases:     ["refine"],
    team:       { sprintLengthWeeks: 2, estimationApproach: "ta-assigns" },
    salesforce: { orgs: { sandbox: "sandbox" } },
    standards:  DEFAULT_STANDARDS,
    jira:       { statusMap: DEFAULT_STATUS_MAP },
    branching:  "gitflow",
    paths:      DEFAULT_PATHS,
  };
}
