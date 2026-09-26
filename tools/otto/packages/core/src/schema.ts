import { z } from "zod";

export const PhaseSchema = z.enum([
  "discover",
  "refine",
  "design",
  "build",
  "test",
  "release",
]);

export const EstimationApproachSchema = z.enum([
  "ta-assigns",
  "team-vote",
  "both",
]);

// "none" is deliberately not a member here: "no test-management tool" is
// expressed by omitting `testing.testManagement` entirely (see the `write-cases`
// skill's local-mode check, `{{#unless testing.testManagement}}`) — a `"none"`
// value would make the block look "configured" while every template's provider
// switch has no branch for it.
export const TestManagementProviderSchema = z.enum(["xray", "zephyr", "ado-test-plans"]);

export const StoryStatusMapSchema = z.object({
  backlog: z.string(),
  refineInProgress: z.string(),
  readyForDesign: z.string(),
  designInProgress: z.string(),
  readyForBuild: z.string(),
  inDevelopment: z.string(),
  readyForTest: z.string(),
  done: z.string(),
});

export const EpicStatusMapSchema = z.object({
  notStarted: z.string(),
  inProgress: z.string(),
  done: z.string(),
});

export const SubTaskStatusMapSchema = z.object({
  todo: z.string(),
  inDevelopment: z.string(),
  readyForTest: z.string(),
  done: z.string(),
});

// ── PM-tool configuration ─────────────────────────────────────────────────────

export const JiraAlmSchema = z.object({
  tool: z.literal("JIRA"),
  /** Jira site URL, e.g. https://your-org.atlassian.net */
  site: z.string().url().optional(),
  /** Jira project key, e.g. PROJ */
  projectKey: z.string().optional(),
  /** Atlassian account email for API auth */
  email: z.string().optional(),
});

export const AdoAlmSchema = z.object({
  tool: z.literal("ADO"),
  /** Azure DevOps organisation URL, e.g. https://dev.azure.com/your-org */
  organization: z.string().url(),
  /** ADO project name */
  project: z.string().min(1),
});

export const LocalAlmSchema = z.object({
  tool: z.literal("LOCAL"),
  /** Local work-item key prefix used to name story folders, e.g. LOCAL → LOCAL-001 */
  keyPrefix: z.string().optional(),
});

export const AlmSchema = z.discriminatedUnion("tool", [JiraAlmSchema, AdoAlmSchema, LocalAlmSchema]);
export type AlmConfig = z.infer<typeof AlmSchema>;

/** Returns the active PM tool. Falls back to "JIRA" if alm is not set. */
export function resolveAlmTool(config: OttoConfig): "JIRA" | "ADO" | "LOCAL" {
  return config.alm?.tool ?? "JIRA";
}

/** Returns a display-safe project key / identifier for the active PM tool. */
export function resolveProjectKey(config: OttoConfig): string {
  if (config.alm?.tool === "ADO") return config.alm.project;
  if (config.alm?.tool === "JIRA" && config.alm.projectKey) return config.alm.projectKey;
  if (config.alm?.tool === "LOCAL") return config.alm.keyPrefix ?? config.project.jiraKey ?? config.project.name;
  return config.project.jiraKey ?? config.project.name;
}

/**
 * Extracts a story/work-item key (e.g. `PROJ-123`) from free text using a strict
 * `<PROJECT_KEY>-<digits>` match. This is intentionally the ONLY thing ever pulled
 * out of a user's chat prompt for usage-tracking purposes — no other prompt content
 * is inspected or retained. Shared across all handlers so the pattern only needs to
 * be correct in one place.
 */
export function extractStoryKey(text: string, projectKey: string): string {
  if (!projectKey || !text) return "";
  const match = text.match(new RegExp(`\\b${projectKey}-\\d+\\b`, "i"));
  return match ? match[0].toUpperCase() : "";
}

// ── Design deliverable (solution-design publishing target) ────────────────────

/**
 * Where the Design agent publishes the cross-story **synthesis** design.
 * The per-story "Solution Design" comment (the design of record established by
 * PR #50) is ALWAYS posted regardless of this target — this only controls the
 * additional epic-level readout layer above it.
 *
 * - "confluence" — a Confluence page (JIRA projects)
 * - "wiki"       — an Azure DevOps wiki page (ADO projects)
 * - "local"      — a markdown file under the artifacts folder only
 * - "pm-comment" — no synthesis page; the per-story comment is the whole output (today's behaviour)
 */
export const DeliverableTargetSchema = z.enum(["confluence", "wiki", "local", "pm-comment"]);
export type DeliverableTarget = z.infer<typeof DeliverableTargetSchema>;

/** At what level the synthesis design is published. Accepted so a config that already
 *  carries the key still validates, but currently **unused** — no template branches on
 *  it. Wire it before relying on it; do not treat it as a supported knob. */
export const DeliverableGranularitySchema = z.enum(["epic", "story", "both"]);
export type DeliverableGranularity = z.infer<typeof DeliverableGranularitySchema>;

export const DesignDeliverableSchema = z.object({
  /** Publishing target. Absent → resolved per PM tool (JIRA→confluence, ADO→wiki, LOCAL→local). */
  target: DeliverableTargetSchema.optional(),
  /** Confluence space key (persisted so the agent stops re-asking each run). JIRA/confluence only. */
  spaceKey: z.string().optional(),
  /** Optional parent page/wiki node the synthesis page is created under.
   *  Config-file-only, like `sections` — no interview widget asks for it. */
  parentPageId: z.string().optional(),
  /** Azure DevOps wiki identifier (name or ID) the synthesis page is published to.
   *  ADO wikis have no "space" concept — this is the wiki-side equivalent of `spaceKey`.
   *  Config-file-only, like `parentPageId`/`sections` — no interview widget asks for it,
   *  since `spaceKey`'s `when` gate never fires for ADO projects. */
  wikiIdentifier: z.string().optional(),
  /** Optional wiki page path prefix the synthesis page is created under (e.g. `/Architecture`).
   *  ADO wiki equivalent of `parentPageId`. Config-file-only. */
  wikiPath: z.string().optional(),
  /** Overrides the default section list. Absent → DEFAULT_DESIGN_SECTIONS. Config-file-only. */
  sections: z.array(z.string()).optional(),
  /** Target custom field for the per-story deliverable ("Solution Description").
   *  When set, the Design agent writes a **flat sequential build checklist** to this
   *  field instead of posting the full "Solution Design" comment: JIRA → the field key
   *  (`customfield_...`) via `editJiraIssue`; ADO → the field reference name via
   *  `update_work_item`. When **unset**, behaviour is unchanged — the full comment is
   *  posted. ALM-only: Local mode has no PM field and ignores this (it still writes
   *  `solution-design.md` to the story folder). Config-file-only — no interview widget. */
  storyField: z.string().optional(),
  /** Reserved — accepted but not yet honoured by any template. */
  granularity: DeliverableGranularitySchema.optional(),
});
export type DesignDeliverable = z.infer<typeof DesignDeliverableSchema>;

// ── Status transitions ────────────────────────────────────────────────────────

/** How agents apply PM-tool status transitions. See `workflow.statusTransitions`. */
export const StatusTransitionModeSchema = z.enum(["auto", "confirm", "off"]);
export type StatusTransitionMode = z.infer<typeof StatusTransitionModeSchema>;

// ── ADO status maps ───────────────────────────────────────────────────────────

export const AdoStatusMapSchema = z.object({
  story: StoryStatusMapSchema,
  epic: EpicStatusMapSchema,
  subTask: SubTaskStatusMapSchema,
});

// ─────────────────────────────────────────────────────────────────────────────

export const OttoConfigSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  toolVersion: z.string(),

  project: z.object({
    name: z.string().min(1),
    /** @deprecated Use alm.projectKey (JIRA) or alm.project (ADO) instead. Kept for backward compatibility. */
    jiraKey: z.string().toUpperCase().optional(),
    /** @deprecated Use alm.site (JIRA) instead. Kept for backward compatibility. */
    jiraSite: z.string().url().optional(),
    /** @deprecated Use alm.email (JIRA) instead. Kept for backward compatibility. */
    jiraEmail: z.string().email().optional(),
  }),

  /** PM tool configuration. When absent, the tool defaults to JIRA using project.jiraKey/jiraSite/jiraEmail. */
  alm: AlmSchema.optional(),

  phases: z.array(PhaseSchema).min(1),

  team: z.object({
    sprintLengthWeeks: z.number().int().min(1).max(4),
    estimationApproach: EstimationApproachSchema,
  }),

  salesforce: z.object({
    orgs: z.object({
      sandbox: z.string().min(1),
    }),
  }),

  standards: z.object({
    apexCoverageThreshold: z.number().int().min(0).max(100),
  }),

  /**
   * Revenue Cloud Advanced (RCA) opt-in. When enabled, `/init` scaffolds the RCA
   * standards/skills and the design/build agents load the RCA domain playbook +
   * MCP tools. Absent/false leaves non-RCA projects completely unaffected.
   */
  revenueCloud: z.object({
    enabled: z.boolean(),
  }).optional(),

  /**
   * Design-phase deliverable configuration. When absent, the Design agent resolves
   * sensible defaults per PM tool (see resolveDeliverable). Present only when a
   * project overrides the publishing target, space, sections, or granularity.
   */
  design: z.object({
    deliverable: DesignDeliverableSchema.optional(),
  }).optional(),

  /**
   * Cross-agent workflow behaviour. `statusTransitions` controls whether agents move
   * JIRA issues / ADO work items (stories, bugs/defects and sub-tasks) between
   * statuses: `auto` (default — today's behaviour), `confirm` (ask before each
   * transition) or `off` (never transition; tell the user what to set manually).
   * Has no effect in Local mode, which never transitions anything.
   */
  workflow: z.object({
    statusTransitions: StatusTransitionModeSchema.optional(),
  }).optional(),

  jira: z.object({
    statusMap: z.object({
      story: StoryStatusMapSchema,
      epic: EpicStatusMapSchema,
      subTask: SubTaskStatusMapSchema,
    }),
  }).optional(),

  /** ADO-specific status map. Used when alm.tool = "ADO". */
  ado: z.object({
    statusMap: AdoStatusMapSchema,
  }).optional(),

  branching: z.literal("gitflow"),

  paths: z.object({
    artifacts: z.string(),
    standards: z.string(),
    forceApp: z.string(),
  }),

  /**
   * Test-agent config. Config-file-only, no `/init` interview question (follows
   * the `revenueCloud` / `design.deliverable` precedent) — written on first use
   * by the `write-cases` / `pw-setup` skills. Both blocks optional so every
   * existing config still validates.
   */
  testing: z.object({
    /** Remote test-case management. Secrets are NEVER stored here — they come
     *  from environment variables (OTTO_XRAY_*, OTTO_ZEPHYR_TOKEN, OTTO_ADO_PAT). */
    testManagement: z.object({
      provider: TestManagementProviderSchema,
      /** Xray/Zephyr: Jira project key. Not used for ADO Test Plans — the
       *  ADO skill reads `planId` for its test plan id (see `planId` below). */
      projectKey: z.string().optional(),
      /** Optional parent test plan / test suite the cases are created under. */
      planId: z.string().optional(),
      /** Provider base URL when self-hosted / non-default. */
      baseUrl: z.string().url().optional(),
    }).optional(),

    playwright: z.object({
      enabled: z.boolean(),
      /** Test root, relative to the project root. Default: "tests/e2e". */
      testDir: z.string().optional(),
      /** True once pw-setup has scaffolded — makes re-runs idempotent. */
      scaffolded: z.boolean().optional(),
      /** Alias of the org E2E runs target. Defaults to salesforce.orgs.sandbox. */
      targetOrg: z.string().optional(),
    }).optional(),
  }).optional(),
});

export type OttoConfig = z.infer<typeof OttoConfigSchema>;
export type JiraStatusMap = NonNullable<OttoConfig["jira"]>["statusMap"];
export type AdoStatusMap = z.infer<typeof AdoStatusMapSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type StoryStatusMap = z.infer<typeof StoryStatusMapSchema>;
export type EpicStatusMap = z.infer<typeof EpicStatusMapSchema>;
export type SubTaskStatusMap = z.infer<typeof SubTaskStatusMapSchema>;
export type EstimationApproach = z.infer<typeof EstimationApproachSchema>;

// TOOL_VERSION is the tool's release version, stamped from the release git tag
// by scripts/sync-version.mjs during .github/workflows/release.yml. Re-exported
// here for convenience.
export { TOOL_VERSION } from "./version.js";

// CONFIG_VERSION is the schema version of the .otto/config.json file written into
// client projects. It is owned separately and changes only when the config file
// FORMAT changes — never on a tool release.
export const CONFIG_VERSION = "1.0.0";

export const DEFAULT_PATHS = {
  artifacts: "artifacts",
  standards: "devops/standards",
  forceApp: "force-app",
} satisfies OttoConfig["paths"];

export const DEFAULT_STANDARDS = {
  apexCoverageThreshold: 85,
} satisfies OttoConfig["standards"];

// Default stage names used when no PM tool is connected (LOCAL mode). Templates
// still reference {{statusMap.*}} for the conceptual stage labels even though a
// local project never transitions a remote work item.
export const DEFAULT_STORY_STATUS_MAP = {
  backlog: "Backlog",
  refineInProgress: "In Refinement",
  readyForDesign: "Ready for Design",
  designInProgress: "In Design",
  readyForBuild: "Ready for Build",
  inDevelopment: "In Development",
  readyForTest: "Ready for Test",
  done: "Done",
} satisfies StoryStatusMap;

export const DEFAULT_EPIC_STATUS_MAP = {
  notStarted: "To Do",
  inProgress: "In Progress",
  done: "Done",
} satisfies EpicStatusMap;

export const DEFAULT_SUBTASK_STATUS_MAP = {
  todo: "To Do",
  inDevelopment: "In Progress",
  readyForTest: "In Review",
  done: "Done",
} satisfies SubTaskStatusMap;

export const DEFAULT_STATUS_MAP = {
  story: DEFAULT_STORY_STATUS_MAP,
  epic: DEFAULT_EPIC_STATUS_MAP,
  subTask: DEFAULT_SUBTASK_STATUS_MAP,
} satisfies JiraStatusMap;

// The fixed 10-section epic synthesis design page. Overridable per project via
// design.deliverable.sections — this is only the default.
export const DEFAULT_DESIGN_SECTIONS = [
  "Introduction",
  "Traceability",
  "Profile/Perms",
  "Data Model Diagram",
  "Process Diagram",
  "Objects/Fields",
  "UI",
  "Automation",
  "Key Components",
  "Linked Stories",
] as const;

/** The publishing target a project falls back to when none is configured. */
export function defaultDeliverableTarget(almTool: "JIRA" | "ADO" | "LOCAL"): DeliverableTarget {
  if (almTool === "ADO") return "wiki";
  if (almTool === "LOCAL") return "local";
  return "confluence";
}

export interface ResolvedDeliverable {
  target: DeliverableTarget;
  spaceKey?: string;
  parentPageId?: string;
  wikiIdentifier?: string;
  wikiPath?: string;
  sections: string[];
  storyField?: string;
}

/** The effective status-transition mode; absent → `auto` (unchanged behaviour). */
export function resolveStatusTransitions(config: OttoConfig): StatusTransitionMode {
  return config.workflow?.statusTransitions ?? "auto";
}

/**
 * Coerce a configured target onto one the active ALM tool can actually reach.
 *
 * Without this a `JIRA` project carrying `target: "wiki"` renders Azure DevOps wiki
 * instructions to be executed against the Atlassian MCP (and vice versa) — the prompt
 * would name tools that do not exist in that session. `local` and `pm-comment` are
 * tool-neutral and always pass through.
 */
export function coerceTargetForTool(target: DeliverableTarget, almTool: "JIRA" | "ADO" | "LOCAL"): DeliverableTarget {
  if (almTool === "LOCAL") return "local";
  if (almTool === "ADO" && target === "confluence") return "wiki";
  if (almTool === "JIRA" && target === "wiki") return "confluence";
  return target;
}

/**
 * Resolve the effective design-deliverable settings, applying per-tool defaults.
 * Exposed to templates as `{{deliverable.*}}` so the design prompt stays declarative.
 * LOCAL mode always forces `target: local` — there is no PM tool or Confluence/wiki.
 *
 * `granularity` is deliberately not resolved: no template branches on it, so exposing
 * it would advertise a knob that does nothing.
 */
export function resolveDeliverable(config: OttoConfig, almTool: "JIRA" | "ADO" | "LOCAL"): ResolvedDeliverable {
  const d = config.design?.deliverable;
  const target = coerceTargetForTool(d?.target ?? defaultDeliverableTarget(almTool), almTool);
  return {
    target,
    spaceKey: d?.spaceKey,
    parentPageId: d?.parentPageId,
    wikiIdentifier: d?.wikiIdentifier,
    wikiPath: d?.wikiPath,
    sections: d?.sections && d.sections.length > 0 ? d.sections : [...DEFAULT_DESIGN_SECTIONS],
    storyField: d?.storyField,
  };
}
