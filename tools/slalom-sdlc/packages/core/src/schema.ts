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

export const SdlcConfigSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  toolVersion: z.string(),

  project: z.object({
    name: z.string().min(1),
    jiraKey: z.string().min(1).toUpperCase(),
    jiraSite: z.string().url(),
    jiraEmail: z.string().email(),
  }),

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
  }),

  branching: z.literal("gitflow"),

  paths: z.object({
    artifacts: z.string(),
    standards: z.string(),
    forceApp: z.string(),
  }),
});

export type SdlcConfig = z.infer<typeof SdlcConfigSchema>;
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
