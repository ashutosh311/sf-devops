import Handlebars from "handlebars";
import type { OttoConfig } from "./schema.js";
import { resolveAlmTool, resolveProjectKey, resolveDeliverable, DEFAULT_STATUS_MAP } from "./schema.js";
import { discoverTemplate } from "./templates/discover.js";
import { refineTemplate } from "./templates/refine.js";
import { designTemplate } from "./templates/design.js";
import { buildTemplate } from "./templates/build.js";
import { testTemplate } from "./templates/test.js";
import { releaseTemplate } from "./templates/release.js";
import { dataDictionaryTemplate } from "./templates/data-dictionary.js";
import deploymentInstruction          from "../../../../../devops/instructions/deployment.md";
import orgImpactAssessmentInstruction from "../../../../../devops/instructions/org-impact-assessment.md";
import prerequisiteCheckInstruction   from "../../../../../devops/instructions/prerequisite-check.md";
import { readCachedTemplate, readCachedInstruction, readCachedSkill } from "./cache.js";
import { getRevenueCloudSkills, REVENUE_CLOUD_SKILL_FILES } from "./skills.js";

// {{#eq a b}}...{{/eq}} helper for estimation approach conditionals
Handlebars.registerHelper("eq", function (this: unknown, a: unknown, b: unknown, options: Handlebars.HelperOptions) {
  return a === b ? options.fn(this) : options.inverse(this);
});

export const PHASE_TEMPLATES: Record<string, string> = {
  discover: discoverTemplate,
  refine: refineTemplate,
  design: designTemplate,
  build: buildTemplate,
  test: testTemplate,
  release: releaseTemplate,
  // Cross-cutting sub-command (not an SDLC phase gated by config.phases) —
  // registered here so it renders through the same Handlebars/cache pipeline.
  "data-dictionary": dataDictionaryTemplate,
};

export interface RenderOptions {
  cacheDir?: string;
}

export function renderPrompt(phase: string, config: OttoConfig, opts?: RenderOptions): string {
  // Prefer cached template; fall back to bundled constant
  const raw = (opts?.cacheDir ? readCachedTemplate(phase, opts.cacheDir) : null) ?? PHASE_TEMPLATES[phase];
  if (!raw) throw new Error(`No template found for phase: ${phase}`);

  // Expose phases as a boolean map so templates can use {{#if phases.release}}
  const phaseFlags = Object.fromEntries(
    Object.keys(PHASE_TEMPLATES).map((p) => [p, config.phases.includes(p as OttoConfig["phases"][number])])
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
  // actually reach. Exposed as {{deliverable.*}} so the design template stays
  // declarative and non-regressive.
  const deliverable = resolveDeliverable(config, almTool);

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
  });
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
