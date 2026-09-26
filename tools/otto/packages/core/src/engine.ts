import Handlebars from "handlebars";
import type { OttoConfig } from "./schema.js";
import { resolveAlmTool, resolveProjectKey, resolveDeliverable, resolveStatusTransitions, DEFAULT_STATUS_MAP } from "./schema.js";
import type { StatusTransitionMode } from "./schema.js";
import { discoverTemplate } from "./templates/discover.js";
import { refineTemplate } from "./templates/refine.js";
import { refineStoryTemplate } from "./templates/refine-story.js";
import { refineGenerateStoriesTemplate } from "./templates/refine-generate-stories.js";
import { refineGapAnalysisTemplate } from "./templates/refine-gap-analysis.js";
import { designTemplate } from "./templates/design.js";
import { buildTemplate } from "./templates/build.js";
import { testTemplate } from "./templates/test.js";
import { releaseTemplate } from "./templates/release.js";
import { dataDictionaryTemplate } from "./templates/data-dictionary.js";
import { discoverAdvisoryTemplate } from "./templates/discover-advisory.js";
import { testExecuteTemplate } from "./templates/test-execute.js";
import { testWriteCasesTemplate } from "./templates/test-write-cases.js";
import { testApexUnitTemplate } from "./templates/test-apex-unit.js";
import { testApexPerfTemplate } from "./templates/test-apex-perf.js";
import { testPwSetupTemplate } from "./templates/test-pw-setup.js";
import { testPwWriteTemplate } from "./templates/test-pw-write.js";
import deploymentInstruction          from "../../../../../devops/instructions/deployment.md";
import orgImpactAssessmentInstruction from "../../../../../devops/instructions/org-impact-assessment.md";
import prerequisiteCheckInstruction   from "../../../../../devops/instructions/prerequisite-check.md";
import { readCachedTemplate, readCachedInstruction, readCachedSkill } from "./cache.js";
import { getRevenueCloudSkills, REVENUE_CLOUD_SKILL_FILES } from "./skills.js";
import { DISCOVER_ADVISORY, type DiscoverAdvisorySkill } from "./discover-advisory.js";

// {{#eq a b}}...{{/eq}} helper for estimation approach conditionals
Handlebars.registerHelper("eq", function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return a === b ? options.fn(this) : options.inverse(this);
});

// The six SDLC phases — the ONLY keys that may appear in config.phases.
// Kept separate from PHASE_TEMPLATES so sub-skill keys (below) never leak
// into phaseFlags and render as bogus always-false {{phases.*}} flags.
export const SDLC_PHASES = ["discover", "refine", "design", "build", "test", "release"] as const;

export const PHASE_TEMPLATES: Record<string, string> = {
  discover: discoverTemplate,
  refine: refineTemplate,
  design: designTemplate,
  build: buildTemplate,
  test: testTemplate,
  release: releaseTemplate,
  // Cross-cutting sub-commands (not SDLC phases gated by config.phases) —
  // registered here so they render through the same Handlebars/cache pipeline.
  "data-dictionary": dataDictionaryTemplate,
  "discover-advisory": discoverAdvisoryTemplate,
  // Refine sub-skills. Same hyphenated-key rule as the test-* keys below.
  "refine-story": refineStoryTemplate,
  "refine-generate-stories": refineGenerateStoriesTemplate,
  "refine-gap-analysis": refineGapAnalysisTemplate,
  // Test sub-skills. Hyphenated (never `:`) — these keys become filenames in
  // instructions.zip via scripts/package-instructions.mjs, and `:` is illegal
  // on Windows. Composed with skillTemplateKey() below; never write one of
  // these keys by hand elsewhere.
  "test-execute": testExecuteTemplate,
  "test-write-cases": testWriteCasesTemplate,
  "test-apex-unit": testApexUnitTemplate,
  "test-apex-perf": testApexPerfTemplate,
  "test-pw-setup": testPwSetupTemplate,
  "test-pw-write": testPwWriteTemplate,
};

/** Sub-skills the `test` phase exposes as a menu. Exported so every front end
 *  (MCP, VS Code, CLI) validates against the same list. */
export const TEST_SKILLS = ["execute", "write-cases", "apex-unit", "apex-perf", "pw-setup", "pw-write"] as const;
export type TestSkill = (typeof TEST_SKILLS)[number];

/** Sub-skills the `refine` phase exposes as a menu. `story` is the implicit
 *  default (a bare `#otto/refine PROJ-42` runs it), preserving pre-menu behaviour;
 *  `generate-stories` drafts new candidate stories under an epic from sources;
 *  `gap-analysis` reports missing stories under an epic against named sources.
 *  Exported so every front end validates against the same list. */
export const REFINE_SKILLS = ["story", "generate-stories", "gap-analysis"] as const;
export type RefineSkill = (typeof REFINE_SKILLS)[number];

/** Composes a sub-skill registry key. Hyphen separator is required — see the
 *  Windows-filename note on PHASE_TEMPLATES above. */
export function skillTemplateKey(phase: string, skill: string): string {
  return `${phase}-${skill}`;
}

export interface RenderOptions {
  cacheDir?: string;
}

export function renderPrompt(phase: string, config: OttoConfig, opts?: RenderOptions): string {
  // Prefer cached template; fall back to bundled constant
  const raw = (opts?.cacheDir ? readCachedTemplate(phase, opts.cacheDir) : null) ?? PHASE_TEMPLATES[phase];
  if (!raw) throw new Error(`No template found for phase: ${phase}`);

  // Expose phases as a boolean map so templates can use {{#if phases.release}}.
  // Iterate the real phase list, not PHASE_TEMPLATES — that registry also holds
  // cross-cutting sub-commands (data-dictionary, test-*) which are never in
  // config.phases and would otherwise pollute this map with bogus always-false
  // flags (and hyphenated keys aren't valid Handlebars paths besides).
  const phaseFlags = Object.fromEntries(
    SDLC_PHASES.map((p) => [p, config.phases.includes(p)])
  );

  // Prefer cached instruction files; fall back to bundled imports
  const instructions = {
    deployment: (opts?.cacheDir ? readCachedInstruction("deployment", opts.cacheDir) : null) ?? deploymentInstruction,
    orgImpactAssessment: (opts?.cacheDir ? readCachedInstruction("org-impact-assessment", opts.cacheDir) : null) ?? orgImpactAssessmentInstruction,
    prerequisiteCheck: (opts?.cacheDir ? readCachedInstruction("prerequisite-check", opts.cacheDir) : null) ?? prerequisiteCheckInstruction,
  };

  // ALM-neutral context so templates can stay tool-agnostic:
  // - almTool     — "JIRA" | "ADO" | "LOCAL" (defaults to JIRA when alm is absent)
  // - statusMap    — the active tool's status map (ADO/LOCAL fall back sensibly)
  // - projectKey   — display-safe project key / identifier for the active tool
  // - pmToolName   — human name of the active PM tool
  // - pmMcp        — the MCP that backs the active PM tool
  // - itemNoun     — what the tool calls a story-level item
  const almTool = resolveAlmTool(config);
  const statusMap =
    almTool === "ADO"
      ? (config.ado?.statusMap ?? config.jira?.statusMap)
      : almTool === "LOCAL"
        ? (config.jira?.statusMap ?? config.ado?.statusMap ?? DEFAULT_STATUS_MAP)
        : config.jira?.statusMap;
  const projectKey = resolveProjectKey(config);
  const pmToolName = almTool === "ADO" ? "Azure DevOps" : almTool === "LOCAL" ? "the PM tool" : "JIRA";
  const pmMcp = almTool === "ADO" ? "Azure DevOps MCP" : almTool === "LOCAL" ? "a PM MCP" : "Atlassian MCP";
  const itemNoun = almTool === "ADO" ? "work item" : "story";

  // Resolved design-deliverable settings (publishing target, space, sections) with
  // per-tool defaults applied and the target coerced onto a tool the session can
  // actually reach. Exposed as {{deliverable.*}} so both the design and build templates
  // stay declarative and non-regressive.
  const deliverable = resolveDeliverable(config, almTool);

  // Status-transition policy (workflow.statusTransitions). `gated` is true only when a
  // connected PM tool is in `confirm` or `off` mode — Local mode never transitions, so
  // it always renders as `auto`. `policy` is empty in auto mode so existing prompts
  // are unchanged; otherwise it's a block the phase templates embed near the top.
  const transitionMode: StatusTransitionMode = almTool === "LOCAL" ? "auto" : resolveStatusTransitions(config);
  const transitions = {
    mode: transitionMode,
    auto: transitionMode === "auto",
    confirm: transitionMode === "confirm",
    off: transitionMode === "off",
    gated: transitionMode !== "auto",
    policy: buildTransitionPolicy(transitionMode, almTool, pmToolName),
  };

  // Pre-formatted status lists for the design agent's batch queries. Built here
  // rather than in the template because Handlebars has no join/dedupe: a project
  // whose gates collide (ADO's out-of-box Agile process maps several to "Active")
  // would otherwise render `IN ('Active','Active')`.
  const designEligibleStatuses = [
    ...new Set([statusMap?.story.readyForDesign, statusMap?.story.designInProgress].filter(Boolean) as string[]),
  ];
  const designEligible = {
    jql: designEligibleStatuses.map((s) => `"${s}"`).join(", "),
    wiql: designEligibleStatuses.map((s) => `'${s}'`).join(", "),
    /** True when the gates collide, so status alone cannot drive eligibility. */
    collides: designEligibleStatuses.length < 2,
  };

  // Fail loudly on misconfiguration: a template that references a status map
  // ({{statusMap.*}} or the legacy {{jira.statusMap.*}}) with none configured
  // would otherwise render blank cells silently.
  if (!statusMap && (raw.includes("{{statusMap.") || raw.includes("{{jira.statusMap."))) {
    throw new Error(
      `Template '${phase}' references a status map but none is configured (set jira.statusMap or ado.statusMap).`
    );
  }

  // Revenue Cloud Advanced (RCA) skill guidance is only exposed when the project
  // has opted in. Non-RCA projects get an empty map, so the `{{#if revenueCloud.enabled}}`
  // blocks in the templates render nothing and no prompt bloat leaks in.
  const revenueCloudEnabled = config.revenueCloud?.enabled === true;
  const skills = {
    revenueCloud: revenueCloudEnabled ? resolveRevenueCloudSkills(opts?.cacheDir) : {},
  };

  const compiled = Handlebars.compile(raw, { noEscape: true });
  return compiled({
    ...config,
    phases: phaseFlags,
    instructions,
    skills,
    almTool,
    statusMap,
    projectKey,
    pmToolName,
    pmMcp,
    itemNoun,
    deliverable,
    designEligible,
    transitions,
  });
}

/**
 * The status-transition policy block embedded in every phase template that moves a
 * PM-tool item. Empty in `auto` mode (and Local mode) so those prompts are unchanged.
 */
function buildTransitionPolicy(mode: StatusTransitionMode, almTool: "JIRA" | "ADO" | "LOCAL", pmToolName: string): string {
  if (mode === "auto" || almTool === "LOCAL") return "";
  const statusTools = almTool === "ADO"
    ? "`update_work_item` setting `System.State`"
    : "`transitionJiraIssue`";
  const scope = "a story, bug, defect or sub-task";
  const manualList =
    "list it under **Status changes to make manually** in your final summary (item, current status → target status) so the user can apply it in " + pmToolName + ".";

  if (mode === "confirm") {
    return [
      "> 🔀 **Status transition policy — confirm** (`workflow.statusTransitions: confirm`). This project requires the user's approval before **any** " + pmToolName + " status change.",
      "> Every instruction in this prompt to transition, move or set the status of " + scope + " means: **first ask**, then act.",
      ">",
      `> 1. Immediately before the transition, ask: *"Move {KEY} from '{current status}' to '{target status}'? (yes / no)"* and wait for an explicit **yes** for that item.`,
      "> 2. Approval of content (AC, design, comments, sub-tasks, the PR) is **not** approval of a status change — always ask separately.",
      "> 3. When several transitions are due at the same point (batch runs, sub-tasks), present them as a numbered list and let the user approve or decline each one. Never treat silence or a content approval as consent.",
      "> 4. If the user declines, skip **only** that transition — do not call " + statusTools + " for it, do not retry, and carry on with every other step. Then " + manualList,
      "> 5. Interim \"in progress\" transitions that a later transition in the same run supersedes (e.g. a pickup marker) need not be listed for manual action — list only each item's final target status.",
      "> 6. Status **gates** that read the current status still apply unchanged.",
    ].join("\n");
  }

  return [
    "> 🔀 **Status transition policy — off** (`workflow.statusTransitions: off`). This project does not allow agents to change " + pmToolName + " statuses.",
    "> Wherever this prompt says to transition, move or set the status of " + scope + ":",
    ">",
    "> 1. **Do not** change the status — never call " + statusTools + " or any other status-changing tool.",
    "> 2. Carry out every other write as normal (descriptions, acceptance criteria, comments, sub-task and defect creation, links).",
    "> 3. Instead of each transition, " + manualList,
    "> 4. Interim \"in progress\" transitions that a later transition in the same run supersedes (e.g. a pickup marker) need not be listed — list only each item's final target status.",
    "> 5. Status **gates** that read the current status still apply unchanged.",
  ].join("\n");
}

/** Prefer cache-synced skills, fall back to the bundled build-time copies. */
function resolveRevenueCloudSkills(cacheDir?: string): Record<string, string> {
  const bundled = getRevenueCloudSkills();
  if (!cacheDir) return bundled;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(bundled)) {
    const fileBase = REVENUE_CLOUD_SKILL_FILES[key];
    resolved[key] = (fileBase ? readCachedSkill(fileBase, cacheDir) : null) ?? value;
  }
  return resolved;
}

export function renderAllPrompts(config: OttoConfig, opts?: RenderOptions): Record<string, string> {
  return Object.fromEntries(
    config.phases.map((phase) => [phase, renderPrompt(phase, config, opts)])
  );
}

/**
 * Renders one of Discover's "advisory" sub-skills (synthesize, analyze,
 * conflict-check, ...) — a shared read-files-then-report template plus the
 * per-skill task instruction and folder list appended as context, the same
 * composition pattern data-dictionary uses. Single source of truth so VS Code
 * and the MCP server (Claude Code plugin, Copilot pack) never drift on which
 * folders a skill reads or what it's asked to do with them.
 */
export function renderDiscoverAdvisoryPrompt(config: OttoConfig, skill: DiscoverAdvisorySkill, opts?: RenderOptions): string {
  const systemPrompt = renderPrompt("discover-advisory", config, opts);
  const spec = DISCOVER_ADVISORY[skill];
  const contextLines = [
    `SKILL: ${skill}`,
    `INSTRUCTION: ${spec.instruction}`,
    `FOLDERS: ${spec.folders.join(", ")}`,
  ];
  return `${systemPrompt}\n\n---\n\n${contextLines.join("\n")}`;
}
