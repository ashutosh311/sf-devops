import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { getWorkspaceRoot, loadConfig } from "../config";
import {
  writeBacklogWorkbook,
  readBacklogWorkbook,
  type BacklogData,
  type BacklogEpic,
  type BacklogFeature,
  type BacklogStory,
} from "../backlog";
import {
  readManifest,
  writeManifest,
  manifestFromData,
  writeBacklogMarkdown,
  writeDeltaNote,
  fileChecksum,
  nextCounters,
  formatEpicId,
  formatFeatureId,
  formatStoryId,
  type BacklogManifest,
} from "../backlog-md";
import { extractFileText, extractPdfImages } from "../extract";
import { pushBacklogAdoTemplate, pushBacklogJiraTemplate, syncPmAdoTemplate, syncPmJiraTemplate } from "@sdlc/core";
import type { SdlcConfig } from "@sdlc/core";

// ── Skill catalogue ─────────────────────────────────────────────────────────

type Skill =
  | "setup"
  | "process-session"
  | "generate-backlog"
  | "generate-functional-requirements"
  | "generate-solution-comments"
  | "manage-backlog"
  | "stories-refined"
  | "push-backlog"
  | "sync-pm"
  | "set-preferences"
  | "feedback"
  | "synthesize"
  | "analyze"
  | "conflict-check"
  | "compose-deliverable"
  | "prep-workshop"
  | "hub-audit"
  | "whats-next"
  | "registers-to-stories";

interface SkillMenuItem extends vscode.QuickPickItem {
  skill: Skill;
}

const MENU: SkillMenuItem[] = [
  { skill: "setup", label: "$(new-folder) Set up a new project", description: "scaffold the discovery knowledge hub" },
  { skill: "process-session", label: "$(inbox) Process a workshop session", description: "extract insights from an inbox file" },
  { skill: "prep-workshop", label: "$(calendar) Prepare for an upcoming workshop", description: "agenda + facilitation guide" },
  { skill: "generate-backlog", label: "$(table) Generate Backlog", description: "generate/sync backlog structure and story skeletons" },
  { skill: "generate-functional-requirements", label: "$(list-flat) Generate Functional Requirements", description: "fill missing functional requirements on stories" },
  { skill: "generate-solution-comments", label: "$(comment-discussion) Generate Solution Comments", description: "fill missing solution notes on stories" },
  { skill: "manage-backlog", label: "$(table) Build the backlog", description: "generate/sync the backlog (xlsx + markdown)" },
  { skill: "stories-refined", label: "$(checklist) Mark stories refined", description: "backlog → per-story refinement-notes.md for design" },
  { skill: "set-preferences", label: "$(settings-gear) Set authoring preferences", description: "AC / FR / Solution Notes style" },
  { skill: "push-backlog", label: "$(cloud-upload) Push backlog to PM tool", description: "requires PM tool MCP (Atlassian / Azure DevOps)" },
  { skill: "sync-pm", label: "$(sync) Sync PM status", description: "requires PM tool MCP (Atlassian / Azure DevOps)" },
  { skill: "analyze", label: "$(graph) Analyze and prioritize", description: "rank pain points, coverage, options" },
  { skill: "conflict-check", label: "$(warning) Check for conflicts", description: "contradictions across sessions" },
  { skill: "synthesize", label: "$(sparkle) Synthesize insights", description: "themes and patterns across sessions" },
  { skill: "compose-deliverable", label: "$(file) Compose a deliverable", description: "client-facing document" },
  { skill: "hub-audit", label: "$(checklist) Audit the knowledge hub", description: "completeness + phase-gate readiness" },
  { skill: "registers-to-stories", label: "$(list-unordered) Registers to stories", description: "convert register entries to user stories" },
  { skill: "feedback", label: "$(comment) Give feedback", description: "rate the last command / leave a note" },
  { skill: "whats-next", label: "$(question) What's next?", description: "orientation + recommended next step" },
];

const SKILL_IDS = new Set<string>(MENU.map((m) => m.skill));

// ── Entry point ───────────────────────────────────────────────────────────────

export async function handleDiscover(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    stream.markdown("⛔ No workspace folder open. Open your project folder in VS Code first.");
    return;
  }

  const config = await loadConfig(root);
  if (!config) {
    stream.markdown(
      "⛔ No SDLC config found in this workspace.\n\nRun `@slalom-sdlc /init` to set up the SDLC for this project."
    );
    return;
  }

  const skill = await resolveSkill(request.prompt, stream);
  if (!skill) return; // user cancelled the picker

  const ctx: SkillContext = { root, config, request, stream, token };

  switch (skill) {
    case "setup": return runSetup(ctx);
    case "generate-backlog": return runGenerateBacklog(ctx);
    case "generate-functional-requirements": return runGenerateFunctionalRequirements(ctx);
    case "generate-solution-comments": return runGenerateSolutionComments(ctx);
    case "manage-backlog": return runManageBacklog(ctx);
    case "stories-refined": return runStoriesRefined(ctx);
    case "process-session": return runProcessSession(ctx);
    case "set-preferences": return runSetPreferences(ctx);
    case "feedback": return runFeedback(ctx);
    case "push-backlog":
    case "sync-pm": return runDeferred(ctx, skill);
    default: return runAdvisory(ctx, skill);
  }
}

async function resolveSkill(prompt: string, stream: vscode.ChatResponseStream): Promise<Skill | undefined> {
  const first = prompt.trim().split(/\s+/)[0]?.toLowerCase().replace(/^\//, "");
  if (first && SKILL_IDS.has(first)) return first as Skill;

  const pick = await vscode.window.showQuickPick(MENU, {
    title: "Discovery Agent",
    placeHolder: "What would you like to do?",
    matchOnDescription: true,
    ignoreFocusOut: true,
  });
  if (!pick) {
    stream.markdown("Discovery menu cancelled.");
    return undefined;
  }
  return pick.skill;
}

// ── Shared context + helpers ────────────────────────────────────────────────

interface SkillContext {
  root: string;
  config: SdlcConfig;
  request: vscode.ChatRequest;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
}

function discoveryDir(ctx: SkillContext, ...segments: string[]): string {
  return path.join(ctx.root, ctx.config.paths.artifacts, "discovery", ...segments);
}

const DISCOVERY_FOLDERS = [
  "00 - Project",
  "00 - Inbox",
  "00 - Registers",
  "01 - Sessions",
  "02 - Current State",
  "03 - Future State",
  "04 - Backlog",
  path.join("04 - Backlog", "pushed"),
  "06 - Reference",
];

interface NamedFile { name: string; content: string; }

function readDirFiles(dir: string, exts?: string[]): NamedFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith("."))
    .filter((d) => !exts || exts.some((e) => d.name.toLowerCase().endsWith(e)))
    .map((d) => ({ name: d.name, content: fs.readFileSync(path.join(dir, d.name), "utf-8") }));
}

function combineFiles(files: NamedFile[]): string {
  return files
    .map((f) => `### FILE: ${f.name}\n\n${f.content.trim()}`)
    .join("\n\n---\n\n");
}

function hasContent(files: NamedFile[]): boolean {
  return files.some((f) => {
    // Strip the heading, then check whether anything meaningful remains.
    // Treat the seeded stub ("_No entries yet. …_") as empty so the
    // "run process-session first" guard fires correctly after setup.
    const body = f.content.replace(/^#[^\n]*\n/, "").trim();
    return body.length > 0 && !body.startsWith("_No entries yet.");
  });
}

async function collectResponse(
  ctx: SkillContext,
  systemPrompt: string,
  userContent: string
): Promise<string> {
  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
    vscode.LanguageModelChatMessage.User(userContent),
  ];
  const response = await ctx.request.model.sendRequest(messages, {}, ctx.token);
  let text = "";
  for await (const chunk of response.text) text += chunk;
  return text;
}

/**
 * Send a system prompt, some text, and optionally a set of PNG images to the
 * model in a single request. Images are attached as data parts so a
 * vision-capable model can interpret diagrams/boards. Throws if the model or
 * VS Code build does not support image input, so callers can fall back.
 */
async function collectResponseWithImages(
  ctx: SkillContext,
  systemPrompt: string,
  userContent: string,
  images: Uint8Array[]
): Promise<string> {
  const DataPart = (vscode as unknown as { LanguageModelDataPart?: { image(d: Uint8Array, m: string): unknown } })
    .LanguageModelDataPart;
  const TextPart = (vscode as unknown as { LanguageModelTextPart?: new (v: string) => unknown }).LanguageModelTextPart;
  if (!DataPart || !TextPart) {
    throw new Error("this VS Code build does not support image input");
  }
  const parts: unknown[] = [new TextPart(userContent)];
  for (const png of images) parts.push(DataPart.image(png, "image/png"));

  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
    vscode.LanguageModelChatMessage.User(parts as never),
  ];
  const response = await ctx.request.model.sendRequest(messages, {}, ctx.token);
  let text = "";
  for await (const chunk of response.text) text += chunk;
  return text;
}

async function streamResponse(
  ctx: SkillContext,
  systemPrompt: string,
  userContent: string
): Promise<void> {
  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt),
    vscode.LanguageModelChatMessage.User(userContent),
  ];
  const response = await ctx.request.model.sendRequest(messages, {}, ctx.token);
  for await (const chunk of response.text) ctx.stream.markdown(chunk);
}

function extractJson<T = unknown>(text: string): T | undefined {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}

// ── authoring preferences ─────────────────────────────────────────────────

const PROJECT_FOLDER = "00 - Project";
const PREFERENCES_FILE = "Authoring Preferences.md";
const FEEDBACK_FILE = "Feedback Log.md";
const PHASE_CONTEXT_FILE = "Phase Context.md";

const DEFAULT_AC_STYLE = "Numbered; each criterion on its own line prefixed `AC1 - `, `AC2 - `, … Use Given/When/Then phrasing where it fits.";
const DEFAULT_FR_STYLE = "Numbered; each requirement on its own line prefixed `FR1 - `, `FR2 - `, … Written as `The system shall …`.";
const DEFAULT_SOLUTION_STYLE = "Implementation/configuration guidance — enough to point a developer at the approach (objects, automation type, integration pattern) without fully spelling out the design.";

const DEFAULT_AC_EXAMPLE =
  "AC1 - Given a valid account, when the user saves, then the record is created and confirmed.\nAC2 - Given a missing required field, when the user saves, then an inline validation error is shown.";
const DEFAULT_FR_EXAMPLE =
  "FR1 - The system shall validate the email format before the record is saved.\nFR2 - The system shall prevent duplicate accounts on matching name + postcode.";
const DEFAULT_SOLUTION_EXAMPLE =
  "Use a record-triggered Flow on Account for the validation; consider a Custom Metadata-driven mapping for field defaults so the rules can change without code.";

interface Preferences {
  ac: string;
  fr: string;
  solution: string;
  acEx: string;
  frEx: string;
  solutionEx: string;
  /** Free-form content beyond the 3 templated sections (e.g. feedback-fold blocks). */
  extra?: string;
}

function buildPreferencesDoc(p: Preferences): string {
  const extra = (p.extra ?? "").trim();
  return (
    `# Authoring Preferences\n\n` +
    `_How the backlog builder should write Acceptance Criteria, Functional Requirements and Solution Notes. ` +
    `Edit this file freely — it is read verbatim and given to the model on every backlog run. ` +
    `The **Style** lines are binding and govern wording AND level of detail; the **Example** blocks ` +
    `illustrate format only and are not a length limit. ` +
    `Run \`/discover set-preferences\` to reconfigure interactively._\n\n` +
    `## Acceptance Criteria\n\n**Style:** ${p.ac}\n\n**Example:**\n\n\`\`\`\n${p.acEx}\n\`\`\`\n\n` +
    `## Functional Requirements\n\n**Style:** ${p.fr}\n\n**Example:**\n\n\`\`\`\n${p.frEx}\n\`\`\`\n\n` +
    `## Solution Notes\n\n**Style:** ${p.solution}\n\n**Example:**\n\n\`\`\`\n${p.solutionEx}\n\`\`\`\n` +
    (extra ? `\n${extra}\n` : "")
  );
}

/** Parse a preferences document back into its fields, preserving free-form `extra`. */
function parsePreferences(text: string): Preferences {
  const section = (heading: string): { style: string; example: string; end: number; start: number } => {
    const headRe = new RegExp(`^##\\s+${heading}\\s*$`, "m");
    const m = headRe.exec(text);
    if (!m) return { style: "", example: "", start: -1, end: -1 };
    const start = m.index;
    const rest = text.slice(m.index + m[0].length);
    const nextHead = /^##\s+/m.exec(rest);
    const bodyEnd = nextHead ? m.index + m[0].length + nextHead.index : text.length;
    const body = text.slice(m.index + m[0].length, bodyEnd);
    const styleMatch = /\*\*Style:\*\*\s*([\s\S]*?)(?:\n\n|\*\*Example:\*\*)/.exec(body);
    const style = (styleMatch?.[1] ?? "").trim();
    const exMatch = /\*\*Example:\*\*\s*```[^\n]*\n([\s\S]*?)```/.exec(body);
    const example = (exMatch?.[1] ?? "").replace(/\n$/, "");
    return { style, example, start, end: bodyEnd };
  };

  const acS = section("Acceptance Criteria");
  const frS = section("Functional Requirements");
  const solS = section("Solution Notes");

  let extra = "";
  if (solS.end >= 0 && solS.end < text.length) {
    extra = text.slice(solS.end).trim();
  }

  return {
    ac: acS.style || DEFAULT_AC_STYLE,
    fr: frS.style || DEFAULT_FR_STYLE,
    solution: solS.style || DEFAULT_SOLUTION_STYLE,
    acEx: acS.example || DEFAULT_AC_EXAMPLE,
    frEx: frS.example || DEFAULT_FR_EXAMPLE,
    solutionEx: solS.example || DEFAULT_SOLUTION_EXAMPLE,
    extra,
  };
}

function readPreferences(ctx: SkillContext): Preferences | undefined {
  const p = preferencesPath(ctx);
  if (!fs.existsSync(p)) return undefined;
  return parsePreferences(fs.readFileSync(p, "utf-8"));
}

function defaultPreferencesDoc(): string {
  return buildPreferencesDoc({
    ac: DEFAULT_AC_STYLE,
    fr: DEFAULT_FR_STYLE,
    solution: DEFAULT_SOLUTION_STYLE,
    acEx: DEFAULT_AC_EXAMPLE,
    frEx: DEFAULT_FR_EXAMPLE,
    solutionEx: DEFAULT_SOLUTION_EXAMPLE,
  });
}

function preferencesPath(ctx: SkillContext): string {
  return discoveryDir(ctx, PROJECT_FOLDER, PREFERENCES_FILE);
}

/** Seed the preferences file with documented defaults if it does not exist. */
function seedDefaultPreferences(ctx: SkillContext): boolean {
  const p = preferencesPath(ctx);
  if (fs.existsSync(p)) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, defaultPreferencesDoc());
  return true;
}

/**
 * Load the preferences text, running a one-time interactive capture the first
 * time it is needed. Returns the file contents (verbatim) for prompt injection.
 */
async function ensurePreferences(ctx: SkillContext): Promise<string> {
  const p = preferencesPath(ctx);
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  const doc = await capturePreferences(ctx);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, doc);
  ctx.stream.markdown(`Saved your authoring preferences to \`${PROJECT_FOLDER}/${PREFERENCES_FILE}\`.\n\n`);
  return doc;
}

/**
 * Interactive capture — input boxes prefilled from the current file when present
 * (defaults only on first run), plus an example choice. Preserves free-form `extra`.
 */
async function capturePreferences(ctx: SkillContext, current?: Preferences): Promise<string> {
  const cur = current ?? readPreferences(ctx);
  const ac =
    (await vscode.window.showInputBox({
      title: "Authoring preferences (1/3) — Acceptance Criteria",
      prompt: "How should acceptance criteria be written?",
      value: cur?.ac ?? DEFAULT_AC_STYLE,
      ignoreFocusOut: true,
    })) ?? (cur?.ac ?? DEFAULT_AC_STYLE);
  const fr =
    (await vscode.window.showInputBox({
      title: "Authoring preferences (2/3) — Functional Requirements",
      prompt: "How should functional requirements be written?",
      value: cur?.fr ?? DEFAULT_FR_STYLE,
      ignoreFocusOut: true,
    })) ?? (cur?.fr ?? DEFAULT_FR_STYLE);
  const solution =
    (await vscode.window.showInputBox({
      title: "Authoring preferences (3/3) — Solution Notes",
      prompt: "How should solution notes be written?",
      value: cur?.solution ?? DEFAULT_SOLUTION_STYLE,
      ignoreFocusOut: true,
    })) ?? (cur?.solution ?? DEFAULT_SOLUTION_STYLE);

  let acEx = cur?.acEx ?? DEFAULT_AC_EXAMPLE;
  let frEx = cur?.frEx ?? DEFAULT_FR_EXAMPLE;
  let solutionEx = cur?.solutionEx ?? DEFAULT_SOLUTION_EXAMPLE;

  const wantOwn = await vscode.window.showQuickPick(
    [
      { label: "Keep current examples", description: "leave the examples unchanged", value: "keep" },
      { label: "Edit the examples", description: "type an example for each field", value: "own" },
    ],
    { title: "Examples", placeHolder: "Edit the worked examples, or keep the current ones?", ignoreFocusOut: true }
  );
  if (wantOwn?.value === "own") {
    acEx =
      (await vscode.window.showInputBox({
        title: "Example — Acceptance Criteria",
        value: acEx,
        ignoreFocusOut: true,
      })) || acEx;
    frEx =
      (await vscode.window.showInputBox({
        title: "Example — Functional Requirements",
        value: frEx,
        ignoreFocusOut: true,
      })) || frEx;
    solutionEx =
      (await vscode.window.showInputBox({
        title: "Example — Solution Notes",
        value: solutionEx,
        ignoreFocusOut: true,
      })) || solutionEx;
  }

  return buildPreferencesDoc({ ac, fr, solution, acEx, frEx, solutionEx, extra: cur?.extra });
}

async function runSetPreferences(ctx: SkillContext): Promise<void> {
  const current = readPreferences(ctx);
  const doc = await capturePreferences(ctx, current);
  const p = preferencesPath(ctx);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, doc);
  ctx.stream.markdown(
    `## Authoring preferences updated\n\nSaved to \`${PROJECT_FOLDER}/${PREFERENCES_FILE}\`. ` +
      `Future backlog builds/rebuilds will follow this style (already-generated stories are ` +
      `not rewritten — rebuild the backlog to re-apply).\n`
  );
  await promptForFeedback(ctx, "set-preferences");
}

// ── interactive feedback loop ────────────────────────────────────────────────

/** Session-scoped flag so "don't ask again" is honoured for the current window. */
let feedbackSuppressed = false;

function feedbackLogPath(ctx: SkillContext): string {
  return discoveryDir(ctx, PROJECT_FOLDER, FEEDBACK_FILE);
}

function appendFeedback(ctx: SkillContext, command: string, rating: string, comment: string): void {
  const p = feedbackLogPath(ctx);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const stamp = new Date().toISOString();
  const line = `| ${stamp} | ${command} | ${rating} | ${comment.replace(/\|/g, "\\|").replace(/\n/g, " ") || "—"} |\n`;
  if (!fs.existsSync(p)) {
    fs.writeFileSync(
      p,
      `# Feedback Log\n\n_Interactive feedback captured after \`/discover\` commands. Append-only._\n\n` +
        `| Timestamp | Command | Rating | Comment |\n| --- | --- | --- | --- |\n`
    );
  }
  fs.appendFileSync(p, line);
}

/** Append a feedback-driven adjustment block to the preferences file. */
function foldFeedbackIntoPreferences(ctx: SkillContext, comment: string): void {
  const p = preferencesPath(ctx);
  if (!fs.existsSync(p)) seedDefaultPreferences(ctx);
  const date = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(p, `\n## Adjustments from feedback (${date})\n\n- ${comment.trim()}\n`);
}

/**
 * Low-friction feedback prompt shown at the end of a command. A single keypress
 * to rate; skipping is always one click so it never blocks the flow.
 */
async function promptForFeedback(ctx: SkillContext, command: string): Promise<void> {
  if (feedbackSuppressed) return;
  const pick = await vscode.window.showQuickPick(
    [
      { label: "$(thumbsup) Good", value: "good" },
      { label: "$(thumbsdown) Needs work", value: "needs-work" },
      { label: "$(comment) Add a comment", value: "comment" },
      { label: "$(circle-slash) Skip", value: "skip" },
      { label: "$(bell-slash) Don't ask again this session", value: "mute" },
    ],
    { title: `How was "${command}"?`, placeHolder: "Quick feedback helps tune future runs", ignoreFocusOut: false }
  );
  if (!pick || pick.value === "skip") return;
  if (pick.value === "mute") {
    feedbackSuppressed = true;
    return;
  }

  let comment = "";
  if (pick.value !== "good") {
    comment =
      (await vscode.window.showInputBox({
        title: `Feedback — ${command}`,
        prompt: "What could be better? (optional)",
        ignoreFocusOut: true,
      })) || "";
  }
  appendFeedback(ctx, command, pick.value === "good" ? "👍 Good" : "👎 Needs work", comment);

  // Close the loop: fold authoring/structure feedback into preferences.
  const looksAuthoring = /\b(ac|acceptance|fr|functional|solution|note|criteria|layout|format|structure|wording|style)\b/i.test(
    comment
  );
  if (pick.value !== "good" && comment && looksAuthoring) {
    const fold = await vscode.window.showQuickPick(
      [
        { label: "Yes", description: "add this to Authoring Preferences", value: "yes" },
        { label: "No", value: "no" },
      ],
      { title: "Fold this into Authoring Preferences?", placeHolder: "Future backlog runs will honour it", ignoreFocusOut: true }
    );
    if (fold?.value === "yes") {
      foldFeedbackIntoPreferences(ctx, comment);
      ctx.stream.markdown(`\n_Added your note to \`${PROJECT_FOLDER}/${PREFERENCES_FILE}\`._\n`);
    }
  }
  ctx.stream.markdown(`\n_Thanks — logged to \`${PROJECT_FOLDER}/${FEEDBACK_FILE}\`._\n`);
}

async function runFeedback(ctx: SkillContext): Promise<void> {
  const cmd = await vscode.window.showQuickPick(
    [
      { label: "manage-backlog", value: "manage-backlog" },
      { label: "process-session", value: "process-session" },
      { label: "push-backlog", value: "push-backlog" },
      { label: "set-preferences", value: "set-preferences" },
      { label: "General / other", value: "general" },
    ],
    { title: "Feedback", placeHolder: "Which command or topic is this about?", ignoreFocusOut: true }
  );
  if (!cmd) return;
  await promptForFeedback(ctx, cmd.value);
}

// ── setup ─────────────────────────────────────────────────────────────────────

async function runSetup(ctx: SkillContext): Promise<void> {
  const created: string[] = [];
  for (const folder of DISCOVERY_FOLDERS) {
    const dir = discoveryDir(ctx, folder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      created.push(folder);
    }
  }

  const registerStubs = [
    "Pain Points.md",
    "Requirements.md",
    "System Register.md",
    "Stakeholders.md",
    "RAID.md",
    "Decisions.md",
  ];
  const registersDir = discoveryDir(ctx, "00 - Registers");
  for (const stub of registerStubs) {
    const p = path.join(registersDir, stub);
    if (!fs.existsSync(p)) {
      const title = stub.replace(/\.md$/, "");
      fs.writeFileSync(p, `# ${title}\n\n_No entries yet. Populate via \`/discover process-session\`._\n`);
      created.push(path.join("00 - Registers", stub));
    }
  }

  if (seedDefaultPreferences(ctx)) {
    created.push(path.join(PROJECT_FOLDER, PREFERENCES_FILE));
  }

  ctx.stream.markdown(
    `## Discovery hub ready\n\n` +
      (created.length
        ? `**Created:**\n${created.map((c) => `- \`${c}\``).join("\n")}\n\n`
        : `Everything already existed — nothing to create.\n\n`) +
      `Next: drop workshop notes into \`artifacts/discovery/00 - Inbox/\` and run \`/discover process-session\`.`
  );
  await promptForFeedback(ctx, "setup");
}

// ── manage-backlog ──────────────────────────────────────────────────────────

const BACKLOG_SYSTEM = `You are a Salesforce discovery backlog builder. You are given the raw content of discovery registers (pain points, requirements, stakeholders, RAID, decisions, etc.).

Produce a structured delivery backlog traceable to that evidence: epics, features, user stories, and any open questions.

Return ONLY a single fenced \`\`\`json code block, no prose before or after. The JSON MUST match this schema exactly (omit a field if unknown, but keep the arrays):

{
  "project": "string",
  "epics": [{"id":"EPIC-01","name":"","narrative_goal":"","business_outcome":"","solution_notes":"","requirement_ids":"","pain_points":"","stakeholder_groups":"","priority":"P1|P2|P3","status":"Draft","demo_slice":""}],
  "features": [{"id":"FEAT-01","epic_id":"EPIC-01","epic_name":"","name":"","description":"","system_components":"","dependencies":"","priority":"","complexity":"S|M|L","status":"Draft","implementation_boundary":""}],
  "stories": [{"id":"STORY-001","epic_id":"EPIC-01","epic_name":"","feature_id":"FEAT-01","feature_name":"","user_story":"As a ..., I want ..., so that ...","acceptance_criteria":"","functional_requirements":"","solution_notes":"","use_case_labels":"","size":"S|M|L","status":"Draft"}],
  "open_questions": [{"id":"OQ-001","question":"","owner":"","status":"Open","priority":"","source":""}]
}

Rules: IDs must be stable and sequential. Every story must reference a valid epic_id and feature_id. Do NOT invent field-level design or automation logic — this is discovery-level backlog only.`;

const DELTA_SYSTEM = `You are extending an EXISTING Salesforce discovery backlog with items derived from ONE newly-processed workshop session. You are given the existing epics (id, name, goal) and the new session's notes/registers.

Return ONLY new items — do NOT restate or renumber anything that already exists. Reuse an existing epic_id whenever a new story fits under it; only mint a NEW epic when nothing matches. Use placeholder ids "NEW-E1", "NEW-E2" for any new epics, "NEW-F1"… for new features, and "NEW-S1"… for new stories — the tool will assign final sequential IDs. Reference existing epics by their real id.

Return ONLY a single fenced \`\`\`json block matching:

{
  "epics": [{"id":"NEW-E1","name":"","narrative_goal":"","business_outcome":"","solution_notes":"","requirement_ids":"","pain_points":"","stakeholder_groups":"","priority":"P1|P2|P3","status":"Draft","demo_slice":""}],
  "features": [{"id":"NEW-F1","epic_id":"EPIC-01 or NEW-E1","epic_name":"","name":"","description":"","system_components":"","dependencies":"","priority":"","complexity":"S|M|L","status":"Draft","implementation_boundary":""}],
  "stories": [{"id":"NEW-S1","epic_id":"EPIC-01 or NEW-E1","epic_name":"","feature_id":"NEW-F1","feature_name":"","user_story":"As a ..., I want ..., so that ...","acceptance_criteria":"","functional_requirements":"","solution_notes":"","use_case_labels":"","size":"S|M|L","status":"Draft"}],
  "open_questions": [{"id":"OQ-NEW-1","question":"","owner":"","status":"Open","priority":"","source":""}]
}

This is discovery-level only — no field-level design.`;

const PREFS_FALLBACK =
  "Number acceptance_criteria as `AC1 - `, `AC2 - ` … and functional_requirements as `FR1 - `, `FR2 - ` …. Write solution_notes as implementation/configuration guidance that points a developer at the approach.";

/**
 * Compose the authoritative preferences directive appended to the SYSTEM prompt.
 * The Style lines are binding and govern level of detail; Example blocks show
 * FORMAT only and must not be treated as a length/detail cap.
 */
function prefsDirective(prefsText: string): string {
  const body = prefsText.trim();
  const rules =
    `\n\n=== AUTHORING PREFERENCES (BINDING) ===\n\n` +
    `The following preferences are authoritative and OVERRIDE any default formatting. ` +
    `Apply them to acceptance_criteria, functional_requirements and solution_notes on EVERY item. ` +
    `The **Style** lines govern both wording AND level of detail/verbosity — honour them fully. ` +
    `The **Example** blocks illustrate FORMAT ONLY; their brevity is NOT a length limit — ` +
    `write as much detail as the Style requires.\n\n`;
  return body ? `${rules}${body}\n` : `\n\n=== AUTHORING GUIDANCE ===\n\n${PREFS_FALLBACK}\n`;
}

function backlogSystem(prefsText: string): string {
  return BACKLOG_SYSTEM + prefsDirective(prefsText);
}

function deltaSystem(prefsText: string): string {
  return DELTA_SYSTEM + prefsDirective(prefsText);
}

const BACKLOG_FILE = "Backlog Tracker.xlsx";

/** Backfill epic_name / feature_name on features and stories from their parents. */
function denormalizeNames(data: BacklogData): void {
  const epicName = new Map((data.epics ?? []).map((e) => [e.id ?? "", e.name ?? ""]));
  const featName = new Map((data.features ?? []).map((f) => [f.id ?? "", f.name ?? ""]));
  for (const f of data.features ?? []) {
    if (!f.epic_name && f.epic_id) f.epic_name = epicName.get(f.epic_id) ?? "";
  }
  for (const s of data.stories ?? []) {
    if (!s.epic_name && s.epic_id) s.epic_name = epicName.get(s.epic_id) ?? "";
    if (!s.feature_name && s.feature_id) s.feature_name = featName.get(s.feature_id) ?? "";
  }
}

interface FinalizeOpts {
  mode: "full" | "sync" | "delta";
  prev?: BacklogManifest;
  sessions?: string[];
}

/** Shared writer: workbook + split markdown + manifest + phase context. */
async function finalizeBacklog(
  ctx: SkillContext,
  backlogDir: string,
  workbookPath: string,
  data: BacklogData,
  opts: FinalizeOpts,
  workbookData?: BacklogData
): Promise<{ summary: string; epicFiles: string[] }> {
  if (!data.project) data.project = ctx.config.project.name;
  denormalizeNames(data);
  if (workbookData) {
    if (!workbookData.project) workbookData.project = data.project;
    denormalizeNames(workbookData);
  }

  const summary = await writeBacklogWorkbook(workbookPath, workbookData ?? data);
  const md = writeBacklogMarkdown(backlogDir, data);

  const manifest = manifestFromData(data, opts.prev);
  manifest.workbookChecksum = fileChecksum(workbookPath);
  manifest.sessions = opts.sessions ?? opts.prev?.sessions ?? [];
  writeManifest(backlogDir, manifest);

  writePhaseContext(ctx, data, opts.mode, manifest);
  return { summary, epicFiles: md.epicFiles };
}

/** List processed session folders under `01 - Sessions/`. */
function listSessionFolders(ctx: SkillContext): Array<{ folder: string; title: string }> {
  const dir = discoveryDir(ctx, "01 - Sessions");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => ({ folder: d.name, title: d.name.replace(/^\d{4}-\d{2}-\d{2} - /, "") }));
}

function unprocessedSessions(ctx: SkillContext, manifest: BacklogManifest): Array<{ folder: string; title: string }> {
  const done = new Set(manifest.sessions ?? []);
  return listSessionFolders(ctx).filter((s) => !done.has(s.folder));
}

function readPushRecordEntries(backlogDir: string): Array<{ type: string; id: string; key: string }> {
  const p = path.join(backlogDir, "pushed", "push-record.md");
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, "utf-8");
  const out: Array<{ type: string; id: string; key: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cols = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cols.length < 3) continue;
    const key = cols[0];
    const type = cols[1].toLowerCase();
    const id = cols[2].toUpperCase();
    if (!key || key.toLowerCase() === "jira key") continue; // header row
    if (!["epic", "feature", "story"].includes(type)) continue;
    if (!/^(EPIC|FEAT|STORY)-\d+$/i.test(id)) continue;
    out.push({ type, id, key });
  }
  return out;
}

function reconcileManifestFromPushRecord(backlogDir: string, manifest: BacklogManifest): {
  manifest: BacklogManifest;
  changed: boolean;
} {
  const entries = readPushRecordEntries(backlogDir);
  if (!entries.length) return { manifest, changed: false };
  const next: BacklogManifest = {
    ...manifest,
    epics: [...(manifest.epics ?? [])],
    features: [...(manifest.features ?? [])],
    stories: [...(manifest.stories ?? [])],
  };
  let changed = false;
  const apply = (list: Array<{ id: string; pmKey?: string }>, id: string, key: string): void => {
    const item = list.find((x) => x.id === id);
    if (item) {
      if (item.pmKey !== key) { item.pmKey = key; changed = true; }
    } else {
      // Item exists in the push-record but is absent from the manifest (e.g. manifest was
      // regenerated from a pending-only workbook that omitted this item). Insert a stub so
      // nextCounters always sees the full ID space and never reuses a pushed ID.
      list.push({ id, pmKey: key });
      changed = true;
    }
  };
  for (const e of entries) {
    if (e.type === "epic") apply(next.epics, e.id, e.key);
    else if (e.type === "feature") apply(next.features, e.id, e.key);
    else if (e.type === "story") apply(next.stories, e.id, e.key);
  }
  return { manifest: next, changed };
}

// ── Disregard record helpers ─────────────────────────────────────────────────

const DISREGARD_DIR = "disregarded";
const DISREGARD_RECORD_FILE = "disregard-record.md";

function disregardRecordPath(backlogDir: string): string {
  return path.join(backlogDir, DISREGARD_DIR, DISREGARD_RECORD_FILE);
}

function readDisregardRecord(backlogDir: string): Array<{ type: string; id: string; name: string }> {
  const p = disregardRecordPath(backlogDir);
  if (!fs.existsSync(p)) return [];
  const text = fs.readFileSync(p, "utf-8");
  const out: Array<{ type: string; id: string; name: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cols = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cols.length < 4) continue;
    const type = cols[1].toLowerCase();
    const id = cols[2].toUpperCase();
    const name = cols[3];
    if (!type || type === "type") continue; // header
    if (!["epic", "feature", "story"].includes(type)) continue;
    if (!/^(EPIC|FEAT|STORY)-\d+$/i.test(id)) continue;
    out.push({ type, id, name });
  }
  return out;
}

function reconcileManifestFromDisregardRecord(
  backlogDir: string,
  manifest: BacklogManifest
): { manifest: BacklogManifest; changed: boolean } {
  const entries = readDisregardRecord(backlogDir);
  if (!entries.length) return { manifest, changed: false };
  const next: BacklogManifest = {
    ...manifest,
    epics: [...(manifest.epics ?? [])],
    features: [...(manifest.features ?? [])],
    stories: [...(manifest.stories ?? [])],
  };
  let changed = false;
  const apply = (list: Array<{ id: string; name?: string; disregarded?: boolean }>, id: string, name: string): void => {
    const item = list.find((x) => x.id === id);
    if (item) {
      if (!item.disregarded) { item.disregarded = true; changed = true; }
    } else {
      // Item exists in the disregard-record but is absent from the manifest. Insert a stub
      // so nextCounters always sees the full ID space and never reuses a disregarded ID.
      list.push({ id, name, disregarded: true });
      changed = true;
    }
  };
  for (const e of entries) {
    if (e.type === "epic") apply(next.epics, e.id, e.name);
    else if (e.type === "feature") apply(next.features, e.id, e.name);
    else if (e.type === "story") apply(next.stories, e.id, e.name);
  }
  return { manifest: next, changed };
}

function appendDisregardRecord(
  backlogDir: string,
  entries: Array<{ type: string; id: string; name: string }>
): void {
  if (!entries.length) return;
  const p = disregardRecordPath(backlogDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const now = new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(p)) {
    const header =
      `# Disregard Record\n\n` +
      `Items intentionally excluded from backlog generation.\n` +
      `These are never regenerated by \`/discover manage-backlog\`.\n\n` +
      `| Disregarded At | Type | ID | Name / Summary |\n` +
      `|---|---|---|---|\n`;
    fs.writeFileSync(p, header);
  }
  const existing = readDisregardRecord(backlogDir);
  const existingIds = new Set(existing.map((e) => e.id));
  const newLines = entries
    .filter((e) => !existingIds.has(e.id))
    .map((e) => `| ${now} | ${e.type} | ${e.id} | ${e.name} |`)
    .join("\n");
  if (newLines) {
    fs.appendFileSync(p, newLines + "\n");
  }
}

// ── Pending workbook view ────────────────────────────────────────────────────

/** Count pushed+disregarded items in the manifest — used to detect stale pending views. */
function countExcluded(manifest: BacklogManifest): number {
  let n = 0;
  for (const e of manifest.epics ?? []) if ((e.pmKey || "").trim() || e.disregarded) n++;
  for (const f of manifest.features ?? []) if ((f.pmKey || "").trim() || f.disregarded) n++;
  for (const s of manifest.stories ?? []) if ((s.pmKey || "").trim() || s.disregarded) n++;
  return n;
}

function pendingWorkbookView(data: BacklogData, manifest?: BacklogManifest): BacklogData {
  const excludedEpics = new Set<string>();
  const excludedFeatures = new Set<string>();
  const excludedStories = new Set<string>();

  // Pushed (have JIRA key)
  for (const e of data.epics ?? []) if ((e.pm_key || "").trim()) excludedEpics.add((e.id || "").trim());
  for (const f of data.features ?? []) if ((f.pm_key || "").trim()) excludedFeatures.add((f.id || "").trim());
  for (const s of data.stories ?? []) if ((s.pm_key || "").trim()) excludedStories.add((s.id || "").trim());
  for (const e of manifest?.epics ?? []) if ((e.pmKey || "").trim()) excludedEpics.add((e.id || "").trim());
  for (const f of manifest?.features ?? []) if ((f.pmKey || "").trim()) excludedFeatures.add((f.id || "").trim());
  for (const s of manifest?.stories ?? []) if ((s.pmKey || "").trim()) excludedStories.add((s.id || "").trim());

  // Disregarded (workbook column or manifest flag)
  for (const e of data.epics ?? []) if ((e.disregarded || "").toUpperCase() === "Y") excludedEpics.add((e.id || "").trim());
  for (const f of data.features ?? []) if ((f.disregarded || "").toUpperCase() === "Y") excludedFeatures.add((f.id || "").trim());
  for (const s of data.stories ?? []) if ((s.disregarded || "").toUpperCase() === "Y") excludedStories.add((s.id || "").trim());
  for (const e of manifest?.epics ?? []) if (e.disregarded) excludedEpics.add((e.id || "").trim());
  for (const f of manifest?.features ?? []) if (f.disregarded) excludedFeatures.add((f.id || "").trim());
  for (const s of manifest?.stories ?? []) if (s.disregarded) excludedStories.add((s.id || "").trim());

  // Compute pending stories/features first, then retain their ancestors even if those
  // ancestors are in the excluded (pushed/disregarded) sets. This prevents orphaned
  // workbook rows where a story references an epic_id not present in the Epics sheet.
  const pendingStories = (data.stories ?? []).filter((s) => !excludedStories.has((s.id || "").trim()));
  const pendingFeatures = (data.features ?? []).filter((f) => !excludedFeatures.has((f.id || "").trim()));

  // IDs of ancestors needed by still-pending descendants
  const neededFeatureIds = new Set<string>(pendingStories.map((s) => (s.feature_id || "").trim()).filter(Boolean));
  const neededEpicIds = new Set<string>([
    ...pendingStories.map((s) => (s.epic_id || "").trim()).filter(Boolean),
    ...(data.features ?? [])
      .filter((f) => neededFeatureIds.has((f.id || "").trim()))
      .map((f) => (f.epic_id || "").trim())
      .filter(Boolean),
    ...pendingFeatures.map((f) => (f.epic_id || "").trim()).filter(Boolean),
  ]);

  // A pushed/disregarded ancestor is retained only because a child still needs it; merge
  // with genuinely pending items to avoid duplicates.
  const retainedFeatureIds = new Set([...pendingFeatures.map((f) => (f.id || "").trim()), ...neededFeatureIds]);
  const retainedEpicIds = new Set([...pendingFeatures.map((f) => (f.epic_id || "").trim()).filter(Boolean), ...(data.epics ?? []).filter((e) => !excludedEpics.has((e.id || "").trim())).map((e) => (e.id || "").trim()), ...neededEpicIds]);

  const out: BacklogData = {
    project: data.project,
    epics: (data.epics ?? []).filter((e) => retainedEpicIds.has((e.id || "").trim())),
    features: (data.features ?? []).filter((f) => retainedFeatureIds.has((f.id || "").trim())),
    stories: pendingStories,
    open_questions: data.open_questions ?? [],
  };
  denormalizeNames(out);
  return out;
}

function writePhaseContext(
  ctx: SkillContext,
  data: BacklogData,
  mode: "full" | "sync" | "delta",
  manifest: BacklogManifest
): void {
  const p = discoveryDir(ctx, PROJECT_FOLDER, PHASE_CONTEXT_FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const status = manifest.pushedAt
    ? `Pushed to PM tool on ${manifest.pushedAt.slice(0, 10)} — **the PM tool is the source of truth**; the markdown mirror is the local, diff-able background.`
    : mode === "sync"
      ? "Synced from workbook edits — drafted locally, not yet pushed to PM tool."
      : "Drafted locally — not yet pushed to PM tool.";
  const next = manifest.pushedAt
    ? "Run `/discover sync-pm` to refresh status, or proceed to the refine/design phases per story."
    : "Review `04 - Backlog/Backlog Tracker.xlsx`, then run `/discover push-backlog` (agent with PM tool MCP) to create the items.";
  const content =
    `# Discovery Phase Context\n\n` +
    `_Handoff note for the refine / design / build phases. Machine-maintained by \`/discover manage-backlog\`._\n\n` +
    `**Project:** ${data.project}\n\n` +
    `**Backlog:** ${(data.epics ?? []).length} epics · ${(data.features ?? []).length} features · ${(data.stories ?? []).length} stories\n\n` +
    `**Status:** ${status}\n\n` +
    `## Where the discovery context lives\n\n` +
    `- Evidence registers — \`00 - Registers/*.md\`\n` +
    `- Session notes — \`01 - Sessions/<date - title>/Discovery Notes.md\` + \`_index.md\`\n` +
    `- Backlog spreadsheet — \`04 - Backlog/Backlog Tracker.xlsx\` (human review/edit surface)\n` +
    `- Backlog index — \`04 - Backlog/_index.md\`\n` +
    `- Per-epic detail — \`04 - Backlog/epics/<EPIC-ID> - <name>.md\` (AC, FR, solution notes, traceability)\n` +
    `- Open questions — \`04 - Backlog/open-questions.md\`\n` +
    `- Manifest (IDs + PM keys) — \`04 - Backlog/_manifest.json\`\n` +
    `- Authoring preferences — \`00 - Project/${PREFERENCES_FILE}\`\n\n` +
    `## Next step\n\n${next}\n`;
  fs.writeFileSync(p, content);
}

/** Merge model-generated delta items into existing data with stable IDs.
 *  Pass the current manifest so that counters include IDs deleted from the
 *  workbook — prevents reuse of a deleted item's ID for a new item. */
function mergeDelta(
  existing: BacklogData,
  delta: BacklogData,
  manifest?: BacklogManifest
): { merged: BacklogData; added: { epics: BacklogEpic[]; features: BacklogFeature[]; stories: BacklogStory[] } } {
  const counters = nextCounters(existing, manifest);
  const existingEpicIds = new Set((existing.epics ?? []).map((e) => e.id));
  const epicIdMap = new Map<string, string>();
  const featIdMap = new Map<string, string>();
  const addedEpics: BacklogEpic[] = [];
  const addedFeatures: BacklogFeature[] = [];
  const addedStories: BacklogStory[] = [];

  for (const e of delta.epics ?? []) {
    const orig = e.id ?? "";
    if (existingEpicIds.has(orig)) {
      epicIdMap.set(orig, orig); // model referenced an existing epic — reuse, don't recreate
      continue;
    }
    counters.epic += 1;
    const nid = formatEpicId(counters.epic);
    epicIdMap.set(orig || nid, nid);
    e.id = nid;
    addedEpics.push(e);
  }
  const resolveEpic = (id?: string): string => (id ? epicIdMap.get(id) ?? id : "");

  for (const f of delta.features ?? []) {
    const orig = f.id ?? "";
    counters.feature += 1;
    const nid = formatFeatureId(counters.feature);
    featIdMap.set(orig || nid, nid);
    f.id = nid;
    f.epic_id = resolveEpic(f.epic_id);
    addedFeatures.push(f);
  }
  const resolveFeat = (id?: string): string => (id ? featIdMap.get(id) ?? id : "");

  for (const s of delta.stories ?? []) {
    counters.story += 1;
    s.id = formatStoryId(counters.story);
    s.epic_id = resolveEpic(s.epic_id);
    s.feature_id = resolveFeat(s.feature_id);
    addedStories.push(s);
  }

  const merged: BacklogData = {
    project: existing.project,
    epics: [...(existing.epics ?? []), ...addedEpics],
    features: [...(existing.features ?? []), ...addedFeatures],
    stories: [...(existing.stories ?? []), ...addedStories],
    open_questions: [...(existing.open_questions ?? []), ...(delta.open_questions ?? [])],
  };
  return { merged, added: { epics: addedEpics, features: addedFeatures, stories: addedStories } };
}

async function runGenerateBacklog(ctx: SkillContext): Promise<void> {
  ctx.stream.markdown("Running **Generate Backlog (BA)** using the combined backlog flow.\n\n");
  await runManageBacklog(ctx);
}

async function runGenerateFunctionalRequirements(ctx: SkillContext): Promise<void> {
  await runStoryFieldGenerator(
    ctx,
    "generate-functional-requirements",
    "Functional Requirements",
    "functional_requirements",
    "Generate concise, implementable Functional Requirements aligned to discovery evidence."
  );
}

async function runGenerateSolutionComments(ctx: SkillContext): Promise<void> {
  await runStoryFieldGenerator(
    ctx,
    "generate-solution-comments",
    "Solution Notes",
    "solution_notes",
    "Generate practical implementation guidance (solution comments) aligned to discovery evidence."
  );
}

async function runStoryFieldGenerator(
  ctx: SkillContext,
  commandName: string,
  fieldLabel: string,
  fieldName: "functional_requirements" | "solution_notes",
  fieldInstruction: string
): Promise<void> {
  const backlogDir = discoveryDir(ctx, "04 - Backlog");
  const workbookPath = path.join(backlogDir, BACKLOG_FILE);
  const manifest = readManifest(backlogDir);
  if (!manifest || !fs.existsSync(workbookPath)) {
    ctx.stream.markdown("⛔ No backlog found. Run `/discover generate-backlog` (or `/discover manage-backlog`) first.");
    return;
  }

  const prefsText = await ensurePreferences(ctx);

  let data: BacklogData;
  try {
    data = await readBacklogWorkbook(workbookPath);
  } catch (err) {
    ctx.stream.markdown(`⛔ Could not read \`${BACKLOG_FILE}\`: ${String(err)}`);
    return;
  }
  data.project ||= manifest.project || ctx.config.project.name;
  denormalizeNames(data);

  const stories = data.stories ?? [];
  if (!stories.length) {
    ctx.stream.markdown("⛔ The workbook has no stories. Run `/discover generate-backlog` first.");
    return;
  }

  const mode = await vscode.window.showQuickPick(
    [
      {
        label: `$(sparkle) Fill missing ${fieldLabel} only`,
        description: "recommended — leave existing values untouched",
        value: "missing",
      },
      {
        label: `$(warning) Overwrite all ${fieldLabel}`,
        description: "re-generate values for all stories",
        value: "overwrite",
      },
    ],
    {
      title: `${fieldLabel} Generator`,
      placeHolder: "How should existing values be handled?",
      ignoreFocusOut: true,
    }
  );
  if (!mode) {
    ctx.stream.markdown("Operation cancelled.");
    return;
  }

  const targets = stories.filter((s) => {
    const v = (s[fieldName] || "").trim();
    return mode.value === "overwrite" ? true : !v;
  });
  if (!targets.length) {
    ctx.stream.markdown(`No target stories found — every story already has ${fieldLabel}.`);
    return;
  }

  const registers = readDirFiles(discoveryDir(ctx, "00 - Registers"), [".md"]);
  if (!hasContent(registers)) {
    ctx.stream.markdown(
      "⛔ The registers in `00 - Registers/` are empty. Run `/discover process-session` to extract content first."
    );
    return;
  }
  const enrichment = [
    ...readDirFiles(discoveryDir(ctx, "02 - Current State"), [".md"]),
    ...readDirFiles(discoveryDir(ctx, "03 - Future State"), [".md"]),
  ];

  const storyLines = targets
    .map((s) => `- ${s.id}: ${s.user_story || ""}`)
    .join("\n");
  const userContent =
    `PROJECT: ${data.project}\n\n` +
    `TARGET FIELD: ${fieldLabel}\n\n` +
    `TARGET STORIES (${targets.length}):\n${storyLines}\n\n` +
    `=== REGISTERS ===\n\n${combineFiles(registers)}` +
    (enrichment.length ? `\n\n=== SUPPORTING CONTEXT ===\n\n${combineFiles(enrichment)}` : "") +
    `\n\n=== AUTHORING PREFERENCES ===\n\n${prefsText}`;
  const systemPrompt =
    `You are a Salesforce discovery assistant.\n` +
    `${fieldInstruction}\n\n` +
    `Return ONLY valid JSON in this exact shape:\n` +
    `{"updates":[{"id":"STORY-001","value":"..."}]}\n\n` +
    `Rules:\n` +
    `- Update only the requested field.\n` +
    `- Include only IDs from the target stories list.\n` +
    `- Do not add other fields or prose.`;

  let raw: string;
  try {
    raw = await collectResponse(ctx, systemPrompt, userContent);
  } catch (err) {
    ctx.stream.markdown(`⛔ Model error while generating ${fieldLabel}: ${String(err)}`);
    return;
  }

  const parsed = extractJson<{ updates?: Array<{ id?: string; value?: string }> }>(raw);
  const updates = parsed?.updates ?? [];
  if (!updates.length) {
    ctx.stream.markdown(`⛔ Could not parse ${fieldLabel} updates from the model response. Please try again.`);
    return;
  }

  const targetById = new Map(targets.map((s) => [(s.id || "").trim(), s]));
  let changed = 0;
  for (const u of updates) {
    const id = (u.id || "").trim();
    const value = (u.value || "").trim();
    if (!id || !value) continue;
    const story = targetById.get(id);
    if (!story) continue;
    if ((story[fieldName] || "").trim() === value) continue;
    story[fieldName] = value;
    changed += 1;
  }

  if (!changed) {
    ctx.stream.markdown(`No ${fieldLabel} values were changed.`);
    return;
  }

  try {
    const summary = await writeBacklogWorkbook(workbookPath, data);
    // Do NOT call writeBacklogMarkdown here — data is the pending-only workbook view and
    // would prune markdown files for pushed epics. The markdown split is full-context and
    // is only rewritten by fullBuild/deltaBuild/syncFromWorkbook("all").
    const updated = manifestFromData(data, manifest);
    updated.workbookChecksum = fileChecksum(workbookPath);
    updated.sessions = manifest.sessions ?? [];
    writeManifest(backlogDir, updated);
    writePhaseContext(ctx, data, "sync", updated);
    ctx.stream.markdown(
      `## ${fieldLabel} updated\n\n` +
      `Updated **${changed}** story(ies). Workbook now has **${summary}**.\n\n` +
      `Only \`${fieldName}\` was modified; other story fields were preserved.`
    );
  } catch (err) {
    ctx.stream.markdown(`⛔ Failed to write updates: ${String(err)}`);
    return;
  }

  await promptForFeedback(ctx, commandName);
}

async function runManageBacklog(ctx: SkillContext): Promise<void> {
  const backlogDir = discoveryDir(ctx, "04 - Backlog");
  const workbookPath = path.join(backlogDir, BACKLOG_FILE);
  const prefsText = await ensurePreferences(ctx);
  let manifest = readManifest(backlogDir);

  // ── First build: no manifest yet → full derivation from registers ──────────
  if (!manifest) {
    await fullBuild(ctx, backlogDir, workbookPath, prefsText, "pending");
    await promptForFeedback(ctx, "manage-backlog");
    return;
  }

  // If users pushed manually (outside the managed flow), infer pushed keys from
  // pushed/push-record.md so pending filtering still works reliably.
  const reconciled = reconcileManifestFromPushRecord(backlogDir, manifest);
  if (reconciled.changed) {
    manifest = reconciled.manifest;
    writeManifest(backlogDir, manifest);
    ctx.stream.markdown("Detected manual push history in `pushed/push-record.md` and reconciled PM keys in the manifest.\n\n");
  }

  // Re-apply disregarded flags from disregard-record.md (protects against workbook rebuilds).
  const disregardReconciled = reconcileManifestFromDisregardRecord(backlogDir, manifest);
  if (disregardReconciled.changed) {
    manifest = disregardReconciled.manifest;
    writeManifest(backlogDir, manifest);
    ctx.stream.markdown("Applied disregarded flags from `disregarded/disregard-record.md` to manifest.\n\n");
  }

  // ── Progressive: auto-sync markdown + manifest from an edited workbook ──────
  let synced = false;
  let liveManifest: BacklogManifest = manifest;
  const currentChecksum = fileChecksum(workbookPath);
  if (currentChecksum && manifest.workbookChecksum && currentChecksum !== manifest.workbookChecksum) {
    ctx.stream.markdown("Detected edits in the workbook — syncing manifest to match…\n\n");
    liveManifest = (await syncFromWorkbook(ctx, backlogDir, workbookPath, manifest, "pending")) ?? manifest;
    synced = true;
  } else if (!synced && typeof manifest.workbookExcludedCount === "number" && countExcluded(manifest) > manifest.workbookExcludedCount) {
    // Manifest was updated externally (e.g. push-backlog added PM keys) without touching the xlsx.
    // The pending view is now stale — refresh it automatically.
    ctx.stream.markdown("Backlog has been updated externally — refreshing pending workbook view…\n\n");
    liveManifest = (await syncFromWorkbook(ctx, backlogDir, workbookPath, manifest, "pending")) ?? manifest;
    synced = true;
  }

  // ── Propose the next action (delta auto-proposed for a new session) ─────────
  const unprocessed = unprocessedSessions(ctx, manifest);
  const choices: Array<vscode.QuickPickItem & { value: string }> = [];
  if (unprocessed.length) {
    choices.push({
      label: "$(diff-added) Add new session to backlog",
      description: `${unprocessed[0].title} — additive, keeps existing IDs`,
      value: "delta",
    });
  }
  choices.push({
    label: "$(sync) Refresh pending-only workbook",
    description: "default — keep only not-yet-pushed items in Backlog Tracker.xlsx",
    value: "refresh-pending",
  });
  choices.push({
    label: "$(warning) Super option: rebuild everything from scratch",
    description: "regenerate all items from registers (renumbers IDs; use rarely)",
    value: "rebuild-all",
  });
  choices.push({
    label: "$(check) Done",
    description: synced ? "keep the synced backlog" : "no further changes",
    value: "done",
  });

  const pick = await vscode.window.showQuickPick(choices, {
    title: "Manage backlog",
    placeHolder: unprocessed.length ? `New session ready: ${unprocessed[0].title}` : "What would you like to do?",
    ignoreFocusOut: true,
  });
  const action = pick?.value ?? "refresh-pending";

  if (action === "delta") {
    await deltaBuild(ctx, backlogDir, workbookPath, liveManifest, unprocessed[0], prefsText, "pending");
  } else if (action === "refresh-pending") {
    const refreshed = await syncFromWorkbook(ctx, backlogDir, workbookPath, liveManifest, "pending");
    if (!refreshed && !synced) ctx.stream.markdown("No changes made.");
  } else if (action === "rebuild-all") {
    const confirm = await vscode.window.showQuickPick(
      [
        { label: "Yes, rebuild everything", description: "super option — all items regenerated from registers", value: "yes" },
        { label: "Cancel", value: "no" },
      ],
      { title: "Super option: rebuild all items?", placeHolder: "This regenerates everything and can renumber IDs", ignoreFocusOut: true }
    );
    if (confirm?.value === "yes") {
      await fullBuild(ctx, backlogDir, workbookPath, prefsText, "all");
    } else if (!synced) {
      ctx.stream.markdown("Left the backlog unchanged.");
    }
  } else if (!synced) {
    ctx.stream.markdown("No changes made.");
  }

  await promptForFeedback(ctx, "manage-backlog");
}

async function fullBuild(
  ctx: SkillContext,
  backlogDir: string,
  workbookPath: string,
  prefsText: string,
  workbookMode: "pending" | "all"
): Promise<void> {
  const registers = readDirFiles(discoveryDir(ctx, "00 - Registers"), [".md"]);
  if (!hasContent(registers)) {
    ctx.stream.markdown(
      "⛔ The registers in `00 - Registers/` are empty. Run `/discover process-session` to extract content from a workshop first."
    );
    return;
  }

  ctx.stream.markdown("Reading registers and drafting the backlog…\n\n");

  const enrichment = [
    ...readDirFiles(discoveryDir(ctx, "02 - Current State"), [".md"]),
    ...readDirFiles(discoveryDir(ctx, "03 - Future State"), [".md"]),
  ];

  // Inject any previously disregarded items so the model knows not to regenerate them.
  const disregardedEntries = readDisregardRecord(backlogDir);
  const disregardedSection = disregardedEntries.length
    ? `\n\n=== DISREGARDED ITEMS (excluded from scope — do not generate) ===\n\n` +
      disregardedEntries.map((e) => `- ${e.type} ${e.id}: ${e.name}`).join("\n")
    : "";

  const userContent =
    `PROJECT: ${ctx.config.project.name}\n\n` +
    `=== REGISTERS ===\n\n${combineFiles(registers)}` +
    (enrichment.length ? `\n\n=== SUPPORTING CONTEXT ===\n\n${combineFiles(enrichment)}` : "") +
    disregardedSection;

  const systemPrompt = backlogSystem(prefsText) +
    (disregardedEntries.length
      ? "\n\nIMPORTANT: Do not generate items listed under DISREGARDED ITEMS. These have been explicitly excluded from this project's scope."
      : "");

  let raw: string;
  try {
    raw = await collectResponse(ctx, systemPrompt, userContent);
  } catch (err) {
    ctx.stream.markdown(`⛔ Model error while drafting the backlog: ${String(err)}`);
    return;
  }

  const data = extractJson<BacklogData>(raw);
  if (!data) {
    ctx.stream.markdown(
      "⛔ Could not parse a valid backlog from the model response. Please try again.\n\n" +
        "<details><summary>Raw response</summary>\n\n```\n" +
        raw.slice(0, 4000) +
        "\n```\n</details>"
    );
    return;
  }

  const sessions = listSessionFolders(ctx).map((s) => s.folder);
  // Re-read manifest to carry forward disregarded items into the new manifest.
  const prevManifest = readManifest(backlogDir);
  try {
    const { summary } = await finalizeBacklog(
      ctx,
      backlogDir,
      workbookPath,
      data,
      { mode: "full", sessions, prev: prevManifest },
      workbookMode === "pending" ? pendingWorkbookView(data, prevManifest) : data
    );
    const rel = path.relative(ctx.root, workbookPath);
    ctx.stream.markdown(
      `## Backlog created\n\n` +
        `Wrote **${summary}** to \`${rel}\`.\n\n` +
        `Also wrote the split markdown background (\`_index.md\`, \`epics/\`, \`open-questions.md\`), the manifest, and \`${PROJECT_FOLDER}/${PHASE_CONTEXT_FILE}\`.\n\n` +
        renderBacklogPreview(data) +
        `\n\nReview the workbook, then run \`/discover push-backlog\` (agent with PM tool MCP) to create the items.`
    );
  } catch (err) {
    ctx.stream.markdown(`⛔ Failed to write the backlog: ${String(err)}`);
  }
}

async function syncFromWorkbook(
  ctx: SkillContext,
  backlogDir: string,
  workbookPath: string,
  manifest: BacklogManifest,
  workbookMode: "pending" | "all"
): Promise<BacklogManifest | undefined> {
  let data: BacklogData;
  try {
    data = await readBacklogWorkbook(workbookPath);
  } catch (err) {
    ctx.stream.markdown(`⚠️ Could not read the edited workbook (${String(err)}) — skipping sync.\n\n`);
    return undefined;
  }
  data.project ||= manifest.project || ctx.config.project.name;
  denormalizeNames(data);
  if (workbookMode === "all") {
    writeBacklogMarkdown(backlogDir, data);
  }
  const workbookData = workbookMode === "pending" ? pendingWorkbookView(data, manifest) : data;
  await writeBacklogWorkbook(workbookPath, workbookData);

  const updated = manifestFromData(data, manifest);
  updated.workbookChecksum = fileChecksum(workbookPath);
  if (workbookMode === "pending") {
    updated.workbookExcludedCount = countExcluded(updated);
  }
  updated.sessions = manifest.sessions ?? [];
  writeManifest(backlogDir, updated);
  writePhaseContext(ctx, data, "sync", updated);

  ctx.stream.markdown(
    `Synced manifest from your workbook edits, then refreshed \`${BACKLOG_FILE}\` ` +
      `(${(workbookData.epics ?? []).length} epics · ${(workbookData.stories ?? []).length} stories).\n\n`
  );
  return updated;
}

async function deltaBuild(
  ctx: SkillContext,
  backlogDir: string,
  workbookPath: string,
  manifest: BacklogManifest,
  session: { folder: string; title: string },
  prefsText: string,
  workbookMode: "pending" | "all"
): Promise<void> {
  let existing: BacklogData;
  try {
    existing = await readBacklogWorkbook(workbookPath);
  } catch (err) {
    ctx.stream.markdown(`⛔ Could not read the existing backlog workbook: ${String(err)}. Try a rebuild instead.`);
    return;
  }
  existing.project ||= manifest.project || ctx.config.project.name;

  const notePath = path.join(discoveryDir(ctx, "01 - Sessions", session.folder), "Discovery Notes.md");
  const note = fs.existsSync(notePath) ? fs.readFileSync(notePath, "utf-8") : "";
  if (note.replace(/\s+/g, "").length < 40) {
    ctx.stream.markdown(`⛔ Session \`${session.folder}\` has no usable notes to derive stories from.`);
    return;
  }

  ctx.stream.markdown(`Extracting new backlog items from **${session.title}** (additive)…\n\n`);

  const existingEpics = (existing.epics ?? [])
    .map((e) => `- ${e.id}: ${e.name}${e.narrative_goal ? ` — ${e.narrative_goal}` : ""}`)
    .join("\n");
  const userContent =
    `PROJECT: ${existing.project}\n\n` +
    `=== EXISTING EPICS (reuse these ids where new stories fit) ===\n\n${existingEpics || "(none)"}\n\n` +
    `=== NEW SESSION: ${session.title} ===\n\n${note.trim()}`;

  let raw: string;
  try {
    raw = await collectResponse(ctx, deltaSystem(prefsText), userContent);
  } catch (err) {
    ctx.stream.markdown(`⛔ Model error while extracting the delta: ${String(err)}`);
    return;
  }

  const delta = extractJson<BacklogData>(raw);
  if (!delta) {
    ctx.stream.markdown("⛔ Could not parse the delta from the model response. Please try again.");
    return;
  }

  const { merged, added } = mergeDelta(existing, delta, manifest);
  if (!added.epics.length && !added.features.length && !added.stories.length) {
    // Still mark the session processed so it isn't re-proposed forever.
    const m = manifestFromData(merged, manifest);
    m.workbookChecksum = manifest.workbookChecksum;
    m.sessions = [...new Set([...(manifest.sessions ?? []), session.folder])];
    writeManifest(backlogDir, m);
    ctx.stream.markdown(`No new backlog items were found in **${session.title}**. Marked as processed.`);
    return;
  }

  const dateStamp = new Date().toISOString().slice(0, 10);
  const sessions = [...new Set([...(manifest.sessions ?? []), session.folder])];
  try {
    const { summary } = await finalizeBacklog(
      ctx,
      backlogDir,
      workbookPath,
      merged,
      {
        mode: "delta",
        prev: manifest,
        sessions,
      },
      workbookMode === "pending" ? pendingWorkbookView(merged, manifest) : merged
    );
    denormalizeNames(merged);
    const deltaRel = writeDeltaNote(backlogDir, session.title, dateStamp, added);
    ctx.stream.markdown(
      `## Backlog updated (delta)\n\n` +
        `Added **${added.epics.length} epic(s), ${added.features.length} feature(s), ${added.stories.length} story(ies)** from **${session.title}**.\n\n` +
        `Existing items and IDs were preserved. Backlog now holds **${summary}**.\n\n` +
        `Delta summary: \`04 - Backlog/${deltaRel}\`.\n\n` +
        `Review the workbook, then run \`/discover push-backlog\` — already-pushed items are updated, new items are created.`
    );
  } catch (err) {
    ctx.stream.markdown(`⛔ Failed to write the updated backlog: ${String(err)}`);
  }
}

function renderBacklogPreview(data: BacklogData): string {
  const epics = data.epics ?? [];
  if (!epics.length) return "";
  const rows = epics
    .slice(0, 15)
    .map((e) => `| ${e.id ?? ""} | ${e.name ?? ""} | ${e.priority ?? ""} |`)
    .join("\n");
  return `**Epics**\n\n| ID | Name | Priority |\n|----|------|----------|\n${rows}`;
}

// ── stories-refined ───────────────────────────────────────────────────────────
//
// Bridges the reviewed backlog to the design phase: for every story that has
// acceptance criteria, write a per-story `refinement-notes.md` (business context
// + AC) that `/design` consumes. Deterministic — no model call. PM-tool-agnostic:
// the story key is the PM tool key when present, else the backlog Story ID.

const REFINEMENT_FILE = "refinement-notes.md";

/**
 * Where a story's refinement-notes.md lives:
 *   artifacts/discovery/04 - Backlog/stories/{EPIC-ID}/{STORY-KEY}/refinement-notes.md
 * Falls back to "ungrouped" when the story has no epic_id.
 */
function refinementNotesPath(ctx: SkillContext, story: BacklogStory): string {
  const key = storyKey(story);
  const epicId = (story.epic_id || "ungrouped").trim();
  return discoveryDir(ctx, "04 - Backlog", "stories", epicId, key, REFINEMENT_FILE);
}

function mdSection(heading: string, value?: string): string {
  const v = (value || "").trim();
  return v ? `## ${heading}\n\n${v}\n\n` : "";
}

function mdLabel(label: string, value?: string): string {
  const v = (value || "").trim();
  return v ? `**${label}:** ${v}\n` : "";
}

function renderRefinementNotes(
  story: BacklogStory,
  key: string,
  epic?: BacklogEpic,
  feature?: BacklogFeature
): string {
  const title = (story.user_story || "").replace(/\s+/g, " ").trim().slice(0, 80) || "(user story)";
  let out = `# Refinement Notes: ${title} (${key})\n\n`;
  out +=
    `_Generated by \`/discover stories-refined\` from the discovery backlog. ` +
    `Business-readiness context + acceptance criteria for the design phase. ` +
    `Source of truth for AC is the backlog until pushed to the PM tool._\n\n`;

  out += mdSection("Story", story.user_story);

  let meta = "";
  meta += mdLabel("Backlog ID", story.id);
  meta += mdLabel("PM Key", story.pm_key);
  if (epic) meta += mdLabel("Epic", `${epic.id ?? ""}${epic.name ? ` — ${epic.name}` : ""}`);
  else if (story.epic_id) meta += mdLabel("Epic", `${story.epic_id}${story.epic_name ? ` — ${story.epic_name}` : ""}`);
  if (feature) meta += mdLabel("Feature", `${feature.id ?? ""}${feature.name ? ` — ${feature.name}` : ""}`);
  else if (story.feature_id) meta += mdLabel("Feature", `${story.feature_id}${story.feature_name ? ` — ${story.feature_name}` : ""}`);
  meta += mdLabel("Size", story.size);
  meta += mdLabel("Status", story.status);
  if (meta.trim()) out += `## Details\n\n${meta}\n`;

  let ctxBlock = "";
  ctxBlock += mdLabel("Narrative Goal", epic?.narrative_goal);
  ctxBlock += mdLabel("Business Outcome", epic?.business_outcome);
  ctxBlock += mdLabel("Pain Points Addressed", epic?.pain_points);
  ctxBlock += mdLabel("Stakeholder Groups", epic?.stakeholder_groups);
  ctxBlock += mdLabel("Feature Description", feature?.description);
  if (ctxBlock.trim()) out += `## Business Context\n\n${ctxBlock}\n`;

  out += mdSection("Acceptance Criteria", story.acceptance_criteria);
  out += mdSection("Functional Requirements", story.functional_requirements);
  out += mdSection("Solution Notes (discovery-level)", story.solution_notes);
  out += mdSection("Use Case Labels", story.use_case_labels);

  return out.trimEnd() + "\n";
}

function storyKey(story: BacklogStory): string {
  return (story.pm_key || story.id || "").trim();
}

async function runStoriesRefined(ctx: SkillContext): Promise<void> {
  const backlogDir = discoveryDir(ctx, "04 - Backlog");
  const workbookPath = path.join(backlogDir, BACKLOG_FILE);
  if (!fs.existsSync(workbookPath)) {
    ctx.stream.markdown(
      "⛔ No backlog found. Run `/discover manage-backlog` to build `04 - Backlog/Backlog Tracker.xlsx` first, " +
        "then review/edit it and run `/discover stories-refined`."
    );
    return;
  }

  let data: BacklogData;
  try {
    data = await readBacklogWorkbook(workbookPath);
  } catch (err) {
    ctx.stream.markdown(`⛔ Could not read the backlog workbook: ${String(err)}`);
    return;
  }

  const epicById = new Map((data.epics ?? []).map((e) => [e.id ?? "", e]));
  const featureById = new Map((data.features ?? []).map((f) => [f.id ?? "", f]));
  const allStories = data.stories ?? [];

  // Exclude disregarded stories from refinement.
  // Also persist any newly workbook-disregarded items to the record file so they're
  // remembered by fullBuild and not pushed to the PM tool.
  const existingRecordIds = new Set(readDisregardRecord(backlogDir).map((e) => e.id));
  const manifest = readManifest(backlogDir);

  // Collect stories newly marked as disregarded in the workbook (not yet in the record).
  const newlyDisregarded = allStories.filter(
    (s) => (s.disregarded || "").toUpperCase() === "Y" && !existingRecordIds.has((s.id || "").trim())
  );
  if (newlyDisregarded.length) {
    appendDisregardRecord(
      backlogDir,
      newlyDisregarded.map((s) => ({ type: "story", id: s.id ?? "", name: (s.user_story ?? "").slice(0, 80) }))
    );
  }

  // Also include stories that are disregarded in the manifest.
  const disregardedIds = new Set(readDisregardRecord(backlogDir).map((e) => e.id));
  for (const s of manifest?.stories ?? []) if (s.disregarded) disregardedIds.add(s.id);
  for (const s of allStories) if ((s.disregarded || "").toUpperCase() === "Y") disregardedIds.add((s.id || "").trim());

  const eligibleStories = allStories.filter((s) => !disregardedIds.has((s.id || "").trim()));
  const disregardedCount = allStories.length - eligibleStories.length;

  const withAc = eligibleStories.filter((s) => (s.acceptance_criteria || "").trim().length > 0);
  const noAc = eligibleStories.length - withAc.length;

  if (newlyDisregarded.length > 0) {
    ctx.stream.markdown(
      `_${newlyDisregarded.length} story(ies) marked as disregarded in the workbook — persisted to \`disregarded/disregard-record.md\`. They will not be regenerated or pushed to the PM tool._\n\n`
    );
  } else if (disregardedCount > 0) {
    ctx.stream.markdown(
      `_${disregardedCount} story(ies) excluded — already marked as disregarded._\n\n`
    );
  }

  if (!withAc.length) {
    ctx.stream.markdown(
      `⛔ No eligible stories have acceptance criteria yet (${eligibleStories.length} eligible stories found, ${noAc} without AC). ` +
        `Add AC in \`04 - Backlog/Backlog Tracker.xlsx\` (or rebuild via \`/discover manage-backlog\`) and try again.`
    );
    return;
  }

  // Scope selection.
  const scopePick = await vscode.window.showQuickPick(
    [
      { label: "$(check-all) All stories with acceptance criteria", value: "all", description: `${withAc.length} stories` },
      { label: "$(folder) Choose an epic", value: "epic", description: "only stories under one epic" },
      { label: "$(list-selection) Choose specific stories", value: "stories", description: "pick individual stories" },
    ],
    { title: "Stories to refine", placeHolder: "Which stories should get refinement notes?", ignoreFocusOut: true }
  );
  if (!scopePick) return;

  let scoped = withAc;
  if (scopePick.value === "epic") {
    const epicPick = await vscode.window.showQuickPick(
      (data.epics ?? [])
        .filter((e) => withAc.some((s) => s.epic_id === e.id))
        .map((e) => ({ label: `${e.id} — ${e.name ?? ""}`, value: e.id ?? "" })),
      { title: "Choose an epic", placeHolder: "Refine stories under…", ignoreFocusOut: true }
    );
    if (!epicPick) return;
    scoped = withAc.filter((s) => s.epic_id === epicPick.value);
  } else if (scopePick.value === "stories") {
    const picks = await vscode.window.showQuickPick(
      withAc.map((s) => ({
        label: `${storyKey(s)} — ${(s.user_story || "").slice(0, 60)}`,
        value: storyKey(s),
        picked: true,
      })),
      { title: "Choose stories", placeHolder: "Select stories to refine", canPickMany: true, ignoreFocusOut: true }
    );
    if (!picks || !picks.length) return;
    const chosen = new Set(picks.map((p) => p.value));
    scoped = withAc.filter((s) => chosen.has(storyKey(s)));
  }

  // Overwrite behaviour for existing notes.
  const existingKeys = scoped.filter((s) => fs.existsSync(refinementNotesPath(ctx, s)));
  let overwrite = true;
  if (existingKeys.length) {
    const ow = await vscode.window.showQuickPick(
      [
        { label: "$(arrow-right) Skip stories that already have notes", value: "skip" },
        { label: "$(warning) Overwrite all", value: "overwrite", description: `regenerates ${existingKeys.length} existing` },
      ],
      { title: "Existing refinement notes", placeHolder: `${existingKeys.length} stories already have refinement-notes.md`, ignoreFocusOut: true }
    );
    if (!ow) return;
    overwrite = ow.value === "overwrite";
  }

  const written: string[] = [];
  const skipped: string[] = [];
  for (const story of scoped) {
    const key = storyKey(story);
    if (!key) continue;
    const dest = refinementNotesPath(ctx, story);
    if (fs.existsSync(dest) && !overwrite) {
      skipped.push(key);
      continue;
    }
    const epic = story.epic_id ? epicById.get(story.epic_id) : undefined;
    const feature = story.feature_id ? featureById.get(story.feature_id) : undefined;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, renderRefinementNotes(story, key, epic, feature));
      written.push(key);
    } catch (err) {
      ctx.stream.markdown(`⚠️ Failed to write notes for ${key}: ${String(err)}\n`);
    }
  }

  const storiesByKey = new Map(scoped.map((s) => [storyKey(s), s]));
  let msg = `## Stories refined\n\n`;
  msg += `Wrote **${written.length}** \`refinement-notes.md\` file(s) under \`artifacts/discovery/04 - Backlog/stories/\`.\n\n`;
  if (written.length) {
    msg += `| Story | Epic | Path |\n| --- | --- | --- |\n`;
    for (const k of written) {
      const s = storiesByKey.get(k);
      const epicId = (s?.epic_id || "ungrouped").trim();
      msg += `| ${k} | ${epicId} | \`04 - Backlog/stories/${epicId}/${k}/${REFINEMENT_FILE}\` |\n`;
    }
    msg += `\n`;
  }
  if (skipped.length) msg += `Skipped ${skipped.length} story(ies) that already had notes: ${skipped.join(", ")}.\n\n`;
  if (noAc) msg += `_${noAc} story(ies) without acceptance criteria were not refined._\n\n`;
  msg +=
    `**Next:** run \`/design\` to produce solution designs. Without a PM tool connection, design works in ` +
    `local mode from these notes — stories are keyed by their backlog Story ID.\n`;
  ctx.stream.markdown(msg);

  await promptForFeedback(ctx, "stories-refined");
}

// ── process-session ───────────────────────────────────────────────────────────

const SESSION_SYSTEM = `You are a Salesforce discovery analyst. You are given ALL inputs from a SINGLE workshop session: one or more text sources (notes, transcripts, AI summaries) and optionally one or more images that are rendered pages of a PDF (typically a Miro board or whiteboard export). Treat everything as ONE session and reconcile the inputs together.

If images are provided, read them carefully: transcribe sticky notes, boxes, arrows/flows, columns/swimlanes, table cells, picklist option lists, and any labels. Fold what you learn from the images into the same analysis as the text — do not analyse them separately.

## Step 1 — Structured configuration extraction (do this FIRST, before anything else)

Before populating any other field in the response, do a targeted pass over ALL content — including tables, grids, Q&A sections, picklist tables, field definition grids, and permission matrices — to extract every Salesforce configuration detail present.

For each item you find, capture the FULL detail — do not summarise or omit values. Transcribe every picklist option exactly as written, even if the list is long. Record exactly what is on the board; use \`null\` for anything genuinely not present.

Populate the \`configExtraction\` key in your response with:
- **fields**: every custom (and notable standard) field you can read — object name, label, API name, field type, ALL picklist/multi-select values (list every option, not a count), whether it is required
- **recordTypes**: every named record type for any object
- **owd**: OWD / sharing model per object (Public Read/Write / Public Read Only / Private)
- **queues**: queue names, which object, who the members are
- **roleHierarchy**: full reporting structure as a text description (or \`null\`)
- **edition**: Salesforce edition if mentioned (or \`null\`)
- **scopeFlags**: Leads in scope, CPQ, email platform name, data migration — each \`true\`/\`false\`/\`"<value>"\`/\`null\`
- **personaAccess**: per-persona object-level permissions (read/write/create/delete per profile per object)

## Step 2 — Open Questions (do this AFTER filling configExtraction)

After filling \`configExtraction\`, check the following standard categories. For each category that has **no entry** in \`configExtraction\` AND no clear answer anywhere in the session material, write one specific, targeted question in \`## Open Questions\` in the session note.

Do **NOT** write a question for any category you already captured in \`configExtraction\`.

Categories to check:
1. Picklist values for each custom field (one question per field missing values)
2. Contact, Task, and Opportunity record types
3. OWD per key object (Account, Contact, Opportunity, Lead)
4. Role hierarchy structure (CEO → managers → reps)
5. Persona object-level access (read/write/create/delete per profile)
6. Queue names, objects they serve, and queue member lists
7. Salesforce edition (Starter / Pro Suite / Enterprise)
8. Lead scope: are Leads in scope for MVP?
9. Email integration platform
10. CPQ vs basic Opportunity Products
11. Data migration requirements

Produce a durable session note and map the durable knowledge to the discovery registers.

Return ONLY a single fenced \`\`\`json code block, no prose. Schema:

{
  "sessionTitle": "short human-readable title for this workshop (e.g. 'Account & Contact Management Workshop')",
  "summary": "ONE sentence describing what this session covered (used in an index table)",
  "configExtraction": {
    "fields": [
      {
        "object": "string — Salesforce object API name (e.g. Account, Contact)",
        "label": "string — field label as shown on the board",
        "apiName": "string or null — API name if visible (e.g. Service_Interest__c)",
        "type": "string — field type (Text, Picklist, Multi-Select Picklist, Checkbox, Date, Lookup, etc.)",
        "picklistValues": ["array of every picklist option, or empty array if not a picklist"],
        "required": "true | false | null if not specified"
      }
    ],
    "recordTypes": [
      { "object": "string", "types": ["array of record type names"] }
    ],
    "owd": [
      { "object": "string", "setting": "Public Read/Write | Public Read Only | Private | string" }
    ],
    "queues": [
      { "name": "string", "object": "string", "members": ["array of names or roles"] }
    ],
    "roleHierarchy": "text description of the reporting structure, or null",
    "edition": "Starter | Pro Suite | Enterprise | string | null",
    "scopeFlags": {
      "leads": "true | false | null",
      "cpq": "true | false | null",
      "emailPlatform": "string | null",
      "dataMigration": "true | false | null"
    },
    "personaAccess": [
      {
        "persona": "string — profile or persona name",
        "object": "string — Salesforce object",
        "read": "true | false | null",
        "create": "true | false | null",
        "edit": "true | false | null",
        "delete": "true | false | null"
      }
    ]
  },
  "sessionNote": "full markdown body for the session's Discovery Notes.md. Use these sections as H2 headings where you have content: Scope, Business Context, Decisions Captured, Open Questions, Risks, MVP Acceptance Criteria, Candidate Backlog (epics/stories), Next Workshop Inputs. Do NOT include a top-level H1 title or a sources line — those are added automatically. The Open Questions section must contain one specific question per gap identified in Step 2 above — and must be EMPTY if configExtraction captured everything.",
  "registerUpdates": {
    "Pain Points.md": "markdown bullet list of new pain points to append (or empty string)",
    "Requirements.md": "context paragraph only — do NOT restate fields here; the code auto-generates a field table from configExtraction",
    "Stakeholders.md": "markdown to append",
    "RAID.md": "markdown to append",
    "Decisions.md": "markdown to append — include OWD settings, edition, scope decisions, and any other confirmed configuration choices",
    "System Register.md": "markdown to append"
  }
}

Only include register keys that have new content. Each value is raw markdown that will be appended under a dated heading. Do NOT restate existing content.`;

type SessionResult = {
  ok: boolean;
  title?: string;
  folder?: string;
  noteRelPath?: string;
  movedFiles?: string[];
  updatedRegisters?: string[];
  summary?: string;
  truncated?: boolean;
  imagePages?: number;
  imagesInterpreted?: boolean;
  error?: string;
};

type GatheredSource = {
  name: string;
  text: string;
  truncated: boolean;
  isPdf: boolean;
  images: Uint8Array[];
  note: string;
};

/** Global cap on how many rendered PDF pages we send to the model in one run. */
const MAX_SESSION_IMAGES = 24;

async function runProcessSession(ctx: SkillContext): Promise<void> {
  const inboxDir = discoveryDir(ctx, "00 - Inbox");
  const inboxFiles = listInboxFiles(inboxDir);

  if (!inboxFiles.length) {
    ctx.stream.markdown(
      "⛔ `00 - Inbox/` is empty. Drop a workshop transcript or notes file (`.txt`, `.md`, `.docx` or `.pdf`) into `artifacts/discovery/00 - Inbox/` and run this again."
    );
    return;
  }

  // 1 file -> no prompt. Multiple -> multi-select with all pre-selected.
  // All chosen files are treated as inputs to ONE workshop session.
  let selected = inboxFiles;
  if (inboxFiles.length > 1) {
    const picks = await vscode.window.showQuickPick(
      inboxFiles.map((f) => ({
        label: f.name,
        description: `${Math.max(1, Math.ceil(f.size / 1024))} KB`,
        picked: true,
      })),
      {
        title: "Process a workshop session",
        placeHolder:
          "All files are treated as ONE session — press Enter to include all, or untick any that belong to a different session",
        canPickMany: true,
        ignoreFocusOut: true,
      }
    );
    if (!picks) {
      ctx.stream.markdown("Cancelled — no files processed.");
      return;
    }
    if (!picks.length) {
      ctx.stream.markdown("No files selected — nothing to process.");
      return;
    }
    const chosen = new Set(picks.map((p) => p.label));
    selected = inboxFiles.filter((f) => chosen.has(f.name));
  }

  ctx.stream.markdown(
    `Processing 1 session from ${selected.length} file${selected.length === 1 ? "" : "s"}…\n\n`
  );

  const result = await processSession(ctx, selected.map((f) => f.name), inboxDir);

  if (!result.ok) {
    ctx.stream.markdown(`⛔ Could not process the session: ${result.error}\n`);
    return;
  }

  let out = `## Processed session: ${result.title}\n\n`;
  out += `**Session folder:** \`01 - Sessions/${result.folder}\`\n\n`;
  out += `**Discovery note:** \`${result.noteRelPath}\`\n\n`;
  if (result.movedFiles && result.movedFiles.length) {
    out += `**Source files moved in:** ${result.movedFiles.map((f) => `\`${f}\``).join(", ")}\n\n`;
  }
  if (typeof result.imagePages === "number" && result.imagePages > 0) {
    out += result.imagesInterpreted
      ? `**Board images:** ${result.imagePages} PDF page(s) rendered and interpreted by the model.\n\n`
      : `> ⚠️ ${result.imagePages} PDF page image(s) were rendered but the active model could not interpret images — the session was analysed from text only.\n\n`;
  }
  out +=
    result.updatedRegisters && result.updatedRegisters.length
      ? `**Registers updated:** ${result.updatedRegisters.map((r) => `\`${r}\``).join(", ")}\n\n`
      : `_No new register entries were extracted._\n\n`;
  if (result.truncated) {
    out += `> ⚠️ Some input was large and was truncated before analysis — the original files were still moved in full.\n\n`;
  }
  if (result.summary) out += `${result.summary}\n\n`;
  ctx.stream.markdown(out);
  await promptForFeedback(ctx, "process-session");
}

/** List inbox files by name + size, without reading their (possibly binary) content. */
function listInboxFiles(dir: string): Array<{ name: string; size: number }> {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith("."))
    .map((d) => {
      let size = 0;
      try {
        size = fs.statSync(path.join(dir, d.name)).size;
      } catch {
        /* ignore */
      }
      return { name: d.name, size };
    });
}

async function processSession(
  ctx: SkillContext,
  fileNames: string[],
  inboxDir: string
): Promise<SessionResult> {
  // 1. Gather text + images from every selected file.
  const sources: GatheredSource[] = [];
  for (const name of fileNames) {
    const filePath = path.join(inboxDir, name);
    const extracted = await extractFileText(filePath);
    const isPdf = name.toLowerCase().endsWith(".pdf");
    const src: GatheredSource = {
      name,
      text: extracted.error ? "" : extracted.text,
      truncated: extracted.truncated,
      isPdf,
      images: [],
      note: "",
    };
    if (extracted.error) {
      src.note = `extraction error: ${extracted.error}`;
    }
    // For PDFs (especially image-only Miro boards), render pages so a vision
    // model can read the diagram content.
    if (isPdf && !extracted.error) {
      try {
        const rendered = await extractPdfImages(filePath, { maxPages: MAX_SESSION_IMAGES });
        src.images = rendered.images.map((im) => im.png);
        if (extracted.isImagePdf) {
          src.note = "image-only PDF — interpreted from rendered page images";
        } else if (rendered.images.length) {
          src.note = "PDF text + rendered page images";
        }
      } catch (err) {
        src.note = `page images could not be rendered: ${String(err)}`;
      }
    }
    sources.push(src);
  }

  const hasText = sources.some((s) => s.text.trim().length > 40);
  const allImages: Uint8Array[] = [];
  for (const s of sources) {
    for (const img of s.images) {
      if (allImages.length < MAX_SESSION_IMAGES) allImages.push(img);
    }
  }

  if (!hasText && !allImages.length) {
    return {
      ok: false,
      error: "no readable text or interpretable images were found in the selected files",
    };
  }

  // 2. Build the combined user content: a sources header + all extracted text.
  const header =
    `SESSION INPUTS (${sources.length} file${sources.length === 1 ? "" : "s"}):\n` +
    sources
      .map((s) => {
        const bits = [s.name];
        if (s.images.length) bits.push(`${s.images.length} page image(s)`);
        if (s.note) bits.push(s.note);
        return `- ${bits.join(" — ")}`;
      })
      .join("\n");

  const body = sources
    .filter((s) => s.text.trim())
    .map((s) => `### FILE: ${s.name}\n\n${s.text.trim()}`)
    .join("\n\n---\n\n");

  const userContent =
    `${header}\n\n${body || "(no extractable text — rely on the attached page images)"}` +
    (allImages.length
      ? `\n\nThe ${allImages.length} attached image(s) are rendered PDF pages from the sources above. Read and incorporate them.`
      : "");

  // 3. Call the model — multimodal if we have images, with a text-only fallback.
  let raw: string;
  let imagesInterpreted = allImages.length > 0;
  try {
    if (allImages.length) {
      try {
        raw = await collectResponseWithImages(ctx, SESSION_SYSTEM, userContent, allImages);
      } catch (imgErr) {
        // Model/build can't take images — fall back to text-only.
        imagesInterpreted = false;
        const noteAboutImages =
          "\n\nNOTE: PDF page images could not be attached to this request. Analyse from the text above only and flag in Open Questions that board images still need manual review.";
        raw = await collectResponse(ctx, SESSION_SYSTEM, userContent + noteAboutImages);
        void imgErr;
      }
    } else {
      raw = await collectResponse(ctx, SESSION_SYSTEM, userContent);
    }
  } catch (err) {
    return { ok: false, error: `model error: ${String(err)}` };
  }

  type ConfigField = {
    object?: string;
    label?: string;
    apiName?: string | null;
    type?: string;
    picklistValues?: string[];
    required?: boolean | null;
  };
  type ConfigExtraction = {
    fields?: ConfigField[];
    recordTypes?: Array<{ object?: string; types?: string[] }>;
    owd?: Array<{ object?: string; setting?: string }>;
    queues?: Array<{ name?: string; object?: string; members?: string[] }>;
    roleHierarchy?: string | null;
    edition?: string | null;
    scopeFlags?: {
      leads?: boolean | null;
      cpq?: boolean | null;
      emailPlatform?: string | null;
      dataMigration?: boolean | null;
    };
    personaAccess?: Array<{
      persona?: string;
      object?: string;
      read?: boolean | null;
      create?: boolean | null;
      edit?: boolean | null;
      delete?: boolean | null;
    }>;
  };
  const parsed = extractJson<{
    sessionTitle?: string;
    summary?: string;
    sessionNote?: string;
    configExtraction?: ConfigExtraction;
    registerUpdates?: Record<string, string>;
  }>(raw);

  if (!parsed) {
    return { ok: false, error: "could not parse the model response" };
  }

  // Convert configExtraction to structured markdown tables and inject into Requirements.md.
  const cx = parsed.configExtraction;
  if (cx) {
    const sections: string[] = [];

    if (cx.fields && cx.fields.length > 0) {
      const rows = cx.fields.map((f) => {
        const pv = (f.picklistValues ?? []).join(", ") || "—";
        const req = f.required === true ? "Yes" : f.required === false ? "No" : "—";
        return `| ${f.object ?? "—"} | ${f.label ?? "—"} | ${f.apiName ?? "—"} | ${f.type ?? "—"} | ${pv} | ${req} |`;
      });
      sections.push(
        "### Fields\n\n" +
          "| Object | Label | API Name | Type | Picklist Values | Required |\n" +
          "| --- | --- | --- | --- | --- | --- |\n" +
          rows.join("\n")
      );
    }

    if (cx.recordTypes && cx.recordTypes.length > 0) {
      const rows = cx.recordTypes.map(
        (rt) => `| ${rt.object ?? "—"} | ${(rt.types ?? []).join(", ") || "—"} |`
      );
      sections.push(
        "### Record Types\n\n" +
          "| Object | Record Types |\n| --- | --- |\n" +
          rows.join("\n")
      );
    }

    if (cx.owd && cx.owd.length > 0) {
      const rows = cx.owd.map((o) => `| ${o.object ?? "—"} | ${o.setting ?? "—"} |`);
      sections.push(
        "### Organisation-Wide Defaults (OWD)\n\n" +
          "| Object | Setting |\n| --- | --- |\n" +
          rows.join("\n")
      );
    }

    if (cx.queues && cx.queues.length > 0) {
      const rows = cx.queues.map(
        (q) =>
          `| ${q.name ?? "—"} | ${q.object ?? "—"} | ${(q.members ?? []).join(", ") || "—"} |`
      );
      sections.push(
        "### Queues\n\n" +
          "| Queue Name | Object | Members |\n| --- | --- | --- |\n" +
          rows.join("\n")
      );
    }

    if (cx.personaAccess && cx.personaAccess.length > 0) {
      const bool = (v: boolean | null | undefined) =>
        v === true ? "✓" : v === false ? "✗" : "—";
      const rows = cx.personaAccess.map(
        (p) =>
          `| ${p.persona ?? "—"} | ${p.object ?? "—"} | ${bool(p.read)} | ${bool(p.create)} | ${bool(p.edit)} | ${bool(p.delete)} |`
      );
      sections.push(
        "### Persona Access\n\n" +
          "| Persona | Object | Read | Create | Edit | Delete |\n" +
          "| --- | --- | --- | --- | --- | --- |\n" +
          rows.join("\n")
      );
    }

    if (sections.length > 0) {
      // Prepend structured tables before whatever context paragraph the model wrote.
      const existing = (parsed.registerUpdates ?? {})["Requirements.md"] ?? "";
      const structured = "### Extracted Configuration\n\n" + sections.join("\n\n");
      parsed.registerUpdates = {
        ...(parsed.registerUpdates ?? {}),
        "Requirements.md": structured + (existing.trim() ? "\n\n" + existing.trim() : ""),
      };
    }
  }


  const dateStamp = new Date().toISOString().slice(0, 10);
  const rawTitle = (parsed.sessionTitle || path.parse(fileNames[0]).name).trim();
  const safeTitle = rawTitle.replace(/[^A-Za-z0-9 &().,_-]/g, "").trim() || "Session";

  // 4. Create the grouped session folder.
  const sessionsDir = discoveryDir(ctx, "01 - Sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const folderName = uniqueName(sessionsDir, `${dateStamp} - ${safeTitle}`);
  const folderPath = path.join(sessionsDir, folderName);
  fs.mkdirSync(folderPath, { recursive: true });

  // 5. Move every source file into the session folder.
  const movedFiles: string[] = [];
  for (const s of sources) {
    const from = path.join(inboxDir, s.name);
    if (!fs.existsSync(from)) continue;
    const to = uniqueName(folderPath, s.name);
    try {
      fs.renameSync(from, path.join(folderPath, to));
      movedFiles.push(to);
    } catch {
      /* leave in inbox if move fails */
    }
  }

  // 6. Write the Discovery Notes.md for this session.
  const sourceLines = sources
    .map((s) => {
      const kind = s.isPdf
        ? s.images.length
          ? "PDF, reviewed via rendered page images"
          : "PDF"
        : path.extname(s.name).replace(".", "").toUpperCase() || "text";
      return `- \`${s.name}\` (${kind})`;
    })
    .join("\n");
  const note =
    `# ${rawTitle}\n\n` +
    `_Processed ${dateStamp}._\n\n` +
    `**Source inputs:**\n${sourceLines}\n\n` +
    (allImages.length && !imagesInterpreted
      ? `> ⚠️ Board images were rendered but not interpreted by the model — review the source PDF manually.\n\n`
      : "") +
    `${parsed.sessionNote || parsed.summary || ""}\n`;
  fs.writeFileSync(path.join(folderPath, "Discovery Notes.md"), note);

  // 7. Append register updates.
  const registersDir = discoveryDir(ctx, "00 - Registers");
  fs.mkdirSync(registersDir, { recursive: true });
  const updatedRegisters: string[] = [];
  for (const [rawName, content] of Object.entries(parsed.registerUpdates ?? {})) {
    if (!content || !content.trim()) continue;
    const safeName = path.basename(rawName).replace(/[^A-Za-z0-9 ._-]/g, "");
    if (!safeName.toLowerCase().endsWith(".md")) continue;
    const p = path.join(registersDir, safeName);
    const heading = `\n\n## From ${rawTitle} (${dateStamp})\n\n`;
    const existing = fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : `# ${safeName.replace(/\.md$/, "")}\n`;
    fs.writeFileSync(p, existing.trimEnd() + heading + content.trim() + "\n");
    updatedRegisters.push(safeName);
  }

  // 8. Update the session index for downstream steps.
  updateSessionIndex(sessionsDir, {
    date: dateStamp,
    title: rawTitle,
    folder: folderName,
    sources: movedFiles.length ? movedFiles : sources.map((s) => s.name),
    summary: (parsed.summary || "").replace(/\s+/g, " ").trim(),
  });

  return {
    ok: true,
    title: rawTitle,
    folder: folderName,
    noteRelPath: `01 - Sessions/${folderName}/Discovery Notes.md`,
    movedFiles,
    updatedRegisters,
    summary: parsed.summary,
    truncated: sources.some((s) => s.truncated),
    imagePages: allImages.length,
    imagesInterpreted,
  };
}

type SessionIndexRow = {
  date: string;
  title: string;
  folder: string;
  sources: string[];
  summary: string;
};

/** Maintain `01 - Sessions/_index.md` — one row per processed session. */
function updateSessionIndex(sessionsDir: string, row: SessionIndexRow): void {
  const indexPath = path.join(sessionsDir, "_index.md");
  const header =
    "# Session Index\n\n" +
    "_Machine-maintained index of processed discovery sessions. Downstream steps (synthesize, current-state, backlog) read this to locate session notes and sources._\n\n" +
    "| Date | Session | Folder | Sources | Summary |\n" +
    "| --- | --- | --- | --- | --- |\n";
  const sources = row.sources.map((s) => `\`${s}\``).join("<br>");
  const summary = row.summary ? row.summary.replace(/\|/g, "\\|") : "";
  const line = `| ${row.date} | ${row.title.replace(/\|/g, "\\|")} | \`${row.folder}\` | ${sources} | ${summary} |\n`;
  const existing = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf-8") : "";
  if (existing.includes("| Date | Session |")) {
    fs.writeFileSync(indexPath, existing.trimEnd() + "\n" + line);
  } else {
    fs.writeFileSync(indexPath, header + line);
  }
}

function uniqueName(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const parsed = path.parse(name);
  let i = 1;
  let candidate: string;
  do {
    candidate = `${parsed.name} (${i})${parsed.ext}`;
    i += 1;
  } while (fs.existsSync(path.join(dir, candidate)));
  return candidate;
}

// ── deferred (need PM tool MCP) ───────────────────────────────────────────────

function buildDeferredContext(config: SdlcConfig, skill: "push-backlog" | "sync-pm"): string {
  const alm = config.alm;
  const tool = alm?.tool ?? "JIRA";

  const almLines = tool === "ADO"
    ? [
        `ALM tool: Azure DevOps`,
        `Organization: ${(alm as { tool: "ADO"; organization?: string })?.organization ?? ""}`,
        `Project: ${(alm as { tool: "ADO"; project?: string })?.project ?? ""}`,
      ]
    : [
        `ALM tool: JIRA`,
        `Site: ${(alm as { tool: "JIRA"; site?: string })?.site ?? config.project?.jiraSite ?? ""}`,
        `Project key: ${(alm as { tool: "JIRA"; projectKey?: string })?.projectKey ?? config.project?.jiraKey ?? ""}`,
      ];

  const schemaLines = skill === "push-backlog"
    ? [
        `Spreadsheet location: ${path.join("artifacts/discovery/04 - Backlog/Backlog Tracker.xlsx")}`,
        ``,
        `Spreadsheet schema (exact column names — do not attempt to discover headers):`,
        `- Epics sheet: ID | Epic Name | Narrative Goal | Business Outcome | Solution Notes | Requirement IDs | Pain Points Addressed | Stakeholder Groups | Priority | Status | Demo Narrative Slice | PM Key | Disregarded`,
        `- Features sheet: ID | Epic ID | Epic Name | Feature Name | Description | System Components | Dependencies | Priority | Complexity | Status | Implementation Boundary | PM Key | Disregarded`,
        `- User Stories sheet: Story ID | Epic ID | Epic Name | Feature ID | Feature Name | User Story | Acceptance Criteria | Functional Requirements | Solution Notes | Use Case Labels | Size | Status | PM Key | Disregarded`,
      ]
    : [];

  return [
    `## Project config (use this directly — do not re-read .sdlc/config.json)`,
    ...almLines,
    ...schemaLines,
  ].join("\n");
}

async function runDeferred(ctx: SkillContext, skill: "push-backlog" | "sync-pm"): Promise<void> {
  const tool = ctx.config?.alm?.tool ?? "JIRA";
  const isAdo = tool === "ADO";

  // Select the backend-specific template — no dual-section prompts
  const bundled = skill === "push-backlog"
    ? (isAdo ? pushBacklogAdoTemplate : pushBacklogJiraTemplate)
    : (isAdo ? syncPmAdoTemplate : syncPmJiraTemplate);

  // Use workspace override if present; fall back to bundled template.
  // The workspace files use the unified names (push-backlog.prompt.md / sync-pm.prompt.md)
  // with a Step 0 that routes on alm.tool — the bundled templates are already split per tool.
  const promptFile = skill === "push-backlog"
    ? `.github/prompts/sdlc/discover/push-backlog.prompt.md`
    : `.github/prompts/sdlc/discover/sync-pm.prompt.md`;
  let systemPrompt: string;
  try {
    systemPrompt = fs.readFileSync(path.join(ctx.root, promptFile), "utf-8");
  } catch {
    systemPrompt = bundled;
  }

  // Build the full context-enriched prompt to send to the Copilot Chat panel.
  // NOTE: model.sendRequest() creates a bare LLM call with NO tool access — MCP tools
  // (ADO / Atlassian) are only available when Copilot runs in its own agent-mode session.
  // The correct pattern is to open the VS Code Chat panel with the pre-built prompt so
  // the user can run it there with full tool access.
  const context = buildDeferredContext(ctx.config, skill);
  const userRequest = ctx.request.prompt.trim() ||
    (skill === "push-backlog" ? "Run the push-backlog agent." : "Run the sync-pm status agent.");
  const fullPrompt = `${systemPrompt}\n\n---\n\n${context}\n\n---\n\n${userRequest}`;

  const skillLabel = skill === "push-backlog" ? "Push Backlog" : "Sync PM Status";
  const mcpName = isAdo ? "Azure DevOps" : "Atlassian";

  // Persist the generated prompt so it survives if the chat open fails
  const generatedPromptPath = path.join(ctx.root, ".sdlc", "prompts", `${skill}.md`);
  try {
    fs.mkdirSync(path.dirname(generatedPromptPath), { recursive: true });
    fs.writeFileSync(generatedPromptPath, fullPrompt, "utf-8");
  } catch {
    // non-fatal — best-effort
  }

  // Open VS Code Chat with the pre-built prompt pre-filled.
  // isPartialQuery: true means the input is populated but not auto-sent, giving the user
  // a chance to verify agent mode and MCP tools are active before running.
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: fullPrompt,
      isPartialQuery: true,
    });
    ctx.stream.markdown(
      `### ${skillLabel} — opened in Copilot Chat\n\n` +
      `The prompt has been pre-filled in the Copilot Chat panel with your project context injected.\n\n` +
      `**Before pressing Enter:**\n` +
      `- Switch to the **Copilot Chat** panel (it should now be in focus)\n` +
      `- Make sure **Agent mode** is selected (not Ask or Edit)\n` +
      `- Verify the **${mcpName} MCP** is listed in the tools section\n\n` +
      `Then press **Enter** to run.`
    );
  } catch {
    // Fallback: the command may not exist or may have a different signature on some
    // VS Code / Copilot versions. Point the user to the generated file instead.
    ctx.stream.markdown(
      `### ${skillLabel} — run manually in agent mode\n\n` +
      `The prompt has been saved to \`.sdlc/prompts/${skill}.md\`.\n\n` +
      `**To run it:**\n` +
      `1. Open **Copilot Chat** and switch to **Agent mode**\n` +
      `2. Verify the **${mcpName} MCP** is connected\n` +
      `3. Type: \`Read .sdlc/prompts/${skill}.md and follow its instructions.\`\n`
    );
  }
}

// ── advisory skills (read files → LLM → stream) ───────────────────────────────

interface AdvisorySpec {
  instruction: string;
  folders: string[];
}

const ADVISORY: Record<string, AdvisorySpec> = {
  synthesize: {
    instruction:
      "Synthesize the discovery evidence into key themes, patterns, and current-state insights. Produce a clear markdown summary a consultant can share.",
    folders: ["00 - Registers", "01 - Sessions"],
  },
  analyze: {
    instruction:
      "Analyze and prioritize the discovery evidence: rank pain points by impact/frequency, flag coverage gaps, and highlight the highest-value focus areas. Output markdown.",
    folders: ["00 - Registers", "02 - Current State"],
  },
  "conflict-check": {
    instruction:
      "Surface contradictions and misalignments across the sessions and registers before they become delivery blockers. List each conflict with the sources involved.",
    folders: ["00 - Registers", "01 - Sessions"],
  },
  "compose-deliverable": {
    instruction:
      "Compose a clear, client-facing discovery deliverable (executive summary, current state, key findings, recommended direction) from the artifacts provided.",
    folders: ["00 - Registers", "02 - Current State", "03 - Future State"],
  },
  "prep-workshop": {
    instruction:
      "Prepare for an upcoming discovery workshop: propose an agenda, facilitation guide, key questions to close open gaps, and a short pre-read. Base it on what is already known.",
    folders: ["00 - Registers", "01 - Sessions"],
  },
  "hub-audit": {
    instruction:
      "Audit the discovery knowledge hub for completeness. Report what content is present vs missing per area, register health, and a phase-gate readiness verdict.",
    folders: ["00 - Project", "00 - Registers", "01 - Sessions", "02 - Current State", "03 - Future State", "04 - Backlog"],
  },
  "whats-next": {
    instruction:
      "Give the user a concise orientation: what has been done so far in discovery, what is missing, and the single recommended next step (naming the exact /discover sub-command).",
    folders: ["00 - Project", "00 - Registers", "01 - Sessions", "02 - Current State", "04 - Backlog"],
  },
  "registers-to-stories": {
    instruction:
      "Convert the register entries directly into well-formed user stories (As a…, I want…, so that…). Group them under likely epics. This is discovery-level only — no technical design.",
    folders: ["00 - Registers"],
  },
};

async function runAdvisory(ctx: SkillContext, skill: Skill): Promise<void> {
  const spec = ADVISORY[skill];
  if (!spec) {
    ctx.stream.markdown(`⛔ Unknown discovery skill: \`${skill}\`.`);
    return;
  }

  const files = spec.folders.flatMap((folder) => {
    const dir = discoveryDir(ctx, folder);
    return readDirFiles(dir, [".md"]).map((f) => ({ ...f, name: `${folder}/${f.name}` }));
  });

  if (!hasContent(files)) {
    ctx.stream.markdown(
      `⛔ There isn't enough content in \`${spec.folders.join("`, `")}\` yet. ` +
        `Run \`/discover process-session\` to populate the registers first.`
    );
    return;
  }

  const system =
    `You are a Salesforce discovery assistant. ${spec.instruction}\n\n` +
    `You are given the current discovery artifacts below. Work only from this evidence — do not invent facts. ` +
    `This is discovery phase: no component-level design, field-level data models, or automation logic.`;
  const userContent = `PROJECT: ${ctx.config.project.name}\n\n${combineFiles(files)}`;

  try {
    await streamResponse(ctx, system, userContent);
  } catch (err) {
    ctx.stream.markdown(`⛔ Model error: ${String(err)}`);
  }
  await promptForFeedback(ctx, skill);
}
