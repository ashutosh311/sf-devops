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

export const AlmSchema = z.discriminatedUnion("tool", [JiraAlmSchema, AdoAlmSchema]);
export type AlmConfig = z.infer<typeof AlmSchema>;

/** Returns the active PM tool. Falls back to "JIRA" if alm is not set. */
export function resolveAlmTool(config: SdlcConfig): "JIRA" | "ADO" {
  return config.alm?.tool ?? "JIRA";
}

/** Returns a display-safe project key / identifier for the active PM tool. */
export function resolveProjectKey(config: SdlcConfig): string {
  if (config.alm?.tool === "ADO") return config.alm.project;
  if (config.alm?.tool === "JIRA" && config.alm.projectKey) return config.alm.projectKey;
  return config.project.jiraKey ?? config.project.name;
}

// ── ADO status maps ───────────────────────────────────────────────────────────

export const AdoStatusMapSchema = z.object({
  story: StoryStatusMapSchema,
  epic: EpicStatusMapSchema,
});

// ─────────────────────────────────────────────────────────────────────────────

export const SdlcConfigSchema = z.object({
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
});

export type SdlcConfig = z.infer<typeof SdlcConfigSchema>;
export type JiraStatusMap = NonNullable<SdlcConfig["jira"]>["statusMap"];
export type Phase = z.infer<typeof PhaseSchema>;
export type StoryStatusMap = z.infer<typeof StoryStatusMapSchema>;
export type EpicStatusMap = z.infer<typeof EpicStatusMapSchema>;
export type SubTaskStatusMap = z.infer<typeof SubTaskStatusMapSchema>;
export type EstimationApproach = z.infer<typeof EstimationApproachSchema>;

// TOOL_VERSION is the tool's release version, stamped from the release git tag
// by scripts/sync-version.mjs during .github/workflows/release.yml. Re-exported
// here for convenience.
export { TOOL_VERSION } from "./version.js";

// CONFIG_VERSION is the schema version of the .sdlc/config.json file written into
// client projects. It is owned separately and changes only when the config file
// FORMAT changes — never on a tool release.
export const CONFIG_VERSION = "1.0.0";

export const DEFAULT_PATHS = {
  artifacts: "artifacts",
  standards: "devops/standards",
  forceApp: "force-app",
} satisfies SdlcConfig["paths"];

export const DEFAULT_STANDARDS = {
  apexCoverageThreshold: 85,
} satisfies SdlcConfig["standards"];
